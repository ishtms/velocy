const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { Readable, Writable } = require('node:stream');
const { Router, compression } = require('../index');
const Response = require('../lib/core/Response');
const serveStatic = require('../lib/middleware/static');
const { TestRunner, createTestServer } = require('./test-helper');

const runner = new TestRunner('Compression streaming security tests');
const turn = () => new Promise(resolve => setImmediate(resolve));

function bounded(promise, label, ms = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} deadline exceeded`)), ms);
    promise.then(value => { clearTimeout(timer); resolve(value); }, err => { clearTimeout(timer); reject(err); });
  });
}

function request(port, route = '/', options = {}) {
  return new Promise((resolve, reject) => {
    let incoming;
    let socket;
    let error;
    let ended = false;
    const chunks = [];
    const req = http.get({ hostname: '127.0.0.1', port, path: route, agent: options.agent ?? false,
      headers: { 'accept-encoding': 'gzip', ...options.headers } }, res => {
      incoming = res;
      res.on('data', data => {
        chunks.push(data);
        if (options.disconnect) res.destroy();
        else if (options.slow) {
          res.pause();
          setTimeout(() => res.resume(), 2);
        }
      });
      res.on('end', () => { ended = true; });
      res.on('error', err => { error = err; });
      res.on('close', finish);
    });
    req.on('socket', value => { socket = value; });
    req.on('error', err => { error = err; if (!incoming) finish(); });
    const timer = setTimeout(() => {
      req.destroy();
      incoming?.destroy();
      reject(new Error(`HTTP ${route} fixture deadline exceeded`));
    }, 8000);
    function finish() {
      clearTimeout(timer);
      resolve({ status: incoming?.statusCode, headers: incoming?.headers || {}, body: Buffer.concat(chunks),
        complete: incoming?.complete || false, ended, error, socket });
    }
  });
}

function decoded(result) {
  return result.headers['content-encoding'] === 'gzip' ? zlib.gunzipSync(result.body) : result.body;
}

async function serverFixture(app, run) {
  const server = await createTestServer(app);
  try { await run(server.port); }
  finally { server.server.closeAllConnections(); await server.close(); }
}

async function filesFixture(run) {
  const parent = path.join(__dirname, 'temp');
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, 'compression-security-'));
  try { await run(root); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
}

for (const mode of ['filter', 'binary', 'precompressed']) {
  runner.test(`Identity threshold flush preserves framing for P3 ${mode} streams`, async () => {
    await filesFixture(async root => {
      const data = crypto.randomBytes(256 * 1024);
      const name = mode === 'binary' ? 'file.bin' : 'file.txt';
      fs.writeFileSync(path.join(root, name), data);
      const expected = mode === 'precompressed' ? zlib.gzipSync(data) : data;
      if (mode === 'precompressed') fs.writeFileSync(path.join(root, name) + '.gz', expected);
      assert.ok(expected.length > 1024);
      const app = new Router();
      app.use(compression({ threshold: 1024, ...(mode === 'filter' ? { filter: () => false } : {}) }));
      app.use(serveStatic(root, { fallthrough: false }));
      await serverFixture(app, async port => {
        const result = await request(port, '/' + name);
        assert.equal(result.status, 200);
        assert.equal(result.complete, true);
        assert.equal(result.ended, true);
        assert.deepEqual(result.body, expected);
        assert.equal(result.headers['content-encoding'], mode === 'precompressed' ? 'gzip' : undefined);
      });
    });
  });
}

for (const compressed of [false, true]) {
  runner.test(`Accepted ${compressed ? 'gzip' : 'identity'} negotiation writes own callback-reusable buffers`, async () => {
    const app = new Router();
    app.use(compression({ threshold: 1024, filter: () => compressed }));
    let producing;
    app.get('/', (req, res) => {
      res.type('text');
      producing = (async () => {
        const reusable = Buffer.alloc(1);
        for (const byte of [65, 66, 67]) {
          reusable[0] = byte;
          await new Promise(resolve => res.write(reusable, resolve));
        }
        reusable[0] = 90;
        res.end('.' + (compressed ? 'x'.repeat(1024) : ''));
      })();
    });
    await serverFixture(app, async port => {
      const result = await request(port);
      await bounded(producing, 'reusable buffer producer');
      assert.equal(result.complete, true);
      assert.equal(decoded(result).toString(), 'ABC.' + (compressed ? 'x'.repeat(1024) : ''));
    });
  });

  runner.test(`Callback-driven ${compressed ? 'compressed' : 'identity'} producer crosses the threshold without stalling`, async () => {
    const app = new Router();
    app.use(compression({ threshold: 32, filter: () => compressed }));
    let callbacks = 0;
    let endCallbacks = 0;
    let producer;
    const chunks = Array.from({ length: 48 }, (_, i) => `chunk-${i}-α\n`);
    app.get('/', (req, res) => {
      res.status(202).type('text');
      producer = (async () => {
        for (let i = 0; i < chunks.length; i++) await new Promise((resolve, reject) => {
          const done = err => { callbacks++; if (err) reject(err); else resolve(); };
          if (i % 2) res.write(chunks[i], done);
          else res.write(chunks[i], 'utf8', done);
        });
        await new Promise(resolve => res.end('tail', 'utf8', () => { endCallbacks++; resolve(); }));
      })();
      producer.catch(() => res._nativeResponse.destroy());
    });
    await serverFixture(app, async port => {
      const result = await request(port);
      await bounded(producer, 'callback producer');
      assert.equal(result.status, 202);
      assert.equal(result.complete, true);
      assert.equal(decoded(result).toString(), chunks.join('') + 'tail');
      assert.equal(callbacks, chunks.length);
      assert.equal(endCallbacks, 1);
    });
  });
}

for (const method of ['send', 'json', 'buffer', 'empty', 'number', 'native']) {
  runner.test(`Prefix plus ${method} has exact framing and permits a second persistent response`, async () => {
    const app = new Router();
    app.use(compression({ threshold: 4096, filter: () => false }));
    let expected = 'prefix:';
    app.get('/first', (req, res) => {
      if (method === 'native') {
        res._nativeResponse.statusCode = 203;
        res._nativeResponse.write('prefix:');
      }
      else res.write('prefix:');
      if (method === 'json') res.json({ value: 1 });
      else if (method === 'buffer') res.send(Buffer.from('suffix'));
      else if (method === 'empty') res.send(null);
      else if (method === 'number') res.send(42);
      else res.send('suffix');
    });
    expected += method === 'json' ? '{"value":1}' : method === 'empty' ? '' : method === 'number' ? '42' : 'suffix';
    app.get('/second', (req, res) => res.send('independent response'));
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
    try {
      await serverFixture(app, async port => {
        const first = await request(port, '/first', { agent });
        const second = await request(port, '/second', { agent });
        assert.equal(first.complete, true);
        assert.equal(first.status, method === 'native' ? 203 : 200);
        assert.equal(first.body.toString(), expected);
        assert.equal(first.headers['content-length'], undefined);
        assert.equal(second.body.toString(), 'independent response');
        assert.equal(second.complete, true);
        assert.equal(first.socket, second.socket, 'same connection must remain correctly framed');
      });
    } finally { agent.destroy(); }
  });
}

runner.test('Large multi-chunk pipe obeys pressure and remains exact with a slow HTTP consumer', async () => {
  const app = new Router();
  app.use(compression({ threshold: 1024, chunkSize: 4096 }));
  const chunk = crypto.randomBytes(64 * 1024);
  const count = 64;
  let written = 0;
  let blocked = 0;
  let drains = 0;
  app.get('/', (req, res) => {
    res.type('text');
    const write = res.write.bind(res);
    res.write = (...args) => { const ok = write(...args); if (!ok) blocked++; return ok; };
    res.on('drain', () => { drains++; });
    const source = new Readable({ highWaterMark: chunk.length, read() {
      if (written++ < count) this.push(chunk);
      else this.push(null);
    } });
    res.once('close', () => source.destroy());
    source.pipe(res);
  });
  await serverFixture(app, async port => {
    const result = await request(port, '/', { slow: true });
    assert.equal(result.complete, true);
    assert.equal(result.headers['content-encoding'], 'gzip');
    const body = decoded(result);
    assert.equal(body.length, count * chunk.length);
    assert.deepEqual(body, Buffer.concat(Array(count).fill(chunk)));
    assert.ok(blocked > 0, 'producer must encounter pressure');
    assert.ok(drains > 0, 'producer must observe drain and finish');
  });
});

for (const compressed of [false, true]) {
runner.test(`A gated slow native sink bounds ${compressed ? 'compressed' : 'identity'} output and bridges drain`, async () => {
  let firstWrite;
  const started = new Promise(resolve => { firstWrite = resolve; });
  const output = [];
  let held;
  let released = false;
  let maximum = 0;
  let outputBytes = 0;
  let maximumInputLead = 0;
  const native = new Writable({ highWaterMark: 1024, write(data, enc, cb) {
    output.push(Buffer.from(data));
    outputBytes += data.length;
    maximumInputLead = Math.max(maximumInputLead, produced * chunk.length - outputBytes);
    maximum = Math.max(maximum, native.writableLength);
    if (!released) { held = cb; firstWrite(); }
    else setImmediate(cb);
  } });
  native.headersSent = false;
  native.statusCode = 200;
  const headers = {};
  native.getHeaders = () => ({ ...headers });
  native.getHeader = name => headers[name.toLowerCase()];
  native.setHeader = (name, value) => { headers[name.toLowerCase()] = value; };
  native.removeHeader = name => { delete headers[name.toLowerCase()]; };
  native.writeHead = (status, values) => {
    native.statusCode = status;
    Object.assign(headers, values);
    native.headersSent = true;
    return native;
  };
  const res = new Response(native);
  compression({ threshold: 0, chunkSize: 4096, filter: () => compressed })({ method: 'GET', headers: { 'accept-encoding': 'gzip' } }, res, () => {});
  res.type('text');
  const chunk = crypto.randomBytes(64 * 1024);
  let produced = 0;
  const producing = (async () => {
    for (; produced < 32; produced++) {
      if (!res.write(chunk)) await new Promise(resolve => res.once('drain', resolve));
    }
    await new Promise(resolve => res.end(resolve));
  })();
  try {
    await bounded(started, 'gated output start');
    await turn();
    await turn();
    assert.ok(produced < 32, 'input must stop while sink refuses output');
    const bound = compressed ? 4096 : chunk.length;
    assert.ok(native.writableLength <= bound, `native queue grew to ${native.writableLength}`);
    released = true;
    held();
    await bounded(producing, 'gated output completion');
    assert.ok(maximum <= bound, `output exceeded one native chunk (${maximum})`);
    assert.ok(maximumInputLead <= 3 * chunk.length,
      `native drains bypassed input pressure: input ran ${maximumInputLead} bytes ahead`);
    console.log(`    Pressure ${compressed ? 'gzip' : 'identity'}: max sink queue=${maximum}, max input lead=${maximumInputLead} bytes`);
    const body = Buffer.concat(output);
    assert.deepEqual(compressed ? zlib.gunzipSync(body) : body, Buffer.concat(Array(32).fill(chunk)));
  } finally { native.destroy(); }
});
}

runner.test('Disconnect cancels compression and settles outstanding producer callbacks', async () => {
  const app = new Router();
  app.use(compression({ threshold: 0, chunkSize: 4096 }));
  const chunk = crypto.randomBytes(128 * 1024);
  let producer;
  let attempted = 0;
  let callbacks = 0;
  let native;
  app.get('/', (req, res) => {
    res.type('text');
    native = res._nativeResponse;
    producer = (async () => {
      for (let i = 0; i < 128 && !native.destroyed; i++) {
        attempted++;
        const error = await new Promise(resolve => res.write(chunk, err => { callbacks++; resolve(err); }));
        if (error) break;
      }
      if (!native.destroyed) res.end();
    })();
  });
  await serverFixture(app, async port => {
    const result = await request(port, '/', { disconnect: true });
    await bounded(producer, 'disconnected producer');
    assert.equal(result.complete, false);
    assert.equal(native.destroyed, true);
    assert.equal(callbacks, attempted, 'every accepted callback must settle once');
    assert.ok(attempted < 128, 'disconnect must stop production');
  });
});

runner.test('Disconnect during compressed end settles its callback exactly once', async () => {
  const app = new Router();
  app.use(compression({ threshold: 0, chunkSize: 4096 }));
  const data = crypto.randomBytes(4 * 1024 * 1024);
  let completed;
  let calls = 0;
  app.get('/', (req, res) => {
    res.type('text');
    completed = new Promise(resolve => res.end(data, err => { calls++; resolve(err); }));
  });
  await serverFixture(app, async port => {
    const result = await request(port, '/', { disconnect: true });
    const error = await bounded(completed, 'disconnected end callback');
    assert.equal(result.complete, false);
    assert.ok(error, 'a truncated compressed end must not report successful completion');
    assert.equal(calls, 1);
  });
});

for (const via of ['wrapper', 'native']) {
  for (const fallthrough of [false, true]) {
    runner.test(`P3 ${via} callback writes then throws: abort even below compression threshold (fallthrough=${fallthrough})`, async () => {
      await filesFixture(async root => {
        fs.writeFileSync(path.join(root, 'file.txt'), 'public');
        const app = new Router();
        app.use(compression({ threshold: 65536 }));
        let downstream = false;
        app.use(serveStatic(root, { fallthrough, setHeaders(file, stat, res) {
          if (via === 'native') res._nativeResponse.write('failed callback prefix');
          else res.write('failed callback prefix');
          const error = new Error('fixture access denial');
          error.code = 'EACCES';
          throw error;
        } }));
        app.get('/file.txt', (req, res) => { downstream = true; res.send('downstream'); });
        await serverFixture(app, async port => {
          const result = await request(port, '/file.txt');
          assert.equal(result.complete, false);
          assert.equal(result.ended, false);
          assert.equal(downstream, false);
          assert.equal(result.body.includes(Buffer.from('Forbidden')), false);
          assert.equal(result.body.includes(Buffer.from('downstream')), false);
        });
      });
    });
  }
}

for (const upstream of ['wrapper', 'native']) {
  for (const fallthrough of [false, true]) {
  runner.test(`P3 recovery preserves ${upstream} upstream bytes without callback writes (fallthrough=${fallthrough})`, async () => {
    await filesFixture(async root => {
      fs.writeFileSync(path.join(root, 'file.txt'), 'public');
      const app = new Router();
      app.use(compression({ threshold: 65536, filter: () => false }));
      app.use((req, res, next) => {
        res.type('text').set('X-Upstream', 'kept');
        if (upstream === 'native') res._nativeResponse.write('upstream:');
        else res.write('upstream:');
        next();
      });
      app.use(serveStatic(root, { fallthrough, setHeaders(file, stats, res) {
        res.set('X-Static', 'discard');
        const error = new Error('fixture access denial');
        error.code = 'EACCES';
        throw error;
      } }));
      app.get('/file.txt', (req, res) => res.send('downstream'));
      await serverFixture(app, async port => {
        const result = await request(port, '/file.txt');
        assert.equal(result.complete, true);
        assert.equal(result.status, fallthrough ? 200 : 403);
        assert.equal(result.body.toString(), fallthrough ? 'upstream:downstream' : 'upstream:Forbidden');
        assert.equal(result.headers['x-upstream'], 'kept');
        if (fallthrough) assert.equal(result.headers['x-static'], undefined);
        assert.equal(result.headers['content-length'], undefined);
      });
    });
  });
  }
}

const deadline = setTimeout(() => {
  console.error(`Streaming suite stalled: ${runner.passed + runner.failed}/${runner.tests.length}`);
  process.exit(1);
}, 60000);
runner.run().then(success => {
  clearTimeout(deadline);
  assert.equal(runner.passed + runner.failed, runner.tests.length);
  console.log(`Completion: ${runner.passed + runner.failed}/${runner.tests.length}`);
  process.exit(success ? 0 : 1);
}).catch(err => { clearTimeout(deadline); console.error(err.message); process.exit(1); });
