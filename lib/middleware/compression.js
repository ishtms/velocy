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
    threshold: 1000,  // 1000 bytes minimum (standard default)
    level: 6,  // Default compression level (good balance)
    chunkSize: 16 * 1024,  // 16KB chunks
    gzip: options.gzip !== false,
    deflate: options.deflate !== false,
    brotli: options.brotli !== false,
    cache: options.cache !== false,
    filter: options.filter || defaultFilter,
    ...options
  };
  if (!Number.isSafeInteger(config.threshold) || config.threshold < 0) {
    throw new TypeError('Compression threshold must be a non-negative safe integer');
  }
  
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
    const contentType = res.getHeader?.('Content-Type') || res.get?.('Content-Type') || res._headers?.['Content-Type'] || '';
    // If no content type is set yet, default to compressible (will be checked again later)
    if (!contentType) {
      return true;
    }
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
    
    // Debug logging
    if (process.env.DEBUG_COMPRESSION) {
      console.log('Accept-Encoding:', acceptEncoding);
      console.log('Supported encodings:', supportedEncodings);
    }
    
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
    
    // Debug logging
    if (process.env.DEBUG_COMPRESSION) {
      console.log('Selected encoding:', encoding);
    }
    
    // Skip if no acceptable encoding
    if (!encoding) {
      return next ? next() : undefined;
    }
    
    // Get the native response object (for Response class compatibility)
    const nativeRes = res._nativeResponse || res;
    
    // Store original methods
    const originalWrite = nativeRes.write.bind(nativeRes);
    const originalEnd = nativeRes.end.bind(nativeRes);
    const originalWriteHead = nativeRes.writeHead.bind(nativeRes);
    const originalFlushHeaders = nativeRes.flushHeaders?.bind(nativeRes);
    const originalEmit = nativeRes.emit.bind(nativeRes);
    const originalPipe = res.pipe ? res.pipe.bind(res) : null;
    
    let compressor;
    let compressionStarted = false;
    let bufferedChunks = [];
    let bufferedSize = 0;
    let pendingWriteHead = null;
    let responseHandled = false;
    let endCallback;
    let outputBlocked = false;
    let inputDrain = false;

    function settleEnd(err) {
      const callback = endCallback;
      endCallback = undefined;
      if (callback) callback(err);
    }

    function bufferOf(chunk, encoding) {
      if (typeof chunk === 'string') return Buffer.from(chunk, encoding || 'utf8');
      if (Buffer.isBuffer(chunk)) return chunk;
      if (ArrayBuffer.isView(chunk)) return Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
      throw new TypeError('Response data must be a string, Buffer or ArrayBuffer view');
    }

    function commitHeaders(compressed) {
      if (nativeRes.headersSent) return;
      // Wrapper headers remain authoritative while transport is buffered. A
      // stale writeHead snapshot must not restore headers removed by recovery.
      const headers = Object.create(null);
      for (const source of [pendingWriteHead?.headers, nativeRes.getHeaders?.(), res._headers]) {
        for (const [name, value] of Object.entries(source || {})) headers[name.toLowerCase()] = value;
      }
      if (compressed) {
        headers['content-encoding'] = encoding;
        const vary = String(headers.vary || '').split(',').map(value => value.trim()).filter(Boolean);
        if (!vary.some(value => value === '*' || value.toLowerCase() === 'accept-encoding')) vary.push('Accept-Encoding');
        headers.vary = vary.join(', ');
        delete headers['content-length'];
        res.setHeader('Content-Encoding', encoding);
        res.setHeader('Vary', headers.vary);
        res.removeHeader('Content-Length');
      }
      const status = pendingWriteHead?.statusCode || res.statusCode || nativeRes.statusCode || 200;
      if (pendingWriteHead?.statusMessage) originalWriteHead(status, pendingWriteHead.statusMessage, headers);
      else originalWriteHead(status, headers);
      pendingWriteHead = null;
    }

    function flushBuffered(callback) {
      const data = Buffer.concat(bufferedChunks, bufferedSize);
      bufferedChunks = [];
      bufferedSize = 0;
      return compressor ? compressor.write(data, callback) : originalWrite(data, callback);
    }

    const onNativeDrain = () => {
      // An input-drain notification is not evidence that the socket drained.
      if (!inputDrain && outputBlocked) {
        outputBlocked = false;
        compressor?.resume();
      }
    };
    nativeRes.on('drain', onNativeDrain);
    nativeRes.emit = function(event, ...args) {
      if (event === 'drain' && compressor && !inputDrain) {
        // Socket pressure and zlib input pressure are different queues. A
        // socket drain must resume output, not prematurely wake input writers
        // that received false from compressor.write().
        onNativeDrain();
        return true;
      }
      return originalEmit(event, ...args);
    };
    nativeRes.once('close', () => {
      nativeRes.removeListener('drain', onNativeDrain);
      bufferedChunks = [];
      bufferedSize = 0;
      // Cancels zlib work and settles pending write callbacks on disconnect.
      compressor?.destroy();
      const err = new Error('Response closed before completion');
      err.code = 'ERR_STREAM_PREMATURE_CLOSE';
      settleEnd(nativeRes.writableFinished ? undefined : err);
    });

    // Session failure can replace a body that has only been buffered. Never
    // retain earlier success chunks or a snapshot of authentication headers.
    res._discardBufferedBody = () => {
      if (nativeRes.headersSent) return;
      bufferedChunks = [];
      bufferedSize = 0;
      pendingWriteHead = null;
    };
    
    // Helper to check if we should compress
    function shouldCompress() {
      // Check if already encoded
      const contentEncoding = res.getHeader?.('Content-Encoding') || res.get?.('Content-Encoding');
      if (contentEncoding && contentEncoding !== 'identity') {
        return false;
      }
      
      // Apply custom filter first
      if (!config.filter(req, res)) {
        return false;
      }
      
      // For buffered content, check threshold
      // Note: We'll check the threshold separately when deciding to start compression
      
      return true;
    }
    
    // Helper to start compression
    function startCompression() {
      if (compressionStarted) return;
      compressionStarted = true;
      
      if (process.env.DEBUG_COMPRESSION) {
        console.log('startCompression called with encoding:', encoding);
      }
      
      // Create compressor
      compressor = createCompressor(encoding, config);
      
      commitHeaders(true);
      
      if (process.env.DEBUG_COMPRESSION) {
        console.log('Headers set, Content-Encoding:', res.getHeader ? res.getHeader('Content-Encoding') : 'N/A');
      }
      
      // Now set up event handlers after headers are sent
      compressor.on('data', (chunk) => {
        if (nativeRes.destroyed) { compressor.destroy(); return; }
        if (!originalWrite(chunk)) {
          outputBlocked = true;
          compressor.pause();
        }
      });

      // pipe(res) and callback-driven producers observe the native response's
      // events. Bridge zlib's writable-side pressure without mistaking it for
      // a socket-drain event and prematurely resuming compressed output.
      compressor.on('drain', () => {
        inputDrain = true;
        try { nativeRes.emit('drain'); } finally { inputDrain = false; }
      });
      
      compressor.on('end', () => {
        originalEnd(settleEnd);
      });
      
      compressor.on('error', () => {
        // Never gracefully complete a truncated compressed success entity.
        nativeRes.destroy();
      });
    }
    
    // Intercept native writes without replacing wrapper finalization.
    const writeFunction = function(chunk, encoding, callback) {
      if (typeof encoding === 'function') { callback = encoding; encoding = undefined; }
      if (callback != null && typeof callback !== 'function') throw new TypeError('Write callback must be a function');
      const buffer = bufferOf(chunk, encoding);
      res._isStreaming = true;
      res._bodyWriteCount = (res._bodyWriteCount || 0) + 1;
      if (nativeRes.destroyed || responseHandled) {
        const err = new Error('Response is no longer writable');
        err.code = 'ERR_STREAM_DESTROYED';
        if (callback) process.nextTick(callback, err);
        return false;
      }
      
      if (!compressionStarted) {
        if (buffer.length === 0) {
          if (callback) process.nextTick(callback);
          return true;
        }
        // Buffer the chunk
        // A completed callback permits producers to reuse their Buffer/view.
        // Own the accepted bytes before acknowledging a sub-threshold write.
        bufferedChunks.push(Buffer.from(buffer));
        bufferedSize += buffer.length;
        
        // Check if we have enough data to decide
        if (bufferedSize >= config.threshold) {
          if (shouldCompress()) {
            startCompression();
          } else {
            // Commit before identity bytes: implicit writeHead is intercepted.
            commitHeaders(false);
            compressionStarted = true;
          }
          return flushBuffered(callback);
        }
        // Before the threshold, acceptance into this bounded buffer completes
        // the write. Otherwise callback-driven small-chunk producers deadlock.
        if (callback) process.nextTick(callback);
        return true;
      }
      
      // If compression started, write to compressor or original
      if (compressor) {
        return compressor.write(buffer, callback);
      } else {
        return originalWrite(buffer, callback);
      }
    };
    
    // Override end
    const endFunction = function(chunk, encoding, callback) {
      if (typeof chunk === 'function') { callback = chunk; chunk = undefined; encoding = undefined; }
      else if (typeof encoding === 'function') { callback = encoding; encoding = undefined; }
      if (callback != null && typeof callback !== 'function') throw new TypeError('End callback must be a function');
      responseHandled = true;
      endCallback = callback;
      // Handle final chunk
      if (chunk !== undefined && chunk !== null && !compressionStarted) {
        const buffer = bufferOf(chunk, encoding);
        bufferedChunks.push(buffer);
        bufferedSize += buffer.length;
      }
      
      // Debug logging
      if (process.env.DEBUG_COMPRESSION) {
        console.log('endFunction called, bufferedSize:', bufferedSize, 'threshold:', config.threshold);
      }
      
      // Decide on compression if not yet started
      if (!compressionStarted) {
        const shouldCompressResult = shouldCompress();
        // Response.end correctly omits HEAD bytes before reaching transport.
        // Negotiate the equivalent GET representation using its known length.
        const meetsThreshold = bufferedSize >= config.threshold || (req.method === 'HEAD' &&
          Number(res.getHeader?.('Content-Length') || 0) >= config.threshold);
        
        if (process.env.DEBUG_COMPRESSION) {
          console.log('shouldCompress:', shouldCompressResult, 'meetsThreshold:', meetsThreshold);
        }
        
        if (shouldCompressResult && meetsThreshold) {
          if (process.env.DEBUG_COMPRESSION) {
            console.log('Starting compression...');
          }
          startCompression();
          if (process.env.DEBUG_COMPRESSION) {
            console.log('Calling compressor.end()');
          }
          // End the compressor now that all data has been written
          flushBuffered();
          compressor.end();
        } else {
          commitHeaders(false);
          // end(data) owns the final buffer and its native completion callback.
          const data = Buffer.concat(bufferedChunks, bufferedSize);
          bufferedChunks = [];
          bufferedSize = 0;
          originalEnd(data, settleEnd);
        }
      } else if (compressor) {
        // End the compressor
        compressor.end(chunk, encoding);
      } else {
        // No compression, just end normally
        originalEnd(chunk, encoding, settleEnd);
      }
      return nativeRes;
    };
    
    // Override writeHead to delay until we know if we're compressing
    const writeHeadFunction = function(statusCode, statusMessage, headers) {
      if (typeof statusMessage !== 'string') { headers = statusMessage; statusMessage = undefined; }
      if (responseHandled) {
        // Response already handled, pass through to original
        return statusMessage ? originalWriteHead(statusCode, statusMessage, headers) : originalWriteHead(statusCode, headers);
      }
      if (process.env.DEBUG_COMPRESSION) {
        console.log('writeHeadFunction called with:', statusCode, headers ? Object.keys(headers) : 'no headers');
      }
      // Store the writeHead call for later
      // Note: headers is the merged headers object from Response class
      // Make sure to preserve the headers object properly
      pendingWriteHead = { statusCode, statusMessage, headers: headers === res._headers ? null : Object.assign(Object.create(null), headers || {}) };
      nativeRes.statusCode = statusCode;
      // Don't actually send headers yet
      return nativeRes;
    };
    
    // Override native end to prevent double-ending
    const nativeEndFunction = function(chunk, encoding, callback) {
      if (responseHandled) {
        // Already handled, skip
        return nativeRes;
      }
      // Call our endFunction
      return endFunction.call(this, chunk, encoding, callback);
    };
    
    // Intercept transport only. Replacing Response.end would discard session's
    // persistence/revocation barrier when compression is registered afterwards.
    // The wrapper continues to supply its actual status and current headers.
    nativeRes.write = writeFunction;
    nativeRes.writeHead = writeHeadFunction;
    nativeRes.end = nativeEndFunction;
    if (originalFlushHeaders) nativeRes.flushHeaders = function() {
      if (!compressionStarted) {
        if (shouldCompress()) startCompression();
        else { commitHeaders(false); compressionStarted = true; }
        if (bufferedSize) flushBuffered();
      }
      return originalFlushHeaders();
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
