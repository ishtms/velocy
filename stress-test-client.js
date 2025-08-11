/**
 * Stress test client for Velocy
 * Sends many concurrent requests to test performance under load
 */

const http = require('node:http');

const HOST = 'localhost';
const PORT = 3001;
const CONCURRENT_CONNECTIONS = 10;
const REQUESTS_PER_CONNECTION = 1000;
const REQUEST_DELAY_MS = 10; // Delay between requests per connection

// Route patterns to test
const routes = [
  // Static routes
  ...Array.from({ length: 20 }, (_, i) => `/static${i}`),
  
  // Dynamic routes with different user IDs
  ...Array.from({ length: 20 }, (_, i) => `/users/${Math.floor(Math.random() * 1000)}/data${i}`),
  
  // Nested dynamic routes
  ...Array.from({ length: 20 }, (_, i) => 
    `/api/v${i}/users/${Math.floor(Math.random() * 100)}/posts/${Math.floor(Math.random() * 1000)}`
  ),
  
  // Wildcard routes
  '/files/app.js',
  '/files/style.css',
  '/files/vendor.js',
  '/files/main.css',
  '/assets/images/logo.png',
  '/assets/fonts/roboto.woff2',
  '/assets/data/config.json'
];

// Statistics
let totalRequests = 0;
let successfulRequests = 0;
let failedRequests = 0;
let totalLatency = 0;
let minLatency = Infinity;
let maxLatency = 0;
const latencies = [];

// HTTP agent with connection pooling
const agent = new http.Agent({
  keepAlive: true,
  maxSockets: CONCURRENT_CONNECTIONS
});

/**
 * Make a single HTTP request
 */
function makeRequest() {
  return new Promise((resolve) => {
    const route = routes[Math.floor(Math.random() * routes.length)];
    const startTime = Date.now();
    
    const options = {
      hostname: HOST,
      port: PORT,
      path: route,
      method: 'GET',
      agent: agent
    };
    
    const req = http.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        const latency = Date.now() - startTime;
        totalRequests++;
        successfulRequests++;
        totalLatency += latency;
        minLatency = Math.min(minLatency, latency);
        maxLatency = Math.max(maxLatency, latency);
        latencies.push(latency);
        
        resolve({ success: true, latency, route });
      });
    });
    
    req.on('error', (err) => {
      totalRequests++;
      failedRequests++;
      resolve({ success: false, error: err.message, route });
    });
    
    req.end();
  });
}

/**
 * Run requests for a single connection
 */
async function runConnection(connectionId) {
  console.log(`Connection ${connectionId}: Starting ${REQUESTS_PER_CONNECTION} requests`);
  
  for (let i = 0; i < REQUESTS_PER_CONNECTION; i++) {
    await makeRequest();
    
    // Small delay between requests
    if (REQUEST_DELAY_MS > 0) {
      await new Promise(resolve => setTimeout(resolve, REQUEST_DELAY_MS));
    }
    
    // Progress update
    if ((i + 1) % 100 === 0) {
      console.log(`Connection ${connectionId}: ${i + 1}/${REQUESTS_PER_CONNECTION} completed`);
    }
  }
  
  console.log(`Connection ${connectionId}: Finished`);
}

/**
 * Calculate percentiles
 */
function calculatePercentile(arr, percentile) {
  const sorted = arr.slice().sort((a, b) => a - b);
  const index = Math.ceil((percentile / 100) * sorted.length) - 1;
  return sorted[index];
}

/**
 * Main stress test
 */
async function runStressTest() {
  console.log('='.repeat(60));
  console.log('Velocy Stress Test Client');
  console.log('='.repeat(60));
  console.log(`Target: http://${HOST}:${PORT}`);
  console.log(`Connections: ${CONCURRENT_CONNECTIONS}`);
  console.log(`Requests per connection: ${REQUESTS_PER_CONNECTION}`);
  console.log(`Total requests: ${CONCURRENT_CONNECTIONS * REQUESTS_PER_CONNECTION}`);
  console.log(`Request delay: ${REQUEST_DELAY_MS}ms`);
  console.log('');
  console.log('Starting stress test...');
  console.log('-'.repeat(60));
  
  const startTime = Date.now();
  
  // Run all connections concurrently
  const connections = [];
  for (let i = 0; i < CONCURRENT_CONNECTIONS; i++) {
    connections.push(runConnection(i + 1));
  }
  
  await Promise.all(connections);
  
  const duration = (Date.now() - startTime) / 1000;
  
  // Calculate statistics
  const avgLatency = totalLatency / successfulRequests;
  const p50 = calculatePercentile(latencies, 50);
  const p95 = calculatePercentile(latencies, 95);
  const p99 = calculatePercentile(latencies, 99);
  const rps = totalRequests / duration;
  
  console.log('');
  console.log('='.repeat(60));
  console.log('STRESS TEST RESULTS');
  console.log('='.repeat(60));
  console.log(`Duration: ${duration.toFixed(2)} seconds`);
  console.log(`Total Requests: ${totalRequests}`);
  console.log(`Successful: ${successfulRequests}`);
  console.log(`Failed: ${failedRequests}`);
  console.log(`Success Rate: ${((successfulRequests / totalRequests) * 100).toFixed(2)}%`);
  console.log('');
  console.log('Performance:');
  console.log(`  Requests/sec: ${rps.toFixed(2)}`);
  console.log('');
  console.log('Latency (ms):');
  console.log(`  Min: ${minLatency}`);
  console.log(`  Avg: ${avgLatency.toFixed(2)}`);
  console.log(`  P50: ${p50}`);
  console.log(`  P95: ${p95}`);
  console.log(`  P99: ${p99}`);
  console.log(`  Max: ${maxLatency}`);
  console.log('');
  
  // Fetch and display server stats
  try {
    const statsReq = http.get(`http://${HOST}:${PORT}/stress/stats`, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        const stats = JSON.parse(data);
        console.log('Server Cache Statistics:');
        console.log(`  Route Cache Hit Rate: ${stats.cache.route.hitRate}`);
        console.log(`  Route Cache Size: ${stats.cache.route.size}`);
        console.log(`  URL Cache Hit Rate: ${stats.cache.url.hitRate}`);
        console.log(`  URL Cache Size: ${stats.cache.url.size}`);
        console.log(`  Memory Used: ${(stats.memory.heapUsed / 1024 / 1024).toFixed(2)} MB`);
        console.log('='.repeat(60));
        
        // Close agent and exit
        agent.destroy();
        process.exit(0);
      });
    });
    
    statsReq.on('error', () => {
      console.log('Could not fetch server statistics');
      agent.destroy();
      process.exit(0);
    });
  } catch (err) {
    agent.destroy();
    process.exit(0);
  }
}

// Run the stress test
runStressTest().catch(err => {
  console.error('Stress test failed:', err);
  agent.destroy();
  process.exit(1);
});