/**
 * CORS middleware factory for Velocy
 * Creates configurable CORS middleware that handles preflight requests and CORS headers
 * 
 * @param {Object|Function|String|RegExp|Array} options - CORS configuration options or origin value
 * @param {String|RegExp|Array|Function|Boolean} options.origin - Allowed origins
 *   - String: exact origin match (e.g., 'https://example.com')
 *   - RegExp: pattern match (e.g., /\.example\.com$/)
 *   - Array: list of allowed origins (string or RegExp)
 *   - Function: dynamic validation (origin, callback) => callback(err, allow)
 *   - Boolean: true allows reflected origin, false disables CORS
 *   - '*': wildcard (cannot be used with credentials)
 * @param {Array<String>} options.methods - Allowed HTTP methods (default: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'])
 * @param {Array<String>|String} options.allowedHeaders - Allowed request headers or '*'
 * @param {Array<String>} options.exposedHeaders - Headers exposed to the client
 * @param {Boolean} options.credentials - Enable Access-Control-Allow-Credentials (default: false)
 * @param {Number} options.maxAge - Preflight cache duration in seconds (default: undefined)
 * @param {Boolean} options.preflightContinue - Pass control to next handler after preflight (default: false)
 * @param {Number} options.optionsSuccessStatus - Status code for successful OPTIONS (default: 204)
 * @returns {Function} CORS middleware function
 */
