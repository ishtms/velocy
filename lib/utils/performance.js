/**
 * Performance monitoring and timing utilities for Velocy.
 * Lightweight, zero-overhead when disabled.
 * Uses Node.js performance API for high-resolution timing.
 * Only collects metrics when explicitly enabled to avoid production overhead.
 */

const { performance } = require('node:perf_hooks');

/**
 * Performance timer with minimal overhead.
 * Tracks timing metrics for different operations with statistical analysis.
 * Uses performance.now() for microsecond precision timing.
 * 
 * @class PerformanceTimer
 * @example
 * const timer = new PerformanceTimer(true);
 * const markId = timer.start('database-query');
 * // ... perform operation ...
 * const duration = timer.end(markId); // Returns duration in ms
 */
class PerformanceTimer {
  /**
   * Creates a new performance timer.
   * 
   * @constructor
   * @param {boolean} [enabled=false] - Whether timing is enabled
   */
  constructor(enabled = false) {
    /**
     * @type {boolean}
     * @description Whether performance tracking is enabled
     */
    this.enabled = enabled;
    
    /**
     * @type {Map<string, Object>}
     * @description Aggregated metrics for each label
     */
    this.metrics = new Map();
    
    /**
     * @type {Map<string, Object>}
     * @description Active timing sessions
     */
    this.timings = new Map();
  }

  /**
   * Starts timing an operation.
   * Returns a unique mark ID for ending the timing.
   * Uses performance.now() for high-resolution timestamps.
   * 
   * @param {string} label - Label for the operation being timed
   * @returns {string|null} Unique mark ID, or null if timing disabled
   * @example
   * const markId = timer.start('api-call');
   */
  start(label) {
    if (!this.enabled) return null;
    
    const markId = `${label}_${Date.now()}_${Math.random()}`;
    this.timings.set(markId, {
      label,
      start: performance.now()
    });
    return markId;
  }

  /**
   * Ends timing and records the metric.
   * Updates statistics including min, max, mean, and count.
   * Returns 0 if timing is disabled or markId is invalid.
   * 
   * @param {string|null} markId - Mark ID from start()
   * @returns {number} Duration in milliseconds, or 0 if invalid
   * @example
   * const duration = timer.end(markId);
   */
  end(markId) {
    if (!this.enabled || !markId) return 0;
    
    const timing = this.timings.get(markId);
    if (!timing) return 0;
    
    const duration = performance.now() - timing.start;
    this.timings.delete(markId);
    
    if (!this.metrics.has(timing.label)) {
      this.metrics.set(timing.label, {
        count: 0,
        total: 0,
        min: Infinity,
        max: -Infinity,
        mean: 0,
        last: 0
      });
    }
    
    const metric = this.metrics.get(timing.label);
    metric.count++;
    metric.total += duration;
    metric.min = Math.min(metric.min, duration);
    metric.max = Math.max(metric.max, duration);
    metric.mean = metric.total / metric.count;
    metric.last = duration;
    
    return duration;
  }

  /**
   * Measures a synchronous operation.
   * Wraps the function execution with automatic timing.
   * Returns the function result while recording timing.
   * 
   * @param {string} label - Label for the measurement
   * @param {Function} fn - Synchronous function to measure
   * @returns {*} Result from the function
   * @example
   * const result = timer.measure('compute', () => {
   *   return expensiveComputation();
   * });
   */
  measure(label, fn) {
    if (!this.enabled) return fn();
    
    const markId = this.start(label);
    try {
      return fn();
    } finally {
      this.end(markId);
    }
  }

  /**
   * Measures an asynchronous operation.
   * Wraps async function execution with automatic timing.
   * Properly handles promise resolution and rejection.
   * 
   * @param {string} label - Label for the measurement
   * @param {Function} fn - Async function to measure
   * @returns {Promise<*>} Promise resolving to function result
   * @example
   * const result = await timer.measureAsync('db-query', async () => {
   *   return await database.query('SELECT * FROM users');
   * });
   */
  async measureAsync(label, fn) {
    if (!this.enabled) return fn();
    
    const markId = this.start(label);
    try {
      return await fn();
    } finally {
      this.end(markId);
    }
  }

  /**
   * Gets metrics for a specific label.
   * Returns statistical data for all measurements with this label.
   * 
   * @param {string} label - Label to get metrics for
   * @returns {Object|undefined} Metrics object with statistics or undefined
   * @example
   * const metrics = timer.getMetrics('api-call');
   * // { count: 100, total: 5000, min: 10, max: 200, mean: 50, last: 45 }
   */
  getMetrics(label) {
    return this.metrics.get(label);
  }

