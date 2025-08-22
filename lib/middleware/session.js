/**
 * Session Management Middleware for Velocy Framework
 * 
 * A comprehensive session management system with in-memory storage,
 * secure session ID generation, cookie-based persistence, and automatic cleanup.
 * Uses only Node.js built-in modules with zero external dependencies.
 * 
 * @module session
 */

const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');

/**
 * Abstract base class for session stores
 * All custom session stores should extend this class
 */
class SessionStore extends EventEmitter {
  constructor() {
    super();
  }

  /**
   * Get a session by ID
   * @param {string} sid - Session ID
   * @param {Function} callback - Callback(err, session)
   */
  get(sid, callback) {
    throw new Error('Store.get() must be implemented by subclass');
  }

  /**
   * Set/update a session
   * @param {string} sid - Session ID
   * @param {Object} session - Session data
   * @param {Function} callback - Callback(err)
   */
  set(sid, session, callback) {
    throw new Error('Store.set() must be implemented by subclass');
  }

  /**
   * Destroy a session
   * @param {string} sid - Session ID
   * @param {Function} callback - Callback(err)
   */
  destroy(sid, callback) {
    throw new Error('Store.destroy() must be implemented by subclass');
  }

  /**
   * Touch a session (update expiry)
   * @param {string} sid - Session ID
   * @param {Object} session - Session data
   * @param {Function} callback - Callback(err)
   */
  touch(sid, session, callback) {
    // Default implementation just calls set
    this.set(sid, session, callback);
  }

  /**
   * Clear all sessions
   * @param {Function} callback - Callback(err)
   */
  clear(callback) {
    callback && callback();
  }

  /**
   * Get number of sessions (optional)
   * @param {Function} callback - Callback(err, length)
   */
  length(callback) {
    callback && callback(null, 0);
  }

  /**
   * Get all session IDs (optional)
   * @param {Function} callback - Callback(err, ids)
   */
  ids(callback) {
    callback && callback(null, []);
  }

  /**
   * Get all sessions (optional)
   * @param {Function} callback - Callback(err, sessions)
   */
  all(callback) {
    callback && callback(null, []);
  }

  /**
   * Create a promisified version of the store
   * @returns {Object} Promisified store methods
   */
  promisify() {
    const self = this;
    return {
      get: (sid) => new Promise((resolve, reject) => {
        self.get(sid, (err, session) => err ? reject(err) : resolve(session));
      }),
      set: (sid, session) => new Promise((resolve, reject) => {
        self.set(sid, session, (err) => err ? reject(err) : resolve());
      }),
      destroy: (sid) => new Promise((resolve, reject) => {
        self.destroy(sid, (err) => err ? reject(err) : resolve());
      }),
      touch: (sid, session) => new Promise((resolve, reject) => {
        self.touch(sid, session, (err) => err ? reject(err) : resolve());
      }),
      clear: () => new Promise((resolve, reject) => {
        self.clear((err) => err ? reject(err) : resolve());
      }),
      length: () => new Promise((resolve, reject) => {
        self.length((err, len) => err ? reject(err) : resolve(len));
      }),
      ids: () => new Promise((resolve, reject) => {
        self.ids((err, ids) => err ? reject(err) : resolve(ids));
      }),
      all: () => new Promise((resolve, reject) => {
        self.all((err, sessions) => err ? reject(err) : resolve(sessions));
      })
    };
  }
}

/**
 * In-memory session store implementation
 * Provides automatic cleanup of expired sessions
 */
class MemoryStore extends SessionStore {
  constructor(options = {}) {
    super();
    this.sessions = new Map();
    this.options = {
      checkPeriod: options.checkPeriod || 60000, // Check for expired sessions every minute
      ...options
    };

    // Start cleanup interval
    if (this.options.checkPeriod > 0) {
      this.startCleanup();
    }
  }

