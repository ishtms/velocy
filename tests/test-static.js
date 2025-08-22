const { TestRunner, createTestServer, makeRequest, assert, assertEqual, assertIncludes, createTempDir, cleanupTempDir } = require('./test-helper');
const { Router, static: staticMiddleware } = require('../index');
const fs = require('fs');
const path = require('path');

const runner = new TestRunner('Static File Serving Tests');

runner.test('Should serve static files', async () => {
  // Create temp directory with test files
  const tempDir = createTempDir();
  
  try {
    // Create test files
    fs.writeFileSync(path.join(tempDir, 'index.html'), '<h1>Hello World</h1>');
    fs.writeFileSync(path.join(tempDir, 'style.css'), 'body { color: red; }');
    fs.writeFileSync(path.join(tempDir, 'script.js'), 'console.log("Hello");');
    fs.writeFileSync(path.join(tempDir, 'data.json'), '{"test": "data"}');
    
    const app = new Router();
    app.use(staticMiddleware(tempDir));
    
    const server = await createTestServer(app);
    
    try {
      // Test HTML file
      let response = await makeRequest({
        hostname: '127.0.0.1',
        port: server.port,
        path: '/index.html',
        method: 'GET'
      });
      
      assertEqual(response.statusCode, 200);
      assertEqual(response.headers['content-type'], 'text/html');
      assertIncludes(response.body, '<h1>Hello World</h1>');
      
      // Test CSS file
      response = await makeRequest({
        hostname: '127.0.0.1',
        port: server.port,
        path: '/style.css',
        method: 'GET'
      });
      
      assertEqual(response.statusCode, 200);
      assertEqual(response.headers['content-type'], 'text/css');
      assertIncludes(response.body, 'color: red');
      
      // Test JS file
      response = await makeRequest({
        hostname: '127.0.0.1',
        port: server.port,
        path: '/script.js',
        method: 'GET'
      });
      
      assertEqual(response.statusCode, 200);
      assertEqual(response.headers['content-type'], 'application/javascript');
      assertIncludes(response.body, 'console.log');
      
      // Test JSON file
      response = await makeRequest({
        hostname: '127.0.0.1',
        port: server.port,
        path: '/data.json',
        method: 'GET'
      });
      
      assertEqual(response.statusCode, 200);
      assertEqual(response.headers['content-type'], 'application/json');
      assertEqual(JSON.parse(response.body).test, 'data');
    } finally {
      await server.close();
    }
  } finally {
    cleanupTempDir(tempDir);
  }
});

runner.test('Should serve index.html as default', async () => {
  const tempDir = createTempDir();
  
  try {
    fs.writeFileSync(path.join(tempDir, 'index.html'), '<h1>Home Page</h1>');
    
    const app = new Router();
    app.use(staticMiddleware(tempDir, { index: 'index.html' }));
    
    const server = await createTestServer(app);
    
    try {
      // Test root path serves index.html
      const response = await makeRequest({
        hostname: '127.0.0.1',
        port: server.port,
        path: '/',
        method: 'GET'
      });
      
      assertEqual(response.statusCode, 200);
      assertIncludes(response.body, '<h1>Home Page</h1>');
    } finally {
      await server.close();
    }
  } finally {
    cleanupTempDir(tempDir);
  }
});

runner.test('Should handle nested directories', async () => {
  const tempDir = createTempDir();
  
  try {
    // Create nested structure
    const cssDir = path.join(tempDir, 'css');
    const jsDir = path.join(tempDir, 'js');
    const imgDir = path.join(tempDir, 'images');
    
    fs.mkdirSync(cssDir);
    fs.mkdirSync(jsDir);
    fs.mkdirSync(imgDir);
    
    fs.writeFileSync(path.join(cssDir, 'main.css'), '.container { width: 100%; }');
    fs.writeFileSync(path.join(jsDir, 'app.js'), 'const app = {};');
    fs.writeFileSync(path.join(imgDir, 'logo.svg'), '<svg></svg>');
    
    const app = new Router();
    app.use(staticMiddleware(tempDir));
    
    const server = await createTestServer(app);
    
    try {
      // Test nested CSS
      let response = await makeRequest({
        hostname: '127.0.0.1',
        port: server.port,
        path: '/css/main.css',
        method: 'GET'
      });
      
      assertEqual(response.statusCode, 200);
      assertIncludes(response.body, '.container');
      
      // Test nested JS
      response = await makeRequest({
        hostname: '127.0.0.1',
        port: server.port,
        path: '/js/app.js',
        method: 'GET'
      });
      
      assertEqual(response.statusCode, 200);
      assertIncludes(response.body, 'const app');
      
      // Test nested SVG
      response = await makeRequest({
        hostname: '127.0.0.1',
        port: server.port,
        path: '/images/logo.svg',
        method: 'GET'
      });
      
      assertEqual(response.statusCode, 200);
      assertEqual(response.headers['content-type'], 'image/svg+xml');
    } finally {
      await server.close();
    }
  } finally {
    cleanupTempDir(tempDir);
  }
});

runner.test('Should return 404 for non-existent files', async () => {
  const tempDir = createTempDir();
  
  try {
    fs.writeFileSync(path.join(tempDir, 'exists.txt'), 'content');
    
    const app = new Router();
    app.use(staticMiddleware(tempDir));
    
    const server = await createTestServer(app);
    
    try {
      // Test existing file
      let response = await makeRequest({
        hostname: '127.0.0.1',
        port: server.port,
        path: '/exists.txt',
        method: 'GET'
      });
      
      assertEqual(response.statusCode, 200);
      
      // Test non-existent file
      response = await makeRequest({
        hostname: '127.0.0.1',
        port: server.port,
        path: '/does-not-exist.txt',
        method: 'GET'
      });
      
      assertEqual(response.statusCode, 404);
    } finally {
      await server.close();
    }
  } finally {
    cleanupTempDir(tempDir);
  }
});

