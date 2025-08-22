const { TestRunner, createTestServer, makeRequest, assert, assertEqual, assertIncludes, wait } = require('./test-helper');
const { Router, session } = require('../index');

const runner = new TestRunner('Session Tests');

runner.test('Should create and maintain sessions', async () => {
  const app = new Router();
  
  app.use(session({
    secret: 'test-secret',
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 1000 * 60 * 60 } // 1 hour
  }));
  
  app.get('/count', (req, res) => {
    if (!req.session.views) {
      req.session.views = 0;
    }
    req.session.views++;
    res.json({ views: req.session.views });
  });
  
  const server = await createTestServer(app);
  
  try {
    // First request - should create session
    let response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/count',
      method: 'GET'
    });
    
    assertEqual(response.statusCode, 200);
    assertEqual(JSON.parse(response.body).views, 1);
    
    // Get session cookie
    const cookies = response.headers['set-cookie'];
    assert(cookies, 'Should set session cookie');
    const sessionCookie = cookies[0];
    
    // Second request with same session
    response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/count',
      method: 'GET',
      headers: {
        'Cookie': sessionCookie
      }
    });
    
    assertEqual(response.statusCode, 200);
    assertEqual(JSON.parse(response.body).views, 2);
    
    // Third request with same session
    response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/count',
      method: 'GET',
      headers: {
        'Cookie': sessionCookie
      }
    });
    
    assertEqual(response.statusCode, 200);
    assertEqual(JSON.parse(response.body).views, 3);
  } finally {
    await server.close();
  }
});

runner.test('Should handle session data storage', async () => {
  const app = new Router();
  
  app.use(session({
    secret: 'test-secret',
    resave: false,
    saveUninitialized: false
  }));
  
  app.post('/login', (req, res) => {
    req.session.user = {
      id: 1,
      username: 'testuser',
      role: 'admin'
    };
    req.session.loginTime = Date.now();
    res.json({ success: true });
  });
  
  app.get('/profile', (req, res) => {
    if (!req.session.user) {
      return res.status(401).json({ error: 'Not logged in' });
    }
    res.json({
      user: req.session.user,
      loginTime: req.session.loginTime
    });
  });
  
  app.post('/logout', (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ error: 'Logout failed' });
      }
      res.json({ success: true });
    });
  });
  
  const server = await createTestServer(app);
  
  try {
    // Login
    let response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/login',
      method: 'POST'
    });
    
    assertEqual(response.statusCode, 200);
    const sessionCookie = response.headers['set-cookie'][0];
    
    // Access profile with session
    response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/profile',
      method: 'GET',
      headers: {
        'Cookie': sessionCookie
      }
    });
    
    assertEqual(response.statusCode, 200);
    const profile = JSON.parse(response.body);
    assertEqual(profile.user.username, 'testuser');
    assertEqual(profile.user.role, 'admin');
    assert(profile.loginTime, 'Should have login time');
    
    // Logout
    response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/logout',
      method: 'POST',
      headers: {
        'Cookie': sessionCookie
      }
    });
    
    assertEqual(response.statusCode, 200);
    
    // Try to access profile after logout
    response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/profile',
      method: 'GET',
      headers: {
        'Cookie': sessionCookie
      }
    });
    
    assertEqual(response.statusCode, 401);
  } finally {
    await server.close();
  }
});

runner.test('Should handle session regeneration', async () => {
  const app = new Router();
  
  app.use(session({
    secret: 'test-secret',
    resave: false,
    saveUninitialized: true
  }));
  
  app.get('/session-id', (req, res) => {
    res.json({ sessionId: req.sessionID });
  });
  
  app.post('/regenerate', (req, res) => {
    const oldId = req.sessionID;
    req.session.regenerate((err) => {
      if (err) {
        return res.status(500).json({ error: 'Regeneration failed' });
      }
      res.json({
        oldId,
        newId: req.sessionID
      });
    });
  });
  
  const server = await createTestServer(app);
  
  try {
    // Get initial session
    let response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/session-id',
      method: 'GET'
    });
    
    assertEqual(response.statusCode, 200);
    const initialId = JSON.parse(response.body).sessionId;
    const sessionCookie = response.headers['set-cookie'][0];
    
    // Regenerate session
    response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/regenerate',
      method: 'POST',
      headers: {
        'Cookie': sessionCookie
      }
    });
    
    assertEqual(response.statusCode, 200);
    const regenerateResult = JSON.parse(response.body);
    assertEqual(regenerateResult.oldId, initialId);
    assert(regenerateResult.newId !== initialId, 'Should have new session ID');
  } finally {
    await server.close();
  }
});

