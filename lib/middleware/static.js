const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { pipeline } = require('node:stream/promises');
const zlib = require('node:zlib');

// Promisified fs functions
const stat = promisify(fs.stat);
const readdir = promisify(fs.readdir);
const access = promisify(fs.access);

/**
 * Comprehensive MIME type mapping
 * @private
 */
const MIME_TYPES = {
  // Text
  'html': 'text/html; charset=utf-8',
  'htm': 'text/html; charset=utf-8',
  'txt': 'text/plain; charset=utf-8',
  'text': 'text/plain; charset=utf-8',
  'log': 'text/plain; charset=utf-8',
  'css': 'text/css; charset=utf-8',
  'csv': 'text/csv; charset=utf-8',
  'md': 'text/markdown; charset=utf-8',
  'markdown': 'text/markdown; charset=utf-8',
  
  // JavaScript
  'js': 'application/javascript; charset=utf-8',
  'mjs': 'application/javascript; charset=utf-8',
  'jsx': 'text/jsx; charset=utf-8',
  'ts': 'text/typescript; charset=utf-8',
  'tsx': 'text/tsx; charset=utf-8',
  
  // JSON & Data
  'json': 'application/json; charset=utf-8',
  'map': 'application/json; charset=utf-8',
  'xml': 'application/xml; charset=utf-8',
  'yaml': 'text/yaml; charset=utf-8',
  'yml': 'text/yaml; charset=utf-8',
  'toml': 'text/toml; charset=utf-8',
  
  // Images
  'png': 'image/png',
  'jpg': 'image/jpeg',
  'jpeg': 'image/jpeg',
  'gif': 'image/gif',
  'bmp': 'image/bmp',
  'svg': 'image/svg+xml',
  'svgz': 'image/svg+xml',
  'ico': 'image/x-icon',
  'webp': 'image/webp',
  'avif': 'image/avif',
  'tiff': 'image/tiff',
  'tif': 'image/tiff',
  
  // Audio
  'mp3': 'audio/mpeg',
  'ogg': 'audio/ogg',
  'oga': 'audio/ogg',
  'wav': 'audio/wav',
  'webm': 'audio/webm',
  'm4a': 'audio/m4a',
  'aac': 'audio/aac',
  'flac': 'audio/flac',
  
  // Video
  'mp4': 'video/mp4',
  'mpeg': 'video/mpeg',
  'mpg': 'video/mpeg',
  'avi': 'video/x-msvideo',
  'mov': 'video/quicktime',
  'wmv': 'video/x-ms-wmv',
  'flv': 'video/x-flv',
  'mkv': 'video/x-matroska',
  'ogv': 'video/ogg',
  '3gp': 'video/3gpp',
  
  // Fonts
  'woff': 'font/woff',
  'woff2': 'font/woff2',
  'ttf': 'font/ttf',
  'otf': 'font/otf',
  'eot': 'application/vnd.ms-fontobject',
  
  // Documents
  'pdf': 'application/pdf',
  'doc': 'application/msword',
  'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'xls': 'application/vnd.ms-excel',
  'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'ppt': 'application/vnd.ms-powerpoint',
  'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'odt': 'application/vnd.oasis.opendocument.text',
  'ods': 'application/vnd.oasis.opendocument.spreadsheet',
  'odp': 'application/vnd.oasis.opendocument.presentation',
  
  // Archives
  'zip': 'application/zip',
  'rar': 'application/x-rar-compressed',
  '7z': 'application/x-7z-compressed',
  'tar': 'application/x-tar',
  'gz': 'application/gzip',
  'bz2': 'application/x-bzip2',
  'xz': 'application/x-xz',
  
  // Application
  'exe': 'application/octet-stream',
  'dll': 'application/octet-stream',
  'so': 'application/octet-stream',
  'dylib': 'application/octet-stream',
  'deb': 'application/x-debian-package',
  'rpm': 'application/x-redhat-package-manager',
  'dmg': 'application/x-apple-diskimage',
  'pkg': 'application/x-newton-compatible-pkg',
  'apk': 'application/vnd.android.package-archive',
  
  // Web Assembly
  'wasm': 'application/wasm',
  
  // Other
  'sh': 'application/x-sh',
  'bat': 'application/x-bat',
  'ps1': 'application/x-powershell'
};