  /**
   * Start automatic cleanup of expired sessions
   * @private
   */
  startCleanup() {
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpired();
    }, this.options.checkPeriod);

    // Don't prevent process from exiting
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  /**
   * Stop automatic cleanup
   */
  stopCleanup() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Clean up expired sessions
   * @private
   */
  cleanupExpired() {
    const now = Date.now();
    let cleaned = 0;

    for (const [sid, sessionData] of this.sessions.entries()) {
      if (this.isExpired(sessionData, now)) {
        this.sessions.delete(sid);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.emit('cleanup', cleaned);
    }
  }

  /**
   * Check if a session is expired
   * @private
   */
  isExpired(sessionData, now = Date.now()) {
    if (!sessionData || !sessionData.cookie) return true;
    
    const expires = sessionData.cookie.expires;
    if (!expires) return false; // No expiry means session cookie
    
    const expireTime = typeof expires === 'string' ? new Date(expires).getTime() : expires;
    return expireTime <= now;
  }

  get(sid, callback) {
    const sessionData = this.sessions.get(sid);
    
    if (!sessionData) {
      return callback();
    }

    if (this.isExpired(sessionData)) {
      this.sessions.delete(sid);
      return callback();
    }

    // Return a copy to prevent external modifications
    const session = JSON.parse(JSON.stringify(sessionData));
    callback(null, session);
  }

  set(sid, session, callback) {
    try {
      // Store a copy to prevent external modifications
      const sessionCopy = JSON.parse(JSON.stringify(session));
      this.sessions.set(sid, sessionCopy);
      callback();
    } catch (err) {
      callback(err);
    }
  }

  destroy(sid, callback) {
    this.sessions.delete(sid);
    callback();
  }

  touch(sid, session, callback) {
    const sessionData = this.sessions.get(sid);
    
    if (!sessionData) {
      return callback();
    }

    // Update the session's cookie expiry
    if (session.cookie) {
      sessionData.cookie = session.cookie;
    }

    this.sessions.set(sid, sessionData);
    callback();
  }

  clear(callback) {
    this.sessions.clear();
    callback();
  }

  length(callback) {
    callback(null, this.sessions.size);
  }

  ids(callback) {
    callback(null, Array.from(this.sessions.keys()));
  }

  all(callback) {
    const sessions = [];
    for (const [sid, session] of this.sessions.entries()) {
      if (!this.isExpired(session)) {
        sessions.push({ sid, session: JSON.parse(JSON.stringify(session)) });
      }
    }
    callback(null, sessions);
  }
}

/**
 * Session object that gets attached to req.session
 */
class Session {
  constructor(req, sessionData = {}) {
    this.req = req;
    this.id = sessionData.id || null;
    // Ensure cookie is always a SessionCookie instance
    this.cookie = sessionData.cookie instanceof SessionCookie 
      ? sessionData.cookie 
      : new SessionCookie(sessionData.cookie);
    
    // Copy session data properties
    for (const prop in sessionData) {
      if (prop !== 'id' && prop !== 'cookie') {
        this[prop] = sessionData[prop];
      }
    }

    // Track if session has been modified
    this._touched = false;
    this._saved = false;
    this._destroyed = false;
    this._regenerated = false;
  }

  /**
   * Touch the session (mark as accessed)
   */
  touch() {
    this._touched = true;
    return this;
  }

  /**
   * Save the session
   * @param {Function} callback - Optional callback
   */
  save(callback) {
    if (this.req.sessionStore && this.id) {
      const sessionData = this.toJSON();
      this.req.sessionStore.set(this.id, sessionData, (err) => {
        if (!err) {
          this._saved = true;
        }
        if (callback) callback(err);
      });
    } else {
      if (callback) callback(new Error('No session store available'));
    }
    return this;
  }

  /**
   * Reload the session from the store
   * @param {Function} callback - Optional callback
   */
  reload(callback) {
    if (this.req.sessionStore && this.id) {
      this.req.sessionStore.get(this.id, (err, session) => {
        if (err) {
          if (callback) callback(err);
          return;
        }

        if (!session) {
          if (callback) callback(new Error('Session not found'));
          return;
        }

        // Clear existing properties
        for (const prop in this) {
          if (prop !== 'req' && prop !== 'id' && prop !== 'cookie' && !prop.startsWith('_')) {
            delete this[prop];
          }
        }

        // Load new properties
        for (const prop in session) {
          if (prop !== 'id' && prop !== 'cookie') {
            this[prop] = session[prop];
          }
        }

        this.cookie = new SessionCookie(session.cookie);
        if (callback) callback();
      });
    } else {
      if (callback) callback(new Error('No session store available'));
    }
    return this;
  }

