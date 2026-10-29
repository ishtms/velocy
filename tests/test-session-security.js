const nodeAssert = require('node:assert/strict');
const crypto = require('node:crypto');
const { TestRunner, createTestServer, makeRequest } = require('./test-helper');
const { Router, session, cookieParser, compression } = require('../index');
const zlib = require('node:zlib');
const http = require('node:http');
const { Writable } = require('node:stream');
const Request = require('../lib/core/Request');
const Response = require('../lib/core/Response');

const runner = new TestRunner('Session security tests');
// Ephemeral test-only signing material; never production credentials.
const secret = crypto.randomBytes(32).toString('hex');

async function fixture(options, run, routerOptions = {}) {
  const store = options.store || new session.MemoryStore({ checkPeriod: 0 });
  const app = new Router(routerOptions);
  if (options.compressionOrder === 'first') app.use(compression({ threshold: options.compressionThreshold ?? 0 }));
  app.use(session({ secret, store, ...options }));
  if (options.compressionOrder === 'last') app.use(compression({ threshold: options.compressionThreshold ?? 0 }));
  app.get('/state', (req, res) => {
    req.session.counter = (req.session.counter || 0) + 1;
    res.json({ id: req.sessionID, counter: req.session.counter, user: req.session.user });
  });
  app.get('/nested', (req, res) => {
    if (req.session.user) req.session.user.count++;
    else req.session.user = { count: 1 };
    res.json({ count: req.session.user.count });
  });
  app.get('/rotate', (req, res) => req.session.regenerate(err => {
    res.json({ failed: !!err, id: req.sessionID, user: req.session.user });
  }));
  app.get('/logout', (req, res) => req.session.destroy(err => res.json({ failed: !!err })));
  app.get('/logout-no-callback', (req, res) => {
    req.session.destroy();
    res.send('logged out');
  });
  app.get('/read', (req, res) => res.json({ id: req.sessionID, isNew: req.session.isNew() }));
  const server = await createTestServer(app);
  const request = (path = '/state', cookie, headers = {}) => makeRequest({
    hostname: '127.0.0.1', port: server.port, path, method: 'GET',
    headers: { ...headers, ...(cookie ? { Cookie: cookie.split(';')[0] } : {}) }
  });
  try { await run({ request, store, app, port: server.port }); }
  finally { await server.close(); store.stopCleanup?.(); }
}

function text(response) {
  return response.headers['content-encoding'] === 'gzip'
    ? zlib.gunzipSync(response.buffer).toString() : response.body;
}

// Store operations advance only when the test explicitly releases them. A
// referenced deadline prevents hangs without depending on millisecond races.
function hold(store, method) {
  const original = store[method].bind(store);
  const queued = [];
  const held = new Set();
  let notify;
  store[method] = (...args) => {
    const callback = args.pop();
    const operation = {
      release(error) {
        if (!held.delete(operation)) return;
        if (error) callback(error);
        else original(...args, callback);
      }
    };
    held.add(operation);
    queued.push(operation);
    notify?.();
  };
  return {
    async take() {
      if (!queued.length) await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { notify = null; reject(new Error(`No queued ${method} operation`)); }, 3000);
        notify = () => { clearTimeout(timer); notify = null; resolve(); };
      });
      return queued.shift();
    },
    restore() { store[method] = original; },
    cleanup() {
      store[method] = original;
      for (const operation of held) operation.release(new Error('fixture cleanup'));
    }
  };
}

