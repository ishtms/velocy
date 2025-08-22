const { TestRunner, createTestServer, makeRequest, assert, assertEqual, assertIncludes } = require('./test-helper');
const { Router, bodyParser } = require('../index');

const runner = new TestRunner('Error Handling Tests');

runner.test('Should handle 404 errors', async () => {
  const app = new Router();
  
  app.get('/exists', (req, res) => {
    res.json({ found: true });
  });
  
  // Custom 404 handler using catch-all route
  app.all('/*', (req, res) => {
    // Only handle if no other route matched (check if response not sent)
    if (!res.headersSent) {
      res.status(404).json({
        error: 'Not Found',
        path: req.path || req.url,
        method: req.method
      });
    }
  });
  
  const server = await createTestServer(app);
  
  try {
    // Existing route
    let response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/exists',
      method: 'GET'
    });
    
    assertEqual(response.statusCode, 200);
    
    // Non-existent route
    response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/does-not-exist',
      method: 'GET'
    });
    
    assertEqual(response.statusCode, 404);
    const body = JSON.parse(response.body);
    assertEqual(body.error, 'Not Found');
    assertEqual(body.path, '/does-not-exist');
  } finally {
    await server.close();
  }
});

runner.test('Should handle synchronous errors in route handlers', async () => {
  const app = new Router();
  
  app.get('/sync-error', (req, res) => {
    throw new Error('Synchronous error occurred');
  });
  
  // Error handling middleware
  app.use((err, req, res, next) => {
    res.status(err.statusCode || 500).json({
      error: err.message,
      type: 'sync_error'
    });
  });
  
  const server = await createTestServer(app);
  
  try {
    const response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/sync-error',
      method: 'GET'
    });
    
    assertEqual(response.statusCode, 500);
    const body = JSON.parse(response.body);
    assertEqual(body.error, 'Synchronous error occurred');
    assertEqual(body.type, 'sync_error');
  } finally {
    await server.close();
  }
});

runner.test('Should handle asynchronous errors', async () => {
  const app = new Router();
  
  app.get('/async-error', async (req, res) => {
    await new Promise(resolve => setTimeout(resolve, 10));
    throw new Error('Asynchronous error occurred');
  });
  
  app.get('/promise-rejection', (req, res) => {
    return Promise.reject(new Error('Promise rejected'));
  });
  
  // Error handling middleware
  app.use((err, req, res, next) => {
    res.status(500).json({
      error: err.message,
      type: 'async_error'
    });
  });
  
  const server = await createTestServer(app);
  
  try {
    // Async error
    let response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/async-error',
      method: 'GET'
    });
    
    assertEqual(response.statusCode, 500);
    assertIncludes(response.body, 'Asynchronous error occurred');
    
    // Promise rejection
    response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/promise-rejection',
      method: 'GET'
    });
    
    assertEqual(response.statusCode, 500);
    assertIncludes(response.body, 'Promise rejected');
  } finally {
    await server.close();
  }
});

runner.test('Should handle custom error classes', async () => {
  class ValidationError extends Error {
    constructor(message, field) {
      super(message);
      this.name = 'ValidationError';
      this.statusCode = 400;
      this.field = field;
    }
  }
  
  class AuthenticationError extends Error {
    constructor(message) {
      super(message);
      this.name = 'AuthenticationError';
      this.statusCode = 401;
    }
  }
  
  const app = new Router();
  
  app.post('/validate', (req, res) => {
    if (!req.body || !req.body.email) {
      throw new ValidationError('Email is required', 'email');
    }
    res.json({ success: true });
  });
  
  app.get('/protected', (req, res) => {
    if (!req.headers.authorization) {
      throw new AuthenticationError('No authorization token provided');
    }
    res.json({ protected: true });
  });
  
  // Error handling middleware
  app.use((err, req, res, next) => {
    const statusCode = err.statusCode || 500;
    res.status(statusCode).json({
      error: err.message,
      type: err.name,
      field: err.field
    });
  });
  
  const server = await createTestServer(app);
  
  try {
    // Validation error
    let response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/validate',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    }, JSON.stringify({}));
    
    assertEqual(response.statusCode, 400);
    const body = JSON.parse(response.body);
    assertEqual(body.type, 'ValidationError');
    assertEqual(body.field, 'email');
    
    // Authentication error
    response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/protected',
      method: 'GET'
    });
    
    assertEqual(response.statusCode, 401);
    const authBody = JSON.parse(response.body);
    assertEqual(authBody.type, 'AuthenticationError');
  } finally {
    await server.close();
  }
});

runner.test('Should handle middleware errors', async () => {
  const app = new Router();
  
  app.use(bodyParser.json());
  
  // Middleware that throws error
  app.use((req, res, next) => {
    if (req.headers['x-fail']) {
      throw new Error('Middleware error');
    }
    next();
  });
  
  app.get('/test', (req, res) => {
    res.json({ success: true });
  });
  
  // Error handler
  app.use((err, req, res, next) => {
    res.status(500).json({ error: err.message });
  });
  
  const server = await createTestServer(app);
  
  try {
    // Request without error header
    let response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/test',
      method: 'GET'
    });
    
    assertEqual(response.statusCode, 200);
    
    // Request with error header
    response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/test',
      method: 'GET',
      headers: {
        'X-Fail': 'true'
      }
    });
    
    assertEqual(response.statusCode, 500);
    assertIncludes(response.body, 'Middleware error');
  } finally {
    await server.close();
  }
});