function cors(options = {}) {
  // Handle shorthand: cors('origin') or cors(/pattern/)
  if (typeof options === 'string' || options instanceof RegExp) {
    options = { origin: options };
  }
  
  // Default configuration
  const config = {
    origin: '*',  // Allow all origins by default
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: null,
    exposedHeaders: null,
    credentials: false,
    maxAge: null,
    preflightContinue: false,
    optionsSuccessStatus: 204,
    ...options
  };
  
  // Validate configuration
  if (config.credentials === true && config.origin === '*') {
    throw new Error('CORS: Cannot use credentials with wildcard origin (*)');
  }
  
  // Pre-compile RegExp patterns for performance
  const originPatterns = Array.isArray(config.origin)
    ? config.origin.map(o => o instanceof RegExp ? o : null).filter(Boolean)
    : config.origin instanceof RegExp ? [config.origin] : [];
  
  // Pre-compute static headers
  const methodsHeader = Array.isArray(config.methods) 
    ? config.methods.join(', ').toUpperCase()
    : config.methods;
  
  /**
   * Validates an origin against the configured allowed origins
   * @private
   */
  const isOriginAllowed = (origin, callback) => {
    // Handle various origin configurations
    const { origin: allowedOrigin } = config;
    
    // No origin (same-origin request) or CORS disabled
    if (!origin || allowedOrigin === false) {
      return callback(null, false);
    }
    
    // Wildcard
    if (allowedOrigin === '*') {
      return callback(null, true);
    }
    
    // Reflected origin (any origin)
    if (allowedOrigin === true) {
      return callback(null, true);
    }
    
    // Function for dynamic validation
    if (typeof allowedOrigin === 'function') {
      return allowedOrigin(origin, callback);
    }
    
    // String exact match
    if (typeof allowedOrigin === 'string') {
      return callback(null, origin === allowedOrigin);
    }
    
    // RegExp pattern match
    if (allowedOrigin instanceof RegExp) {
      return callback(null, allowedOrigin.test(origin));
    }
    
    // Array of origins
    if (Array.isArray(allowedOrigin)) {
      for (const allowed of allowedOrigin) {
        if (typeof allowed === 'string' && origin === allowed) {
          return callback(null, true);
        }
        if (allowed instanceof RegExp && allowed.test(origin)) {
          return callback(null, true);
        }
      }
      return callback(null, false);
    }
    
    return callback(null, false);
  };
  
  /**
   * Sets CORS headers on the response
   * @private
   */
  const setCorsHeaders = (req, res, origin, isPreflight = false) => {
    // Access-Control-Allow-Origin
    if (config.origin === '*' && !config.credentials) {
      res.set('Access-Control-Allow-Origin', '*');
    } else if (origin) {
      res.set('Access-Control-Allow-Origin', origin);
      // Add Vary header when origin is dynamic
      if (config.origin !== origin && config.origin !== true) {
        // Get existing Vary header value
        const existing = res.headersSent ? null : Object.entries(res._headers || {})
          .find(([key]) => key.toLowerCase() === 'vary');
        const varyHeader = existing ? existing[1] : null;
        
        if (!varyHeader) {
          res.set('Vary', 'Origin');
        } else if (!varyHeader.includes('Origin')) {
          res.set('Vary', `${varyHeader}, Origin`);
        }
      }
    }
    
    // Access-Control-Allow-Credentials
    if (config.credentials === true) {
      res.set('Access-Control-Allow-Credentials', 'true');
    }
    
    // Preflight-specific headers
    if (isPreflight) {
      // Access-Control-Allow-Methods
      if (methodsHeader) {
        res.set('Access-Control-Allow-Methods', methodsHeader);
      }
      
      // Access-Control-Allow-Headers
      if (config.allowedHeaders) {
        const headers = Array.isArray(config.allowedHeaders)
          ? config.allowedHeaders.join(', ')
          : config.allowedHeaders;
        res.set('Access-Control-Allow-Headers', headers);
      } else {
        // Reflect the requested headers if not configured
        const requestedHeaders = req.headers['access-control-request-headers'];
        if (requestedHeaders) {
          res.set('Access-Control-Allow-Headers', requestedHeaders);
        }
      }
      
      // Access-Control-Max-Age
      if (config.maxAge != null) {
        res.set('Access-Control-Max-Age', String(config.maxAge));
      }
    } else {
      // Non-preflight: Access-Control-Expose-Headers
      if (config.exposedHeaders) {
        const exposed = Array.isArray(config.exposedHeaders)
          ? config.exposedHeaders.join(', ')
          : config.exposedHeaders;
        res.set('Access-Control-Expose-Headers', exposed);
      }
    }
  };
  
  /**
   * CORS middleware function
   */
  return function corsMiddleware(req, res, next) {
    const origin = req.headers.origin;
    const method = req.method;
    
    // Check if this is a preflight request
    const isPreflight = method === 'OPTIONS' && 
      req.headers['access-control-request-method'];
    
    // Validate origin
    isOriginAllowed(origin, (err, allowed) => {
      if (err) {
        // Error in origin validation
        return next ? next(err) : res.status(500).send('Internal Server Error');
      }
      
      if (!allowed) {
        // Origin not allowed
        if (isPreflight) {
          // Respond to preflight without CORS headers
          return res.status(config.optionsSuccessStatus).end();
        }
        // Continue without setting CORS headers for regular requests
        return next ? next() : undefined;
      }
      
      // Set CORS headers
      setCorsHeaders(req, res, origin === 'null' ? 'null' : origin, isPreflight);
      
      // Handle preflight request
      if (isPreflight) {
        // Check if requested method is allowed
        const requestedMethod = req.headers['access-control-request-method'];
        const methodAllowed = config.methods.some(m => 
          m.toUpperCase() === requestedMethod.toUpperCase()
        );
        
        if (!methodAllowed) {
          // Method not allowed
          return res.status(config.optionsSuccessStatus).end();
        }
        
        // End preflight response unless configured to continue
        if (!config.preflightContinue) {
          return res.status(config.optionsSuccessStatus).end();
        }
      }
      
      // Continue to next middleware
      if (next) {
        next();
      }
    });
  };
}

/**
 * Create CORS middleware with common presets
 */
cors.withCredentials = function(origin) {
  return cors({
    origin,
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    exposedHeaders: ['Content-Length', 'Date', 'X-Request-Id']
  });
};

cors.allowAll = function() {
  return cors({
    origin: true,
    credentials: false,
    allowedHeaders: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']
  });
};

cors.restrictTo = function(origins) {
  return cors({
    origin: origins,
    credentials: false,
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400 // 24 hours
  });
};

module.exports = cors;