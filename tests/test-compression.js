const { TestRunner, createTestServer, makeRequest, assert, assertEqual } = require('./test-helper');
const { Router, compression } = require('../index');
const zlib = require('zlib');

const runner = new TestRunner('Compression Tests');

runner.test('Should compress responses with gzip', async () => {
  const app = new Router();
  
  app.use(compression());
  
  // Create a large response to trigger compression
  const largeData = 'x'.repeat(1000);
  
  app.get('/data', (req, res) => {
    res.json({ data: largeData });
  });
  
  const server = await createTestServer(app);
  
  try {
    const response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/data',
      method: 'GET',
      headers: {
        'Accept-Encoding': 'gzip, deflate'
      }
    });
    
    assertEqual(response.statusCode, 200);
    assertEqual(response.headers['content-encoding'], 'gzip');
    
    // Decompress the response
    const decompressed = zlib.gunzipSync(Buffer.from(response.body, 'binary'));
    const data = JSON.parse(decompressed.toString());
    assertEqual(data.data, largeData);
  } finally {
    await server.close();
  }
});

runner.test('Should compress with deflate when preferred', async () => {
  const app = new Router();
  
  app.use(compression());
  
  const largeData = 'y'.repeat(1000);
  
  app.get('/data', (req, res) => {
    res.json({ data: largeData });
  });
  
  const server = await createTestServer(app);
  
  try {
    const response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/data',
      method: 'GET',
      headers: {
        'Accept-Encoding': 'deflate'
      }
    });
    
    assertEqual(response.statusCode, 200);
    assertEqual(response.headers['content-encoding'], 'deflate');
    
    // Decompress the response
    const decompressed = zlib.inflateSync(Buffer.from(response.body, 'binary'));
    const data = JSON.parse(decompressed.toString());
    assertEqual(data.data, largeData);
  } finally {
    await server.close();
  }
});

runner.test('Should not compress small responses', async () => {
  const app = new Router();
  
  app.use(compression({
    threshold: 1024 // Only compress if size > 1KB
  }));
  
  app.get('/small', (req, res) => {
    res.json({ message: 'Small response' });
  });
  
  const server = await createTestServer(app);
  
  try {
    const response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/small',
      method: 'GET',
      headers: {
        'Accept-Encoding': 'gzip, deflate'
      }
    });
    
    assertEqual(response.statusCode, 200);
    assert(!response.headers['content-encoding'], 'Should not compress small response');
    
    // Response should be plain JSON
    const data = JSON.parse(response.body);
    assertEqual(data.message, 'Small response');
  } finally {
    await server.close();
  }
});

runner.test('Should respect compression level settings', async () => {
  const app = new Router();
  
  app.use(compression({
    level: 9 // Maximum compression
  }));
  
  const largeData = 'z'.repeat(10000);
  
  app.get('/data', (req, res) => {
    res.send(largeData);
  });
  
  const server = await createTestServer(app);
  
  try {
    const response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/data',
      method: 'GET',
      headers: {
        'Accept-Encoding': 'gzip'
      }
    });
    
    assertEqual(response.statusCode, 200);
    assertEqual(response.headers['content-encoding'], 'gzip');
    
    // High compression should result in smaller size
    assert(response.body.length < largeData.length, 'Compressed size should be smaller');
  } finally {
    await server.close();
  }
});

runner.test('Should handle Brotli compression', async () => {
  const app = new Router();
  
  app.use(compression({
    brotli: { enabled: true }
  }));
  
  const largeData = 'a'.repeat(1000);
  
  app.get('/data', (req, res) => {
    res.json({ data: largeData });
  });
  
  const server = await createTestServer(app);
  
  try {
    const response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/data',
      method: 'GET',
      headers: {
        'Accept-Encoding': 'br, gzip, deflate'
      }
    });
    
    assertEqual(response.statusCode, 200);
    
    // Should prefer Brotli if available
    if (response.headers['content-encoding'] === 'br') {
      const decompressed = zlib.brotliDecompressSync(Buffer.from(response.body, 'binary'));
      const data = JSON.parse(decompressed.toString());
      assertEqual(data.data, largeData);
    } else {
      // Fallback to gzip if Brotli not available
      assertEqual(response.headers['content-encoding'], 'gzip');
    }
  } finally {
    await server.close();
  }
});

