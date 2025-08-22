const { TestRunner, createTestServer, makeRequest, assert, assertEqual, assertIncludes, wait } = require('./test-helper');
const { Router, rateLimit } = require('../index');

const runner = new TestRunner('Rate Limiting Tests');

runner.test('Should limit requests per window', async () => {
  const app = new Router();
  
  app.use(rateLimit({
    windowMs: 1000, // 1 second window
    max: 3, // limit to 3 requests
    message: 'Too many requests'
  }));
  
  app.get('/test', (req, res) => {
    res.json({ success: true });
  });
  
  const server = await createTestServer(app);
  
  try {
    // Make 3 requests (should all succeed)
    for (let i = 0; i < 3; i++) {
      const response = await makeRequest({
        hostname: '127.0.0.1',
        port: server.port,
        path: '/test',
        method: 'GET'
      });
      
      assertEqual(response.statusCode, 200);
      assert(response.headers['x-ratelimit-limit'], 'Should have limit header');
      assert(response.headers['x-ratelimit-remaining'], 'Should have remaining header');
    }
    
    // 4th request should be rate limited
    const response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/test',
      method: 'GET'
    });
    
    assertEqual(response.statusCode, 429);
    assertIncludes(response.body, 'Too many requests');
    assertEqual(response.headers['x-ratelimit-remaining'], '0');
    
    // Wait for window to reset
    await wait(1100);
    
    // Should be able to make requests again
    const newResponse = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/test',
      method: 'GET'
    });
    
    assertEqual(newResponse.statusCode, 200);
  } finally {
    await server.close();
  }
});

runner.test('Should track rate limits per IP', async () => {
  const app = new Router();
  
  app.use(rateLimit({
    windowMs: 1000,
    max: 2,
    keyGenerator: (req) => req.ip || req.connection.remoteAddress
  }));
  
  app.get('/test', (req, res) => {
    res.json({ ip: req.ip });
  });
  
  const server = await createTestServer(app);
  
  try {
    // Make requests from "different IPs" (simulated via headers)
    const response1 = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/test',
      method: 'GET',
      headers: {
        'X-Forwarded-For': '192.168.1.1'
      }
    });
    
    assertEqual(response1.statusCode, 200);
    
    const response2 = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/test',
      method: 'GET',
      headers: {
        'X-Forwarded-For': '192.168.1.2'
      }
    });
    
    assertEqual(response2.statusCode, 200);
    
    // Both IPs should have independent limits
    assert(response1.headers['x-ratelimit-remaining'], '1');
    assert(response2.headers['x-ratelimit-remaining'], '1');
  } finally {
    await server.close();
  }
});

runner.test('Should skip rate limiting based on condition', async () => {
  const app = new Router();
  
  app.use(rateLimit({
    windowMs: 1000,
    max: 1,
    skip: (req) => {
      // Skip rate limiting for authenticated users
      return req.headers.authorization === 'Bearer token123';
    }
  }));
  
  app.get('/test', (req, res) => {
    res.json({ success: true });
  });
  
  const server = await createTestServer(app);
  
  try {
    // Make request without auth (should be rate limited)
    let response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/test',
      method: 'GET'
    });
    
    assertEqual(response.statusCode, 200);
    
    // Second request without auth should be blocked
    response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/test',
      method: 'GET'
    });
    
    assertEqual(response.statusCode, 429);
    
    // Request with auth should bypass rate limit
    response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/test',
      method: 'GET',
      headers: {
        'Authorization': 'Bearer token123'
      }
    });
    
    assertEqual(response.statusCode, 200);
  } finally {
    await server.close();
  }
});

runner.test('Should handle custom error responses', async () => {
  const app = new Router();
  
  app.use(rateLimit({
    windowMs: 1000,
    max: 1,
    handler: (req, res) => {
      res.status(429).json({
        error: 'Custom rate limit message',
        retryAfter: res.getHeader('Retry-After')
      });
    }
  }));
  
  app.get('/test', (req, res) => {
    res.json({ success: true });
  });
  
  const server = await createTestServer(app);
  
  try {
    // First request succeeds
    let response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/test',
      method: 'GET'
    });
    
    assertEqual(response.statusCode, 200);
    
    // Second request gets custom error
    response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/test',
      method: 'GET'
    });
    
    assertEqual(response.statusCode, 429);
    const body = JSON.parse(response.body);
    assertEqual(body.error, 'Custom rate limit message');
    assert(body.retryAfter, 'Should include retry after');
  } finally {
    await server.close();
  }
});

