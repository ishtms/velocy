/**
 * High-performance LRU Cache implementation for Velocy
 * Zero-dependency, optimized for V8
 */

class LRUCache {
  constructor(maxSize = 1000) {
    this.maxSize = maxSize;
    this.cache = new Map();
    this.hits = 0;
    this.misses = 0;
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
    
    // Move to end (most recently used)
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
    // Remove old value if exists
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Evict least recently used (first item)
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
 * Optimized route cache with compound key generation
 */
class RouteCache {
  constructor(maxSize = 500) {
    this.cache = new LRUCache(maxSize);
    // Pre-allocated string builder for key generation
    this.keyBuffer = [];
  }

  /**
   * Generate cache key from method and path
   * Optimized to minimize string allocations
   */
  #generateKey(method, path) {
    // Reuse array, just update elements
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
    // Store as frozen object to prevent modifications
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
 * URL parsing cache for parsed URL components
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
      // Only cache if result is valid
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
 * Object pool for reducing allocations
 */
class ObjectPool {
  constructor(factory, reset, maxSize = 100) {
    this.factory = factory;
    this.reset = reset;
    this.maxSize = maxSize;
    this.pool = [];
    this.created = 0;
    this.borrowed = 0;
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
      this.reset(obj);
      this.pool.push(obj);
      this.returned++;
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
 * Fast string interning for common strings
 */
class StringInterner {
  constructor(maxSize = 500) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  /**
   * Intern a string
   */
  intern(str) {
    if (this.cache.has(str)) {
      return this.cache.get(str);
    }
    
    if (this.cache.size >= this.maxSize) {
      // Simple eviction: clear half the cache
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