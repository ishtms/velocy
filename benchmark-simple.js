/**
 * Simple Velocy Performance Benchmark
 * Quick performance test for common operations
 */

const { Router, createServer } = require('./index');

console.log('\n🚀 VELOCY SIMPLE BENCHMARK\n');
console.log('='.repeat(50));

// Create router with test routes
const router = new Router();

// Add 1000 routes for realistic testing
console.log('📝 Setting up 1000 test routes...');
for (let i = 0; i < 1000; i++) {
  router.get(`/route${i}`, (req, res) => res.json({ route: i }));
}

// Add some dynamic routes
router.get('/users/:id', (req, res) => res.json({ userId: req.params.id }));
router.get('/posts/:id/comments/:commentId', (req, res) => res.json({ postId: req.params.id, commentId: req.params.commentId }));
router.get('/api/**', (req, res) => res.json({ path: req.params['**'] }));

console.log('✅ Routes ready!\n');

// Mock request/response for testing
const mockReq = { 
  method: 'GET', 
  url: '', 
  headers: {},
  nativeRequest: { on: () => {}, once: () => {} }
};
const mockRes = { 
  json: () => {}, 
  end: () => {},
  status: () => mockRes,
  send: () => {},
  writeHead: () => {},
  write: () => {},
  nativeResponse: { writeHead: () => {}, end: () => {} },
  finished: false,
  headersSent: false
};

// Test different route types
const tests = [
  { name: 'Static route (beginning)', url: '/route0' },
  { name: 'Static route (middle)', url: '/route500' },
  { name: 'Static route (end)', url: '/route999' },
  { name: 'Dynamic route (single param)', url: '/users/123' },
  { name: 'Dynamic route (multiple params)', url: '/posts/456/comments/789' },
  { name: 'Wildcard route', url: '/api/v1/users/list' },
  { name: 'Non-existent route', url: '/this/does/not/exist' }
];

console.log('🏃 Running performance tests...\n');
console.log('Test iterations: 100,000 per route\n');

const results = [];

for (const test of tests) {
  mockReq.url = test.url;
  
  // Warm-up
  for (let i = 0; i < 1000; i++) {
    router.handleRequest(mockReq, mockRes);
  }
  
  // Actual test
  const start = process.hrtime.bigint();
  const iterations = 100000;
  
  for (let i = 0; i < iterations; i++) {
    router.handleRequest(mockReq, mockRes);
  }
  
  const end = process.hrtime.bigint();
  const duration = Number(end - start) / 1_000_000; // ms
  const opsPerSec = Math.round(iterations / (duration / 1000));
  
  results.push({
    name: test.name,
    url: test.url,
    duration,
    opsPerSec,
    avgTime: duration / iterations
  });
  
  console.log(`✅ ${test.name}`);
  console.log(`   URL: ${test.url}`);
  console.log(`   Ops/sec: ${opsPerSec.toLocaleString()}`);
  console.log(`   Avg time: ${(duration / iterations).toFixed(4)}ms`);
  console.log('');
}

// Summary
console.log('='.repeat(50));
console.log('📊 SUMMARY\n');

const avgOpsPerSec = Math.round(results.reduce((sum, r) => sum + r.opsPerSec, 0) / results.length);
const avgTime = results.reduce((sum, r) => sum + r.avgTime, 0) / results.length;

console.log(`Average throughput: ${avgOpsPerSec.toLocaleString()} operations/second`);
console.log(`Average latency: ${avgTime.toFixed(4)}ms per request`);

// Memory usage
const mem = process.memoryUsage();
console.log(`\nMemory usage:`);
console.log(`  Heap: ${(mem.heapUsed / 1024 / 1024).toFixed(2)} MB`);
console.log(`  RSS: ${(mem.rss / 1024 / 1024).toFixed(2)} MB`);

console.log('\n' + '='.repeat(50));
console.log('✨ Benchmark complete!\n');