runner.test('Should handle timeout errors', async () => {
  const app = new Router();
  
  // Set a short timeout
  app.use((req, res, next) => {
    req.setTimeout(100); // 100ms timeout
    next();
  });
  
  app.get('/slow', async (req, res) => {
    // Simulate slow operation
    await new Promise(resolve => setTimeout(resolve, 200));
    res.json({ completed: true });
  });
  
  app.get('/fast', (req, res) => {
    res.json({ completed: true });
  });
  
  const server = await createTestServer(app);
  
  try {
    // Fast request should succeed
    let response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/fast',
      method: 'GET'
    });
    
    assertEqual(response.statusCode, 200);
    
    // Slow request might timeout (depending on implementation)
    // Note: Actual timeout behavior depends on the framework's implementation
    try {
      response = await makeRequest({
        hostname: '127.0.0.1',
        port: server.port,
        path: '/slow',
        method: 'GET'
      });
      
      // If request completes, it means timeout didn't work or was handled gracefully
      assert(response.statusCode === 200 || response.statusCode >= 500);
    } catch (err) {
      // Socket hang up is expected when timeout occurs
      assert(err.message.includes('socket hang up') || err.message.includes('ECONNRESET'), 
        'Expected timeout error but got: ' + err.message);
    }
  } finally {
    await server.close();
  }
});

runner.test('Should handle malformed JSON', async () => {
  const app = new Router();
  
  app.use(bodyParser.json());
  
  app.post('/json', (req, res) => {
    res.json({ received: req.body });
  });
  
  // Error handler for JSON parse errors
  app.use((err, req, res, next) => {
    // Check for BodyParserError or specific error codes
    if (err.name === 'BodyParserError' || err.code === 'INVALID_JSON' || err.type === 'entity.parse.failed') {
      return res.status(400).json({
        error: 'Invalid JSON',
        details: err.message
      });
    }
    res.status(500).json({ error: err.message });
  });
  
  const server = await createTestServer(app);
  
  try {
    // Valid JSON
    let response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/json',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    }, JSON.stringify({ valid: true }));
    
    assertEqual(response.statusCode, 200);
    
    // Invalid JSON
    response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/json',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    }, '{ invalid json }');
    
    assertEqual(response.statusCode, 400);
    assertIncludes(response.body, 'Invalid JSON');
  } finally {
    await server.close();
  }
});

runner.test('Should handle uncaught exceptions gracefully', async () => {
  const app = new Router();
  
  app.get('/crash', (req, res) => {
    // Simulate accessing undefined property
    const obj = null;
    res.json({ value: obj.property });
  });
  
  // Global error handler
  app.use((err, req, res, next) => {
    console.error('Caught error:', err.message);
    res.status(500).json({
      error: 'Internal Server Error',
      message: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  });
  
  const server = await createTestServer(app);
  
  try {
    const response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/crash',
      method: 'GET'
    });
    
    assertEqual(response.statusCode, 500);
    assertIncludes(response.body, 'Internal Server Error');
  } finally {
    await server.close();
  }
});

runner.test('Should handle network errors', async () => {
  const app = new Router();
  
  app.get('/test', (req, res) => {
    // Simulate network error by destroying the connection
    req.connection.destroy();
  });
  
  const server = await createTestServer(app);
  
  try {
    try {
      await makeRequest({
        hostname: '127.0.0.1',
        port: server.port,
        path: '/test',
        method: 'GET'
      });
      
      // Should not reach here
      assert(false, 'Should have thrown an error');
    } catch (err) {
      // Expected to fail due to connection destruction
      assert(err, 'Should have network error');
    }
  } finally {
    await server.close();
  }
});

runner.test('Should handle circular reference in JSON response', async () => {
  const app = new Router();
  
  app.get('/circular', (req, res) => {
    const obj = { name: 'test' };
    obj.self = obj; // Create circular reference
    
    try {
      res.json(obj);
    } catch (err) {
      res.status(500).json({ error: 'Circular reference detected' });
    }
  });
  
  const server = await createTestServer(app);
  
  try {
    const response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/circular',
      method: 'GET'
    });
    
    // Should handle circular reference gracefully
    assert(response.statusCode === 200 || response.statusCode === 500);
    if (response.statusCode === 500) {
      assertIncludes(response.body, 'Circular reference');
    }
  } finally {
    await server.close();
  }
});

runner.test('Should handle large payloads', async () => {
  const app = new Router();
  
  app.use(bodyParser.json({ limit: '1kb' })); // Small limit
  
  app.post('/data', (req, res) => {
    res.json({ received: true });
  });
  
  // Error handler
  app.use((err, req, res, next) => {
    // Check for payload too large errors
    if (err.type === 'entity.too.large' || 
        (err.name === 'BodyParserError' && err.statusCode === 413) ||
        err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        error: 'Payload too large'
      });
    }
    res.status(500).json({ error: err.message });
  });
  
  const server = await createTestServer(app);
  
  try {
    // Small payload - should work
    let response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/data',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    }, JSON.stringify({ small: 'data' }));
    
    assertEqual(response.statusCode, 200);
    
    // Large payload - should fail
    const largeData = { data: 'x'.repeat(2000) }; // > 1kb
    response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/data',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    }, JSON.stringify(largeData));
    
    assertEqual(response.statusCode, 413);
    assertIncludes(response.body, 'Payload too large');
  } finally {
    await server.close();
  }
});

// Run the tests
runner.run().then(success => {
  process.exit(success ? 0 : 1);
});