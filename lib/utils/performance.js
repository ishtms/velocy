/**
 * Performance monitoring and timing utilities for Velocy
 * Lightweight, zero-overhead when disabled
 */

const { performance } = require('node:perf_hooks');

/**
 * Performance timer with minimal overhead
 */
class PerformanceTimer {
  constructor(enabled = false) {
    this.enabled = enabled;
    this.metrics = new Map();
    this.timings = new Map();
  }

  /**
   * Start timing an operation
   * Returns a mark ID for ending the timing
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
   * End timing and record metric
   */
  end(markId) {
    if (!this.enabled || !markId) return 0;
    
    const timing = this.timings.get(markId);
    if (!timing) return 0;
    
    const duration = performance.now() - timing.start;
    this.timings.delete(markId);
    
    // Update metrics
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
   * Measure a synchronous operation
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
   * Measure an async operation
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
   * Get metrics for a label
   */
  getMetrics(label) {
    return this.metrics.get(label);
  }

  /**
   * Get all metrics
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
 * Request timing middleware factory
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
 * Memory usage tracker
 */
class MemoryTracker {
  constructor() {
    this.baseline = null;
    this.samples = [];
    this.maxSamples = 100;
  }

  /**
   * Set baseline memory usage
   */
  setBaseline() {
    this.baseline = process.memoryUsage();
  }

  /**
   * Sample current memory usage
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
   * Get memory statistics
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
 * Throughput monitor
 */
class ThroughputMonitor {
  constructor(windowSize = 60000) { // 1 minute window
    this.windowSize = windowSize;
    this.requests = [];
    this.startTime = Date.now();
  }

  /**
   * Record a request
   */
  record() {
    const now = Date.now();
    this.requests.push(now);
    
    // Clean old requests outside window
    const cutoff = now - this.windowSize;
    while (this.requests.length > 0 && this.requests[0] < cutoff) {
      this.requests.shift();
    }
  }

  /**
   * Get current requests per second
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
   * Get throughput statistics
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
 * Create performance hooks for router
 */
function createPerformanceHooks(options = {}) {
  const enabled = options.enabled !== false && process.env.NODE_ENV !== 'production';
  
  return {
    timer: new PerformanceTimer(enabled),
    memory: new MemoryTracker(),
    throughput: new ThroughputMonitor(options.windowSize),
    
    /**
     * Hook for route matching
     */
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
    
    /**
     * Hook for handler execution
     */
    handlerExec: function(path) {
      if (!enabled) return { end: () => {} };
      const markId = this.timer.start('handler_exec');
      return {
        end: () => this.timer.end(markId)
      };
    },
    
    /**
     * Get all performance metrics
     */
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