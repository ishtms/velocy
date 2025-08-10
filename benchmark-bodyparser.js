/**
 * Performance benchmark for body parser middleware
 * Compares parsing performance for different content types and sizes
 */

const { Router, createServer } = require("./index");
const bodyParser = require("./lib/middleware/bodyParser");
const http = require("http");

// Create test routers
const router = new Router();

// Apply body parser
router.use(
  bodyParser({
    jsonLimit: "10mb",
    urlencodedLimit: "10mb",
    multipartLimit: "50mb",
    cache: true,
  })
);

router.post("/json", async (req, res) => {
  const body = await req.body;
  res.json({ received: Object.keys(body).length });
});

router.post("/urlencoded", async (req, res) => {
  const body = await req.body;
  res.json({ received: Object.keys(body).length });
});

router.post("/multipart", async (req, res) => {
  const body = await req.body;
  res.json({ received: Object.keys(body).length });
});

const server = createServer(router);
const PORT = 3004;

// Benchmark utilities
class Benchmark {
  constructor(name) {
    this.name = name;
    this.results = [];
  }

  async run(fn, iterations = 100) {
    console.log(`\nRunning benchmark: ${this.name}`);
    console.log(`Iterations: ${iterations}`);

    // Warmup
    for (let i = 0; i < 10; i++) {
      await fn();
    }

    // Actual benchmark
    const startTime = process.hrtime.bigint();

    for (let i = 0; i < iterations; i++) {
      const iterStart = process.hrtime.bigint();
      await fn();
      const iterEnd = process.hrtime.bigint();
      this.results.push(Number(iterEnd - iterStart) / 1e6); // Convert to ms
    }

    const endTime = process.hrtime.bigint();
    const totalTime = Number(endTime - startTime) / 1e6; // Convert to ms

    this.analyze(totalTime, iterations);
  }

  analyze(totalTime, iterations) {
    const sorted = [...this.results].sort((a, b) => a - b);
    const avg = this.results.reduce((a, b) => a + b, 0) / this.results.length;
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const median = sorted[Math.floor(sorted.length / 2)];
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    const p99 = sorted[Math.floor(sorted.length * 0.99)];

    console.log(`\nResults for ${this.name}:`);
    console.log(`Total time: ${totalTime.toFixed(2)}ms`);
    console.log(`Average: ${avg.toFixed(2)}ms`);
    console.log(`Median: ${median.toFixed(2)}ms`);
    console.log(`Min: ${min.toFixed(2)}ms`);
    console.log(`Max: ${max.toFixed(2)}ms`);
    console.log(`P95: ${p95.toFixed(2)}ms`);
    console.log(`P99: ${p99.toFixed(2)}ms`);
    console.log(`Throughput: ${(iterations / (totalTime / 1000)).toFixed(2)} req/s`);
  }
}

// HTTP request helper
function makeRequest(path, headers, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "localhost",
        port: PORT,
        path: path,
        method: "POST",
        headers: {
          ...headers,
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve(data));
      }
    );

    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// Test data generators
function generateJSON(size) {
  const obj = {
    timestamp: Date.now(),
    data: [],
  };

  const itemCount = Math.floor(size / 100); // Approximate size
  for (let i = 0; i < itemCount; i++) {
    obj.data.push({
      id: i,
      name: `Item ${i}`,
      value: Math.random(),
      tags: ["tag1", "tag2", "tag3"],
    });
  }

  return JSON.stringify(obj);
}

function generateURLEncoded(fields) {
  const params = [];
  for (let i = 0; i < fields; i++) {
    params.push(`field${i}=value${i}`);
    if (i % 3 === 0) {
      params.push(`nested[item${i}][name]=test${i}`);
      params.push(`nested[item${i}][value]=${i}`);
    }
    if (i % 5 === 0) {
      params.push(`array[]=item${i}`);
    }
  }
  return params.join("&");
}