runner.test('Should filter content types', async () => {
  const app = new Router();
  
  app.use(compression({
    filter: (req, res) => {
      // Only compress JSON responses
      const contentType = res.getHeader('content-type');
      return contentType && contentType.includes('json');
    }
  }));
  
  const largeData = 'b'.repeat(2000);
  
  app.get('/json', (req, res) => {
    res.json({ data: largeData });
  });
  
  app.get('/text', (req, res) => {
    res.set('Content-Type', 'text/plain');
    res.send(largeData);
  });
  
  const server = await createTestServer(app);
  
  try {
    // Test JSON (should compress)
    let response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/json',
      method: 'GET',
      headers: {
        'Accept-Encoding': 'gzip'
      }
    });
    
    assertEqual(response.statusCode, 200);
    assertEqual(response.headers['content-encoding'], 'gzip');
    
    // Test plain text (should not compress)
    response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/text',
      method: 'GET',
      headers: {
        'Accept-Encoding': 'gzip'
      }
    });
    
    assertEqual(response.statusCode, 200);
    assert(!response.headers['content-encoding'], 'Should not compress text/plain');
  } finally {
    await server.close();
  }
});

runner.test('Should handle streaming responses', async () => {
  const app = new Router();
  const { Readable } = require('stream');
  
  app.use(compression());
  
  app.get('/stream', (req, res) => {
    res.set('Content-Type', 'text/plain');
    
    const stream = new Readable({
      read() {
        for (let i = 0; i < 100; i++) {
          this.push('Stream data chunk ' + i + '\n');
        }
        this.push(null);
      }
    });
    
    stream.pipe(res);
  });
  
  const server = await createTestServer(app);
  
  try {
    const response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/stream',
      method: 'GET',
      headers: {
        'Accept-Encoding': 'gzip'
      }
    });
    
    assertEqual(response.statusCode, 200);
    assertEqual(response.headers['content-encoding'], 'gzip');
    
    // Decompress and verify
    const decompressed = zlib.gunzipSync(Buffer.from(response.body, 'binary'));
    const text = decompressed.toString();
    assert(text.includes('Stream data chunk 0'), 'Should contain stream data');
    assert(text.includes('Stream data chunk 99'), 'Should contain all chunks');
  } finally {
    await server.close();
  }
});

runner.test('Should preserve original headers', async () => {
  const app = new Router();
  
  app.use(compression());
  
  app.get('/headers', (req, res) => {
    res.set('X-Custom-Header', 'test-value');
    res.set('Cache-Control', 'no-cache');
    res.json({ data: 'x'.repeat(1000) });
  });
  
  const server = await createTestServer(app);
  
  try {
    const response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/headers',
      method: 'GET',
      headers: {
        'Accept-Encoding': 'gzip'
      }
    });
    
    assertEqual(response.statusCode, 200);
    assertEqual(response.headers['content-encoding'], 'gzip');
    assertEqual(response.headers['x-custom-header'], 'test-value');
    assertEqual(response.headers['cache-control'], 'no-cache');
  } finally {
    await server.close();
  }
});

runner.test('Should handle HEAD requests', async () => {
  const app = new Router();
  
  app.use(compression());
  
  app.get('/data', (req, res) => {
    res.json({ data: 'x'.repeat(1000) });
  });
  
  const server = await createTestServer(app);
  
  try {
    const response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/data',
      method: 'HEAD',
      headers: {
        'Accept-Encoding': 'gzip'
      }
    });
    
    assertEqual(response.statusCode, 200);
    assertEqual(response.headers['content-encoding'], 'gzip');
    assertEqual(response.body, '', 'HEAD request should have empty body');
  } finally {
    await server.close();
  }
});

runner.test('Should handle no Accept-Encoding header', async () => {
  const app = new Router();
  
  app.use(compression());
  
  const largeData = 'c'.repeat(1000);
  
  app.get('/data', (req, res) => {
    res.json({ data: largeData });
  });
  
  const server = await createTestServer(app);
  
  try {
    const response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/data',
      method: 'GET'
      // No Accept-Encoding header
    });
    
    assertEqual(response.statusCode, 200);
    assert(!response.headers['content-encoding'], 'Should not compress without Accept-Encoding');
    
    const data = JSON.parse(response.body);
    assertEqual(data.data, largeData);
  } finally {
    await server.close();
  }
});

// Run the tests
runner.run().then(success => {
  process.exit(success ? 0 : 1);
});