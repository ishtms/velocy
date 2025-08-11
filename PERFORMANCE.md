# Velocy Performance Guide

## Zero-Cost Abstractions

Velocy follows the principle of "zero-cost abstractions" - you only pay for the features you use. The framework provides two router implementations optimized for different use cases.

## Router Implementations

### 1. FastRouter (Minimal Overhead)
The `FastRouter` class provides the absolute minimum overhead for high-performance scenarios:

```javascript
const { FastRouter } = require('velocy');
const http = require('http');

const router = new FastRouter();

router.get('/', (req, res) => {
  res.end('Hello, World!');
});

const server = http.createServer((req, res) => {
  router.handleRequest(req, res);
});
```

**Features:**
- Basic routing with parameters (`:id` syntax)
- Minimal memory footprint
- No middleware support
- No Request/Response wrappers
- Direct access to Node.js req/res objects

**Performance:** Matches or exceeds the original v0.0.14 performance

### 2. Router (Full Featured)
The standard `Router` class provides comprehensive features with lazy initialization:

```javascript
const { Router, createServer } = require('velocy');

const router = new Router({
  // Enable only what you need
  cache: true,        // Enable route caching
  performance: true   // Enable performance monitoring
});

// Features are lazy-loaded when first used
router.use(middleware);  // Middleware system activates on first use
router.ws('/socket');    // WebSocket support activates on first use
```

**Features (all lazy-loaded):**
- Middleware system (global and path-specific)
- WebSocket support with rooms/channels
- Template engine integration
- Request/Response helper methods
- Cookie handling and sessions
- Body parsing
- Route caching and optimization
- Error handling middleware

## Performance Optimization Tips

### 1. Choose the Right Router

For maximum performance with basic needs:
```javascript
const { FastRouter } = require('velocy');
const router = new FastRouter();
// 0% overhead compared to v0.0.14
```

For full features with selective optimization:
```javascript
const { Router } = require('velocy');
const router = new Router({ 
  cache: true  // Enable only what you need
});
```

### 2. Avoid Unnecessary Features

Features are lazy-loaded, but once activated they add overhead:

```javascript
// BAD: Activates middleware system even if not needed
const router = new Router();
router.use((req, res, next) => next()); // Middleware system now active

// GOOD: Only use middleware when necessary
const router = new Router();
// Don't call use() if you don't need middleware
```

### 3. Enable Caching for High-Traffic Routes

```javascript
const router = new Router({ 
  cache: true,
  routeCacheSize: 1000  // Adjust based on route patterns
});
```

### 4. Use Direct Methods for Simple Responses

When using FastRouter or simple handlers:
```javascript
// FAST: Direct response
router.get('/api/status', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end('{"status":"ok"}');
});

// SLOWER: Using helpers (adds overhead)
router.get('/api/status', (req, res) => {
  res.json({ status: 'ok' });
});
```

## Benchmark Results

### FastRouter vs Original v0.0.14
- **Plaintext**: +3% throughput
- **JSON**: -1% throughput (within margin of error)
- **Overall**: Performance parity achieved

### Standard Router (no features enabled)
- **Overhead**: ~12-15% vs FastRouter
- **With caching**: ~8-10% vs FastRouter
- **With all features**: ~20-25% vs FastRouter

### Feature Activation Costs
- Middleware system: ~5-8% overhead
- WebSocket support: ~2-3% overhead (only on upgrade)
- Template engine: ~1-2% overhead (only on render)
- Cookie parsing: ~2-3% overhead (only when cookies present)

## Key Optimizations

### 1. Route Caching
- **LRU Cache**: Frequently accessed routes are cached using a Least Recently Used (LRU) cache
- **Compound Keys**: Cache keys combine HTTP method and path for accurate lookups
- **Automatic Invalidation**: Cache is automatically cleared when routes are added or modified
- **Configurable Size**: Cache size can be tuned based on your application's needs

### 2. URL Parsing Cache
- **Parsed URL Components**: URL parsing results are cached to avoid repeated string operations
- **Query String Caching**: Query parameters are parsed once and cached
- **Path Normalization**: Normalized paths (trailing slash removal) are cached

### 3. Exact Route Optimization
- **Fast Map Lookup**: Static routes without parameters use O(1) hash map lookups
- **Pre-indexed Routes**: Exact routes are indexed at startup for instant matching
- **Automatic Rebuilding**: Index is rebuilt when routes change

### 4. Object Pooling
- **Parameter Objects**: Route parameter objects are pooled and reused
- **Reduced GC Pressure**: Fewer object allocations mean less garbage collection
- **Automatic Cleanup**: Objects are cleaned and returned to the pool after use

