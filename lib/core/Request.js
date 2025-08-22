const crypto = require("node:crypto");

/**
 * HTTP Request wrapper class that provides a convenient interface for accessing request data.
 * Wraps Node's native IncomingMessage to provide a cleaner API with features like
 * cookie parsing, query string handling, body parsing, and content negotiation. This abstraction
 * allows adding framework-specific functionality without modifying the native request.
 *
 * @class Request
 * @example
 * // Request object is automatically created by the framework
 * app.get('/users/:id', (req, res) => {
 *   const userId = req.params.id;
 *   const query = req.query;  // Parsed query parameters
 *   const cookies = req.cookies;  // Parsed cookies
 * });
 */
class Request {
  /**
   * @type {http.IncomingMessage}
   * @private
   */
  #nativeRequest;

  /**
   * @type {any|undefined}
   * @private
   */
  #body = undefined;

  /**
   * @type {Object<string, string>|undefined}
   * @private
   */
  #cookies = undefined;

  /**
   * @type {Object<string, string>|undefined}
   * @private
   */
  #signedCookies = undefined;

  /**
   * @type {Object|undefined}
   * @private
   */
  #query = undefined;

  /**
   * @type {Object<string, string>|undefined}
   * @private
   */
  #headers = undefined;

  /**
   * @type {Buffer|undefined}
   * @private
   */
  #rawBody = undefined;

  /**
   * @type {string|undefined}
   * @private
   */
  #ip = undefined;

  /**
   * @type {string|undefined}
   * @private
   */
  #hostname = undefined;

  /**
   * @type {string|undefined}
   * @private
   */
  #protocol = undefined;

  /**
   * @type {string|undefined}
   * @private
   */
  #path = undefined;

  /**
   * @type {string|null}
   * @private
   */
  #cookieSecret = null;

  /**
   * @type {Object<string, string>|undefined}
   * @private
   */
  #allCookies = undefined; // Raw cookies before signature validation

  /**
   * Creates a new Request instance wrapping a native Node.js request.
   * Initializes the request with the native request and optionally a router
   * for cookie signing support. The router provides the secret needed for signed cookies.
   *
   * @constructor
   * @param {http.IncomingMessage} nativeRequest - The native Node.js request object
   * @param {Router|null} [router=null] - Optional router instance for cookie secret access
   */
  constructor(nativeRequest, router = null) {
    this.#nativeRequest = nativeRequest;
    // Only set cookieSecret if router has one
    this.#cookieSecret = router && router._cookieSecret ? router._cookieSecret : null;

    /**
     * @type {Object<string, any>}
     * @description Route parameters extracted from the URL pattern
     */
    this.extractedParams = Object.create(null);

    /**
     * @type {string}
     * @description Base URL path for mounted routers
     * @default ""
     */
    this.baseUrl = "";

    /**
     * @type {number}
     * @description Maximum allowed body size in bytes
     * @default 10485760 (10MB)
     */
    this.bodyLimit = 10 * 1024 * 1024; // 10MB default limit
  }

  /**
   * Sets the route parameters. Freezes the params object to prevent
   * accidental modifications after extraction from the route pattern.
   *
   * @param {Object<string, any>} params - Route parameters to set
   */
  set params(params) {
    this.extractedParams = Object.freeze({ ...params });
  }

  /**
   * Gets the route parameters extracted from the URL pattern.
   * Returns a frozen copy to ensure immutability.
   *
   * @returns {Object<string, any>} Frozen object containing route parameters
   * @example
   * // For route '/users/:id' and URL '/users/123'
   * req.params // { id: '123' }
   */
  get params() {
    return Object.freeze({ ...this.extractedParams });
  }

  /**
   * Gets the HTTP method of the request.
   *
   * @returns {string} HTTP method (GET, POST, PUT, DELETE, etc.)
   */
  get method() {
    return this.#nativeRequest.method;
  }

  /**
   * Gets the full URL path including query string.
   *
   * @returns {string} Full URL path
   */
  get url() {
    return this.#nativeRequest.url;
  }

  /**
   * Sets the URL path. Allows URL modification for internal routing
   * purposes, such as when stripping base paths in mounted routers.
   *
   * @param {string} value - New URL value
   */
  set url(value) {
    this.#nativeRequest.url = value;
  }

