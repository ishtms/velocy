'use strict';

// A separate supervisor enforces the wall-clock limit even if framework code
// blocks the worker event loop. Killing this sole child also closes its sockets.
const { spawn, spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

const ROOT = path.resolve(__dirname, '..');
const HOST = '127.0.0.1';
const MAX_BYTES = 1024 * 1024;
const MAX_REQUESTS = 100000;
const REQUEST_TIMEOUT_MS = 1000;
const OUTER_TIMEOUT_MS = 45000;
const WORKER_STAGE_IDS = new Set(['fingerprint', 'framework_setup', 'listen', 'sample', 'cleanup', 'report', 'output']);
const WORKER_ERROR_CODES = new Set([
  'ENOENT', 'EACCES', 'EPERM', 'EADDRINUSE', 'EMFILE', 'ENFILE', 'ENOSPC', 'ENOMEM',
  'EPIPE', 'MODULE_NOT_FOUND', 'ERR_SERVER_NOT_RUNNING', 'ERR_IPC_CHANNEL_CLOSED',
  'ERR_INVALID_ARG_TYPE', 'ERR_INVALID_ARG_VALUE'
]);
const CASES = [
  { name: 'static', path: '/plain', body: 'velocy baseline\n' },
  { name: 'parameter', path: '/users/42', body: '{"id":"42"}' },
  { name: 'query', path: '/search?q=velocy', body: '{"q":"velocy"}' },
  { name: 'wildcard', path: '/files/example.txt', body: '{"file":"example.txt"}' }
];

function parseOptions(args) {
  const options = { durationMs: 2000, concurrency: 5, samples: 3, snapshotId: null };
  const limits = {
    '--duration-ms': ['durationMs', 100, 9000],
    '--concurrency': ['concurrency', 1, 10],
    '--samples': ['samples', 1, 3]
  };
  const seen = new Set();
  if (args.length > 8 || args.length % 2 !== 0) throw new Error('Expected bounded option/value pairs');
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    const value = args[i + 1];
    if (seen.has(key)) throw new Error('Duplicate benchmark option');
    seen.add(key);
    if (key === '--snapshot-id') {
      if (!/^[a-f0-9]{64}$/.test(value)) throw new Error('snapshot-id must be a SHA256 hex label');
      options.snapshotId = value;
      continue;
    }
    const limit = Object.hasOwn(limits, key) ? limits[key] : null;
    if (!limit || !/^[0-9]{1,5}$/.test(value)) throw new Error('Unknown option or invalid integer');
    const number = Number(value);
    if (number < limit[1] || number > limit[2]) throw new Error(`${key} outside approved bounds`);
    options[limit[0]] = number;
  }
  return options;
}

function supervise(args) {
  parseOptions(args);
  const start = performance.now();
  // Metadata commands finish under their own timeouts before the server worker
  // exists, so the worker has no grandchildren to orphan on forced termination.
  const metadata = environment();
  const child = spawn(process.execPath, [__filename, '--worker', ...args], {
    cwd: ROOT,
    stdio: ['ignore', 'inherit', 'inherit', 'ipc']
  });
  let timedOut = false;
  let interrupted = false;
  let sampleWatchdog;
  child.on('message', (message) => {
    clearTimeout(sampleWatchdog);
    if (message.phase === 'sample_start') {
      sampleWatchdog = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
        console.error('Benchmark sample exceeded 10 seconds: worker killed');
      }, 10000);
    }
  });
  const watchdog = setTimeout(() => {
    timedOut = true;
    child.kill('SIGKILL');
    console.error('Benchmark hard timeout: worker killed and OS sockets closed');
  }, Math.max(1, OUTER_TIMEOUT_MS - (performance.now() - start)));
  const interrupt = () => {
    interrupted = true;
    child.kill('SIGKILL');
  };
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);
  child.once('error', () => {
    console.error('Unable to start benchmark worker');
    process.exitCode = 1;
  });
  child.once('close', (code) => {
    clearTimeout(watchdog);
    clearTimeout(sampleWatchdog);
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
    process.exitCode = timedOut ? 124 : interrupted ? 130 : code === 0 ? 0 : 1;
  });
  child.send({ phase: 'metadata', environment: metadata }, (error) => {
    if (error) {
      console.error('Unable to initialize benchmark worker');
      child.kill('SIGKILL');
    }
  });
}

