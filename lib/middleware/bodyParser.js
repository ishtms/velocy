/**
 * Body Parser Middleware for Velocy Framework
 * 
 * A comprehensive body parsing middleware that handles JSON, URL-encoded,
 * multipart form data, and raw body parsing using only Node.js built-in modules.
 * 
 * @module bodyParser
 */

const { Transform, Writable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const querystring = require('node:querystring');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { StringDecoder } = require('node:string_decoder');

/**
 * Custom error class for body parsing errors
 */
class BodyParserError extends Error {
  constructor(message, statusCode = 400, code = 'BODY_PARSER_ERROR') {
    super(message);
    this.name = 'BodyParserError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

/**
 * Parses size strings like '100kb', '10mb' to bytes
 * @private
 */
function parseSize(size) {
  if (typeof size === 'number') return size;
  if (typeof size !== 'string') return 100 * 1024; // Default 100kb
  
  const match = size.match(/^(\d+(?:\.\d+)?)\s*([kmg]?)b?$/i);
  if (!match) return 100 * 1024;
  
  const num = parseFloat(match[1]);
  const unit = match[2].toLowerCase();
  
  const multipliers = {
    '': 1,
    'k': 1024,
    'm': 1024 * 1024,
    'g': 1024 * 1024 * 1024
  };
  
  return Math.floor(num * multipliers[unit]);
}

/**
 * Extracts charset from Content-Type header
 * @private
 */
function getCharset(contentType) {
  const match = contentType.match(/charset=([^;,\s]+)/i);
  if (!match) return 'utf-8';
  
  let charset = match[1].toLowerCase();
  if (charset.startsWith('"') && charset.endsWith('"')) {
    charset = charset.slice(1, -1);
  }
  
  // Map common aliases
  const aliases = {
    'utf8': 'utf-8',
    'iso88591': 'iso-8859-1',
    'iso_8859_1': 'iso-8859-1',
    'latin1': 'iso-8859-1'
  };
  
  return aliases[charset] || charset;
}

/**
 * Creates a transform stream that limits the size of data passing through
 * @private
 */
class SizeLimiter extends Transform {
  constructor(limit) {
    super();
    this.limit = limit;
    this.received = 0;
  }
  
  _transform(chunk, encoding, callback) {
    this.received += chunk.length;
    if (this.received > this.limit) {
      callback(new BodyParserError(
        `Request body too large. Limit is ${this.limit} bytes`,
        413,
        'LIMIT_FILE_SIZE'
      ));
    } else {
      callback(null, chunk);
    }
  }
}

/**
 * Collects stream data into a buffer
 * @private
 */
async function collectStream(stream, limit) {
  const chunks = [];
  let size = 0;
  
  return new Promise((resolve, reject) => {
    let limitExceeded = false;
    let error = null;
    
    stream.on('data', (chunk) => {
      size += chunk.length;
      
      if (size > limit && !limitExceeded) {
        limitExceeded = true;
        error = new BodyParserError(
          `Body size exceeds limit of ${limit} bytes`,
          413,
          'LIMIT_FILE_SIZE'
        );
        // Continue consuming the stream but don't store chunks
        return;
      }
      
      if (!limitExceeded) {
        chunks.push(chunk);
      }
      // If limit exceeded, we still consume the data but don't store it
    });
    
    stream.on('end', () => {
      if (error) {
        reject(error);
      } else {
        resolve(Buffer.concat(chunks));
      }
    });
    
    stream.on('error', reject);
  });
}

/**
 * JSON body parser
 * @private
 */
async function parseJSON(req, options) {
  const charset = getCharset(req.headers['content-type'] || '');
  const decoder = new StringDecoder(charset);
  
  const buffer = await collectStream(req.nativeRequest, options.limit);
  const str = decoder.write(buffer) + decoder.end();
  
  if (str.length === 0) {
    return null;
  }
  
  try {
    return JSON.parse(str);
  } catch (err) {
    throw new BodyParserError(
      `Invalid JSON: ${err.message}`,
      400,
      'INVALID_JSON'
    );
  }
}

/**
 * URL-encoded form parser with extended mode support
 * @private
 */
async function parseURLEncoded(req, options) {
  const charset = getCharset(req.headers['content-type'] || '');
  const decoder = new StringDecoder(charset);
  
  const buffer = await collectStream(req.nativeRequest, options.limit);
  const str = decoder.write(buffer) + decoder.end();
  
  if (str.length === 0) {
    return {};
  }
  
  if (options.extended) {
    // Use custom parser for extended mode (nested objects/arrays)
    return parseExtendedURLEncoded(str, options);
  } else {
    // Use built-in querystring for simple mode
    return querystring.parse(str, options.parameterLimit);
  }
}

/**
 * Extended URL-encoded parser that supports nested objects and arrays
 * @private
 */
function parseExtendedURLEncoded(str, options) {
  const result = Object.create(null);
  const pairs = str.split('&').slice(0, options.parameterLimit || 1000);
  
  for (const pair of pairs) {
    if (!pair) continue;
    
    const eqIndex = pair.indexOf('=');
    let key, value;
    
    if (eqIndex === -1) {
      key = decodeURIComponent(pair.replace(/\+/g, ' '));
      value = '';
    } else {
      key = decodeURIComponent(pair.substring(0, eqIndex).replace(/\+/g, ' '));
      value = decodeURIComponent(pair.substring(eqIndex + 1).replace(/\+/g, ' '));
    }
    
    // Parse nested keys (e.g., user[name], items[0], deep[nested][key])
    setNestedValue(result, key, value);
  }
  
  return result;
}

/**
 * Sets a nested value in an object based on bracket notation
 * @private
 */
function setNestedValue(obj, key, value) {
  // Parse bracket notation
  const matches = key.match(/^([^\[]+)((?:\[[^\]]*\])*)/);
  if (!matches) {
    obj[key] = value;
    return;
  }
  
  const baseKey = matches[1];
  const brackets = matches[2];
  
  if (!brackets) {
    // Simple key
    if (baseKey in obj) {
      if (!Array.isArray(obj[baseKey])) {
        obj[baseKey] = [obj[baseKey]];
      }
      obj[baseKey].push(value);
    } else {
      obj[baseKey] = value;
    }
    return;
  }
  
  // Parse all bracket segments
  const segments = [];
  let match;
  const regex = /\[([^\]]*)\]/g;
  while ((match = regex.exec(brackets)) !== null) {
    segments.push(match[1]);
  }
  
  // Build nested structure
  let current = obj;
  const fullPath = [baseKey, ...segments];
  
  for (let i = 0; i < fullPath.length - 1; i++) {
    const segment = fullPath[i];
    const nextSegment = fullPath[i + 1];
    
    // Determine if next level should be array or object
    const isNextArray = nextSegment === '' || /^\d+$/.test(nextSegment);
    
    if (!(segment in current)) {
      current[segment] = isNextArray ? [] : Object.create(null);
    } else if (typeof current[segment] !== 'object') {
      current[segment] = isNextArray ? [] : Object.create(null);
    }
    
    current = current[segment];
  }
  
  // Set the final value
  const lastSegment = fullPath[fullPath.length - 1];
  if (lastSegment === '') {
    // Array push notation
    if (Array.isArray(current)) {
      current.push(value);
    }
  } else {
    current[lastSegment] = value;
  }
}

/**
 * Multipart form data parser
 * @private
 */
async function parseMultipart(req, options) {
  const contentType = req.headers['content-type'] || '';
  const boundaryMatch = contentType.match(/boundary=([^;,\s]+)/);
  
  if (!boundaryMatch) {
    throw new BodyParserError(
      'Missing boundary in multipart form data',
      400,
      'MISSING_BOUNDARY'
    );
  }
  
  let boundary = boundaryMatch[1];
  if (boundary.startsWith('"') && boundary.endsWith('"')) {
    boundary = boundary.slice(1, -1);
  }
  
  const parser = new MultipartParser(boundary, options);
  const result = await parser.parse(req.nativeRequest);
  
  return result;
}

/**
 * Multipart parser implementation
 * @private
 */
class MultipartParser {
  constructor(boundary, options) {
    this.boundary = `--${boundary}`;
    this.closingBoundary = `--${boundary}--`;
    this.options = options;
    this.parts = [];
    this.fields = Object.create(null);
    this.files = Object.create(null);
    this.tempFiles = [];
  }
  
  async parse(stream) {
    const chunks = [];
    let size = 0;
    
    // Collect the entire stream first
    for await (const chunk of stream) {
      size += chunk.length;
      if (size > this.options.limit) {
        this.cleanup();
        throw new BodyParserError(
          `Multipart body too large. Limit is ${this.options.limit} bytes`,
          413,
          'LIMIT_FILE_SIZE'
        );
      }
      chunks.push(chunk);
    }
    
    const buffer = Buffer.concat(chunks);
    await this.parseBuffer(buffer);
    
    // Combine fields and files
    const result = Object.create(null);
    Object.assign(result, this.fields);
    
    // Add files to result
    for (const [fieldName, files] of Object.entries(this.files)) {
      if (Array.isArray(files) && files.length === 1) {
        result[fieldName] = files[0];
      } else {
        result[fieldName] = files;
      }
    }
    
    return result;
  }
  
  async parseBuffer(buffer) {
    const boundaryBuffer = Buffer.from(this.boundary);
    const closingBuffer = Buffer.from(this.closingBoundary);
    const parts = [];
    let start = 0;
    
    // Find all parts
    for (let i = 0; i <= buffer.length - boundaryBuffer.length; i++) {
      if (buffer.slice(i, i + boundaryBuffer.length).equals(boundaryBuffer)) {
        if (start > 0) {
          // Extract part between boundaries
          const part = buffer.slice(start, i - 2); // -2 for \r\n before boundary
          if (part.length > 0) {
            parts.push(part);
          }
        }
        
        // Check if this is the closing boundary
        if (buffer.slice(i, i + closingBuffer.length).equals(closingBuffer)) {
          break;
        }
        
        // Move past boundary and CRLF
        start = i + boundaryBuffer.length + 2; // +2 for \r\n after boundary
      }
    }
    
    // Parse each part
    for (const part of parts) {
      await this.parsePart(part);
    }
  }
  
  async parsePart(buffer) {
    // Find headers end
    const headerEnd = buffer.indexOf(Buffer.from('\r\n\r\n'));
    if (headerEnd === -1) return;
    
    const headerBuffer = buffer.slice(0, headerEnd);
    const headers = this.parseHeaders(headerBuffer.toString());
    const content = buffer.slice(headerEnd + 4); // +4 for \r\n\r\n
    
    // Extract field name and filename from Content-Disposition
    const disposition = headers['content-disposition'] || '';
    const nameMatch = disposition.match(/name="([^"]+)"/);
    if (!nameMatch) return;
    
    const fieldName = nameMatch[1];
    const filenameMatch = disposition.match(/filename="([^"]+)"/);
    
    if (filenameMatch) {
      // It's a file
      await this.handleFile(fieldName, filenameMatch[1], content, headers);
    } else {
      // It's a regular field
      this.handleField(fieldName, content.toString());
    }
  }
  
  parseHeaders(headerString) {
    const headers = Object.create(null);
    const lines = headerString.split('\r\n');
    
    for (const line of lines) {
      const colonIndex = line.indexOf(':');
      if (colonIndex === -1) continue;
      
      const name = line.substring(0, colonIndex).trim().toLowerCase();
      const value = line.substring(colonIndex + 1).trim();
      headers[name] = value;
    }
    
    return headers;
  }
  
  handleField(name, value) {
    if (name in this.fields) {
      if (!Array.isArray(this.fields[name])) {
        this.fields[name] = [this.fields[name]];
      }
      this.fields[name].push(value);
    } else {
      this.fields[name] = value;
    }
  }
  
  async handleFile(fieldName, filename, content, headers) {
    const mimetype = headers['content-type'] || 'application/octet-stream';
    
    // Check file size limit
    if (this.options.maxFileSize && content.length > this.options.maxFileSize) {
      throw new BodyParserError(
        `File size exceeds limit of ${this.options.maxFileSize} bytes`,
        413,
        'LIMIT_FILE_SIZE'
      );
    }
    
    // Check allowed types
    if (this.options.allowedTypes && this.options.allowedTypes.length > 0) {
      if (!this.options.allowedTypes.includes(mimetype)) {
        throw new BodyParserError(
          `File type ${mimetype} is not allowed`,
          415,
          'UNSUPPORTED_MEDIA_TYPE'
        );
      }
    }
    
    // Check max files limit
    const totalFiles = Object.values(this.files).reduce((count, files) => count + files.length, 0);
    if (this.options.maxFiles && totalFiles >= this.options.maxFiles) {
      throw new BodyParserError(
        `Maximum number of files (${this.options.maxFiles}) exceeded`,
        413,
        'LIMIT_FILE_COUNT'
      );
    }
    
    // Check empty files
    if (this.options.allowEmptyFiles === false && content.length === 0) {
      throw new BodyParserError(
        'Empty files are not allowed',
        400,
        'EMPTY_FILE'
      );
    }
    
    // Generate filename
    let newFilename = filename;
    if (this.options.filename && typeof this.options.filename === 'function') {
      const ext = path.extname(filename);
      const name = path.basename(filename, ext);
      newFilename = this.options.filename(name, ext, null, null);
    } else if (this.options.keepExtensions) {
      const ext = path.extname(filename);
      newFilename = `upload_${crypto.randomBytes(16).toString('hex')}${ext}`;
    } else {
      newFilename = `upload_${crypto.randomBytes(16).toString('hex')}`;
    }
    
    const file = {
      fieldName,
      originalFilename: filename,
      filename,
      newFilename,  // Add newFilename property
      mimetype,
      size: content.length
    };
    
    // Determine upload directory
    const uploadDir = this.options.uploadDir || this.options.tempDirectory;
    
    if (content.length > this.options.fileMemoryLimit) {
      // Write to temp file
      const tempPath = path.join(uploadDir, newFilename);
      
      await fs.promises.writeFile(tempPath, content);
      this.tempFiles.push(tempPath);
      
      file.path = tempPath;
      file.filepath = tempPath;  // Add filepath for compatibility
      file.inMemory = false;
    } else {
      // Keep in memory
      file.buffer = content;
      file.inMemory = true;
    }
    
    // Add to files collection
    if (!(fieldName in this.files)) {
      this.files[fieldName] = [];
    }
    this.files[fieldName].push(file);
  }
  
  cleanup() {
    // Clean up temporary files
    for (const tempFile of this.tempFiles) {
      fs.unlink(tempFile, () => {
        // Ignore errors during cleanup
      });
    }
    this.tempFiles = [];
  }
}

