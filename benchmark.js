/**
 * Comprehensive Velocy Framework Benchmark
 * Tests routing performance, middleware execution, and overall throughput
 */

const http = require('http');
const { Router, createServer } = require('./index');

// Terminal colors for better output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  white: '\x1b[37m'
};

/**
 * Benchmark helper function
 */
function benchmark(name, iterations, fn) {
  // Warm-up
  for (let i = 0; i < 100; i++) {
    fn(i);
  }
  
  // Actual benchmark
  const start = process.hrtime.bigint();
  for (let i = 0; i < iterations; i++) {
    fn(i);
  }
  const end = process.hrtime.bigint();
  
  const duration = Number(end - start) / 1_000_000; // Convert to milliseconds
  const opsPerSec = Math.round(iterations / (duration / 1000));
  const avgTime = duration / iterations;
  
  return {
    name,
    duration,
    iterations,
    opsPerSec,
    avgTime
  };
}

/**
 * Async benchmark helper for HTTP requests
 */
async function benchmarkHttp(name, iterations, port, requests) {
  const results = [];
  const start = process.hrtime.bigint();
  
  for (let i = 0; i < iterations; i++) {
    const req = requests[i % requests.length];
    await makeRequest(port, req.method, req.path, req.body);
  }
  
  const end = process.hrtime.bigint();
  const duration = Number(end - start) / 1_000_000;
  const reqPerSec = Math.round(iterations / (duration / 1000));
  
  return {
    name,
    duration,
    iterations,
    reqPerSec,
    avgLatency: duration / iterations
  };
}

/**
 * Make HTTP request helper
 */
function makeRequest(port, method = 'GET', path = '/', body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port,
      path,
      method,
      headers: body ? {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      } : {}
    };
    
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

/**
 * Create test router with various routes
 */
function createTestRouter() {
  const router = new Router();
  
  // Add various route types
  router.get('/', (req, res) => res.json({ route: 'home' }));
  router.get('/users', (req, res) => res.json({ route: 'users' }));
  router.get('/users/:id', (req, res) => res.json({ route: 'user', id: req.params.id }));
  router.get('/users/:id/posts', (req, res) => res.json({ route: 'user-posts', id: req.params.id }));
  router.get('/users/:id/posts/:postId', (req, res) => res.json({ route: 'post', id: req.params.id, postId: req.params.postId }));
  router.post('/api/data', (req, res) => res.json({ received: true }));
  router.put('/api/data/:id', (req, res) => res.json({ updated: req.params.id }));
  router.delete('/api/data/:id', (req, res) => res.json({ deleted: req.params.id }));
  
  // Add wildcard routes
  router.get('/static/*', (req, res) => res.json({ file: req.params['*'] }));
  router.get('/assets/**', (req, res) => res.json({ path: req.params['**'] }));
  
  // Add many routes for realistic scenario
  for (let i = 0; i < 100; i++) {
    router.get(`/route${i}`, (req, res) => res.json({ route: `route${i}` }));
    router.get(`/api/v1/resource${i}`, (req, res) => res.json({ resource: i }));
    router.get(`/api/v1/resource${i}/:id`, (req, res) => res.json({ resource: i, id: req.params.id }));
  }
  
  return router;
}

/**
 * Print results in a formatted table
 */
function printResults(title, results) {
  console.log('\n' + colors.bright + colors.cyan + '═'.repeat(80) + colors.reset);
  console.log(colors.bright + colors.white + title + colors.reset);
  console.log(colors.cyan + '═'.repeat(80) + colors.reset);
  
  results.forEach(result => {
    console.log(colors.bright + colors.green + `\n${result.name}:` + colors.reset);
    console.log('  ' + colors.yellow + 'Duration:' + colors.reset + ` ${result.duration.toFixed(2)}ms`);
    
    if (result.opsPerSec) {
      console.log('  ' + colors.yellow + 'Operations/sec:' + colors.reset + ` ${result.opsPerSec.toLocaleString()}`);
      console.log('  ' + colors.yellow + 'Avg time/op:' + colors.reset + ` ${result.avgTime.toFixed(4)}ms`);
    } else if (result.reqPerSec) {
      console.log('  ' + colors.yellow + 'Requests/sec:' + colors.reset + ` ${result.reqPerSec.toLocaleString()}`);
      console.log('  ' + colors.yellow + 'Avg latency:' + colors.reset + ` ${result.avgLatency.toFixed(4)}ms`);
    }
  });
}

/**
 * Main benchmark runner
 */
