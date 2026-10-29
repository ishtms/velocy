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
runner.test('Should not serve symbolic links', async () => {
  const tempDir = createTempDir();
  try {
    const root = path.join(tempDir, 'root');
    fs.mkdirSync(root);
    fs.writeFileSync(path.join(tempDir, 'outside.txt'), 'private');
    fs.symlinkSync(path.join(tempDir, 'outside.txt'), path.join(root, 'link.txt'));
    const app = new Router();
    app.use(staticMiddleware(root, { fallthrough: false }));
    const server = await createTestServer(app);
    try {
      const response = await makeRequest({ hostname: '127.0.0.1', port: server.port, path: '/link.txt', method: 'GET' });
      assertEqual(response.statusCode, 403, 'symbolic link must be rejected');
      assert(!response.body.includes('private'), 'outside content must not be returned');
    } finally {
      await server.close();
    }
  } finally {
    cleanupTempDir(tempDir);
  }
});

runner.test('Should reject symlinked directories, indexes and compressed files', async () => {
  const tempDir = createTempDir();
  try {
    const root = path.join(tempDir, 'root');
    const outside = path.join(tempDir, 'outside');
    fs.mkdirSync(root);
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'secret'), 'private');
    fs.writeFileSync(path.join(root, 'asset.txt'), 'public');
    fs.mkdirSync(path.join(root, 'directory'));
    fs.symlinkSync(outside, path.join(root, 'linked-dir'), 'dir');
    fs.symlinkSync(path.join(outside, 'secret'), path.join(root, 'directory', 'index.html'));
    fs.symlinkSync(path.join(outside, 'secret'), path.join(root, 'asset.txt.gz'));
    const app = new Router();
    app.use(staticMiddleware(root, { fallthrough: false }));
    const server = await createTestServer(app);
    try {
      for (const [url, headers] of [['/linked-dir/secret', {}], ['/directory/', {}], ['/asset.txt', { 'accept-encoding': 'gzip' }]]) {
        const response = await makeRequest({ hostname: '127.0.0.1', port: server.port, path: url, method: 'GET', headers });
        assertEqual(response.statusCode, 403, `${url} must be rejected`);
        assert(!response.body.includes('private'), `${url} leaked outside content`);
      }
    } finally {
      await server.close();
    }
  } finally {
    cleanupTempDir(tempDir);
  }
});

runner.test('Should reject symlinked extension and Brotli candidates', async () => {
  const tempDir = createTempDir();
  try {
    const root = path.join(tempDir, 'root');
    fs.mkdirSync(root);
    const secret = path.join(tempDir, 'secret');
    fs.writeFileSync(secret, 'private');
    fs.writeFileSync(path.join(root, 'asset'), 'public');
    fs.symlinkSync(secret, path.join(root, 'page.html'));
    fs.symlinkSync(secret, path.join(root, 'asset.br'));
    const app = new Router();
    app.use(staticMiddleware(root, { fallthrough: false, extensions: ['.html'] }));
    const server = await createTestServer(app);
    try {
      for (const [url, headers] of [['/page', {}], ['/asset', { 'accept-encoding': 'br' }]]) {
        const response = await makeRequest({ hostname: '127.0.0.1', port: server.port, path: url, method: 'GET', headers });
        assertEqual(response.statusCode, 403);
        assert(!response.body.includes('private'));
      }
    } finally {
      await server.close();
    }
  } finally {
    cleanupTempDir(tempDir);
  }
});

runner.test('Should omit symbolic links from directory listings', async () => {
  const tempDir = createTempDir();
  try {
    fs.writeFileSync(path.join(tempDir, 'visible.txt'), 'public');
    fs.symlinkSync(path.join(tempDir, 'visible.txt'), path.join(tempDir, 'linked.txt'));
    const app = new Router();
    app.use(staticMiddleware(tempDir, { index: false, directoryListing: true, fallthrough: false }));
    const server = await createTestServer(app);
    try {
      const response = await makeRequest({ hostname: '127.0.0.1', port: server.port, path: '/', method: 'GET' });
      assertEqual(response.statusCode, 200);
      assertIncludes(response.body, 'visible.txt');
      assert(!response.body.includes('linked.txt'));
    } finally {
      await server.close();
    }
  } finally {
    cleanupTempDir(tempDir);
  }
});

