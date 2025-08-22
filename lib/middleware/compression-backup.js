/**
 * Compression Middleware for Velocy Framework
 * 
 * A high-performance compression middleware that supports gzip, deflate, and brotli
 * compression algorithms using only Node.js built-in modules.
 * 
 * Features:
 * - Support for gzip, deflate, and brotli compression
 * - Content negotiation via Accept-Encoding header
 * - Configurable compression levels and thresholds
 * - Smart content-type filtering
 * - Compression statistics tracking
 * - Stream-based compression for efficient memory usage
 * 
 * @module compression
 */

const zlib = require('node:zlib');
const { Transform, pipeline } = require('node:stream');
const { promisify } = require('node:util');

/**
 * Custom error class for compression errors
 */
class CompressionError extends Error {
  constructor(message, statusCode = 500, code = 'COMPRESSION_ERROR') {
    super(message);
    this.name = 'CompressionError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

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
 * Compression wrapper stream that tracks statistics
 * @private
 */
class CompressionStream extends Transform {
  constructor(compressor, encoding) {
    super();
    this.compressor = compressor;
    this.encoding = encoding;
    this.inputSize = 0;
    this.outputSize = 0;
    this.startTime = Date.now();
    this.ended = false;
    
    // Pipe through the compressor
    this.compressor.on('data', (chunk) => {
      this.outputSize += chunk.length;
      this.push(chunk);
    });
    
    this.compressor.on('end', () => {
      if (!this.ended) {
        this.ended = true;
        this.push(null);
      }
    });
    
    this.compressor.on('error', (err) => {
      this.destroy(err);
    });
  }
  
  _transform(chunk, encoding, callback) {
    this.inputSize += chunk.length;
    this.compressor.write(chunk, encoding, callback);
  }
  
  _flush(callback) {
    if (this.ended) {
      callback();
      return;
    }
    this.compressor.end(() => {
      this.compressionTime = Date.now() - this.startTime;
      this.compressionRatio = this.inputSize > 0 
        ? (1 - this.outputSize / this.inputSize) 
        : 0;
      callback();
    });
  }
  
  getStats() {
    return {
      encoding: this.encoding,
      inputSize: this.inputSize,
      outputSize: this.outputSize,
      compressionRatio: this.compressionRatio || 0,
      compressionTime: this.compressionTime || (Date.now() - this.startTime),
      saved: this.inputSize - this.outputSize
    };
  }
}

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
        throw new CompressionError('Brotli compression not supported in this Node.js version');
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
      throw new CompressionError(`Unsupported encoding: ${encoding}`);
  }
}

/**
 * Wrap response object to intercept writes and apply compression
 * @private
 */
