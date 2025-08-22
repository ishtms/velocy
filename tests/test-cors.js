const { TestRunner, createTestServer, makeRequest, assert, assertEqual, assertIncludes } = require('./test-helper');
const { Router, cors } = require('../index');

const runner = new TestRunner('CORS Tests');

runner.test('Should handle simple CORS requests', async () => {
  const app = new Router();
  
  app.use(cors());
  
  app.get('/data', (req, res) => {
    res.json({ message: 'Hello from API' });
  });
  
  const server = await createTestServer(app);
  
  try {
    const response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/data',
      method: 'GET',
      headers: {
        'Origin': 'http://example.com'
      }
    });
    
    assertEqual(response.statusCode, 200);
    assertEqual(response.headers['access-control-allow-origin'], '*');
  } finally {
    await server.close();
  }
});

runner.test('Should handle preflight OPTIONS requests', async () => {
  const app = new Router();
  
  app.use(cors({
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
  }));
  
  app.post('/api/users', (req, res) => {
    res.json({ success: true });
  });
  
  const server = await createTestServer(app);
  
  try {
    // Preflight request
    const response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/api/users',
      method: 'OPTIONS',
      headers: {
        'Origin': 'http://example.com',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type'
      }
    });
    
    assertEqual(response.statusCode, 204);
    assert(response.headers['access-control-allow-methods']);
    assertIncludes(response.headers['access-control-allow-methods'], 'POST');
    assert(response.headers['access-control-allow-headers']);
  } finally {
    await server.close();
  }
});

runner.test('Should handle specific origin configuration', async () => {
  const app = new Router();
  
  app.use(cors({
    origin: 'https://trusted-domain.com'
  }));
  
  app.get('/secure', (req, res) => {
    res.json({ secure: true });
  });
  
  const server = await createTestServer(app);
  
  try {
    // Request from allowed origin
    let response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/secure',
      method: 'GET',
      headers: {
        'Origin': 'https://trusted-domain.com'
      }
    });
    
    assertEqual(response.statusCode, 200);
    assertEqual(response.headers['access-control-allow-origin'], 'https://trusted-domain.com');
    
    // Request from different origin
    response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/secure',
      method: 'GET',
      headers: {
        'Origin': 'http://untrusted.com'
      }
    });
    
    assertEqual(response.statusCode, 200);
    assert(!response.headers['access-control-allow-origin'] || 
           response.headers['access-control-allow-origin'] !== 'http://untrusted.com');
  } finally {
    await server.close();
  }
});

runner.test('Should handle multiple allowed origins', async () => {
  const app = new Router();
  
  const allowedOrigins = [
    'http://localhost:3000',
    'https://app.example.com',
    'https://www.example.com'
  ];
  
  app.use(cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(null, false);
      }
    }
  }));
  
  app.get('/api', (req, res) => {
    res.json({ data: 'test' });
  });
  
  const server = await createTestServer(app);
  
  try {
    // Test each allowed origin
    for (const origin of allowedOrigins) {
      const response = await makeRequest({
        hostname: '127.0.0.1',
        port: server.port,
        path: '/api',
        method: 'GET',
        headers: {
          'Origin': origin
        }
      });
      
      assertEqual(response.statusCode, 200);
      assertEqual(response.headers['access-control-allow-origin'], origin);
    }
    
    // Test disallowed origin
    const response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/api',
      method: 'GET',
      headers: {
        'Origin': 'http://evil.com'
      }
    });
    
    assertEqual(response.statusCode, 200);
    assert(!response.headers['access-control-allow-origin'] || 
           response.headers['access-control-allow-origin'] !== 'http://evil.com');
  } finally {
    await server.close();
  }
});

runner.test('Should handle credentials', async () => {
  const app = new Router();
  
  app.use(cors({
    origin: 'http://localhost:3000',
    credentials: true
  }));
  
  app.get('/auth', (req, res) => {
    res.json({ authenticated: true });
  });
  
  const server = await createTestServer(app);
  
  try {
    const response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/auth',
      method: 'GET',
      headers: {
        'Origin': 'http://localhost:3000',
        'Cookie': 'session=abc123'
      }
    });
    
    assertEqual(response.statusCode, 200);
    assertEqual(response.headers['access-control-allow-credentials'], 'true');
    assertEqual(response.headers['access-control-allow-origin'], 'http://localhost:3000');
  } finally {
    await server.close();
  }
});

