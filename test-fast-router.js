/**
 * Test FastRouter performance vs old version
 */

const http = require("http");
const { spawn } = require("child_process");

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
 * Create test server with FastRouter (optimized version)
 */
function createFastServer() {
  const FastRouter = require("./lib/core/FastRouter");
  const app = new FastRouter();

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
      "Content-Length": Buffer.byteLength(data)
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
function runRewrk(port, path, duration = 10, connections = 256, threads = 2) {
  return new Promise((resolve, reject) => {
    const url = `http://localhost:${port}${path}`;
    const args = [
      "-t", threads.toString(),
      "-c", connections.toString(),
      "-d", `${duration}s`,
      "-h",
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
        const lines = output.split("\n");
        const stats = {};

        lines.forEach((line) => {
          if (line.includes("Req/Sec:")) {
            const match = line.match(/Req\/Sec:\s*([\d.]+)/);
            if (match) {
              stats.reqPerSec = match[1];
            }
          }
          if (line.includes("Total:") && line.includes("Req/Sec")) {
            const match = line.match(/Total:\s*(\d+)/);
            if (match) {
              stats.totalRequests = match[1];
            }
          }
          if (line.includes("ms") && !line.includes("Latencies")) {
            const match = line.match(/([\d.]+)ms/);
            if (match) {
              stats.avgLatency = match[0];
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
  console.log(colors.bright + colors.white + "         VELOCY FAST ROUTER PERFORMANCE TEST" + colors.reset);
  console.log(colors.bright + colors.blue + "█".repeat(80) + colors.reset + "\n");

  const results = {
    old: { plaintext: {}, json: {} },
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

    console.log(colors.bright + colors.white + "\n📝 Testing /plaintext route:\n" + colors.reset);
    results.old.plaintext = await runRewrk(8001, "/plaintext");

    console.log(colors.bright + colors.white + "\n📝 Testing /json route:\n" + colors.reset);
    results.old.json = await runRewrk(8001, "/json");

    oldServer.close();

    // Wait a bit before starting fast server
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Test FAST version
    console.log(colors.bright + colors.green + "\n════════════════════════════════════════" + colors.reset);
    console.log(colors.bright + colors.green + "  TESTING FAST ROUTER (Optimized)" + colors.reset);
    console.log(colors.bright + colors.green + "════════════════════════════════════════\n" + colors.reset);

    const fastServer = createFastServer();
    await new Promise((resolve) => fastServer.listen(8002, resolve));
    console.log(colors.green + "✅ Fast router running on port 8002\n" + colors.reset);

    console.log(colors.bright + colors.white + "\n📝 Testing /plaintext route:\n" + colors.reset);
    results.fast.plaintext = await runRewrk(8002, "/plaintext");

    console.log(colors.bright + colors.white + "\n📝 Testing /json route:\n" + colors.reset);
    results.fast.json = await runRewrk(8002, "/json");

    fastServer.close();

    // Display comparison
    console.log(colors.bright + colors.magenta + "\n" + "═".repeat(80) + colors.reset);
    console.log(colors.bright + colors.white + "                           COMPARISON RESULTS" + colors.reset);
    console.log(colors.bright + colors.magenta + "═".repeat(80) + colors.reset + "\n");

    // Plaintext comparison
    console.log(colors.bright + colors.cyan + "📊 /plaintext Route:" + colors.reset);
    console.log("┌─────────────────┬──────────────────┬──────────────────┐");
    console.log("│     Metric      │   Old (0.0.14)   │ Fast (Optimized) │");
    console.log("├─────────────────┼──────────────────┼──────────────────┤");
    console.log(
      `│ Req/Sec         │ ${(results.old.plaintext.reqPerSec || "N/A").padEnd(16)} │ ${(
        results.fast.plaintext.reqPerSec || "N/A"
      ).padEnd(16)} │`
    );
    console.log(
      `│ Avg Latency     │ ${(results.old.plaintext.avgLatency || "N/A").padEnd(16)} │ ${(
        results.fast.plaintext.avgLatency || "N/A"
      ).padEnd(16)} │`
    );
    console.log(
      `│ Total Requests  │ ${(results.old.plaintext.totalRequests || "N/A").padEnd(16)} │ ${(
        results.fast.plaintext.totalRequests || "N/A"
      ).padEnd(16)} │`
    );
    console.log("└─────────────────┴──────────────────┴──────────────────┘\n");

    // JSON comparison
    console.log(colors.bright + colors.cyan + "📊 /json Route:" + colors.reset);
    console.log("┌─────────────────┬──────────────────┬──────────────────┐");
    console.log("│     Metric      │   Old (0.0.14)   │ Fast (Optimized) │");
    console.log("├─────────────────┼──────────────────┼──────────────────┤");
    console.log(
      `│ Req/Sec         │ ${(results.old.json.reqPerSec || "N/A").padEnd(16)} │ ${(
        results.fast.json.reqPerSec || "N/A"
      ).padEnd(16)} │`
    );
    console.log(
      `│ Avg Latency     │ ${(results.old.json.avgLatency || "N/A").padEnd(16)} │ ${(
        results.fast.json.avgLatency || "N/A"
      ).padEnd(16)} │`
    );
    console.log(
      `│ Total Requests  │ ${(results.old.json.totalRequests || "N/A").padEnd(16)} │ ${(
        results.fast.json.totalRequests || "N/A"
      ).padEnd(16)} │`
    );
    console.log("└─────────────────┴──────────────────┴──────────────────┘\n");

    // Calculate improvements
    function parseMetric(value) {
      if (!value || value === "N/A") return 0;
      const num = parseFloat(value.replace(/[^0-9.]/g, ""));
      return num;
    }

    const plaintextImprovement = (
      ((parseMetric(results.fast.plaintext.reqPerSec) - parseMetric(results.old.plaintext.reqPerSec)) /
        parseMetric(results.old.plaintext.reqPerSec)) *
      100
    ).toFixed(1);
    const jsonImprovement = (
      ((parseMetric(results.fast.json.reqPerSec) - parseMetric(results.old.json.reqPerSec)) /
        parseMetric(results.old.json.reqPerSec)) *
      100
    ).toFixed(1);

    console.log(colors.bright + colors.green + "📈 Performance vs Old Version:" + colors.reset);
    console.log(
      `  • Plaintext: ${plaintextImprovement > 0 ? colors.green + "+" : colors.red}${plaintextImprovement}%${
        colors.reset
      }`
    );
    console.log(
      `  • JSON: ${jsonImprovement > 0 ? colors.green + "+" : colors.red}${jsonImprovement}%${colors.reset}\n`
    );

    console.log(colors.bright + colors.blue + "█".repeat(80) + colors.reset);
    console.log(colors.bright + colors.white + "                      TEST COMPLETE!" + colors.reset);
    console.log(colors.bright + colors.blue + "█".repeat(80) + colors.reset + "\n");
  } catch (error) {
    console.error(colors.red + "\n❌ Error during comparison:" + colors.reset, error.message);
    process.exit(1);
  }
}

// Run the comparison
if (require.main === module) {
  runComparison().catch(console.error);
}