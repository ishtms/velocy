const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { promisify } = require("node:util");

class Response {
  #nativeResponse;
  #headers;
  #statusCode;
  #headersSent;
  #cookieSecret;
  #pendingCookies;
  #viewEngine;
  #locals;

  constructor(nativeResponse, options = {}) {
    this.#nativeResponse = nativeResponse;
    this.#headers = {};
    this.#statusCode = 200;
    this.#headersSent = false;
    this.#cookieSecret = options.cookieSecret || null;
    this.#pendingCookies = [];
    this.#viewEngine = options.viewEngine || null;
    this.#locals = Object.create(null);
  }

  // Original methods maintained for backward compatibility
  writeHead(statusCode, headers) {
    this.#nativeResponse.writeHead(statusCode, headers);
    this.#headersSent = true;
  }

  end(data) {
    if (!this.#headersSent) {
      this.#nativeResponse.writeHead(this.#statusCode, this.#headers);
    }
    this.#nativeResponse.end(data);
  }

  // Set status code with chaining support
  status(code) {
    this.#statusCode = code;
    return this;
  }

  // Send JSON response with proper content-type
  json(data) {
    this.set('Content-Type', 'application/json');
    const jsonString = JSON.stringify(data);
    this.set('Content-Length', Buffer.byteLength(jsonString));
    this.end(jsonString);
    return this;
  }

  // Smart send that handles strings, objects, buffers
  send(data) {
    if (data === null || data === undefined) {
      this.end('');
    } else if (Buffer.isBuffer(data)) {
      // Send buffer as-is
      if (!this.#headers['Content-Type']) {
        this.set('Content-Type', 'application/octet-stream');
      }
      this.set('Content-Length', data.length);
      this.end(data);
    } else if (typeof data === 'object') {
      // Send as JSON
      this.json(data);
    } else if (typeof data === 'string') {
      // Send as HTML/text
      if (!this.#headers['Content-Type']) {
        this.set('Content-Type', 'text/html; charset=utf-8');
      }
      this.set('Content-Length', Buffer.byteLength(data));
      this.end(data);
    } else {
      // Convert to string for other types
      const str = String(data);
      this.set('Content-Length', Buffer.byteLength(str));
      this.end(str);
    }
    return this;
  }

  // Handle redirects
  redirect(url, status = 302) {
    this.set('Location', url);
    this.status(status);
    this.end();
    return this;
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
   * Serializes a cookie into Set-Cookie header format
   * @private
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
   * Set cookies with comprehensive options and signing support
   * @param {string} name - Cookie name
   * @param {*} value - Cookie value (will be converted to string)
   * @param {Object} options - Cookie options
   * @param {number} options.maxAge - Max age in milliseconds
   * @param {Date} options.expires - Expiration date
   * @param {boolean} options.httpOnly - HttpOnly flag (default: true)
   * @param {boolean} options.secure - Secure flag (HTTPS only)
   * @param {string} options.sameSite - SameSite attribute ('strict'|'lax'|'none')
   * @param {string} options.domain - Cookie domain
   * @param {string} options.path - Cookie path (default: '/')
   * @param {boolean} options.signed - Sign the cookie value
   * @returns {Response} For chaining
   */
  cookie(name, value, options = {}) {
    try {
      const cookieString = this.#serializeCookie(name, value, options);
      this.append('Set-Cookie', cookieString);
      return this;
    } catch (err) {
      // Log error in development
      if (process.env.NODE_ENV !== 'production') {
        console.error('Cookie error:', err.message);
      }
      return this;
    }
  }

  /**
   * Clear a cookie by setting it with an expired date
   * @param {string} name - Cookie name
   * @param {Object} options - Options (must match original cookie)
   * @returns {Response} For chaining
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

  // Set content-type header
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

  // Set response headers
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

  // Append to headers (handle multiple values)
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

  // Get headersSent status (for middleware compatibility)
  get headersSent() {
    return this.#headersSent;
  }
  
  // Get finished status (for middleware compatibility)
  get finished() {
    return this.#nativeResponse.finished;
  }

  /**
   * Gets response-specific locals for template rendering
   * @returns {Object} Response locals object
   */
  get locals() {
    return this.#locals;
  }

  /**
   * Sets response-specific locals for template rendering
   * @param {Object} locals - Locals to set
   */
  set locals(locals) {
    if (typeof locals === 'object' && locals !== null) {
      this.#locals = locals;
    }
  }

  /**
   * Renders a view using the configured template engine
   * @param {string} view - View name or path
   * @param {Object|Function} data - Data to pass to template, or callback
   * @param {Function} callback - Optional callback (err, html)
   * @returns {Promise|void} Promise if no callback, void if callback provided
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
    
    // Prepare rendering options
    const options = {
      locals: this.#locals
    };
    
    // Async rendering
    const renderPromise = this.#viewEngine.render(view, data, options)
      .then(html => {
        // Send the rendered HTML
        this.type('html').send(html);
        return html;
      })
      .catch(err => {
        // Enhanced error messages
        if (err.message && err.message.includes('Failed to find view')) {
          err.message = `View rendering failed: ${err.message}\n` +
                       `Make sure you have configured view directories with app.set('views', path)`;
        } else if (err.message && err.message.includes('No template engine registered')) {
          err.message = `View rendering failed: ${err.message}\n` +
                       `Use app.engine('ext', engine) to register a template engine`;
        }
        throw err;
      });
    
    // Handle callback or return promise
    if (callback) {
      renderPromise
        .then(html => callback(null, html))
        .catch(err => callback(err));
    } else {
      return renderPromise;
    }
  }

  // Send files with proper headers and error handling
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
}

module.exports = Response;