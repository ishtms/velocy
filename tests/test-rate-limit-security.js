const nodeAssert = require('node:assert/strict');
const { TestRunner, createTestServer, makeRequest } = require('./test-helper');
const { Router, rateLimit } = require('../index');

const runner = new TestRunner('Rate Limit Proxy Security Tests');
const peer = '192.0.2.10';

function request(headers = {}, address = peer) {
  return { method: 'GET', headers, socket: { remoteAddress: address } };
}

function response() {
  return {
    statusCode: 200,
    set() {},
    status(code) { this.statusCode = code; return this; },
    send(body) { this.body = body; },
    json(body) { this.body = body; },
    end() {}
  };
}

async function withLimiter(options, check) {
  const limiter = rateLimit({ windowMs: 60000, max: 1, ...options });
  try {
    await check(limiter);
  } finally {
    limiter.getStore().destroy();
  }
}

async function keyFor(req, options = {}) {
  let key;
  const store = { increment(value) { key = value; return 1; } };
  const limiter = rateLimit({ ...options, store });
  await limiter(req, response(), () => {});
  return key;
}

async function withServer(options, check, handler = (req, res) => res.send('ok')) {
  const limiter = rateLimit({ windowMs: 60000, max: 1, ...options });
  const app = new Router();
  app.use(limiter);
  app.get('/test', handler);
  const server = await createTestServer(app);
  try {
    await check((headers = {}) => makeRequest({
      hostname: '127.0.0.1', port: server.port, path: '/test', headers, agent: false
    }));
  } finally {
    await server.close();
    limiter.getStore().destroy();
  }
}

runner.test('Loopback: rotating forwarding headers cannot reset the default socket limit', async () => {
  await withServer({}, async (send) => {
    nodeAssert.equal((await send({ 'X-Forwarded-For': '198.51.100.1' })).statusCode, 200);
    for (const headers of [
      { 'X-Forwarded-For': '198.51.100.2' },
      { 'X-Real-IP': '198.51.100.3' },
      { 'X-Client-IP': '198.51.100.4' },
      { Forwarded: 'for=198.51.100.5' },
      { 'X-Forwarded-For': 'garbage' },
      {}
    ]) {
      nodeAssert.equal((await send(headers)).statusCode, 429);
    }
  });
});

runner.test('Loopback: trusted proxy gets separate client buckets and a stable client limit', async () => {
  await withServer({ trustProxy: (address) => address === '127.0.0.1' }, async (send) => {
    nodeAssert.equal((await send({ 'X-Forwarded-For': '198.51.100.1' })).statusCode, 200);
    nodeAssert.equal((await send({ 'X-Forwarded-For': '198.51.100.2' })).statusCode, 200);
    nodeAssert.equal((await send({ 'X-Forwarded-For': '198.51.100.1' })).statusCode, 429);
  });
});

runner.test('Loopback: explicitly untrusted peer cannot use a forwarded whitelist identity', async () => {
  await withServer({ trustProxy: () => false, whitelist: ['198.51.100.1'] }, async (send) => {
    nodeAssert.equal((await send({ 'X-Forwarded-For': '198.51.100.1' })).statusCode, 200);
    nodeAssert.equal((await send({ 'X-Forwarded-For': '198.51.100.1' })).statusCode, 429);
  });
});

runner.test('Loopback: counted error responses still use socket identity with rotated XFF', async () => {
  await withServer({ skipSuccessfulRequests: true }, async (send) => {
    nodeAssert.equal((await send({ 'X-Forwarded-For': '198.51.100.1' })).statusCode, 400);
    nodeAssert.equal((await send({ 'X-Forwarded-For': '198.51.100.2' })).statusCode, 429);
  }, (req, res) => res.status(400).send('fixture error'));
});

