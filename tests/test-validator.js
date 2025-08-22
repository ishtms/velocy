const { TestRunner, createTestServer, makeRequest, assert, assertEqual, assertIncludes } = require('./test-helper');
const { Router, validator, bodyParser } = require('../index');

const runner = new TestRunner('Validator Tests');

runner.test('Should validate required fields', async () => {
  const app = new Router();
  
  app.use(bodyParser.json());
  
  app.post('/users', 
    validator.body('name').required().isString(),
    validator.body('email').required().isEmail(),
    validator.body('age').required().isNumber(),
    (req, res) => {
      res.json({ success: true, data: req.body });
    }
  );
  
  const server = await createTestServer(app);
  
  try {
    // Valid request
    let response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/users',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    }, JSON.stringify({
      name: 'John Doe',
      email: 'john@example.com',
      age: 25
    }));
    
    assertEqual(response.statusCode, 200);
    
    // Missing required field
    response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/users',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    }, JSON.stringify({
      name: 'John Doe',
      age: 25
      // Missing email
    }));
    
    assertEqual(response.statusCode, 400);
    assertIncludes(response.body, 'email');
  } finally {
    await server.close();
  }
});

runner.test('Should validate string types and constraints', async () => {
  const app = new Router();
  
  app.use(bodyParser.json());
  
  app.post('/validate-string',
    validator.body('username')
      .isString()
      .minLength(3)
      .maxLength(20)
      .matches(/^[a-zA-Z0-9_]+$/),
    validator.body('bio')
      .isString()
      .optional()
      .maxLength(500),
    (req, res) => {
      res.json({ success: true });
    }
  );
  
  const server = await createTestServer(app);
  
  try {
    // Valid string
    let response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/validate-string',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    }, JSON.stringify({
      username: 'john_doe123'
    }));
    
    assertEqual(response.statusCode, 200);
    
    // Too short
    response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/validate-string',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    }, JSON.stringify({
      username: 'ab'
    }));
    
    assertEqual(response.statusCode, 400);
    
    // Too long
    response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/validate-string',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    }, JSON.stringify({
      username: 'this_username_is_way_too_long_for_validation'
    }));
    
    assertEqual(response.statusCode, 400);
    
    // Invalid characters
    response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/validate-string',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    }, JSON.stringify({
      username: 'john@doe'
    }));
    
    assertEqual(response.statusCode, 400);
  } finally {
    await server.close();
  }
});

runner.test('Should validate number types and ranges', async () => {
  const app = new Router();
  
  app.use(bodyParser.json());
  
  app.post('/validate-number',
    validator.body('age')
      .isNumber()
      .min(18)
      .max(120),
    validator.body('price')
      .isNumber()
      .positive(),
    validator.body('quantity')
      .isInteger()
      .min(1),
    (req, res) => {
      res.json({ success: true });
    }
  );
  
  const server = await createTestServer(app);
  
  try {
    // Valid numbers
    let response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/validate-number',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    }, JSON.stringify({
      age: 25,
      price: 99.99,
      quantity: 5
    }));
    
    assertEqual(response.statusCode, 200);
    
    // Age too young
    response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/validate-number',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    }, JSON.stringify({
      age: 16,
      price: 99.99,
      quantity: 5
    }));
    
    assertEqual(response.statusCode, 400);
    
    // Negative price
    response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/validate-number',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    }, JSON.stringify({
      age: 25,
      price: -10,
      quantity: 5
    }));
    
    assertEqual(response.statusCode, 400);
    
    // Non-integer quantity
    response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/validate-number',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    }, JSON.stringify({
      age: 25,
      price: 99.99,
      quantity: 5.5
    }));
    
    assertEqual(response.statusCode, 400);
  } finally {
    await server.close();
  }
});

