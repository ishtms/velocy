const crypto = require("node:crypto");
const { isIP } = require('node:net');
const { constants: bufferConstants } = require('node:buffer');

// Fixed ceilings apply equally to query strings and standalone URL-encoded bodies.
const PARAMETER_BYTES = 1024 * 1024;
const PARAMETER_COUNT = 1000;
const PARAMETER_DEPTH = 20;
const ARRAY_INDEX = 10000;
const UNSAFE_PATH_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function inputError(message, statusCode, code) {
  return Object.assign(new Error(message), { statusCode, code });
}

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

  #rawBodyPromise = undefined;
  #bodyPromise = undefined;

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

  #trustProxy = false;

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
    // Total collection deadline, not an idle timer that a slow sender can reset.
    this.bodyTimeout = 30000;
  }

  /**
   * Sets the route parameters. Creates a shallow copy to prevent
   * external modifications while allowing internal reuse for pooling.
   *
   * @param {Object<string, any>} params - Route parameters to set
   */
  set params(params) {
    // Don't freeze - allow object pooling in Router for performance
    this.extractedParams = { ...params };
  }

  /**
   * Gets the route parameters extracted from the URL pattern.
   * Returns a copy to prevent external modifications.
   *
   * @returns {Object<string, any>} Object containing route parameters
   * @example
   * // For route '/users/:id' and URL '/users/123'
   * req.params // { id: '123' }
   */
  get params() {
    // Return a copy for safety without freezing for performance
    return { ...this.extractedParams };
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

    if (Buffer.byteLength(queryString, 'utf8') > PARAMETER_BYTES) {
      throw inputError('Parameter input is too large', 413, 'PARAMETER_SIZE_LIMIT');
    }
    // Bounded split avoids allocating an array for every attacker-supplied separator.
    const pairs = queryString.split("&", PARAMETER_COUNT + 1);
    if (pairs.length > PARAMETER_COUNT) {
      throw inputError('Too many parameters', 413, 'PARAMETER_COUNT_LIMIT');
    }

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
    // Validate decoded segments even for malformed/fallback bracket notation.
    const segments = key.split(/[\[\]]/);
    if (segments.some((part) => UNSAFE_PATH_KEYS.has(part))) {
      throw inputError('Unsafe parameter path', 400, 'INVALID_PARAMETER_PATH');
    }
    if (segments.length > PARAMETER_DEPTH * 2 + 1) {
      throw inputError('Parameter nesting is too deep', 400, 'PARAMETER_DEPTH_LIMIT');
    }
    for (const part of segments.slice(1)) {
      if (/^\d+$/.test(part) && (!Number.isSafeInteger(Number(part)) || Number(part) > ARRAY_INDEX)) {
        throw inputError('Parameter index is too large', 400, 'PARAMETER_INDEX_LIMIT');
      }
    }
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
      if (Object.hasOwn(obj, baseKey)) {
        if (!Array.isArray(obj[baseKey])) {
          obj[baseKey] = [obj[baseKey]];
        }
        Array.prototype.push.call(obj[baseKey], value);
      } else {
        obj[baseKey] = value;
      }
      return;
    }

    // Parse bracket notation
    const keys = this.#parseBracketNotation(baseKey, brackets);
    if (keys.length > PARAMETER_DEPTH + 1) {
      throw inputError('Parameter nesting is too deep', 400, 'PARAMETER_DEPTH_LIMIT');
    }

    // Navigate/create the nested structure
    let current = obj;
    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i];
      this.#validateArrayKey(current, k);

      if (k === "") {
        // Array push notation (e.g., items[])
        const parentKey = keys[i - 1] || baseKey;
        if (!Object.hasOwn(current, parentKey) || !Array.isArray(current[parentKey])) {
          this.#defineParameter(current, parentKey, []);
        }
        Array.prototype.push.call(current[parentKey], value);
        return;
      }

      // Determine if next level should be array or object
      const nextKey = keys[i + 1];
      const isArrayIndex = nextKey === "" || /^\d+$/.test(nextKey);

      if (!Object.hasOwn(current, k)) {
        // Define an own field instead of invoking a possible inherited array setter.
        this.#defineParameter(current, k, isArrayIndex ? [] : Object.create(null));
      } else if (typeof current[k] !== "object" || current[k] === null) {
        // Convert primitive to object/array if needed
        current[k] = isArrayIndex ? [] : Object.create(null);
      }

      current = current[k];
    }

    // Set the final value
    const lastKey = keys[keys.length - 1];
    this.#validateArrayKey(current, lastKey);
    if (lastKey === "") {
      // Array push notation at the end
      if (!Array.isArray(current)) {
        const parentKey = keys[keys.length - 2];
        if (parentKey) {
          obj[parentKey] = [];
          Array.prototype.push.call(obj[parentKey], value);
        }
      } else {
        Array.prototype.push.call(current, value);
      }
    } else {
      // Handle duplicate keys at the final level
      if (Object.hasOwn(current, lastKey) && !Array.isArray(current)) {
        if (typeof current[lastKey] !== "object" || current[lastKey] === null) {
          current[lastKey] = [current[lastKey], value];
        } else {
          current[lastKey] = value;
        }
      } else {
        this.#defineParameter(current, lastKey, value);
      }
    }
  }

  #validateArrayKey(container, key) {
    // Array length is an own property with special assignment semantics, not a field.
    if (Array.isArray(container) && key === 'length') {
      throw inputError('Unsafe array parameter path', 400, 'INVALID_PARAMETER_PATH');
    }
  }

  #defineParameter(container, key, value) {
    Object.defineProperty(container, key, { value, writable: true, enumerable: true, configurable: true });
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
    // cookieParser(secret) sets this request-local value before lazy parsing.
    if (!this.#cookieSecret && this.cookieSecret) this.#cookieSecret = this.cookieSecret;

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
      // Cookie encoding is not form encoding: a literal '+' must survive.
      let decodedValue = value;
      try { decodedValue = decodeURIComponent(value); } catch { /* Keep malformed escapes literal. */ }

      // First cookie wins, matching browser path ordering and avoiding ambiguity.
      if (Object.hasOwn(this.#allCookies, name)) continue;

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

    const actual = Buffer.from(signature);
    const expected = Buffer.from(expectedSignature);
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
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
   * Gets the socket IP unless trustProxy explicitly trusts the immediate peer.
   * Trusted proxies must overwrite forwarding headers, not append untrusted input.
   *
   * @returns {string|undefined} IP address
   * @example
   * req.ip // '192.168.1.1' or '::1' for localhost
   */
  get ip() {
    if (this.#ip !== undefined) return this.#ip;

    // Check forwarded headers
    const forwarded = this.headers["x-forwarded-for"];
    if (this.#isProxyTrusted() && typeof forwarded === 'string' && isIP(forwarded.split(',')[0].trim())) {
      this.#ip = forwarded.split(",")[0].trim();
      return this.#ip;
    }

    const realIp = this.headers["x-real-ip"];
    if (this.#isProxyTrusted() && typeof realIp === 'string' && isIP(realIp.trim())) {
      this.#ip = realIp.trim();
      return this.#ip;
    }

    // Fall back to socket address
    const socket = this.#nativeRequest.socket;
    this.#ip = socket && socket.remoteAddress;
    return this.#ip;
  }

  /**
   * Opt in per request before reading IP/protocol, preferably with a peer predicate.
   * Boolean true is only safe when direct access is blocked and the proxy sanitizes headers.
   * @param {boolean|Function} trust
   */
  set trustProxy(trust) {
    if (typeof trust !== 'boolean' && typeof trust !== 'function') {
      throw new TypeError('trustProxy must be a boolean or peer predicate');
    }
    this.#trustProxy = trust;
    this.#ip = undefined;
    this.#protocol = undefined;
  }

  get trustProxy() {
    return this.#trustProxy;
  }

  #isProxyTrusted() {
    return this.#trustProxy === true || (typeof this.#trustProxy === 'function' &&
      this.#trustProxy(this.socket?.remoteAddress) === true);
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
   * Only accepts forwarded protocol from an explicitly trusted immediate peer.
   *
   * @returns {string} Protocol ('http' or 'https')
   * @example
   * req.protocol // 'https' if using SSL/TLS
   */
  get protocol() {
    if (this.#protocol) return this.#protocol;

    // Check X-Forwarded-Proto header
    const proto = this.headers["x-forwarded-proto"];
    if (this.#isProxyTrusted() && typeof proto === 'string' &&
        /^(http|https)$/.test(proto.split(',')[0].trim())) {
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
    if (!this.#bodyPromise) this.#bodyPromise = this.#parseBody();
    return this.#bodyPromise;
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
  getRawBody() {
    // Cache success AND failure, before a second caller can start another reader.
    if (!this.#rawBodyPromise) this.#rawBodyPromise = this.#collectRawBody();
    return this.#rawBodyPromise;
  }

  async #collectRawBody() {
    const limit = this.bodyLimit;
    const timeout = this.bodyTimeout;
    if (!Number.isSafeInteger(limit) || limit < 0 || limit > bufferConstants.MAX_LENGTH) {
      throw new TypeError('bodyLimit must be a non-negative safe byte count within the Buffer limit');
    }
    if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 2147483647) {
      throw new TypeError('bodyTimeout must be an integer from 1 to 2147483647 milliseconds');
    }

    // bodyParser may have consumed the native stream and explicitly preserved bytes.
    const preserved = Object.hasOwn(this, 'rawBody') ? this.rawBody : undefined;
    if (Buffer.isBuffer(preserved)) {
      if (preserved.length > limit) throw this.#bodyOverflow(limit);
      this.#rawBody = preserved;
      return preserved;
    }

    const stream = this.#nativeRequest;
    if (stream.errored) throw stream.errored;
    if (stream.readableDidRead) {
      throw inputError('Request body has already been consumed', 400, 'BODY_ALREADY_CONSUMED');
    }
    if (stream.readableEnded && stream.readableDidRead === false) {
      this.#rawBody = Buffer.alloc(0);
      return this.#rawBody;
    }
    if (stream.destroyed || stream.closed || stream.aborted || stream.readableEnded) {
      throw inputError('Request body is no longer readable', 400, 'BODY_STREAM_CLOSED');
    }

    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      let settled = false;
      const cleanup = () => {
        clearTimeout(timer);
        // Remove only this reader's handlers; middleware/application listeners survive.
        stream.removeListener('data', onData);
        stream.removeListener('end', onEnd);
        stream.removeListener('error', onError);
        stream.removeListener('aborted', onAborted);
        stream.removeListener('close', onClose);
      };
      const finish = (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (error) {
          chunks.length = 0;
          reject(error);
        } else {
          try {
            this.#rawBody = Buffer.concat(chunks, size);
            resolve(this.#rawBody);
          } catch (error) {
            reject(error);
          }
        }
      };
      const onData = (chunk) => {
        if (settled) return;
        // Native requests emit Buffers; tolerate setEncoding() without miscounting bytes.
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += bytes.length;
        if (size > limit) return finish(this.#bodyOverflow(limit));
        chunks.push(bytes);
      };
      const onEnd = () => finish();
      const onError = (error) => finish(error);
      const onAborted = () => finish(inputError('Request body was aborted', 400, 'BODY_ABORTED'));
      const onClose = () => finish(inputError('Request body closed before completion', 400, 'BODY_STREAM_CLOSED'));
      const timer = setTimeout(() => finish(inputError('Request body timed out', 408, 'BODY_TIMEOUT')), timeout);

      stream.on('error', onError);
      stream.on('aborted', onAborted);
      stream.on('close', onClose);
      stream.on('end', onEnd);
      stream.on('data', onData);
    });
  }

  #bodyOverflow(limit) {
    return inputError(`Body size exceeds limit of ${limit} bytes`, 413, 'BODY_SIZE_LIMIT');
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

  /**
   * Checks if the request is secure (HTTPS).
   * Uses socket encryption unless forwarding headers were explicitly trusted.
   *
   * @returns {boolean} True if request is secure
   * @example
   * if (req.secure) {
   *   // Handle HTTPS request
   * }
   */
  get secure() {
    return this.protocol === 'https';
  }

  /**
   * Checks if the request was made via XMLHttpRequest (AJAX).
   * Detects AJAX requests by checking the X-Requested-With header.
   *
   * @returns {boolean} True if request is XHR/AJAX
   * @example
   * if (req.xhr) {
   *   res.json(data);  // Send JSON for AJAX
   * } else {
   *   res.render('page', data);  // Render HTML for normal requests
   * }
   */
  get xhr() {
    const requestedWith = this.headers['x-requested-with'];
    return requestedWith === 'XMLHttpRequest';
  }
}

module.exports = Request;