runner.test('Loopback: two-hop default generator selects client rather than the nearest proxy', async () => {
  await withServer({ trustProxy: true, proxies: 2 }, async (send) => {
    nodeAssert.equal((await send({ 'X-Forwarded-For': '198.51.100.1, 192.0.2.20' })).statusCode, 200);
    nodeAssert.equal((await send({ 'X-Forwarded-For': '198.51.100.2, 192.0.2.20' })).statusCode, 200);
    nodeAssert.equal((await send({ 'X-Forwarded-For': '198.51.100.1, 192.0.2.20' })).statusCode, 429);
  });
});

runner.test('Default and explicit false ignore forwarding headers and req.ip', async () => {
  for (const options of [{}, { trustProxy: false, proxies: 2 }]) {
    const req = request({ 'x-forwarded-for': '198.51.100.1, 198.51.100.2' });
    Object.defineProperty(req, 'ip', { get() { throw new Error('Must not read req.ip'); } });
    nodeAssert.equal(await keyFor(req, options), peer);
  }
});

runner.test('Boolean trust and proxies options reach the default generator', async () => {
  const req = request({ 'x-forwarded-for': '203.0.113.99, 198.51.100.1, 192.0.2.20' });
  nodeAssert.equal(await keyFor(req, { trustProxy: true }), '192.0.2.20');
  nodeAssert.equal(await keyFor(req, { trustProxy: true, proxies: 2 }), '198.51.100.1');
  nodeAssert.equal(await keyFor(req, { trustProxy: true, proxies: 3 }), '203.0.113.99');
  await nodeAssert.rejects(() => keyFor(req, { trustProxy: true, proxies: 4 }), /forwarded/i);
});

runner.test('Trust predicate checks normalized peer/hops and stops at first untrusted hop', async () => {
  const calls = [];
  const options = {
    proxies: 3,
    trustProxy(address, hop) { calls.push([address, hop]); return address === peer; }
  };
  const req = request({ 'x-forwarded-for': '203.0.113.99, 198.51.100.1' }, '::ffff:c000:20a');
  nodeAssert.equal(await keyFor(req, options), '198.51.100.1');
  nodeAssert.deepEqual(calls, [[peer, 0], ['198.51.100.1', 1]]);
  nodeAssert.equal(await keyFor(req, { trustProxy: () => false }), peer);
});

runner.test('Trusted two-hop selection ignores attacker-controlled left prefixes', async () => {
  for (const prefix of ['203.0.113.1', '203.0.113.2, 203.0.113.3']) {
    const req = request({ 'x-forwarded-for': `${prefix}, 198.51.100.1, 192.0.2.20` });
    nodeAssert.equal(await keyFor(req, {
      trustProxy: (address) => [peer, '192.0.2.20'].includes(address), proxies: 2
    }), '198.51.100.1');
  }
});

runner.test('Missing, malformed selected or oversized trusted XFF rejects before consuming a bucket', async () => {
  const malformed = [
    undefined, '', 'unknown', 'client.example', '198.51.100.1:443', '[2001:db8::1]',
    '127.000.000.001', '127.1', '198.51.100.1,',
    '198.51.100.1, garbage', 'fe80::1%eth0', '"198.51.100.1"',
    ['198.51.100.1'], 42, {}, '198.51.100.1\r\n', '1'.repeat(8193),
    Array(65).fill('198.51.100.1').join(',')
  ];
  await withLimiter({ trustProxy: true }, async (limiter) => {
    for (let index = 0; index < malformed.length; index++) {
      const headers = {
        'x-forwarded-for': malformed[index],
        'x-real-ip': `203.0.113.${index + 1}`,
        'x-client-ip': `198.51.100.${index + 1}`
      };
      let reachedNext = false;
      await nodeAssert.rejects(() => limiter(request(headers), response(), () => { reachedNext = true; }), /forwarded/i);
      nodeAssert.equal(reachedNext, false);
    }
    nodeAssert.equal(limiter.getStore().getStats().size, 0);
  });
});