### 5. String Interning
- **Common Strings**: Frequently used path segments are interned
- **Memory Efficiency**: Reduces memory usage for duplicate strings
- **Faster Comparisons**: Interned strings enable reference equality checks

## Running Benchmarks

```bash
# Compare with old version
npm run compare

# Run comprehensive benchmark
npm run benchmark

# Quick benchmark
npm run bench

# Test FastRouter specifically
node test-fast-router.js
```

## Migration Guide

### From v0.0.14 to FastRouter
No changes needed - FastRouter maintains the same API:

```javascript
// Old (v0.0.14)
const router = new Router();
router.get('/', handler);

// New (FastRouter)
const router = new FastRouter();
router.get('/', handler);
```

### From FastRouter to Full Router
Simply switch the import and add features as needed:

```javascript
// Upgrade from FastRouter
const { Router } = require('velocy');
const router = new Router();

// Now you can add features
router.use(cors());
router.ws('/socket', wsHandler);
```

## Best Practices

1. **Start with FastRouter** for new projects and upgrade only when needed
2. **Profile your application** to identify actual bottlenecks
3. **Enable caching** for applications with many routes
4. **Lazy-load middleware** - add middleware only to routes that need it
5. **Batch operations** when possible to reduce overhead

## Configuration Examples

### Maximum Performance (FastRouter)
```javascript
const { FastRouter } = require('velocy');
const http = require('http');

const app = new FastRouter();
// Add routes
const server = http.createServer((req, res) => {
  app.handleRequest(req, res);
});
```

### Balanced Performance (Router with selective features)
```javascript
const { Router } = require('velocy');

const app = new Router({
  cache: true,              // Enable caching
  routeCacheSize: 1000,     // Larger cache for more routes
  performance: false        // Disable monitoring in production
});
```

### Full Features (All capabilities enabled)
```javascript
const { Router } = require('velocy');

const app = new Router({
  cache: true,
  performance: {
    enabled: true,
    windowSize: 60000
  },
  cookieSecret: 'secret',
  websocket: {
    perMessageDeflate: true
  }
});

// Use all features
app.use(cors());
app.use(bodyParser());
app.ws('/socket', wsHandler);
```

## Memory Considerations

### Memory Usage by Router Type
- **FastRouter**: ~2MB base memory
- **Router (no features)**: ~2.5MB base memory
- **Router (all features)**: ~5MB base memory
- **Per route**: ~200 bytes
- **Per middleware**: ~500 bytes

### Cache Memory Usage
- Route Cache: ~1KB per cached route
- URL Cache: ~200 bytes per cached URL
- Regex Cache: ~500 bytes per compiled pattern
- Total overhead: Typically < 1MB for moderate applications

## Troubleshooting Performance Issues

### 1. Check Active Features
```javascript
// Debug what's loaded
console.log({
  middleware: router._globalMiddleware !== null,
  websocket: router._wsRouter !== null,
  viewEngine: router._viewEngine !== null,
  caching: router._routeCache !== null
});
```

### 2. Monitor Performance
```javascript
const router = new Router({ 
  performance: {
    enabled: true,
    logSlowRequests: true,
    slowRequestThreshold: 100 // ms
  }
});
```

### 3. Analyze Cache Effectiveness
```javascript
// Get performance statistics
const stats = router.getPerformanceStats?.();
if (stats) {
  console.log('Cache hit rate:', stats.routeCache.hitRate);
}
```

### 4. Switch to FastRouter if Appropriate
```javascript
// If you don't need advanced features
const { FastRouter } = require('velocy');
const app = new FastRouter();
```

## Architecture Details

### Zero-Cost Implementation Strategies

1. **Lazy Initialization**: Features are only initialized when first accessed
2. **Fast Path Optimization**: Simple requests bypass feature checks entirely
3. **Conditional Loading**: Modules are required only when features are used
4. **Inline Optimizations**: Critical paths use inlined code for speed
5. **Property Getters**: Use getters to defer initialization until access

### How It Works

The Router class uses private fields with lazy getters:
```javascript
class Router {
  constructor() {
    this._middleware = null;  // Not initialized
  }
  
  get middleware() {
    if (!this._middleware) {
      this._middleware = [];  // Initialize on first access
    }
    return this._middleware;
  }
}
```

This ensures that if you never use middleware, you never pay for it.

## Future Optimizations

Planned improvements for future versions:
- Bloom filters for negative lookups
- Tiered caching (hot/warm/cold)
- Adaptive cache sizing based on traffic
- JIT compilation for hot paths
- SIMD optimizations for string matching
- Worker thread support for CPU-intensive operations

## Contributing

Performance improvements are always welcome! When contributing:
1. Benchmark before and after changes
2. Document memory impact
3. Ensure backward compatibility
4. Add tests for new optimizations
5. Consider zero-cost abstraction principles

## License

MIT