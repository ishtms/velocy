/**
 * High-performance LRU Cache implementation for Velocy.
 * Zero-dependency, optimized for V8 JavaScript engine.
 * Uses Map for O(1) operations and maintains insertion order for LRU eviction.
 * Map preserves insertion order which makes it perfect for LRU implementation.
 * 
 * @class LRUCache
 * @example
 * const cache = new LRUCache(100);
 * cache.set('key', 'value');
 * const value = cache.get('key'); // 'value'
 * const stats = cache.getStats(); // { hits: 1, misses: 0, ... }
 */
class LRUCache {
  /**
   * Creates a new LRU cache instance.
   * Initializes with specified max size and tracking metrics.
   * 
   * @constructor
   * @param {number} [maxSize=1000] - Maximum number of entries to cache
   * @throws {TypeError} If maxSize is not a positive number
   */
  constructor(maxSize = 1000) {
    if (typeof maxSize !== 'number' || maxSize < 1) {
      throw new TypeError('maxSize must be a positive number');
    }
    
    /**
     * @type {number}
     * @description Maximum number of entries in the cache
     */
    this.maxSize = maxSize;
    
    /**
     * @type {Map}
     * @description Internal storage using Map for O(1) operations
     */
    this.cache = new Map();
    
    /**
     * @type {number}
     * @description Number of cache hits
     */
    this.hits = 0;
    
    /**
     * @type {number}
     * @description Number of cache misses
     */
    this.misses = 0;
    
    /**
     * @type {number}
     * @description Number of evictions due to size limit
     */
    this.evictions = 0;
  }

  /**
   * Get value from cache with O(1) complexity
   * Updates access order for LRU
   */
  get(key) {
    if (!this.cache.has(key)) {
      this.misses++;
      return undefined;
    }
    
    const value = this.cache.get(key);
    this.cache.delete(key);
    this.cache.set(key, value);
    this.hits++;
    return value;
  }

  /**
   * Set value in cache with O(1) complexity
   * Evicts least recently used if at capacity
   */
  set(key, value) {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
      this.evictions++;
    }
    
    this.cache.set(key, value);
    return this;
  }

  /**
   * Check if key exists without updating order
   */
  has(key) {
    return this.cache.has(key);
  }

  /**
   * Delete entry from cache
   */
  delete(key) {
    return this.cache.delete(key);
  }

  /**
   * Clear all entries
   */
  clear() {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
  }

  /**
   * Get cache statistics
   */
  getStats() {
    const total = this.hits + this.misses;
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      hitRate: total > 0 ? this.hits / total : 0,
      usage: this.cache.size / this.maxSize
    };
  }

  /**
   * Get current cache size
   */
  get size() {
    return this.cache.size;
  }
}

/**
 * Optimized route cache with compound key generation.
 * Specifically designed for caching route handlers and their parameters.
 * Uses frozen objects to prevent accidental mutations of cached data.
 * 
 * @class RouteCache
 * @extends LRUCache
 * @example
 * const routeCache = new RouteCache(500);
 * routeCache.set('GET', '/users/123', handler, { id: '123' });
 * const cached = routeCache.get('GET', '/users/123');
 * // cached = { handler: Function, params: { id: '123' } }
 */
class RouteCache {
  constructor(maxSize = 500) {
    this.cache = new LRUCache(maxSize);
    this.keyBuffer = [];
  }

  /**
   * Generates a cache key from HTTP method and path.
   * Optimized to minimize string allocations by reusing array.
   * Using array join is faster than string concatenation for repeated operations.
   * 
   * @param {string} method - HTTP method (GET, POST, etc.)
   * @param {string} path - Request path
   * @returns {string} Compound cache key in format 'METHOD:path'
   * @private
   */
  #generateKey(method, path) {
    this.keyBuffer[0] = method;
    this.keyBuffer[1] = ':';
    this.keyBuffer[2] = path;
    return this.keyBuffer.join('');
  }

  /**
   * Get cached route
   */
  get(method, path) {
    const key = this.#generateKey(method, path);
    return this.cache.get(key);
  }

  /**
   * Cache route handler and params
   */
  set(method, path, handler, params) {
    const key = this.#generateKey(method, path);
    const value = Object.freeze({
      handler,
      params: Object.freeze(params || {})
    });
    return this.cache.set(key, value);
  }

  /**
   * Invalidate cache (e.g., when routes change)
   */
  invalidate() {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getStats() {
    return this.cache.getStats();
  }
}

/**
 * URL parsing cache for parsed URL components.
 * Caches parsed URLs to avoid repeated parsing of the same URLs.
 * Particularly useful for applications with limited URL patterns.
 * 
 * @class URLParseCache
 * @extends LRUCache
 * @example
 * const urlCache = new URLParseCache(200);
 * const parsed = urlCache.getOrCompute('/users?page=2', (url) => {
 *   // Parse URL logic here
 *   return { path: '/users', query: 'page=2' };
 * });
 */
class URLParseCache {
  constructor(maxSize = 200) {
    this.cache = new LRUCache(maxSize);
  }

  /**
   * Get or compute parsed URL
   */
  getOrCompute(url, computeFn) {
    let parsed = this.cache.get(url);
    if (parsed === undefined) {
      parsed = computeFn(url);
      if (parsed !== null && parsed !== undefined) {
        this.cache.set(url, parsed);
      }
    }
    return parsed;
  }

