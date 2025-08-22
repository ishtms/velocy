const { TestRunner, createTestServer, makeRequest, assert, assertEqual, assertIncludes, wait } = require('./test-helper');
const { Router, bodyParser, cors, cookieParser, compression, rateLimit, session, static: staticMiddleware } = require('../index');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');

const runner = new TestRunner('Integration Tests');

runner.test('Should handle complete REST API workflow', async () => {
  const app = new Router();
  
  // Setup middleware stack
  app.use(cors());
  app.use(compression());
  app.use(bodyParser.json());
  app.use(bodyParser.urlencoded({ extended: true }));
  app.use(cookieParser('secret'));
  app.use(session({
    secret: 'test-secret',
    resave: false,
    saveUninitialized: true
  }));
  
  // In-memory database
  let users = [];
  let nextId = 1;
  
  // Authentication middleware
  const authenticate = (req, res, next) => {
    if (req.session.userId || req.path === '/api/login') {
      next();
    } else {
      res.status(401).json({ error: 'Not authenticated' });
    }
  };
  
  // Login
  app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (username === 'admin' && password === 'password') {
      req.session.userId = 1;
      req.session.username = username;
      res.json({ success: true, username });
    } else {
      res.status(401).json({ error: 'Invalid credentials' });
    }
  });
  
  // Logout
  app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
  });
  
  // Protected routes
  app.use('/api/users', authenticate);
  
  // CRUD operations
  app.get('/api/users', (req, res) => {
    res.json(users);
  });
  
  app.get('/api/users/:id', (req, res) => {
    const user = users.find(u => u.id === parseInt(req.params.id));
    if (user) {
      res.json(user);
    } else {
      res.status(404).json({ error: 'User not found' });
    }
  });
  
  app.post('/api/users', (req, res) => {
    const user = {
      id: nextId++,
      ...req.body,
      createdAt: new Date().toISOString()
    };
    users.push(user);
    res.status(201).json(user);
  });
  
  app.put('/api/users/:id', (req, res) => {
    const index = users.findIndex(u => u.id === parseInt(req.params.id));
    if (index !== -1) {
      users[index] = { ...users[index], ...req.body };
      res.json(users[index]);
    } else {
      res.status(404).json({ error: 'User not found' });
    }
  });
  
  app.delete('/api/users/:id', (req, res) => {
    const index = users.findIndex(u => u.id === parseInt(req.params.id));
    if (index !== -1) {
      const deleted = users.splice(index, 1)[0];
      res.json({ deleted });
    } else {
      res.status(404).json({ error: 'User not found' });
    }
  });
  
  const server = await createTestServer(app);
  
  try {
    // Try to access protected route without auth
    let response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/api/users',
      method: 'GET'
    });
    
    assertEqual(response.statusCode, 401);
    
    // Login
    response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/api/login',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    }, JSON.stringify({
      username: 'admin',
      password: 'password'
    }));
    
    assertEqual(response.statusCode, 200);
    const sessionCookie = response.headers['set-cookie'][0];
    
    // Create user
    response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/api/users',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': sessionCookie
      }
    }, JSON.stringify({
      name: 'John Doe',
      email: 'john@example.com'
    }));
    
    assertEqual(response.statusCode, 201);
    const user = JSON.parse(response.body);
    assert(user.id);
    assertEqual(user.name, 'John Doe');
    
    // Get all users
    response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/api/users',
      method: 'GET',
      headers: {
        'Cookie': sessionCookie
      }
    });
    
    assertEqual(response.statusCode, 200);
    const users = JSON.parse(response.body);
    assertEqual(users.length, 1);
    
    // Update user
    response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: `/api/users/${user.id}`,
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': sessionCookie
      }
    }, JSON.stringify({
      name: 'Jane Doe'
    }));
    
    assertEqual(response.statusCode, 200);
    assertEqual(JSON.parse(response.body).name, 'Jane Doe');
    
    // Delete user
    response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: `/api/users/${user.id}`,
      method: 'DELETE',
      headers: {
        'Cookie': sessionCookie
      }
    });
    
    assertEqual(response.statusCode, 200);
    
    // Verify deletion
    response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: `/api/users/${user.id}`,
      method: 'GET',
      headers: {
        'Cookie': sessionCookie
      }
    });
    
    assertEqual(response.statusCode, 404);
    
    // Logout
    response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/api/logout',
      method: 'POST',
      headers: {
        'Cookie': sessionCookie
      }
    });
    
    assertEqual(response.statusCode, 200);
  } finally {
    await server.close();
  }
});

