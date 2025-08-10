const crypto = require("node:crypto");

class Request {
  #nativeRequest;
  #body = undefined;
  #cookies = undefined;
  #signedCookies = undefined;
  #query = undefined;
  #headers = undefined;
  #rawBody = undefined;
  #ip = undefined;
  #hostname = undefined;
  #protocol = undefined;
  #path = undefined;
  #cookieSecret = null;
  #allCookies = undefined; // Raw cookies before signature validation
  
  constructor(nativeRequest, options = {}) {
    this.#nativeRequest = nativeRequest;
    this.#cookieSecret = options.cookieSecret || null;
    this.extractedParams = Object.create(null);
    this.baseUrl = "";
    this.bodyLimit = 10 * 1024 * 1024; // 10MB default limit
  }

  set params(params) {
    this.extractedParams = Object.freeze({ ...params });
  }

  get params() {
    return Object.freeze({ ...this.extractedParams });
  }

  get method() {
    return this.#nativeRequest.method;
  }

  get url() {
    return this.#nativeRequest.url;
  }
  
  set url(value) {
    this.#nativeRequest.url = value;
  }

  /**
   * Gets normalized headers object with lowercase keys
   * @returns {Object} Headers object
   */
  get headers() {
    if (this.#headers) return this.#headers;
    
    this.#headers = Object.create(null);
    const rawHeaders = this.#nativeRequest.headers;
    
    for (const [key, value] of Object.entries(rawHeaders)) {
      this.#headers[key.toLowerCase()] = value;
    }
    
    return this.#headers;
  }

  /**
   * Gets a header value case-insensitively
   * @param {string} headerName - Name of the header to retrieve
   * @returns {string|undefined} Header value or undefined if not present
   */
  get(headerName) {
    if (!headerName) return undefined;
    return this.headers[headerName.toLowerCase()];
  }

  /**
   * Gets the request path without query string
   * @returns {string} Clean path
   */
  get path() {
    if (this.#path !== undefined) return this.#path;
    
    const url = this.#nativeRequest.url;
    const queryIndex = url.indexOf("?");
    this.#path = queryIndex === -1 ? url : url.substring(0, queryIndex);
    return this.#path;
  }

  /**
   * Gets query parameters as plain object with array/nested support
   * @returns {Object} Query parameters object
   */
  get query() {
    if (this.#query) return this.#query;
    
    const url = this.#nativeRequest.url;
    const queryIndex = url.indexOf("?");
    const queryString = queryIndex === -1 ? "" : url.substring(queryIndex + 1);
    
    this.#query = this.#parseQueryString(queryString);
    return this.#query;
  }

  /**
   * Parses query string into plain object with nested object support, arrays, and type coercion
   * @private
   */
  #parseQueryString(queryString) {
    const result = Object.create(null);
    if (!queryString) return result;
    
    const pairs = queryString.split("&");
    
    for (const pair of pairs) {
      if (!pair) continue;
      
      const eqIndex = pair.indexOf("=");
      let key, value;
      
      if (eqIndex === -1) {
        key = this.#decodeURIComponentSafe(pair);
        value = "";
      } else {
        key = this.#decodeURIComponentSafe(pair.substring(0, eqIndex));
        value = this.#decodeURIComponentSafe(pair.substring(eqIndex + 1));
      }
      
      // Apply type coercion
      value = this.#coerceValue(value);
      
      // Parse the key and set the value
      this.#setNestedValue(result, key, value);
    }
    
    return result;
  }

  /**
   * Sets a value in an object using a nested key path (supporting bracket notation)
   * @private
   */
  #setNestedValue(obj, key, value) {
    // Handle array notation: key[] or key[index]
    const arrayMatch = key.match(/^([^\[]+)(\[.*\])?$/);
    if (!arrayMatch) {
      obj[key] = value;
      return;
    }
    
    const baseKey = arrayMatch[1];
    const brackets = arrayMatch[2];
    
    // No brackets - simple key
    if (!brackets) {
      // Handle duplicate keys (convert to array)
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
    
    // Parse bracket notation
    const keys = this.#parseBracketNotation(baseKey, brackets);
    
    // Navigate/create the nested structure
    let current = obj;
    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i];
      
      if (k === '') {
        // Array push notation (e.g., items[])
        if (!Array.isArray(current[keys[i - 1] || baseKey])) {
          current[keys[i - 1] || baseKey] = [];
        }
        current[keys[i - 1] || baseKey].push(value);
        return;
      }
      
      // Determine if next level should be array or object
      const nextKey = keys[i + 1];
      const isArrayIndex = nextKey === '' || /^\d+$/.test(nextKey);
      
      if (!(k in current)) {
        current[k] = isArrayIndex ? [] : Object.create(null);
      } else if (typeof current[k] !== 'object') {
        // Convert primitive to object/array if needed
        current[k] = isArrayIndex ? [] : Object.create(null);
      }
      
      current = current[k];
    }
    
    // Set the final value
    const lastKey = keys[keys.length - 1];
    if (lastKey === '') {
      // Array push notation at the end
      if (!Array.isArray(current)) {
        const parentKey = keys[keys.length - 2];
        if (parentKey) {
          obj[parentKey] = [];
          obj[parentKey].push(value);
        }
      } else {
        current.push(value);
      }
    } else {
      // Handle duplicate keys at the final level
      if (lastKey in current && !Array.isArray(current)) {
        if (typeof current[lastKey] !== 'object' || current[lastKey] === null) {
          current[lastKey] = [current[lastKey], value];
        } else {
          current[lastKey] = value;
        }
      } else {
        current[lastKey] = value;
      }
    }
  }

  /**
   * Parses bracket notation into an array of keys
   * @private
   */
  #parseBracketNotation(baseKey, brackets) {
    const keys = [baseKey];
    
    // Remove outer brackets and split by ][
    const inner = brackets.slice(1, -1);
    if (inner === '') {
      keys.push(''); // Empty brackets for array push
      return keys;
    }
    
    // Split by ][ to handle nested brackets
    const parts = inner.split(/\]\[|\[|\]/g).filter(p => p !== '');
    keys.push(...parts);
    
    // Handle trailing empty brackets (e.g., items[])
    if (brackets.endsWith('[]')) {
      keys.push('');
    }
    
    return keys;
  }