runner.test('Should reject a symbolic-link static root', async () => {
  const tempDir = createTempDir();
  try {
    const actual = path.join(tempDir, 'actual');
    fs.mkdirSync(actual);
    fs.writeFileSync(path.join(actual, 'file.txt'), 'private');
    const root = path.join(tempDir, 'root');
    fs.symlinkSync(actual, root, 'dir');
    const app = new Router();
    app.use(staticMiddleware(root, { fallthrough: false }));
    const server = await createTestServer(app);
    try {
      const response = await makeRequest({ hostname: '127.0.0.1', port: server.port, path: '/file.txt', method: 'GET' });
      assertEqual(response.statusCode, 403);
      assert(!response.body.includes('private'));
    } finally {
      await server.close();
    }
  } finally {
    cleanupTempDir(tempDir);
  }
});

runner.test('Should pass rejected symlinks to downstream middleware when fallthrough is enabled', async () => {
  const tempDir = createTempDir();
  try {
    fs.writeFileSync(path.join(tempDir, 'file.txt'), 'private');
    fs.symlinkSync(path.join(tempDir, 'file.txt'), path.join(tempDir, 'link.txt'));
    const app = new Router();
    app.use((req, res, next) => {
      res.set('Cache-Control', 'private, max-age=60');
      res.set('ETag', '"upstream"');
      res.set('X-Upstream', 'retained');
      res._nativeResponse.setHeader('Content-Disposition', 'inline');
      return next();
    });
    app.use(staticMiddleware(tempDir));
    app.get('/link.txt', (req, res) => res.status(200).send('<h1>downstream</h1>'));
    const server = await createTestServer(app);
    try {
      const response = await makeRequest({ hostname: '127.0.0.1', port: server.port, path: '/link.txt', method: 'GET' });
      assertEqual(response.statusCode, 200);
      assertEqual(response.body, '<h1>downstream</h1>');
      assertEqual(response.headers['content-type'], 'text/html; charset=utf-8');
      assertEqual(response.headers['cache-control'], 'private, max-age=60');
      assertEqual(response.headers.etag, '"upstream"');
      assertEqual(response.headers['x-upstream'], 'retained');
      assertEqual(response.headers['content-disposition'], 'inline');
    } finally {
      await server.close();
    }
  } finally {
    cleanupTempDir(tempDir);
  }
});

runner.test('Should serve empty files and HEAD responses without stream offset errors', async () => {
  const tempDir = createTempDir();
  try {
    fs.writeFileSync(path.join(tempDir, 'empty.txt'), '');
    fs.writeFileSync(path.join(tempDir, 'file.txt'), 'public');
    const app = new Router();
    app.use(staticMiddleware(tempDir, { fallthrough: false }));
    const server = await createTestServer(app);
    try {
      const empty = await makeRequest({ hostname: '127.0.0.1', port: server.port, path: '/empty.txt', method: 'GET' });
      assertEqual(empty.statusCode, 200);
      assertEqual(empty.headers['content-length'], '0');
      assertEqual(empty.body, '');
      const head = await makeRequest({ hostname: '127.0.0.1', port: server.port, path: '/file.txt', method: 'HEAD' });
      assertEqual(head.statusCode, 200);
      assertEqual(head.headers['content-length'], '6');
      assertEqual(head.body, '');
    } finally {
      await server.close();
    }
  } finally {
    cleanupTempDir(tempDir);
  }
});

runner.run().then(success => {
  process.exit(success ? 0 : 1);
});
