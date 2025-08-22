/**
 * Rate Limiting Middleware for Velocy Framework
 * 
 * Provides comprehensive rate limiting with multiple algorithms:
 * - Token Bucket Algorithm
 * - Fixed Window Counter
 * - Sliding Window Counter
 * 
 * Features:
 * - Zero external dependencies
 * - Memory-efficient with automatic cleanup
 * - IP-based limiting with proxy support
 * - Custom key generation
 * - Standard rate limit headers
 * - Bypass conditions
 * - Distributed rate limiting interface
 * 
 * @module middleware/rateLimit
 */

const { EventEmitter } = require('node:events');
const crypto = require('node:crypto');

/**
 * Token Bucket implementation for rate limiting
 * Allows burst traffic while maintaining average rate
 */
class TokenBucket {
  /**
   * @param {number} capacity - Maximum number of tokens in the bucket
   * @param {number} refillRate - Tokens added per second
   * @param {number} initialTokens - Initial token count (defaults to capacity)
   */
  constructor(capacity, refillRate, initialTokens = null) {
    this.capacity = capacity;
    this.refillRate = refillRate;
    this.tokens = initialTokens !== null ? initialTokens : capacity;
    this.lastRefill = Date.now();
  }

  /**
   * Attempts to consume tokens from the bucket
   * @param {number} tokens - Number of tokens to consume (default: 1)
   * @returns {Object} { allowed: boolean, remaining: number, resetTime: number }
   */
  consume(tokens = 1) {
    this.refill();
    
    if (this.tokens >= tokens) {
      this.tokens -= tokens;
      return {
        allowed: true,
        remaining: Math.floor(this.tokens),
        resetTime: this.calculateResetTime()
      };
    }
    
    return {
      allowed: false,
      remaining: Math.floor(this.tokens),
      resetTime: this.calculateResetTime()
    };
  }

  /**
   * Refills tokens based on elapsed time
   * @private
   */
  refill() {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000; // Convert to seconds
    const tokensToAdd = elapsed * this.refillRate;
    
    this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }

  /**
   * Calculates when the bucket will be full again
   * @private
   */
  calculateResetTime() {
    const tokensNeeded = this.capacity - this.tokens;
    const secondsToFull = tokensNeeded / this.refillRate;
    return Date.now() + (secondsToFull * 1000);
  }

  /**
   * Gets current state of the bucket
   */
  getState() {
    this.refill();
    return {
      tokens: Math.floor(this.tokens),
      capacity: this.capacity,
      refillRate: this.refillRate,
      resetTime: this.calculateResetTime()
    };
  }
}

/**
 * Fixed Window Counter for rate limiting
 * Resets counter at fixed intervals
 */
class FixedWindowCounter {
  /**
   * @param {number} windowMs - Window duration in milliseconds
   * @param {number} max - Maximum requests per window
   */
  constructor(windowMs, max) {
    this.windowMs = windowMs;
    this.max = max;
    this.count = 0;
    this.windowStart = Date.now();
  }

  /**
   * Attempts to increment the counter
   * @returns {Object} { allowed: boolean, remaining: number, resetTime: number }
   */
  increment() {
    const now = Date.now();
    
    // Check if we need to reset the window
    if (now - this.windowStart >= this.windowMs) {
      this.count = 0;
      this.windowStart = now;
    }
    
    if (this.count < this.max) {
      this.count++;
      return {
        allowed: true,
        remaining: this.max - this.count,
        resetTime: this.windowStart + this.windowMs
      };
    }
    
    return {
      allowed: false,
      remaining: 0,
      resetTime: this.windowStart + this.windowMs
    };
  }

  /**
   * Gets current state of the counter
   */
  getState() {
    const now = Date.now();
    
    // Check if window has expired
    if (now - this.windowStart >= this.windowMs) {
      return {
        count: 0,
        max: this.max,
        resetTime: now + this.windowMs
      };
    }
    
    return {
      count: this.count,
      max: this.max,
      resetTime: this.windowStart + this.windowMs
    };
  }
}

