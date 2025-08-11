const { TestRunner, createTestServer, makeRequest, assert, assertEqual } = require('./test-helper');
const { Router } = require('../index');

const runner = new TestRunner('Routing Tests');

runner.test('Should handle basic routes', async () => {
  const app = new Router();
  
  app.get('/', (req, res) => {
    res.json({ route: 'home' });
  });
  
  app.get('/about', (req, res) => {
    res.json({ route: 'about' });
  });
  
  app.post('/users', (req, res) => {
    res.json({ route: 'create-user' });
  });
  
  const server = await createTestServer(app);
  
  try {
    // Test GET /
    let response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/',
      method: 'GET'
    });
    
    assertEqual(response.statusCode, 200);
    assertEqual(JSON.parse(response.body).route, 'home');
    
    // Test GET /about
    response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/about',
      method: 'GET'
    });
    
    assertEqual(response.statusCode, 200);
    assertEqual(JSON.parse(response.body).route, 'about');
    
    // Test POST /users
    response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/users',
      method: 'POST'
    });
    
    assertEqual(response.statusCode, 200);
    assertEqual(JSON.parse(response.body).route, 'create-user');
  } finally {
    await server.close();
  }
});

runner.test('Should handle dynamic parameters', async () => {
  const app = new Router();
  
  app.get('/users/:id', (req, res) => {
    res.json({ userId: req.params.id });
  });
  
  app.get('/posts/:postId/comments/:commentId', (req, res) => {
    res.json({
      postId: req.params.postId,
      commentId: req.params.commentId
    });
  });
  
  const server = await createTestServer(app);
  
  try {
    // Test single parameter
    let response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/users/123',
      method: 'GET'
    });
    
    assertEqual(response.statusCode, 200);
    assertEqual(JSON.parse(response.body).userId, '123');
    
    // Test multiple parameters
    response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/posts/456/comments/789',
      method: 'GET'
    });
    
    assertEqual(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assertEqual(body.postId, '456');
    assertEqual(body.commentId, '789');
  } finally {
    await server.close();
  }
});

runner.test('Should handle wildcard routes', async () => {
  const app = new Router();
  
  // Single segment wildcard
  app.get('/files/*', (req, res) => {
    res.json({ 
      wildcard: req.params['*'],
      path: req.path 
    });
  });
  
  // Multi-segment catch-all wildcard  
  app.get('/static/**', (req, res) => {
    res.json({ 
      catchAll: req.params['**'],
      path: req.path 
    });
  });
  
  const server = await createTestServer(app);
  
  try {
    // Test single segment wildcard (matches one segment only)
    let response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/files/document.pdf',
      method: 'GET'
    });
    
    assertEqual(response.statusCode, 200);
    const body1 = JSON.parse(response.body);
    assertEqual(body1.wildcard, 'document.pdf', 'Should capture single segment');
    
    // Test multi-segment catch-all wildcard
    response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/static/images/logo.png',
      method: 'GET'
    });
    
    assertEqual(response.statusCode, 200);
    const body2 = JSON.parse(response.body);
    assertEqual(body2.catchAll, 'images/logo.png', 'Should capture multiple segments');
    
  } finally {
    await server.close();
  }
});

runner.test('Should return 404 for undefined routes', async () => {
  const app = new Router();
  
  app.get('/exists', (req, res) => {
    res.json({ exists: true });
  });
  
  const server = await createTestServer(app);
  
  try {
    // Test existing route
    let response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/exists',
      method: 'GET'
    });
    
    assertEqual(response.statusCode, 200);
    
    // Test non-existing route
    response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/does-not-exist',
      method: 'GET'
    });
    
    assertEqual(response.statusCode, 404);
  } finally {
    await server.close();
  }
});

runner.test('Should handle all HTTP methods', async () => {
  const app = new Router();
  
  app.get('/resource', (req, res) => res.json({ method: 'GET' }));
  app.post('/resource', (req, res) => res.json({ method: 'POST' }));
  app.put('/resource', (req, res) => res.json({ method: 'PUT' }));
  app.delete('/resource', (req, res) => res.json({ method: 'DELETE' }));
  app.patch('/resource', (req, res) => res.json({ method: 'PATCH' }));
  
  const server = await createTestServer(app);
  
  try {
    const methods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];
    
    for (const method of methods) {
      const response = await makeRequest({
        hostname: '127.0.0.1',
        port: server.port,
        path: '/resource',
        method: method
      });
      
      assertEqual(response.statusCode, 200);
      assertEqual(JSON.parse(response.body).method, method);
    }
  } finally {
    await server.close();
  }
});

runner.test('Should handle route priority correctly', async () => {
  const app = new Router();
  
  // Static route should have priority over dynamic
  app.get('/users/me', (req, res) => {
    res.json({ route: 'me' });
  });
  
  app.get('/users/:id', (req, res) => {
    res.json({ route: 'dynamic', id: req.params.id });
  });
  
  const server = await createTestServer(app);
  
  try {
    // Test static route
    let response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/users/me',
      method: 'GET'
    });
    
    assertEqual(response.statusCode, 200);
    assertEqual(JSON.parse(response.body).route, 'me');
    
    // Test dynamic route
    response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/users/123',
      method: 'GET'
    });
    
    assertEqual(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assertEqual(body.route, 'dynamic');
    assertEqual(body.id, '123');
  } finally {
    await server.close();
  }
});

runner.test('Should handle nested routers', async () => {
  const app = new Router();
  const apiRouter = new Router();
  const v1Router = new Router();
  
  v1Router.get('/users', (req, res) => {
    res.json({ version: 'v1', resource: 'users' });
  });
  
  v1Router.get('/posts', (req, res) => {
    res.json({ version: 'v1', resource: 'posts' });
  });
  
  apiRouter.nest('/v1', v1Router);
  app.nest('/api', apiRouter);
  
  const server = await createTestServer(app);
  
  try {
    // Test nested route
    let response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/api/v1/users',
      method: 'GET'
    });
    
    assertEqual(response.statusCode, 200);
    let body = JSON.parse(response.body);
    assertEqual(body.version, 'v1');
    assertEqual(body.resource, 'users');
    
    // Test another nested route
    response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/api/v1/posts',
      method: 'GET'
    });
    
    assertEqual(response.statusCode, 200);
    body = JSON.parse(response.body);
    assertEqual(body.version, 'v1');
    assertEqual(body.resource, 'posts');
  } finally {
    await server.close();
  }
});

runner.test('Should handle merged routers', async () => {
  const app = new Router();
  const userRouter = new Router();
  const postRouter = new Router();
  
  userRouter.get('/users', (req, res) => {
    res.json({ resource: 'users' });
  });
  
  userRouter.get('/users/:id', (req, res) => {
    res.json({ resource: 'user', id: req.params.id });
  });
  
  postRouter.get('/posts', (req, res) => {
    res.json({ resource: 'posts' });
  });
  
  app.merge(userRouter);
  app.merge(postRouter);
  
  const server = await createTestServer(app);
  
  try {
    // Test merged user routes
    let response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/users',
      method: 'GET'
    });
    
    assertEqual(response.statusCode, 200);
    assertEqual(JSON.parse(response.body).resource, 'users');
    
    // Test merged post routes
    response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/posts',
      method: 'GET'
    });
    
    assertEqual(response.statusCode, 200);
    assertEqual(JSON.parse(response.body).resource, 'posts');
  } finally {
    await server.close();
  }
});

// Run the tests
runner.run().then(success => {
  process.exit(success ? 0 : 1);
});