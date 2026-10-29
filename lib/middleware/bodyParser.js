/**
 * Body Parser Middleware for Velocy Framework
 * 
 * A comprehensive body parsing middleware that handles JSON, URL-encoded,
 * multipart form data, and raw body parsing using only Node.js built-in modules.
 * 
 * @module bodyParser
 */

const querystring = require('node:querystring');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { StringDecoder } = require('node:string_decoder');
const { constants: bufferConstants } = require('node:buffer');
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

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
  if (typeof size === 'number') {
    if (!Number.isSafeInteger(size) || size < 0 || size > bufferConstants.MAX_LENGTH) {
      throw new RangeError(`Body size limit must be an integer between 0 and ${bufferConstants.MAX_LENGTH}`);
    }
    return size;
  }
  if (typeof size !== 'string') {
    throw new TypeError('Body size limit must be a byte count or a size string');
  }
  
  const match = size.match(/^(\d+(?:\.\d+)?)\s*([kmg]?)b?$/i);
  if (!match) {
    throw new RangeError('Body size limit must use a supported byte, kb, mb, or gb value');
  }
  
  const num = parseFloat(match[1]);
  const unit = match[2].toLowerCase();
  
  const multipliers = {
    '': 1,
    'k': 1024,
    'm': 1024 * 1024,
    'g': 1024 * 1024 * 1024
  };
  
  const bytes = Math.floor(num * multipliers[unit]);
  if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > bufferConstants.MAX_LENGTH) {
    throw new RangeError(`Body size limit must be an integer between 0 and ${bufferConstants.MAX_LENGTH}`);
  }
  return bytes;
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
 * Collects stream data into a buffer
 * @private
 */