/**
 * Sliding Window Counter for rate limiting
 * Provides smoother rate limiting than fixed windows
 */
class SlidingWindowCounter {
  /**
   * @param {number} windowMs - Window duration in milliseconds
   * @param {number} max - Maximum requests per window
   * @param {number} precision - Number of sub-windows for precision (default: 10)
   */
  constructor(windowMs, max, precision = 10) {
    this.windowMs = windowMs;
    this.max = max;
    this.precision = precision;
    this.subWindowMs = Math.ceil(windowMs / precision);
    this.requests = new Map(); // Timestamp -> count
  }

  /**
   * Attempts to increment the counter
   * @returns {Object} { allowed: boolean, remaining: number, resetTime: number }
   */
  increment() {
    const now = Date.now();
    this.cleanup(now);
    
    // Calculate current request count in the sliding window
    const windowStart = now - this.windowMs;
    let count = 0;
    
    for (const [timestamp, reqCount] of this.requests) {
      if (timestamp > windowStart) {
        count += reqCount;
      }
    }
    
    if (count < this.max) {
      // Add request to current sub-window
      const subWindow = Math.floor(now / this.subWindowMs) * this.subWindowMs;
      this.requests.set(subWindow, (this.requests.get(subWindow) || 0) + 1);
      
      return {
        allowed: true,
        remaining: this.max - count - 1,
        resetTime: now + this.windowMs
      };
    }
    
    // Find the oldest request timestamp to calculate accurate reset time
    let oldestTimestamp = now;
    for (const timestamp of this.requests.keys()) {
      if (timestamp > windowStart && timestamp < oldestTimestamp) {
        oldestTimestamp = timestamp;
      }
    }
    
    return {
      allowed: false,
      remaining: 0,
      resetTime: oldestTimestamp + this.windowMs
    };
  }

  /**
   * Removes expired entries from the requests map
   * @private
   */
  cleanup(now) {
    const windowStart = now - this.windowMs;
    for (const timestamp of this.requests.keys()) {
      if (timestamp <= windowStart) {
        this.requests.delete(timestamp);
      }
    }
  }

  /**
   * Gets current state of the counter
   */
  getState() {
    const now = Date.now();
    this.cleanup(now);
    
    const windowStart = now - this.windowMs;
    let count = 0;
    
    for (const [timestamp, reqCount] of this.requests) {
      if (timestamp > windowStart) {
        count += reqCount;
      }
    }
    
    return {
      count,
      max: this.max,
      resetTime: now + this.windowMs
    };
  }
}

/**
 * Memory store for rate limit data
 * Handles automatic cleanup of expired entries
 */