/**
 * Raw body parser
 * @private
 */
async function parseRaw(req, options) {
  const buffer = await collectStream(req.nativeRequest, options.limit);
  
  if (options.type === 'buffer') {
    return buffer;
  }
  
  const charset = getCharset(req.headers['content-type'] || '');
  const decoder = new StringDecoder(charset);
  return decoder.write(buffer) + decoder.end();
}

/**
 * Creates body parser middleware with configuration options
 * 
 * @param {Object} options - Configuration options
 * @param {Boolean} options.json - Enable JSON parsing (default: true)
 * @param {String|Number} options.jsonLimit - Size limit for JSON bodies (default: '100kb')
 * @param {Boolean} options.urlencoded - Enable URL-encoded parsing (default: true)
 * @param {String|Number} options.urlencodedLimit - Size limit for URL-encoded bodies (default: '100kb')
 * @param {Boolean} options.extended - Enable extended URL-encoded parsing (default: true)
 * @param {Number} options.parameterLimit - Max number of parameters (default: 1000)
 * @param {Boolean} options.multipart - Enable multipart parsing (default: true)
 * @param {String|Number} options.multipartLimit - Size limit for multipart bodies (default: '10mb')
 * @param {String|Number} options.fileMemoryLimit - Max file size to keep in memory (default: '1mb')
 * @param {String} options.tempDirectory - Directory for temp files (default: os.tmpdir())
 * @param {Boolean} options.raw - Enable raw body parsing (default: false)
 * @param {String|Number} options.rawLimit - Size limit for raw bodies (default: '100kb')
 * @param {String} options.rawType - Raw body type: 'buffer' or 'string' (default: 'string')
 * @param {Boolean} options.preserveRawBody - Store raw body in req.rawBody (default: false)
 * @param {Boolean} options.cache - Cache parsed body to avoid re-parsing (default: true)
 * @param {Function} options.verify - Optional verification function (req, res, buf, encoding)
 * @returns {Function} Express-style middleware function
 */