  /**
   * Gets normalized headers object with lowercase keys.
   * Normalizes header keys to lowercase for consistent access since
   * HTTP headers are case-insensitive. For performance, only normalizes
   * when advanced features like cookie signing are enabled.
   *
   * @returns {Object<string, string>} Headers object with lowercase keys
   */
  get headers() {
    if (this.#headers) return this.#headers;

    // For simple cases, return raw headers directly
    const rawHeaders = this.#nativeRequest.headers;
    if (!this.#cookieSecret && !this.#body) {
      return rawHeaders;
    }

    // Normalize headers for advanced features
    this.#headers = Object.create(null);
    for (const [key, value] of Object.entries(rawHeaders)) {
      this.#headers[key.toLowerCase()] = value;
    }

    return this.#headers;
  }

  /**
   * Gets a header value case-insensitively.
   * Provides this method for Express compatibility and convenience.
   *
   * @param {string} headerName - Name of the header to retrieve
   * @returns {string|undefined} Header value or undefined if not present
   * @example
   * req.get('Content-Type') // 'application/json'
   * req.get('content-type') // 'application/json' (case-insensitive)
   */
  get(headerName) {
    if (!headerName) return undefined;
    return this.headers[headerName.toLowerCase()];
  }

  /**
   * Gets the request path without query string.
   * Caches the parsed path for performance since it's accessed frequently
   * in routing operations.
   *
   * @returns {string} Clean path without query parameters
   * @example
   * // For URL '/users?page=2'
   * req.path // '/users'
   */
  get path() {
    if (this.#path !== undefined) return this.#path;

    const url = this.#nativeRequest.url;
    const queryIndex = url.indexOf("?");
    this.#path = queryIndex === -1 ? url : url.substring(0, queryIndex);
    return this.#path;
  }

  /**
   * Gets query parameters as plain object with array/nested support.
   * Uses a sophisticated parser that handles arrays, nested objects,
   * and automatic type coercion for a better developer experience.
   *
   * @returns {Object} Query parameters object
   * @example
   * // URL: /search?q=node&limit=10&filters[category]=js&filters[level]=advanced
   * req.query // { q: 'node', limit: 10, filters: { category: 'js', level: 'advanced' } }
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
   * Parses query string into plain object with nested object support, arrays, and type coercion.
   * Implements a full-featured parser that matches the behavior of popular
   * query string libraries, supporting bracket notation for arrays and objects.
   *
   * @private
   * @param {string} queryString - Raw query string to parse
   * @returns {Object} Parsed query object with typed values
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
   * Sets a value in an object using a nested key path (supporting bracket notation).
   * Handles complex key patterns like 'items[0][name]' or 'filters[category][]'
   * to build the appropriate nested structure.
   *
   * @private
   * @param {Object} obj - Target object to set value in
   * @param {string} key - Key path potentially with bracket notation
   * @param {any} value - Value to set
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

      if (k === "") {
        // Array push notation (e.g., items[])
        if (!Array.isArray(current[keys[i - 1] || baseKey])) {
          current[keys[i - 1] || baseKey] = [];
        }
        current[keys[i - 1] || baseKey].push(value);
        return;
      }

      // Determine if next level should be array or object
      const nextKey = keys[i + 1];
      const isArrayIndex = nextKey === "" || /^\d+$/.test(nextKey);

      if (!(k in current)) {
        current[k] = isArrayIndex ? [] : Object.create(null);
      } else if (typeof current[k] !== "object") {
        // Convert primitive to object/array if needed
        current[k] = isArrayIndex ? [] : Object.create(null);
      }

      current = current[k];
    }

    // Set the final value
    const lastKey = keys[keys.length - 1];
    if (lastKey === "") {
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
        if (typeof current[lastKey] !== "object" || current[lastKey] === null) {
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
   * Parses bracket notation into an array of keys.
   * Breaks down complex bracket notation like '[0][name]' into
   * an array of keys for easier traversal.
   *
   * @private
   * @param {string} baseKey - The base key before brackets
   * @param {string} brackets - The bracket portion (e.g., '[0][name]')
   * @returns {string[]} Array of keys extracted from the notation
   */
  #parseBracketNotation(baseKey, brackets) {
    const keys = [baseKey];

    // Remove outer brackets and split by ][
    const inner = brackets.slice(1, -1);
    if (inner === "") {
      keys.push(""); // Empty brackets for array push
      return keys;
    }

    // Split by ][ to handle nested brackets
    const parts = inner.split(/\]\[|\[|\]/g).filter((p) => p !== "");
    keys.push(...parts);

    // Handle trailing empty brackets (e.g., items[])
    if (brackets.endsWith("[]")) {
      keys.push("");
    }

    return keys;
  }

  /**
   * Coerces string values to appropriate types (numbers, booleans).
   * Automatically converts string values to their intended types
   * for a better developer experience - '123' becomes 123, 'true' becomes true, etc.
   * This avoids the need for manual parsing in most cases.
   *
   * @private
   * @param {string} value - String value to coerce
   * @returns {any} Coerced value with appropriate type
   */
  #coerceValue(value) {
    if (typeof value !== "string") return value;
    if (value === "") return "";

    // Boolean values
    if (value === "true") return true;
    if (value === "false") return false;

    // Null value
    if (value === "null") return null;

    // Undefined value
    if (value === "undefined") return undefined;

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
    if (value.includes(",") && !value.startsWith('"') && !value.startsWith("'")) {
      const parts = value.split(",").map((part) => this.#coerceValue(part.trim()));
      // Only return as array if we have multiple non-empty parts
      if (parts.length > 1 || (parts.length === 1 && parts[0] !== "")) {
        return parts;
      }
    }

    // Return as string
    return value;
  }

  /**
   * Safe URL decode that doesn't throw.
   * Wraps decodeURIComponent in a try-catch because malformed
   * URLs shouldn't crash the application. Also handles '+' as space
   * for compatibility with form submissions.
   *
   * @private
   * @param {string} str - String to decode
   * @returns {string} Decoded string or original if decoding fails
   */
  #decodeURIComponentSafe(str) {
    try {
      return decodeURIComponent(str.replace(/\+/g, " "));
    } catch {
      return str;
    }
  }