class MemoryStore extends EventEmitter {
  /**
   * @param {Object} options - Store configuration
   * @param {number} options.cleanupInterval - Cleanup interval in ms (default: 60000)
   * @param {number} options.maxEntries - Maximum entries before forced cleanup (default: 10000)
   */
  constructor(options = {}) {
    super();
    this.store = new Map();
    this.cleanupInterval = options.cleanupInterval || 60000; // 1 minute
    this.maxEntries = options.maxEntries || 10000;
    this.lastCleanup = Date.now();
    
    // Set up periodic cleanup
    this.cleanupTimer = setInterval(() => this.cleanup(), this.cleanupInterval);
    
    // Allow the timer to not keep the process alive
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  /**
   * Gets or creates a rate limiter instance for a key
   * @param {string} key - Unique identifier
   * @param {string} algorithm - Algorithm type
   * @param {Object} options - Algorithm options
   */
  get(key, algorithm, options) {
    // Check if we need emergency cleanup
    if (this.store.size > this.maxEntries) {
      this.cleanup(true);
    }
    
    let entry = this.store.get(key);
    
    if (!entry) {
      // Create new rate limiter based on algorithm
      let limiter;
      
      switch (algorithm) {
        case 'token-bucket':
          limiter = new TokenBucket(
            options.bucketCapacity || options.max || 100,
            options.refillRate || (options.max / (options.windowMs / 1000)) || 1,
            options.initialTokens
          );
          break;
          
        case 'sliding-window':
          limiter = new SlidingWindowCounter(
            options.windowMs || 60000,
            options.max || 100,
            options.precision
          );
          break;
          
        case 'fixed-window':
        default:
          limiter = new FixedWindowCounter(
            options.windowMs || 60000,
            options.max || 100
          );
          break;
      }
      
      entry = {
        limiter,
        algorithm,
        lastAccess: Date.now(),
        created: Date.now()
      };
      
      this.store.set(key, entry);
      this.emit('create', key);
    } else {
      entry.lastAccess = Date.now();
    }
    
    return entry.limiter;
  }

  /**
   * Removes expired entries from the store
   * @param {boolean} force - Force aggressive cleanup
   */
  cleanup(force = false) {
    const now = Date.now();
    const maxAge = force ? 300000 : 600000; // 5 or 10 minutes
    let removed = 0;
    
    for (const [key, entry] of this.store) {
      if (now - entry.lastAccess > maxAge) {
        this.store.delete(key);
        removed++;
      }
    }
    
    if (removed > 0) {
      this.emit('cleanup', removed);
    }
    
    this.lastCleanup = now;
  }

  /**
   * Manually removes a key from the store
   * @param {string} key - Key to remove
   */
  delete(key) {
    const deleted = this.store.delete(key);
    if (deleted) {
      this.emit('delete', key);
    }
    return deleted;
  }

  /**
   * Clears all entries from the store
   */
  clear() {
    const size = this.store.size;
    this.store.clear();
    this.emit('clear', size);
  }

  /**
   * Gets statistics about the store
   */
  getStats() {
    return {
      size: this.store.size,
      maxEntries: this.maxEntries,
      lastCleanup: this.lastCleanup,
      cleanupInterval: this.cleanupInterval
    };
  }

  /**
   * Destroys the store and cleans up resources
   */
  destroy() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.store.clear();
    this.removeAllListeners();
  }
}

/**
 * Distributed rate limiting interface
 * Provides hooks for external store integration
 */
class DistributedRateLimiter extends EventEmitter {
  /**
   * @param {Object} options - Configuration options
   * @param {Function} options.increment - Async function to increment counter
   * @param {Function} options.reset - Async function to reset counter
   * @param {Function} options.get - Async function to get current state
   */
  constructor(options = {}) {
    super();
    this.increment = options.increment || this.defaultIncrement;
    this.reset = options.reset || this.defaultReset;
    this.get = options.get || this.defaultGet;
  }

  /**
   * Default increment implementation (memory-based)
   * @private
   */
  async defaultIncrement(key, options) {
    // This would be replaced with Redis/Database calls
    throw new Error('Distributed increment not implemented. Provide custom increment function.');
  }

  /**
   * Default reset implementation
   * @private
   */
  async defaultReset(key) {
    throw new Error('Distributed reset not implemented. Provide custom reset function.');
  }

  /**
   * Default get implementation
   * @private
   */
  async defaultGet(key) {
    throw new Error('Distributed get not implemented. Provide custom get function.');
  }

  /**
   * Attempts to consume a request slot
   */
  async consume(key, options) {
    try {
      const result = await this.increment(key, options);
      this.emit('consume', key, result);
      return result;
    } catch (error) {
      this.emit('error', error);
      // Fail open or closed based on configuration
      return options.failOpen ? 
        { allowed: true, remaining: -1, resetTime: Date.now() } :
        { allowed: false, remaining: 0, resetTime: Date.now() };
    }
  }
}

/**
 * Extracts client IP address from request
 * Handles various proxy configurations
 * @private
 */