  /**
   * Destroy the session
   * @param {Function} callback - Optional callback
   */
  destroy(callback) {
    if (this.req.sessionStore && this.id) {
      this.req.sessionStore.destroy(this.id, (err) => {
        if (!err) {
          this._destroyed = true;
          // Clear session properties
          for (const prop in this) {
            if (prop !== 'req' && prop !== '_destroyed' && !prop.startsWith('_')) {
              delete this[prop];
            }
          }
          this.id = null;
        }
        if (callback) callback(err);
      });
    } else {
      this._destroyed = true;
      if (callback) callback();
    }
    return this;
  }

  /**
   * Regenerate the session with a new ID
   * @param {Function} callback - Optional callback
   */
  regenerate(callback) {
    const req = this.req;
    const store = req.sessionStore;
    
    if (!store) {
      if (callback) callback(new Error('No session store available'));
      return this;
    }

    // Destroy old session
    if (this.id) {
      store.destroy(this.id, () => {
        // Generate new session ID
        this.id = generateSessionId();
        req.sessionID = this.id; // Update req.sessionID as well
        
        // Reset session data but keep some properties
        const keepProps = req.sessionOptions?.keepOnRegenerate || [];
        const saved = {};
        
        for (const prop of keepProps) {
          if (prop in this) {
            saved[prop] = this[prop];
          }
        }

        // Clear all properties
        for (const prop in this) {
          if (prop !== 'req' && prop !== 'id' && prop !== 'cookie' && !prop.startsWith('_')) {
            delete this[prop];
          }
        }

        // Restore kept properties
        for (const prop in saved) {
          this[prop] = saved[prop];
        }

        // Reset cookie
        this.cookie = new SessionCookie(req.sessionOptions?.cookie);
        
        // Mark session as regenerated and touched to ensure it gets saved
        this._regenerated = true;
        this._touched = true;
        
        if (callback) callback();
      });
    } else {
      this.id = generateSessionId();
      req.sessionID = this.id; // Update req.sessionID as well
      this.cookie = new SessionCookie(req.sessionOptions?.cookie);
      // Mark session as regenerated and touched to ensure it gets saved
      this._regenerated = true;
      this._touched = true;
      if (callback) callback();
    }

    return this;
  }

  /**
   * Convert session to JSON for storage
   */
  toJSON() {
    const obj = { cookie: this.cookie.toJSON() };
    
    for (const prop in this) {
      if (prop !== 'req' && prop !== 'id' && !prop.startsWith('_')) {
        obj[prop] = this[prop];
      }
    }

    return obj;
  }

  /**
   * Check if session has been modified
   */
  isModified() {
    return this._touched || this._saved || this._regenerated;
  }

  /**
   * Check if session is new (not yet saved)
   */
  isNew() {
    return !this._saved && !this._destroyed;
  }
}

/**
 * Session cookie configuration
 */
class SessionCookie {
  constructor(options = {}) {
    this.path = options.path || '/';
    this.httpOnly = options.httpOnly !== false; // Default true
    this.secure = options.secure || false;
    this.sameSite = options.sameSite || 'lax';
    this.domain = options.domain;
    
    // Handle maxAge and expires
    if (options.maxAge !== undefined) {
      this.maxAge = options.maxAge;
      this.expires = new Date(Date.now() + options.maxAge);
    } else if (options.expires) {
      this.expires = options.expires instanceof Date ? options.expires : new Date(options.expires);
      this.maxAge = this.expires.getTime() - Date.now();
    } else {
      // Session cookie (expires when browser closes)
      this.maxAge = undefined;
      this.expires = undefined;
    }

    this.originalMaxAge = this.maxAge;
  }

  /**
   * Reset maxAge to originalMaxAge (rolling sessions)
   */
  resetMaxAge() {
    if (this.originalMaxAge !== undefined) {
      this.maxAge = this.originalMaxAge;
      this.expires = new Date(Date.now() + this.originalMaxAge);
    }
  }

  /**
   * Convert to JSON for storage
   */
  toJSON() {
    return {
      path: this.path,
      httpOnly: this.httpOnly,
      secure: this.secure,
      sameSite: this.sameSite,
      domain: this.domain,
      expires: this.expires ? this.expires.toISOString() : undefined,
      maxAge: this.maxAge,
      originalMaxAge: this.originalMaxAge
    };
  }
}

