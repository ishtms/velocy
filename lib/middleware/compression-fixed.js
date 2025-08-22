/**
 * Compression Middleware for Velocy Framework (Fixed Version)
 * 
 * A high-performance compression middleware that supports gzip, deflate, and brotli
 * compression algorithms using only Node.js built-in modules.
 */

const zlib = require('node:zlib');
const { pipeline } = require('node:stream');
const { promisify } = require('node:util');

const pipelineAsync = promisify(pipeline);

/**
 * Compressible content types
 * @private
 */
const COMPRESSIBLE_TYPES = [
  /^text\//i,
  /^application\/(?:json|javascript|xml|xhtml\+xml|rss\+xml|atom\+xml|vnd\.api\+json|ld\+json)/i,
  /^application\/x-(?:javascript|www-form-urlencoded)/i,
  /^image\/svg\+xml/i,
  /\+json$/i,
  /\+xml$/i
];

/**
 * Already compressed content types that should not be recompressed
 * @private
 */
const COMPRESSED_TYPES = [
  /^image\/(?!svg\+xml)/i,  // All images except SVG
  /^video\//i,
  /^audio\//i,
  /^application\/(?:zip|gzip|x-gzip|x-tar|x-rar-compressed|x-7z-compressed|pdf)/i,
  /^application\/octet-stream/i,
  /\.(?:gz|zip|br|7z|rar|tar)$/i
];

/**
 * Parse Accept-Encoding header and return accepted encodings with quality values
 * @private
 */
function parseAcceptEncoding(acceptEncoding) {
  if (!acceptEncoding || acceptEncoding === 'identity') {
    return [];
  }
  
  const encodings = [];
  const parts = acceptEncoding.toLowerCase().split(',');
  
  for (const part of parts) {
    const trimmed = part.trim();
    const match = trimmed.match(/^([^\s;]+)(?:.*?;\s*q=([0-9.]+))?/);
    
    if (match) {
      const encoding = match[1];
      const quality = match[2] ? parseFloat(match[2]) : 1.0;
      
      // Skip identity encoding and zero quality
      if (encoding !== 'identity' && quality > 0) {
        encodings.push({ encoding, quality });
      }
    }
  }
  
  // Sort by quality (highest first)
  encodings.sort((a, b) => b.quality - a.quality);
  
  return encodings;
}

/**
 * Select the best encoding based on client preferences and server support
 * @private
 */
function selectEncoding(acceptEncoding, supportedEncodings) {
  const accepted = parseAcceptEncoding(acceptEncoding);
  
  // Handle wildcard
  const wildcard = accepted.find(a => a.encoding === '*');
  if (wildcard && wildcard.quality > 0) {
    // Return first supported encoding
    return supportedEncodings[0];
  }
  
  // Find best match
  for (const { encoding } of accepted) {
    if (supportedEncodings.includes(encoding)) {
      return encoding;
    }
  }
  
  return null;
}

/**
 * Check if content type is compressible
 * @private
 */
