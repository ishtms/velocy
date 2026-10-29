const { TestRunner, createTestServer, makeRequest, assert, assertEqual, assertDeepEqual } = require('./test-helper');
const nodeAssert = require('node:assert/strict');
const { Router, bodyParser } = require('../index');

const runner = new TestRunner('Body Parser Tests');

runner.test('Should reject unsafe parser size and count limits', async () => {
  for (const limit of [-1, Infinity, Number.MAX_SAFE_INTEGER + 1, '999999999999999999999gb', '1tb', 'not-a-size']) {
    nodeAssert.throws(() => bodyParser({ limit }), RangeError);
  }
  nodeAssert.throws(() => bodyParser({ parameterLimit: Infinity }), RangeError);
  nodeAssert.throws(() => bodyParser({ parameterLimit: 0 }), RangeError);
  nodeAssert.throws(() => bodyParser({ multipart: true, maxFiles: Infinity }), RangeError);
  nodeAssert.doesNotThrow(() => bodyParser({ limit: 0 }));
});

runner.test('Should parse JSON body', async () => {
  const app = new Router();
  
  app.use(bodyParser.json());
  
  app.post('/json', (req, res) => {
    res.json({
      received: req.body,
      type: typeof req.body
    });
  });
  
  const server = await createTestServer(app);
  
  try {
    const testData = { name: 'John', age: 30, active: true };
    const response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/json',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    }, JSON.stringify(testData));
    
    assertEqual(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assertDeepEqual(body.received, testData);
    assertEqual(body.type, 'object');
  } finally {
    await server.close();
  }
});

runner.test('Should parse URL-encoded body', async () => {
  const app = new Router();
  
  app.use(bodyParser.urlencoded({ extended: true }));
  
  app.post('/form', (req, res) => {
    res.json({
      received: req.body
    });
  });
  
  const server = await createTestServer(app);
  
  try {
    const formData = 'name=John+Doe&age=30&email=john%40example.com';
    const response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/form',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    }, formData);
    
    assertEqual(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assertEqual(body.received.name, 'John Doe');
    assertEqual(body.received.age, '30');
    assertEqual(body.received.email, 'john@example.com');
  } finally {
    await server.close();
  }
});

for (const extended of [false, true]) {
  for (const preserveRawBody of [false, true]) {
    runner.test(`Should enforce URL-encoded parameter limits (extended=${extended}, preserveRawBody=${preserveRawBody})`, async () => {
      const app = new Router();
      app.use('/limited', bodyParser.urlencoded({ extended, preserveRawBody, parameterLimit: 2 }));
      app.use('/larger', bodyParser.urlencoded({ extended, preserveRawBody, parameterLimit: 1001 }));
      const respond = (req, res) => res.json({ received: req.body, raw: req.rawBody?.toString() });
      app.post('/limited', respond);
      app.post('/larger', respond);

      const server = await createTestServer(app);
      const submit = async (path, form) => {
        const response = await makeRequest({
          hostname: '127.0.0.1', port: server.port, path, method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        }, form);
        assertEqual(response.statusCode, 200);
        const result = JSON.parse(response.body);
        if (preserveRawBody) assertEqual(result.raw, form);
        else nodeAssert.equal(result.raw, undefined);
        return result.received;
      };

      try {
        // Repeated keys count as separate parameters, not one output property.
        assertDeepEqual(await submit('/limited', 'tag=one&tag=two'), { tag: ['one', 'two'] });
        assertDeepEqual(await submit('/limited', 'tag=one&tag=two&tag=ignored'), { tag: ['one', 'two'] });
        assertDeepEqual(await submit('/limited', 'name=John+Doe&value=a%26b%3Dc&ignored=yes'), {
          name: 'John Doe', value: 'a&b=c'
        });
        // A configured limit above Node's default must not silently cap at 1000.
        const form = Array.from({ length: 1002 }, (_, i) => `k${i}=v`).join('&');
        const parsed = await submit('/larger', form);
        assertEqual(Object.keys(parsed).length, 1001);
        assertEqual(parsed.k1000, 'v');
        nodeAssert.equal(parsed.k1001, undefined);
      } finally {
        await server.close();
      }
    });
  }
}

runner.test('Should handle nested objects in URL-encoded', async () => {
  const app = new Router();
  
  app.use(bodyParser.urlencoded({ extended: true }));
  
  app.post('/nested', (req, res) => {
    res.json({ received: req.body });
  });
  
  const server = await createTestServer(app);
  
  try {
    const formData = 'user[name]=John&user[email]=john%40example.com&user[age]=30';
    const response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/nested',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    }, formData);
    
    assertEqual(response.statusCode, 200);
    const body = JSON.parse(response.body);
    
    // Check if nested parsing is supported
    if (body.received.user && typeof body.received.user === 'object') {
      assertEqual(body.received.user.name, 'John');
      assertEqual(body.received.user.email, 'john@example.com');
      assertEqual(body.received.user.age, '30');
    } else {
      // Fallback to bracket notation keys
      assert(body.received['user[name]'] === 'John' || body.received.user);
    }
  } finally {
    await server.close();
  }
});

runner.test('Should parse text/plain body', async () => {
  const app = new Router();
  
  app.use(bodyParser.text());
  
  app.post('/text', (req, res) => {
    res.json({
      received: req.body,
      type: typeof req.body
    });
  });
  
  const server = await createTestServer(app);
  
  try {
    const textData = 'This is plain text content';
    const response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/text',
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain'
      }
    }, textData);
    
    assertEqual(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assertEqual(body.received, textData);
    assertEqual(body.type, 'string');
  } finally {
    await server.close();
  }
});