  /**
   * Coerces string values to appropriate types (numbers, booleans)
   * @private
   */
  #coerceValue(value) {
    if (typeof value !== 'string') return value;
    if (value === '') return '';
    
    // Boolean values
    if (value === 'true') return true;
    if (value === 'false') return false;
    
    // Null value
    if (value === 'null') return null;
    
    // Undefined value
    if (value === 'undefined') return undefined;
    
    // Numeric values
    if (/^-?\d+$/.test(value)) {
      const num = parseInt(value, 10);
      // Check for safe integer range
      if (num >= Number.MIN_SAFE_INTEGER && num <= Number.MAX_SAFE_INTEGER) {
        return num;
      }
    }
    
    // Floating point numbers
    if (/^-?\d*\.\d+$/.test(value)) {
      const num = parseFloat(value);
      if (!isNaN(num) && isFinite(num)) {
        return num;
      }
    }
    
    // Handle comma-separated values (convert to array)
    // Only do this if the value contains commas and isn't quoted
    if (value.includes(',') && !value.startsWith('"') && !value.startsWith("'")) {
      const parts = value.split(',').map(part => this.#coerceValue(part.trim()));
      // Only return as array if we have multiple non-empty parts
      if (parts.length > 1 || (parts.length === 1 && parts[0] !== '')) {
        return parts;
      }
    }
    
    // Return as string
    return value;
  }

