const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const { once } = require('node:events');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const http = require('node:http');
const Request = require('../lib/core/Request');
const { Router, bodyParser } = require('../index');
const { TestRunner, createTestServer, makeRequest } = require('./test-helper');

// Referenced guards ensure an unresolved promise cannot silently let Node exit 0.
const outerGuard = setTimeout(() => {
  console.error('Request security test deadline exceeded');
  process.exit(1);
}, 20000);

async function bounded(promise) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Promise did not settle')), 1500);
    })]);
  } finally {
    clearTimeout(timer);
  }
}

function fixture(query = '', contentType = 'text/plain') {
  const native = new PassThrough();
  native.url = '/?' + query;
  native.method = 'POST';
  native.headers = { 'content-type': contentType };
  native.socket = { remoteAddress: '127.0.0.1' };
  return { native, req: new Request(native) };
}

function query(text) {
  return fixture(text).req.query;
}

function errorCode(code, statusCode) {
  return (error) => error.code === code && error.statusCode === statusCode;
}

function restoreOwn(target, key, descriptor) {
  if (descriptor) Object.defineProperty(target, key, descriptor);
  else delete target[key];
}

async function pollutionChild(mode) {
  const marker = 'p8RequestPolluted';
  const original = Object.getOwnPropertyDescriptor(Object.prototype, marker);
  const payload = `a[]=x&a[__proto__][__proto__][${marker}]=true`;
  try {
    if (mode === 'query') {
      assert.throws(() => query(payload), errorCode('INVALID_PARAMETER_PATH', 400));
    } else {
      const { req, native } = fixture('', 'application/x-www-form-urlencoded');
      const pending = req.body;
      native.end(payload);
      await assert.rejects(bounded(pending), errorCode('INVALID_PARAMETER_PATH', 400));
    }
    assert.deepEqual(Object.getOwnPropertyDescriptor(Object.prototype, marker), original);
  } finally {
    // Deterministic restoration even when this regression runs against vulnerable code.
    restoreOwn(Object.prototype, marker, original);
  }
}

const runner = new TestRunner('Request Input Security Tests');

for (const mode of ['query', 'body']) {
  runner.test(`Rejects inherited array prototype pollution in isolated ${mode} process`, () => {
    const child = spawnSync(process.execPath, [__filename, '--pollution', mode], {
      timeout: 3000, maxBuffer: 64 * 1024, encoding: 'utf8'
    });
    assert.ifError(child.error);
    assert.equal(child.signal, null);
    assert.equal(child.status, 0, child.stderr || child.stdout);
  });
}

runner.test('Rejects dangerous decoded path segments, including fallback keys', () => {
  for (const key of ['__proto__', 'constructor', 'prototype', 'a[constructor][prototype][x]',
    'a[__proto__]', 'a[prototype]', 'a[%5f%5fproto%5f%5f]', '[__proto__]',
    'a[constructor]broken', '__proto__]']) {
    assert.throws(() => query(`${key}=true`), errorCode('INVALID_PARAMETER_PATH', 400));
  }
  assert.throws(() => query('a[]=x&a[length]=1'), errorCode('INVALID_PARAMETER_PATH', 400));
  assert.throws(() => query('a[]=x&a[length][x]=1'), errorCode('INVALID_PARAMETER_PATH', 400));
});

runner.test('Does not read or write inherited array accessors', () => {
  const key = 'p8Inherited';
  const original = Object.getOwnPropertyDescriptor(Array.prototype, key);
  const marker = 'p8AccessorTouched';
  const originalMarker = Object.getOwnPropertyDescriptor(Object.prototype, marker);
  let touches = 0;
  Object.defineProperty(Array.prototype, key, {
    configurable: true,
    get() { touches++; return Object.prototype; },
    set() { touches++; }
  });
  try {
    const result = query(`a[]=x&a[${key}][${marker}]=true&b[]=y&b[${key}]=ok`);
    assert.equal(touches, 0);
    assert.equal(result.a[key][marker], true);
    assert.equal(result.b[key], 'ok');
    assert.deepEqual(Object.getOwnPropertyDescriptor(Object.prototype, marker), originalMarker);
  } finally {
    restoreOwn(Array.prototype, key, original);
    restoreOwn(Object.prototype, marker, originalMarker);
  }
});