  /**
   * Gets all collected metrics.
   * Returns a copy of all metrics to prevent external modifications.
   * 
   * @returns {Object<string, Object>} Object with all metrics by label
   * @example
   * const allMetrics = timer.getAllMetrics();
   * // { 'api-call': {...}, 'db-query': {...} }
   */
  getAllMetrics() {
    const result = {};
    for (const [label, metric] of this.metrics) {
      result[label] = { ...metric };
    }
    return result;
  }

  /**
   * Reset metrics
   */
  reset() {
    this.metrics.clear();
    this.timings.clear();
  }

  /**
   * Enable/disable timing
   */
  setEnabled(enabled) {
    this.enabled = enabled;
    if (!enabled) {
      this.reset();
    }
  }
}

/**
 * Request timing middleware factory.
 * Creates Express-compatible middleware for automatic request timing.
 * Measures from request start to response end.
 * 
 * @param {PerformanceTimer} timer - Timer instance to use
 * @returns {Function} Express middleware function
 * @example
 * const timer = new PerformanceTimer(true);
 * app.use(createTimingMiddleware(timer));
 */
function createTimingMiddleware(timer) {
  return (req, res, next) => {
    if (!timer.enabled) return next();
    
    const markId = timer.start('request');
    const originalEnd = res.end;
    
    res.end = function(...args) {
      timer.end(markId);
      return originalEnd.apply(this, args);
    };
    
    next();
  };
}

/**
 * Memory usage tracker.
 * Monitors application memory usage over time with sampling.
 * Tracks RSS, heap, and external memory with delta calculations.
 * 
 * @class MemoryTracker
 * @example
 * const tracker = new MemoryTracker();
 * tracker.setBaseline(); // Set initial baseline
 * tracker.sample(); // Take a sample
 * const stats = tracker.getStats(); // Get memory statistics
 */
class MemoryTracker {
  /**
   * Creates a new memory tracker.
   * 
   * @constructor
   */
  constructor() {
    /**
     * @type {Object|null}
     * @description Baseline memory usage for delta calculations
     */
    this.baseline = null;
    
    /**
     * @type {Array<Object>}
     * @description Array of memory samples
     */
    this.samples = [];
    
    /**
     * @type {number}
     * @description Maximum samples to keep (circular buffer)
     * @default 100
     */
    this.maxSamples = 100;
  }

  /**
   * Sets baseline memory usage.
   * Used as reference point for delta calculations.
   * Call this after application initialization.
   * 
   * @example
   * tracker.setBaseline();
   */
  setBaseline() {
    this.baseline = process.memoryUsage();
  }

  /**
   * Samples current memory usage.
   * Captures all memory metrics and calculates deltas from baseline.
   * Maintains a circular buffer of samples to limit memory usage.
   * 
   * @returns {Object} Current memory sample with metrics and deltas
   * @example
   * const sample = tracker.sample();
   * // { timestamp: 1234567890, rss: 50000000, heapUsed: 20000000, ... }
   */
  sample() {
    const usage = process.memoryUsage();
    const sample = {
      timestamp: Date.now(),
      rss: usage.rss,
      heapTotal: usage.heapTotal,
      heapUsed: usage.heapUsed,
      external: usage.external,
      arrayBuffers: usage.arrayBuffers
    };
    
    if (this.baseline) {
      sample.delta = {
        rss: usage.rss - this.baseline.rss,
        heapTotal: usage.heapTotal - this.baseline.heapTotal,
        heapUsed: usage.heapUsed - this.baseline.heapUsed,
        external: usage.external - this.baseline.external,
        arrayBuffers: usage.arrayBuffers - this.baseline.arrayBuffers
      };
    }
    
    this.samples.push(sample);
    if (this.samples.length > this.maxSamples) {
      this.samples.shift();
    }
    
    return sample;
  }

  /**
   * Gets memory statistics.
   * Returns current usage, baseline, and aggregated statistics.
   * Calculates min/max/mean for heap usage across samples.
   * 
   * @returns {Object|null} Memory statistics or null if no samples
   * @example
   * const stats = tracker.getStats();
   * // { current: {...}, baseline: {...}, samples: 100, heapUsed: { min: 10MB, max: 50MB, mean: 25MB } }
   */
  getStats() {
    if (this.samples.length === 0) return null;
    
    const latest = this.samples[this.samples.length - 1];
    const heapUsedValues = this.samples.map(s => s.heapUsed);
    
    return {
      current: latest,
      baseline: this.baseline,
      samples: this.samples.length,
      heapUsed: {
        min: Math.min(...heapUsedValues),
        max: Math.max(...heapUsedValues),
        mean: heapUsedValues.reduce((a, b) => a + b, 0) / heapUsedValues.length
      }
    };
  }