function bodyParser(options = {}) {
  // Default configuration - parse size limits first
  const config = {
    json: options.json !== false,
    jsonLimit: parseSize(options.jsonLimit || options.limit || '100kb'),
    urlencoded: options.urlencoded !== false,
    urlencodedLimit: parseSize(options.urlencodedLimit || options.limit || '100kb'),
    extended: options.extended !== false,
    parameterLimit: options.parameterLimit || 1000,
    multipart: options.multipart !== false,
    multipartLimit: parseSize(options.multipartLimit || options.limit || '10mb'),
    fileMemoryLimit: parseSize(options.fileMemoryLimit || '1mb'),
    tempDirectory: options.tempDirectory || os.tmpdir(),
    maxFileSize: options.maxFileSize ? parseSize(options.maxFileSize) : undefined,
    allowedTypes: options.allowedTypes,
    filename: options.filename,
    keepExtensions: options.keepExtensions,
    uploadDir: options.uploadDir,
    maxFiles: options.maxFiles,
    allowEmptyFiles: options.allowEmptyFiles,
    raw: options.raw || false,
    rawLimit: parseSize(options.rawLimit || options.limit || '100kb'),
    rawType: options.rawType || 'string',
    preserveRawBody: options.preserveRawBody || false,
    cache: options.cache !== false,
    verify: options.verify
  };
  
  // Validate configuration
  if (config.rawType && !['buffer', 'string'].includes(config.rawType)) {
    throw new Error('Invalid rawType. Must be "buffer" or "string"');
  }
  
  /**
   * Middleware function
   */
  return async function bodyParserMiddleware(req, res, next) {
    // Skip if body is already parsed and caching is enabled
    if (config.cache && req._bodyParsed) {
      return next ? next() : undefined;
    }
    
    // Skip if no content
    const contentLength = parseInt(req.headers['content-length'] || '0', 10);
    if (contentLength === 0 && req.method !== 'POST' && req.method !== 'PUT' && req.method !== 'PATCH') {
      return next ? next() : undefined;
    }
    
    // Get content type
    const contentType = req.headers['content-type'] || '';
    const type = contentType.split(';')[0].trim().toLowerCase();
    
    try {
      let body = null;
      let rawBody = null;
      
      // Store original body parsing method if needed
      const originalBodyGetter = Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(req),
        'body'
      );
      
      // Determine parser based on content type
      if (config.json && type === 'application/json') {
        if (config.preserveRawBody) {
          rawBody = await collectStream(req.nativeRequest, config.jsonLimit);
          
          // Verify if provided
          if (config.verify) {
            await config.verify(req, res, rawBody, 'utf-8');
          }
          
          // Parse from buffer
          const charset = getCharset(contentType);
          const decoder = new StringDecoder(charset);
          const str = decoder.write(rawBody) + decoder.end();
          
          if (str.length > 0) {
            try {
              body = JSON.parse(str);
            } catch (err) {
              throw new BodyParserError(
                `Invalid JSON: ${err.message}`,
                400,
                'INVALID_JSON'
              );
            }
          } else {
            body = null;
          }
        } else {
          body = await parseJSON(req, { limit: config.jsonLimit });
        }
      } else if (config.urlencoded && type === 'application/x-www-form-urlencoded') {
        if (config.preserveRawBody) {
          rawBody = await collectStream(req.nativeRequest, config.urlencodedLimit);
          
          // Verify if provided
          if (config.verify) {
            await config.verify(req, res, rawBody, 'utf-8');
          }
          
          // Parse from buffer
          const charset = getCharset(contentType);
          const decoder = new StringDecoder(charset);
          const str = decoder.write(rawBody) + decoder.end();
          
          if (str.length > 0) {
            if (config.extended) {
              body = parseExtendedURLEncoded(str, config);
            } else {
              body = querystring.parse(str, config.parameterLimit);
            }
          } else {
            body = {};
          }
        } else {
          body = await parseURLEncoded(req, {
            limit: config.urlencodedLimit,
            extended: config.extended,
            parameterLimit: config.parameterLimit
          });
        }
      } else if (config.multipart && type === 'multipart/form-data') {
        const parsed = await parseMultipart(req, {
          limit: config.multipartLimit,
          fileMemoryLimit: config.fileMemoryLimit,
          tempDirectory: config.tempDirectory,
          maxFileSize: config.maxFileSize,
          allowedTypes: config.allowedTypes,
          filename: config.filename,
          keepExtensions: config.keepExtensions,
          uploadDir: config.uploadDir,
          maxFiles: config.maxFiles,
          allowEmptyFiles: config.allowEmptyFiles
        });
        
        // Separate files from fields
        const fields = {};
        const files = {};
        
        for (const [key, value] of Object.entries(parsed)) {
          if (value && typeof value === 'object' && value.originalFilename !== undefined) {
            // It's a file
            files[key] = value;
          } else if (Array.isArray(value)) {
            // Check if it's an array of files
            const isFileArray = value.every(v => v && typeof v === 'object' && v.originalFilename !== undefined);
            if (isFileArray) {
              files[key] = value;
            } else {
              fields[key] = value;
            }
          } else {
            // It's a field
            fields[key] = value;
          }
        }
        
        body = fields;
        
        // Set files on request
        if (Object.keys(files).length > 0) {
          req.files = files;
        }
        
        if (config.preserveRawBody) {
          // For multipart, we can't easily preserve raw body
          // as it's already been consumed
          rawBody = Buffer.from('multipart data - raw body not preserved');
        }
      } else if (config.raw) {
        body = await parseRaw(req, {
          limit: config.rawLimit,
          type: config.rawType
        });
        
        if (config.preserveRawBody) {
          rawBody = config.rawType === 'buffer' ? body : Buffer.from(body);
        }
      }
      
      // Set parsed body on request
      if (body !== null) {
        // Override the body getter to return parsed body directly (not as a Promise)
        Object.defineProperty(req, 'body', {
          value: body,
          writable: true,
          enumerable: true,
          configurable: true
        });
        
        // Mark as parsed for caching
        if (config.cache) {
          req._bodyParsed = true;
        }
      }
      
      // Set raw body if preserving
      if (config.preserveRawBody && rawBody) {
        req.rawBody = rawBody;
      }
      
      // Continue to next middleware
      if (next) {
        next();
      }
    } catch (error) {
      // Handle parsing errors
      if (error instanceof BodyParserError) {
        if (next) {
          next(error);
        } else {
          res.status(error.statusCode).json({
            error: error.message,
            code: error.code
          });
        }
      } else {
        // Unknown error
        const err = new BodyParserError(
          'Failed to parse request body',
          400,
          'PARSE_ERROR'
        );
        if (next) {
          next(err);
        } else {
          res.status(400).json({
            error: err.message,
            code: err.code
          });
        }
      }
    }
  };
}