runner.test('Should validate email addresses', async () => {
  const app = new Router();
  
  app.use(bodyParser.json());
  
  app.post('/validate-email',
    validator.body('email').isEmail(),
    (req, res) => {
      res.json({ success: true });
    }
  );
  
  const server = await createTestServer(app);
  
  try {
    // Valid emails
    const validEmails = [
      'user@example.com',
      'john.doe@company.co.uk',
      'test+tag@gmail.com',
      'name123@test-domain.org'
    ];
    
    for (const email of validEmails) {
      const response = await makeRequest({
        hostname: '127.0.0.1',
        port: server.port,
        path: '/validate-email',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      }, JSON.stringify({ email }));
      
      assertEqual(response.statusCode, 200, `Should accept valid email: ${email}`);
    }
    
    // Invalid emails
    const invalidEmails = [
      'notanemail',
      '@example.com',
      'user@',
      'user @example.com',
      'user@.com',
      'user@example'
    ];
    
    for (const email of invalidEmails) {
      const response = await makeRequest({
        hostname: '127.0.0.1',
        port: server.port,
        path: '/validate-email',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      }, JSON.stringify({ email }));
      
      assertEqual(response.statusCode, 400, `Should reject invalid email: ${email}`);
    }
  } finally {
    await server.close();
  }
});

runner.test('Should validate URLs', async () => {
  const app = new Router();
  
  app.use(bodyParser.json());
  
  app.post('/validate-url',
    validator.body('website').isURL(),
    (req, res) => {
      res.json({ success: true });
    }
  );
  
  const server = await createTestServer(app);
  
  try {
    // Valid URLs
    const validUrls = [
      'http://example.com',
      'https://www.example.com',
      'https://subdomain.example.co.uk',
      'http://localhost:3000',
      'https://example.com/path/to/page'
    ];
    
    for (const url of validUrls) {
      const response = await makeRequest({
        hostname: '127.0.0.1',
        port: server.port,
        path: '/validate-url',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      }, JSON.stringify({ website: url }));
      
      assertEqual(response.statusCode, 200, `Should accept valid URL: ${url}`);
    }
    
    // Invalid URLs
    const invalidUrls = [
      'not a url',
      'ftp://example.com', // If only http/https allowed
      'example.com', // Missing protocol
      'http://',
      '//example.com'
    ];
    
    for (const url of invalidUrls) {
      const response = await makeRequest({
        hostname: '127.0.0.1',
        port: server.port,
        path: '/validate-url',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      }, JSON.stringify({ website: url }));
      
      assertEqual(response.statusCode, 400, `Should reject invalid URL: ${url}`);
    }
  } finally {
    await server.close();
  }
});

runner.test('Should validate arrays', async () => {
  const app = new Router();
  
  app.use(bodyParser.json());
  
  app.post('/validate-array',
    validator.body('tags')
      .isArray()
      .minLength(1)
      .maxLength(5),
    validator.body('numbers')
      .isArray()
      .each((item) => item.isNumber().min(0).max(100)),
    (req, res) => {
      res.json({ success: true });
    }
  );
  
  const server = await createTestServer(app);
  
  try {
    // Valid arrays
    let response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/validate-array',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    }, JSON.stringify({
      tags: ['javascript', 'node', 'web'],
      numbers: [10, 20, 30, 40]
    }));
    
    assertEqual(response.statusCode, 200);
    
    // Empty array (below minimum)
    response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/validate-array',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    }, JSON.stringify({
      tags: [],
      numbers: [10]
    }));
    
    assertEqual(response.statusCode, 400);
    
    // Too many items
    response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/validate-array',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    }, JSON.stringify({
      tags: ['one', 'two', 'three', 'four', 'five', 'six'],
      numbers: [10]
    }));
    
    assertEqual(response.statusCode, 400);
    
    // Invalid array items
    response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/validate-array',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    }, JSON.stringify({
      tags: ['valid'],
      numbers: [10, 150, 30] // 150 exceeds max
    }));
    
    assertEqual(response.statusCode, 400);
  } finally {
    await server.close();
  }
});

