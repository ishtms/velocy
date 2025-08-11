const { TestRunner, createTestServer, makeRequest, assert, assertEqual, assertIncludes } = require('./test-helper');
const { Router } = require('../index');

const runner = new TestRunner('Middleware Tests');

runner.test('Global middleware should execute for all routes', async () => {
  const app = new Router();
  let middlewareExecuted = false;
  
  app.use((req, res, next) => {
    middlewareExecuted = true;
    req.customHeader = 'from-middleware';
    next();
  });
  
  app.get('/test', (req, res) => {
    res.json({ header: req.customHeader });
  });
  
  const server = await createTestServer(app);
  
  try {
    const response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/test',
      method: 'GET'
    });
    
    assert(middlewareExecuted, 'Middleware should have executed');
    assertEqual(response.statusCode, 200);
    
    const body = JSON.parse(response.body);
    assertEqual(body.header, 'from-middleware');
  } finally {
    await server.close();
  }
});

runner.test('Multiple middleware should execute in order', async () => {
  const app = new Router();
  const executionOrder = [];
  
  app.use((req, res, next) => {
    executionOrder.push('first');
    req.data = 'first';
    next();
  });
  
  app.use((req, res, next) => {
    executionOrder.push('second');
    req.data += '-second';
    next();
  });
  
  app.get('/', (req, res) => {
    executionOrder.push('handler');
    res.json({ data: req.data, order: executionOrder });
  });
  
  const server = await createTestServer(app);
  
  try {
    const response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/',
      method: 'GET'
    });
    
    assertEqual(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assertEqual(body.data, 'first-second');
    assertEqual(body.order.join(','), 'first,second,handler');
  } finally {
    await server.close();
  }
});

runner.test('Path-specific middleware should only execute for matching paths', async () => {
  const app = new Router();
  let apiMiddlewareExecuted = false;
  let adminMiddlewareExecuted = false;
  
  app.use('/api', (req, res, next) => {
    apiMiddlewareExecuted = true;
    req.isApi = true;
    next();
  });
  
  app.use('/admin', (req, res, next) => {
    adminMiddlewareExecuted = true;
    req.isAdmin = true;
    next();
  });
  
  app.get('/api/users', (req, res) => {
    res.json({ isApi: req.isApi || false, isAdmin: req.isAdmin || false });
  });
  
  app.get('/public', (req, res) => {
    res.json({ isApi: req.isApi || false, isAdmin: req.isAdmin || false });
  });
  
  const server = await createTestServer(app);
  
  try {
    // Test /api path
    apiMiddlewareExecuted = false;
    adminMiddlewareExecuted = false;
    
    let response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/api/users',
      method: 'GET'
    });
    
    assertEqual(response.statusCode, 200);
    let body = JSON.parse(response.body);
    assert(body.isApi === true, 'API middleware should have set isApi');
    assert(body.isAdmin === false, 'Admin middleware should not have run');
    
    // Test /public path
    apiMiddlewareExecuted = false;
    adminMiddlewareExecuted = false;
    
    response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/public',
      method: 'GET'
    });
    
    assertEqual(response.statusCode, 200);
    body = JSON.parse(response.body);
    assert(body.isApi === false, 'API middleware should not have run');
    assert(body.isAdmin === false, 'Admin middleware should not have run');
  } finally {
    await server.close();
  }
});

runner.test('Error middleware should catch errors', async () => {
  const app = new Router();
  
  app.get('/error', (req, res, next) => {
    next(new Error('Test error'));
  });
  
  app.get('/no-error', (req, res) => {
    res.json({ success: true });
  });
  
  // Error middleware (4 parameters)
  app.use((err, req, res, next) => {
    res.status(500).json({ 
      error: true, 
      message: err.message 
    });
  });
  
  const server = await createTestServer(app);
  
  try {
    // Test error route
    let response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/error',
      method: 'GET'
    });
    
    assertEqual(response.statusCode, 500);
    let body = JSON.parse(response.body);
    assert(body.error === true);
    assertEqual(body.message, 'Test error');
    
    // Test normal route
    response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/no-error',
      method: 'GET'
    });
    
    assertEqual(response.statusCode, 200);
    body = JSON.parse(response.body);
    assert(body.success === true);
  } finally {
    await server.close();
  }
});

runner.test('Route-specific middleware should work', async () => {
  const app = new Router();
  const executionOrder = [];
  
  const middleware1 = (req, res, next) => {
    executionOrder.push('m1');
    req.m1 = true;
    next();
  };
  
  const middleware2 = (req, res, next) => {
    executionOrder.push('m2');
    req.m2 = true;
    next();
  };
  
  app.get('/test', middleware1, middleware2, (req, res) => {
    executionOrder.push('handler');
    res.json({ 
      m1: req.m1 || false, 
      m2: req.m2 || false,
      order: executionOrder 
    });
  });
  
  const server = await createTestServer(app);
  
  try {
    const response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/test',
      method: 'GET'
    });
    
    assertEqual(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert(body.m1 === true);
    assert(body.m2 === true);
    assertEqual(body.order.join(','), 'm1,m2,handler');
  } finally {
    await server.close();
  }
});

runner.test('Async middleware should work correctly', async () => {
  const app = new Router();
  
  app.use(async (req, res, next) => {
    await new Promise(resolve => setTimeout(resolve, 10));
    req.asyncData = 'processed';
    next();
  });
  
  app.get('/async', async (req, res) => {
    await new Promise(resolve => setTimeout(resolve, 10));
    res.json({ data: req.asyncData });
  });
  
  const server = await createTestServer(app);
  
  try {
    const response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/async',
      method: 'GET'
    });
    
    assertEqual(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assertEqual(body.data, 'processed');
  } finally {
    await server.close();
  }
});

runner.test('Middleware can short-circuit response', async () => {
  const app = new Router();
  
  app.use('/protected', (req, res, next) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
  });
  
  app.get('/protected/data', (req, res) => {
    res.json({ secret: 'data' });
  });
  
  const server = await createTestServer(app);
  
  try {
    // Without auth
    let response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/protected/data',
      method: 'GET'
    });
    
    assertEqual(response.statusCode, 401);
    let body = JSON.parse(response.body);
    assertEqual(body.error, 'Unauthorized');
    
    // With auth
    response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/protected/data',
      method: 'GET',
      headers: {
        'Authorization': 'Bearer token123'
      }
    });
    
    assertEqual(response.statusCode, 200);
    body = JSON.parse(response.body);
    assertEqual(body.secret, 'data');
  } finally {
    await server.close();
  }
});

// Run the tests
runner.run().then(success => {
  process.exit(success ? 0 : 1);
});