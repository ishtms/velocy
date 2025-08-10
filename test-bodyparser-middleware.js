/**
 * Test file for body parser middleware
 * Demonstrates various configurations and usage patterns
 */

const { Router, createServer } = require('./lib/velocy');
const bodyParser = require('./lib/middleware/bodyParser');

const router = new Router();

// Example 1: Default body parser (handles JSON, URL-encoded, and multipart)
const defaultParser = bodyParser();

// Example 2: JSON only with custom limit
const jsonParser = bodyParser.json({
  jsonLimit: '1mb',
  preserveRawBody: true,
  verify: (req, res, buf, encoding) => {
    // Custom verification logic
    console.log(`Verifying JSON body: ${buf.length} bytes`);
  }
});

// Example 3: URL-encoded with extended mode
const urlencodedParser = bodyParser.urlencoded({
  extended: true,
  parameterLimit: 2000,
  urlencodedLimit: '500kb'
});

// Example 4: Multipart with file handling
const multipartParser = bodyParser.multipart({
  multipartLimit: '50mb',
  fileMemoryLimit: '5mb',
  tempDirectory: './uploads'
});

// Example 5: Raw/text parser
const textParser = bodyParser.text({
  rawLimit: '1mb',
  rawType: 'string'
});

// Apply default parser to all routes
router.use(defaultParser);

// Route that uses the default parser
router.post('/api/default', async (req, res) => {
  console.log('Headers:', req.headers);
  console.log('Content-Type:', req.headers['content-type']);
  
  // Body is already parsed by middleware
  const body = await req.body;
  console.log('Parsed body:', body);
  
  // Access synchronous parsed body
  console.log('Sync parsed body:', req.parsedBody);
  
  res.json({
    received: body,
    type: typeof body,
    parsedBody: req.parsedBody
  });
});

// Route with custom JSON parser
router.post('/api/json-custom', jsonParser, async (req, res) => {
  const body = await req.body;
  
  res.json({
    body: body,
    rawBodySize: req.rawBody ? req.rawBody.length : 0,
    rawBodyPreview: req.rawBody ? req.rawBody.toString().substring(0, 100) : null
  });
});

// Route for nested form data
router.post('/api/nested-form', urlencodedParser, async (req, res) => {
  const body = await req.body;
  
  res.json({
    received: body,
    message: 'Extended URL-encoded parsing with nested objects'
  });
});

// Route for file uploads
router.post('/api/upload-advanced', multipartParser, async (req, res) => {
  const body = await req.body;
  
  // Process files
  const fileInfo = {};
  for (const [key, value] of Object.entries(body)) {
    if (value && typeof value === 'object' && value.filename) {
      fileInfo[key] = {
        filename: value.filename,
        mimetype: value.mimetype,
        size: value.size,
        inMemory: value.inMemory,
        path: value.path
      };
    }
  }
  
  res.json({
    fields: Object.entries(body)
      .filter(([_, v]) => !(v && typeof v === 'object' && v.filename))
      .reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {}),
    files: fileInfo
  });
});

// Route for raw text
router.post('/api/raw-text', textParser, async (req, res) => {
  const body = await req.body;
  
  res.json({
    type: 'text',
    content: body,
    length: body.length
  });
});

// Error handling middleware
router.use((err, req, res, next) => {
  console.error('Error:', err);
  
  if (err.name === 'BodyParserError') {
    res.status(err.statusCode || 400).json({
      error: err.message,
      code: err.code
    });
  } else {
    res.status(500).json({
      error: 'Internal server error'
    });
  }
});

// Test route for large payloads
router.post('/api/large-test', 
  bodyParser({
    jsonLimit: '1kb',
    preserveRawBody: true
  }),
  async (req, res) => {
    try {
      const body = await req.body;
      res.json({ success: true, bodySize: JSON.stringify(body).length });
    } catch (error) {
      res.status(413).json({
        error: 'Payload too large',
        message: error.message
      });
    }
  }
);

// Test route for custom verification
router.post('/api/verified',
  bodyParser({
    verify: (req, res, buf, encoding) => {
      // Example: Check for a specific header
      if (!req.headers['x-api-key']) {
        throw new Error('Missing API key');
      }
      console.log(`Verified body: ${buf.length} bytes, encoding: ${encoding}`);
    }
  }),
  async (req, res) => {
    const body = await req.body;
    res.json({
      verified: true,
      body: body
    });
  }
);

const server = createServer(router);
const PORT = 3002;

server.listen(PORT, () => {
  console.log(`Body parser middleware test server running on http://localhost:${PORT}`);
  console.log('\nTest commands:');
  
  console.log('\n1. Default parser (JSON):');
  console.log(`curl -X POST http://localhost:${PORT}/api/default -H "Content-Type: application/json" -d '{"name":"Test","values":[1,2,3]}'`);
  
  console.log('\n2. Default parser (URL-encoded):');
  console.log(`curl -X POST http://localhost:${PORT}/api/default -H "Content-Type: application/x-www-form-urlencoded" -d "name=Test&age=25"`);
  
  console.log('\n3. Custom JSON with raw body:');
  console.log(`curl -X POST http://localhost:${PORT}/api/json-custom -H "Content-Type: application/json" -d '{"preserve":"raw","data":true}'`);
  
  console.log('\n4. Nested form data:');
  console.log(`curl -X POST http://localhost:${PORT}/api/nested-form -H "Content-Type: application/x-www-form-urlencoded" -d "user[name]=Alice&user[email]=alice@example.com&tags[]=nodejs&tags[]=velocy"`);
  
  console.log('\n5. File upload:');
  console.log(`curl -X POST http://localhost:${PORT}/api/upload-advanced -F "document=@package.json" -F "description=Package file" -F "tags[]=important"`);
  
  console.log('\n6. Raw text:');
  console.log(`curl -X POST http://localhost:${PORT}/api/raw-text -H "Content-Type: text/plain" -d "This is raw text content"`);
  
  console.log('\n7. Large payload test (will fail):');
  console.log(`curl -X POST http://localhost:${PORT}/api/large-test -H "Content-Type: application/json" -d '{"data":"` + 'x'.repeat(2000) + `"}'`);
  
  console.log('\n8. Verified request:');
  console.log(`curl -X POST http://localhost:${PORT}/api/verified -H "Content-Type: application/json" -H "X-API-Key: secret123" -d '{"secure":"data"}'`);
  
  console.log('\n9. Missing API key (will fail):');
  console.log(`curl -X POST http://localhost:${PORT}/api/verified -H "Content-Type: application/json" -d '{"secure":"data"}'`);
});