runner.test('Only XFF is accepted, including when other headers disagree', async () => {
  for (const headers of [undefined, {}, { 'x-real-ip': '198.51.100.1' },
    { 'x-client-ip': '198.51.100.2', forwarded: 'for=198.51.100.3' }]) {
    const req = { socket: { remoteAddress: peer }, headers };
    await nodeAssert.rejects(() => keyFor(req, { trustProxy: true }), /forwarded/i);
    nodeAssert.equal(await keyFor(req, { trustProxy: () => false }), peer);
  }
  nodeAssert.equal(await keyFor(request({
    'x-forwarded-for': '198.51.100.1', 'x-real-ip': '198.51.100.2'
  }), { trustProxy: true }), '198.51.100.1');
});

runner.test('Literal IPv6 and mapped IPv4 spellings canonicalize to stable keys', async () => {
  for (const literal of ['2001:DB8::1', '2001:0db8:0000:0:0:0:0:1', '2001:db8::1']) {
    nodeAssert.equal(await keyFor(request({ 'x-forwarded-for': literal }), { trustProxy: true }), '2001:db8::1');
    nodeAssert.equal(await keyFor(request({}, literal)), '2001:db8::1');
  }
  for (const literal of ['192.0.2.1', '::ffff:192.0.2.1', '::FFFF:c000:201', '0:0:0:0:0:ffff:c000:0201']) {
    nodeAssert.equal(await keyFor(request({ 'x-forwarded-for': ` \t${literal}\t ` }), { trustProxy: true }), '192.0.2.1');
    nodeAssert.equal(await keyFor(request({}, literal)), '192.0.2.1');
  }
});

runner.test('Connection/native socket fallbacks work; missing/invalid peer never trusts headers', async () => {
  for (const req of [
    { connection: { remoteAddress: peer } },
    { nativeRequest: { socket: { remoteAddress: peer } } }
  ]) {
    nodeAssert.equal(await keyFor(req), peer);
  }
  for (const address of [undefined, '', 'client.example', '::ffff:not-an-ip']) {
    const req = request({ 'x-forwarded-for': '198.51.100.1' }, address);
    // Passing undefined to request() selects its default, so explicitly replace it.
    req.socket.remoteAddress = address;
    nodeAssert.equal(await keyFor(req, { trustProxy: true }), 'unknown');
  }
  nodeAssert.equal(await keyFor({}, { trustProxy: true }), 'unknown');
});

runner.test('Proxy and key-generator options reject invalid types and hop ranges at construction', async () => {
  for (const trustProxy of [null, 1, 0, 'true', 'false', [], {}]) {
    nodeAssert.throws(() => rateLimit({ trustProxy }), /trustProxy/);
  }
  for (const proxies of [null, 0, -1, 1.5, Infinity, NaN, '2', true, 65]) {
    nodeAssert.throws(() => rateLimit({ proxies }), /proxies/);
  }
  for (const keyGenerator of [null, false, 'ip', {}]) {
    nodeAssert.throws(() => rateLimit({ keyGenerator }), /keyGenerator/);
  }
});

runner.test('Trust predicate exceptions/non-booleans reject without reaching store or next', async () => {
  for (const trustProxy of [() => { throw new Error('trust failed'); }, () => 'yes', () => undefined,
    async () => { throw new Error('async trust failed'); }, async () => 'yes']) {
    let reachedStore = false;
    let reachedNext = false;
    const limiter = rateLimit({ trustProxy, store: { increment() { reachedStore = true; return 1; } } });
    await nodeAssert.rejects(() => limiter(request({ 'x-forwarded-for': '198.51.100.1' }), response(), () => {
      reachedNext = true;
    }));
    nodeAssert.equal(reachedStore, false);
    nodeAssert.equal(reachedNext, false);
  }
});

runner.test('Async peer predicates are awaited before selecting forwarded identity', async () => {
  nodeAssert.equal(await keyFor(request({ 'x-forwarded-for': '198.51.100.1' }), {
    trustProxy: async (address) => address === peer
  }), '198.51.100.1');
  nodeAssert.equal(await keyFor(request({ 'x-forwarded-for': '198.51.100.1' }), {
    trustProxy: async () => false
  }), peer);
});