function isCompressible(contentType) {
  if (!contentType) return false;
  
  // Check if it's already compressed
  for (const pattern of COMPRESSED_TYPES) {
    if (pattern.test(contentType)) {
      return false;
    }
  }
  
  // Check if it's compressible
  for (const pattern of COMPRESSIBLE_TYPES) {
    if (pattern.test(contentType)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Create appropriate compression stream based on encoding
 * @private
 */
function createCompressor(encoding, options) {
  switch (encoding) {
    case 'gzip':
      return zlib.createGzip({
        level: options.gzip?.level ?? options.level ?? zlib.constants.Z_DEFAULT_COMPRESSION,
        memLevel: options.gzip?.memLevel ?? 8,
        strategy: options.gzip?.strategy ?? zlib.constants.Z_DEFAULT_STRATEGY,
        windowBits: options.gzip?.windowBits ?? 15,
        chunkSize: options.chunkSize ?? 16 * 1024
      });
      
    case 'deflate':
      return zlib.createDeflate({
        level: options.deflate?.level ?? options.level ?? zlib.constants.Z_DEFAULT_COMPRESSION,
        memLevel: options.deflate?.memLevel ?? 8,
        strategy: options.deflate?.strategy ?? zlib.constants.Z_DEFAULT_STRATEGY,
        windowBits: options.deflate?.windowBits ?? 15,
        chunkSize: options.chunkSize ?? 16 * 1024
      });
      
    case 'br':
      if (!zlib.createBrotliCompress) {
        throw new Error('Brotli compression not supported in this Node.js version');
      }
      return zlib.createBrotliCompress({
        params: {
          [zlib.constants.BROTLI_PARAM_MODE]: options.brotli?.mode ?? zlib.constants.BROTLI_MODE_GENERIC,
          [zlib.constants.BROTLI_PARAM_QUALITY]: options.brotli?.quality ?? options.level ?? 4,
          [zlib.constants.BROTLI_PARAM_SIZE_HINT]: options.brotli?.sizeHint ?? 0
        },
        chunkSize: options.chunkSize ?? 16 * 1024
      });
      
    default:
      throw new Error(`Unsupported encoding: ${encoding}`);
  }
}

/**
 * Creates compression middleware with configuration options
 * 
 * @param {Object} options - Configuration options
 * @param {Number} options.threshold - Minimum response size to compress (default: 1024 bytes)
 * @param {Number} options.level - Default compression level (default: 6)
 * @param {Number} options.chunkSize - Chunk size for streaming (default: 16KB)
 * @param {Boolean} options.gzip - Enable gzip compression (default: true)
 * @param {Boolean} options.deflate - Enable deflate compression (default: true)
 * @param {Boolean} options.brotli - Enable brotli compression (default: true)
 * @param {Object} options.gzip - Gzip-specific options
 * @param {Object} options.deflate - Deflate-specific options
 * @param {Object} options.brotli - Brotli-specific options
 * @param {Function} options.filter - Custom filter function(req, res) => boolean
 * @param {Boolean} options.cache - Cache encoding negotiation (default: true)
 * @returns {Function} Express-style middleware function
 */
function compression(options = {}) {
  // Default configuration
  const config = {
    threshold: 1024,  // 1KB minimum
    level: 6,  // Default compression level (good balance)
    chunkSize: 16 * 1024,  // 16KB chunks
    gzip: options.gzip !== false,
    deflate: options.deflate !== false,
    brotli: options.brotli !== false,
    cache: options.cache !== false,
    filter: options.filter || defaultFilter,
    ...options
  };
  
  // Build list of supported encodings
  const supportedEncodings = [];
  if (config.brotli && zlib.createBrotliCompress) {
    supportedEncodings.push('br');
  }
  if (config.gzip) {
    supportedEncodings.push('gzip');
  }
  if (config.deflate) {
    supportedEncodings.push('deflate');
  }
  
  // Cache for encoding negotiation
  const encodingCache = new Map();
  
  /**
   * Default filter function - compress based on content type
   */
  function defaultFilter(req, res) {
    const contentType = res.getHeader?.('Content-Type') || res.get?.('Content-Type');
    return isCompressible(contentType);
  }
  
  /**
   * Middleware function
   */
  return function compressionMiddleware(req, res, next) {
    // Skip if no supported encodings
    if (supportedEncodings.length === 0) {
      return next ? next() : undefined;
    }
    
    // Skip OPTIONS requests but allow HEAD (it should send headers but no body)
    if (req.method === 'OPTIONS') {
      return next ? next() : undefined;
    }
    
    // Get Accept-Encoding header
    const acceptEncoding = req.headers?.['accept-encoding'] || req.get?.('accept-encoding') || '';
    
    // Check cache
    let encoding;
    if (config.cache && encodingCache.has(acceptEncoding)) {
      encoding = encodingCache.get(acceptEncoding);
    } else {
      encoding = selectEncoding(acceptEncoding, supportedEncodings);
      if (config.cache) {
        encodingCache.set(acceptEncoding, encoding);
      }
    }
    
    // Skip if no acceptable encoding
    if (!encoding) {
      return next ? next() : undefined;
    }
    
    // Patch the response methods
    const originalWrite = res.write.bind(res);
    const originalEnd = res.end.bind(res);
    const originalPipe = res.pipe ? res.pipe.bind(res) : null;
    
    let compressor;
    let compressionStarted = false;
    let bufferedChunks = [];
    let bufferedSize = 0;
    
    // Helper to check if we should compress
    function shouldCompress() {
      // Don't compress if below threshold
      if (bufferedSize > 0 && bufferedSize < config.threshold) {
        return false;
      }
      
      // Check content type
      const contentType = res.getHeader?.('Content-Type') || res.get?.('Content-Type');
      if (!isCompressible(contentType)) {
        return false;
      }
      
      // Check if already encoded
      const contentEncoding = res.getHeader?.('Content-Encoding') || res.get?.('Content-Encoding');
      if (contentEncoding && contentEncoding !== 'identity') {
        return false;
      }
      
      // Apply custom filter
      if (config.filter && !config.filter(req, res)) {
        return false;
      }
      
      return true;
    }
    
    // Helper to start compression
    function startCompression() {
      if (compressionStarted) return;
      compressionStarted = true;
      
      // Create compressor
      compressor = createCompressor(encoding, config);
      
      // Set compression headers
      res.setHeader('Content-Encoding', encoding);
      res.setHeader('Vary', 'Accept-Encoding');
      res.removeHeader('Content-Length');
      
      // Pipe compressor output to the original response
      compressor.on('data', (chunk) => {
        originalWrite(chunk);
      });
      
      compressor.on('end', () => {
        originalEnd();
      });
      
      compressor.on('error', (err) => {
        // On compression error, end the response
        originalEnd();
      });
      
      // Write buffered chunks
      for (const chunk of bufferedChunks) {
        compressor.write(chunk);
      }
      bufferedChunks = [];
    }
    
    // Override write
    res.write = function(chunk, encoding) {
      if (!chunk) return true;
      
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding || 'utf8');
      
      if (!compressionStarted) {
        // Buffer the chunk
        bufferedChunks.push(buffer);
        bufferedSize += buffer.length;
        
        // Check if we have enough data to decide
        if (bufferedSize >= config.threshold) {
          if (shouldCompress()) {
            startCompression();
          } else {
            // Flush buffered chunks without compression
            for (const bufferedChunk of bufferedChunks) {
              originalWrite(bufferedChunk);
            }
            bufferedChunks = [];
            compressionStarted = true; // Mark as started (but not compressing)
          }
        }
        return true;
      }
      
      // If compression started, write to compressor or original
      if (compressor) {
        return compressor.write(buffer);
      } else {
        return originalWrite(buffer);
      }
    };
    
    // Override end
    res.end = function(chunk, encoding) {
      // Handle final chunk
      if (chunk) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding || 'utf8');
        bufferedChunks.push(buffer);
        bufferedSize += buffer.length;
      }
      
      // Decide on compression if not yet started
      if (!compressionStarted) {
        if (shouldCompress() && bufferedSize > 0) {
          startCompression();
          compressor.end();
        } else {
          // Send buffered chunks without compression
          for (const bufferedChunk of bufferedChunks) {
            originalWrite(bufferedChunk);
          }
          originalEnd();
        }
      } else if (compressor) {
        // End the compressor
        if (chunk) {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding || 'utf8');
          compressor.write(buffer);
        }
        compressor.end();
      } else {
        // No compression, just end normally
        originalEnd(chunk, encoding);
      }
    };
    
    // Handle stream pipes
    if (originalPipe) {
      res.pipe = function(destination, options) {
        // If piping, we need to handle compression differently
        // For now, just use the original pipe
        return originalPipe(destination, options);
      };
    }
    
    // Continue to next middleware
    if (next) {
      next();
    }
  };
}