  /**
   * Get cached parsed URL
   */
  get(url) {
    return this.cache.get(url);
  }

  /**
   * Cache parsed URL
   */
  set(url, parsed) {
    return this.cache.set(url, parsed);
  }

  /**
   * Clear cache
   */
  clear() {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getStats() {
    return this.cache.getStats();
  }
}

/**
 * Object pool for reducing allocations and garbage collection pressure.
 * Reuses objects instead of creating new ones, improving performance.
 * Particularly useful for high-frequency object creation scenarios.
 * The pool handles frozen/sealed objects gracefully by not reusing them.
 * 
 * @class ObjectPool
 * @example
 * const pool = new ObjectPool(
 *   () => ({ params: {} }),  // Factory function
 *   (obj) => { obj.params = {}; },  // Reset function
 *   100  // Max pool size
 * );
 * const obj = pool.borrow();
 * // Use obj...
 * pool.return(obj);  // Return for reuse
 */
class ObjectPool {
  /**
   * Creates a new object pool.
   * 
   * @constructor
   * @param {Function} factory - Function that creates new objects
   * @param {Function} reset - Function that resets objects for reuse
   * @param {number} [maxSize=100] - Maximum number of objects to pool
   * @throws {TypeError} If factory or reset are not functions
   */
  constructor(factory, reset, maxSize = 100) {
    if (typeof factory !== 'function') {
      throw new TypeError('factory must be a function');
    }
    if (typeof reset !== 'function') {
      throw new TypeError('reset must be a function');
    }
    
    /**
     * @type {Function}
     * @description Factory function for creating new objects
     */
    this.factory = factory;
    
    /**
     * @type {Function}
     * @description Reset function for preparing objects for reuse
     */
    this.reset = reset;
    
    /**
     * @type {number}
     * @description Maximum pool size
     */
    this.maxSize = maxSize;
    
    /**
     * @type {Array}
     * @description Pool of available objects
     */
    this.pool = [];
    
    /**
     * @type {number}
     * @description Total objects created
     */
    this.created = 0;
    
    /**
     * @type {number}
     * @description Total borrows from pool
     */
    this.borrowed = 0;
    
    /**
     * @type {number}
     * @description Total returns to pool
     */
    this.returned = 0;
  }

  /**
   * Borrow object from pool
   */
  borrow() {
    this.borrowed++;
    if (this.pool.length > 0) {
      return this.pool.pop();
    }
    this.created++;
    return this.factory();
  }

  /**
   * Return object to pool
   */
  return(obj) {
    if (this.pool.length < this.maxSize) {
      try {
        this.reset(obj);
        this.pool.push(obj);
        this.returned++;
      } catch (e) {
        // Object cannot be reset (might be frozen/sealed), skip pooling
      }
    }
  }

  /**
   * Get pool statistics
   */
  getStats() {
    return {
      poolSize: this.pool.length,
      maxSize: this.maxSize,
      created: this.created,
      borrowed: this.borrowed,
      returned: this.returned,
      reuseRate: this.borrowed > 0 ? (this.borrowed - this.created) / this.borrowed : 0
    };
  }

  /**
   * Clear pool
   */
  clear() {
    this.pool.length = 0;
  }
}

/**
 * Fast string interning for common strings.
 * Reduces memory usage by storing only one copy of duplicate strings.
 * Particularly effective for repeated header names, method names, etc.
 * Uses simple eviction strategy to prevent unbounded growth.
 * 
 * @class StringInterner
 * @example
 * const interner = new StringInterner(500);
 * const str1 = interner.intern('content-type');
 * const str2 = interner.intern('content-type');
 * // str1 === str2 (same reference, saves memory)
 */
class StringInterner {
  /**
   * Creates a new string interner.
   * 
   * @constructor
   * @param {number} [maxSize=500] - Maximum number of strings to intern
   */
  constructor(maxSize = 500) {
    /**
     * @type {Map<string, string>}
     * @description Cache of interned strings
     */
    this.cache = new Map();
    
    /**
     * @type {number}
     * @description Maximum cache size before eviction
     */
    this.maxSize = maxSize;
  }

  /**
   * Interns a string, returning cached version if available.
   * When cache is full, evicts half the entries using a simple strategy.
   * This prevents the cache from growing unbounded while maintaining
   * frequently used strings.
   * 
   * @param {string} str - String to intern
   * @returns {string} Interned string (possibly same reference as previous calls)
   * @example
   * const interned = interner.intern('GET');
   */
  intern(str) {
    if (this.cache.has(str)) {
      return this.cache.get(str);
    }
    
    if (this.cache.size >= this.maxSize) {
      const halfSize = Math.floor(this.maxSize / 2);
      const keys = Array.from(this.cache.keys());
      for (let i = 0; i < halfSize; i++) {
        this.cache.delete(keys[i]);
      }
    }
    
    this.cache.set(str, str);
    return str;
  }

  /**
   * Clear interned strings
   */
  clear() {
    this.cache.clear();
  }

  /**
   * Get cache size
   */
  get size() {
    return this.cache.size;
  }
}

module.exports = {
  LRUCache,
  RouteCache,
  URLParseCache,
  ObjectPool,
  StringInterner
};