  /**
   * Safe URL decode that doesn't throw
   * @private
   */
  #decodeURIComponentSafe(str) {
    try {
      return decodeURIComponent(str.replace(/\+/g, " "));
    } catch {
      return str;
    }
  }

  /**
   * Parses all cookies from Cookie header
   * @private
   */
  #parseCookies() {
    if (this.#allCookies !== undefined) return;
    
    this.#allCookies = Object.create(null);
    this.#cookies = Object.create(null);
    this.#signedCookies = Object.create(null);
    
    const cookieHeader = this.headers.cookie;
    if (!cookieHeader) return;
    
    const pairs = cookieHeader.split(/;\s*/);
    
    for (const pair of pairs) {
      const eqIndex = pair.indexOf("=");
      if (eqIndex === -1) continue;
      
      const name = pair.substring(0, eqIndex).trim();
      if (!name) continue;
      
      let value = pair.substring(eqIndex + 1).trim();
      
      // Remove quotes if present
      if (value[0] === '"' && value[value.length - 1] === '"') {
        value = value.slice(1, -1);
      }
      
      // Decode the value
      const decodedValue = this.#decodeURIComponentSafe(value);
      
      // Store in allCookies first
      this.#allCookies[name] = decodedValue;
      
      // Check if this is a signed cookie
      if (this.#cookieSecret && decodedValue.includes('.')) {
        const lastDotIndex = decodedValue.lastIndexOf('.');
        const unsigned = decodedValue.substring(0, lastDotIndex);
        const signature = decodedValue.substring(lastDotIndex + 1);
        
        // Verify the signature
        if (this.#verifyCookieSignature(unsigned, signature)) {
          this.#signedCookies[name] = unsigned;
        } else {
          // Invalid signature, treat as regular cookie
          this.#cookies[name] = decodedValue;
        }
      } else {
        // Regular cookie
        this.#cookies[name] = decodedValue;
      }
    }
  }

  /**
   * Signs a cookie value using HMAC-SHA256
   * @private
   */
  #signCookieValue(value) {
    if (!this.#cookieSecret) {
      throw new Error('Cookie secret not configured for signed cookies');
    }
    const signature = crypto
      .createHmac('sha256', this.#cookieSecret)
      .update(value)
      .digest('base64')
      .replace(/[=+\/]/g, (char) => {
        // Make URL-safe base64
        switch (char) {
          case '=': return '';
          case '+': return '-';
          case '/': return '_';
          default: return char;
        }
      });
    return `${value}.${signature}`;
  }

  /**
   * Verifies a cookie signature using constant-time comparison
   * @private
   */
  #verifyCookieSignature(value, signature) {
    if (!this.#cookieSecret) return false;
    
    const expectedSignature = crypto
      .createHmac('sha256', this.#cookieSecret)
      .update(value)
      .digest('base64')
      .replace(/[=+\/]/g, (char) => {
        switch (char) {
          case '=': return '';
          case '+': return '-';
          case '/': return '_';
          default: return char;
        }
      });
    
    // Constant-time comparison to prevent timing attacks
    if (signature.length !== expectedSignature.length) return false;
    
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  }

  /**
   * Gets parsed unsigned cookies from Cookie header
   * @returns {Object} Cookies object (excludes signed cookies)
   */
  get cookies() {
    this.#parseCookies();
    return this.#cookies;
  }

  /**
   * Gets parsed signed cookies that have been validated
   * @returns {Object} Signed cookies object
   */
  get signedCookies() {
    this.#parseCookies();
    return this.#signedCookies;
  }

  /**
   * Gets client IP address from headers or socket
   * @returns {string|undefined} IP address
   */
  get ip() {
    if (this.#ip !== undefined) return this.#ip;
    
    // Check forwarded headers
    const forwarded = this.headers["x-forwarded-for"];
    if (forwarded) {
      this.#ip = forwarded.split(",")[0].trim();
      return this.#ip;
    }
    
    const realIp = this.headers["x-real-ip"];
    if (realIp) {
      this.#ip = realIp;
      return this.#ip;
    }
    
    // Fall back to socket address
    const socket = this.#nativeRequest.socket;
    this.#ip = socket && socket.remoteAddress;
    return this.#ip;
  }

  /**
   * Gets hostname from Host header
   * @returns {string|undefined} Hostname
   */
  get hostname() {
    if (this.#hostname !== undefined) return this.#hostname;
    
    const host = this.headers.host;
    if (!host) {
      this.#hostname = undefined;
      return this.#hostname;
    }
    
    // Remove port if present
    const colonIndex = host.indexOf(":");
    this.#hostname = colonIndex === -1 ? host : host.substring(0, colonIndex);
    return this.#hostname;
  }

  /**
   * Gets protocol (http or https)
   * @returns {string} Protocol
   */
  get protocol() {
    if (this.#protocol) return this.#protocol;
    
    // Check X-Forwarded-Proto header
    const proto = this.headers["x-forwarded-proto"];
    if (proto) {
      this.#protocol = proto.split(",")[0].trim();
      return this.#protocol;
    }
    
    // Check if connection is encrypted
    const encrypted = this.#nativeRequest.socket && this.#nativeRequest.socket.encrypted;
    this.#protocol = encrypted ? "https" : "http";
    return this.#protocol;
  }

  /**
   * Gets parsed request body
   * @returns {Promise<any>} Parsed body
   */
  get body() {
    if (this.#body !== undefined) return Promise.resolve(this.#body);
    return this.#parseBody();
  }

  /**
   * Gets raw body buffer
   * @returns {Promise<Buffer>} Raw body
   */
  async getRawBody() {
    if (this.#rawBody !== undefined) return this.#rawBody;
    
    const chunks = [];
    let size = 0;
    
    return new Promise((resolve, reject) => {
      this.#nativeRequest.on("data", (chunk) => {
        size += chunk.length;
        if (size > this.bodyLimit) {
          this.#nativeRequest.removeAllListeners();
          reject(new Error(`Body size exceeds limit of ${this.bodyLimit} bytes`));
          return;
        }
        chunks.push(chunk);
      });
      
      this.#nativeRequest.on("end", () => {
        this.#rawBody = Buffer.concat(chunks);
        resolve(this.#rawBody);
      });
      
      this.#nativeRequest.on("error", reject);
    });
  }

  /**
   * Parses request body based on content-type
   * @private
   */
  async #parseBody() {
    const contentType = this.headers["content-type"] || "";
    const rawBody = await this.getRawBody();
    
    if (!rawBody || rawBody.length === 0) {
      this.#body = null;
      return this.#body;
    }
    
    const bodyString = rawBody.toString("utf8");
    
    // JSON parsing
    if (contentType.includes("application/json")) {
      try {
        this.#body = JSON.parse(bodyString);
      } catch (e) {
        this.#body = null;
      }
      return this.#body;
    }
    
    // URL-encoded parsing (uses the same enhanced parser as query strings)
    if (contentType.includes("application/x-www-form-urlencoded")) {
      this.#body = this.#parseQueryString(bodyString);
      return this.#body;
    }
    
    // Multipart form data parsing
    if (contentType.includes("multipart/form-data")) {
      this.#body = await this.#parseMultipart(rawBody, contentType);
      return this.#body;
    }
    
    // Default to raw string
    this.#body = bodyString;
    return this.#body;
  }

  /**
   * Parses multipart form data
   * @private
   */
  async #parseMultipart(buffer, contentType) {
    const result = Object.create(null);
    
    // Extract boundary from content-type
    const boundaryMatch = contentType.match(/boundary=([^;]+)/);
    if (!boundaryMatch) return result;
    
    let boundary = boundaryMatch[1];
    if (boundary.startsWith('"') && boundary.endsWith('"')) {
      boundary = boundary.slice(1, -1);
    }
    
    const boundaryBuffer = Buffer.from(`--${boundary}`);
    const parts = [];
    let start = 0;
    
    // Split buffer by boundary
    for (let i = 0; i < buffer.length - boundaryBuffer.length; i++) {
      if (buffer.slice(i, i + boundaryBuffer.length).equals(boundaryBuffer)) {
        if (start !== 0) {
          parts.push(buffer.slice(start, i));
        }
        start = i + boundaryBuffer.length;
      }
    }
    
    // Parse each part
    for (const part of parts) {
      const partStr = part.toString("utf8");
      const headerEndIndex = partStr.indexOf("\r\n\r\n");
      
      if (headerEndIndex === -1) continue;
      
      const headers = partStr.substring(0, headerEndIndex);
      const content = partStr.substring(headerEndIndex + 4).replace(/\r\n$/, "");
      
      // Extract field name from Content-Disposition header
      const nameMatch = headers.match(/name="([^"]+)"/);
      if (!nameMatch) continue;
      
      const fieldName = nameMatch[1];
      
      // Check if it's a file
      const filenameMatch = headers.match(/filename="([^"]+)"/);
      if (filenameMatch) {
        // Store file info
        result[fieldName] = {
          filename: filenameMatch[1],
          content: content,
          headers: headers
        };
      } else {
        // Regular field
        if (fieldName in result) {
          if (!Array.isArray(result[fieldName])) {
            result[fieldName] = [result[fieldName]];
          }
          result[fieldName].push(content);
        } else {
          result[fieldName] = content;
        }
      }
    }
    
    return result;
  }

  /**
   * Checks if request is of given type(s)
   * @param {...string} types - Type patterns to check
   * @returns {string|false} Matching type or false
   */
  is(...types) {
    const contentType = this.headers["content-type"];
    if (!contentType) return false;
    
    // Normalize content type (remove parameters)
    const actualType = contentType.split(";")[0].trim().toLowerCase();
    
    for (let type of types) {
      type = type.toLowerCase();
      
      // Direct match
      if (type === actualType) return type;
      
      // Handle shortcuts
      if (type === "json" && actualType === "application/json") return "json";
      if (type === "html" && actualType === "text/html") return "html";
      if (type === "text" && actualType.startsWith("text/")) return "text";
      
      // Handle wildcards (e.g., "*/json", "text/*")
      if (type.includes("*")) {
        const pattern = type.replace(/\*/g, ".*");
        const regex = new RegExp(`^${pattern}$`);
        if (regex.test(actualType)) return type;
      }
      
      // Check if actual type ends with the requested type (e.g., "json" matches "application/json")
      if (actualType.endsWith(`/${type}`)) return type;
    }
    
    return false;
  }

  /**
   * Content negotiation - checks if client accepts given type(s)
   * @param {...string} types - MIME types to check
   * @returns {string|false} Best matching type or false
   */
  accepts(...types) {
    const acceptHeader = this.headers.accept;
    if (!acceptHeader) return types[0] || false;
    
    // Parse accept header with quality values
    const accepted = this.#parseAcceptHeader(acceptHeader);
    
    if (types.length === 0) {
      // Return all accepted types
      return accepted.map(a => a.type);
    }
    
    // Find best match
    let bestMatch = null;
    let bestQuality = 0;
    
    for (const type of types) {
      const normalized = this.#normalizeMediaType(type);
      
      for (const accept of accepted) {
        if (this.#matchesMediaType(normalized, accept.type)) {
          if (accept.quality > bestQuality) {
            bestMatch = type;
            bestQuality = accept.quality;
          }
        }
      }
    }
    
    return bestMatch || false;
  }

  /**
   * Shortcut for checking if JSON is accepted
   * @returns {boolean}
   */
  acceptsJSON() {
    return !!this.accepts("json", "application/json");
  }

  /**
   * Shortcut for checking if HTML is accepted
   * @returns {boolean}
   */
  acceptsHTML() {
    return !!this.accepts("html", "text/html");
  }

  /**
   * Parses Accept header with quality values
   * @private
   */
  #parseAcceptHeader(acceptHeader) {
    const types = [];
    const parts = acceptHeader.split(",");
    
    for (const part of parts) {
      const trimmed = part.trim();
      const semicolonIndex = trimmed.indexOf(";");
      
      let type, quality = 1.0;
      
      if (semicolonIndex === -1) {
        type = trimmed;
      } else {
        type = trimmed.substring(0, semicolonIndex).trim();
        const params = trimmed.substring(semicolonIndex + 1);
        const qMatch = params.match(/q=([0-9.]+)/);
        if (qMatch) {
          quality = parseFloat(qMatch[1]);
        }
      }
      
      types.push({ type: type.toLowerCase(), quality });
    }
    
    // Sort by quality (highest first)
    types.sort((a, b) => b.quality - a.quality);
    
    return types;
  }

  /**
   * Normalizes media type for comparison
   * @private
   */
  #normalizeMediaType(type) {
    type = type.toLowerCase();
    
    // Handle shortcuts
    const shortcuts = {
      "json": "application/json",
      "html": "text/html",
      "xml": "application/xml",
      "text": "text/plain",
      "form": "application/x-www-form-urlencoded",
      "multipart": "multipart/form-data"
    };
    
    return shortcuts[type] || type;
  }

  /**
   * Checks if media types match (with wildcard support)
   * @private
   */
  #matchesMediaType(type, pattern) {
    if (pattern === "*/*") return true;
    if (type === pattern) return true;
    
    const typeParts = type.split("/");
    const patternParts = pattern.split("/");
    
    if (patternParts[0] === "*") return typeParts[1] === patternParts[1];
    if (patternParts[1] === "*") return typeParts[0] === patternParts[0];
    
    return false;
  }

  /**
   * Gets the underlying native Node.js request object
   * @returns {http.IncomingMessage} Native request
   */
  get nativeRequest() {
    return this.#nativeRequest;
  }
}

module.exports = Request;