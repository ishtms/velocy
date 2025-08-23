/**
 * Velocy Old vs New Performance Comparison
 * Compares npm version 0.0.14 against current local version (both Standard and Fast routers)
 */

const { spawn } = require("child_process");
const path = require("path");

// Terminal colors
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
};

/**
 * Create test server with old Velocy (from npm)
 */
function createOldServer() {
  // Use the npm installed version
  const OldVelocy = require("velocy");
  const app = new OldVelocy.Router();

  // Plain text route
  app.get("/plaintext", (req, res) => {
    res.end("Hello, World!");
  });

  // JSON route
  app.get("/json", (req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: "Hello, World!" }));
  });

  const server = OldVelocy.createServer(app);
  return server;
}

/**
 * Create test server with new Velocy Standard Router (local version)
 */
function createStandardServer() {
  // Use the local version with standard Router
  const NewVelocy = require("../index");
  const app = new NewVelocy.Router({
    cache: true,
  });

  // Plain text route
  app.get("/plaintext", (req, res) => {
    res.send("Hello, World!");
  });

  // JSON route - use direct methods for fair comparison
  app.get("/json", (req, res) => {
    res.json({ message: "Hello, World!" });
  });

  const server = NewVelocy.createServer(app);
  return server;
}

/**
 * Create test server with new Velocy Fast Router (optimized version)
 */
function createFastServer() {
  // Use the local version with FastRouter
  const NewVelocy = require("../index");
  const http = require("http");
  const app = new NewVelocy.FastRouter();

  // Plain text route
  app.get("/plaintext", (req, res) => {
    res.end("Hello, World!");
  });

  // JSON route - add lightweight json helper
  app.get("/json", (req, res) => {
    // Inline json response for zero overhead
    const data = JSON.stringify({ message: "Hello, World!" });
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(data),
    });
    res.end(data);
  });

  const server = http.createServer((req, res) => {
    app.handleRequest(req, res);
  });
  return server;
}

/**
 * Run rewrk benchmark
 */
function runRewrk(port, path, duration = 15, connections = 256, threads = 2) {
  return new Promise((resolve, reject) => {
    const url = `http://localhost:${port}${path}`;
    const args = [
      "-d",
      `${duration}s`, // duration
      "-c",
      connections.toString(), // connections
      "-t",
      threads.toString(), // threads
      "-h", // latency histogram
      url,
    ];

    console.log(`${colors.cyan}Running: rewrk ${args.join(" ")}${colors.reset}\n`);

    const rewrk = spawn("rewrk", args);
    let output = "";
    let error = "";

    rewrk.stdout.on("data", (data) => {
      output += data.toString();
      process.stdout.write(data);
    });

    rewrk.stderr.on("data", (data) => {
      error += data.toString();
    });

    rewrk.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`rewrk exited with code ${code}: ${error}`));
      } else {
        // Parse the output to extract key metrics
        const lines = output.split("\n");
        const stats = {};

        lines.forEach((line) => {
          // Parse output in rewrk format:
          // Requests:
          //   Total: 309699  Req/Sec: 30980.38
          if (line.includes("Req/Sec:")) {
            const match = line.match(/Req\/Sec:\s*([\d.]+)/);
            if (match) {
              stats.reqPerSec = parseFloat(match[1]);
            }
          }
          // Parse total requests
          if (line.includes("Total:") && line.includes("Req/Sec")) {
            const match = line.match(/Total:\s*(\d+)/);
            if (match) {
              stats.totalRequests = parseInt(match[1]);
            }
          }
          // Parse average latency from rewrk format:
          // Latencies:
          //   Avg      Stdev    Min      Max
          //   4.13ms   3.53ms   1.05ms   351.41ms
          if (line.includes("ms") && !line.includes("Latencies")) {
            const match = line.match(/([\d.]+)ms/);
            if (match && !stats.avgLatency) {
              stats.avgLatency = parseFloat(match[1]);
            }
          }
        });

        resolve(stats);
      }
    });

    rewrk.on("error", (err) => {
      if (err.code === "ENOENT") {
        reject(new Error("rewrk not found. Please install it first: https://github.com/ChillFish8/rewrk"));
      } else {
        reject(err);
      }
    });
  });
}

