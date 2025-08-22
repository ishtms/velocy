const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { promisify } = require("node:util");

/**
 * HTTP Response wrapper class that provides a convenient interface for sending responses.
 * Wraps Node's native ServerResponse to provide a cleaner API with features like
 * JSON responses, cookie management, template rendering, and file sending. This abstraction
 * enables middleware chaining and provides Express-like convenience methods.
 * 
 * @class Response
 * @example
 * // Response object is automatically created by the framework
 * app.get('/users/:id', (req, res) => {
 *   res.status(200).json({ id: req.params.id, name: 'John' });
 * });
 */
class Response {
  /**
   * @type {http.ServerResponse}
   * @private
   */
  #nativeResponse;
  
  /**
   * @type {Object<string, string|string[]>}
   * @private
   */
  #headers;
  
  /**
   * @type {number}
   * @private
   */
  #statusCode;
  
  /**
   * @type {boolean}
   * @private
   */
  #headersSent;
  
  /**
   * @type {string|null}
   * @private
   */
  #cookieSecret;
  
  /**
   * @type {Array}
   * @private
   */
  #pendingCookies;
  
  /**
   * @type {Object|null}
   * @private
   */
  #viewEngine;
  
  /**
   * @type {Object|null}
   * @private
   */
  #locals;

  /**
   * Creates a new Response instance wrapping a native Node.js response.
   * Initializes the response with sensible defaults and optionally
   * extracts cookie secret and view engine from the router for advanced features.
   * 
   * @constructor
   * @param {http.ServerResponse} nativeResponse - The native Node.js response object
   * @param {Router|null} [router=null] - Optional router instance for cookie secret and view engine
   * @param {Request|null} [req=null] - Optional request object for HEAD method handling
   */
  constructor(nativeResponse, router = null, req = null) {
    this.#nativeResponse = nativeResponse;
    this.#headers = {};
    this.#statusCode = 200;
    this.#headersSent = false;
    // Lazy load features from router only when needed
    if (router) {
      this.#cookieSecret = router._cookieSecret || null;
      this.#viewEngine = router._viewEngine || null;
    } else {
      this.#cookieSecret = null;
      this.#viewEngine = null;
    }
    this.#pendingCookies = [];
    this.#locals = null; // Lazy initialize
    
    /**
     * @type {Request|null}
     * @description Reference to request object for HEAD method handling
     * @private
     */
    this._req = req; // Store request for HEAD method check
  }