/**
 * Cache control settings for different content types
 * @private
 */
const CACHE_CONTROL = {
  // Immutable assets (fonts, versioned files)
  immutable: 'public, max-age=31536000, immutable',
  
  // Static assets (images, styles, scripts)
  static: 'public, max-age=86400',
  
  // Dynamic content (HTML)
  dynamic: 'public, max-age=0, must-revalidate',
  
  // No cache
  none: 'no-cache, no-store, must-revalidate'
};

/**
 * Parse range header
 * @private
 */
function parseRangeHeader(rangeHeader, totalSize) {
  const matches = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader);
  if (!matches) return null;
  
  const start = matches[1] ? parseInt(matches[1], 10) : 0;
  const end = matches[2] ? parseInt(matches[2], 10) : totalSize - 1;
  
  // Validate range
  if (start < 0 || end >= totalSize || start > end) {
    return null;
  }
  
  return { start, end };
}

/**
 * Generate ETag for file
 * @private
 */
function generateETag(stats, options = {}) {
  if (options.weak !== false) {
    // Weak ETag based on size and mtime
    return `W/"${stats.size.toString(16)}-${stats.mtime.getTime().toString(16)}"`;
  }
  
  // Strong ETag would require file content hashing
  // For performance, we use weak ETags by default
  return `"${stats.size.toString(16)}-${stats.mtime.getTime().toString(16)}"`;
}

/**
 * Check if request is fresh (for conditional requests)
 * @private
 */
function isFresh(req, res) {
  // Check ETag
  const ifNoneMatch = req.headers['if-none-match'];
  if (ifNoneMatch) {
    // Access headers from the Response's internal _headers object
    const etag = res._headers && res._headers['ETag'];
    if (etag) {
      const etagList = ifNoneMatch.split(',').map(tag => tag.trim());
      if (etagList.includes(etag) || etagList.includes('*')) {
        return true;
      }
    }
  }
  
  // Check Last-Modified
  const ifModifiedSince = req.headers['if-modified-since'];
  if (ifModifiedSince) {
    const lastModified = res._headers && res._headers['Last-Modified'];
    if (lastModified) {
      const ifModifiedSinceDate = new Date(ifModifiedSince);
      const lastModifiedDate = new Date(lastModified);
      if (lastModifiedDate <= ifModifiedSinceDate) {
        return true;
      }
    }
  }
  
  return false;
}

/**
 * Escape HTML for directory listing
 * @private
 */
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Format file size for directory listing
 * @private
 */
function formatSize(bytes) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unitIndex = 0;
  
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  
  return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

/**
 * Generate directory listing HTML
 * @private
 */