function wrapResponse(req, res, compressionEncoding, options, stats) {
  const originalWrite = res.write.bind(res);
  const originalEnd = res.end.bind(res);
  const originalWriteHead = res.writeHead.bind(res);
  
  let compressor = null;
  let compressionStream = null;
  let isCompressing = false;
  let headersSent = false;
  let chunks = [];
  let totalSize = 0;
  let compressionDecided = false;
  
  // Helper to decide on compression
  function shouldCompress() {
    if (compressionDecided) return isCompressing;
    
    const contentType = res.getHeader('Content-Type') || res.get('Content-Type');
    const contentLength = parseInt(res.getHeader('Content-Length') || res.get('Content-Length') || '0');
    const contentEncoding = res.getHeader('Content-Encoding') || res.get('Content-Encoding');
    
    // Skip if already encoded
    if (contentEncoding && contentEncoding !== 'identity') {
      compressionDecided = true;
      isCompressing = false;
      return false;
    }
    
    // Check content type filter
    if (options.filter && !options.filter(req, res)) {
      compressionDecided = true;
      isCompressing = false;
      return false;
    }
    
    // Check if content type is compressible
    if (!isCompressible(contentType)) {
      compressionDecided = true;
      isCompressing = false;
      return false;
    }
    
    // Skip if below threshold and we know the size
    if (contentLength > 0 && contentLength < options.threshold) {
      compressionDecided = true;
      isCompressing = false;
      return false;
    }
    
    compressionDecided = true;
    isCompressing = true;
    return true;
  }
  
  // Override writeHead to set compression headers
  res.writeHead = function(statusCode, headers) {
    if (headersSent) return originalWriteHead(statusCode, headers);
    
    // Don't compress certain status codes
    if (statusCode === 204 || statusCode === 304) {
      compressionDecided = true;
      isCompressing = false;
      return originalWriteHead(statusCode, headers);
    }
    
    // Decide on compression if not yet decided
    if (!compressionDecided && shouldCompress()) {
      res.setHeader('Content-Encoding', compressionEncoding);
      res.setHeader('Vary', 'Accept-Encoding');
      res.removeHeader('Content-Length');  // Can't know compressed size in advance
    }
    
    headersSent = true;
    return originalWriteHead(statusCode, headers);
  };
  
  // Override write to compress chunks
  res.write = function(chunk, encoding) {
    // Buffer chunks if headers haven't been sent yet
    if (!headersSent && !compressionDecided) {
      if (chunk) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding || 'utf8');
        chunks.push(buffer);
        totalSize += buffer.length;
      }
      return true;
    }
    
    // Decide on compression if not yet decided
    if (!compressionDecided) {
      shouldCompress();
    }
    
    if (!isCompressing) {
      // Write any buffered chunks first
      for (const bufferedChunk of chunks) {
        originalWrite(bufferedChunk);
      }
      chunks = [];
      return originalWrite(chunk, encoding);
    }
    
    // Initialize compression on first write
    if (!compressor) {
      try {
        compressor = createCompressor(compressionEncoding, options);
        compressionStream = new CompressionStream(compressor, compressionEncoding);
        
        // Pipe compression stream to response
        compressionStream.on('data', (data) => {
          originalWrite(data);
        });
        
        compressionStream.on('end', () => {
          // Compression stream ended
        });
        
        compressionStream.on('error', (err) => {
          // Fall back to uncompressed on error
          if (!headersSent) {
            res.removeHeader('Content-Encoding');
            isCompressing = false;
            for (const bufferedChunk of chunks) {
              originalWrite(bufferedChunk);
            }
            chunks = [];
            if (chunk) originalWrite(chunk, encoding);
          }
        });
        
        // Set compression headers if not sent
        if (!headersSent) {
          res.setHeader('Content-Encoding', compressionEncoding);
          res.setHeader('Vary', 'Accept-Encoding');
          res.removeHeader('Content-Length');
        }
        
        // Write any buffered chunks
        for (const bufferedChunk of chunks) {
          compressionStream.write(bufferedChunk);
        }
        chunks = [];
      } catch (err) {
        // Fall back to uncompressed response on error
        isCompressing = false;
        for (const bufferedChunk of chunks) {
          originalWrite(bufferedChunk);
        }
        chunks = [];
        return originalWrite(chunk, encoding);
      }
    }
    
    // Write to compression stream
    if (chunk) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding || 'utf8');
      return compressionStream.write(buffer);
    }
    
    return true;
  };
  
  // Override end to finish compression
  res.end = function(chunk, encoding) {
    // Add final chunk to buffer if provided
    if (chunk && !compressionDecided) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding || 'utf8');
      chunks.push(buffer);
      totalSize += buffer.length;
    }
    
    // Decide on compression if not yet decided
    if (!compressionDecided) {
      // Check if total size is below threshold
      if (totalSize < options.threshold) {
        compressionDecided = true;
        isCompressing = false;
      } else {
        shouldCompress();
      }
    }
    
    // If not compressing, send buffered data and end
    if (!isCompressing) {
      for (const bufferedChunk of chunks) {
        originalWrite(bufferedChunk);
      }
      chunks = [];
      if (chunk && headersSent) {
        originalWrite(chunk, encoding);
        return originalEnd();
      }
      return originalEnd(chunk, encoding);
    }
    
    // Initialize compressor if needed
    if (!compressor && isCompressing) {
      try {
        compressor = createCompressor(compressionEncoding, options);
        compressionStream = new CompressionStream(compressor, compressionEncoding);
        
        // Set compression headers
        res.setHeader('Content-Encoding', compressionEncoding);
        res.setHeader('Vary', 'Accept-Encoding');
        res.removeHeader('Content-Length');
        
        // Pipe compression stream to response
        compressionStream.on('data', (data) => {
          originalWrite(data);
        });
        
        compressionStream.on('finish', () => {
          // Store statistics
          if (stats) {
            const compressionStats = compressionStream.getStats();
            Object.assign(stats, compressionStats);
            
            // Attach to request for access
            if (req) {
              req.compressionStats = compressionStats;
            }
          }
          
          // Wait for compressor to flush all data
          setImmediate(() => {
            originalEnd();
          });
        });
        
        compressionStream.on('error', (err) => {
          // Fall back to uncompressed on error
          originalEnd();
        });
        
        // Write buffered chunks
        for (const bufferedChunk of chunks) {
          compressionStream.write(bufferedChunk);
        }
        chunks = [];
      } catch (err) {
        // Fall back to uncompressed
        isCompressing = false;
        for (const bufferedChunk of chunks) {
          originalWrite(bufferedChunk);
        }
        chunks = [];
        return originalEnd(chunk, encoding);
      }
    }
    
    // Write final chunk and end compression
    if (compressionStream) {
      if (chunk) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding || 'utf8');
        compressionStream.write(buffer);
      }
      compressionStream.end();
    } else {
      // Compressor not initialized yet, write everything now
      res.write('');  // Trigger compressor initialization
      if (chunk) {
        res.write(chunk, encoding);
      }
      return res.end();
    }
  };
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
    
    // Create stats object
    const stats = {};
    
    // Wrap response
    try {
      wrapResponse(req, res, encoding, config, stats);
    } catch (err) {
      // Pass error to next middleware on compression wrap failure
      return next ? next(err) : undefined;
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