runner.test('Should handle different rate limits for different routes', async () => {
  const app = new Router();
  
  // Strict limit for login
  app.use('/login', rateLimit({
    windowMs: 60000, // 1 minute
    max: 3,
    message: 'Too many login attempts'
  }));
  
  // Relaxed limit for general API
  app.use('/api', rateLimit({
    windowMs: 1000,
    max: 10,
    message: 'API rate limit exceeded'
  }));
  
  app.post('/login', (req, res) => {
    res.json({ success: true });
  });
  
  app.get('/api/data', (req, res) => {
    res.json({ data: 'test' });
  });
  
  const server = await createTestServer(app);
  
  try {
    // Test login rate limit
    for (let i = 0; i < 3; i++) {
      const response = await makeRequest({
        hostname: '127.0.0.1',
        port: server.port,
        path: '/login',
        method: 'POST'
      });
      
      assertEqual(response.statusCode, 200);
    }
    
    // 4th login should be blocked
    let response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/login',
      method: 'POST'
    });
    
    assertEqual(response.statusCode, 429);
    assertIncludes(response.body, 'Too many login attempts');
    
    // API should still work with its own limit
    for (let i = 0; i < 5; i++) {
      response = await makeRequest({
        hostname: '127.0.0.1',
        port: server.port,
        path: '/api/data',
        method: 'GET'
      });
      
      assertEqual(response.statusCode, 200);
    }
  } finally {
    await server.close();
  }
});

runner.test('Should include rate limit headers', async () => {
  const app = new Router();
  
  app.use(rateLimit({
    windowMs: 60000, // 1 minute
    max: 100,
    standardHeaders: true,
    legacyHeaders: false
  }));
  
  app.get('/test', (req, res) => {
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
    
    // Check standard headers
    assert(response.headers['ratelimit-limit'], 'Should have RateLimit-Limit header');
    assert(response.headers['ratelimit-remaining'], 'Should have RateLimit-Remaining header');
    assert(response.headers['ratelimit-reset'], 'Should have RateLimit-Reset header');
    
    const limit = parseInt(response.headers['ratelimit-limit']);
    const remaining = parseInt(response.headers['ratelimit-remaining']);
    
    assertEqual(limit, 100);
    assertEqual(remaining, 99); // One request made
  } finally {
    await server.close();
  }
});

runner.test('Should handle store-based rate limiting', async () => {
  // Simple in-memory store
  class MemoryStore {
    constructor() {
      this.hits = new Map();
    }
    
    increment(key) {
      const current = this.hits.get(key) || 0;
      this.hits.set(key, current + 1);
      return current + 1;
    }
    
    decrement(key) {
      const current = this.hits.get(key) || 0;
      if (current > 0) {
        this.hits.set(key, current - 1);
      }
    }
    
    reset(key) {
      this.hits.delete(key);
    }
    
    resetAll() {
      this.hits.clear();
    }
  }
  
  const app = new Router();
  const store = new MemoryStore();
  
  app.use(rateLimit({
    windowMs: 1000,
    max: 2,
    store: store
  }));
  
  app.get('/test', (req, res) => {
    res.json({ success: true });
  });
  
  const server = await createTestServer(app);
  
  try {
    // Make requests
    for (let i = 0; i < 2; i++) {
      const response = await makeRequest({
        hostname: '127.0.0.1',
        port: server.port,
        path: '/test',
        method: 'GET'
      });
      
      assertEqual(response.statusCode, 200);
    }
    
    // Check store has tracked hits
    assert(store.hits.size > 0, 'Store should have tracked hits');
    
    // Clear store
    store.resetAll();
    
    // Should be able to make requests again
    const response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/test',
      method: 'GET'
    });
    
    assertEqual(response.statusCode, 200);
  } finally {
    await server.close();
  }
});

runner.test('Should handle skipSuccessfulRequests option', async () => {
  const app = new Router();
  
  app.use(rateLimit({
    windowMs: 1000,
    max: 2,
    skipSuccessfulRequests: true
  }));
  
  app.get('/success', (req, res) => {
    res.json({ success: true });
  });
  
  app.get('/error', (req, res) => {
    res.status(400).json({ error: 'Bad request' });
  });
  
  const server = await createTestServer(app);
  
  try {
    // Successful requests shouldn't count towards limit
    for (let i = 0; i < 3; i++) {
      const response = await makeRequest({
        hostname: '127.0.0.1',
        port: server.port,
        path: '/success',
        method: 'GET'
      });
      
      assertEqual(response.statusCode, 200);
    }
    
    // Error requests should count
    for (let i = 0; i < 2; i++) {
      const response = await makeRequest({
        hostname: '127.0.0.1',
        port: server.port,
        path: '/error',
        method: 'GET'
      });
      
      assertEqual(response.statusCode, 400);
    }
    
    // Next error request should be rate limited
    const response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/error',
      method: 'GET'
    });
    
    assertEqual(response.statusCode, 429);
  } finally {
    await server.close();
  }
});

// Run the tests
runner.run().then(success => {
  process.exit(success ? 0 : 1);
});