/**
 * Preset configurations
 */

/**
 * High compression preset (level 9)
 */
compression.high = function(options = {}) {
  return compression({
    ...options,
    level: 9,
    gzip: {
      level: zlib.constants.Z_BEST_COMPRESSION,
      ...options.gzip
    },
    deflate: {
      level: zlib.constants.Z_BEST_COMPRESSION,
      ...options.deflate
    },
    brotli: {
      quality: 11,
      ...options.brotli
    }
  });
};

/**
 * Fast compression preset (level 1)
 */
compression.fast = function(options = {}) {
  return compression({
    ...options,
    level: 1,
    gzip: {
      level: zlib.constants.Z_BEST_SPEED,
      ...options.gzip
    },
    deflate: {
      level: zlib.constants.Z_BEST_SPEED,
      ...options.deflate
    },
    brotli: {
      quality: 0,
      ...options.brotli
    }
  });
};

/**
 * Balanced compression preset (level 6, default)
 */
compression.balanced = function(options = {}) {
  return compression({
    ...options,
    level: 6
  });
};

/**
 * Text-optimized preset
 */
compression.text = function(options = {}) {
  return compression({
    ...options,
    brotli: {
      mode: zlib.constants.BROTLI_MODE_TEXT,
      quality: 4,
      ...options.brotli
    },
    filter: (req, res) => {
      const contentType = res.getHeader?.('Content-Type') || res.get?.('Content-Type') || '';
      return /^text\/|application\/(?:json|javascript|xml)/.test(contentType);
    }
  });
};

/**
 * API/JSON optimized preset
 */
compression.json = function(options = {}) {
  return compression({
    ...options,
    threshold: 512,  // Lower threshold for JSON
    filter: (req, res) => {
      const contentType = res.getHeader?.('Content-Type') || res.get?.('Content-Type') || '';
      return /application\/json|\+json$/.test(contentType);
    }
  });
};

module.exports = compression;