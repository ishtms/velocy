/**
 * Example demonstrating Velocy's performance optimizations
 * This example shows how to enable and monitor performance features
 */

const { Router } = require('./lib/core/Router');
const { createServer } = require('./lib/utils');

// Create router with performance optimizations enabled
const app = new Router({
  // Enable route caching
  cache: true,
  routeCacheSize: 1000,  // Cache up to 1000 routes
  urlCacheSize: 500,     // Cache up to 500 parsed URLs
  
  // Enable performance monitoring (disabled in production by default)
  performance: {
    enabled: true,
    windowSize: 60000  // 1-minute window for throughput monitoring
  }
});

// Add some example routes
app.get('/', (req, res) => {
  res.json({ message: 'Welcome to Velocy!' });
});

// Dynamic route with parameters
app.get('/users/:id', (req, res) => {
  res.json({ 
    userId: req.params.id,
    cached: 'This route benefits from caching'
  });
});

// Nested dynamic routes
app.get('/api/v1/users/:userId/posts/:postId', (req, res) => {
  res.json({
    userId: req.params.userId,
    postId: req.params.postId
  });
});

// Wildcard routes
app.get('/static/*.js', (req, res) => {
  res.json({
    file: req.params['*'],
    type: 'JavaScript file'
  });
});

// Multiple middleware chain (tests middleware optimization)
app.get('/protected',
  (req, res, next) => {
    // Auth middleware
    req.user = { id: 1, name: 'Test User' };
    next();
  },
  (req, res, next) => {
    // Logging middleware
    console.log(`User ${req.user.name} accessed protected route`);
    next();
  },
  (req, res) => {
    res.json({ user: req.user });
  }
);

// Add many routes to test caching effectiveness
for (let i = 0; i < 100; i++) {
  app.get(`/test/route/${i}`, (req, res) => {
    res.json({ route: i });
  });
}

// Performance stats endpoint
app.get('/stats', (req, res) => {
  const stats = app.getPerformanceStats();
  res.json({
    performance: stats,
    memory: process.memoryUsage(),
    uptime: process.uptime()
  });
});

// Cache control endpoints
app.post('/cache/clear', (req, res) => {
  app.clearCaches();
  res.json({ message: 'Caches cleared' });
});

app.post('/cache/disable', (req, res) => {
  app.setCacheEnabled(false);
  res.json({ message: 'Caching disabled' });
});

app.post('/cache/enable', (req, res) => {
  app.setCacheEnabled(true);
  res.json({ message: 'Caching enabled' });
});

// Create and start server
const server = createServer(app);
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Velocy server running on http://localhost:${PORT}`);
  console.log('Performance optimizations enabled:');
  console.log('- Route caching: ON');
  console.log('- URL parsing cache: ON');
  console.log('- Object pooling: ON');
  console.log('- String interning: ON');
  console.log('- Exact route optimization: ON');
  console.log('');
  console.log('Endpoints:');
  console.log(`- GET /stats - View performance statistics`);
  console.log(`- POST /cache/clear - Clear all caches`);
  console.log(`- POST /cache/enable - Enable caching`);
  console.log(`- POST /cache/disable - Disable caching`);
  console.log('');
  console.log('Test with:');
  console.log(`  curl http://localhost:${PORT}/users/123`);
  console.log(`  curl http://localhost:${PORT}/api/v1/users/1/posts/456`);
  console.log(`  curl http://localhost:${PORT}/stats`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('\\nShutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('\\nShutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});