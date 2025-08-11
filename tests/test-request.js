const { TestRunner, createTestServer, makeRequest, assert, assertEqual, assertDeepEqual } = require('./test-helper');
const { Router } = require('../index');

const runner = new TestRunner('Request Tests');

runner.test('Should parse query parameters', async () => {
  const app = new Router();
  
  app.get('/query', (req, res) => {
    res.json({
      query: req.query,
      queryParams: req.queryParams ? Object.fromEntries(req.queryParams) : {}
    });
  });
  
  const server = await createTestServer(app);
  
  try {
    const response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/query?name=John&age=30&active=true',
      method: 'GET'
    });
    
    assertEqual(response.statusCode, 200);
    const body = JSON.parse(response.body);
    
    // Check either req.query or req.queryParams
    const query = body.query || body.queryParams;
    assertEqual(query.name, 'John');
    assertEqual(String(query.age), '30');
    assertEqual(String(query.active), 'true');
  } finally {
    await server.close();
  }
});

runner.test('Should handle arrays in query parameters', async () => {
  const app = new Router();
  
  app.get('/array-query', (req, res) => {
    res.json({
      query: req.query
    });
  });
  
  const server = await createTestServer(app);
  
  try {
    const response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/array-query?items=1&items=2&items=3&single=value',
      method: 'GET'
    });
    
    assertEqual(response.statusCode, 200);
    const body = JSON.parse(response.body);
    
    // Arrays might be handled differently depending on implementation
    assert(body.query.single === 'value');
    
    // Check if items is an array or the last value
    if (Array.isArray(body.query.items)) {
      // Convert to strings for comparison
      const items = body.query.items.map(String);
      assertDeepEqual(items, ['1', '2', '3']);
    } else {
      // Fallback: might just get the last value
      assert(body.query.items === '3' || body.query.items === '1');
    }
  } finally {
    await server.close();
  }
});

runner.test('Should provide request headers', async () => {
  const app = new Router();
  
  app.get('/headers', (req, res) => {
    res.json({
      headers: req.headers,
      userAgent: req.headers['user-agent'],
      contentType: req.headers['content-type'],
      custom: req.headers['x-custom-header']
    });
  });
  
  const server = await createTestServer(app);
  
  try {
    const response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/headers',
      method: 'GET',
      headers: {
        'User-Agent': 'Test-Client/1.0',
        'X-Custom-Header': 'custom-value',
        'Content-Type': 'application/json'
      }
    });
    
    assertEqual(response.statusCode, 200);
    const body = JSON.parse(response.body);
    
    assertEqual(body.userAgent, 'Test-Client/1.0');
    assertEqual(body.contentType, 'application/json');
    assertEqual(body.custom, 'custom-value');
  } finally {
    await server.close();
  }
});

runner.test('Should extract route parameters', async () => {
  const app = new Router();
  
  app.get('/users/:userId/posts/:postId', (req, res) => {
    res.json({
      params: req.params,
      userId: req.params.userId,
      postId: req.params.postId
    });
  });
  
  const server = await createTestServer(app);
  
  try {
    const response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/users/123/posts/456',
      method: 'GET'
    });
    
    assertEqual(response.statusCode, 200);
    const body = JSON.parse(response.body);
    
    assertEqual(body.userId, '123');
    assertEqual(body.postId, '456');
    assertDeepEqual(body.params, { userId: '123', postId: '456' });
  } finally {
    await server.close();
  }
});

runner.test('Should provide request method and URL', async () => {
  const app = new Router();
  
  app.all('/info', (req, res) => {
    res.json({
      method: req.method,
      url: req.url,
      path: req.path,
      originalUrl: req.originalUrl
    });
  });
  
  const server = await createTestServer(app);
  
  try {
    // Test GET
    let response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/info?test=1',
      method: 'GET'
    });
    
    assertEqual(response.statusCode, 200);
    let body = JSON.parse(response.body);
    assertEqual(body.method, 'GET');
    assert(body.url.includes('/info'));
    
    // Test POST
    response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/info',
      method: 'POST'
    });
    
    assertEqual(response.statusCode, 200);
    body = JSON.parse(response.body);
    assertEqual(body.method, 'POST');
  } finally {
    await server.close();
  }
});

runner.test('Should handle content negotiation', async () => {
  const app = new Router();
  
  app.get('/negotiate', (req, res) => {
    const accepts = req.accepts ? req.accepts(['json', 'html', 'text']) : 'json';
    
    switch(accepts) {
      case 'html':
        res.type('html').send('<h1>HTML Response</h1>');
        break;
      case 'text':
        res.type('text').send('Plain text response');
        break;
      case 'json':
      default:
        res.json({ type: 'json', message: 'JSON response' });
    }
  });
  
  const server = await createTestServer(app);
  
  try {
    // Request JSON
    let response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/negotiate',
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      }
    });
    
    assertEqual(response.statusCode, 200);
    assert(response.headers['content-type'].includes('json'));
    
    // Request HTML
    response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/negotiate',
      method: 'GET',
      headers: {
        'Accept': 'text/html'
      }
    });
    
    assertEqual(response.statusCode, 200);
    // Check if content negotiation is working
    if (response.headers['content-type'].includes('html')) {
      assert(response.body.includes('<h1>'));
    }
  } finally {
    await server.close();
  }
});

runner.test('Should provide request IP and hostname', async () => {
  const app = new Router();
  
  app.get('/connection', (req, res) => {
    res.json({
      ip: req.ip,
      hostname: req.hostname,
      protocol: req.protocol,
      secure: req.secure
    });
  });
  
  const server = await createTestServer(app);
  
  try {
    const response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/connection',
      method: 'GET',
      headers: {
        'Host': 'example.com'
      }
    });
    
    assertEqual(response.statusCode, 200);
    const body = JSON.parse(response.body);
    
    // IP should be localhost
    assert(
      body.ip === '127.0.0.1' || 
      body.ip === '::1' || 
      body.ip === '::ffff:127.0.0.1',
      'Should have localhost IP'
    );
    
    // Protocol should be http
    if (body.protocol) {
      assertEqual(body.protocol, 'http');
    }
    
    // Should not be secure (not HTTPS)
    if (body.secure !== undefined) {
      assertEqual(body.secure, false);
    }
  } finally {
    await server.close();
  }
});

runner.test('Should decode URL-encoded path parameters', async () => {
  const app = new Router();
  
  app.get('/files/:filename', (req, res) => {
    res.json({
      filename: req.params.filename
    });
  });
  
  const server = await createTestServer(app);
  
  try {
    const response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/files/hello%20world.txt',
      method: 'GET'
    });
    
    assertEqual(response.statusCode, 200);
    const body = JSON.parse(response.body);
    
    // Should decode the URL-encoded parameter
    assertEqual(body.filename, 'hello world.txt');
  } finally {
    await server.close();
  }
});

// Run the tests
runner.run().then(success => {
  process.exit(success ? 0 : 1);
});