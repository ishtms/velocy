const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

// Track all servers created during tests
const activeServers = new Set();
const activeProcesses = new Set();

// Cleanup function to ensure all servers are closed
function cleanupServers() {
  for (const server of activeServers) {
    try {
      server.close();
      server.unref();
    } catch (e) {
      // Server already closed
    }
  }
  activeServers.clear();
  
  for (const proc of activeProcesses) {
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', proc.pid, '/f', '/t']);
      } else {
        proc.kill('SIGTERM');
      }
    } catch (e) {
      // Process already killed
    }
  }
  activeProcesses.clear();
}

// Register cleanup handlers
process.on('exit', cleanupServers);
process.on('SIGINT', () => {
  cleanupServers();
  process.exit(0);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  cleanupServers();
  process.exit(1);
});

class TestRunner {
  constructor(name) {
    this.name = name;
    this.tests = [];
    this.passed = 0;
    this.failed = 0;
    this.currentTest = null;
  }

  test(description, fn) {
    this.tests.push({ description, fn });
  }

  async run() {
    console.log(`\n📦 Running ${this.name}\n${'='.repeat(50)}`);
    
    for (const test of this.tests) {
      this.currentTest = test.description;
      try {
        await test.fn();
        this.passed++;
        console.log(`  ✅ ${test.description}`);
      } catch (error) {
        this.failed++;
        console.log(`  ❌ ${test.description}`);
        console.log(`     Error: ${error.message}`);
        if (process.env.VERBOSE) {
          console.log(error.stack);
        }
      }
    }
    
    console.log(`\n${'='.repeat(50)}`);
    console.log(`Results: ${this.passed} passed, ${this.failed} failed\n`);
    
    return this.failed === 0;
  }
}

// Assertion helpers
function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(message || `Expected ${expected}, got ${actual}`);
  }
}

function assertDeepEqual(actual, expected, message) {
  const actualStr = JSON.stringify(actual);
  const expectedStr = JSON.stringify(expected);
  if (actualStr !== expectedStr) {
    throw new Error(message || `Expected ${expectedStr}, got ${actualStr}`);
  }
}

function assertIncludes(str, substring, message) {
  if (!str.includes(substring)) {
    throw new Error(message || `Expected "${str}" to include "${substring}"`);
  }
}

// HTTP request helpers with proper Windows support
function makeRequest(options, body = null) {
  return new Promise((resolve, reject) => {
    const client = options.protocol === 'https:' ? https : http;
    
    const req = client.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: data
        });
      });
    });
    
    req.on('error', reject);
    
    // Set timeout to prevent hanging
    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    
    if (body) {
      req.write(body);
    }
    
    req.end();
  });
}

// Server creation helper that tracks servers
function createTestServer(router, port = 0) {
  return new Promise((resolve, reject) => {
    const { createServer } = require('../lib/utils');
    const server = createServer(router);
    
    // Track this server
    activeServers.add(server);
    
    // Set up error handling
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        // Try next port
        server.listen(0, '127.0.0.1');
      } else {
        reject(err);
      }
    });
    
    server.listen(port, '127.0.0.1', () => {
      const actualPort = server.address().port;
      
      // Return server info with cleanup function
      resolve({
        server,
        port: actualPort,
        url: `http://127.0.0.1:${actualPort}`,
        close: () => {
          return new Promise((resolveClose) => {
            activeServers.delete(server);
            server.close(() => {
              server.unref();
              resolveClose();
            });
            // Force close after timeout
            setTimeout(() => {
              server.unref();
              resolveClose();
            }, 1000);
          });
        }
      });
    });
  });
}

// Wait helper
function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// File system helpers for tests
function createTempDir() {
  const tempDir = path.join(__dirname, 'temp', Date.now().toString());
  fs.mkdirSync(tempDir, { recursive: true });
  return tempDir;
}

function cleanupTempDir(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Process spawning helper that tracks processes
function spawnProcess(command, args = [], options = {}) {
  const proc = spawn(command, args, {
    ...options,
    shell: process.platform === 'win32'
  });
  
  activeProcesses.add(proc);
  
  proc.on('exit', () => {
    activeProcesses.delete(proc);
  });
  
  return proc;
}

module.exports = {
  TestRunner,
  assert,
  assertEqual,
  assertDeepEqual,
  assertIncludes,
  makeRequest,
  createTestServer,
  wait,
  createTempDir,
  cleanupTempDir,
  cleanupServers,
  spawnProcess
};