runner.test('Should handle session options', async () => {
  const app = new Router();
  
  app.use(session({
    secret: 'test-secret',
    name: 'custom-session-id',
    resave: true,
    saveUninitialized: false,
    cookie: {
      secure: false,
      httpOnly: true,
      maxAge: 1000 * 60, // 1 minute
      sameSite: 'strict'
    }
  }));
  
  app.get('/test', (req, res) => {
    req.session.test = true;
    res.json({ success: true });
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
    const cookies = response.headers['set-cookie'];
    assert(cookies, 'Should set cookie');
    
    const cookie = cookies[0];
    assertIncludes(cookie, 'custom-session-id=', 'Should use custom session name');
    assertIncludes(cookie, 'HttpOnly', 'Should be HttpOnly');
    assertIncludes(cookie, 'SameSite=Strict', 'Should have SameSite attribute');
    assertIncludes(cookie, 'Max-Age=60', 'Should have correct max age');
  } finally {
    await server.close();
  }
});

runner.test('Should handle concurrent session access', async () => {
  const app = new Router();
  
  app.use(session({
    secret: 'test-secret',
    resave: false,
    saveUninitialized: true
  }));
  
  app.post('/increment', (req, res) => {
    if (!req.session.counter) {
      req.session.counter = 0;
    }
    req.session.counter++;
    res.json({ counter: req.session.counter });
  });
  
  const server = await createTestServer(app);
  
  try {
    // Get initial session
    let response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/increment',
      method: 'POST'
    });
    
    const sessionCookie = response.headers['set-cookie'][0];
    
    // Make concurrent requests
    const promises = [];
    for (let i = 0; i < 5; i++) {
      promises.push(
        makeRequest({
          hostname: '127.0.0.1',
          port: server.port,
          path: '/increment',
          method: 'POST',
          headers: {
            'Cookie': sessionCookie
          }
        })
      );
    }
    
    const responses = await Promise.all(promises);
    
    // Check that all requests succeeded
    responses.forEach(res => {
      assertEqual(res.statusCode, 200);
    });
    
    // Final request to check counter
    response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/increment',
      method: 'POST',
      headers: {
        'Cookie': sessionCookie
      }
    });
    
    const finalCounter = JSON.parse(response.body).counter;
    assert(finalCounter >= 6, 'Counter should be incremented by all requests');
  } finally {
    await server.close();
  }
});

runner.test('Should handle session touch and rolling', async () => {
  const app = new Router();
  
  app.use(session({
    secret: 'test-secret',
    resave: false,
    saveUninitialized: false,
    rolling: true, // Reset expiry on each request
    cookie: {
      maxAge: 1000 * 2 // 2 seconds
    }
  }));
  
  app.get('/touch', (req, res) => {
    req.session.touched = true;
    res.json({ success: true });
  });
  
  const server = await createTestServer(app);
  
  try {
    // Initial request
    let response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/touch',
      method: 'GET'
    });
    
    const sessionCookie = response.headers['set-cookie'][0];
    
    // Wait 1 second
    await wait(1000);
    
    // Touch session (should reset expiry)
    response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/touch',
      method: 'GET',
      headers: {
        'Cookie': sessionCookie.split(';')[0] // Remove attributes
      }
    });
    
    assertEqual(response.statusCode, 200);
    
    // Wait another 1.5 seconds (total 2.5s from first request)
    await wait(1500);
    
    // Session should still be valid due to rolling
    response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/touch',
      method: 'GET',
      headers: {
        'Cookie': sessionCookie.split(';')[0]
      }
    });
    
    assertEqual(response.statusCode, 200);
  } finally {
    await server.close();
  }
});

runner.test('Should handle custom session stores', async () => {
  // Simple in-memory store implementation
  class MemoryStore {
    constructor() {
      this.sessions = new Map();
    }
    
    get(sid, callback) {
      const session = this.sessions.get(sid);
      callback(null, session);
    }
    
    set(sid, session, callback) {
      this.sessions.set(sid, session);
      callback(null);
    }
    
    destroy(sid, callback) {
      this.sessions.delete(sid);
      callback(null);
    }
    
    touch(sid, session, callback) {
      this.sessions.set(sid, session);
      callback(null);
    }
  }
  
  const app = new Router();
  const store = new MemoryStore();
  
  app.use(session({
    secret: 'test-secret',
    store: store,
    resave: false,
    saveUninitialized: true
  }));
  
  app.get('/store-test', (req, res) => {
    req.session.customStore = true;
    res.json({ 
      sessionId: req.sessionID,
      customStore: req.session.customStore
    });
  });
  
  app.get('/store-size', (req, res) => {
    res.json({ 
      storeSize: store.sessions.size 
    });
  });
  
  const server = await createTestServer(app);
  
  try {
    // First request to create session
    let response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/store-test',
      method: 'GET'
    });
    
    assertEqual(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert(body.sessionId, 'Should have session ID');
    assert(body.customStore, 'Should have custom store property');
    
    // Second request to check store size (after session has been saved)
    response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/store-size',
      method: 'GET'
    });
    
    assertEqual(response.statusCode, 200);
    const sizeBody = JSON.parse(response.body);
    assertEqual(sizeBody.storeSize, 1, 'Store should have one session');
  } finally {
    await server.close();
  }
});

// Run the tests
runner.run().then(success => {
  process.exit(success ? 0 : 1);
});