function extractIP(req, options = {}) {
  const { trustProxy = true, proxies = 1 } = options;
  
  if (trustProxy) {
    // Check X-Forwarded-For header
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
      const ips = forwarded.split(',').map(ip => ip.trim());
      // Get the IP at the specified proxy depth
      const targetIndex = Math.max(0, ips.length - proxies);
      return ips[targetIndex];
    }
    
    // Check X-Real-IP header
    const realIP = req.headers['x-real-ip'];
    if (realIP) {
      return realIP;
    }
    
    // Check X-Client-IP header
    const clientIP = req.headers['x-client-ip'];
    if (clientIP) {
      return clientIP;
    }
  }
  
  // Fall back to socket address
  const socket = req.socket || req.connection || (req.nativeRequest && req.nativeRequest.socket);
  if (socket && socket.remoteAddress) {
    // Handle IPv6 mapped IPv4 addresses
    const addr = socket.remoteAddress;
    if (addr.startsWith('::ffff:')) {
      return addr.substring(7);
    }
    return addr;
  }
  
  return '127.0.0.1'; // Default fallback
}

/**
 * Default key generator function
 * @private
 */
function defaultKeyGenerator(req) {
  return extractIP(req);
}

/**
 * Validates rate limit configuration
 * @private
 */
function validateConfig(options) {
  const config = { ...options };
  
  // Set defaults
  config.windowMs = config.windowMs || 60000; // 1 minute
  config.max = config.max || 100; // 100 requests per window
  config.algorithm = config.algorithm || 'fixed-window';
  config.keyGenerator = config.keyGenerator || defaultKeyGenerator;
  config.skipSuccessfulRequests = config.skipSuccessfulRequests || false;
  config.skipFailedRequests = config.skipFailedRequests || false;
  config.requestWasSuccessful = config.requestWasSuccessful || ((req, res) => res.statusCode < 400);
  config.message = config.message || 'Too many requests, please try again later.';
  config.statusCode = config.statusCode || 429;
  config.headers = config.headers !== false; // Default true
  config.standardHeaders = config.standardHeaders !== undefined ? config.standardHeaders : false;
  config.legacyHeaders = config.legacyHeaders !== undefined ? config.legacyHeaders : true;
  config.draft_polli_ratelimit_headers = config.draft_polli_ratelimit_headers || false;
  config.skipOptions = config.skipOptions || false;
  config.trustProxy = config.trustProxy !== false; // Default true
  config.proxies = config.proxies || 1;
  
  // Validate algorithm
  const validAlgorithms = ['fixed-window', 'sliding-window', 'token-bucket'];
  if (!validAlgorithms.includes(config.algorithm)) {
    throw new Error(`Invalid algorithm: ${config.algorithm}. Must be one of: ${validAlgorithms.join(', ')}`);
  }
  
  // Validate numeric values
  if (config.windowMs <= 0) {
    throw new Error('windowMs must be a positive number');
  }
  if (config.max <= 0) {
    throw new Error('max must be a positive number');
  }
  
  // Token bucket specific validation
  if (config.algorithm === 'token-bucket') {
    config.bucketCapacity = config.bucketCapacity || config.max;
    config.refillRate = config.refillRate || (config.max / (config.windowMs / 1000));
    
    if (config.bucketCapacity <= 0) {
      throw new Error('bucketCapacity must be a positive number');
    }
    if (config.refillRate <= 0) {
      throw new Error('refillRate must be a positive number');
    }
  }
  
  // Sliding window specific validation
  if (config.algorithm === 'sliding-window') {
    config.precision = config.precision || 10;
    if (config.precision < 1 || config.precision > 100) {
      throw new Error('precision must be between 1 and 100');
    }
  }
  
  return config;
}