  /**
   * Parses all cookies from Cookie header.
   * Separates signed and unsigned cookies for security. Signed cookies
   * are validated using HMAC-SHA256 to ensure they haven't been tampered with.
   *
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
      if (this.#cookieSecret && decodedValue.includes(".")) {
        const lastDotIndex = decodedValue.lastIndexOf(".");
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
   * Signs a cookie value using HMAC-SHA256.
   * Uses HMAC-SHA256 for cookie signing as it provides strong
   * security against tampering. The signature is made URL-safe by
   * replacing special Base64 characters.
   *
   * @private
   * @param {string} value - Value to sign
   * @returns {string} Signed value in format 'value.signature'
   * @throws {Error} If cookie secret is not configured
   */
  #signCookieValue(value) {
    if (!this.#cookieSecret) {
      throw new Error("Cookie secret not configured for signed cookies");
    }
    const signature = crypto
      .createHmac("sha256", this.#cookieSecret)
      .update(value)
      .digest("base64")
      .replace(/[=+\/]/g, (char) => {
        // Make URL-safe base64
        switch (char) {
          case "=":
            return "";
          case "+":
            return "-";
          case "/":
            return "_";
          default:
            return char;
        }
      });
    return `${value}.${signature}`;
  }

  /**
   * Verifies a cookie signature using constant-time comparison.
   * Uses crypto.timingSafeEqual for constant-time comparison to
   * prevent timing attacks that could reveal information about the signature.
   *
   * @private
   * @param {string} value - Original cookie value
   * @param {string} signature - Signature to verify
   * @returns {boolean} True if signature is valid
   */
  #verifyCookieSignature(value, signature) {
    if (!this.#cookieSecret) return false;

    const expectedSignature = crypto
      .createHmac("sha256", this.#cookieSecret)
      .update(value)
      .digest("base64")
      .replace(/[=+\/]/g, (char) => {
        switch (char) {
          case "=":
            return "";
          case "+":
            return "-";
          case "/":
            return "_";
          default:
            return char;
        }
      });

    // Constant-time comparison to prevent timing attacks
    if (signature.length !== expectedSignature.length) return false;

    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
  }

  /**
   * Gets parsed unsigned cookies from Cookie header.
   * Excludes signed cookies from this object for security - they're
   * available separately via signedCookies property.
   *
   * @returns {Object<string, string>} Cookies object (excludes signed cookies)
   * @example
   * // Cookie header: 'session=abc123; theme=dark'
   * req.cookies // { session: 'abc123', theme: 'dark' }
   */
  get cookies() {
    this.#parseCookies();
    return this.#cookies;
  }

  /**
   * Gets parsed signed cookies that have been validated.
   * Only returns cookies that pass signature verification to ensure
   * they haven't been tampered with by the client.
   *
   * @returns {Object<string, string>} Signed cookies object (only validated cookies)
   * @example
   * // With cookie secret configured
   * req.signedCookies // { userId: '123' } (only if signature is valid)
   */
  get signedCookies() {
    this.#parseCookies();
    return this.#signedCookies;
  }

  /**
   * Gets client IP address from headers or socket.
   * Checks proxy headers first (X-Forwarded-For, X-Real-IP) since
   * the app might be behind a reverse proxy. Falls back to socket address
   * for direct connections.
   *
   * @returns {string|undefined} IP address
   * @example
   * req.ip // '192.168.1.1' or '::1' for localhost
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
   * Gets hostname from Host header.
   * Extracts just the hostname part, removing the port if present.
   * This is useful for virtual hosting and domain-specific logic.
   *
   * @returns {string|undefined} Hostname without port
   * @example
   * // Host header: 'example.com:3000'
   * req.hostname // 'example.com'
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
   * Gets protocol (http or https).
   * Checks X-Forwarded-Proto header first for proxy scenarios,
   * then falls back to socket encryption status.
   *
   * @returns {string} Protocol ('http' or 'https')
   * @example
   * req.protocol // 'https' if using SSL/TLS
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
   * Gets parsed request body.
   * Returns a Promise because body parsing is asynchronous.
   * The body is parsed based on Content-Type header and cached after first access.
   *
   * @returns {Promise<any>} Parsed body (JSON, URL-encoded, multipart, or raw string)
   * @example
   * const data = await req.body;
   * // For JSON: { name: 'John', age: 30 }
   * // For URL-encoded: { username: 'john', password: 'secret' }
   */
  get body() {
    if (this.#body !== undefined) return Promise.resolve(this.#body);
    return this.#parseBody();
  }

  /**
   * Gets raw body buffer.
   * Collects the raw body chunks into a Buffer for cases where
   * you need the unparsed body data. Includes size limit protection
   * to prevent memory exhaustion attacks.
   *
   * @returns {Promise<Buffer>} Raw body as Buffer
   * @throws {Error} If body exceeds size limit
   * @example
   * const rawData = await req.getRawBody();
   * // Process binary data or custom parsing
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
   * Parses request body based on content-type.
   * Supports JSON, URL-encoded, and multipart form data out of the box.
   * Falls back to raw string for unrecognized content types.
   *
   * @private
   * @returns {Promise<any>} Parsed body content
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
   * Parses multipart form data.
   * Implements a basic multipart parser for file uploads and form data.
   * This handles both regular fields and file uploads, storing file metadata
   * along with content.
   *
   * @private
   * @param {Buffer} buffer - Raw body buffer
   * @param {string} contentType - Content-Type header value
   * @returns {Promise<Object>} Parsed multipart data
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
          headers: headers,
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
   * Checks if request is of given type(s).
   * Provides this for easy content-type checking with support for
   * shortcuts like 'json' and wildcards like 'text/\*'.
   *
   * @param {...string} types - Type patterns to check
   * @returns {string|false} Matching type or false
   * @example
   * if (req.is('json')) {
   *   // Handle JSON request
   * }
   * if (req.is('text/*', 'application/json')) {
   *   // Handle text or JSON
   * }
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
   * Content negotiation - checks if client accepts given type(s).
   * Implements content negotiation based on the Accept header,
   * including quality values (q-values) for proper prioritization.
   *
   * @param {...string} types - MIME types to check
   * @returns {string|false} Best matching type or false
   * @example
   * // Accept header: 'text/html,application/json;q=0.9'
   * req.accepts('json', 'html') // 'html' (higher priority)
   * req.accepts('xml') // false (not accepted)
   */
  accepts(...types) {
    // Handle both array and spread arguments
    if (types.length === 1 && Array.isArray(types[0])) {
      types = types[0];
    }

    const acceptHeader = this.headers.accept;
    if (!acceptHeader) return types[0] || false;

    // Parse accept header with quality values
    const accepted = this.#parseAcceptHeader(acceptHeader);

    if (types.length === 0) {
      // Return all accepted types
      return accepted.map((a) => a.type);
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
   * Shortcut for checking if JSON is accepted.
   * Provides this convenience method since JSON API responses
   * are very common in modern web applications.
   *
   * @returns {boolean} True if client accepts JSON
   * @example
   * if (req.acceptsJSON()) {
   *   res.json({ data: 'value' });
   * }
   */
  acceptsJSON() {
    return !!this.accepts("json", "application/json");
  }

  /**
   * Shortcut for checking if HTML is accepted.
   * Provides this for easy content negotiation between
   * HTML pages and API responses.
   *
   * @returns {boolean} True if client accepts HTML
   * @example
   * if (req.acceptsHTML()) {
   *   res.render('page');
   * } else {
   *   res.json({ data: 'value' });
   * }
   */
  acceptsHTML() {
    return !!this.accepts("html", "text/html");
  }

  /**
   * Parses Accept header with quality values.
   * Parses the Accept header according to RFC 7231, extracting
   * media types and their quality values for proper content negotiation.
   *
   * @private
   * @param {string} acceptHeader - Raw Accept header value
   * @returns {Array<{type: string, quality: number}>} Sorted array of accepted types
   */
  #parseAcceptHeader(acceptHeader) {
    const types = [];
    const parts = acceptHeader.split(",");

    for (const part of parts) {
      const trimmed = part.trim();
      const semicolonIndex = trimmed.indexOf(";");

      let type,
        quality = 1.0;

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
   * Normalizes media type for comparison.
   * Converts shortcuts like 'json' to full MIME types
   * for consistent comparison.
   *
   * @private
   * @param {string} type - Type shortcut or full MIME type
   * @returns {string} Normalized MIME type
   */
  #normalizeMediaType(type) {
    type = type.toLowerCase();

    // Handle shortcuts
    const shortcuts = {
      json: "application/json",
      html: "text/html",
      xml: "application/xml",
      text: "text/plain",
      form: "application/x-www-form-urlencoded",
      multipart: "multipart/form-data",
    };

    return shortcuts[type] || type;
  }

  /**
   * Checks if media types match (with wildcard support).
   * Supports wildcards like *\/* and text/* for flexible
   * content type matching.
   *
   * @private
   * @param {string} type - Media type to check
   * @param {string} pattern - Pattern to match against (may include wildcards)
   * @returns {boolean} True if types match
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
   * Gets the underlying native Node.js request object.
   * Exposes this for compatibility with Node.js libraries
   * that expect the raw request object.
   *
   * @returns {http.IncomingMessage} Native request
   * @example
   * // Access Node.js specific properties
   * req.nativeRequest.httpVersion
   */
  get nativeRequest() {
    return this.#nativeRequest;
  }

  /**
   * Sets the socket timeout.
   * Delegates to the native request's setTimeout for
   * controlling how long the socket stays open.
   *
   * @param {number} msecs - Timeout in milliseconds
   * @param {Function} [callback] - Optional callback when timeout occurs
   * @returns {http.IncomingMessage} The native request for chaining
   */
  setTimeout(msecs, callback) {
    if (this.#nativeRequest.setTimeout) {
      return this.#nativeRequest.setTimeout(msecs, callback);
    }
  }

  /**
   * Gets the connection/socket.
   * Provides both connection and socket properties for
   * compatibility with different Node.js versions.
   *
   * @returns {net.Socket} Connection socket
   * @example
   * // Get client connection info
   * req.connection.remoteAddress
   */
  get connection() {
    return this.#nativeRequest.connection || this.#nativeRequest.socket;
  }

  /**
   * Gets the socket (alias for connection).
   * Provides this alias since newer Node.js versions
   * prefer 'socket' over 'connection'.
   *
   * @returns {net.Socket} Socket
   * @example
   * // Check if connection is encrypted
   * req.socket.encrypted
   */
  get socket() {
    return this.#nativeRequest.socket || this.#nativeRequest.connection;
  }
}

module.exports = Request;