runner.test('Preserves ordinary coercion, duplicate, array and nested query semantics', () => {
  const result = query('n=1&n=2&items[]=a&items[]=b&list[0][name]=first&list[1][name]=second' +
    '&filter[active]=true&filter[empty]=null&filter[empty][x]=ok&csv=1,2&space=hello+world' +
    '&literal=%E0%A4%A&flag&items[push]=field&items[]=c');
  assert.deepEqual(result.n, [1, 2]);
  assert.deepEqual(Array.from(result.items), ['a', 'b', 'c']);
  assert.equal(result.items.push, 'field');
  assert.equal(result.list[1].name, 'second');
  assert.equal(result.filter.active, true);
  assert.equal(result.filter.empty.x, 'ok');
  assert.deepEqual(result.csv, [1, 2]);
  assert.equal(result.space, 'hello world');
  assert.equal(result.literal, '%E0%A4%A');
  assert.equal(result.flag, '');
  assert.equal(Object.getPrototypeOf(result), null);
  assert.equal(Object.getPrototypeOf(result.filter), null);
});

runner.test('Enforces parameter count, byte, depth and numeric index ceilings at boundaries', () => {
  assert.equal(Object.keys(query(Array.from({ length: 1000 }, (_, i) => `p${i}=x`).join('&'))).length, 1000);
  assert.throws(() => query('x=1&'.repeat(1000) + 'x=1'), errorCode('PARAMETER_COUNT_LIMIT', 413));
  assert.equal(query('x=' + 'a'.repeat(1024 * 1024 - 2)).x.length, 1024 * 1024 - 2);
  assert.throws(() => query('x=' + 'a'.repeat(1024 * 1024 - 1)), errorCode('PARAMETER_SIZE_LIMIT', 413));
  assert.equal(query('a' + '[b]'.repeat(20) + '=x').a.b.b.b.b.b.b.b.b.b.b.b.b.b.b.b.b.b.b.b.b, 'x');
  assert.throws(() => query('a' + '[b]'.repeat(21) + '=x'), errorCode('PARAMETER_DEPTH_LIMIT', 400));
  assert.throws(() => query('a[' + Array(21).fill('b').join(']') + ']=x'), errorCode('PARAMETER_DEPTH_LIMIT', 400));
  assert.equal(query('a[10000]=x').a.length, 10001);
  for (const index of ['10001', '4294967294', '9007199254740993', '00010001']) {
    assert.throws(() => query(`a[${index}]=x`), errorCode('PARAMETER_INDEX_LIMIT', 400));
  }
});

runner.test('Standalone URL-encoded bodies use the same parameter ceilings', async () => {
  for (const [payload, code, status] of [
    ['x=1&'.repeat(1000) + 'x=1', 'PARAMETER_COUNT_LIMIT', 413],
    ['a' + '[b]'.repeat(21) + '=x', 'PARAMETER_DEPTH_LIMIT', 400],
    ['a[10001]=x', 'PARAMETER_INDEX_LIMIT', 400]
  ]) {
    const { req, native } = fixture('', 'application/x-www-form-urlencoded');
    const pending = req.body;
    native.end(payload);
    await assert.rejects(bounded(pending), errorCode(code, status));
    assert.strictEqual(req.body, pending);
  }
});

runner.test('Concurrent raw and parsed callers share single read and stable results', async () => {
  const { req, native } = fixture('', 'application/json');
  const raw = req.getRawBody();
  const parsed = req.body;
  assert.strictEqual(req.getRawBody(), raw);
  assert.strictEqual(req.body, parsed);
  assert.equal(native.listenerCount('data'), 1);
  native.write('{"ok":');
  native.end('true}');
  const [bytes, body] = await bounded(Promise.all([raw, parsed]));
  assert.equal(bytes.toString(), '{"ok":true}');
  assert.deepEqual(body, { ok: true });
  assert.strictEqual(await req.body, body);
  assert.strictEqual(await req.getRawBody(), bytes);
  assert.equal(native.listenerCount('data'), 0);
});