function generateMultipart(fields, boundary = "----WebKitFormBoundary7MA4YWxkTrZu0gW") {
  let body = "";

  for (let i = 0; i < fields; i++) {
    body += `--${boundary}\r\n`;
    body += `Content-Disposition: form-data; name="field${i}"\r\n\r\n`;
    body += `value${i}\r\n`;
  }

  // Add a small file
  body += `--${boundary}\r\n`;
  body += `Content-Disposition: form-data; name="file"; filename="test.txt"\r\n`;
  body += `Content-Type: text/plain\r\n\r\n`;
  body += `File content here\r\n`;

  body += `--${boundary}--\r\n`;

  return body;
}

// Run benchmarks
async function runBenchmarks() {
  console.log("Starting body parser benchmarks...");
  console.log("Server starting on port", PORT);

  await new Promise((resolve) => server.listen(PORT, resolve));
  console.log("Server ready");

  // Small JSON benchmark
  const smallJSON = generateJSON(1000); // ~1KB
  const bench1 = new Benchmark("Small JSON (1KB)");
  await bench1.run(
    () =>
      makeRequest(
        "/json",
        {
          "Content-Type": "application/json",
        },
        smallJSON
      ),
    1000
  );

  // Medium JSON benchmark
  const mediumJSON = generateJSON(10000); // ~10KB
  const bench2 = new Benchmark("Medium JSON (10KB)");
  await bench2.run(
    () =>
      makeRequest(
        "/json",
        {
          "Content-Type": "application/json",
        },
        mediumJSON
      ),
    500
  );

  // Large JSON benchmark
  const largeJSON = generateJSON(100000); // ~100KB
  const bench3 = new Benchmark("Large JSON (100KB)");
  await bench3.run(
    () =>
      makeRequest(
        "/json",
        {
          "Content-Type": "application/json",
        },
        largeJSON
      ),
    100
  );

  // URL-encoded small
  const smallForm = generateURLEncoded(10);
  const bench4 = new Benchmark("Small URL-encoded (10 fields)");
  await bench4.run(
    () =>
      makeRequest(
        "/urlencoded",
        {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        smallForm
      ),
    1000
  );

  // URL-encoded with nested
  const nestedForm = generateURLEncoded(50);
  const bench5 = new Benchmark("Nested URL-encoded (50 fields)");
  await bench5.run(
    () =>
      makeRequest(
        "/urlencoded",
        {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        nestedForm
      ),
    500
  );

  // Multipart form data
  const boundary = "----WebKitFormBoundary7MA4YWxkTrZu0gW";
  const multipart = generateMultipart(10, boundary);
  const bench6 = new Benchmark("Multipart (10 fields + file)");
  await bench6.run(
    () =>
      makeRequest(
        "/multipart",
        {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
        },
        multipart
      ),
    500
  );

  console.log("\n=== Benchmark Complete ===");

  // Compare with raw Request class parsing
  console.log("\nTesting caching efficiency...");

  // First request (no cache)
  const cacheTest1Start = process.hrtime.bigint();
  await makeRequest(
    "/json",
    {
      "Content-Type": "application/json",
    },
    mediumJSON
  );
  const cacheTest1Time = Number(process.hrtime.bigint() - cacheTest1Start) / 1e6;

  // Second request (should use cache if same request)
  const cacheTest2Start = process.hrtime.bigint();
  await makeRequest(
    "/json",
    {
      "Content-Type": "application/json",
    },
    mediumJSON
  );
  const cacheTest2Time = Number(process.hrtime.bigint() - cacheTest2Start) / 1e6;

  console.log(`First request: ${cacheTest1Time.toFixed(2)}ms`);
  console.log(`Second request: ${cacheTest2Time.toFixed(2)}ms`);
  console.log(`Cache improvement: ${((1 - cacheTest2Time / cacheTest1Time) * 100).toFixed(1)}%`);

  server.close();
  process.exit(0);
}

// Handle errors
process.on("unhandledRejection", (err) => {
  console.error("Error:", err);
  process.exit(1);
});

// Run the benchmarks
runBenchmarks().catch(console.error);
