#!/usr/bin/env node

/**
 * Comprehensive Test Suite for Velocy Backend Framework
 *
 * This test suite verifies ALL features of the velocy backend library:
 * - HTTP Server and Routing (basic, advanced, dynamic, wildcards)
 * - All Router types (Router, FastRouter, SimpleRouter)
 * - WebSocket functionality
 * - All Middleware (bodyParser, cors, cookieParser, static, compression, rateLimit, session, validator)
 * - File uploads and multipart handling
 * - Error handling and edge cases
 * - Integration scenarios
 */

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const http = require("http");

// ANSI color codes for output
const colors = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  bold: "\x1b[1m",
};

// Test configuration
const TEST_CONFIG = {
  timeout: 30000, // 30 seconds per test file
  retries: 1,
  verbose: process.argv.includes("--verbose"),
  failFast: process.argv.includes("--fail-fast"),
  filter: process.argv.find((arg) => arg.startsWith("--filter="))?.split("=")[1],
};

// All test files to run
const TEST_FILES = [
  // Existing tests
  "test-routing.js",
  "test-middleware.js",
  "test-request.js",
  "test-body-parser.js",
  "test-cookies.js",

  // New comprehensive tests
  "test-advanced-routing.js",
  "test-static.js",
  "test-session.js",
  "test-compression.js",
  "test-rate-limit.js",
  "test-file-upload.js",
  "test-validator.js",
  "test-cors.js",
  "test-error-handling.js",
  "test-integration.js",
  "test-websocket.js",
];

// Test statistics
const stats = {
  total: 0,
  passed: 0,
  failed: 0,
  skipped: 0,
  duration: 0,
  failures: [],
};

// Helper function to check if WebSocket module is available
async function checkDependencies() {
  const dependencies = ["ws"]; // Required for WebSocket tests
  const missing = [];

  for (const dep of dependencies) {
    try {
      require.resolve(dep);
    } catch (e) {
      missing.push(dep);
    }
  }

  if (missing.length > 0) {
    console.log(`${colors.yellow}⚠️  Missing test dependencies: ${missing.join(", ")}${colors.reset}`);
    console.log(`${colors.cyan}Installing missing dependencies...${colors.reset}`);

    return new Promise((resolve, reject) => {
      const npm = spawn("npm", ["install", "--save-dev", ...missing], {
        stdio: "inherit",
        shell: process.platform === "win32",
      });

      npm.on("exit", (code) => {
        if (code === 0) {
          console.log(`${colors.green}✅ Dependencies installed successfully${colors.reset}\n`);
          resolve(true);
        } else {
          console.log(`${colors.red}❌ Failed to install dependencies${colors.reset}`);
          console.log("Please run: npm install --save-dev ws");
          resolve(false);
        }
      });
    });
  }

  return true;
}