runner.test('Successful collection preserves every pre-existing application listener', async () => {
  const { req, native } = fixture();
  const app = { data() {}, end() {}, error() {}, close() {}, aborted() {} };
  for (const [event, fn] of Object.entries(app)) native.on(event, fn);
  const pending = req.getRawBody();
  native.end('ok');
  assert.equal((await bounded(pending)).toString(), 'ok');
  for (const [event, fn] of Object.entries(app)) assert.deepEqual(native.listeners(event), [fn], event);
});

runner.test('Caches empty bodies and JSON null without restarting collection', async () => {
  for (const value of ['', 'null', 'invalid json']) {
    const { req, native } = fixture('', 'application/json');
    const first = req.body;
    native.end(value);
    assert.equal(await bounded(first), null);
    assert.strictEqual(req.body, first);
    assert.equal(await bounded(req.body), null);
    assert.equal(native.listenerCount('data'), 0);
  }
});

runner.test('Overflow rejects every waiter with same error and preserves application listeners', async () => {
  const { req, native } = fixture();
  req.bodyLimit = 2;
  const app = { data() {}, end() {}, error() {}, close() {}, aborted() {} };
  for (const [event, fn] of Object.entries(app)) native.on(event, fn);
  const raw = req.getRawBody();
  const parsed = req.body;
  const settled = Promise.allSettled([raw, req.getRawBody(), parsed]);
  native.end('abc');
  const results = await bounded(settled);
  assert(results.every((result) => result.status === 'rejected'));
  const error = results[0].reason;
  assert(errorCode('BODY_SIZE_LIMIT', 413)(error));
  assert(results.every((result) => result.reason === error));
  for (const [event, fn] of Object.entries(app)) assert(native.listeners(event).includes(fn), event);
  assert.strictEqual(req.getRawBody(), raw);
  await assert.rejects(bounded(req.getRawBody()), (next) => next === error);
});

runner.test('Exact byte limits, UTF-8 chunks and zero-byte limit remain usable', async () => {
  for (const [payload, limit] of [['é', 2], ['', 0]]) {
    const { req, native } = fixture();
    req.bodyLimit = limit;
    const pending = req.getRawBody();
    native.end(payload);
    assert.equal((await bounded(pending)).toString(), payload);
  }
  const { req, native } = fixture();
  req.bodyLimit = 1;
  const pending = req.getRawBody();
  native.end('é');
  await assert.rejects(bounded(pending), errorCode('BODY_SIZE_LIMIT', 413));
});

for (const event of ['aborted', 'close', 'error']) {
  runner.test(`Premature ${event} settles all callers and cleans up only owned listeners`, async () => {
    const { req, native } = fixture();
    const appListener = () => {};
    native.on(event, appListener);
    const raw = req.getRawBody();
    const resultsPromise = Promise.allSettled([raw, req.getRawBody(), req.body]);
    const failure = new Error('fixture read failure');
    native.emit(event, failure);
    const results = await bounded(resultsPromise);
    assert(results.every((result) => result.status === 'rejected'));
    assert(results.every((result) => result.reason === results[0].reason));
    assert(native.listeners(event).includes(appListener));
    assert.equal(native.listenerCount('data'), 0);
    if (event === 'error') assert.strictEqual(results[0].reason, failure);
    else assert.equal(results[0].reason.statusCode, 400);
    native.destroy();
  });
}

runner.test('Total read deadline rejects stalled senders and remains cached', async () => {
  const { req, native } = fixture();
  req.bodyTimeout = 25;
  const raw = req.getRawBody();
  const resultsPromise = Promise.allSettled([raw, req.body]);
  native.write('x');
  const results = await bounded(resultsPromise);
  assert(results.every((result) => result.status === 'rejected'));
  assert(errorCode('BODY_TIMEOUT', 408)(results[0].reason));
  assert.strictEqual(results[0].reason, results[1].reason);
  assert.strictEqual(req.getRawBody(), raw);
  assert.equal(native.listenerCount('data'), 0);
  native.destroy();
});