runner.test('Should handle custom headers', async () => {
  const app = new Router();
  
  app.use(cors({
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Request-ID'],
    exposedHeaders: ['X-Total-Count', 'X-Page-Number']
  }));
  
  app.get('/data', (req, res) => {
    res.set('X-Total-Count', '100');
    res.set('X-Page-Number', '1');
    res.json({ items: [] });
  });
  
  const server = await createTestServer(app);
  
  try {
    // Preflight for custom headers
    let response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/data',
      method: 'OPTIONS',
      headers: {
        'Origin': 'http://example.com',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'X-API-Key, X-Request-ID'
      }
    });
    
    assertEqual(response.statusCode, 204);
    assertIncludes(response.headers['access-control-allow-headers'], 'X-API-Key');
    assertIncludes(response.headers['access-control-allow-headers'], 'X-Request-ID');
    
    // Actual request
    response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/data',
      method: 'GET',
      headers: {
        'Origin': 'http://example.com',
        'X-API-Key': 'secret-key'
      }
    });
    
    assertEqual(response.statusCode, 200);
    assert(response.headers['access-control-expose-headers']);
    assertIncludes(response.headers['access-control-expose-headers'], 'X-Total-Count');
  } finally {
    await server.close();
  }
});

runner.test('Should handle max age for preflight caching', async () => {
  const app = new Router();
  
  app.use(cors({
    maxAge: 86400 // 24 hours
  }));
  
  app.put('/resource', (req, res) => {
    res.json({ updated: true });
  });
  
  const server = await createTestServer(app);
  
  try {
    const response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/resource',
      method: 'OPTIONS',
      headers: {
        'Origin': 'http://example.com',
        'Access-Control-Request-Method': 'PUT'
      }
    });
    
    assertEqual(response.statusCode, 204);
    assertEqual(response.headers['access-control-max-age'], '86400');
  } finally {
    await server.close();
  }
});

runner.test('Should handle regex origin patterns', async () => {
  const app = new Router();
  
  app.use(cors({
    origin: /^https:\/\/.*\.example\.com$/
  }));
  
  app.get('/api', (req, res) => {
    res.json({ success: true });
  });
  
  const server = await createTestServer(app);
  
  try {
    // Matching subdomain
    let response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/api',
      method: 'GET',
      headers: {
        'Origin': 'https://app.example.com'
      }
    });
    
    assertEqual(response.statusCode, 200);
    assertEqual(response.headers['access-control-allow-origin'], 'https://app.example.com');
    
    // Another matching subdomain
    response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/api',
      method: 'GET',
      headers: {
        'Origin': 'https://api.example.com'
      }
    });
    
    assertEqual(response.statusCode, 200);
    assertEqual(response.headers['access-control-allow-origin'], 'https://api.example.com');
    
    // Non-matching origin
    response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/api',
      method: 'GET',
      headers: {
        'Origin': 'http://app.example.com' // HTTP instead of HTTPS
      }
    });
    
    assertEqual(response.statusCode, 200);
    assert(!response.headers['access-control-allow-origin'] || 
           response.headers['access-control-allow-origin'] !== 'http://app.example.com');
  } finally {
    await server.close();
  }
});

runner.test('Should handle OPTIONS success status', async () => {
  const app = new Router();
  
  app.use(cors({
    optionsSuccessStatus: 200 // Some legacy browsers require 200
  }));
  
  app.delete('/resource', (req, res) => {
    res.json({ deleted: true });
  });
  
  const server = await createTestServer(app);
  
  try {
    const response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/resource',
      method: 'OPTIONS',
      headers: {
        'Origin': 'http://example.com',
        'Access-Control-Request-Method': 'DELETE'
      }
    });
    
    assertEqual(response.statusCode, 200); // Instead of default 204
  } finally {
    await server.close();
  }
});

runner.test('Should handle CORS with different routes', async () => {
  const app = new Router();
  
  // Public API - allow all origins
  app.use('/api/public', cors());
  
  // Private API - restrict origins
  app.use('/api/private', cors({
    origin: 'https://admin.example.com',
    credentials: true
  }));
  
  app.get('/api/public/data', (req, res) => {
    res.json({ public: true });
  });
  
  app.get('/api/private/data', (req, res) => {
    res.json({ private: true });
  });
  
  const server = await createTestServer(app);
  
  try {
    // Public API should allow any origin
    let response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/api/public/data',
      method: 'GET',
      headers: {
        'Origin': 'http://any-site.com'
      }
    });
    
    assertEqual(response.statusCode, 200);
    assertEqual(response.headers['access-control-allow-origin'], '*');
    
    // Private API should only allow specific origin
    response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/api/private/data',
      method: 'GET',
      headers: {
        'Origin': 'https://admin.example.com'
      }
    });
    
    assertEqual(response.statusCode, 200);
    assertEqual(response.headers['access-control-allow-origin'], 'https://admin.example.com');
    assertEqual(response.headers['access-control-allow-credentials'], 'true');
    
    // Private API should reject other origins
    response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/api/private/data',
      method: 'GET',
      headers: {
        'Origin': 'http://any-site.com'
      }
    });
    
    assertEqual(response.statusCode, 200);
    assert(!response.headers['access-control-allow-origin'] || 
           response.headers['access-control-allow-origin'] !== 'http://any-site.com');
  } finally {
    await server.close();
  }
});

// Run the tests
runner.run().then(success => {
  process.exit(success ? 0 : 1);
});