runner.test('Should validate custom validators', async () => {
  const app = new Router();
  
  app.use(bodyParser.json());
  
  app.post('/validate-custom',
    validator.body('password')
      .custom((value) => {
        // Custom password strength check
        if (value.length < 8) return false;
        if (!/[A-Z]/.test(value)) return false;
        if (!/[a-z]/.test(value)) return false;
        if (!/[0-9]/.test(value)) return false;
        if (!/[!@#$%^&*]/.test(value)) return false;
        return true;
      })
      .withMessage('Password must be at least 8 characters with uppercase, lowercase, number, and special character'),
    validator.body('confirmPassword')
      .custom((value, { req }) => {
        return value === req.body.password;
      })
      .withMessage('Passwords do not match'),
    (req, res) => {
      res.json({ success: true });
    }
  );
  
  const server = await createTestServer(app);
  
  try {
    // Valid password
    let response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/validate-custom',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    }, JSON.stringify({
      password: 'SecureP@ss123',
      confirmPassword: 'SecureP@ss123'
    }));
    
    assertEqual(response.statusCode, 200);
    
    // Weak password
    response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/validate-custom',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    }, JSON.stringify({
      password: 'weak',
      confirmPassword: 'weak'
    }));
    
    assertEqual(response.statusCode, 400);
    assertIncludes(response.body, 'Password must be at least 8 characters');
    
    // Passwords don't match
    response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/validate-custom',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    }, JSON.stringify({
      password: 'SecureP@ss123',
      confirmPassword: 'DifferentP@ss123'
    }));
    
    assertEqual(response.statusCode, 400);
    assertIncludes(response.body, 'Passwords do not match');
  } finally {
    await server.close();
  }
});

runner.test('Should validate query parameters', async () => {
  const app = new Router();
  
  app.get('/search',
    validator.query('q').required().isString().minLength(1),
    validator.query('page').optional().isInteger().min(1),
    validator.query('limit').optional().isInteger().min(1).max(100),
    (req, res) => {
      res.json({
        query: req.query.q,
        page: req.query.page || 1,
        limit: req.query.limit || 10
      });
    }
  );
  
  const server = await createTestServer(app);
  
  try {
    // Valid query
    let response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/search?q=test&page=2&limit=20',
      method: 'GET'
    });
    
    assertEqual(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assertEqual(body.query, 'test');
    assertEqual(body.page, 2);  // Should be number after validation
    assertEqual(body.limit, 20);  // Should be number after validation
    
    // Missing required query param
    response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/search',
      method: 'GET'
    });
    
    assertEqual(response.statusCode, 400);
    
    // Invalid page number
    response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/search?q=test&page=0',
      method: 'GET'
    });
    
    assertEqual(response.statusCode, 400);
    
    // Limit too high
    response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/search?q=test&limit=200',
      method: 'GET'
    });
    
    assertEqual(response.statusCode, 400);
  } finally {
    await server.close();
  }
});

runner.test('Should validate route parameters', async () => {
  const app = new Router();
  
  app.get('/users/:id',
    validator.param('id').isUUID(),
    (req, res) => {
      res.json({ userId: req.params.id });
    }
  );
  
  app.get('/posts/:slug',
    validator.param('slug').matches(/^[a-z0-9-]+$/),
    (req, res) => {
      res.json({ slug: req.params.slug });
    }
  );
  
  const server = await createTestServer(app);
  
  try {
    // Valid UUID
    let response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/users/550e8400-e29b-41d4-a716-446655440000',
      method: 'GET'
    });
    
    assertEqual(response.statusCode, 200);
    
    // Invalid UUID
    response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/users/not-a-uuid',
      method: 'GET'
    });
    
    assertEqual(response.statusCode, 400);
    
    // Valid slug
    response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/posts/my-first-post',
      method: 'GET'
    });
    
    assertEqual(response.statusCode, 200);
    
    // Invalid slug (contains uppercase)
    response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/posts/My-First-Post',
      method: 'GET'
    });
    
    assertEqual(response.statusCode, 400);
  } finally {
    await server.close();
  }
});

// Run the tests
runner.run().then(success => {
  process.exit(success ? 0 : 1);
});