/**
 * Creates rate limiting middleware for Velocy framework
 * 
 * @param {Object} options - Configuration options
 * @param {number} options.windowMs - Time window in milliseconds (default: 60000)
 * @param {number} options.max - Max requests per window (default: 100)
 * @param {string} options.algorithm - Algorithm: 'fixed-window', 'sliding-window', 'token-bucket' (default: 'fixed-window')
 * @param {Function} options.keyGenerator - Function to generate key from request (default: IP-based)
 * @param {string} options.message - Error message for rate limited requests
 * @param {number} options.statusCode - HTTP status code for rate limited requests (default: 429)
 * @param {boolean} options.headers - Whether to add rate limit headers (default: true)
 * @param {boolean} options.standardHeaders - Use standard RateLimit headers (default: false)
 * @param {boolean} options.legacyHeaders - Use legacy X-RateLimit headers (default: true)
 * @param {boolean} options.draft_polli_ratelimit_headers - Use draft RFC headers (default: false)
 * @param {boolean} options.skipSuccessfulRequests - Don't count successful requests (default: false)
 * @param {boolean} options.skipFailedRequests - Don't count failed requests (default: false)
 * @param {Function} options.requestWasSuccessful - Function to determine if request was successful
 * @param {Function} options.skip - Function to determine if request should be skipped
 * @param {Function} options.handler - Custom handler for rate limited requests
 * @param {Function} options.onLimitReached - Callback when limit is reached
 * @param {Object} options.store - Custom store instance (default: MemoryStore)
 * @param {boolean} options.trustProxy - Trust proxy headers for IP extraction (default: true)
 * @param {number} options.proxies - Number of proxies to trust (default: 1)
 * @param {Array} options.whitelist - IP addresses or patterns to whitelist
 * @param {Array} options.blacklist - IP addresses or patterns to blacklist
 * @param {Function} options.bypass - Custom bypass function
 * @param {boolean} options.skipOptions - Skip OPTIONS requests (default: false)
 * @param {number} options.bucketCapacity - Token bucket capacity (for token-bucket algorithm)
 * @param {number} options.refillRate - Token bucket refill rate per second (for token-bucket algorithm)
 * @param {number} options.precision - Sliding window precision (for sliding-window algorithm)
 * @param {boolean} options.distributed - Enable distributed rate limiting interface (default: false)
 * @param {Object} options.distributedConfig - Configuration for distributed rate limiting
 * @returns {Function} Middleware function
 */