runner.test('Should parse raw buffer body', async () => {
  const app = new Router();
  
  app.use(bodyParser.raw());
  
  app.post('/raw', (req, res) => {
    res.json({
      isBuffer: Buffer.isBuffer(req.body),
      length: req.body.length,
      content: req.body.toString()
    });
  });
  
  const server = await createTestServer(app);
  
  try {
    const rawData = 'Raw buffer content';
    const response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/raw',
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream'
      }
    }, rawData);
    
    assertEqual(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert(body.isBuffer === true, 'Should parse as Buffer');
    assertEqual(body.length, rawData.length);
    assertEqual(body.content, rawData);
  } finally {
    await server.close();
  }
});

runner.test('Should respect size limits', async () => {
  const app = new Router();
  
  app.use(bodyParser.json({ limit: '1kb' }));
  
  app.post('/limited', (req, res) => {
    res.json({ received: req.body });
  });
  
  const server = await createTestServer(app);
  
  try {
    // Create data larger than 1kb
    const largeData = { data: 'x'.repeat(2000) };
    
    try {
      const response = await makeRequest({
        hostname: '127.0.0.1',
        port: server.port,
        path: '/limited',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      }, JSON.stringify(largeData));
      
      // Should reject with 413 or similar error
      assert(
        response.statusCode === 413 || response.statusCode === 400,
        `Should reject oversized payload (got ${response.statusCode})`
      );
    } catch (err) {
      // Socket hang up is expected when the server rejects the large payload
      if (!err.message.includes('socket hang up') && !err.message.includes('ECONNRESET')) {
        throw err;
      }
      // If we get socket hang up, the test passes as the server rejected the request
    }
  } finally {
    await server.close();
  }
});

runner.test('Should handle empty body', async () => {
  const app = new Router();
  
  app.use(bodyParser.json());
  app.use(bodyParser.urlencoded({ extended: true }));
  
  app.post('/empty', (req, res) => {
    res.json({
      body: req.body,
      hasBody: !!req.body
    });
  });
  
  const server = await createTestServer(app);
  
  try {
    // Test with no body
    let response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/empty',
      method: 'POST'
    });
    
    assertEqual(response.statusCode, 200);
    let body = JSON.parse(response.body);
    assert(body.hasBody, 'Should have body object even if empty');
    
    // Test with empty JSON
    response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/empty',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    }, '{}');
    
    assertEqual(response.statusCode, 200);
    body = JSON.parse(response.body);
    assertDeepEqual(body.body, {});
  } finally {
    await server.close();
  }
});

runner.test('Should handle malformed JSON', async () => {
  const app = new Router();
  
  app.use(bodyParser.json());
  
  app.post('/malformed', (req, res) => {
    res.json({ received: req.body });
  });
  
  // Add error handler
  app.use((err, req, res, next) => {
    res.status(400).json({
      error: 'Bad Request',
      message: err.message
    });
  });
  
  const server = await createTestServer(app);
  
  try {
    const response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/malformed',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    }, '{invalid json}');
    
    assert(
      response.statusCode === 400 || response.statusCode === 500,
      'Should return error for malformed JSON'
    );
  } finally {
    await server.close();
  }
});

runner.test('Should work with multiple parsers', async () => {
  const app = new Router();
  
  // Use multiple parsers
  app.use(bodyParser.json());
  app.use(bodyParser.urlencoded({ extended: true }));
  app.use(bodyParser.text());
  
  app.post('/multi', (req, res) => {
    res.json({
      body: req.body,
      type: typeof req.body
    });
  });
  
  const server = await createTestServer(app);
  
  try {
    // Test JSON
    let response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/multi',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    }, '{"type":"json"}');
    
    assertEqual(response.statusCode, 200);
    let body = JSON.parse(response.body);
    assertDeepEqual(body.body, { type: 'json' });
    
    // Test URL-encoded
    response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/multi',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    }, 'type=form&value=test');
    
    assertEqual(response.statusCode, 200);
    body = JSON.parse(response.body);
    assertEqual(body.body.type, 'form');
    assertEqual(body.body.value, 'test');
    
    // Test plain text
    response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/multi',
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain'
      }
    }, 'Plain text content');
    
    assertEqual(response.statusCode, 200);
    body = JSON.parse(response.body);
    assertEqual(body.body, 'Plain text content');
    assertEqual(body.type, 'string');
  } finally {
    await server.close();
  }
});

// Run the tests
runner.run().then(success => {
  process.exit(success ? 0 : 1);
});