function bounded(promise, name) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${name} did not complete`)), 4000);
    promise.then(value => { clearTimeout(timer); resolve(value); }, err => { clearTimeout(timer); reject(err); });
  });
}

function endOverload(res, overload, callback) {
  if (overload === 0) return res.end(callback);
  if (overload === 1) return res.end('SUCCESS must not escape', callback);
  // The replacement body is UTF-8, not the encoding of the discarded payload.
  return res.end('SUCCESS must not escape', 'utf16le', callback);
}

function captureAbort(port, cookie) {
  let incoming;
  let request;
  let resolveStarted;
  const started = new Promise(resolve => { resolveStarted = resolve; });
  const done = new Promise((resolve, reject) => {
    const chunks = [];
    let ended = false;
    let error;
    const timer = setTimeout(() => { request.destroy(); incoming?.destroy(); reject(new Error('Abort HTTP fixture deadline')); }, 4000);
    const finish = () => {
      clearTimeout(timer);
      resolve({ complete: incoming?.complete || false, ended, error,
        headers: incoming?.headers || {}, body: Buffer.concat(chunks) });
    };
    request = http.get({ hostname: '127.0.0.1', port, path: '/end-abort', agent: false,
      headers: { Cookie: cookie.split(';')[0], 'accept-encoding': 'gzip' } }, res => {
      incoming = res;
      resolveStarted();
      res.on('data', data => chunks.push(data));
      res.on('end', () => { ended = true; });
      res.on('error', err => { error = err; });
      res.on('close', finish);
    });
    request.on('error', err => { error = err; if (!incoming) finish(); });
  });
  return { started, done, abort() { incoming?.destroy(); request.destroy(); } };
}

for (const order of ['none', 'first', 'last']) {
  for (const overload of [0, 1, 2]) {
    runner.test(`Successful end callback ${overload} retains payload/encoding and settles once (compression=${order})`, async () => {
      let calls = 0;
      await fixture({ compressionOrder: order }, async ({ request, store, app }) => {
        const saves = hold(store, 'set');
        let complete;
        const completed = new Promise(resolve => { complete = resolve; });
        app.get('/end-success', (req, res) => {
          req.session.user = { id: 1 };
          res.type('text');
          endOverload(res, overload, err => {
            calls++;
            complete({ err, finished: res._nativeResponse.writableFinished });
          });
        });
        const pending = request('/end-success', null, { 'accept-encoding': 'gzip' });
        try {
          const operation = await saves.take();
          nodeAssert.equal(calls, 0);
          operation.release();
          const result = await pending;
          const completion = await bounded(completed, 'successful end callback');
          const body = result.headers['content-encoding'] === 'gzip' ? zlib.gunzipSync(result.buffer) : result.buffer;
          const expected = overload === 0 ? Buffer.alloc(0)
            : Buffer.from('SUCCESS must not escape', overload === 2 ? 'utf16le' : 'utf8');
          nodeAssert.equal(result.statusCode, 200);
          nodeAssert.deepEqual(body, expected);
          nodeAssert.ok(result.headers['set-cookie']);
          nodeAssert.equal(completion.err == null, true);
          nodeAssert.equal(completion.finished, true);
        } finally { saves.cleanup(); await pending; }
      });
      nodeAssert.equal(calls, 1);
    });
  }

  for (const mode of ['auto-save', 'explicit-save', 'destroy', 'regenerate', 'chain-destroy', 'chain-regenerate']) {
    for (const overload of [0, 1, 2]) {
      runner.test(`End callback ${overload}: ${mode} failure completes replacement once (compression=${order})`, async () => {
        let calls = 0;
        await fixture({ compressionOrder: order }, async ({ request, store, app }) => {
          const initial = await request('/state', null, { 'accept-encoding': 'gzip' });
          const saves = hold(store, 'set');
          const revocations = hold(store, 'destroy');
          let response;
          let complete;
          const completed = new Promise(resolve => { complete = resolve; });
          app.get('/end-failure', (req, res) => {
            response = res;
            req.session.user = { id: 1 };
            if (mode === 'explicit-save') req.session.save();
            else if (mode === 'destroy' || mode === 'regenerate') req.session[mode]();
            else if (mode.startsWith('chain-')) req.session.save(err => {
              if (!err) req.session[mode.slice(6)]();
            });
            res.type('text');
            endOverload(res, overload, err => {
              calls++;
              complete({ err, finished: res._nativeResponse.writableFinished });
            });
          });
          const pending = request('/end-failure', initial.headers['set-cookie'][0], { 'accept-encoding': 'gzip' });
          try {
            let operation;
            if (mode.startsWith('chain-')) {
              (await saves.take()).release();
              operation = await revocations.take();
            } else operation = await (mode === 'destroy' || mode === 'regenerate' ? revocations : saves).take();
            nodeAssert.equal(calls, 0, 'a pending operation is not response completion');
            nodeAssert.equal(response._nativeResponse.writableFinished, false);
            operation.release(new Error('fixture persistence failure'));
            const result = await pending;
            const completion = await bounded(completed, 'replacement end callback');
            nodeAssert.equal(result.statusCode, 500);
            nodeAssert.equal(text(result), 'Session error');
            nodeAssert.equal(result.headers['set-cookie'], undefined);
            nodeAssert.equal(completion.err == null, true, 'HTTP 500 still completed transport normally');
            nodeAssert.equal(completion.finished, true, 'callback must await actual response completion');
            nodeAssert.equal(calls, 1);
          } finally { saves.cleanup(); revocations.cleanup(); await pending; }
        });
        nodeAssert.equal(calls, 1, 'finish, close and native callbacks must not duplicate completion');
      });
    }
  }

  for (const trigger of ['store-failure', 'client-close']) {
    for (const overload of [0, 1, 2]) {
      runner.test(`End callback ${overload}: ${trigger} abort settles once (compression=${order})`, async () => {
        let calls = 0;
        await fixture({ compressionOrder: order }, async ({ request, store, app, port }) => {
          const initial = await request('/state', null, { 'accept-encoding': 'gzip' });
          const saves = hold(store, 'set');
          let response;
          let complete;
          const completed = new Promise(resolve => { complete = resolve; });
          app.get('/end-abort', (req, res) => {
            response = res;
            req.session.user = { id: 1 };
            res.type('text').write('already committed prefix');
            res._nativeResponse.flushHeaders();
            endOverload(res, overload, err => {
              calls++;
              complete({ err, finished: res._nativeResponse.writableFinished, closed: res._nativeResponse.closed });
            });
          });
          const capture = captureAbort(port, initial.headers['set-cookie'][0]);
          try {
            const operation = await saves.take();
            await bounded(capture.started, 'committed response headers');
            nodeAssert.equal(calls, 0);
            if (trigger === 'client-close') {
              capture.abort();
              const completion = await bounded(completed, 'client abort callback');
              nodeAssert.ok(completion.err);
              nodeAssert.equal(completion.closed, true);
              nodeAssert.equal(calls, 1, 'client abort can finish before the pending store callback');
            }
            operation.release(new Error('fixture persistence failure'));
            const result = await capture.done;
            const completion = await bounded(completed, 'aborted end callback');
            nodeAssert.ok(completion.err);
            nodeAssert.equal(completion.finished, false);
            nodeAssert.equal(completion.closed, true, 'callback must await the real close event');
            nodeAssert.equal(response._nativeResponse.destroyed, true);
            nodeAssert.equal(response._nativeResponse.writableEnded, false);
            nodeAssert.equal(result.complete, false);
            nodeAssert.equal(result.ended, false);
            nodeAssert.equal(result.headers['set-cookie'], undefined);
            nodeAssert.equal(result.body.includes(Buffer.from('Session error')), false);
            nodeAssert.equal(result.body.includes(Buffer.from('SUCCESS')), false);
            nodeAssert.equal(calls, 1);
          } finally { saves.cleanup(); capture.abort(); await capture.done; }
        });
        nodeAssert.equal(calls, 1);
      });
    }
  }

  runner.test(`Replacement callback stays pending until a gated transport actually finishes (compression=${order})`, async () => {
    let release;
    let signal;
    const entered = new Promise(resolve => { signal = resolve; });
    const chunks = [];
    const native = new Writable({
      write(data, encoding, callback) { chunks.push(Buffer.from(data)); callback(); },
      final(callback) { release = callback; signal(); }
    });
    native.headersSent = false;
    native.statusCode = 200;
    const headers = {};
    native.getHeaders = () => ({ ...headers });
    native.getHeader = name => headers[name.toLowerCase()];
    native.setHeader = (name, value) => { headers[name.toLowerCase()] = value; };
    native.removeHeader = name => { delete headers[name.toLowerCase()]; };
    native.writeHead = (status, values) => { native.statusCode = status; Object.assign(headers, values); native.headersSent = true; };
    const req = { method: 'GET', headers: { 'accept-encoding': 'gzip' }, cookies: {}, socket: { remoteAddress: '127.0.0.1' } };
    const res = new Response(native);
    const store = new session.MemoryStore({ checkPeriod: 0 });
    store.set = (_id, _data, callback) => callback(new Error('fixture write failed'));
    const layers = [session({ secret, store })];
    if (order === 'first') layers.unshift(compression({ threshold: 0 }));
    if (order === 'last') layers.push(compression({ threshold: 0 }));
    let calls = 0;
    let resolve;
    const completed = new Promise(done => { resolve = done; });
    const next = () => {
      const layer = layers.shift();
      if (layer) layer(req, res, next);
      else res.end('SUCCESS', err => { calls++; resolve({ err, finished: native.writableFinished }); });
    };
    try {
      next();
      await bounded(entered, 'gated replacement final');
      nodeAssert.equal(calls, 0, 'invoking replacement end is not completion');
      nodeAssert.equal(native.writableFinished, false);
      release();
      const completion = await bounded(completed, 'gated replacement completion');
      nodeAssert.equal(completion.finished, true);
      nodeAssert.equal(completion.err == null, true);
      nodeAssert.equal(calls, 1);
      nodeAssert.equal(native.statusCode, 500);
      nodeAssert.equal(headers['set-cookie'], undefined);
      const body = Buffer.concat(chunks);
      nodeAssert.equal((headers['content-encoding'] === 'gzip' ? zlib.gunzipSync(body) : body).toString(), 'Session error');
    } finally { native.destroy(); }
  });
}

for (const order of ['first', 'last']) {
  for (const fails of [false, true]) {
    runner.test(`Compression ${order}: delayed ${fails ? 'failed' : 'successful'} save retains session barrier`, async () => {
      await fixture({ compressionOrder: order }, async ({ request, store, app }) => {
        const gate = hold(store, 'set');
        let response;
        app.get('/gated', (req, res) => {
          response = res;
          req.session.user = { id: 1 };
          res.status(201).send('authenticated');
        });
        const pending = request('/gated', null, { 'accept-encoding': 'gzip' });
        try {
          const operation = await gate.take();
          nodeAssert.equal(response._nativeResponse.writableEnded, false);
          nodeAssert.equal(response._nativeResponse.headersSent, false);
          operation.release(fails ? new Error('write failed') : undefined);
          const result = await pending;
          nodeAssert.equal(result.statusCode, fails ? 500 : 201);
          nodeAssert.equal(text(result), fails ? 'Session error' : 'authenticated');
          nodeAssert.equal(!!result.headers['set-cookie'], !fails);
          nodeAssert.equal(store.sessions.size, fails ? 0 : 1);
        } finally { gate.cleanup(); await pending; }
      });
    });

    runner.test(`Compression ${order}: delayed ${fails ? 'failed' : 'successful'} logout waits for revocation`, async () => {
      await fixture({ compressionOrder: order }, async ({ request, store, app }) => {
        const first = await request('/state', null, { 'accept-encoding': 'gzip' });
        const id = JSON.parse(text(first)).id;
        const gate = hold(store, 'destroy');
        let response;
        app.get('/gated-logout', (req, res) => {
          response = res;
          req.session.destroy();
          res.send('logged out');
        });
        const pending = request('/gated-logout', first.headers['set-cookie'][0], { 'accept-encoding': 'gzip' });
        try {
          const operation = await gate.take();
          nodeAssert.equal(response._nativeResponse.writableEnded, false);
          nodeAssert.equal(response._nativeResponse.headersSent, false);
          operation.release(fails ? new Error('revocation failed') : undefined);
          const result = await pending;
          nodeAssert.equal(result.statusCode, fails ? 500 : 200);
          nodeAssert.equal(text(result), fails ? 'Session error' : 'logged out');
          nodeAssert.equal(store.sessions.has(id), fails);
          if (fails) nodeAssert.equal(result.headers['set-cookie'], undefined);
          else nodeAssert.match(result.headers['set-cookie'][0], /Expires=Thu, 01 Jan 1970/);
        } finally { gate.cleanup(); await pending; }
      });
    });
  }
}

for (const transition of ['destroy', 'regenerate']) {
  for (const fails of [false, true]) {
    runner.test(`Save callback chains ${transition}; finalization waits for ${fails ? 'failure' : 'success'}`, async () => {
      await fixture({}, async ({ request, store, app }) => {
        const first = await request();
        const cookie = first.headers['set-cookie'][0];
        const oldId = JSON.parse(first.body).id;
        const saves = hold(store, 'set');
        const revocations = hold(store, 'destroy');
        let response;
        app.get('/chain', (req, res) => {
          response = res;
          req.session.save(err => { if (!err) req.session[transition](); });
          res.send('transition complete');
        });
        const pending = request('/chain', cookie);
        try {
          (await saves.take()).release();
          const revocation = await revocations.take();
          nodeAssert.equal(response._nativeResponse.writableEnded, false);
          nodeAssert.equal(response._nativeResponse.headersSent, false);
          revocation.release(fails ? new Error('revocation failed') : undefined);
          if (!fails && transition === 'regenerate') {
            const finalSave = await saves.take();
            nodeAssert.equal(response._nativeResponse.writableEnded, false);
            finalSave.release();
          }
          const result = await pending;
          nodeAssert.equal(result.statusCode, fails ? 500 : 200);
          nodeAssert.equal(result.body, fails ? 'Session error' : 'transition complete');
          nodeAssert.equal(store.sessions.has(oldId), fails);
          if (fails) nodeAssert.equal(result.headers['set-cookie'], undefined);
        } finally { saves.cleanup(); revocations.cleanup(); await pending; }
      });
    });
  }
}

runner.test('Synchronous nested operation callbacks finish before queued response serialization', async () => {
  await fixture({}, async ({ request, store, app }) => {
    const saves = hold(store, 'set');
    app.get('/sync-chain', (req, res) => {
      req.session.user = { finished: false };
      req.session.save(err => {
        if (err) return;
        req.session.save();
        req.session.user.finished = true;
      });
      res.send('complete');
    });
    const pending = request('/sync-chain');
    try {
      const operation = await saves.take();
      saves.restore();
      operation.release();
      nodeAssert.equal((await pending).statusCode, 200);
      nodeAssert.equal([...store.sessions.values()][0].user.finished, true);
    } finally { saves.cleanup(); await pending; }
  });
});

runner.test('Rejected overlapping logout remains failed after a pending save succeeds', async () => {
  await fixture({}, async ({ request, store, app }) => {
    const first = await request();
    const gate = hold(store, 'set');
    let rejected = false;
    app.get('/overlap', (req, res) => {
      req.session.save();
      req.session.destroy(err => { rejected = !!err; });
      res.send('logged out');
    });
    const pending = request('/overlap', first.headers['set-cookie'][0]);
    try {
      (await gate.take()).release();
      const result = await pending;
      nodeAssert.equal(rejected, true);
      nodeAssert.equal(result.statusCode, 500);
      nodeAssert.equal(result.body, 'Session error');
      nodeAssert.equal(result.headers['set-cookie'], undefined);
      nodeAssert.equal(store.sessions.size, 1);
    } finally { gate.cleanup(); await pending; }
  });
});

runner.test('Session failure removes all header casing variants, including native staged headers', async () => {
  await fixture({}, async ({ request, store, app }) => {
    store.set = (_id, _data, cb) => setImmediate(() => cb(new Error('write failed')));
    app.get('/headers-failure', (req, res) => {
      res.set({ 'set-cookie': 'auth=unsafe', 'LoCaTiOn': '/authenticated',
        'content-encoding': 'br', 'AUTHORIZATION': 'Bearer fixture-only',
        'CoNtEnT-LeNgTh': '1000', 'authentication-info': 'fixture-only' });
      res.append('SET-cookie', 'other=unsafe');
      res._nativeResponse.setHeader('PrOxY-AuThOrIzAtIoN', 'fixture-only');
      // Legacy code may manipulate _headers directly; cleanup must still remove it.
      res._headers['SET-COOKIE'] = 'legacy=unsafe';
      res.send('authenticated');
    });
    const result = await request('/headers-failure');
    nodeAssert.equal(result.statusCode, 500);
    nodeAssert.equal(result.body, 'Session error');
    for (const header of ['set-cookie', 'location', 'content-encoding', 'authorization',
      'authentication-info', 'proxy-authorization']) nodeAssert.equal(result.headers[header], undefined);
    nodeAssert.equal(result.headers['content-length'], String(Buffer.byteLength('Session error')));
    nodeAssert.equal(result.headers['cache-control'], 'no-store');
  });
});

for (const order of ['first', 'last']) {
  runner.test(`Compression ${order}: discard buffered success bytes and stale headers on session failure`, async () => {
    await fixture({ compressionOrder: order, compressionThreshold: 4096 }, async ({ request, store, app }) => {
      store.set = (_id, _data, cb) => setImmediate(() => cb(new Error('write failed')));
      app.get('/buffered-failure', (req, res) => {
        res.set({ 'content-encoding': 'br', 'set-cookie': 'auth=unsafe', location: '/private' });
        res.write('private prefix');
        res.send('private success');
      });
      const result = await request('/buffered-failure', null, { 'accept-encoding': 'gzip' });
      nodeAssert.equal(result.statusCode, 500);
      nodeAssert.equal(text(result), 'Session error');
      nodeAssert.notEqual(result.headers['content-encoding'], 'br');
      nodeAssert.equal(result.headers['set-cookie'], undefined);
      nodeAssert.equal(result.headers.location, undefined);
    });
  });
}

function signed(id) {
  return `${id}.${crypto.createHmac('sha256', secret).update(id).digest('base64url')}`;
}

runner.test('Untrusted forwarding headers cannot spoof IP or protocol', () => {
  const req = new Request({ headers: {
    'x-forwarded-for': '198.51.100.10', 'x-real-ip': '198.51.100.11',
    'x-forwarded-proto': 'https'
  }, socket: { remoteAddress: '127.0.0.1' } });
  nodeAssert.equal(req.ip, '127.0.0.1');
  nodeAssert.equal(req.protocol, 'http');
  nodeAssert.equal(req.secure, false);
  req.trustProxy = peer => peer === '127.0.0.1';
  nodeAssert.equal(req.ip, '198.51.100.10');
  nodeAssert.equal(req.protocol, 'https');
  req.trustProxy = () => false;
  nodeAssert.equal(req.ip, '127.0.0.1');
  nodeAssert.equal(req.protocol, 'http');
});

runner.test('Unknown forwarded protocols cannot replace a TLS socket protocol', () => {
  const req = new Request({ headers: { 'x-forwarded-proto': 'javascript' },
    socket: { remoteAddress: '127.0.0.1', encrypted: true } });
  req.trustProxy = true;
  nodeAssert.equal(req.protocol, 'https');
});

runner.test('Session proxy trust is opt-in and reevaluated per request', async () => {
  await fixture({}, async ({ request }) => {
    const response = await request('/state', null, { 'x-forwarded-proto': 'https' });
    nodeAssert.doesNotMatch(response.headers['set-cookie'][0], /; Secure/);
  });
  await fixture({ proxy: peer => peer === '127.0.0.1' || peer === '::ffff:127.0.0.1' }, async ({ request }) => {
    const first = await request('/state', null, { 'x-forwarded-proto': 'https' });
    nodeAssert.match(first.headers['set-cookie'][0], /; Secure/);
    const second = await request('/state', first.headers['set-cookie'][0], { 'x-forwarded-proto': 'http' });
    nodeAssert.doesNotMatch(second.headers['set-cookie'][0], /; Secure/);
    nodeAssert.equal(JSON.parse(second.body).counter, 2);
    const third = await request('/state', second.headers['set-cookie'][0], { 'x-forwarded-proto': 'https' });
    nodeAssert.match(third.headers['set-cookie'][0], /; Secure/);
  });
});

runner.test('Fingerprinting ignores spoofed forwarding headers by default', async () => {
  await fixture({ fingerprint: true }, async ({ request }) => {
    const first = await request('/state', null, { 'x-forwarded-for': '198.51.100.1' });
    const second = await request('/state', first.headers['set-cookie'][0], { 'x-forwarded-for': '198.51.100.2' });
    nodeAssert.equal(JSON.parse(second.body).counter, 2);
  });
});

runner.test('Fingerprinting accepts X-Real-IP only with explicit proxy trust', async () => {
  for (const proxy of [false, true]) {
    await fixture({ fingerprint: true, proxy }, async ({ request }) => {
      const first = await request('/state', null, { 'x-real-ip': '198.51.100.1' });
      const second = await request('/state', first.headers['set-cookie'][0], { 'x-real-ip': '198.51.100.2' });
      nodeAssert.equal(JSON.parse(second.body).counter, proxy ? 1 : 2);
    });
  }
});

runner.test('Nested session edits persist without top-level assignment', async () => {
  await fixture({ saveUninitialized: false }, async ({ request }) => {
    const first = await request('/nested');
    const cookie = first.headers['set-cookie'][0];
    nodeAssert.equal(JSON.parse((await request('/nested', cookie)).body).count, 2);
    nodeAssert.equal(JSON.parse((await request('/nested', cookie)).body).count, 3);
  });
});

runner.test('Fixed expiry survives writes while rolling expiry explicitly renews', async () => {
  for (const rolling of [false, true]) {
    const day = 24 * 60 * 60 * 1000;
    await fixture({ rolling, cookie: { maxAge: day } }, async ({ request, store }) => {
      const first = await request();
      const id = JSON.parse(first.body).id;
      const oldExpiry = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      store.sessions.get(id).cookie.expires = oldExpiry;
      const second = await request('/state', first.headers['set-cookie'][0]);
      nodeAssert.equal(second.statusCode, 200);
      const expiry = store.sessions.get(id).cookie.expires;
      if (rolling) nodeAssert.ok(new Date(expiry).getTime() > Date.now() + 23 * 60 * 60 * 1000);
      else {
        nodeAssert.equal(expiry, oldExpiry);
        const age = Number(second.headers['set-cookie'][0].match(/Max-Age=(-?\d+)/)[1]);
        nodeAssert.ok(age >= 3500 && age <= 3600);
      }
    });
  }
});

runner.test('Uninitialized sessions are not saved and loaded sessions report isNew=false', async () => {
  await fixture({ saveUninitialized: false }, async ({ request, store }) => {
    const untouched = await request('/read');
    nodeAssert.equal(untouched.headers['set-cookie'], undefined);
    nodeAssert.equal(store.sessions.size, 0);
    nodeAssert.equal(JSON.parse(untouched.body).isNew, true);
    const created = await request();
    const loaded = await request('/read', created.headers['set-cookie'][0]);
    nodeAssert.equal(JSON.parse(loaded.body).isNew, false);
    nodeAssert.equal(loaded.headers['set-cookie'], undefined);
  });
});

runner.test('In-flight requests cannot resurrect a MemoryStore session after logout', async () => {
  await fixture({}, async ({ request, store, app }) => {
    let release;
    let entered;
    const waiting = new Promise(resolve => { release = resolve; });
    const started = new Promise(resolve => { entered = resolve; });
    app.get('/stale', async (req, res) => {
      entered();
      await waiting;
      req.session.user = { role: 'admin' };
      res.send('updated');
    });
    const first = await request();
    const id = JSON.parse(first.body).id;
    const cookie = first.headers['set-cookie'][0];
    const stale = request('/stale', cookie);
    try {
      await started;
      nodeAssert.equal((await request('/logout', cookie)).statusCode, 200);
    } finally { release(); }
    nodeAssert.equal((await stale).statusCode, 500);
    nodeAssert.equal(store.sessions.has(id), false);
  });
});

runner.test('Store read errors and malformed records do not leak diagnostics', async () => {
  for (const result of ['error', 'malformed']) {
    const store = new session.MemoryStore({ checkPeriod: 0 });
    store.get = (_id, cb) => setImmediate(() => result === 'error'
      ? cb(new Error('private backend diagnostic'))
      : cb(null, { cookie: { originalMaxAge: 'invalid' } }));
    await fixture({ store }, async ({ request }) => {
      const response = await request('/state', `connect.sid=${encodeURIComponent(signed('record'))}`);
      nodeAssert.equal(response.statusCode, 500);
      nodeAssert.doesNotMatch(response.body, /private backend diagnostic|originalMaxAge/);
      nodeAssert.equal(response.headers['set-cookie'], undefined);
    });
  }
});

runner.test('Explicit save failures are not hidden by automatic response completion', async () => {
  await fixture({}, async ({ request, store, app }) => {
    let writes = 0;
    store.set = (_id, _data, cb) => { writes++; setImmediate(() => cb(new Error('write failed'))); };
    app.get('/save', (req, res) => {
      req.session.user = { id: 1 };
      req.session.save();
      res.send('success');
    });
    const response = await request('/save');
    nodeAssert.equal(response.statusCode, 500);
    nodeAssert.equal(response.body, 'Session error');
    nodeAssert.equal(writes, 1);
  });
});

runner.test('Circular session values fail closed instead of crashing response completion', async () => {
  await fixture({}, async ({ request, app }) => {
    app.get('/circular', (req, res) => {
      const value = {};
      value.self = value;
      req.session.value = value;
      res.send('success');
    });
    const response = await request('/circular');
    nodeAssert.equal(response.statusCode, 500);
    nodeAssert.equal(response.headers['set-cookie'], undefined);
  });
});

runner.test('Invalid cookie configuration cannot commit session data', async () => {
  await fixture({ cookie: { path: '/; SameSite=None' } }, async ({ request, store }) => {
    const response = await request();
    nodeAssert.equal(response.statusCode, 500);
    nodeAssert.equal(response.headers['set-cookie'], undefined);
    nodeAssert.equal(store.sessions.size, 0);
  });
});

runner.test('MemoryStore rejects a stale copy instead of overwriting a newer write', async () => {
  const store = new session.MemoryStore({ checkPeriod: 0 });
  const api = store.promisify();
  await api.set('fixture', { cookie: {}, count: 0 });
  const first = await api.get('fixture');
  const stale = await api.get('fixture');
  first.count = 1;
  await api.set('fixture', first);
  stale.count = 2;
  await nodeAssert.rejects(api.set('fixture', stale), /concurrently modified/);
  nodeAssert.equal((await api.get('fixture')).count, 1);
});

runner.test('Invalid generators fail before revoking an existing session', async () => {
  await fixture({ genid: () => 'same-id' }, async ({ request, store }) => {
    const first = await request();
    const response = await request('/rotate', first.headers['set-cookie'][0]);
    nodeAssert.equal(response.statusCode, 500);
    nodeAssert.ok(store.sessions.has('same-id'));
  });
});

for (const synchronous of [false, true]) {
  runner.test(`Store write ${synchronous ? 'throws' : 'callback errors'} fail closed`, async () => {
    const store = new session.MemoryStore({ checkPeriod: 0 });
    store.set = (_id, _data, callback) => {
      const err = new Error('private backend diagnostic');
      if (synchronous) throw err;
      setImmediate(() => callback(err));
    };
    await fixture({ store }, async ({ request }) => {
      const response = await request();
      nodeAssert.equal(response.statusCode, 500);
      nodeAssert.equal(response.body, 'Session error');
      nodeAssert.equal(response.headers['set-cookie'], undefined);
    });
  });
}

runner.test('Duplicate store callbacks cannot complete a response twice', async () => {
  const store = new session.MemoryStore({ checkPeriod: 0 });
  const set = store.set.bind(store);
  store.set = (id, data, callback) => set(id, data, err => { callback(err); callback(new Error('duplicate')); });
  await fixture({ store }, async ({ request }) => {
    const response = await request();
    nodeAssert.equal(response.statusCode, 200);
    nodeAssert.equal(response.headers['set-cookie'].length, 1);
  });
});

runner.test('Failed regeneration preserves old ID and does not claim success', async () => {
  await fixture({}, async ({ request, store }) => {
    const first = await request();
    const id = JSON.parse(first.body).id;
    store.destroy = (_id, cb) => setImmediate(() => cb(new Error('revocation failed')));
    const response = await request('/rotate', first.headers['set-cookie'][0]);
    nodeAssert.equal(response.statusCode, 500);
    nodeAssert.equal(response.headers['set-cookie'], undefined);
    nodeAssert.ok(store.sessions.has(id));
    nodeAssert.equal(store.sessions.size, 1);
  });
});

runner.test('Successful regeneration revokes old ID and preserves only configured data', async () => {
  let sequence = 0;
  await fixture({ genid: () => `fixture-${++sequence}`, keepOnRegenerate: ['user', 'req', '__proto__'], fingerprint: true }, async ({ request, store }) => {
    const first = await request('/nested');
    const oldCookie = first.headers['set-cookie'][0];
    const rotation = await request('/rotate', oldCookie);
    nodeAssert.equal(rotation.statusCode, 200);
    nodeAssert.equal(JSON.parse(rotation.body).id, 'fixture-2');
    nodeAssert.deepEqual(JSON.parse(rotation.body).user, { count: 1 });
    nodeAssert.equal(store.sessions.has('fixture-1'), false);
    const next = await request('/state', rotation.headers['set-cookie'][0]);
    nodeAssert.equal(JSON.parse(next.body).id, 'fixture-2');
    const replay = await request('/state', oldCookie);
    nodeAssert.notEqual(JSON.parse(replay.body).id, 'fixture-1');
  });
});

runner.test('Logout waits for asynchronous revocation without an explicit callback', async () => {
  await fixture({ cookie: { domain: '.example.com', path: '/account', secure: true } }, async ({ request, store }) => {
    const first = await request();
    const id = JSON.parse(first.body).id;
    const destroy = store.destroy.bind(store);
    store.destroy = (sid, cb) => setTimeout(() => destroy(sid, cb), 15);
    const response = await request('/logout-no-callback', first.headers['set-cookie'][0]);
    nodeAssert.equal(response.statusCode, 200);
    nodeAssert.equal(store.sessions.has(id), false);
    const cookie = response.headers['set-cookie'][0];
    nodeAssert.match(cookie, /Domain=\.example.com/);
    nodeAssert.match(cookie, /Path=\/account/);
    nodeAssert.match(cookie, /; Secure/);
    nodeAssert.match(cookie, /Expires=Thu, 01 Jan 1970/);
  });
});

runner.test('Failed asynchronous logout without callback cannot return success or resurrect data', async () => {
  await fixture({}, async ({ request, store }) => {
    const first = await request();
    store.destroy = (_id, cb) => setTimeout(() => cb(new Error('revocation failed')), 10);
    const response = await request('/logout-no-callback', first.headers['set-cookie'][0]);
    nodeAssert.equal(response.statusCode, 500);
    nodeAssert.equal(response.headers['set-cookie'], undefined);
    nodeAssert.equal(store.sessions.size, 1);
  });
});

runner.test('Cookie hydration preserves absolute expiration and original rolling age', () => {
  const hour = 60 * 60 * 1000;
  const day = 24 * hour;
  const expires = new Date(Date.now() + hour).toISOString();
  const loaded = new session.Session({}, { cookie: { maxAge: day, originalMaxAge: day, expires } });
  nodeAssert.equal(loaded.cookie.expires.toISOString(), expires);
  nodeAssert.equal(loaded.cookie.originalMaxAge, day);
  nodeAssert.ok(loaded.cookie.maxAge <= hour && loaded.cookie.maxAge > 0);
  loaded.cookie.resetMaxAge();
  nodeAssert.ok(loaded.cookie.expires.getTime() > Date.now() + 23 * hour);
  nodeAssert.equal(typeof loaded.toJSON().cookie.expires, 'string');
});

runner.test('Expired and invalid store expirations fail closed, including custom stores', async () => {
  for (const expires of [new Date(0).toISOString(), 'invalid date']) {
    const store = new session.MemoryStore({ checkPeriod: 0 });
    // Deliberately return expired records without TTL enforcement.
    store.get = (_id, cb) => cb(null, { cookie: { expires }, user: { role: 'admin' } });
    await fixture({ store }, async ({ request }) => {
      const response = await request('/state', `connect.sid=${encodeURIComponent(signed('stale'))}`);
      nodeAssert.equal(response.statusCode, 200);
      nodeAssert.equal(JSON.parse(response.body).user, undefined);
      nodeAssert.notEqual(JSON.parse(response.body).id, 'stale');
    });
  }
});

runner.test('Session signatures survive general signed-cookie parsing with the same secret', async () => {
  await fixture({}, async ({ request }) => {
    const first = await request();
    const response = await request('/state', first.headers['set-cookie'][0]);
    nodeAssert.equal(JSON.parse(response.body).counter, 2);
  }, { cookieSecret: secret });
});

runner.test('Tampered and multibyte signatures never load privileged sessions', async () => {
  await fixture({}, async ({ request, store }) => {
    store.sessions.set('privileged', { cookie: {}, user: { role: 'admin' } });
    for (const value of ['privileged.' + 'é'.repeat(43), signed('privileged') + 'x', 'privileged.malformed']) {
      const response = await request('/state', `connect.sid=${encodeURIComponent(value)}`);
      nodeAssert.equal(response.statusCode, 200);
      nodeAssert.equal(JSON.parse(response.body).user, undefined);
    }
  });
});

runner.test('Cookie parsing preserves plus, handles malformed escapes and uses first duplicate', () => {
  const req = new Request({ headers: { cookie: 'value=a+b; bad=%ZZ; value=shadow; __proto__=safe' } });
  nodeAssert.equal(req.cookies.value, 'a+b');
  nodeAssert.equal(req.cookies.bad, '%ZZ');
  nodeAssert.equal(Object.getPrototypeOf(req.cookies), null);
  nodeAssert.equal(req.cookies.__proto__, 'safe');
});

runner.test('Multibyte signed cookies cannot crash timing-safe comparison', () => {
  const req = new Request({ headers: { cookie: `value=data.${encodeURIComponent('é'.repeat(43))}` } }, { _cookieSecret: secret });
  nodeAssert.equal(req.signedCookies.value, undefined);
  nodeAssert.equal(req.cookies.value, 'data.' + 'é'.repeat(43));
});

runner.test('cookieParser(secret) configures lazy request signature verification', () => {
  const req = new Request({ headers: { cookie: `value=${signed('data')}` } });
  cookieParser(secret)(req, {}, () => {});
  nodeAssert.equal(req.signedCookies.value, 'data');
  nodeAssert.equal(req.cookies.value, undefined);
});

runner.test('Cookie serialization rejects attribute injection and invalid security combinations', () => {
  const res = new Response({});
  for (const options of [
    { path: '/; Secure' }, { path: '/\r\nX-Injected: yes' },
    { domain: 'example.com; Secure' }, { domain: 'example.com\r\nX: yes' },
    { maxAge: NaN }, { maxAge: Infinity }, { maxAge: '1000' },
    { expires: new Date('invalid') }, { sameSite: 'none' }
  ]) nodeAssert.throws(() => res.cookie('value', 'safe', options));
  nodeAssert.throws(() => res.cookie('__Host-value', 'safe', { secure: true, domain: 'example.com' }));
  nodeAssert.throws(() => res.cookie('__Secure-value', 'safe'));
  nodeAssert.throws(() => res.cookie('bad:name', 'safe'));
  nodeAssert.throws(() => res.cookie('signed', 'safe', { signed: true }));
  nodeAssert.equal(res.getHeader('Set-Cookie'), undefined);
  res.cookie('__Host-value', 'a+b', { secure: true, sameSite: 'none' });
  nodeAssert.match(String(res.getHeader('Set-Cookie')), /__Host-value=a%2Bb; Path=\/; HttpOnly; Secure; SameSite=None/);
});

runner.test('Hydrated store data cannot replace prototypes or session methods', () => {
  const data = JSON.parse('{"cookie":{},"__proto__":{"admin":true},"save":"unsafe","req":"unsafe","user":"safe"}');
  const req = {};
  const loaded = new session.Session(req, data);
  nodeAssert.equal(loaded.req, req);
  nodeAssert.equal(typeof loaded.save, 'function');
  nodeAssert.equal(loaded.admin, undefined);
  nodeAssert.equal(loaded.user, 'safe');
});

runner.test('Public cookieParser(secret) signs and verifies cookies without Router cookieSecret', async () => {
  for (const withSession of [false, true]) {
    const app = new Router();
    if (withSession) app.use(session({ secret, saveUninitialized: false }));
    app.use(cookieParser(secret));
    app.use(cookieParser(secret)); // Same configuration is idempotent.
    app.get('/set', (_req, res) => res.cookie('user', 'fixture', { signed: true }).send('set'));
    app.get('/get', (req, res) => res.json({ user: req.signedCookies.user || null }));
    const server = await createTestServer(app);
    const request = (path, cookie) => makeRequest({ hostname: '127.0.0.1', port: server.port,
      path, method: 'GET', headers: cookie ? { Cookie: cookie.split(';')[0] } : {} });
    try {
      const created = await request('/set');
      nodeAssert.equal(created.statusCode, 200);
      const cookie = created.headers['set-cookie'][0];
      nodeAssert.deepEqual(JSON.parse((await request('/get', cookie)).body), { user: 'fixture' });
      nodeAssert.deepEqual(JSON.parse((await request('/get', cookie.replace('fixture', 'tampered'))).body), { user: null });
    } finally { await server.close(); }
  }
});

runner.test('Conflicting Router and middleware signing secrets fail without minting cookies', async () => {
  const app = new Router({ cookieSecret: crypto.randomBytes(32).toString('hex') });
  app.use(cookieParser(secret));
  app.get('/set', (_req, res) => res.cookie('user', 'fixture', { signed: true }).send('success'));
  const server = await createTestServer(app);
  try {
    const result = await makeRequest({ hostname: '127.0.0.1', port: server.port, path: '/set', method: 'GET' });
    nodeAssert.equal(result.statusCode, 500);
    nodeAssert.equal(result.headers['set-cookie'], undefined);
    nodeAssert.doesNotMatch(result.body, new RegExp(secret));
  } finally { await server.close(); }
});

runner.test('Router proxy trust propagates on simple, middleware and nested request paths', async () => {
  for (const trust of [false, true, peer => peer === '127.0.0.1' || peer === '::ffff:127.0.0.1', () => false]) {
    for (const full of [false, true]) {
      const app = new Router({ trustProxy: trust });
      if (full) app.use((_req, _res, next) => next());
      const nested = new Router({ trustProxy: false });
      const reply = (req, res) => res.json({ ip: req.ip, protocol: req.protocol, secure: req.secure });
      app.get('/root', reply);
      nested.get('/child', reply);
      app.nest('/nested', nested);
      const server = await createTestServer(app);
      try {
        for (const path of ['/root', '/nested/child']) {
          const result = await makeRequest({ hostname: '127.0.0.1', port: server.port, path, method: 'GET',
            headers: { 'x-forwarded-for': '198.51.100.1', 'x-forwarded-proto': 'https' } });
          const body = JSON.parse(result.body);
          const trusted = trust === true || (typeof trust === 'function' && trust('127.0.0.1'));
          nodeAssert.equal(body.protocol, trusted ? 'https' : 'http');
          nodeAssert.equal(body.secure, trusted);
          if (trusted) nodeAssert.equal(body.ip, '198.51.100.1');
          else nodeAssert.notEqual(body.ip, '198.51.100.1');
        }
      } finally { await server.close(); }
    }
  }
  nodeAssert.throws(() => new Router({ trustProxy: 'true' }), /trustProxy/);
});

const suiteDeadline = setTimeout(() => {
  console.error(`Session security suite stalled: ${runner.passed + runner.failed}/${runner.tests.length}`);
  process.exit(1);
}, 60000);
runner.run().then(success => {
  clearTimeout(suiteDeadline);
  nodeAssert.equal(runner.passed + runner.failed, runner.tests.length);
  console.log(`Completion: ${runner.passed + runner.failed}/${runner.tests.length}`);
  process.exit(success ? 0 : 1);
}).catch(err => { clearTimeout(suiteDeadline); console.error(err.message); process.exit(1); });