/**
 * Generate a cryptographically secure session ID
 * @returns {string} URL-safe base64 encoded session ID
 */
function generateSessionId() {
  // Generate 24 bytes of random data (192 bits of entropy)
  const bytes = crypto.randomBytes(24);
  
  // Convert to URL-safe base64
  return bytes.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

/**
 * Sign a session ID using HMAC-SHA256
 * @private
 */
function signSessionId(sid, secret) {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(sid);
  const signature = hmac.digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
  return `${sid}.${signature}`;
}

/**
 * Verify a signed session ID
 * @private
 */
function unsignSessionId(signedSid, secret) {
  const parts = signedSid.split('.');
  if (parts.length !== 2) return false;
  
  const [sid, signature] = parts;
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(sid);
  const expectedSignature = hmac.digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
  
  // Constant-time comparison
  if (signature.length !== expectedSignature.length) return false;
  
  const sig1 = Buffer.from(signature);
  const sig2 = Buffer.from(expectedSignature);
  
  if (sig1.length !== sig2.length) return false;
  
  return crypto.timingSafeEqual(sig1, sig2) ? sid : false;
}

/**
 * Hash a string using SHA256 (for fingerprinting)
 * @private
 */
function hash(str) {
  return crypto.createHash('sha256').update(str || '').digest('hex');
}

/**
 * Create session middleware with configuration options
 * 
 * @param {Object} options - Configuration options
 * @param {string} options.secret - Secret for signing session IDs (required)
 * @param {string} options.name - Session cookie name (default: 'connect.sid')
 * @param {Object} options.cookie - Cookie configuration options
 * @param {number} options.cookie.maxAge - Cookie max age in milliseconds
 * @param {Date} options.cookie.expires - Cookie expiration date
 * @param {boolean} options.cookie.httpOnly - HttpOnly flag (default: true)
 * @param {boolean} options.cookie.secure - Secure flag (default: auto-detect)
 * @param {string} options.cookie.sameSite - SameSite attribute (default: 'lax')
 * @param {string} options.cookie.domain - Cookie domain
 * @param {string} options.cookie.path - Cookie path (default: '/')
 * @param {SessionStore} options.store - Session store instance (default: MemoryStore)
 * @param {Function} options.genid - Session ID generator function
 * @param {boolean} options.resave - Force session save even if unmodified (default: false)
 * @param {boolean} options.saveUninitialized - Save uninitialized sessions (default: true)
 * @param {boolean} options.rolling - Reset expiry on activity (default: false)
 * @param {boolean} options.proxy - Trust proxy headers (default: false)
 * @param {boolean} options.fingerprint - Add fingerprinting (default: false)
 * @param {Array} options.keepOnRegenerate - Properties to keep on regenerate
 * @returns {Function} Middleware function
 */
function session(options = {}) {
  // Validate required options
  if (!options.secret) {
    throw new Error('Session secret is required');
  }

  // Default configuration
  const config = {
    name: options.name || 'connect.sid',
    secret: options.secret,
    resave: options.resave || false,
    saveUninitialized: options.saveUninitialized !== false,
    rolling: options.rolling || false,
    proxy: options.proxy || false,
    fingerprint: options.fingerprint || false,
    keepOnRegenerate: options.keepOnRegenerate || [],
    cookie: {
      path: '/',
      httpOnly: true,
      secure: 'auto', // Auto-detect based on protocol
      sameSite: 'lax',
      ...options.cookie
    },
    store: options.store || new MemoryStore(),
    genid: options.genid || generateSessionId
  };

  // Ensure store is properly initialized
  if (!config.store) {
    config.store = new MemoryStore();
  }

  /**
   * Middleware function
   */
  return function sessionMiddleware(req, res, next) {
    // Skip if session already exists
    if (req.session) {
      if (next) next();
      return;
    }

    // Store reference for session operations
    req.sessionStore = config.store;
    req.sessionOptions = config;

    // Auto-detect secure cookie setting
    if (config.cookie.secure === 'auto') {
      config.cookie.secure = req.protocol === 'https';
    }

    // Get session ID from cookie
    let sid = null;
    let sessionId = null;
    
    if (req.cookies && req.cookies[config.name]) {
      const cookieValue = req.cookies[config.name];
      
      // Unsign the session ID
      sessionId = unsignSessionId(cookieValue, config.secret);
      if (sessionId) {
        sid = sessionId;
      }
    }

    // Session fingerprint for additional security
    let fingerprint = null;
    if (config.fingerprint) {
      const ua = req.headers['user-agent'] || '';
      const ip = req.ip || '';
      fingerprint = hash(`${ua}:${ip}`);
    }

    /**
     * Initialize or load session
     */
    const initSession = () => {
      if (sid) {
        // Load existing session
        config.store.get(sid, (err, sessionData) => {
          if (err) {
            if (next) {
              next(err);
            } else {
              res.status(500).send('Session error');
            }
            return;
          }

          if (sessionData) {
            // Verify fingerprint if enabled
            if (config.fingerprint && sessionData.fingerprint !== fingerprint) {
              // Fingerprint mismatch - treat as new session
              createNewSession();
              return;
            }

            // Create session object
            req.session = new Session(req, sessionData);
            req.session.id = sid;
            req.sessionID = sid;

            // Reset cookie expiry if rolling
            if (config.rolling && req.session.cookie.originalMaxAge) {
              req.session.cookie.resetMaxAge();
              req.session.touch();
            }

            setupSessionHandlers();
            if (next) next();
          } else {
            // Session not found in store
            createNewSession();
          }
        });
      } else {
        // No session ID - create new session
        createNewSession();
      }
    };

    /**
     * Create a new session
     */
    const createNewSession = () => {
      sid = config.genid(req);
      req.session = new Session(req, { cookie: new SessionCookie(config.cookie) });
      req.session.id = sid;
      req.sessionID = sid;
      req._newSession = true; // Mark as new session

      // Add fingerprint if enabled
      if (config.fingerprint) {
        req.session.fingerprint = fingerprint;
      }

      setupSessionHandlers();
      if (next) next();
    };

    /**
     * Setup session save handlers
     */
    const setupSessionHandlers = () => {
      // Override res.end to save session
      const originalEnd = res.end.bind(res);
      
      res.end = function(...args) {
        if (req.session && !req.session._destroyed) {
          // Determine if session should be saved
          let shouldSave = false;

          if (req.session._regenerated) {
            // Always save regenerated sessions
            shouldSave = true;
          } else if (req._newSession) {
            // New session
            shouldSave = config.saveUninitialized || req.session.isModified();
          } else if (config.resave) {
            // Always save if resave is true
            shouldSave = true;
          } else if (req.session.isModified()) {
            // Save if modified
            shouldSave = true;
          } else if (config.rolling && req.session._touched) {
            // Save if rolling and touched
            shouldSave = true;
          }

          if (shouldSave) {
            const sessionData = req.session.toJSON();
            
            config.store.set(req.session.id, sessionData, (err) => {
              // Silently handle session save errors

              // Set session cookie
              if (!req.session._destroyed) {
                const signedSid = signSessionId(req.session.id, config.secret);
                res.cookie(config.name, signedSid, req.session.cookie);
              }

              originalEnd(...args);
            });
          } else {
            // Set cookie for new sessions even if not saving data
            if (req._newSession && config.saveUninitialized) {
              const signedSid = signSessionId(req.session.id, config.secret);
              res.cookie(config.name, signedSid, req.session.cookie);
            }
            originalEnd(...args);
          }
        } else {
          // Clear cookie if session was destroyed
          if (req.session && req.session._destroyed) {
            res.clearCookie(config.name, { path: config.cookie.path });
          }
          originalEnd(...args);
        }
      };

      // Create proxy to track modifications
      const handler = {
        set(target, property, value) {
          if (!property.startsWith('_') && property !== 'req' && property !== 'id' && property !== 'cookie') {
            target._touched = true;
          }
          target[property] = value;
          return true;
        },
        deleteProperty(target, property) {
          if (!property.startsWith('_') && property !== 'req' && property !== 'id' && property !== 'cookie') {
            target._touched = true;
          }
          delete target[property];
          return true;
        }
      };

      req.session = new Proxy(req.session, handler);
    };

    // Initialize session
    initSession();
  };
}

// Export main function and classes
session.Store = SessionStore;
session.MemoryStore = MemoryStore;
session.Session = Session;
session.Cookie = SessionCookie;

module.exports = session;