// Helper function to run a single test file
function runTestFile(testFile) {
  return new Promise((resolve) => {
    const testPath = path.join(__dirname, testFile);

    // Check if test file exists
    if (!fs.existsSync(testPath)) {
      console.log(`${colors.yellow}⚠️  Test file not found: ${testFile}${colors.reset}`);
      stats.skipped++;
      return resolve({ file: testFile, passed: false, skipped: true });
    }

    if (TEST_CONFIG.verbose) {
      console.log(`${colors.cyan}📝 Running: ${testFile}${colors.reset}`);
    }

    const startTime = Date.now();
    const proc = spawn(process.execPath, [testPath], {
      stdio: TEST_CONFIG.verbose ? "inherit" : "pipe",
      env: { ...process.env, FORCE_COLOR: "1" },
      shell: false,
      timeout: TEST_CONFIG.timeout,
    });

    let output = "";
    let errorOutput = "";

    if (!TEST_CONFIG.verbose) {
      proc.stdout?.on("data", (data) => {
        output += data.toString();
      });

      proc.stderr?.on("data", (data) => {
        errorOutput += data.toString();
      });
    }

    proc.on("exit", (code) => {
      const duration = Date.now() - startTime;
      const passed = code === 0;

      if (passed) {
        console.log(`${colors.green}✅ PASS${colors.reset} ${testFile} (${duration}ms)`);
        stats.passed++;
      } else {
        console.log(`${colors.red}❌ FAIL${colors.reset} ${testFile} (${duration}ms)`);
        stats.failed++;
        stats.failures.push({
          file: testFile,
          output,
          errorOutput,
          code,
        });

        if (!TEST_CONFIG.verbose && output) {
          console.log(`${colors.yellow}Output:${colors.reset}`);
          console.log(output);
        }
        if (!TEST_CONFIG.verbose && errorOutput) {
          console.log(`${colors.red}Errors:${colors.reset}`);
          console.log(errorOutput);
        }
      }

      resolve({ file: testFile, passed, duration });
    });

    proc.on("error", (err) => {
      console.error(`${colors.red}❌ Error running ${testFile}: ${err.message}${colors.reset}`);
      stats.failed++;
      stats.failures.push({
        file: testFile,
        error: err.message,
      });
      resolve({ file: testFile, passed: false, error: err.message });
    });
  });
}

// Helper to verify server is not already running
async function checkPortAvailability() {
  const ports = [3000, 3001, 3002]; // Common test ports

  for (const port of ports) {
    const isInUse = await new Promise((resolve) => {
      const server = http.createServer();
      server.once("error", () => resolve(true));
      server.once("listening", () => {
        server.close();
        resolve(false);
      });
      server.listen(port, "127.0.0.1");
    });

    if (isInUse) {
      console.log(`${colors.yellow}⚠️  Port ${port} is in use. Tests may fail if they need this port.${colors.reset}`);
    }
  }
}

