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
const { isIP } = require('node:net');
// In-memory optimistic concurrency metadata is deliberately not serialized or
// sent to custom stores. They must enforce their own atomic update/revocation.
const storeRevision = Symbol('sessionStoreRevision');

// Custom stores may throw synchronously or complete more than once. Never run a
// response completion twice, and surface throws through the normal error path.
function callStore(store, method, args, callback) {
  let completed = false;
  const done = (...result) => {
    if (completed) return;
    completed = true;
    callback(...result);
  };
  try {
    store[method](...args, done);
  } catch (err) {
    if (completed) throw err;
    done(err);
  }
}

function sessionCookieValue(req, name) {
  // General signed-cookie parsing may remove this value from req.cookies when
  // both features share a secret. Session signatures must still be verified here.
  const header = req.headers.cookie;
  if (typeof header === 'string') {
    for (const pair of header.split(';')) {
      const index = pair.indexOf('=');
      if (index < 0 || pair.slice(0, index).trim() !== name) continue;
      let value = pair.slice(index + 1).trim();
      if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
      try { return decodeURIComponent(value); } catch { return value; }
    }
    // No session cookie in the native header: do not prematurely trigger the
    // general lazy parser before a later cookieParser(secret) configures it.
    return undefined;
  }
  return req.cookies?.[name];
}

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
    this.revision = 0;
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
    if (expires === undefined || expires === null) return false;
    
    const expireTime = new Date(expires).getTime();
    return !Number.isFinite(expireTime) || expireTime <= now;
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
    session[storeRevision] = sessionData[storeRevision];
    callback(null, session);
  }

  set(sid, session, callback) {
    const expected = session[storeRevision];
    const current = this.sessions.get(sid);
    // A request loaded before logout/rotation (or a newer write) must not
    // resurrect a revoked session or overwrite another request's newer data.
    if (expected !== undefined && (this.isExpired(current) || current?.[storeRevision] !== expected)) {
      return callback(new Error('Session was revoked or concurrently modified'));
    }
    let sessionCopy;
    try {
      // Store a copy to prevent external modifications
      sessionCopy = JSON.parse(JSON.stringify(session));
    } catch (err) {
      return callback(err);
    }
    this.sessions.set(sid, sessionCopy);
    sessionCopy[storeRevision] = ++this.revision;
    session[storeRevision] = sessionCopy[storeRevision];
    callback();
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
      try { sessionData.cookie = JSON.parse(JSON.stringify(session.cookie)); }
      catch (err) { return callback(err); }
    }
    sessionData[storeRevision] = ++this.revision;

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
      : new SessionCookie(sessionData.cookie, true);
    
    // Copy session data properties
    for (const prop of Object.keys(sessionData)) {
      if (isSessionDataKey(prop)) {
        this[prop] = sessionData[prop];
      }
    }

    // Track if session has been modified
    this._touched = false;
    this._saved = false;
    this._destroyed = false;
    this._regenerated = false;
    this._pending = false;
    this._waiters = [];
    this._callbackDepth = 0;
    this._isNew = true;
    this._storeVersion = sessionData[storeRevision];
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
    if (this._destroyed) {
      if (callback) callback(new Error('Session has been destroyed'));
      return this;
    }
    if (this.req.sessionStore && this.id) {
      if (!beginSessionOperation(this, callback)) return this;
      let sessionData;
      try { sessionData = this.toJSON(); } catch (err) {
        this._storeError = err;
        finishSessionOperation(this, callback, err);
        return this;
      }
      callStore(this.req.sessionStore, 'set', [this.id, sessionData], (err) => {
        if (err) this._storeError = err;
        if (!err) {
          this._saved = true;
          this._isNew = false;
          this._storeVersion = sessionData[storeRevision];
        }
        finishSessionOperation(this, callback, err);
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
      if (!beginSessionOperation(this, callback)) return this;
      callStore(this.req.sessionStore, 'get', [this.id], (err, session) => {
        if (err) {
          this._storeError = err;
          finishSessionOperation(this, callback, err);
          return;
        }

        if (!session || MemoryStore.prototype.isExpired(session)) {
          this._storeError = new Error('Session not found');
          finishSessionOperation(this, callback, this._storeError);
          return;
        }
        let cookie;
        try { cookie = new SessionCookie(session.cookie, true); } catch (cookieError) {
          this._storeError = cookieError;
          finishSessionOperation(this, callback, cookieError);
          return;
        }

        // Clear existing properties
        for (const prop in this) {
          if (prop !== 'req' && prop !== 'id' && prop !== 'cookie' && !prop.startsWith('_')) {
            delete this[prop];
          }
        }

        // Load new properties
        for (const prop of Object.keys(session)) {
          if (isSessionDataKey(prop)) {
            this[prop] = session[prop];
          }
        }

        // Reload data/expiry, not transport policy saved by an earlier request.
        cookie.secure = this.req.sessionOptions?.cookie.secure ?? this.cookie.secure;
        this.cookie = cookie;
        this._storeVersion = session[storeRevision];
        finishSessionOperation(this, callback);
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
      if (!beginSessionOperation(this, callback)) return this;
      callStore(this.req.sessionStore, 'destroy', [this.id], (err) => {
        if (err) this._storeError = err;
        if (!err) {
          this._destroyedCookie = this.cookie;
          this._destroyed = true;
          // Clear session properties
          for (const prop in this) {
            if (prop !== 'req' && prop !== '_destroyed' && !prop.startsWith('_')) {
              delete this[prop];
            }
          }
          this.id = null;
          this.req.sessionID = null;
        }
        finishSessionOperation(this, callback, err);
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

    if (!beginSessionOperation(this, callback)) return this;
    // Validate/generate before revoking, so a faulty generator cannot strand the
    // caller after destroying the old session.
    let newId;
    let newCookie;
    try {
      newId = (req.sessionOptions?.genid || generateSessionId)(req);
      if (typeof newId !== 'string' || !newId || newId.includes('.') || newId === this.id) {
        throw new TypeError('Session regeneration requires a fresh string ID');
      }
      newCookie = new SessionCookie(req.sessionOptions?.cookie);
    } catch (err) {
      this._storeError = err;
      finishSessionOperation(this, callback, err);
      return this;
    }

    const renew = (err) => {
      if (err) this._storeError = err;
      // Revocation must succeed before reporting a rotated authentication token.
      if (err) {
        finishSessionOperation(this, callback, err);
        return;
      }
      const keepProps = req.sessionOptions?.keepOnRegenerate || [];
      const saved = Object.create(null);
      for (const prop of keepProps) {
        if (isSessionDataKey(prop) && Object.hasOwn(this, prop)) saved[prop] = this[prop];
      }
      // Fingerprinting is an internal invariant, not user state to discard.
      const fingerprint = this.fingerprint;
      for (const prop of Object.keys(this)) {
        if (isSessionDataKey(prop)) delete this[prop];
      }
      Object.assign(this, saved);
      if (req.sessionOptions?.fingerprint) this.fingerprint = fingerprint;
      this.id = newId;
      req.sessionID = this.id;
      this.cookie = newCookie;
      this._destroyed = false;
      this._saved = false;
      this._isNew = true;
      this._storeVersion = undefined;
      this._regenerated = true;
      this._touched = true;
      finishSessionOperation(this, callback);
    };
    if (this.id) callStore(store, 'destroy', [this.id], renew);
    else renew();

    return this;
  }

  /**
   * Convert session to JSON for storage
   */
  toJSON() {
    const obj = { cookie: this.cookie.toJSON() };
    if (this._storeVersion !== undefined) obj[storeRevision] = this._storeVersion;
    
    for (const prop of Object.keys(this)) {
      if (isSessionDataKey(prop)) {
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
    return this._isNew && !this._destroyed;
  }
}

/**
 * Session cookie configuration
 */
class SessionCookie {
  constructor(options = {}, restore = false) {
    this.path = options.path || '/';
    this.httpOnly = options.httpOnly !== false; // Default true
    this.secure = options.secure || false;
    this.sameSite = options.sameSite || 'lax';
    this.domain = options.domain;
    
    // Handle maxAge and expires
    if (options.maxAge !== undefined &&
        (typeof options.maxAge !== 'number' || !Number.isFinite(options.maxAge))) {
      throw new TypeError('Session cookie maxAge must be a finite number');
    }
    if (restore && options.expires !== undefined && options.expires !== null) {
      // Hydration must not silently turn a fixed expiry into a sliding expiry.
      this.expires = new Date(options.expires);
      this.maxAge = this.expires.getTime() - Date.now();
    } else if (options.maxAge !== undefined) {
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

    if (this.expires && !Number.isFinite(this.expires.getTime())) {
      throw new TypeError('Invalid session cookie expiration');
    }
    this.originalMaxAge = options.originalMaxAge !== undefined ? options.originalMaxAge : this.maxAge;
    if (this.originalMaxAge !== undefined &&
        (typeof this.originalMaxAge !== 'number' || !Number.isFinite(this.originalMaxAge))) {
      throw new TypeError('Session cookie originalMaxAge must be a finite number');
    }
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

// Store payloads must never overwrite methods, request references or prototypes.
function isSessionDataKey(prop) {
  return typeof prop === 'string' && !prop.startsWith('_') &&
    !['req', 'id', 'cookie', 'constructor', 'prototype', '__proto__'].includes(prop) &&
    !Object.hasOwn(Session.prototype, prop);
}

function beginSessionOperation(session, callback) {
  if (session._pending) {
    const err = new Error('A session operation is already pending');
    session._storeError = err;
    if (callback) callback(err);
    return false;
  }
  session._pending = true;
  return true;
}

function finishSessionOperation(session, callback, err) {
  session._pending = false;
  if (err) session._storeError = err;
  session._callbackDepth++;
  try {
    if (callback) callback(err || session._storeError);
  } finally {
    session._callbackDepth--;
    // A completion callback may start another asynchronous or synchronous
    // operation. Release the response only after the whole callback chain is
    // quiescent, not merely after the first store operation completes.
    if (!session._pending && session._callbackDepth === 0) {
      const waiters = session._waiters.splice(0);
      for (const waiter of waiters) waiter();
    }
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
 * @param {boolean|Function} options.proxy - Trust forwarding headers, optionally by peer predicate (default: false)
 * @param {boolean} options.fingerprint - Add fingerprinting (default: false)
 * @param {Array} options.keepOnRegenerate - Properties to keep on regenerate
 * @returns {Function} Middleware function
 */
function session(options = {}) {
  // Validate required options
  if (!options.secret) {
    throw new Error('Session secret is required');
  }
  if ((typeof options.secret !== 'string' && !Buffer.isBuffer(options.secret)) || !options.secret.length) {
    throw new TypeError('Session secret must be a non-empty string or Buffer');
  }
  if (options.keepOnRegenerate !== undefined && (!Array.isArray(options.keepOnRegenerate) ||
      options.keepOnRegenerate.some(prop => typeof prop !== 'string'))) {
    throw new TypeError('keepOnRegenerate must be an array of property names');
  }
  if (options.proxy !== undefined && typeof options.proxy !== 'boolean' && typeof options.proxy !== 'function') {
    throw new TypeError('Session proxy must be a boolean or peer predicate');
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

    const reportError = (err) => {
      // Retain diagnostics server-side without exposing store messages to clients.
      req.sessionError = err;
      if (next) next(new Error('Session error', { cause: err }));
      else res.status(500).send('Session error');
    };

    const socket = req.socket || req.nativeRequest?.socket;
    const trustProxy = config.proxy === true || (typeof config.proxy === 'function' &&
      config.proxy(socket?.remoteAddress) === true);
    const forwardedProto = req.headers['x-forwarded-proto'];
    const protocol = trustProxy && typeof forwardedProto === 'string' &&
      /^(http|https)$/.test(forwardedProto.split(',')[0].trim())
      ? forwardedProto.split(',')[0].trim()
      : (socket?.encrypted ? 'https' : 'http');

    // Resolve auto-secure per request; mutating shared config would make the
    // first request's scheme determine cookie policy for every later request.
    const requestCookie = {
      ...config.cookie,
      secure: config.cookie.secure === 'auto'
        ? protocol === 'https'
        : config.cookie.secure
    };

    // Store request-specific cookie settings for Session regeneration paths.
    req.sessionStore = config.store;
    req.sessionOptions = { ...config, cookie: requestCookie };

    // Get session ID from cookie
    let sid = null;
    let sessionId = null;
    
    const cookieValue = sessionCookieValue(req, config.name);
    if (typeof cookieValue === 'string' && cookieValue) {
      
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
      const forwarded = req.headers['x-forwarded-for'];
      const realIp = req.headers['x-real-ip'];
      let ip = socket?.remoteAddress || '';
      if (trustProxy && typeof forwarded === 'string' && isIP(forwarded.split(',')[0].trim())) {
        ip = forwarded.split(',')[0].trim();
      } else if (trustProxy && typeof realIp === 'string' && isIP(realIp.trim())) {
        ip = realIp.trim();
      }
      fingerprint = hash(`${ua}:${ip}`);
    }

    /**
     * Initialize or load session
     */
    const initSession = () => {
      if (sid) {
        // Load existing session
        callStore(config.store, 'get', [sid], (err, sessionData) => {
          if (err) {
            reportError(err);
            return;
          }

          // Enforce expiry even when a custom store does not implement TTL.
          const expired = sessionData && MemoryStore.prototype.isExpired(sessionData);
          if (sessionData && !expired) {
            // Verify fingerprint if enabled
            if (config.fingerprint && sessionData.fingerprint !== fingerprint) {
              // Fingerprint mismatch - treat as new session
              createNewSession();
              return;
            }

            // Create session object
            try {
              req.session = new Session(req, sessionData);
            } catch (loadError) {
              reportError(loadError);
              return;
            }
            // A loaded cookie must not carry an earlier request's protocol policy.
            req.session._touched = req.session.cookie.secure !== requestCookie.secure;
            req.session.cookie.secure = requestCookie.secure;
            req.session.id = sid;
            req.session._isNew = false;
            req.sessionID = sid;

            // Reset cookie expiry if rolling
            if (config.rolling && req.session.cookie.originalMaxAge !== undefined) {
              req.session.cookie.resetMaxAge();
              req.session.touch();
            }

            try { setupSessionHandlers(); } catch (loadError) {
              reportError(loadError);
              return;
            }
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
      try {
        sid = config.genid(req);
        if (typeof sid !== 'string' || !sid || sid.includes('.')) {
          throw new TypeError('Session generator must return a non-empty string without dots');
        }
        req.session = new Session(req, { cookie: new SessionCookie(requestCookie) });
      } catch (creationError) {
        reportError(creationError);
        return;
      }
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
      const originalData = JSON.stringify(req.session.toJSON());
      let ending = false;
      let endCompletion;

      const trackEndCompletion = (args) => {
        const index = [0, 1, 2].find(position => typeof args[position] === 'function');
        if (index === undefined) return;
        const callback = args[index];
        const native = res._nativeResponse || res;
        let completed = false;
        let completionError;
        const settle = (err) => {
          if (completed) return;
          completed = true;
          native.removeListener('finish', onFinish);
          native.removeListener('close', onClose);
          callback.call(native, err);
        };
        const onFinish = () => {
          if (native.writableFinished) settle(completionError);
        };
        const onClose = () => {
          const err = new Error('Response closed before completion');
          err.code = 'ERR_STREAM_PREMATURE_CLOSE';
          settle(native.writableFinished ? completionError : (completionError || err));
        };
        endCompletion = (err) => {
          completionError = err;
          // Native/zlib callbacks can race finish/close. Do not acknowledge
          // completion just because persistence failed or end() was invoked.
          if (native.writableFinished) onFinish();
          else if (native.closed) onClose();
        };
        native.once('finish', onFinish);
        native.once('close', onClose);
        args[index] = endCompletion;
        // A client may already have disconnected while its store operation
        // was pending; an already completed transport needs no future event.
        if (native.writableFinished) process.nextTick(onFinish);
        else if (native.closed) process.nextTick(onClose);
      };

      const fail = (err) => {
        req.session._storeError = err;
        req.sessionError = err;
        // Do not emit a successful login/logout body or a token for an unsaved
        // session. A response already streaming cannot be repaired: abort it.
        const native = res._nativeResponse;
        if (res.headersSent || native?.headersSent) {
          native?.destroy();
          return;
        }
        res._discardBufferedBody?.();
        for (const field of ['Content-Length', 'Content-Encoding', 'Transfer-Encoding',
          'Location', 'Set-Cookie', 'Authorization', 'Proxy-Authorization',
          'Authentication-Info', 'WWW-Authenticate', 'Proxy-Authenticate']) {
          res.removeHeader(field);
        }
        res.status(500);
        res.set('Cache-Control', 'no-store');
        res.set('Content-Type', 'text/plain; charset=utf-8');
        res.set('Content-Length', Buffer.byteLength('Session error'));
        originalEnd('Session error', endCompletion);
      };
      
      const finalize = (...args) => {
        if (req.session?._storeError) {
          fail(req.session._storeError);
          return res;
        }
        if (req.session && !req.session._destroyed) {
          let sessionData;
          let dataChanged;
          try {
            sessionData = req.session.toJSON();
            // Proxies see only top-level assignments; compare storage data to
            // detect nested edits and cookie changes without deep proxying.
            dataChanged = JSON.stringify(sessionData) !== originalData;
          } catch (err) {
            fail(err);
            return res;
          }
          const shouldSave = req.session._regenerated || req.session.isModified() || dataChanged ||
            (req._newSession ? config.saveUninitialized : config.resave);

          if (shouldSave) {
            // Validate/stage the cookie before committing session data. Staged
            // headers are not sent until set succeeds; failure removes them.
            try {
              const signedSid = signSessionId(req.session.id, config.secret);
              const cookie = req.session.cookie;
              const remainingAge = cookie.expires ? cookie.expires.getTime() - Date.now() : cookie.maxAge;
              res.cookie(config.name, signedSid, { ...cookie, maxAge: remainingAge });
            } catch (cookieError) {
              fail(cookieError);
              return res;
            }
            callStore(config.store, 'set', [req.session.id, sessionData], (err) => {
              if (err) return fail(err);
              req.session._isNew = false;
              originalEnd(...args);
            });
          } else {
            originalEnd(...args);
          }
        } else {
          // Clear cookie if session was destroyed
          if (req.session && req.session._destroyed) {
            try { res.clearCookie(config.name, req.session._destroyedCookie || requestCookie); }
            catch (cookieError) { return fail(cookieError); }
          }
          originalEnd(...args);
        }
        return res;
      };

      res.end = function(...args) {
        if (ending) return res;
        ending = true;
        // Keep all three end(callback) overloads, including on replacement
        // errors and aborts before a pending operation chain has completed.
        trackEndCompletion(args);
        // Logout/rotation must finish revoking the old ID before any success
        // body is sent, even when the caller omits the optional callback.
        if (req.session?._pending || req.session?._callbackDepth > 0) {
          req.session._waiters.push(() => finalize(...args));
        }
        else finalize(...args);
        return res;
      };

      // Create proxy to track modifications
      const handler = {
        set(target, property, value) {
          if (property === '__proto__' || property === 'constructor' || property === 'prototype' ||
              Object.hasOwn(Session.prototype, property)) {
            throw new TypeError('Reserved session property');
          }
          if (isSessionDataKey(property)) {
            target._touched = true;
          }
          target[property] = value;
          return true;
        },
        deleteProperty(target, property) {
          if (isSessionDataKey(property)) {
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