runner.test('Should handle cache headers', async () => {
  const tempDir = createTempDir();
  
  try {
    fs.writeFileSync(path.join(tempDir, 'cacheable.css'), 'body { margin: 0; }');
    
    const app = new Router();
    app.use(staticMiddleware(tempDir, { 
      maxAge: 3600000 // 1 hour
    }));
    
    const server = await createTestServer(app);
    
    try {
      const response = await makeRequest({
        hostname: '127.0.0.1',
        port: server.port,
        path: '/cacheable.css',
        method: 'GET'
      });
      
      assertEqual(response.statusCode, 200);
      assert(response.headers['cache-control'], 'Should have cache-control header');
      assertIncludes(response.headers['cache-control'], 'max-age=3600');
    } finally {
      await server.close();
    }
  } finally {
    cleanupTempDir(tempDir);
  }
});

runner.test('Should handle ETags and conditional requests', async () => {
  const tempDir = createTempDir();
  
  try {
    fs.writeFileSync(path.join(tempDir, 'file.txt'), 'content');
    
    const app = new Router();
    app.use(staticMiddleware(tempDir, { etag: true }));
    
    const server = await createTestServer(app);
    
    try {
      // First request to get ETag
      let response = await makeRequest({
        hostname: '127.0.0.1',
        port: server.port,
        path: '/file.txt',
        method: 'GET'
      });
      
      assertEqual(response.statusCode, 200);
      const etag = response.headers.etag;
      assert(etag, 'Should have ETag header');
      
      // Conditional request with matching ETag
      response = await makeRequest({
        hostname: '127.0.0.1',
        port: server.port,
        path: '/file.txt',
        method: 'GET',
        headers: {
          'If-None-Match': etag
        }
      });
      
      assertEqual(response.statusCode, 304, 'Should return 304 Not Modified');
      assertEqual(response.body, '', 'Should have empty body for 304');
    } finally {
      await server.close();
    }
  } finally {
    cleanupTempDir(tempDir);
  }
});

runner.test('Should prevent directory traversal attacks', async () => {
  const tempDir = createTempDir();
  
  try {
    // Create a file outside the static directory
    const secretFile = path.join(path.dirname(tempDir), 'secret.txt');
    fs.writeFileSync(secretFile, 'secret content');
    
    // Create a file inside the static directory
    fs.writeFileSync(path.join(tempDir, 'public.txt'), 'public content');
    
    const app = new Router();
    app.use(staticMiddleware(tempDir));
    
    const server = await createTestServer(app);
    
    try {
      // Try various directory traversal attempts
      const attacks = [
        '/../secret.txt',
        '/..%2Fsecret.txt',
        '/..%252Fsecret.txt',
        '/%2e%2e/secret.txt',
        '/public.txt/../../secret.txt'
      ];
      
      for (const attack of attacks) {
        const response = await makeRequest({
          hostname: '127.0.0.1',
          port: server.port,
          path: attack,
          method: 'GET'
        });
        
        assert(
          response.statusCode === 404 || response.statusCode === 403,
          `Should block directory traversal attempt: ${attack}`
        );
      }
      
      // Verify normal file access still works
      const response = await makeRequest({
        hostname: '127.0.0.1',
        port: server.port,
        path: '/public.txt',
        method: 'GET'
      });
      
      assertEqual(response.statusCode, 200);
      assertEqual(response.body, 'public content');
    } finally {
      await server.close();
      fs.unlinkSync(secretFile);
    }
  } finally {
    cleanupTempDir(tempDir);
  }
});

runner.test('Should handle range requests', async () => {
  const tempDir = createTempDir();
  
  try {
    // Create a larger file for range testing
    const content = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    fs.writeFileSync(path.join(tempDir, 'range.txt'), content);
    
    const app = new Router();
    app.use(staticMiddleware(tempDir, { acceptRanges: true }));
    
    const server = await createTestServer(app);
    
    try {
      // Test partial content request
      const response = await makeRequest({
        hostname: '127.0.0.1',
        port: server.port,
        path: '/range.txt',
        method: 'GET',
        headers: {
          'Range': 'bytes=0-9'
        }
      });
      
      assertEqual(response.statusCode, 206, 'Should return 206 Partial Content');
      assertEqual(response.body, 'ABCDEFGHIJ', 'Should return requested range');
      assert(response.headers['content-range'], 'Should have Content-Range header');
    } finally {
      await server.close();
    }
  } finally {
    cleanupTempDir(tempDir);
  }
});

runner.test('Should handle custom mime types', async () => {
  const tempDir = createTempDir();
  
  try {
    fs.writeFileSync(path.join(tempDir, 'custom.xyz'), 'custom content');
    
    const app = new Router();
    app.use(staticMiddleware(tempDir, {
      mimeTypes: {
        '.xyz': 'application/x-custom'
      }
    }));
    
    const server = await createTestServer(app);
    
    try {
      const response = await makeRequest({
        hostname: '127.0.0.1',
        port: server.port,
        path: '/custom.xyz',
        method: 'GET'
      });
      
      assertEqual(response.statusCode, 200);
      assertEqual(response.headers['content-type'], 'application/x-custom');
    } finally {
      await server.close();
    }
  } finally {
    cleanupTempDir(tempDir);
  }
});

// Run the tests
runner.run().then(success => {
  process.exit(success ? 0 : 1);
});