runner.test('Invalid size/deadline settings reject before listening and cannot disable bounds', async () => {
  for (const key of ['bodyLimit', 'bodyTimeout']) {
    const invalid = [NaN, Infinity, -1, 1.5, '100', Number.MAX_SAFE_INTEGER + 1];
    if (key === 'bodyTimeout') invalid.push(0, 2147483648);
    for (const value of invalid) {
      const { req, native } = fixture();
      req[key] = value;
      await assert.rejects(bounded(req.getRawBody()), TypeError);
      assert.equal(native.listenerCount('data'), 0);
    }
  }
});

runner.test('Already consumed, partially consumed, destroyed and errored streams reject promptly', async () => {
  const consumed = fixture();
  consumed.native.resume();
  const ended = once(consumed.native, 'end');
  consumed.native.end('previously consumed');
  await bounded(ended);
  await assert.rejects(bounded(consumed.req.getRawBody()), errorCode('BODY_ALREADY_CONSUMED', 400));

  const partial = fixture();
  const data = once(partial.native, 'data');
  partial.native.write('already consumed prefix');
  await bounded(data);
  await assert.rejects(bounded(partial.req.getRawBody()), errorCode('BODY_ALREADY_CONSUMED', 400));
  partial.native.destroy();

  const destroyed = fixture();
  destroyed.native.destroy();
  await assert.rejects(bounded(destroyed.req.getRawBody()), errorCode('BODY_STREAM_CLOSED', 400));

  const errored = fixture();
  const failure = new Error('fixture terminal error');
  errored.native.on('error', () => {});
  errored.native.destroy(failure);
  await assert.rejects(bounded(errored.req.getRawBody()), (error) => error === failure);
});

runner.test('An already ended empty stream is cached as an empty buffer', async () => {
  const { req, native } = fixture();
  native.resume();
  const ended = once(native, 'end');
  native.end();
  await bounded(ended);
  assert.equal((await bounded(req.getRawBody())).length, 0);
  assert.equal(await bounded(req.body), null);
});

runner.test('Middleware-preserved bytes are reused; consumed bytes are never reconstructed', async () => {
  const { req, native } = fixture('', 'application/json');
  native.resume();
  const ended = once(native, 'end');
  native.end('{"ok":true}');
  await bounded(ended);
  req.rawBody = Buffer.from('{"ok":true}');
  assert.strictEqual(await bounded(req.getRawBody()), req.rawBody);
  assert.deepEqual(await bounded(req.body), { ok: true });

  const oversized = fixture();
  oversized.req.bodyLimit = 1;
  oversized.req.rawBody = Buffer.from('ab');
  await assert.rejects(bounded(oversized.req.getRawBody()), errorCode('BODY_SIZE_LIMIT', 413));
});

runner.test('Actual HTTP routes send query getter failures through error handling', async () => {
  for (const fullPath of [false, true]) {
    const original = Object.getOwnPropertyDescriptor(Object.prototype, 'p8Http');
    const app = new Router();
    if (fullPath) app.use((req, res, next) => next());
    app.get('/query', (req, res) => res.json(req.query));
    const server = await createTestServer(app);
    try {
      for (const [suffix, status] of [['a[]=x&a[__proto__][__proto__][p8Http]=true', 400],
        ['a[10001]=x', 400], ['x=1&'.repeat(1000) + 'x=1', 413]]) {
        const response = await bounded(makeRequest({ hostname: '127.0.0.1', port: server.port,
          path: '/query?' + suffix, method: 'GET' }));
        assert.equal(response.statusCode, status, `fullPath=${fullPath}`);
      }
      assert.deepEqual(Object.getOwnPropertyDescriptor(Object.prototype, 'p8Http'), original);
    } finally {
      restoreOwn(Object.prototype, 'p8Http', original);
      await bounded(server.close());
    }
  }
});