async function generateDirectoryListing(dirPath, urlPath, entries) {
  const items = [];
  
  // Add parent directory link if not root
  if (urlPath !== '/') {
    const parentPath = path.dirname(urlPath);
    items.push(`
      <tr>
        <td><a href="${parentPath}">../</a></td>
        <td>-</td>
        <td>-</td>
      </tr>
    `);
  }
  
  // Sort entries: directories first, then files, alphabetically
  const sortedEntries = entries.sort((a, b) => {
    if (a.isDirectory && !b.isDirectory) return -1;
    if (!a.isDirectory && b.isDirectory) return 1;
    return a.name.localeCompare(b.name);
  });
  
  // Generate listing items
  for (const entry of sortedEntries) {
    const encodedName = encodeURIComponent(entry.name);
    const displayName = escapeHtml(entry.name);
    const href = path.posix.join(urlPath, encodedName);
    
    if (entry.isDirectory) {
      items.push(`
        <tr>
          <td><a href="${href}/">${displayName}/</a></td>
          <td>-</td>
          <td>${entry.mtime.toLocaleString()}</td>
        </tr>
      `);
    } else {
      items.push(`
        <tr>
          <td><a href="${href}">${displayName}</a></td>
          <td>${formatSize(entry.size)}</td>
          <td>${entry.mtime.toLocaleString()}</td>
        </tr>
      `);
    }
  }
  
  // Generate HTML
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Index of ${escapeHtml(urlPath)}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      margin: 0;
      padding: 20px;
      background: #f5f5f5;
    }
    .container {
      max-width: 1200px;
      margin: 0 auto;
      background: white;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      padding: 20px;
    }
    h1 {
      margin: 0 0 20px 0;
      padding: 0 0 10px 0;
      border-bottom: 2px solid #e0e0e0;
      color: #333;
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th {
      text-align: left;
      padding: 10px;
      background: #f8f9fa;
      border-bottom: 2px solid #dee2e6;
      color: #495057;
    }
    td {
      padding: 10px;
      border-bottom: 1px solid #dee2e6;
    }
    tr:hover {
      background: #f8f9fa;
    }
    a {
      color: #007bff;
      text-decoration: none;
    }
    a:hover {
      text-decoration: underline;
    }
    .footer {
      margin-top: 20px;
      padding-top: 20px;
      border-top: 1px solid #e0e0e0;
      text-align: center;
      color: #6c757d;
      font-size: 0.9em;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Index of ${escapeHtml(urlPath)}</h1>
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Size</th>
          <th>Modified</th>
        </tr>
      </thead>
      <tbody>
        ${items.join('')}
      </tbody>
    </table>
    <div class="footer">
      Powered by Velocy Static Middleware
    </div>
  </div>
</body>
</html>
  `.trim();
  
  return html;
}

/**
 * Static file serving middleware factory for Velocy
 * 
 * @param {Object} options - Configuration options
 * @param {String} options.root - Root directory to serve files from (required)
 * @param {String|Array} options.index - Index file(s) to serve for directories (default: ['index.html'])
 * @param {Boolean} options.dotfiles - How to handle dotfiles: 'allow', 'deny', 'ignore' (default: 'ignore')
 * @param {Boolean} options.etag - Enable ETag generation (default: true)
 * @param {Boolean} options.lastModified - Enable Last-Modified header (default: true)
 * @param {Number|String|Object} options.maxAge - Cache-Control max-age in ms or string (default: 0)
 * @param {Boolean} options.immutable - Add immutable directive to Cache-Control (default: false)
 * @param {Boolean} options.directoryListing - Enable directory listing (default: false)
 * @param {Boolean} options.gzip - Support pre-compressed .gz files (default: true)
 * @param {Boolean} options.brotli - Support pre-compressed .br files (default: true)
 * @param {Object} options.headers - Additional headers to set on all responses
 * @param {Function} options.setHeaders - Function to set custom headers (file, stats, res)
 * @param {Array} options.extensions - Extensions to try when file not found (default: false)
 * @param {String} options.fallthrough - Pass to next middleware on 404 (default: true)
 * @param {Boolean} options.acceptRanges - Enable range requests (default: true)
 * @param {Object} options.cacheControl - Custom cache control settings by content type
 * @returns {Function} Middleware function
 */
function createStaticMiddleware(options = {}) {
  // Validate and normalize options
  if (!options.root) {
    throw new Error('Static middleware requires a root directory');
  }
  
  const root = path.resolve(options.root);
  const config = {
    root,
    index: options.index !== false ? (Array.isArray(options.index) ? options.index : [options.index || 'index.html']) : [],
    dotfiles: options.dotfiles || 'ignore',
    etag: options.etag !== false,
    lastModified: options.lastModified !== false,
    maxAge: options.maxAge != null ? options.maxAge : 0,
    immutable: options.immutable === true,
    directoryListing: options.directoryListing === true,
    gzip: options.gzip !== false,
    brotli: options.brotli !== false,
    headers: options.headers || {},
    setHeaders: options.setHeaders,
    extensions: options.extensions || [],
    fallthrough: options.fallthrough !== false,
    acceptRanges: options.acceptRanges !== false,
    cacheControl: options.cacheControl || {}
  };
  
  // Validate dotfiles option
  if (!['allow', 'deny', 'ignore'].includes(config.dotfiles)) {
    throw new Error('Invalid dotfiles option. Must be "allow", "deny", or "ignore"');
  }
  
  /**
   * Send file with proper headers and streaming
   * @private
   */
  async function sendFile(req, res, filePath, stats) {
    // Get MIME type
    const ext = path.extname(filePath).slice(1).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    
    // Set basic headers
    res.set('Content-Type', contentType);
    
    // Handle range requests
    let start = 0;
    let end = stats.size - 1;
    let statusCode = 200;
    
    if (config.acceptRanges && req.headers.range) {
      const range = parseRangeHeader(req.headers.range, stats.size);
      
      if (!range) {
        // Invalid range
        res.status(416);
        res.set('Content-Range', `bytes */${stats.size}`);
        res.end();
        return;
      }
      
      start = range.start;
      end = range.end;
      statusCode = 206;
      
      res.set('Content-Range', `bytes ${start}-${end}/${stats.size}`);
      res.set('Content-Length', end - start + 1);
    } else {
      res.set('Content-Length', stats.size);
    }
    
    // Set cache headers
    if (config.maxAge != null || config.cacheControl[ext]) {
      let cacheControl;
      
      if (config.cacheControl[ext]) {
        cacheControl = config.cacheControl[ext];
      } else if (typeof config.maxAge === 'string') {
        cacheControl = config.maxAge;
      } else {
        const maxAgeSeconds = Math.floor(config.maxAge / 1000);
        cacheControl = `public, max-age=${maxAgeSeconds}`;
        if (config.immutable) {
          cacheControl += ', immutable';
        }
      }
      
      res.set('Cache-Control', cacheControl);
    }
    
    // Set ETag
    if (config.etag) {
      const etag = generateETag(stats);
      res.set('ETag', etag);
    }
    
    // Set Last-Modified
    if (config.lastModified) {
      res.set('Last-Modified', stats.mtime.toUTCString());
    }
    
    // Set Accept-Ranges
    if (config.acceptRanges) {
      res.set('Accept-Ranges', 'bytes');
    }
    
    // Set additional headers
    for (const [key, value] of Object.entries(config.headers)) {
      res.set(key, value);
    }
    
    // Call setHeaders function if provided
    if (config.setHeaders) {
      config.setHeaders(filePath, stats, res);
    }
    
    // Check for conditional request
    if (isFresh(req, res)) {
      res.status(304).end();
      return;
    }
    
    // Set status code
    res.status(statusCode);
    
    // For HEAD requests, don't send body
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    
    // Check if response has sendFile method (it should for Velocy Response)
    if (res.sendFile && typeof res.sendFile === 'function') {
      // The Response class already has a sendFile method, but we've already set all headers
      // So we'll use the streaming approach directly
    }
    
    // Stream the file
    const stream = fs.createReadStream(filePath, { start, end });
    
    // For efficient streaming, we need to write headers first and then pipe
    // Since Velocy Response class wraps the native response, we'll handle this properly
    if (!res.headersSent) {
      // Get the headers object
      const headers = {};
      
      // The Response class stores headers in a private field, but we can access via writeHead
      if (res._headers) {
        Object.assign(headers, res._headers);
      }
      
      // Write headers to the native response
      if (res.writeHead && typeof res.writeHead === 'function') {
        res.writeHead(statusCode, headers);
      }
    }
    
    // Handle stream errors
    stream.on('error', (err) => {
      // Destroy the stream on error
      stream.destroy();
      
      if (!res.headersSent) {
        res.status(500).send('Internal Server Error');
      } else {
        res.end();
      }
    });
    
    // Pipe the stream to the response
    // For Node.js native response or if the response object is a writable stream
    stream.pipe(res);
    
    // Ensure response ends when stream ends
    stream.on('end', () => {
      if (!res.finished && !res.headersSent) {
        res.end();
      }
    });
  }
  
  /**
   * Middleware function
   */
  return async function staticMiddleware(req, res, next) {
    // Only handle GET and HEAD requests
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      if (next) return next();
      res.status(405).send('Method Not Allowed');
      return;
    }
    
    try {
      // Parse URL to get pathname
      const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      let pathname = decodeURIComponent(parsedUrl.pathname);
      
      // Security: Prevent directory traversal
      pathname = path.posix.normalize(pathname);
      if (pathname.includes('..')) {
        if (config.fallthrough && next) return next();
        res.status(403).send('Forbidden');
        return;
      }
      
      // Remove leading slash and resolve to absolute path
      const relativePath = pathname.slice(1);
      const absolutePath = path.join(root, relativePath);
      
      // Security: Ensure resolved path is within root
      if (!absolutePath.startsWith(root)) {
        if (config.fallthrough && next) return next();
        res.status(403).send('Forbidden');
        return;
      }
      
      // Check for dotfiles
      const segments = relativePath.split(path.sep);
      const hasDotfile = segments.some(segment => segment.startsWith('.'));
      
      if (hasDotfile) {
        if (config.dotfiles === 'deny') {
          res.status(403).send('Forbidden');
          return;
        } else if (config.dotfiles === 'ignore') {
          if (config.fallthrough && next) return next();
          res.status(404).send('Not Found');
          return;
        }
      }
      
      // Check if file/directory exists
      let stats;
      let finalPath = absolutePath;
      
      try {
        stats = await stat(absolutePath);
      } catch (err) {
        if (err.code === 'ENOENT') {
          // Try extensions if configured
          if (config.extensions.length > 0) {
            let found = false;
            
            for (const ext of config.extensions) {
              const extPath = absolutePath + ext;
              try {
                stats = await stat(extPath);
                finalPath = extPath;
                found = true;
                break;
              } catch (e) {
                // Continue to next extension
              }
            }
            
            if (!found) {
              if (config.fallthrough && next) return next();
              res.status(404).send('Not Found');
              return;
            }
          } else {
            if (config.fallthrough && next) return next();
            res.status(404).send('Not Found');
            return;
          }
        } else {
          throw err;
        }
      }
      
      // Handle directories
      if (stats.isDirectory()) {
        // Ensure trailing slash for directories
        if (!pathname.endsWith('/')) {
          res.redirect(pathname + '/' + parsedUrl.search);
          return;
        }
        
        // Try index files
        let indexFound = false;
        
        for (const indexFile of config.index) {
          const indexPath = path.join(finalPath, indexFile);
          
          try {
            const indexStats = await stat(indexPath);
            if (indexStats.isFile()) {
              // Check for pre-compressed versions
              if (config.gzip || config.brotli) {
                const acceptEncoding = req.headers['accept-encoding'] || '';
                
                // Try Brotli first (better compression)
                if (config.brotli && acceptEncoding.includes('br')) {
                  const brPath = indexPath + '.br';
                  try {
                    const brStats = await stat(brPath);
                    if (brStats.isFile()) {
                      res.set('Content-Encoding', 'br');
                      await sendFile(req, res, brPath, brStats);
                      return;
                    }
                  } catch (e) {
                    // Brotli file doesn't exist
                  }
                }
                
                // Try gzip
                if (config.gzip && acceptEncoding.includes('gzip')) {
                  const gzPath = indexPath + '.gz';
                  try {
                    const gzStats = await stat(gzPath);
                    if (gzStats.isFile()) {
                      res.set('Content-Encoding', 'gzip');
                      await sendFile(req, res, gzPath, gzStats);
                      return;
                    }
                  } catch (e) {
                    // Gzip file doesn't exist
                  }
                }
              }
              
              await sendFile(req, res, indexPath, indexStats);
              indexFound = true;
              break;
            }
          } catch (e) {
            // Index file doesn't exist, try next
          }
        }
        
        if (indexFound) return;
        
        // Generate directory listing if enabled
        if (config.directoryListing) {
          try {
            const entries = await readdir(finalPath, { withFileTypes: true });
            const entryStats = [];
            
            for (const entry of entries) {
              // Skip hidden files if configured
              if (config.dotfiles === 'ignore' && entry.name.startsWith('.')) {
                continue;
              }
              
              const entryPath = path.join(finalPath, entry.name);
              const entryStat = await stat(entryPath);
              
              entryStats.push({
                name: entry.name,
                isDirectory: entry.isDirectory(),
                size: entryStat.size,
                mtime: entryStat.mtime
              });
            }
            
            const html = await generateDirectoryListing(finalPath, pathname, entryStats);
            res.type('html').send(html);
            return;
          } catch (err) {
            // Send error response for directory listing failure
            res.status(500).send('Internal Server Error');
            return;
          }
        }
        
        // No index found and directory listing disabled
        if (config.fallthrough && next) return next();
        res.status(404).send('Not Found');
        return;
      }
      
      // Handle files
      if (!stats.isFile()) {
        if (config.fallthrough && next) return next();
        res.status(404).send('Not Found');
        return;
      }
      
      // Check for pre-compressed versions
      if (config.gzip || config.brotli) {
        const acceptEncoding = req.headers['accept-encoding'] || '';
        
        // Try Brotli first (better compression)
        if (config.brotli && acceptEncoding.includes('br')) {
          const brPath = finalPath + '.br';
          try {
            const brStats = await stat(brPath);
            if (brStats.isFile()) {
              res.set('Content-Encoding', 'br');
              await sendFile(req, res, brPath, brStats);
              return;
            }
          } catch (e) {
            // Brotli file doesn't exist
          }
        }
        
        // Try gzip
        if (config.gzip && acceptEncoding.includes('gzip')) {
          const gzPath = finalPath + '.gz';
          try {
            const gzStats = await stat(gzPath);
            if (gzStats.isFile()) {
              res.set('Content-Encoding', 'gzip');
              await sendFile(req, res, gzPath, gzStats);
              return;
            }
          } catch (e) {
            // Gzip file doesn't exist
          }
        }
      }
      
      // Send the file
      await sendFile(req, res, finalPath, stats);
      
    } catch (err) {
      // Handle errors silently in production
      if (!res.headersSent) {
        res.status(500).send('Internal Server Error');
      } else {
        res.end();
      }
    }
  };
}

/**
 * Create static middleware with common presets
 */
createStaticMiddleware.assets = function(root, options = {}) {
  return createStaticMiddleware({
    root,
    maxAge: 86400000, // 1 day
    etag: true,
    lastModified: true,
    gzip: true,
    brotli: true,
    ...options
  });
};

createStaticMiddleware.public = function(root, options = {}) {
  return createStaticMiddleware({
    root,
    index: ['index.html', 'index.htm'],
    directoryListing: false,
    dotfiles: 'ignore',
    ...options
  });
};

createStaticMiddleware.immutable = function(root, options = {}) {
  return createStaticMiddleware({
    root,
    maxAge: 31536000000, // 1 year
    immutable: true,
    etag: true,
    lastModified: true,
    ...options
  });
};

module.exports = createStaticMiddleware;