  /**
   * Reset tracker
   */
  reset() {
    this.baseline = null;
    this.samples = [];
  }
}

/**
 * Throughput monitor.
 * Tracks requests per second using a sliding time window.
 * Automatically cleans old requests outside the window.
 * 
 * @class ThroughputMonitor
 * @example
 * const monitor = new ThroughputMonitor(60000); // 1-minute window
 * monitor.record(); // Record a request
 * const rps = monitor.getRPS(); // Get current RPS
 */
class ThroughputMonitor {
  /**
   * Creates a new throughput monitor.
   * 
   * @constructor
   * @param {number} [windowSize=60000] - Time window in milliseconds (default: 1 minute)
   */
  constructor(windowSize = 60000) {
    /**
     * @type {number}
     * @description Size of the sliding time window in milliseconds
     */
    this.windowSize = windowSize;
    
    /**
     * @type {Array<number>}
     * @description Timestamps of requests within the window
     */
    this.requests = [];
    
    /**
     * @type {number}
     * @description Monitor start time for uptime calculation
     */
    this.startTime = Date.now();
  }

  /**
   * Records a request.
   * Adds timestamp and cleans old requests outside the window.
   * Maintains efficient sliding window for RPS calculation.
   * 
   * @example
   * monitor.record(); // Record current request
   */
  record() {
    const now = Date.now();
    this.requests.push(now);
    
    const cutoff = now - this.windowSize;
    while (this.requests.length > 0 && this.requests[0] < cutoff) {
      this.requests.shift();
    }
  }

  /**
   * Gets current requests per second.
   * Calculates RPS based on requests within the time window.
   * Handles edge cases like startup period correctly.
   * 
   * @returns {number} Current requests per second
   * @example
   * const rps = monitor.getRPS(); // e.g., 150.5
   */
  getRPS() {
    const now = Date.now();
    const windowStart = now - this.windowSize;
    const activeRequests = this.requests.filter(t => t >= windowStart);
    
    if (activeRequests.length === 0) return 0;
    
    const duration = Math.min(now - this.startTime, this.windowSize);
    return (activeRequests.length / duration) * 1000;
  }

  /**
   * Gets throughput statistics.
   * Returns RPS, RPM, total requests, and uptime.
   * 
   * @returns {Object} Throughput statistics
   * @example
   * const stats = monitor.getStats();
   * // { rps: 150, rpm: 9000, totalRequests: 500, windowSize: 60000, uptime: 300000 }
   */
  getStats() {
    const rps = this.getRPS();
    return {
      rps,
      rpm: rps * 60,
      totalRequests: this.requests.length,
      windowSize: this.windowSize,
      uptime: Date.now() - this.startTime
    };
  }

  /**
   * Reset monitor
   */
  reset() {
    this.requests = [];
    this.startTime = Date.now();
  }
}

/**
 * Creates performance hooks for router.
 * Provides integrated performance monitoring for routing operations.
 * Automatically disabled in production unless explicitly enabled.
 * 
 * @param {Object} [options={}] - Configuration options
 * @param {boolean} [options.enabled] - Whether monitoring is enabled
 * @param {number} [options.windowSize] - Throughput monitoring window size
 * @returns {Object} Performance hooks object with timer, memory, and throughput monitors
 * @example
 * const hooks = createPerformanceHooks({ enabled: true });
 * const metrics = hooks.getMetrics(); // Get all performance metrics
 */
function createPerformanceHooks(options = {}) {
  const enabled = options.enabled !== false && process.env.NODE_ENV !== 'production';
  
  return {
    timer: new PerformanceTimer(enabled),
    memory: new MemoryTracker(),
    throughput: new ThroughputMonitor(options.windowSize),
    
    routeMatch: function(method, path) {
      if (!enabled) return { end: () => {} };
      const markId = this.timer.start('route_match');
      return {
        end: (found) => {
          const duration = this.timer.end(markId);
          if (!found) {
            this.timer.start('route_miss');
            this.timer.end('route_miss');
          }
          return duration;
        }
      };
    },
    
    handlerExec: function(path) {
      if (!enabled) return { end: () => {} };
      const markId = this.timer.start('handler_exec');
      return {
        end: () => this.timer.end(markId)
      };
    },
    
    getMetrics: function() {
      return {
        timing: this.timer.getAllMetrics(),
        memory: this.memory.getStats(),
        throughput: this.throughput.getStats()
      };
    }
  };
}

module.exports = {
  PerformanceTimer,
  MemoryTracker,
  ThroughputMonitor,
  createTimingMiddleware,
  createPerformanceHooks
};