runner.test('Should handle mixed HTTP and WebSocket', async () => {
  const app = new Router();
  
  // HTTP routes
  app.get('/status', (req, res) => {
    res.json({ status: 'online', connections: wsConnections.size });
  });
  
  // WebSocket tracking
  const wsConnections = new Set();
  
  // WebSocket route
  app.ws('/live', (ws, req) => {
    wsConnections.add(ws);
    
    ws.on('close', () => {
      wsConnections.delete(ws);
    });
    
    ws.on('message', (message) => {
      // Broadcast to all connections
      wsConnections.forEach(client => {
        if (client.readyState === 1) {
          client.send(`Broadcast: ${message}`);
        }
      });
    });
    
    ws.send('Connected to live updates');
  });
  
  const server = await createTestServer(app);
  
  try {
    // Check initial status
    let response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/status',
      method: 'GET'
    });
    
    assertEqual(response.statusCode, 200);
    assertEqual(JSON.parse(response.body).connections, 0);
    
    // Connect WebSocket
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/live`);
    
    await new Promise((resolve) => ws.on('open', resolve));
    await wait(100);
    
    // Check status with active connection
    response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/status',
      method: 'GET'
    });
    
    assertEqual(response.statusCode, 200);
    assertEqual(JSON.parse(response.body).connections, 1);
    
    // Send WebSocket message
    ws.send('Test message');
    
    const message = await new Promise((resolve) => {
      ws.once('message', (data) => {
        if (data.toString().includes('Broadcast')) {
          resolve(data.toString());
        }
      });
    });
    
    assertIncludes(message, 'Test message');
    
    ws.close();
    await wait(100);
    
    // Check status after disconnect
    response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/status',
      method: 'GET'
    });
    
    assertEqual(response.statusCode, 200);
    assertEqual(JSON.parse(response.body).connections, 0);
  } finally {
    await server.close();
  }
});

runner.test('Should handle complex middleware chain', async () => {
  const app = new Router();
  const requestLog = [];
  
  // Logging middleware
  app.use((req, res, next) => {
    const entry = {
      method: req.method,
      path: req.path,
      timestamp: Date.now()
    };
    requestLog.push(entry);
    req.logEntry = entry;
    next();
  });
  
  // Rate limiting for API
  app.use('/api', rateLimit({
    windowMs: 1000,
    max: 5
  }));
  
  // CORS for API
  app.use('/api', cors({
    origin: 'http://localhost:3000'
  }));
  
  // Body parsing
  app.use(bodyParser.json());
  
  // Session
  app.use(session({
    secret: 'test',
    resave: false,
    saveUninitialized: true
  }));
  
  // Timing middleware
  app.use((req, res, next) => {
    const start = Date.now();
    const originalEnd = res.end;
    res.end = function(...args) {
      req.logEntry.duration = Date.now() - start;
      originalEnd.apply(res, args);
    };
    next();
  });
  
  // Routes
  app.get('/api/data', (req, res) => {
    req.session.views = (req.session.views || 0) + 1;
    res.json({
      views: req.session.views,
      requests: requestLog.length
    });
  });
  
  const server = await createTestServer(app);
  
  try {
    // Make multiple requests
    for (let i = 0; i < 3; i++) {
      const response = await makeRequest({
        hostname: '127.0.0.1',
        port: server.port,
        path: '/api/data',
        method: 'GET',
        headers: {
          'Origin': 'http://localhost:3000'
        }
      });
      
      assertEqual(response.statusCode, 200);
      assertEqual(response.headers['access-control-allow-origin'], 'http://localhost:3000');
      assert(response.headers['x-ratelimit-limit']);
      
      if (i === 0) {
        // Save session cookie
        var sessionCookie = response.headers['set-cookie'][0];
      }
    }
    
    // Check request log
    assertEqual(requestLog.length, 3);
    assert(requestLog[0].duration !== undefined);
    
    // Make request with session
    const response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/api/data',
      method: 'GET',
      headers: {
        'Origin': 'http://localhost:3000',
        'Cookie': sessionCookie
      }
    });
    
    assertEqual(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert(body.views > 1); // Session should persist
  } finally {
    await server.close();
  }
});

runner.test('Should handle nested routers with middleware', async () => {
  const app = new Router();
  
  // Main app middleware
  app.use((req, res, next) => {
    req.appLevel = true;
    next();
  });
  
  // API router
  const apiRouter = new Router();
  apiRouter.use((req, res, next) => {
    req.apiLevel = true;
    next();
  });
  
  // V1 router
  const v1Router = new Router();
  v1Router.use((req, res, next) => {
    req.v1Level = true;
    next();
  });
  
  v1Router.get('/test', (req, res) => {
    res.json({
      appLevel: req.appLevel,
      apiLevel: req.apiLevel,
      v1Level: req.v1Level
    });
  });
  
  // Admin router
  const adminRouter = new Router();
  adminRouter.use((req, res, next) => {
    // Admin authentication
    if (!req.headers.authorization) {
      return res.status(401).json({ error: 'Admin access required' });
    }
    next();
  });
  
  adminRouter.get('/dashboard', (req, res) => {
    res.json({ admin: true });
  });
  
  // Mount routers
  apiRouter.nest('/v1', v1Router);
  app.nest('/api', apiRouter);
  app.nest('/admin', adminRouter);
  
  const server = await createTestServer(app);
  
  try {
    // Test nested middleware execution
    let response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/api/v1/test',
      method: 'GET'
    });
    
    assertEqual(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert(body.appLevel);
    assert(body.apiLevel);
    assert(body.v1Level);
    
    // Test admin without auth
    response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/admin/dashboard',
      method: 'GET'
    });
    
    assertEqual(response.statusCode, 401);
    
    // Test admin with auth
    response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/admin/dashboard',
      method: 'GET',
      headers: {
        'Authorization': 'Bearer admin-token'
      }
    });
    
    assertEqual(response.statusCode, 200);
    assertEqual(JSON.parse(response.body).admin, true);
  } finally {
    await server.close();
  }
});

runner.test('Should handle file uploads with validation', async () => {
  const app = new Router();
  
  app.use(bodyParser.json());
  app.use(bodyParser.urlencoded({ extended: true }));
  
  // Simulate file upload handling
  app.post('/upload', (req, res) => {
    const contentType = req.headers['content-type'] || '';
    
    if (!contentType.includes('multipart/form-data')) {
      return res.status(400).json({ error: 'Must use multipart/form-data' });
    }
    
    // Simulate file validation
    const boundary = contentType.split('boundary=')[1];
    if (!boundary) {
      return res.status(400).json({ error: 'No boundary found' });
    }
    
    res.json({
      success: true,
      contentType,
      boundary
    });
  });
  
  const server = await createTestServer(app);
  
  try {
    // Test with wrong content type
    let response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/upload',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    }, JSON.stringify({ file: 'data' }));
    
    assertEqual(response.statusCode, 400);
    assertIncludes(response.body, 'multipart/form-data');
    
    // Test with correct content type
    const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
    response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/upload',
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`
      }
    }, 'dummy data');
    
    assertEqual(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert(body.success);
    assertEqual(body.boundary, boundary);
  } finally {
    await server.close();
  }
});

runner.test('Should handle graceful shutdown', async () => {
  const app = new Router();
  const connections = new Set();
  
  app.get('/long', async (req, res) => {
    connections.add(res);
    // Simulate long-running request
    await new Promise(resolve => setTimeout(resolve, 100));
    connections.delete(res);
    res.json({ completed: true });
  });
  
  app.get('/quick', (req, res) => {
    res.json({ quick: true });
  });
  
  const server = await createTestServer(app);
  
  try {
    // Start a long request (don't await)
    const longPromise = makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/long',
      method: 'GET'
    });
    
    // Quick request should work
    const quickResponse = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/quick',
      method: 'GET'
    });
    
    assertEqual(quickResponse.statusCode, 200);
    
    // Wait for long request
    const longResponse = await longPromise;
    assertEqual(longResponse.statusCode, 200);
    
    // Verify no hanging connections
    assertEqual(connections.size, 0);
  } finally {
    await server.close();
  }
});

// Run the tests
runner.run().then(success => {
  process.exit(success ? 0 : 1);
});