runner.test('Custom async generator retains exactly one request argument and controls keys', async () => {
  const keys = [];
  const req = request({ 'x-forwarded-for': '198.51.100.1' });
  const keyGenerator = async function(...args) {
    nodeAssert.deepEqual(args, [req]);
    return 'account:fixture';
  };
  const limiter = rateLimit({ trustProxy: () => { throw new Error('Not the default generator'); }, keyGenerator,
    store: { increment(key) { keys.push(key); return keys.length; } }, max: 1 });
  nodeAssert.equal(limiter.getConfig().keyGenerator, keyGenerator);
  const first = response();
  const second = response();
  await limiter(req, first, () => {});
  await limiter(req, second, () => {});
  nodeAssert.deepEqual(keys, ['account:fixture', 'account:fixture']);
  nodeAssert.equal(first.statusCode, 200);
  nodeAssert.equal(second.statusCode, 429);
});

runner.test('Custom generator rejection never calls next or the store', async () => {
  let called = false;
  const limiter = rateLimit({ keyGenerator: async () => { throw new Error('key failed'); },
    store: { increment() { called = true; return 1; } } });
  await nodeAssert.rejects(() => limiter(request(), response(), () => { called = true; }), /key failed/);
  nodeAssert.equal(called, false);
});

runner.test('False skip/bypass and whitelist checks cannot turn malformed forwarding into exemption', async () => {
  await withLimiter({ trustProxy: true, whitelist: ['198.51.100.1'], skip: () => false, bypass: () => false }, async (limiter) => {
    for (let index = 0; index < 3; index++) {
      let reachedNext = false;
      await nodeAssert.rejects(() => limiter(request({
        'x-forwarded-for': `malformed-${index}`, 'x-real-ip': '198.51.100.1'
      }), response(), () => { reachedNext = true; }), /forwarded/i);
      nodeAssert.equal(reachedNext, false);
    }
    nodeAssert.equal(limiter.getStore().getStats().size, 0);
  });
});

runner.test('Explicit skip and bypass hooks still opt out without consuming a bucket', async () => {
  for (const hook of ['skip', 'bypass']) {
    await withLimiter({ [hook]: () => true }, async (limiter) => {
      let nextCount = 0;
      await limiter(request(), response(), () => { nextCount++; });
      await limiter(request(), response(), () => { nextCount++; });
      nodeAssert.equal(nextCount, 2);
      nodeAssert.equal(limiter.getStore().getStats().size, 0);
    });
  }
});

runner.test('Throwing skip/bypass hooks reject without consuming a bucket or calling next', async () => {
  for (const hook of ['skip', 'bypass']) {
    await withLimiter({ [hook]: async () => { throw new Error('hook failed'); } }, async (limiter) => {
      let reachedNext = false;
      await nodeAssert.rejects(() => limiter(request(), response(), () => { reachedNext = true; }), /hook failed/);
      nodeAssert.equal(reachedNext, false);
      nodeAssert.equal(limiter.getStore().getStats().size, 0);
    });
  }
});

runner.test('Review: malformed unselected prefixes cannot switch a client into a whitelisted proxy bucket', async () => {
  await withLimiter({ trustProxy: address => address === peer, proxies: 1, whitelist: [peer] }, async limiter => {
    for (const [index, prefix] of ['garbage', 'unknown, nonsense', ''].entries()) {
      const res = response();
      await limiter(request({ 'x-forwarded-for': `${prefix}, 198.51.100.1` }), res, () => {});
      nodeAssert.equal(res.statusCode, index === 0 ? 200 : 429);
    }
    nodeAssert.equal(limiter.getStore().getStats().size, 1);
  });
});

runner.test('Review: malformed unselected prefixes cannot evade a client blacklist', async () => {
  await withLimiter({ trustProxy: address => address === peer, whitelist: [peer], blacklist: ['198.51.100.1'] }, async limiter => {
    for (const header of ['198.51.100.1', 'garbage, 198.51.100.1', ', 198.51.100.1']) {
      const res = response();
      let reachedNext = false;
      await limiter(request({ 'x-forwarded-for': header }), res, () => { reachedNext = true; });
      nodeAssert.equal(res.statusCode, 403);
      nodeAssert.equal(reachedNext, false);
    }
  });
});