async function collectStream(stream, limit) {
  const chunks = [];
  let size = 0;

  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      chunks.length = 0;
      stream.removeListener('data', onData);
      reject(error);
    };
    const aborted = () => fail(new BodyParserError('Request body was aborted', 400, 'REQUEST_ABORTED'));
    const cleanup = () => {
      stream.removeListener('data', onData);
      stream.removeListener('end', onEnd);
      stream.removeListener('error', onError);
      stream.removeListener('aborted', aborted);
      stream.removeListener('close', onClose);
    };
    const onData = (chunk) => {
      if (settled) return;
      // Earlier middleware must not decode bytes before signature checks or byte accounting.
      if (!Buffer.isBuffer(chunk) && !(chunk instanceof Uint8Array)) {
        fail(new BodyParserError('Request body must be a byte stream', 400, 'INVALID_BODY_STREAM'));
        stream.resume();
        return;
      }
      size += chunk.length;
      if (size > limit) {
        // Reject promptly, but drain without retaining bytes so an HTTP error can be sent.
        fail(new BodyParserError(
          `Body size exceeds limit of ${limit} bytes`,
          413,
          'LIMIT_FILE_SIZE'
        ));
        stream.resume();
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = () => {
      cleanup();
      if (!settled) {
        settled = true;
        resolve(Buffer.concat(chunks));
      }
    };
    const onError = (error) => fail(error);
    const onClose = () => {
      if (!stream.readableEnded) aborted();
      cleanup();
    };
    stream.on('data', onData);
    stream.once('end', onEnd);
    stream.on('error', onError);
    stream.once('aborted', aborted);
    stream.once('close', onClose);
    if (stream.aborted || (stream.destroyed && !stream.readableEnded)) {
      aborted();
      // destroy(error) may still have a queued error/close event; retain its observer until close.
    } else if (stream.readableEnded) {
      fail(new BodyParserError('Request body was already consumed', 400, 'BODY_ALREADY_CONSUMED'));
      cleanup();
    }
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
  if (options.onBuffer) await options.onBuffer(buffer);
  const str = decoder.write(buffer) + decoder.end();
  
  if (str.length === 0) {
    return null;
  }
  
  try {
    return JSON.parse(str);
  } catch (cause) {
    const error = new BodyParserError('Invalid JSON', 400, 'INVALID_JSON');
    error.cause = cause;
    throw error;
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
  if (options.onBuffer) await options.onBuffer(buffer);
  const str = decoder.write(buffer) + decoder.end();
  
  if (str.length === 0) {
    return {};
  }
  
  if (options.extended) {
    // Use custom parser for extended mode (nested objects/arrays)
    return parseExtendedURLEncoded(str, options);
  } else {
    // Use built-in querystring for simple mode
    return parseSimpleURLEncoded(str, options.parameterLimit);
  }
}

function parseSimpleURLEncoded(str, parameterLimit) {
  // Node's second argument is a separator; resource limits belong in options.
  return querystring.parse(str, '&', '=', { maxKeys: parameterLimit });
}

/**
 * Extended URL-encoded parser that supports nested objects and arrays
 * @private
 */
function parseExtendedURLEncoded(str, options) {
  const result = Object.create(null);
  // split's limit is uint32, unlike the supported safe-integer configuration value.
  const pairs = str.split('&', Math.min(options.parameterLimit, 0xffffffff));
  
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
    setNestedValue(result, key, value, options);
  }
  
  return result;
}

/**
 * Sets a nested value in an object based on bracket notation
 * @private
 */
function setNestedValue(obj, key, value, options) {
  // Parse bracket notation
  const matches = key.match(/^([^\[\]]+)((?:\[[^\[\]]*\])*)$/);
  if (!matches) {
    throw new BodyParserError('Invalid form key syntax', 400, 'INVALID_FORM_KEY');
  }
  
  const baseKey = matches[1];
  const brackets = matches[2];
  const segments = [];
  for (const match of brackets.matchAll(/\[([^\]]*)\]/g)) {
    if (segments.length >= options.depthLimit) {
      throw new BodyParserError('Form nesting exceeds depth limit', 413, 'LIMIT_FORM_DEPTH');
    }
    segments.push(match[1]);
  }
  const fullPath = [baseKey, ...segments];
  // Arrays inherit mutable built-ins even when the containing object has no prototype.
  if (fullPath.some(segment => ['__proto__', 'prototype', 'constructor'].includes(segment))) {
    throw new BodyParserError('Unsafe form key', 400, 'INVALID_FORM_KEY');
  }
  for (const segment of segments) {
    if (/^\d+$/.test(segment) && (!Number.isSafeInteger(Number(segment)) || Number(segment) >= options.arrayLimit)) {
      throw new BodyParserError('Form array index exceeds limit', 413, 'LIMIT_ARRAY_SIZE');
    }
  }
  
  if (!brackets) {
    // Simple key
    if (hasOwn(obj, baseKey)) {
      if (!Array.isArray(obj[baseKey])) {
        obj[baseKey] = [obj[baseKey]];
      }
      if (obj[baseKey].length >= options.arrayLimit) {
        throw new BodyParserError('Form array exceeds limit', 413, 'LIMIT_ARRAY_SIZE');
      }
      obj[baseKey].push(value);
    } else {
      obj[baseKey] = value;
    }
    return;
  }
  
  // Build nested structure
  let current = obj;
  
  for (let i = 0; i < fullPath.length - 1; i++) {
    const segment = fullPath[i];
    const nextSegment = fullPath[i + 1];
    if (Array.isArray(current) && !/^\d+$/.test(segment)) {
      throw new BodyParserError('Invalid array form key', 400, 'INVALID_FORM_KEY');
    }
    
    // Determine if next level should be array or object
    const isNextArray = nextSegment === '' || /^\d+$/.test(nextSegment);
    
    if (!hasOwn(current, segment)) {
      current[segment] = isNextArray ? [] : Object.create(null);
    } else if (current[segment] === null || typeof current[segment] !== 'object') {
      current[segment] = isNextArray ? [] : Object.create(null);
    }
    
    current = current[segment];
  }
  
  // Set the final value
  const lastSegment = fullPath[fullPath.length - 1];
  if (Array.isArray(current) && lastSegment !== '' && !/^\d+$/.test(lastSegment)) {
    throw new BodyParserError('Invalid array form key', 400, 'INVALID_FORM_KEY');
  }
  if (lastSegment === '') {
    // Array push notation
    if (Array.isArray(current)) {
      if (current.length >= options.arrayLimit) {
        throw new BodyParserError('Form array exceeds limit', 413, 'LIMIT_ARRAY_SIZE');
      }
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
  const boundaryMatch = contentType.match(/;\s*boundary\s*=\s*(?:"([^"]*)"|([^;\s]+))\s*(?=;|$)/i);
  
  if (!boundaryMatch) {
    throw new BodyParserError(
      'Missing boundary in multipart form data',
      400,
      'MISSING_BOUNDARY'
    );
  }
  
  const boundary = boundaryMatch[1] ?? boundaryMatch[2];
  // RFC 2046 boundary grammar, including quoted internal spaces; never CR/LF or an empty value.
  if (!/^[0-9A-Za-z'()+_,\-./:=? ]{1,70}$/.test(boundary) || boundary.endsWith(' ')) {
    throw new BodyParserError('Invalid multipart boundary', 400, 'INVALID_BOUNDARY');
  }
  
  const parser = new MultipartParser(boundary, options);
  const result = await parser.parse(req.nativeRequest);
  
  return result;
}

function invalidDisposition() {
  return new BodyParserError('Invalid multipart disposition', 400, 'INVALID_MULTIPART');
}

function skipDispositionWhitespace(value, position) {
  while (value[position] === ' ' || value[position] === '\t') position++;
  return position;
}

function readDispositionValue(source, start) {
  if (source[start] !== '"') {
    const token = /[!#$%&'*+.^_`|~0-9A-Za-z{}-]+/y;
    token.lastIndex = start;
    const match = token.exec(source);
    if (!match) throw invalidDisposition();
    return { value: match[0], end: token.lastIndex };
  }
  let position = start + 1;
  let value = '';
  while (position < source.length) {
    let character = source[position++];
    if (character === '"') return { value, end: position };
    if (character === '\\') {
      if (position === source.length) throw invalidDisposition();
      character = source[position++];
    }
    const code = character.charCodeAt(0);
    if ((code < 32 && character !== '\t') || code === 127) throw invalidDisposition();
    value += character;
  }
  throw invalidDisposition();
}

function parseDisposition(source) {
  const initial = /^[ \t]*form-data[ \t]*(?=;|$)/i.exec(source);
  if (!initial) throw invalidDisposition();
  const parameters = Object.create(null);
  const parameter = /;[ \t]*([!#$%&'*+.^_`|~0-9A-Za-z{}-]+)[ \t]*=[ \t]*/y;
  let position = initial[0].length;
  while ((position = skipDispositionWhitespace(source, position)) < source.length) {
    parameter.lastIndex = position;
    const match = parameter.exec(source);
    if (!match) throw invalidDisposition();
    const name = match[1].toLowerCase();
    // Never downgrade malformed/ambiguous filenames to fields and thereby skip file policy.
    // RFC 7578 disallows filename*; continuations/extended name variants are unsupported too.
    if (hasOwn(parameters, name) || /^(?:filename|name)\*/.test(name)) throw invalidDisposition();
    const parsed = readDispositionValue(source, parameter.lastIndex);
    parameters[name] = parsed.value;
    position = parsed.end;
  }
  if (!hasOwn(parameters, 'name')) throw invalidDisposition();
  return parameters;
}

/**
 * Multipart parser implementation
 * @private
 */
class MultipartParser {
  constructor(boundary, options) {
    this.boundary = `--${boundary}`;
    this.options = options;
    this.fields = Object.create(null);
    this.files = Object.create(null);
    this.tempFiles = [];
    this.fieldCount = 0;
    this.fileCount = 0;
    this.cancelled = false;
  }
  
  async parse(stream) {
    const onAbort = () => { this.cancelled = true; };
    const onClose = () => { if (!stream.readableEnded) onAbort(); };
    stream.once('aborted', onAbort);
    stream.once('close', onClose);
    stream.on('error', onAbort);
    try {
      const buffer = await collectStream(stream, this.options.limit);
      if (this.options.onBuffer) await this.options.onBuffer(buffer);
      await this.parseBuffer(buffer);
      this.checkCancelled();
      // Keep namespaces separate: a field and a file may share a name.
      for (const [name, files] of Object.entries(this.files)) {
        if (files.length === 1) this.files[name] = files[0];
      }
      return { fields: this.fields, files: this.files };
    } catch (error) {
      try {
        await this.cleanup();
      } catch (cleanupError) {
        const failure = new BodyParserError('Upload cleanup failed', 500, 'UPLOAD_CLEANUP_FAILED');
        failure.cause = cleanupError;
        throw failure;
      }
      throw error;
    } finally {
      stream.removeListener('aborted', onAbort);
      stream.removeListener('close', onClose);
      stream.removeListener('error', onAbort);
    }
  }

  checkCancelled() {
    if (this.cancelled) throw new BodyParserError('Request body was aborted', 400, 'REQUEST_ABORTED');
  }

  async parseBuffer(buffer) {
    const boundaryBuffer = Buffer.from(this.boundary);
    const marker = Buffer.from(`\r\n${this.boundary}`);
    let position = buffer.indexOf(boundaryBuffer);
    // The first delimiter may follow a MIME preamble, but only at a line boundary.
    while (position !== -1 && ((position !== 0 && buffer.toString('latin1', position - 2, position) !== '\r\n') || !this.delimiterEnd(buffer, position + boundaryBuffer.length))) {
      position = buffer.indexOf(boundaryBuffer, position + boundaryBuffer.length);
    }
    if (position === -1) throw new BodyParserError('Missing multipart delimiter', 400, 'INVALID_MULTIPART');
    let count = 0;
    while (true) {
      const suffix = this.delimiterEnd(buffer, position + boundaryBuffer.length);
      if (suffix.closing) return;
      const start = suffix.end;
      let next = buffer.indexOf(marker, start);
      let ending;
      // Bare boundary text and boundary-prefix lookalikes are payload, not framing.
      while (next !== -1) {
        ending = this.delimiterEnd(buffer, next + marker.length);
        if (ending) break;
        next = buffer.indexOf(marker, next + marker.length);
      }
      if (next === -1) throw new BodyParserError('Incomplete multipart body', 400, 'INVALID_MULTIPART');
      if (++count > this.options.maxParts) throw new BodyParserError('Too many multipart parts', 413, 'LIMIT_PART_COUNT');
      this.checkCancelled();
      await this.parsePart(buffer.subarray(start, next));
      position = next + 2;
    }
  }

  delimiterEnd(buffer, position) {
    const closing = buffer.toString('latin1', position, position + 2) === '--';
    let end = position + (closing ? 2 : 0);
    // RFC transport padding is limited by the overall request byte limit.
    while (buffer[end] === 32 || buffer[end] === 9) end++;
    if (closing && end === buffer.length) return { closing, end };
    if (buffer[end] !== 13 || buffer[end + 1] !== 10) return null;
    return { closing, end: end + 2 };
  }

  async parsePart(buffer) {
    // Find headers end
    const headerEnd = buffer.indexOf(Buffer.from('\r\n\r\n'));
    if (headerEnd === -1) throw new BodyParserError('Missing multipart headers', 400, 'INVALID_MULTIPART');
    if (headerEnd > this.options.maxHeaderSize) throw new BodyParserError('Multipart headers too large', 413, 'LIMIT_HEADER_SIZE');
    
    const headerBuffer = buffer.slice(0, headerEnd);
    const headers = this.parseHeaders(headerBuffer.toString());
    const content = buffer.slice(headerEnd + 4); // +4 for \r\n\r\n
    
    const disposition = parseDisposition(headers['content-disposition'] || '');
    const fieldName = disposition.name;
    if (['__proto__', 'prototype', 'constructor'].includes(fieldName)) {
      throw new BodyParserError('Unsafe multipart field name', 400, 'INVALID_FORM_KEY');
    }
    
    if (hasOwn(disposition, 'filename')) {
      // It's a file
      await this.handleFile(fieldName, disposition.filename, content, headers);
    } else {
      // It's a regular field
      if (content.length > this.options.maxFieldSize) throw new BodyParserError('Multipart field too large', 413, 'LIMIT_FIELD_SIZE');
      this.handleField(fieldName, content.toString());
    }
  }
  
  parseHeaders(headerString) {
    const headers = Object.create(null);
    const lines = headerString.split('\r\n');
    
    for (const line of lines) {
      const colonIndex = line.indexOf(':');
      if (colonIndex < 1) throw new BodyParserError('Invalid multipart header', 400, 'INVALID_MULTIPART');
      
      const name = line.substring(0, colonIndex).trim().toLowerCase();
      const value = line.substring(colonIndex + 1).trim();
      if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(name) || hasOwn(headers, name)) {
        throw new BodyParserError('Invalid or duplicate multipart header', 400, 'INVALID_MULTIPART');
      }
      headers[name] = value;
    }
    
    return headers;
  }
  
  handleField(name, value) {
    if (++this.fieldCount > this.options.maxFields) throw new BodyParserError('Too many multipart fields', 413, 'LIMIT_FIELD_COUNT');
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
    if (this.options.maxFileSize !== undefined && content.length > this.options.maxFileSize) {
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
    if (this.fileCount >= this.options.maxFiles) {
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
    const safeOriginalName = path.win32.basename(path.posix.basename(filename));
    let newFilename;
    if (this.options.filename && typeof this.options.filename === 'function') {
      const ext = path.extname(safeOriginalName);
      const name = path.basename(safeOriginalName, ext);
      newFilename = this.options.filename(name, ext, null, null);
    } else if (this.options.keepExtensions) {
      const ext = path.extname(safeOriginalName);
      newFilename = `upload_${crypto.randomBytes(16).toString('hex')}${ext}`;
    } else {
      newFilename = `upload_${crypto.randomBytes(16).toString('hex')}`;
    }
    // Even application callbacks must return a basename: never allow traversal or platform paths.
    if (typeof newFilename !== 'string' || !newFilename || /[<>:"/\\|?*\x00-\x1f\x7f]/.test(newFilename) || /[. ]$/.test(newFilename) || /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(newFilename) || Buffer.byteLength(newFilename) > 255) {
      throw new BodyParserError('Invalid upload filename', 400, 'INVALID_FILENAME');
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
      const tempPath = path.resolve(uploadDir, newFilename);
      // Exclusive create prevents overwrites and final-component symlink following.
      const handle = await fs.promises.open(tempPath, 'wx', 0o600);
      this.tempFiles.push(tempPath);
      try {
        this.checkCancelled();
        await handle.writeFile(content);
      } finally {
        await handle.close();
      }
      this.checkCancelled();
      
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
    this.fileCount++;
  }
  
  async cleanup() {
    const errors = [];
    for (const tempFile of this.tempFiles) {
      try {
        await fs.promises.unlink(tempFile);
      } catch (error) {
        if (error.code !== 'ENOENT') errors.push(error);
      }
    }
    this.tempFiles = [];
    if (errors.length) throw new AggregateError(errors, 'Could not remove failed uploads');
  }
}

/**
 * Raw body parser
 * @private
 */
async function parseRaw(req, options) {
  const buffer = await collectStream(req.nativeRequest, options.limit);
  if (options.onBuffer) await options.onBuffer(buffer);
  
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
    jsonLimit: parseSize(options.jsonLimit ?? options.limit ?? '100kb'),
    urlencoded: options.urlencoded !== false,
    urlencodedLimit: parseSize(options.urlencodedLimit ?? options.limit ?? '100kb'),
    extended: options.extended !== false,
    parameterLimit: options.parameterLimit ?? 1000,
    depthLimit: options.depthLimit ?? 32,
    arrayLimit: options.arrayLimit ?? 1000,
    multipart: options.multipart !== false,
    multipartLimit: parseSize(options.multipartLimit ?? options.limit ?? '10mb'),
    fileMemoryLimit: parseSize(options.fileMemoryLimit ?? '1mb'),
    tempDirectory: options.tempDirectory || os.tmpdir(),
    maxFileSize: options.maxFileSize === undefined ? undefined : parseSize(options.maxFileSize),
    allowedTypes: options.allowedTypes,
    filename: options.filename,
    keepExtensions: options.keepExtensions,
    uploadDir: options.uploadDir,
    maxFiles: options.maxFiles ?? 100,
    maxFields: options.maxFields ?? 1000,
    maxParts: options.maxParts ?? 1100,
    maxHeaderSize: parseSize(options.maxHeaderSize ?? '16kb'),
    maxFieldSize: parseSize(options.maxFieldSize ?? '1mb'),
    allowEmptyFiles: options.allowEmptyFiles,
    raw: options.raw || false,
    rawLimit: parseSize(options.rawLimit ?? options.limit ?? '100kb'),
    rawType: options.rawType || 'string',
    preserveRawBody: options.preserveRawBody || false,
    cache: options.cache !== false,
    verify: options.verify
  };

  if (!Number.isSafeInteger(config.parameterLimit) || config.parameterLimit < 1) {
    throw new RangeError('parameterLimit must be a positive safe integer');
  }
  for (const name of ['depthLimit', 'arrayLimit', 'maxFiles', 'maxFields', 'maxParts']) {
    if (!Number.isSafeInteger(config[name]) || config[name] < 0) {
      throw new RangeError(`${name} must be a non-negative safe integer`);
    }
  }
  if (config.verify !== undefined && typeof config.verify !== 'function') throw new TypeError('verify must be a function');
  
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
    if (contentLength === 0 && !req.headers['transfer-encoding'] && req.method !== 'POST' && req.method !== 'PUT' && req.method !== 'PATCH') {
      return next ? next() : undefined;
    }
    
    // Get content type
    const contentType = req.headers['content-type'] || '';
    const type = contentType.split(';')[0].trim().toLowerCase();
    
    try {
      let body = null;
      let rawBody = null;
      let parsedBody = false;
      const onBuffer = async (buffer) => {
        if (config.verify) await config.verify(req, res, buffer, getCharset(contentType));
        if (config.preserveRawBody) rawBody = buffer;
      };
      
      // Determine parser based on content type
      if (config.json && type === 'application/json') {
        parsedBody = true;
        body = await parseJSON(req, { limit: config.jsonLimit, onBuffer });
      } else if (config.urlencoded && type === 'application/x-www-form-urlencoded') {
        parsedBody = true;
        body = await parseURLEncoded(req, { ...config, limit: config.urlencodedLimit, onBuffer });
      } else if (config.multipart && type === 'multipart/form-data') {
        parsedBody = true;
        const parsed = await parseMultipart(req, {
          ...config,
          limit: config.multipartLimit,
          onBuffer
        });
        
        // Separate files from fields
        const { fields, files } = parsed;
        
        body = fields;
        
        // Set files on request
        if (Object.keys(files).length > 0) {
          req.files = files;
        }
        
      } else if (config.raw) {
        parsedBody = true;
        body = await parseRaw(req, {
          limit: config.rawLimit,
          type: config.rawType,
          onBuffer
        });
      }
      
      // Set parsed body on request
      if (parsedBody) {
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
        err.cause = error;
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
