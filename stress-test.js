/**
 * Stress test for Velocy with performance optimizations
 * Simulates high-load scenarios to test caching and optimization effectiveness
 */

const http = require('node:http');
const { Router } = require('./lib/core/Router');
const { createServer } = require('./lib/utils');

// Create optimized router
const app = new Router({
  cache: true,
  routeCacheSize: 2000,
  urlCacheSize: 1000,
  performance: {
    enabled: true,
    windowSize: 10000 // 10-second window
  }
});

// Add various route types
// Static routes
for (let i = 0; i < 20; i++) {
  app.get(`/static${i}`, (req, res) => {
    res.json({ route: `static${i}`, type: 'static' });
  });
}

// Dynamic routes
for (let i = 0; i < 20; i++) {
  app.get(`/users/:userId/data${i}`, (req, res) => {
    res.json({ 
      route: `data${i}`, 
      userId: req.params.userId,
      type: 'dynamic'
    });
  });
}

// Nested dynamic routes
for (let i = 0; i < 20; i++) {
  app.get(`/api/v${i}/users/:userId/posts/:postId`, (req, res) => {
    res.json({
      version: i,
      userId: req.params.userId,
      postId: req.params.postId,
      type: 'nested'
    });
  });
}

// Wildcard routes
app.get('/files/*.js', (req, res) => {
  res.json({ file: req.params['*'], ext: 'js' });
});

app.get('/files/*.css', (req, res) => {
  res.json({ file: req.params['*'], ext: 'css' });
});

app.get('/assets/**', (req, res) => {
  res.json({ path: req.params['**'], type: 'asset' });
});

// Stats endpoint
app.get('/stress/stats', (req, res) => {
  const stats = app.getPerformanceStats();
  const perf = stats.performance || {};
  
  res.json({
    cache: {
      route: {
        hitRate: `${(stats.routeCache.hitRate * 100).toFixed(1)}%`,
        size: stats.routeCache.size,
        hits: stats.routeCache.hits,
        misses: stats.routeCache.misses,
        evictions: stats.routeCache.evictions
      },
      url: {
        hitRate: `${(stats.urlCache.hitRate * 100).toFixed(1)}%`,
        size: stats.urlCache.size,
        hits: stats.urlCache.hits,
        misses: stats.urlCache.misses
      },
      exactRoutes: stats.exactRoutes,
      regexCache: stats.regexCache
    },
    performance: perf,
    memory: process.memoryUsage(),
    uptime: process.uptime()
  });
});

// Start server
const server = createServer(app);
const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
  console.log(`Stress test server running on http://localhost:${PORT}`);
  console.log('');
  console.log('Run stress test with:');
  console.log(`  node stress-test-client.js`);
  console.log('');
  console.log('Monitor stats at:');
  console.log(`  http://localhost:${PORT}/stress/stats`);
});

// Periodic stats logging
let requestCount = 0;
let lastRequestCount = 0;
let startTime = Date.now();

// Override handleRequest to count requests
const originalHandleRequest = app.handleRequest.bind(app);
app.handleRequest = async (req, res) => {
  requestCount++;
  return originalHandleRequest(req, res);
};

// Log stats every 5 seconds
setInterval(() => {
  const elapsed = (Date.now() - startTime) / 1000;
  const rps = (requestCount - lastRequestCount) / 5;
  const totalRps = requestCount / elapsed;
  
  const stats = app.getPerformanceStats();
  const routeCacheHitRate = (stats.routeCache.hitRate * 100).toFixed(1);
  const urlCacheHitRate = (stats.urlCache.hitRate * 100).toFixed(1);
  
  console.log(`[${new Date().toISOString()}] Stats:`);
  console.log(`  Current RPS: ${rps.toFixed(1)} | Avg RPS: ${totalRps.toFixed(1)}`);
  console.log(`  Total Requests: ${requestCount}`);
  console.log(`  Route Cache: ${routeCacheHitRate}% hit rate (${stats.routeCache.size} cached)`);
  console.log(`  URL Cache: ${urlCacheHitRate}% hit rate (${stats.urlCache.size} cached)`);
  console.log(`  Memory: ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1)} MB`);
  console.log('');
  
  lastRequestCount = requestCount;
}, 5000);

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('\\nShutting down...');
  server.close(() => {
    const stats = app.getPerformanceStats();
    console.log('\\nFinal Statistics:');
    console.log('='.repeat(60));
    console.log(`Total Requests: ${requestCount}`);
    console.log(`Route Cache Hit Rate: ${(stats.routeCache.hitRate * 100).toFixed(1)}%`);
    console.log(`URL Cache Hit Rate: ${(stats.urlCache.hitRate * 100).toFixed(1)}%`);
    console.log(`Cache Evictions: ${stats.routeCache.evictions}`);
    console.log('='.repeat(60));
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('\\nShutting down...');
  server.close(() => {
    const stats = app.getPerformanceStats();
    console.log('\\nFinal Statistics:');
    console.log('='.repeat(60));
    console.log(`Total Requests: ${requestCount}`);
    console.log(`Route Cache Hit Rate: ${(stats.routeCache.hitRate * 100).toFixed(1)}%`);
    console.log(`URL Cache Hit Rate: ${(stats.urlCache.hitRate * 100).toFixed(1)}%`);
    console.log(`Cache Evictions: ${stats.routeCache.evictions}`);
    console.log('='.repeat(60));
    process.exit(0);
  });
});