runner.test('Review: overlarge trusted chains reject before proxy whitelist or bypass', async () => {
  await withLimiter({ trustProxy: address => address === peer, whitelist: [peer], bypass: () => true }, async limiter => {
    for (const header of ['x'.repeat(8193) + ', 198.51.100.1', Array(65).fill('198.51.100.1').join(',')]) {
      let reachedNext = false;
      await nodeAssert.rejects(() => limiter(request({ 'x-forwarded-for': header }), response(), () => {
        reachedNext = true;
      }), /forwarded/i);
      nodeAssert.equal(reachedNext, false);
      nodeAssert.equal(limiter.getStore().getStats().size, 0);
    }
  });
});

runner.test('Review: invalid selected addresses reject instead of taking exempt proxy identity', async () => {
  await withLimiter({ trustProxy: address => address === peer, whitelist: [peer] }, async limiter => {
    for (const header of ['garbage', '198.51.100.1, garbage', '', ['198.51.100.1']]) {
      let reachedNext = false;
      await nodeAssert.rejects(() => limiter(request({ 'x-forwarded-for': header }), response(), () => {
        reachedNext = true;
      }), /forwarded/i);
      nodeAssert.equal(reachedNext, false);
      nodeAssert.equal(limiter.getStore().getStats().size, 0);
    }
  });
});

runner.test('Review: incomplete trusted chain rejects before proxy exemption', async () => {
  await withLimiter({ trustProxy: true, proxies: 2, whitelist: [peer] }, async limiter => {
    let reachedNext = false;
    await nodeAssert.rejects(() => limiter(request({ 'x-forwarded-for': '198.51.100.1' }), response(), () => {
      reachedNext = true;
    }), /forwarded/i);
    nodeAssert.equal(reachedNext, false);
  });
});

runner.test('Review: normal trusted topology preserves client identity beyond a malformed prefix', async () => {
  const options = { trustProxy: address => [peer, '192.0.2.20'].includes(address), proxies: 2 };
  for (const header of ['198.51.100.1, 192.0.2.20', 'garbage, 198.51.100.1, 192.0.2.20']) {
    nodeAssert.equal(await keyFor(request({ 'x-forwarded-for': header }), options), '198.51.100.1');
  }
});

runner.test('Review loopback: whitelisted proxy cannot exempt malformed-prefix client requests', async () => {
  await withServer({ trustProxy: address => address === '127.0.0.1', whitelist: ['127.0.0.1'] }, async send => {
    nodeAssert.equal((await send({ 'X-Forwarded-For': 'garbage, 198.51.100.1' })).statusCode, 200);
    nodeAssert.equal((await send({ 'X-Forwarded-For': 'other, 198.51.100.1' })).statusCode, 429);
    for (const headers of [{ 'X-Forwarded-For': 'garbage' }, {},
      { 'X-Forwarded-For': 'x'.repeat(8193) + ', 198.51.100.1' },
      { 'X-Forwarded-For': Array(65).fill('198.51.100.1').join(',') }]) {
      nodeAssert.equal((await send(headers)).statusCode, 500);
    }
  });
});

runner.test('Review loopback: appended client blacklist survives a malformed unselected prefix', async () => {
  await withServer({ trustProxy: address => address === '127.0.0.1',
    whitelist: ['127.0.0.1'], blacklist: ['198.51.100.1'] }, async send => {
    nodeAssert.equal((await send({ 'X-Forwarded-For': 'garbage, 198.51.100.1' })).statusCode, 403);
  });
});

runner.test('Review: malformed forwarding from an untrusted peer retains its actual socket identity', async () => {
  for (const value of ['garbage', '', ['198.51.100.1'], 'x'.repeat(8193)]) {
    nodeAssert.equal(await keyFor(request({ 'x-forwarded-for': value }), { trustProxy: () => false }), peer);
  }
});

runner.run().then(success => process.exit(success ? 0 : 1));