  /**
   * Writes the response headers to the client.
   * Maintains this method for backward compatibility with Node.js APIs
   * while ensuring our internal header state is properly synchronized.
   * 
   * @param {number} statusCode - HTTP status code
   * @param {Object} [headers] - Optional headers to merge before sending
   * @returns {void}
   */
  writeHead(statusCode, headers) {
    // If headers are provided, merge them into our headers first
    if (headers) {
      Object.assign(this.#headers, headers);
    }
    // Always use the current state of this.#headers
    this.#nativeResponse.writeHead(statusCode, this.#headers);
    this.#headersSent = true;
  }

  /**
   * Ends the response, optionally with data.
   * Ensures headers are sent before ending and handles HEAD requests
   * specially by not sending a body (as per HTTP spec).
   * 
   * @param {string|Buffer} [data] - Optional data to send before ending
   * @param {string} [encoding] - Optional encoding for string data
   * @returns {void}
   */
  end(data, encoding) {
    if (!this.#nativeResponse.headersSent) {
      this.writeHead(this.#statusCode, this.#headers);
      this.#headersSent = true;
    }
    // For HEAD requests, don't send body
    if (this._req && this._req.method === 'HEAD') {
      this.#nativeResponse.end();
    } else {
      if (encoding) {
        this.#nativeResponse.end(data, encoding);
      } else {
        this.#nativeResponse.end(data);
      }
    }
  }

  /**
   * Sets the HTTP status code.
   * Returns 'this' to enable method chaining for cleaner code.
   * 
   * @param {number} code - HTTP status code
   * @returns {Response} This response instance for chaining
   * @example
   * res.status(404).send('Not Found');
   */
  status(code) {
    this.#statusCode = code;
    return this;
  }

  /**
   * Sends a JSON response.
   * Automatically sets the Content-Type header and stringifies the data.
   * Not setting Content-Length to allow compression middleware to work properly.
   * 
   * @param {*} data - Data to send as JSON
   * @returns {Response} This response instance for chaining
   * @example
   * res.json({ success: true, data: { id: 1, name: 'John' } });
   */
  json(data) {
    this.set('Content-Type', 'application/json');
    const jsonString = JSON.stringify(data);
    // Don't set Content-Length here - let middleware handle it
    // The compression middleware will remove it if needed
    // Call the potentially wrapped end method
    this.end(jsonString);
    return this;
  }

  /**
   * Set Content-Disposition header to attachment
   * Express-compatible method for setting file download headers
   * 
   * @param {string} [filename] - Optional filename for the attachment
   * @returns {Response} This response instance for chaining
   * @example
   * res.attachment(); // Sets Content-Disposition: attachment
   * res.attachment('document.pdf'); // Sets Content-Disposition: attachment; filename="document.pdf"
   */
  attachment(filename) {
    if (filename) {
      // Escape quotes in filename to prevent header injection
      const safeFilename = String(filename).replace(/"/g, '\\"');
      this.set('Content-Disposition', `attachment; filename="${safeFilename}"`);
    } else {
      this.set('Content-Disposition', 'attachment');
    }
    return this;
  }

  /**
   * Sends a response with smart type detection.
   * Automatically detects the data type and sets appropriate headers.
   * Handles strings, objects (as JSON), buffers, and null/undefined gracefully.
   * 
   * @param {*} data - Data to send (string, object, buffer, etc.)
   * @returns {Response} This response instance for chaining
   * @example
   * res.send('Hello World');  // Sends HTML
   * res.send({ foo: 'bar' }); // Sends JSON
   * res.send(Buffer.from('binary data')); // Sends binary
   */
  send(data) {
    if (data === null || data === undefined) {
      this.end('');
    } else if (typeof data === 'string') {
      // Fast path for strings (most common)
      if (!this.#nativeResponse.headersSent) {
        if (!this.#headers['Content-Type']) {
          this.#headers['Content-Type'] = 'text/html; charset=utf-8';
        }
        // Don't set Content-Length here - let middleware handle it
      }
      this.end(data);
    } else if (typeof data === 'object') {
      if (Buffer.isBuffer(data)) {
        // Send buffer as-is
        if (!this.#headers['Content-Type']) {
          this.set('Content-Type', 'application/octet-stream');
        }
        // Don't set Content-Length here - let middleware handle it
        this.end(data);
      } else {
        // Send as JSON
        this.json(data);
      }
    } else {
      // Convert to string for other types
      const str = String(data);
      // Don't set Content-Length here - let middleware handle it
      this.end(str);
    }
    return this;
  }

  /**
   * Redirects the request to another URL.
   * Uses 302 as default status for temporary redirects, but you can
   * specify 301 for permanent redirects or other 3xx codes.
   * 
   * @param {string} url - URL to redirect to
   * @param {number} [status=302] - HTTP status code (301, 302, 303, 307, 308)
   * @returns {Response} This response instance for chaining
   * @example
   * res.redirect('/login');  // 302 temporary redirect
   * res.redirect('/new-url', 301);  // 301 permanent redirect
   */
  redirect(url, status = 302) {
    this.set('Location', url);
    this.status(status);
    this.end();
    return this;
  }

  /**
   * Signs a cookie value using HMAC-SHA256.
   * Uses HMAC-SHA256 with URL-safe Base64 encoding to create
   * tamper-proof cookie signatures.
   * 
   * @private
   * @param {string} value - Value to sign
   * @returns {string} Signed value in format 'value.signature'
   * @throws {Error} If cookie secret is not configured
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
   * Serializes a cookie into Set-Cookie header format.
   * Implements full cookie specification with all security attributes.
   * HttpOnly is enabled by default for security, preventing XSS attacks.
   * 
   * @private
   * @param {string} name - Cookie name
   * @param {*} value - Cookie value (will be converted to string)
   * @param {Object} [options={}] - Cookie options
   * @returns {string} Serialized cookie string for Set-Cookie header
   * @throws {Error} If cookie name is invalid or options are incorrect
   */
  #serializeCookie(name, value, options = {}) {
    // Validate cookie name
    if (!name || typeof name !== 'string') {
      throw new TypeError('Cookie name must be a non-empty string');
    }
    
    // Check for invalid characters in cookie name
    if (/[=;,\s]/.test(name)) {
      throw new Error(`Invalid cookie name: ${name}`);
    }
    
    // Convert value to string
    let cookieValue = String(value);
    
    // Sign the cookie if requested
    if (options.signed) {
      if (!this.#cookieSecret) {
        throw new Error('Cookie secret not configured for signed cookies');
      }
      cookieValue = this.#signCookieValue(cookieValue);
    }
    
    // Build cookie string
    const cookieParts = [`${encodeURIComponent(name)}=${encodeURIComponent(cookieValue)}`];
    
    // Add cookie options
    if (options.expires) {
      if (!(options.expires instanceof Date)) {
        throw new TypeError('expires option must be a Date object');
      }
      cookieParts.push(`Expires=${options.expires.toUTCString()}`);
    }
    
    if (options.maxAge !== undefined) {
      // Convert maxAge to seconds (if provided in milliseconds)
      const maxAgeSeconds = Math.floor(options.maxAge / 1000);
      cookieParts.push(`Max-Age=${maxAgeSeconds}`);
    }
    
    if (options.domain) {
      cookieParts.push(`Domain=${options.domain}`);
    }
    
    if (options.path !== undefined) {
      cookieParts.push(`Path=${options.path}`);
    } else {
      cookieParts.push('Path=/'); // Default path
    }
    
    // Default httpOnly to true for security (unless explicitly set to false)
    if (options.httpOnly !== false) {
      cookieParts.push('HttpOnly');
    }
    
    if (options.secure) {
      cookieParts.push('Secure');
    }
    
    if (options.sameSite) {
      const validSameSite = ['strict', 'lax', 'none'];
      const sameSiteValue = options.sameSite.toLowerCase();
      if (!validSameSite.includes(sameSiteValue)) {
        throw new Error(`Invalid sameSite value: ${options.sameSite}`);
      }
      // Capitalize first letter
      const formatted = sameSiteValue.charAt(0).toUpperCase() + sameSiteValue.slice(1);
      cookieParts.push(`SameSite=${formatted}`);
    }
    
    return cookieParts.join('; ');
  }

  /**
   * Sets a cookie with comprehensive options and signing support.
   * Provides full cookie specification support including security attributes.
   * HttpOnly is enabled by default to prevent XSS attacks.
   * 
   * @param {string} name - Cookie name
   * @param {*} value - Cookie value (will be converted to string)
   * @param {Object} [options={}] - Cookie options
   * @param {number} [options.maxAge] - Max age in milliseconds
   * @param {Date} [options.expires] - Expiration date
   * @param {boolean} [options.httpOnly=true] - HttpOnly flag (prevents JavaScript access)
   * @param {boolean} [options.secure] - Secure flag (HTTPS only)
   * @param {string} [options.sameSite] - SameSite attribute ('strict'|'lax'|'none')
   * @param {string} [options.domain] - Cookie domain
   * @param {string} [options.path='/'] - Cookie path
   * @param {boolean} [options.signed] - Sign the cookie value for tamper detection
   * @returns {Response} This response instance for chaining
   * @example
   * res.cookie('session', 'abc123', { 
   *   httpOnly: true, 
   *   secure: true, 
   *   sameSite: 'strict',
   *   maxAge: 24 * 60 * 60 * 1000 // 24 hours
   * });
   */
  cookie(name, value, options = {}) {
    try {
      const cookieString = this.#serializeCookie(name, value, options);
      this.append('Set-Cookie', cookieString);
      return this;
    } catch (err) {
      // Silently fail for invalid cookies
      return this;
    }
  }

  /**
   * Clears a cookie by setting it with an expired date.
   * Sets the expiration to epoch time (Jan 1, 1970) to ensure
   * the browser deletes the cookie. Options must match the original cookie.
   * 
   * @param {string} name - Cookie name to clear
   * @param {Object} [options={}] - Options (must match original cookie's domain/path)
   * @returns {Response} This response instance for chaining
   * @example
   * res.clearCookie('session');
   * res.clearCookie('user', { domain: '.example.com', path: '/admin' });
   */
  clearCookie(name, options = {}) {
    const clearOptions = {
      ...options,
      expires: new Date(1), // Set to past date
      maxAge: undefined // Remove maxAge to use expires instead
    };
    // Don't sign when clearing
    delete clearOptions.signed;
    
    return this.cookie(name, '', clearOptions);
  }

  /**
   * Sets the Content-Type header.
   * Provides shortcuts for common MIME types to make the API more convenient.
   * 
   * @param {string} type - MIME type or shortcut ('html', 'json', 'text', etc.)
   * @returns {Response} This response instance for chaining
   * @example
   * res.type('json');  // Sets 'application/json'
   * res.type('html');  // Sets 'text/html; charset=utf-8'
   * res.type('text/plain');  // Sets custom MIME type directly
   */
  type(type) {
    // Handle common shortcuts
    const mimeTypes = {
      'html': 'text/html; charset=utf-8',
      'text': 'text/plain; charset=utf-8',
      'json': 'application/json',
      'xml': 'application/xml',
      'js': 'application/javascript',
      'css': 'text/css',
      'png': 'image/png',
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'gif': 'image/gif',
      'svg': 'image/svg+xml',
      'pdf': 'application/pdf',
      'zip': 'application/zip'
    };
    
    // Check if it's a shortcut or full MIME type
    const contentType = mimeTypes[type] || type;
    this.set('Content-Type', contentType);
    return this;
  }

  /**
   * Sets response headers.
   * Supports both single header and object notation for flexibility.
   * 
   * @param {string|Object} field - Header name or object of headers
   * @param {string} [value] - Header value (if field is a string)
   * @returns {Response} This response instance for chaining
   * @example
   * res.set('X-Custom-Header', 'value');
   * res.set({ 'X-Custom-1': 'value1', 'X-Custom-2': 'value2' });
   */
  set(field, value) {
    if (typeof field === 'object') {
      // Handle object notation
      for (const [key, val] of Object.entries(field)) {
        this.#headers[key] = val;
      }
    } else {
      this.#headers[field] = value;
    }
    return this;
  }

  /**
   * Gets a response header value (case-insensitive).
   * Checks exact match first for performance, then falls back
   * to case-insensitive search for compatibility.
   * 
   * @param {string} field - Header name to retrieve
   * @returns {string|undefined} Header value or undefined if not set
   * @example
   * const contentType = res.getHeader('Content-Type');
   */
  getHeader(field) {
    // Try exact match first
    if (this.#headers[field] !== undefined) {
      return this.#headers[field];
    }
    // Try case-insensitive match
    const lowerField = field.toLowerCase();
    for (const key in this.#headers) {
      if (key.toLowerCase() === lowerField) {
        return this.#headers[key];
      }
    }
    return undefined;
  }
  
  /**
   * Gets a response header value (alias for getHeader).
   * Provides this alias for Express compatibility.
   * 
   * @param {string} field - Header name to retrieve
   * @returns {string|undefined} Header value or undefined if not set
   * @example
   * const contentType = res.get('Content-Type');
   */
  get(field) {
    return this.getHeader(field);
  }
  
  /**
   * Sets a response header (Node.js compatibility).
   * Provides this method for compatibility with Node.js HTTP module.
   * 
   * @param {string} field - Header name
   * @param {string} value - Header value
   * @returns {Response} This response instance for chaining
   * @example
   * res.setHeader('X-Custom-Header', 'value');
   */
  setHeader(field, value) {
    this.#headers[field] = value;
    return this;
  }
  
  /**
   * Removes a response header.
   * Provides this for cases where you need to unset a previously set header.
   * 
   * @param {string} field - Header name to remove
   * @returns {Response} This response instance for chaining
   * @example
   * res.removeHeader('X-Powered-By');
   */
  removeHeader(field) {
    delete this.#headers[field];
    return this;
  }

  /**
   * Appends a value to a response header.
   * Handles multiple values for headers that support them (like Set-Cookie).
   * If the header doesn't exist, it's created. If it exists, the value is appended.
   * 
   * @param {string} field - Header name
   * @param {string} value - Value to append
   * @returns {Response} This response instance for chaining
   * @example
   * res.append('Set-Cookie', 'foo=bar');
   * res.append('Set-Cookie', 'baz=qux');  // Multiple Set-Cookie headers
   */
  append(field, value) {
    const existing = this.#headers[field];
    if (!existing) {
      this.#headers[field] = value;
    } else if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      this.#headers[field] = [existing, value];
    }
    return this;
  }

  /**
   * Checks if headers have been sent to the client.
   * Tracks this to prevent errors from trying to modify headers
   * after they've been sent.
   * 
   * @returns {boolean} True if headers have been sent
   * @example
   * if (!res.headersSent) {
   *   res.set('X-Custom', 'value');
   * }
   */
  get headersSent() {
    return this.#headersSent;
  }
  
  /**
   * Checks if the response has finished.
   * Delegates to the native response's finished property.
   * 
   * @returns {boolean} True if response has finished
   * @example
   * if (!res.finished) {
   *   res.send('data');
   * }
   */
  get finished() {
    return this.#nativeResponse.finished;
  }
  
  /**
   * Gets the internal headers object.
   * Exposes this with underscore prefix to indicate it's for
   * internal/middleware use only.
   * 
   * @returns {Object<string, string|string[]>} Headers object
   * @private
   */
  get _headers() {
    return this.#headers;
  }

  /**
   * Gets the native response object.
   * Exposes this for middleware that needs direct access to
   * Node.js response features not wrapped by this class.
   * 
   * @returns {http.ServerResponse} Native response object
   * @private
   */
  get _nativeResponse() {
    return this.#nativeResponse;
  }
  
  /**
   * Gets response-specific locals for template rendering.
   * Uses locals to pass data to view templates that's specific
   * to this response (as opposed to app-wide locals).
   * 
   * @returns {Object|null} Response locals object
   * @example
   * res.locals.user = req.user;
   * res.render('profile');  // Template has access to locals.user
   */
  get locals() {
    return this.#locals;
  }

  /**
   * Sets response-specific locals for template rendering.
   * Only accepts objects to ensure locals remains a proper container.
   * 
   * @param {Object} locals - Locals object to set
   */
  set locals(locals) {
    if (typeof locals === 'object' && locals !== null) {
      this.#locals = locals;
    }
  }

  /**
   * Renders a view using the configured template engine.
   * Supports both callback and Promise-based APIs for flexibility.
   * The view engine must be configured via app.engine() before using this.
   * 
   * @param {string} view - View name or path (without extension if configured)
   * @param {Object|Function} [data={}] - Data to pass to template, or callback
   * @param {Function} [callback] - Optional callback (err, html)
   * @returns {Promise<string>|void} Promise if no callback, void if callback provided
   * @throws {Error} If no view engine is configured
   * @example
   * // With callback
   * res.render('index', { title: 'Home' }, (err, html) => {
   *   if (err) console.error(err);
   * });
   * 
   * // With Promise
   * await res.render('index', { title: 'Home' });
   */
  render(view, data, callback) {
    // Handle optional data parameter
    if (typeof data === 'function') {
      callback = data;
      data = {};
    }
    
    data = data || {};
    
    // Check if view engine is configured
    if (!this.#viewEngine) {
      const error = new Error('No view engine configured. Use app.engine() to register a template engine.');
      if (callback) {
        callback(error);
        return;
      }
      throw error;
    }
    
    const options = {
      locals: this.#locals
    };
    
    const renderPromise = this.#viewEngine.render(view, data, options)
      .then(html => {
        this.type('html').send(html);
        return html;
      })
      .catch(err => {
        if (err.message && err.message.includes('Failed to find view')) {
          err.message = `View rendering failed: ${err.message}\n` +
                       `Make sure you have configured view directories with app.set('views', path)`;
        } else if (err.message && err.message.includes('No template engine registered')) {
          err.message = `View rendering failed: ${err.message}\n` +
                       `Use app.engine('ext', engine) to register a template engine`;
        }
        throw err;
      });
    
    if (callback) {
      renderPromise
        .then(html => callback(null, html))
        .catch(err => callback(err));
    } else {
      return renderPromise;
    }
  }

  /**
   * Sends a file with proper headers and streaming.
   * Detects MIME types, sets cache headers, and streams the file
   * efficiently. Includes ETag and Last-Modified headers for caching.
   * 
   * @param {string} filePath - Path to the file to send
   * @param {Object} [options={}] - Options for sending the file
   * @param {number} [options.maxAge] - Cache max-age in seconds
   * @param {boolean} [options.etag=true] - Whether to generate ETag
   * @param {boolean} [options.lastModified=true] - Whether to set Last-Modified
   * @returns {Promise<Response>} This response instance for chaining
   * @example
   * res.sendFile('/path/to/file.pdf');
   * res.sendFile('./public/image.png', { maxAge: 3600 });  // Cache for 1 hour
   */
  async sendFile(filePath, options = {}) {
    try {
      // Resolve to absolute path
      const absolutePath = path.resolve(filePath);
      
      // Check if file exists and get stats
      const stat = await promisify(fs.stat)(absolutePath);
      
      if (!stat.isFile()) {
        this.status(404).send('Not Found');
        return this;
      }
      
      // Detect MIME type from extension
      const ext = path.extname(absolutePath).slice(1).toLowerCase();
      const mimeTypes = {
        'html': 'text/html; charset=utf-8',
        'htm': 'text/html; charset=utf-8',
        'css': 'text/css',
        'js': 'application/javascript',
        'json': 'application/json',
        'xml': 'application/xml',
        'txt': 'text/plain; charset=utf-8',
        'png': 'image/png',
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'gif': 'image/gif',
        'svg': 'image/svg+xml',
        'ico': 'image/x-icon',
        'pdf': 'application/pdf',
        'zip': 'application/zip',
        'mp3': 'audio/mpeg',
        'mp4': 'video/mp4',
        'webm': 'video/webm',
        'woff': 'font/woff',
        'woff2': 'font/woff2',
        'ttf': 'font/ttf',
        'otf': 'font/otf'
      };
      
      const contentType = mimeTypes[ext] || 'application/octet-stream';
      
      // Set headers
      this.set('Content-Type', contentType);
      this.set('Content-Length', stat.size);
      
      // Add cache headers if specified
      if (options.maxAge !== undefined) {
        this.set('Cache-Control', `public, max-age=${options.maxAge}`);
      }
      
      // Add ETag if requested
      if (options.etag !== false) {
        const etag = `"${stat.size}-${stat.mtime.getTime()}"`;
        this.set('ETag', etag);
      }
      
      // Add Last-Modified
      if (options.lastModified !== false) {
        this.set('Last-Modified', stat.mtime.toUTCString());
      }
      
      // Stream the file
      if (!this.#headersSent) {
        this.#nativeResponse.writeHead(this.#statusCode, this.#headers);
        this.#headersSent = true;
      }
      
      const stream = fs.createReadStream(absolutePath);
      
      // Handle stream errors
      stream.on('error', (err) => {
        if (!this.#nativeResponse.headersSent) {
          this.status(500).send('Internal Server Error');
        } else {
          this.#nativeResponse.end();
        }
      });
      
      // Pipe the file to response
      stream.pipe(this.#nativeResponse);
      
    } catch (err) {
      // Handle file not found or other errors
      if (err.code === 'ENOENT') {
        this.status(404).send('Not Found');
      } else {
        this.status(500).send('Internal Server Error');
      }
    }
    
    return this;
  }

  /**
   * Pipes this response to another stream.
   * Delegates to the native response for stream compatibility.
   * 
   * @param {...any} args - Arguments to pass to native pipe method
   * @returns {Stream} The destination stream
   */
  pipe(...args) {
    return this.#nativeResponse.pipe(...args);
  }

  /**
   * Writes data to the response stream.
   * Ensures headers are sent before writing to prevent errors.
   * Useful for streaming responses or Server-Sent Events.
   * 
   * @param {...any} args - Arguments to pass to native write method
   * @returns {boolean} True if data was flushed, false if buffered
   * @example
   * res.write('data: Hello\n\n');  // Server-Sent Event
   */
  write(...args) {
    // Ensure headers are sent before writing
    if (!this.#nativeResponse.headersSent) {
      this.writeHead(this.#statusCode, this.#headers);
      this.#headersSent = true;
    }
    return this.#nativeResponse.write(...args);
  }

  /**
   * Adds an event listener to the response.
   * Delegates to native response for EventEmitter compatibility.
   * 
   * @param {...any} args - Arguments for event listener
   * @returns {Response} This response instance
   */
  on(...args) {
    return this.#nativeResponse.on(...args);
  }

  /**
   * Adds a one-time event listener to the response.
   * Delegates to native response for EventEmitter compatibility.
   * 
   * @param {...any} args - Arguments for event listener
   * @returns {Response} This response instance
   */
  once(...args) {
    return this.#nativeResponse.once(...args);
  }

  /**
   * Emits an event on the response.
   * Delegates to native response for EventEmitter compatibility.
   * 
   * @param {...any} args - Arguments for event emission
   * @returns {boolean} True if event had listeners
   */
  emit(...args) {
    return this.#nativeResponse.emit(...args);
  }

  /**
   * Adds an event listener (alias for on).
   * Delegates to native response for EventEmitter compatibility.
   * 
   * @param {...any} args - Arguments for event listener
   * @returns {Response} This response instance
   */
  addListener(...args) {
    return this.#nativeResponse.addListener(...args);
  }

  /**
   * Removes an event listener.
   * Delegates to native response for EventEmitter compatibility.
   * 
   * @param {...any} args - Arguments for removing listener
   * @returns {Response} This response instance
   */
  removeListener(...args) {
    return this.#nativeResponse.removeListener(...args);
  }

  /**
   * Checks if the response is writable.
   * Exposes stream state for compatibility with stream-based middleware.
   * 
   * @returns {boolean} True if response is writable
   */
  get writable() {
    return this.#nativeResponse.writable;
  }

  /**
   * Checks if the response writing has ended.
   * Exposes this for middleware that needs to know if end() was called.
   * 
   * @returns {boolean} True if writing has ended
   */
  get writableEnded() {
    return this.#nativeResponse.writableEnded;
  }

  /**
   * Checks if the response writing has finished.
   * Exposes this for middleware that needs to know if all data was flushed.
   * 
   * @returns {boolean} True if writing has finished
   */
  get writableFinished() {
    return this.#nativeResponse.writableFinished;
  }

}

module.exports = Response;