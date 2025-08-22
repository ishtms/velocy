const { TestRunner, createTestServer, makeRequest, assert, assertEqual, assertDeepEqual } = require('./test-helper');
const { Router, FastRouter, SimpleRouter } = require('../index');

const runner = new TestRunner('Advanced Routing Tests');

runner.test('Should handle complex wildcard patterns', async () => {
  const app = new Router();
  
  // Test various wildcard patterns
  app.get('/api/*/info', (req, res) => {
    res.json({ wildcard: req.params['*'], type: 'info' });
  });
  
  app.get('/files/*/download/*', (req, res) => {
    res.json({ 
      file: req.params['0'],
      action: req.params['1']
    });
  });
  
  app.get('/assets/**', (req, res) => {
    res.json({ path: req.params['**'] });
  });
  
  const server = await createTestServer(app);
  
  try {
    // Test single wildcard in middle
    let response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/api/users/info',
      method: 'GET'
    });
    
    assertEqual(response.statusCode, 200);
    assertEqual(JSON.parse(response.body).wildcard, 'users');
    
    // Test multiple wildcards
    response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/files/document.pdf/download/fast',
      method: 'GET'
    });
    
    assertEqual(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assertEqual(body.file, 'document.pdf');
    assertEqual(body.action, 'fast');
    
    // Test catch-all wildcard
    response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/assets/images/logos/company.png',
      method: 'GET'
    });
    
    assertEqual(response.statusCode, 200);
    assertEqual(JSON.parse(response.body).path, 'images/logos/company.png');
  } finally {
    await server.close();
  }
});

runner.test('Should handle route conflicts correctly', async () => {
  const app = new Router();
  
  // Test route priority: static > params > wildcard
  app.get('/products/new', (req, res) => {
    res.json({ type: 'static' });
  });
  
  app.get('/products/:id', (req, res) => {
    res.json({ type: 'param', id: req.params.id });
  });
  
  app.get('/products/*', (req, res) => {
    res.json({ type: 'wildcard', path: req.params['*'] });
  });
  
  const server = await createTestServer(app);
  
  try {
    // Static route should win
    let response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/products/new',
      method: 'GET'
    });
    
    assertEqual(response.statusCode, 200);
    assertEqual(JSON.parse(response.body).type, 'static');
    
    // Param route should win over wildcard
    response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/products/123',
      method: 'GET'
    });
    
    assertEqual(response.statusCode, 200);
    assertEqual(JSON.parse(response.body).type, 'param');
    
    // Wildcard should match longer paths
    response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/products/category/electronics',
      method: 'GET'
    });
    
    assertEqual(response.statusCode, 200);
    assertEqual(JSON.parse(response.body).type, 'wildcard');
  } finally {
    await server.close();
  }
});

runner.test('Should handle HEAD and OPTIONS methods', async () => {
  const app = new Router();
  
  app.get('/resource', (req, res) => {
    res.set('X-Custom-Header', 'test-value');
    res.json({ data: 'test' });
  });
  
  app.options('/resource', (req, res) => {
    res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.status(204).end();
  });
  
  const server = await createTestServer(app);
  
  try {
    // Test HEAD request (should return headers but no body)
    let response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/resource',
      method: 'HEAD'
    });
    
    assertEqual(response.statusCode, 200);
    assertEqual(response.headers['x-custom-header'], 'test-value');
    assertEqual(response.body, ''); // HEAD should have no body
    
    // Test OPTIONS request
    response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/resource',
      method: 'OPTIONS'
    });
    
    assertEqual(response.statusCode, 204);
    assert(response.headers['access-control-allow-methods']);
  } finally {
    await server.close();
  }
});

runner.test('Should handle route parameter validation', async () => {
  const app = new Router();
  
  // Route with multiple params
  app.get('/api/:version/users/:userId/posts/:postId', (req, res) => {
    res.json({
      version: req.params.version,
      userId: req.params.userId,
      postId: req.params.postId
    });
  });
  
  const server = await createTestServer(app);
  
  try {
    const response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/api/v2/users/john-doe/posts/my-first-post',
      method: 'GET'
    });
    
    assertEqual(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assertEqual(body.version, 'v2');
    assertEqual(body.userId, 'john-doe');
    assertEqual(body.postId, 'my-first-post');
  } finally {
    await server.close();
  }
});