// Main test runner
async function runAllTests() {
  console.log(`${colors.bold}${colors.blue}${"=".repeat(70)}`);
  console.log("  🚀 Velocy Comprehensive Test Suite");
  console.log(`${"=".repeat(70)}${colors.reset}\n`);

  // Check dependencies
  const depsOk = await checkDependencies();
  if (!depsOk) {
    console.log(`${colors.red}Cannot run tests without required dependencies${colors.reset}`);
    process.exit(1);
  }

  // Check port availability
  await checkPortAvailability();

  // Filter tests if needed
  let testsToRun = TEST_FILES;
  if (TEST_CONFIG.filter) {
    testsToRun = TEST_FILES.filter((file) => file.includes(TEST_CONFIG.filter));
    console.log(`${colors.cyan}Filter: Running only tests matching "${TEST_CONFIG.filter}"${colors.reset}\n`);
  }

  if (testsToRun.length === 0) {
    console.log(`${colors.yellow}No tests match the filter "${TEST_CONFIG.filter}"${colors.reset}`);
    process.exit(1);
  }

  console.log(`${colors.cyan}Running ${testsToRun.length} test files...${colors.reset}\n`);

  const startTime = Date.now();
  stats.total = testsToRun.length;

  // Run tests sequentially to avoid port conflicts
  for (const testFile of testsToRun) {
    const result = await runTestFile(testFile);

    if (TEST_CONFIG.failFast && !result.passed && !result.skipped) {
      console.log(`\n${colors.red}Stopping due to --fail-fast flag${colors.reset}`);
      break;
    }

    // Small delay between tests to ensure cleanup
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  stats.duration = Date.now() - startTime;

  // Print summary
  console.log(`\n${colors.bold}${colors.blue}${"=".repeat(70)}`);
  console.log("  📊 Test Summary");
  console.log(`${"=".repeat(70)}${colors.reset}\n`);

  // Detailed results
  console.log(`${colors.bold}Results:${colors.reset}`);
  console.log(`  ${colors.green}✅ Passed:${colors.reset}  ${stats.passed}/${stats.total}`);
  console.log(`  ${colors.red}❌ Failed:${colors.reset}  ${stats.failed}/${stats.total}`);
  if (stats.skipped > 0) {
    console.log(`  ${colors.yellow}⚠️  Skipped:${colors.reset} ${stats.skipped}/${stats.total}`);
  }
  console.log(`  ⏱️  Duration: ${(stats.duration / 1000).toFixed(2)}s`);

  // Show failures
  if (stats.failures.length > 0) {
    console.log(`\n${colors.red}${colors.bold}Failed Tests:${colors.reset}`);
    stats.failures.forEach((failure) => {
      console.log(`  ${colors.red}•${colors.reset} ${failure.file}`);
      if (failure.error) {
        console.log(`    ${colors.yellow}Error: ${failure.error}${colors.reset}`);
      }
    });
  }

  // Coverage estimate
  console.log(`\n${colors.bold}Feature Coverage:${colors.reset}`);
  const features = {
    "HTTP Routing": ["test-routing", "test-advanced-routing"],
    WebSockets: ["test-websocket"],
    Middleware: ["test-middleware", "test-body-parser", "test-cors"],
    Sessions: ["test-session", "test-cookies"],
    "Static Files": ["test-static"],
    Compression: ["test-compression"],
    "Rate Limiting": ["test-rate-limit"],
    "File Uploads": ["test-file-upload"],
    Validation: ["test-validator"],
    "Error Handling": ["test-error-handling"],
    Integration: ["test-integration"],
  };

  for (const [feature, tests] of Object.entries(features)) {
    const tested = tests.some((t) => testsToRun.some((file) => file.includes(t)));
    const icon = tested ? "✅" : "❌";
    const color = tested ? colors.green : colors.red;
    console.log(`  ${color}${icon}${colors.reset} ${feature}`);
  }

  // Final status
  console.log(`\n${colors.bold}${"=".repeat(70)}${colors.reset}`);
  if (stats.failed === 0 && stats.skipped === 0) {
    console.log(`${colors.green}${colors.bold}🎉 All tests passed! The Velocy backend is working perfectly!${colors.reset}`);
    console.log(`${colors.bold}${"=".repeat(70)}${colors.reset}\n`);
  } else if (stats.failed === 0 && stats.skipped > 0) {
    console.log(`${colors.yellow}${colors.bold}⚠️  Tests passed with ${stats.skipped} skipped files${colors.reset}`);
    console.log(`${colors.bold}${"=".repeat(70)}${colors.reset}\n`);
  } else {
    console.log(`${colors.red}${colors.bold}❌ ${stats.failed} test file(s) failed${colors.reset}`);
    console.log(`${colors.bold}${"=".repeat(70)}${colors.reset}\n`);
  }

  // Exit with appropriate code
  process.exit(stats.failed > 0 ? 1 : 0);
}

// Handle errors
process.on("unhandledRejection", (err) => {
  console.error(`${colors.red}Unhandled rejection: ${err}${colors.reset}`);
  process.exit(1);
});

// Show help if requested
if (process.argv.includes("--help")) {
  console.log(`
${colors.bold}Velocy Comprehensive Test Suite${colors.reset}

Usage: node comprehensive-test.js [options]

Options:
  --verbose       Show detailed output from each test
  --fail-fast     Stop on first failure
  --filter=<str>  Run only tests matching the filter
  --help          Show this help message

Examples:
  node comprehensive-test.js
  node comprehensive-test.js --verbose
  node comprehensive-test.js --filter=websocket
  node comprehensive-test.js --fail-fast --verbose
`);
  process.exit(0);
}

// Run the tests
console.log(`${colors.cyan}Starting Velocy comprehensive test suite...${colors.reset}\n`);
runAllTests().catch((err) => {
  console.error(`${colors.red}Test runner error: ${err}${colors.reset}`);
  process.exit(1);
});
