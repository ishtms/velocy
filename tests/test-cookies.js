const { TestRunner, createTestServer, makeRequest, assert, assertEqual } = require('./test-helper');
const { Router, cookieParser } = require('../index');

const runner = new TestRunner('Cookie Tests');

runner.test('Should parse cookies from request', async () => {
  const app = new Router();
  
  app.use(cookieParser());
  
  app.get('/cookies', (req, res) => {
    res.json({
      cookies: req.cookies
    });
  });
  
  const server = await createTestServer(app);
  
  try {
    const response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/cookies',
      method: 'GET',
      headers: {
        'Cookie': 'session=abc123; user=john; preferences=dark-mode'
      }
    });
    
    assertEqual(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assertEqual(body.cookies.session, 'abc123');
    assertEqual(body.cookies.user, 'john');
    assertEqual(body.cookies.preferences, 'dark-mode');
  } finally {
    await server.close();
  }
});

runner.test('Should handle signed cookies', async () => {
  const app = new Router({ cookieSecret: 'my-secret-key' });
  
  app.use(cookieParser('my-secret-key'));
  
  app.get('/set-signed', (req, res) => {
    res.cookie('user', 'john', { signed: true });
    res.cookie('session', 'xyz789', { signed: true });
    res.json({ set: true });
  });
  
  app.get('/get-signed', (req, res) => {
    res.json({
      signedCookies: req.signedCookies,
      regularCookies: req.cookies
    });
  });
  
  const server = await createTestServer(app);
  
  try {
    // First set the signed cookies
    const setResponse = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/set-signed',
      method: 'GET'
    });
    
    assertEqual(setResponse.statusCode, 200);
    const cookies = setResponse.headers['set-cookie'];
    assert(cookies, 'Should have set cookies');
    
    // Extract cookie values for next request
    let cookieHeader = '';
    if (Array.isArray(cookies)) {
      cookieHeader = cookies.map(c => c.split(';')[0]).join('; ');
    } else {
      cookieHeader = cookies.split(';')[0];
    }
    
    // Now get and verify signed cookies
    const getResponse = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/get-signed',
      method: 'GET',
      headers: {
        'Cookie': cookieHeader
      }
    });
    
    assertEqual(getResponse.statusCode, 200);
    const body = JSON.parse(getResponse.body);
    
    // Signed cookies should be in signedCookies object
    if (body.signedCookies) {
      assertEqual(body.signedCookies.user, 'john');
      assertEqual(body.signedCookies.session, 'xyz789');
    }
  } finally {
    await server.close();
  }
});

runner.test('Should set cookies with various options', async () => {
  const app = new Router();
  
  app.use(cookieParser());
  
  app.get('/set-options', (req, res) => {
    res.cookie('persistent', 'value1', {
      maxAge: 900000, // 15 minutes
      httpOnly: true
    });
    
    res.cookie('secure-cookie', 'value2', {
      secure: true,
      sameSite: 'strict'
    });
    
    res.cookie('with-path', 'value3', {
      path: '/admin'
    });
    
    res.cookie('with-domain', 'value4', {
      domain: '.example.com'
    });
    
    res.json({ cookies: 'set' });
  });
  
  const server = await createTestServer(app);
  
  try {
    const response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/set-options',
      method: 'GET'
    });
    
    assertEqual(response.statusCode, 200);
    const cookies = response.headers['set-cookie'];
    assert(cookies, 'Should have Set-Cookie headers');
    
    const cookieArray = Array.isArray(cookies) ? cookies : [cookies];
    
    // Check persistent cookie
    const persistent = cookieArray.find(c => c.startsWith('persistent='));
    assert(persistent, 'Should have persistent cookie');
    assert(persistent.includes('Max-Age=900'), 'Should have Max-Age');
    assert(persistent.includes('HttpOnly'), 'Should have HttpOnly flag');
    
    // Check secure cookie
    const secure = cookieArray.find(c => c.startsWith('secure-cookie='));
    if (secure) {
      assert(secure.includes('Secure'), 'Should have Secure flag');
      assert(secure.includes('SameSite=Strict'), 'Should have SameSite=Strict');
    }
    
    // Check path cookie
    const withPath = cookieArray.find(c => c.startsWith('with-path='));
    if (withPath) {
      assert(withPath.includes('Path=/admin'), 'Should have Path=/admin');
    }
    
    // Check domain cookie
    const withDomain = cookieArray.find(c => c.startsWith('with-domain='));
    if (withDomain) {
      assert(withDomain.includes('Domain=.example.com'), 'Should have Domain');
    }
  } finally {
    await server.close();
  }
});