/**
 * Preset configurations
 */

/**
 * JSON-only body parser
 */
bodyParser.json = function(options = {}) {
  return bodyParser({
    json: true,
    urlencoded: false,
    multipart: false,
    raw: false,
    jsonLimit: options.limit || options.jsonLimit,
    ...options
  });
};

/**
 * URL-encoded only body parser
 */
bodyParser.urlencoded = function(options = {}) {
  return bodyParser({
    ...options,
    json: false,
    urlencoded: true,
    multipart: false,
    raw: false
  });
};

/**
 * Multipart-only body parser
 */
bodyParser.multipart = function(options = {}) {
  // Pass through all multipart-specific options
  return bodyParser({
    ...options,
    json: false,
    urlencoded: false,
    multipart: true,
    raw: false,
    maxFileSize: options.maxFileSize,
    allowedTypes: options.allowedTypes,
    filename: options.filename,
    keepExtensions: options.keepExtensions,
    uploadDir: options.uploadDir,
    maxFiles: options.maxFiles,
    allowEmptyFiles: options.allowEmptyFiles
  });
};

/**
 * Raw body parser
 */
bodyParser.raw = function(options = {}) {
  return bodyParser({
    ...options,
    json: false,
    urlencoded: false,
    multipart: false,
    raw: true,
    rawType: 'buffer'  // Default to buffer for raw()
  });
};

/**
 * Text body parser (raw with string type)
 */
bodyParser.text = function(options = {}) {
  return bodyParser({
    ...options,
    json: false,
    urlencoded: false,
    multipart: false,
    raw: true,
    rawType: 'string'
  });
};

module.exports = bodyParser;