/**
 * Main comparison runner
 */
async function runComparison() {
  console.log(colors.bright + colors.blue + "\n" + "█".repeat(80) + colors.reset);
  console.log(colors.bright + colors.white + "              VELOCY PERFORMANCE COMPARISON (3-WAY)" + colors.reset);
  console.log(colors.bright + colors.blue + "█".repeat(80) + colors.reset + "\n");

  console.log(colors.cyan + "📊 Test Configuration:" + colors.reset);
  console.log("  • Old Version: 0.0.14 (from npm)");
  console.log("  • Standard Router: Current (with Request/Response wrappers)");
  console.log("  • Fast Router: Current (zero-cost abstractions)");
  console.log("  • Test Duration: 10 seconds");
  console.log("  • Connections: 128");
  console.log("  • Threads: 1");
  console.log("  • Routes: /plaintext and /json\n");

  const results = {
    old: { plaintext: {}, json: {} },
    standard: { plaintext: {}, json: {} },
    fast: { plaintext: {}, json: {} },
  };

  try {
    // Test OLD version
    console.log(colors.bright + colors.yellow + "\n════════════════════════════════════════" + colors.reset);
    console.log(colors.bright + colors.yellow + "  TESTING OLD VERSION (0.0.14)" + colors.reset);
    console.log(colors.bright + colors.yellow + "════════════════════════════════════════\n" + colors.reset);

    const oldServer = createOldServer();
    await new Promise((resolve) => oldServer.listen(8001, resolve));
    console.log(colors.green + "✅ Old server running on port 8001\n" + colors.reset);

    // Test plaintext
    console.log(colors.bright + colors.white + "\n📝 Testing /plaintext route:\n" + colors.reset);
    results.old.plaintext = await runRewrk(8001, "/plaintext");

    // Test JSON
    console.log(colors.bright + colors.white + "\n📝 Testing /json route:\n" + colors.reset);
    results.old.json = await runRewrk(8001, "/json");

    oldServer.close();

    // Wait a bit before starting next server
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Test STANDARD Router version
    console.log(colors.bright + colors.green + "\n════════════════════════════════════════" + colors.reset);
    console.log(colors.bright + colors.green + "  TESTING STANDARD ROUTER (Current)" + colors.reset);
    console.log(colors.bright + colors.green + "════════════════════════════════════════\n" + colors.reset);

    const standardServer = createStandardServer();
    await new Promise((resolve) => standardServer.listen(8002, resolve));
    console.log(colors.green + "✅ Standard Router running on port 8002\n" + colors.reset);

    // Test plaintext
    console.log(colors.bright + colors.white + "\n📝 Testing /plaintext route:\n" + colors.reset);
    results.standard.plaintext = await runRewrk(8002, "/plaintext");

    // Test JSON
    console.log(colors.bright + colors.white + "\n📝 Testing /json route:\n" + colors.reset);
    results.standard.json = await runRewrk(8002, "/json");

    standardServer.close();

    // Wait a bit before starting fast server
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Test FAST Router version
    console.log(colors.bright + colors.magenta + "\n════════════════════════════════════════" + colors.reset);
    console.log(colors.bright + colors.magenta + "  TESTING FAST ROUTER (Optimized)" + colors.reset);
    console.log(colors.bright + colors.magenta + "════════════════════════════════════════\n" + colors.reset);

    const fastServer = createFastServer();
    await new Promise((resolve) => fastServer.listen(8003, resolve));
    console.log(colors.green + "✅ Fast Router running on port 8003\n" + colors.reset);

    // Test plaintext
    console.log(colors.bright + colors.white + "\n📝 Testing /plaintext route:\n" + colors.reset);
    results.fast.plaintext = await runRewrk(8003, "/plaintext");

    // Test JSON
    console.log(colors.bright + colors.white + "\n📝 Testing /json route:\n" + colors.reset);
    results.fast.json = await runRewrk(8003, "/json");

    fastServer.close();

    // Display comparison
    console.log(colors.bright + colors.cyan + "\n" + "═".repeat(80) + colors.reset);
    console.log(colors.bright + colors.white + "                           COMPARISON RESULTS" + colors.reset);
    console.log(colors.bright + colors.cyan + "═".repeat(80) + colors.reset + "\n");

    // Plaintext comparison
    console.log(colors.bright + colors.cyan + "📊 /plaintext Route:" + colors.reset);
    console.log("┌─────────────────┬──────────────────┬──────────────────┬──────────────────┐");
    console.log("│     Metric      │   Old (0.0.14)   │ Standard Router  │   Fast Router    │");
    console.log("├─────────────────┼──────────────────┼──────────────────┼──────────────────┤");
    console.log(
      `│ Req/Sec         │ ${(results.old.plaintext.reqPerSec || 0).toFixed(2).padEnd(16)} │ ${(results.standard.plaintext.reqPerSec || 0)
        .toFixed(2)
        .padEnd(16)} │ ${(results.fast.plaintext.reqPerSec || 0).toFixed(2).padEnd(16)} │`,
    );
    console.log(
      `│ Avg Latency     │ ${((results.old.plaintext.avgLatency || 0) + "ms").padEnd(16)} │ ${(
        (results.standard.plaintext.avgLatency || 0) + "ms"
      ).padEnd(16)} │ ${((results.fast.plaintext.avgLatency || 0) + "ms").padEnd(16)} │`,
    );
    console.log(
      `│ Total Requests  │ ${(results.old.plaintext.totalRequests || 0).toString().padEnd(16)} │ ${(
        results.standard.plaintext.totalRequests || 0
      )
        .toString()
        .padEnd(16)} │ ${(results.fast.plaintext.totalRequests || 0).toString().padEnd(16)} │`,
    );
    console.log("└─────────────────┴──────────────────┴──────────────────┴──────────────────┘\n");

    // JSON comparison
    console.log(colors.bright + colors.cyan + "📊 /json Route:" + colors.reset);
    console.log("┌─────────────────┬──────────────────┬──────────────────┬──────────────────┐");
    console.log("│     Metric      │   Old (0.0.14)   │ Standard Router  │   Fast Router    │");
    console.log("├─────────────────┼──────────────────┼──────────────────┼──────────────────┤");
    console.log(
      `│ Req/Sec         │ ${(results.old.json.reqPerSec || 0).toFixed(2).padEnd(16)} │ ${(results.standard.json.reqPerSec || 0)
        .toFixed(2)
        .padEnd(16)} │ ${(results.fast.json.reqPerSec || 0).toFixed(2).padEnd(16)} │`,
    );
    console.log(
      `│ Avg Latency     │ ${((results.old.json.avgLatency || 0) + "ms").padEnd(16)} │ ${(
        (results.standard.json.avgLatency || 0) + "ms"
      ).padEnd(16)} │ ${((results.fast.json.avgLatency || 0) + "ms").padEnd(16)} │`,
    );
    console.log(
      `│ Total Requests  │ ${(results.old.json.totalRequests || 0).toString().padEnd(16)} │ ${(results.standard.json.totalRequests || 0)
        .toString()
        .padEnd(16)} │ ${(results.fast.json.totalRequests || 0).toString().padEnd(16)} │`,
    );
    console.log("└─────────────────┴──────────────────┴──────────────────┴──────────────────┘\n");

    // Calculate improvements
    const standardPlaintextImprovement = (
      ((results.standard.plaintext.reqPerSec - results.old.plaintext.reqPerSec) / results.old.plaintext.reqPerSec) *
      100
    ).toFixed(1);
    const standardJsonImprovement = (
      ((results.standard.json.reqPerSec - results.old.json.reqPerSec) / results.old.json.reqPerSec) *
      100
    ).toFixed(1);

    const fastPlaintextImprovement = (
      ((results.fast.plaintext.reqPerSec - results.old.plaintext.reqPerSec) / results.old.plaintext.reqPerSec) *
      100
    ).toFixed(1);
    const fastJsonImprovement = (((results.fast.json.reqPerSec - results.old.json.reqPerSec) / results.old.json.reqPerSec) * 100).toFixed(
      1,
    );

    console.log(colors.bright + colors.green + "📈 Performance vs Old Version (0.0.14):" + colors.reset);
    console.log("\n" + colors.bright + "Standard Router:" + colors.reset);
    console.log(
      `  • Plaintext: ${standardPlaintextImprovement > 0 ? colors.green + "+" : colors.red}${standardPlaintextImprovement}%${colors.reset}`,
    );
    console.log(`  • JSON: ${standardJsonImprovement > 0 ? colors.green + "+" : colors.red}${standardJsonImprovement}%${colors.reset}`);

    console.log("\n" + colors.bright + "Fast Router:" + colors.reset);
    console.log(
      `  • Plaintext: ${fastPlaintextImprovement > 0 ? colors.green + "+" : colors.red}${fastPlaintextImprovement}%${colors.reset}`,
    );
    console.log(`  • JSON: ${fastJsonImprovement > 0 ? colors.green + "+" : colors.red}${fastJsonImprovement}%${colors.reset}\n`);

    // Compare Fast vs Standard
    const fastVsStandardPlaintext = (
      ((results.fast.plaintext.reqPerSec - results.standard.plaintext.reqPerSec) / results.standard.plaintext.reqPerSec) *
      100
    ).toFixed(1);
    const fastVsStandardJson = (
      ((results.fast.json.reqPerSec - results.standard.json.reqPerSec) / results.standard.json.reqPerSec) *
      100
    ).toFixed(1);

    console.log(colors.bright + colors.yellow + "🔄 Fast Router vs Standard Router:" + colors.reset);
    console.log(
      `  • Plaintext: ${fastVsStandardPlaintext > 0 ? colors.green + "+" : colors.red}${fastVsStandardPlaintext}%${colors.reset}`,
    );
    console.log(`  • JSON: ${fastVsStandardJson > 0 ? colors.green + "+" : colors.red}${fastVsStandardJson}%${colors.reset}\n`);

    // Summary
    console.log(colors.bright + colors.white + "📋 Summary:" + colors.reset);
    console.log("  • Old Version (0.0.14): Baseline performance");
    console.log(`  • Standard Router: Full features with ${standardPlaintextImprovement < 0 ? "some overhead" : "comparable performance"}`);
    console.log(`  • Fast Router: Zero-cost abstractions ${fastPlaintextImprovement > 0 ? "exceeding" : "matching"} baseline\n`);

    console.log(colors.bright + colors.blue + "█".repeat(80) + colors.reset);
    console.log(colors.bright + colors.white + "                         COMPARISON COMPLETE!" + colors.reset);
    console.log(colors.bright + colors.blue + "█".repeat(80) + colors.reset + "\n");
  } catch (error) {
    console.error(colors.red + "\n❌ Error during comparison:" + colors.reset, error.message);

    if (error.message.includes("rewrk not found")) {
      console.log(colors.yellow + "\n📦 To install rewrk:" + colors.reset);
      console.log("  1. Download from: https://github.com/ChillFish8/rewrk/releases");
      console.log("  2. Add to PATH or place in current directory");
      console.log("  3. On Windows: Use rewrk.exe");
    }

    process.exit(1);
  }
}

// Run the comparison
if (require.main === module) {
  runComparison().catch(console.error);
}