function createRateLimiter(options = {}) {
  const config = validateConfig(options);
  
  // Create store
  const store = config.store || new MemoryStore({
    cleanupInterval: config.cleanupInterval,
    maxEntries: config.maxEntries
  });
  
  // Set up distributed rate limiter if needed
  let distributedLimiter = null;
  if (config.distributed && config.distributedConfig) {
    distributedLimiter = new DistributedRateLimiter(config.distributedConfig);
  }
  
  // Compile whitelist/blacklist patterns
  const whitelistPatterns = (config.whitelist || []).map(pattern => {
    if (pattern instanceof RegExp) return pattern;
    if (pattern.includes('*')) {
      // Convert wildcard to regex
      const regexStr = pattern
        .replace(/\./g, '\\.')
        .replace(/\*/g, '.*');
      return new RegExp(`^${regexStr}$`);
    }
    return pattern;
  });
  
  const blacklistPatterns = (config.blacklist || []).map(pattern => {
    if (pattern instanceof RegExp) return pattern;
    if (pattern.includes('*')) {
      const regexStr = pattern
        .replace(/\./g, '\\.')
        .replace(/\*/g, '.*');
      return new RegExp(`^${regexStr}$`);
    }
    return pattern;
  });
  
  /**
   * Rate limiting middleware function
   */
  async function rateLimitMiddleware(req, res, next) {
    // Skip OPTIONS requests if configured
    if (config.skipOptions && req.method === 'OPTIONS') {
      return next ? next() : undefined;
    }
    
    // Check skip function
    if (config.skip && await config.skip(req, res)) {
      return next ? next() : undefined;
    }
    
    // Generate key for this request
    const key = await config.keyGenerator(req);
    
    // Store limiter in request for later use
    let requestLimiter = null;
    
    // Check blacklist
    if (blacklistPatterns.length > 0) {
      const isBlacklisted = blacklistPatterns.some(pattern => {
        if (pattern instanceof RegExp) {
          return pattern.test(key);
        }
        return pattern === key;
      });
      
      if (isBlacklisted) {
        // Immediately reject blacklisted IPs
        res.status(403);
        return res.send('Forbidden');
      }
    }
    
    // Check whitelist
    if (whitelistPatterns.length > 0) {
      const isWhitelisted = whitelistPatterns.some(pattern => {
        if (pattern instanceof RegExp) {
          return pattern.test(key);
        }
        return pattern === key;
      });
      
      if (isWhitelisted) {
        return next ? next() : undefined;
      }
    }
    
    // Check custom bypass function
    if (config.bypass && await config.bypass(req, res)) {
      return next ? next() : undefined;
    }
    
    // Get rate limiter for this key
    let result;
    
    // Special handling for skipSuccessfulRequests or skipFailedRequests
    if (config.skipSuccessfulRequests || config.skipFailedRequests) {
      // Don't increment yet, just check current state
      if (distributedLimiter) {
        // For distributed, we need to peek without consuming
        // This is a limitation - distributed doesn't support this pattern well
        result = await distributedLimiter.consume(key, config);
      } else if (config.store && config.store.increment) {
        // For custom store, we need to check without incrementing
        // This is also a limitation of the simple interface
        const hits = await config.store.increment(key);
        result = {
          allowed: hits <= config.max,
          remaining: Math.max(0, config.max - hits),
          resetTime: Date.now() + config.windowMs
        };
      } else {
        // Use local memory store - we can check without incrementing
        requestLimiter = store.get(key, config.algorithm, config);
        
        // Get current state without consuming
        const state = requestLimiter.getState();
        result = {
          allowed: state.count < state.max,
          remaining: state.max - state.count,
          resetTime: state.resetTime
        };
      }
    } else {
      // Normal flow - increment immediately
      if (distributedLimiter) {
        // Use distributed rate limiter
        result = await distributedLimiter.consume(key, config);
      } else if (config.store && config.store.increment) {
        // Use custom store with increment/decrement interface
        const hits = await config.store.increment(key);
        result = {
          allowed: hits <= config.max,
          remaining: Math.max(0, config.max - hits),
          resetTime: Date.now() + config.windowMs
        };
      } else {
        // Use local memory store
        requestLimiter = store.get(key, config.algorithm, config);
        
        // Check rate limit based on algorithm
        if (config.algorithm === 'token-bucket') {
          result = requestLimiter.consume(config.cost || 1);
        } else {
          result = requestLimiter.increment();
        }
      }
    }
    
    // Store rate limit info on request object for use by handlers
    req.rateLimit = {
      limit: config.max,
      remaining: result.remaining,
      resetTime: result.resetTime,
      current: config.max - result.remaining
    };
    
    // Add rate limit headers if configured
    if (config.headers && res.set) {
      if (config.standardHeaders || config.draft_polli_ratelimit_headers) {
        // Use draft RFC headers (standard headers)
        res.set('RateLimit-Limit', String(config.max));
        res.set('RateLimit-Remaining', String(Math.max(0, result.remaining)));
        res.set('RateLimit-Reset', new Date(result.resetTime).toISOString());
        if (config.draft_polli_ratelimit_headers) {
          res.set('RateLimit-Policy', `${config.max};w=${Math.ceil(config.windowMs / 1000)}`);
        }
      }
      if (config.legacyHeaders) {
        // Use traditional X- headers
        res.set('X-RateLimit-Limit', String(config.max));
        res.set('X-RateLimit-Remaining', String(Math.max(0, result.remaining)));
        res.set('X-RateLimit-Reset', String(Math.ceil(result.resetTime / 1000)));
      }
      
      // Add Retry-After header when rate limited
      if (!result.allowed) {
        const retryAfter = Math.ceil((result.resetTime - Date.now()) / 1000);
        res.set('Retry-After', String(Math.max(1, retryAfter)));
      }
    }
    
    // Check if request is allowed
    if (!result.allowed) {
      // Call onLimitReached callback if provided
      if (config.onLimitReached) {
        config.onLimitReached(req, res, next);
      }
      
      // Use custom handler if provided
      if (config.handler) {
        return config.handler(req, res, next);
      }
      
      // Default handling
      res.status(config.statusCode);
      
      // Send appropriate response based on Accept header
      const acceptsJSON = req.headers && req.headers.accept && req.headers.accept.includes('application/json');
      
      if (acceptsJSON) {
        return res.json({
          error: config.message,
          retryAfter: Math.ceil((result.resetTime - Date.now()) / 1000),
          limit: config.max,
          remaining: Math.max(0, result.remaining),
          reset: new Date(result.resetTime).toISOString()
        });
      } else {
        return res.send(config.message);
      }
    }
    
    // Request is allowed, but we might need to track response status
    if (config.skipSuccessfulRequests || config.skipFailedRequests) {
      // Track the status code when it's set
      let trackedStatusCode = 200; // Default status
      const originalStatus = res.status;
      
      // Override status method to track the status code
      res.status = function(code) {
        trackedStatusCode = code;
        // Call original status method
        return originalStatus.call(res, code);
      };
      
      // Store original end method
      const originalEnd = res.end;
      let counted = false;
      
      // Override end method to check response status
      res.end = function(...args) {
        // Use our tracked status code
        res.statusCode = trackedStatusCode;
        
        // Check if we should count this request
        const wasSuccessful = config.requestWasSuccessful(req, res);
        
        if (!counted) {
          counted = true;
          // Determine if we should count this request
          const shouldCount = (config.skipSuccessfulRequests && !wasSuccessful) ||
                            (config.skipFailedRequests && wasSuccessful) ||
                            (!config.skipSuccessfulRequests && !config.skipFailedRequests);
          
          if (shouldCount) {
            // Now we need to actually increment the counter
            if (config.store && config.store.increment) {
              // Custom store with increment
              config.store.increment(key);
            } else if (!distributedLimiter && requestLimiter) {
              // For local memory store, increment now
              if (config.algorithm === 'token-bucket') {
                requestLimiter.consume(config.cost || 1);
              } else {
                requestLimiter.increment();
              }
            }
          }
        }
        
        // Call original end method
        return originalEnd.apply(res, args);
      };
    }
    
    // Continue to next middleware
    if (next) {
      next();
    }
  }
  
  // Attach utility methods to middleware
  rateLimitMiddleware.resetKey = function(key) {
    if (distributedLimiter) {
      return distributedLimiter.reset(key);
    }
    return store.delete(key);
  };
  
  rateLimitMiddleware.getStore = function() {
    return store;
  };
  
  rateLimitMiddleware.getConfig = function() {
    return { ...config };
  };
  
  return rateLimitMiddleware;
}