function commandMetadata(command, args) {
  const result = spawnSync(command, args, {
    cwd: ROOT, encoding: 'utf8', timeout: 3000, killSignal: 'SIGKILL', maxBuffer: 1024,
    stdio: ['ignore', 'pipe', 'pipe'], shell: false
  });
  if (result.error || result.status !== 0) return { available: false };
  return { available: true, value: result.stdout.trim() };
}

function sourceIdentity() {
  const files = ['index.js', 'package.json'];
  if (fs.existsSync(path.join(ROOT, 'package-lock.json'))) files.push('package-lock.json');
  function visit(directory) {
    for (const entry of fs.readdirSync(path.join(ROOT, directory), { withFileTypes: true })) {
      const relative = `${directory}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error('Source fingerprint does not follow symlinks');
      if (entry.isDirectory()) visit(relative);
      else if (entry.isFile() && entry.name.endsWith('.js')) files.push(relative);
      if (files.length > 512) throw new Error('Source fingerprint file limit exceeded');
    }
  }
  visit('lib');
  const hashes = {};
  for (const file of files.sort()) {
    const absolute = path.join(ROOT, file);
    if (fs.statSync(absolute).size > MAX_BYTES) throw new Error('Source fingerprint file too large');
    hashes[file] = createHash('sha256').update(fs.readFileSync(absolute)).digest('hex');
  }
  return {
    algorithm: 'sha256(JSON.stringify(sorted path-to-sha256 map))',
    digest: createHash('sha256').update(JSON.stringify(hashes)).digest('hex'),
    files: hashes,
    harnessSha256: createHash('sha256').update(fs.readFileSync(__filename)).digest('hex')
  };
}

function environment() {
  const cpus = os.cpus();
  return {
    node: process.version, npm: commandMetadata('npm', ['--version']),
    gitHead: commandMetadata('git', ['rev-parse', 'HEAD']),
    platform: process.platform, arch: process.arch, release: os.release(),
    cpuModel: cpus[0] ? cpus[0].model : 'unknown', logicalCpus: cpus.length,
    totalMemoryBytes: os.totalmem(), freeMemoryBytes: os.freemem(),
    loadAverage: os.loadavg(), versions: process.versions
  };
}

function requestOnce(context, fixture) {
  return new Promise((resolve) => {
    let settled = false;
    let response;
    let bytes = 0;
    const chunks = [];
    const start = performance.now();
    const request = http.request({
      hostname: HOST, port: context.port, path: fixture.path, method: 'GET',
      agent: context.agent, maxHeaderSize: 8192
    });
    const timer = setTimeout(() => finish('timeout'), REQUEST_TIMEOUT_MS);
    function finish(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      context.requests.delete(request);
      if (error) {
        request.destroy();
        if (response) response.destroy();
      }
      resolve({ error, latencyMs: performance.now() - start, bytes });
    }
    context.requests.add(request);
    request.on('error', () => finish('transport'));
    request.on('response', (res) => {
      response = res;
      if (res.statusCode !== 200) return finish('http_status');
      res.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > MAX_BYTES) return finish('response_too_large');
        chunks.push(chunk);
      });
      res.on('error', () => finish('transport'));
      res.on('aborted', () => finish('aborted'));
      res.on('end', () => {
        const matches = Buffer.concat(chunks).equals(Buffer.from(fixture.body));
        finish(matches ? null : 'body_mismatch');
      });
    });
    request.end(); // No request payload; every response is checked, never discarded.
  });
}

function latencySummary(values) {
  values.sort((a, b) => a - b);
  if (values.length === 0) return null;
  const percentile = (p) => values[Math.max(0, Math.ceil(values.length * p) - 1)];
  const bounds = [0.25, 0.5, 1, 2, 5, 10, 25, 50, 100, 250, 1000];
  const buckets = Array(bounds.length + 1).fill(0);
  for (const value of values) {
    const index = bounds.findIndex((bound) => value <= bound);
    buckets[index < 0 ? bounds.length : index]++;
  }
  return {
    count: values.length, min: values[0], mean: values.reduce((a, b) => a + b, 0) / values.length,
    p50: percentile(0.5), p90: percentile(0.9), p95: percentile(0.95), p99: percentile(0.99),
    max: values[values.length - 1], histogramUpperBoundsMs: [...bounds, null],
    histogramCounts: buckets
  };
}

async function sample(context, options, number) {
  const before = process.memoryUsage();
  const peak = { ...before };
  function observeMemory() {
    for (const [key, value] of Object.entries(process.memoryUsage())) {
      peak[key] = Math.max(peak[key], value);
    }
  }
  const memoryTimer = setInterval(observeMemory, 100);
  const latencies = [];
  const errors = {};
  const routes = Object.fromEntries(CASES.map((fixture) => [fixture.name, { issued: 0, completed: 0, errors: 0 }]));
  let issued = 0;
  let completed = 0;
  let responseBytes = 0;
  let sampleTimedOut = false;
  let stopped = false;
  const start = performance.now();
  const deadline = start + options.durationMs;
  const hardTimer = setTimeout(() => {
    sampleTimedOut = true;
    for (const request of context.requests) request.destroy();
  }, options.durationMs + REQUEST_TIMEOUT_MS);
  async function lane() {
    while (!stopped && !sampleTimedOut && issued < MAX_REQUESTS && performance.now() < deadline) {
      const fixture = CASES[issued++ % CASES.length];
      const route = routes[fixture.name];
      route.issued++;
      const result = await requestOnce(context, fixture);
      responseBytes += result.bytes;
      if (result.error) {
        errors[result.error] = (errors[result.error] || 0) + 1;
        route.errors++;
      } else {
        completed++;
        route.completed++;
        latencies.push(result.latencyMs);
      }
    }
  }
  try {
    await Promise.all(Array.from({ length: options.concurrency }, lane));
  } finally {
    stopped = true;
    clearInterval(memoryTimer);
    clearTimeout(hardTimer);
  }
  const elapsedMs = performance.now() - start;
  observeMemory();
  const after = process.memoryUsage();
  return {
    number, issued, completed, errorCount: issued - completed, errors, routes,
    responseBytes, elapsedMs, throughputRequestsPerSecond: completed / (elapsedMs / 1000),
    stoppedBy: sampleTimedOut ? 'hard_sample_deadline' : issued === MAX_REQUESTS ? 'request_cap' : 'load_duration',
    latencyMs: latencySummary(latencies),
    memoryBytes: { before, after, observedPeak: peak, observationIntervalMs: 100 }
  };
}

function reportWorkerFailure(error, diagnostics) {
  // Never serialize exception messages, stacks, causes or arbitrary code values:
  // filesystem/module errors can contain private paths or source-derived data.
  const descriptor = error && typeof error === 'object' ? Object.getOwnPropertyDescriptor(error, 'code') : null;
  const code = descriptor && WORKER_ERROR_CODES.has(descriptor.value) ? descriptor.value : 'UNKNOWN';
  const stage = WORKER_STAGE_IDS.has(diagnostics.stage) ? diagnostics.stage : 'unknown';
  console.error(JSON.stringify({ event: 'benchmark_worker_failed', stage, code, baselineValid: false }));
}

async function runWorker(options, args, metadata, diagnostics) {
  const startedAt = new Date().toISOString();
  diagnostics.stage = 'fingerprint';
  const identity = sourceIdentity();
  diagnostics.stage = 'framework_setup';
  // Resolve the current checkout, never the older installed velocy devDependency.
  const { Router, createServer } = require('../lib');
  const router = new Router();
  router.get('/plain', (req, res) => res.send(CASES[0].body));
  router.get('/users/:id', (req, res) => res.json({ id: req.params.id }));
  router.get('/search', (req, res) => res.json({ q: req.query.q }));
  router.get('/files/*', (req, res) => res.json({ file: req.params['*'] }));
  const server = createServer(router, {
    requestTimeout: 1000, headersTimeout: 1000, keepAliveTimeout: 2000, maxHeaderSize: 8192
  });
  server.maxConnections = 10;
  const sockets = new Set();
  let peakServerConnections = 0;
  server.on('connection', (socket) => {
    sockets.add(socket);
    peakServerConnections = Math.max(peakServerConnections, sockets.size);
    socket.once('close', () => sockets.delete(socket));
  });
  const agent = new http.Agent({
    keepAlive: true, maxSockets: options.concurrency, maxTotalSockets: options.concurrency,
    maxFreeSockets: options.concurrency, proxyEnv: {}
  });
  const context = { agent, requests: new Set(), port: null };
  const samples = [];
  try {
    diagnostics.stage = 'listen';
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, HOST, resolve);
    });
    context.port = server.address().port;
    for (let i = 1; i <= options.samples; i++) {
      diagnostics.stage = 'sample';
      process.send({ phase: 'sample_start' });
      samples.push(await sample(context, options, i));
      process.send({ phase: 'sample_end' });
    }
  } finally {
    const previousStage = diagnostics.stage;
    diagnostics.stage = 'cleanup';
    for (const request of context.requests) request.destroy();
    agent.destroy();
    // Stop accepting first, then close active/idle sockets to avoid a close race.
    if (server.listening) {
      await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
        server.closeAllConnections();
        for (const socket of sockets) socket.destroy();
      });
    }
    // Preserve the failing operation if cleanup succeeds; a cleanup exception
    // intentionally leaves its own stage selected for the outer diagnostic.
    diagnostics.stage = previousStage;
  }
  diagnostics.stage = 'report';
  const totalErrors = samples.reduce((sum, item) => sum + item.errorCount, 0);
  const ok = totalErrors === 0 && samples.every((item) => item.completed > 0 && item.stoppedBy !== 'hard_sample_deadline');
  const report = {
    schemaVersion: 1, ok, startedAt, finishedAt: new Date().toISOString(),
    invocation: [process.execPath, path.relative(ROOT, __filename), ...args],
    source: { ownerSuppliedSnapshotLabel: options.snapshotId, ...identity },
    environment: metadata,
    workload: {
      framework: 'current checkout lib/index.js Router default options + createServer',
      protocol: 'HTTP/1.1 loopback keep-alive; same worker hosts client and server',
      host: HOST, port: context.port, concurrency: options.concurrency, samples: options.samples,
      loadDurationMs: options.durationMs, sampleHardLimitMs: options.durationMs + REQUEST_TIMEOUT_MS,
      requestTimeoutMs: REQUEST_TIMEOUT_MS, outerTimeoutMs: OUTER_TIMEOUT_MS,
      maxRequestsPerSample: MAX_REQUESTS, maxResponseBytes: MAX_BYTES, requestPayloadBytes: 0,
      warmupRequests: 0, cases: CASES, peakServerConnections
    },
    samples,
    totals: {
      issued: samples.reduce((sum, item) => sum + item.issued, 0),
      completed: samples.reduce((sum, item) => sum + item.completed, 0), errors: totalErrors
    },
    cleanup: { serverClosed: !server.listening, outstandingRequests: context.requests.size },
    loadAverageAfter: os.loadavg()
  };
  diagnostics.stage = 'output';
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!ok) process.exitCode = 1;
}

const args = process.argv.slice(2);
try {
  if (args[0] === '--worker') {
    if (!process.send) throw new Error('Worker mode requires the benchmark supervisor');
    const workerArgs = args.slice(1);
    const options = parseOptions(workerArgs);
    const diagnostics = { stage: 'fingerprint' };
    process.once('message', (message) => {
      runWorker(options, workerArgs, message.environment, diagnostics).catch((error) => {
        reportWorkerFailure(error, diagnostics);
        process.exitCode = 1;
      }).finally(() => process.disconnect());
    });
  } else {
    supervise(args);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