runner.test('Should handle special characters in routes', async () => {
  const app = new Router();
  
  app.get('/files/:filename', (req, res) => {
    res.json({ filename: req.params.filename });
  });
  
  app.get('/search', (req, res) => {
    res.json({ query: req.query });
  });
  
  const server = await createTestServer(app);
  
  try {
    // Test URL encoded characters in params
    let response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/files/document%20with%20spaces.pdf',
      method: 'GET'
    });
    
    assertEqual(response.statusCode, 200);
    assertEqual(JSON.parse(response.body).filename, 'document with spaces.pdf');
    
    // Test query string with special characters
    response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/search?q=hello%20world&filter=type%3Dpdf',
      method: 'GET'
    });
    
    assertEqual(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assertEqual(body.query.q, 'hello world');
    assertEqual(body.query.filter, 'type=pdf');
  } finally {
    await server.close();
  }
});

runner.test('Should handle trailing slashes consistently', async () => {
  const app = new Router();
  
  app.get('/api/users', (req, res) => {
    res.json({ endpoint: 'users' });
  });
  
  app.get('/api/posts/', (req, res) => {
    res.json({ endpoint: 'posts' });
  });
  
  const server = await createTestServer(app);
  
  try {
    // Test without trailing slash
    let response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/api/users',
      method: 'GET'
    });
    
    assertEqual(response.statusCode, 200);
    
    // Test with trailing slash on route without one
    response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/api/users/',
      method: 'GET'
    });
    
    // Should either match or return 404 consistently
    assert(response.statusCode === 200 || response.statusCode === 404);
    
    // Test route defined with trailing slash
    response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/api/posts/',
      method: 'GET'
    });
    
    assertEqual(response.statusCode, 200);
  } finally {
    await server.close();
  }
});

runner.test('Should handle different case routes separately', async () => {
  const app = new Router();
  
  app.get('/CaseSensitive', (req, res) => {
    res.json({ route: 'uppercase' });
  });
  
  app.get('/casesensitive', (req, res) => {
    res.json({ route: 'lowercase' });
  });
  
  const server = await createTestServer(app);
  
  try {
    // Test uppercase route
    let response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/CaseSensitive',
      method: 'GET'
    });
    
    assertEqual(response.statusCode, 200);
    assertEqual(JSON.parse(response.body).route, 'uppercase');
    
    // Test lowercase route
    response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/casesensitive',
      method: 'GET'
    });
    
    assertEqual(response.statusCode, 200);
    assertEqual(JSON.parse(response.body).route, 'lowercase');
  } finally {
    await server.close();
  }
});

runner.test('FastRouter should handle high-performance routing', async () => {
  const app = new FastRouter();
  
  // Add multiple routes to test performance
  for (let i = 0; i < 100; i++) {
    app.get(`/route${i}`, (req, res) => {
      res.json({ route: i });
    });
  }
  
  app.get('/users/:id', (req, res) => {
    res.json({ userId: req.params.id });
  });
  
  const server = await createTestServer(app);
  
  try {
    // Test specific route
    let response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/route50',
      method: 'GET'
    });
    
    assertEqual(response.statusCode, 200);
    assertEqual(JSON.parse(response.body).route, 50);
    
    // Test dynamic route
    response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/users/fast123',
      method: 'GET'
    });
    
    assertEqual(response.statusCode, 200);
    assertEqual(JSON.parse(response.body).userId, 'fast123');
  } finally {
    await server.close();
  }
});

runner.test('SimpleRouter should handle basic routing', async () => {
  const app = new SimpleRouter();
  
  app.get('/', (req, res) => {
    res.json({ router: 'simple' });
  });
  
  app.post('/data', (req, res) => {
    res.json({ method: 'POST', router: 'simple' });
  });
  
  const server = await createTestServer(app);
  
  try {
    // Test GET route
    let response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/',
      method: 'GET'
    });
    
    assertEqual(response.statusCode, 200);
    assertEqual(JSON.parse(response.body).router, 'simple');
    
    // Test POST route
    response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/data',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    }, JSON.stringify({ test: 'data' }));
    
    assertEqual(response.statusCode, 200);
    assertEqual(JSON.parse(response.body).method, 'POST');
  } finally {
    await server.close();
  }
});

// Run the tests
runner.run().then(success => {
  process.exit(success ? 0 : 1);
});