// Export factory function and classes
module.exports = createRateLimiter;
module.exports.createRateLimiter = createRateLimiter;
module.exports.TokenBucket = TokenBucket;
module.exports.FixedWindowCounter = FixedWindowCounter;
module.exports.SlidingWindowCounter = SlidingWindowCounter;
module.exports.MemoryStore = MemoryStore;
module.exports.DistributedRateLimiter = DistributedRateLimiter;

// Preset configurations for common use cases
module.exports.strict = function(options = {}) {
  return createRateLimiter({
    windowMs: 60000, // 1 minute
    max: 10, // 10 requests per minute
    algorithm: 'sliding-window',
    message: 'Too many requests. Please slow down.',
    ...options
  });
};

module.exports.moderate = function(options = {}) {
  return createRateLimiter({
    windowMs: 60000, // 1 minute
    max: 60, // 60 requests per minute
    algorithm: 'fixed-window',
    ...options
  });
};

module.exports.lenient = function(options = {}) {
  return createRateLimiter({
    windowMs: 60000, // 1 minute
    max: 200, // 200 requests per minute
    algorithm: 'token-bucket',
    bucketCapacity: 250, // Allow burst
    ...options
  });
};

module.exports.api = function(options = {}) {
  return createRateLimiter({
    windowMs: 3600000, // 1 hour
    max: 1000, // 1000 requests per hour
    algorithm: 'sliding-window',
    precision: 20,
    headers: true,
    draft_polli_ratelimit_headers: true,
    message: 'API rate limit exceeded. Please review the rate limit headers.',
    ...options
  });
};

module.exports.bruteForce = function(options = {}) {
  return createRateLimiter({
    windowMs: 900000, // 15 minutes
    max: 5, // 5 attempts per 15 minutes
    algorithm: 'fixed-window',
    skipSuccessfulRequests: true, // Only count failed attempts
    message: 'Too many failed attempts. Please try again later.',
    statusCode: 429,
    ...options
  });
};