runner.test('Actual HTTP standalone body and middleware/raw interaction settle consistently', async () => {
  for (const middleware of [false, true]) {
    const app = new Router();
    if (middleware) app.use(bodyParser({ preserveRawBody: true }));
    app.post('/body', async (req, res) => {
      const [body, raw] = await Promise.all([req.body, req.getRawBody()]);
      res.json({ body, raw: raw.toString() });
    });
    const server = await createTestServer(app);
    try {
      for (const payload of ['', 'null', '{"ok":true}']) {
        const response = await bounded(makeRequest({ hostname: '127.0.0.1', port: server.port,
          path: '/body', method: 'POST', headers: { 'content-type': 'application/json' } }, payload));
        assert.equal(response.statusCode, 200);
        const result = JSON.parse(response.body);
        assert.deepEqual(result.body, payload ? JSON.parse(payload) : null);
        assert.equal(result.raw, payload);
      }
    } finally {
      await bounded(server.close());
    }
  }
});

runner.test('Actual HTTP rejects standalone URL-encoded pollution and consumed middleware rereads', async () => {
  for (const middleware of [false, true]) {
    const original = Object.getOwnPropertyDescriptor(Object.prototype, 'p8HttpBody');
    const app = new Router();
    if (middleware) app.use(bodyParser());
    app.post('/body', async (req, res) => {
      const value = middleware ? await req.getRawBody() : await req.body;
      res.json(value);
    });
    const server = await createTestServer(app);
    try {
      const response = await bounded(makeRequest({ hostname: '127.0.0.1', port: server.port,
        path: '/body', method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' } },
      middleware ? 'safe=value' : 'a[]=x&a[__proto__][__proto__][p8HttpBody]=true'));
      assert.equal(response.statusCode, 400);
      assert.deepEqual(Object.getOwnPropertyDescriptor(Object.prototype, 'p8HttpBody'), original);
    } finally {
      restoreOwn(Object.prototype, 'p8HttpBody', original);
      await bounded(server.close());
    }
  }
});

runner.test('Actual HTTP client disconnect rejects raw and parsed waiters without crashing', async () => {
  const app = new Router();
  let client;
  let observe;
  const observed = new Promise((resolve) => { observe = resolve; });
  app.post('/abort', async (req, res) => {
    req.nativeRequest.once('data', () => client.destroy());
    const results = await Promise.allSettled([req.getRawBody(), req.body]);
    observe(results);
    res.end();
  });
  const server = await createTestServer(app);
  try {
    client = http.request({ hostname: '127.0.0.1', port: server.port, path: '/abort',
      method: 'POST', headers: { 'content-type': 'text/plain', 'transfer-encoding': 'chunked' } });
    client.on('error', () => {}); // The intentional disconnect is the assertion fixture.
    client.write('prefix');
    const results = await bounded(observed);
    assert(results.every((result) => result.status === 'rejected'));
    assert.equal(results[0].reason.statusCode, 400);
    assert.strictEqual(results[0].reason, results[1].reason);
  } finally {
    if (client) client.destroy();
    await bounded(server.close());
  }
});

runner.test('Transferred proxy and signed-cookie behavior stays intact', () => {
  const { req, native } = fixture();
  native.headers['x-forwarded-for'] = '198.51.100.5';
  native.headers['x-forwarded-proto'] = 'https';
  assert.equal(req.ip, '127.0.0.1');
  assert.equal(req.protocol, 'http');
  req.trustProxy = (peer) => peer === '127.0.0.1';
  assert.equal(req.ip, '198.51.100.5');
  assert.equal(req.protocol, 'https');
  assert.throws(() => { req.trustProxy = 'true'; }, TypeError);

  const value = 'a+b';
  const secret = crypto.randomBytes(32).toString('hex');
  const signature = crypto.createHmac('sha256', secret).update(value).digest('base64url');
  native.headers.cookie = `literal=a+b; duplicate=first; duplicate=last; signed=${encodeURIComponent(value + '.' + signature)}`;
  req.cookieSecret = secret;
  assert.equal(req.cookies.literal, 'a+b');
  assert.equal(req.cookies.duplicate, 'first');
  assert.equal(req.signedCookies.signed, value);
});

const run = process.argv[2] === '--pollution'
  ? pollutionChild(process.argv[3]).then(() => true)
  : runner.run();
run.then((success) => {
  clearTimeout(outerGuard);
  process.exit(success ? 0 : 1);
}, (error) => {
  clearTimeout(outerGuard);
  console.error(error);
  process.exit(1);
});