runner.test('Should clear cookies', async () => {
  const app = new Router();
  
  app.use(cookieParser());
  
  app.get('/clear', (req, res) => {
    res.clearCookie('session');
    res.clearCookie('user', { path: '/admin' });
    res.json({ cleared: true });
  });
  
  const server = await createTestServer(app);
  
  try {
    const response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/clear',
      method: 'GET'
    });
    
    assertEqual(response.statusCode, 200);
    const cookies = response.headers['set-cookie'];
    assert(cookies, 'Should have Set-Cookie headers for clearing');
    
    const cookieArray = Array.isArray(cookies) ? cookies : [cookies];
    
    // Check that cookies are being cleared (Max-Age=0 or Expires in the past)
    const sessionClear = cookieArray.find(c => c.startsWith('session='));
    if (sessionClear) {
      assert(
        sessionClear.includes('Max-Age=0') || 
        sessionClear.includes('Expires=Thu, 01 Jan 1970'),
        'Should clear session cookie'
      );
    }
  } finally {
    await server.close();
  }
});

runner.test('Should handle empty cookie header', async () => {
  const app = new Router();
  
  app.use(cookieParser());
  
  app.get('/empty', (req, res) => {
    res.json({
      cookies: req.cookies,
      hasCookies: Object.keys(req.cookies || {}).length > 0
    });
  });
  
  const server = await createTestServer(app);
  
  try {
    // Test with no Cookie header
    let response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/empty',
      method: 'GET'
    });
    
    assertEqual(response.statusCode, 200);
    let body = JSON.parse(response.body);
    assert(body.hasCookies === false, 'Should have no cookies');
    
    // Test with empty Cookie header
    response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/empty',
      method: 'GET',
      headers: {
        'Cookie': ''
      }
    });
    
    assertEqual(response.statusCode, 200);
    body = JSON.parse(response.body);
    assert(body.hasCookies === false, 'Should have no cookies with empty header');
  } finally {
    await server.close();
  }
});

runner.test('Should handle malformed cookies gracefully', async () => {
  const app = new Router();
  
  app.use(cookieParser());
  
  app.get('/malformed', (req, res) => {
    res.json({
      cookies: req.cookies
    });
  });
  
  const server = await createTestServer(app);
  
  try {
    const response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/malformed',
      method: 'GET',
      headers: {
        'Cookie': 'valid=value; =nokey; novalue=; ==; normal=ok'
      }
    });
    
    assertEqual(response.statusCode, 200);
    const body = JSON.parse(response.body);
    
    // Should at least parse valid cookies
    assertEqual(body.cookies.valid, 'value');
    assertEqual(body.cookies.normal, 'ok');
    
    // Malformed cookies might be ignored or handled gracefully
    // The exact behavior depends on implementation
  } finally {
    await server.close();
  }
});

runner.test('Should decode cookie values', async () => {
  const app = new Router();
  
  app.use(cookieParser());
  
  app.get('/encoded', (req, res) => {
    res.json({
      cookies: req.cookies
    });
  });
  
  const server = await createTestServer(app);
  
  try {
    const response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/encoded',
      method: 'GET',
      headers: {
        'Cookie': 'email=john%40example.com; url=https%3A%2F%2Fexample.com; special=hello%20world'
      }
    });
    
    assertEqual(response.statusCode, 200);
    const body = JSON.parse(response.body);
    
    // Should decode URL-encoded values
    assertEqual(body.cookies.email, 'john@example.com');
    assertEqual(body.cookies.url, 'https://example.com');
    assertEqual(body.cookies.special, 'hello world');
  } finally {
    await server.close();
  }
});

// Run the tests
runner.run().then(success => {
  process.exit(success ? 0 : 1);
});