async function runBenchmarks() {
  console.log(colors.bright + colors.blue + '\n' + '█'.repeat(80) + colors.reset);
  console.log(colors.bright + colors.white + '                        VELOCY FRAMEWORK BENCHMARK' + colors.reset);
  console.log(colors.bright + colors.blue + '█'.repeat(80) + colors.reset);
  
  const router = createTestRouter();
  
  // Print router info
  console.log(colors.cyan + '\n📊 Test Configuration:' + colors.reset);
  console.log('  • Total routes: 300+');
  console.log('  • Route types: Static, Dynamic, Wildcard');
  console.log('  • Test iterations: 100,000 per test\n');
  
  // Test 1: Route Matching Performance
  const routeMatchingTests = [
    { path: '/', name: 'Root route (/)' },
    { path: '/users', name: 'Static route (/users)' },
    { path: '/users/123', name: 'Single param (/users/:id)' },
    { path: '/users/123/posts', name: 'Nested route (/users/:id/posts)' },
    { path: '/users/123/posts/456', name: 'Multiple params (/users/:id/posts/:postId)' },
    { path: '/route50', name: 'Middle route (/route50)' },
    { path: '/route99', name: 'Last route (/route99)' },
    { path: '/static/app.js', name: 'Wildcard route (/static/*)' },
    { path: '/assets/images/logo.png', name: 'Catch-all route (/assets/**)' },
    { path: '/api/v1/resource75/999', name: 'Deep nested param (/api/v1/resource75/:id)' }
  ];
  
  const routeResults = [];
  const mockReq = { method: 'GET', url: '', headers: {} };
  const mockRes = { 
    json: () => {}, 
    end: () => {},
    status: () => mockRes,
    send: () => {},
    writeHead: () => {},
    write: () => {}
  };
  
  for (const test of routeMatchingTests) {
    const result = benchmark(
      test.name,
      100000,
      () => {
        mockReq.url = test.path;
        router.handleRequest(mockReq, mockRes);
      }
    );
    routeResults.push(result);
  }
  
  printResults('ROUTE MATCHING PERFORMANCE', routeResults);
  
  // Test 2: Middleware Performance
  console.log(colors.cyan + '\n\n📊 Testing Middleware Performance...' + colors.reset);
  
  const middlewareRouter = new Router();
  let middlewareCounter = 0;
  
  // Add multiple middleware layers
  middlewareRouter.use((req, res, next) => { middlewareCounter++; next(); });
  middlewareRouter.use((req, res, next) => { middlewareCounter++; next(); });
  middlewareRouter.use((req, res, next) => { middlewareCounter++; next(); });
  middlewareRouter.use('/api', (req, res, next) => { middlewareCounter++; next(); });
  middlewareRouter.use('/api', (req, res, next) => { middlewareCounter++; next(); });
  
  middlewareRouter.get('/api/test', (req, res) => res.json({ ok: true }));
  
  const middlewareResult = benchmark(
    'Middleware chain execution (5 middleware)',
    100000,
    () => {
      mockReq.url = '/api/test';
      middlewareRouter.handleRequest(mockReq, mockRes);
    }
  );
  
  printResults('MIDDLEWARE PERFORMANCE', [middlewareResult]);
  
  // Test 3: HTTP Server Throughput
  console.log(colors.cyan + '\n\n📊 Testing HTTP Server Throughput...' + colors.reset);
  console.log('  Starting test server on port 9999...\n');
  
  const server = createServer(router);
  await new Promise(resolve => {
    server.listen(9999, resolve);
  });
  
  const httpRequests = [
    { method: 'GET', path: '/' },
    { method: 'GET', path: '/users' },
    { method: 'GET', path: '/users/123' },
    { method: 'GET', path: '/users/456/posts' },
    { method: 'POST', path: '/api/data', body: JSON.stringify({ test: 'data' }) },
    { method: 'GET', path: '/route75' },
    { method: 'GET', path: '/api/v1/resource50/999' }
  ];
  
  // Warm-up
  for (let i = 0; i < 100; i++) {
    await makeRequest(9999, 'GET', '/');
  }
  
  const httpResult = await benchmarkHttp(
    'Mixed HTTP requests (various routes)',
    10000,
    9999,
    httpRequests
  );
  
  printResults('HTTP SERVER THROUGHPUT', [httpResult]);
  
  // Close server
  server.close();
  
  // Test 4: Memory efficiency
  console.log(colors.cyan + '\n\n📊 Memory Usage:' + colors.reset);
  const memUsage = process.memoryUsage();
  console.log(`  • Heap Used: ${(memUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  • Heap Total: ${(memUsage.heapTotal / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  • RSS: ${(memUsage.rss / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  • External: ${(memUsage.external / 1024 / 1024).toFixed(2)} MB`);
  
  // Summary
  console.log('\n' + colors.bright + colors.green + '═'.repeat(80) + colors.reset);
  console.log(colors.bright + colors.white + 'BENCHMARK SUMMARY' + colors.reset);
  console.log(colors.green + '═'.repeat(80) + colors.reset);
  
  // Calculate average operations per second across all route tests
  const avgOpsPerSec = routeResults.reduce((sum, r) => sum + r.opsPerSec, 0) / routeResults.length;
  
  console.log(colors.bright + colors.yellow + '\n🏆 Key Metrics:' + colors.reset);
  console.log(`  • Average routing performance: ${colors.bright}${avgOpsPerSec.toLocaleString()} ops/sec${colors.reset}`);
  console.log(`  • HTTP throughput: ${colors.bright}${httpResult.reqPerSec.toLocaleString()} req/sec${colors.reset}`);
  console.log(`  • Average latency: ${colors.bright}${httpResult.avgLatency.toFixed(3)}ms${colors.reset}`);
  console.log(`  • Middleware overhead: ${colors.bright}${middlewareResult.avgTime.toFixed(4)}ms${colors.reset}`);
  
  // Performance grade
  let grade = 'A+';
  if (avgOpsPerSec < 1000000) grade = 'A';
  if (avgOpsPerSec < 500000) grade = 'B';
  if (avgOpsPerSec < 100000) grade = 'C';
  
  console.log(colors.bright + colors.cyan + `\n📈 Performance Grade: ${colors.green}${grade}${colors.reset}`);
  
  console.log('\n' + colors.bright + colors.blue + '█'.repeat(80) + colors.reset);
  console.log(colors.bright + colors.white + '                         BENCHMARK COMPLETE!' + colors.reset);
  console.log(colors.bright + colors.blue + '█'.repeat(80) + colors.reset + '\n');
}

// Run benchmarks
runBenchmarks().catch(console.error);