/**
 * Example demonstrating body parser middleware integration
 * with the existing Request class body parsing capabilities
 */

const { Router, createServer } = require('./lib/velocy');
const { bodyParser, cors, cookieParser } = require('./lib/middleware');

const router = new Router();

// Apply middleware stack
router.use(cors.allowAll());
router.use(cookieParser('my-secret-key'));
router.use(bodyParser({
  json: true,
  urlencoded: true,
  extended: true,
  multipart: true,
  preserveRawBody: true,
  jsonLimit: '5mb',
  multipartLimit: '50mb',
  fileMemoryLimit: '10mb',
  cache: true // Cache parsed body to avoid re-parsing
}));

// Example 1: JSON body with validation
router.post('/api/users', async (req, res) => {
  try {
    // The middleware has already parsed the body
    const body = await req.body;
    
    // Validate required fields
    if (!body.name || !body.email) {
      return res.status(400).json({
        error: 'Missing required fields: name and email'
      });
    }
    
    // Access raw body if needed
    if (req.rawBody) {
      console.log('Raw body size:', req.rawBody.length, 'bytes');
    }
    
    res.json({
      message: 'User created',
      user: {
        id: Date.now(),
        name: body.name,
        email: body.email,
        createdAt: new Date().toISOString()
      }
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Example 2: Form data with nested objects
router.post('/api/profile', async (req, res) => {
  const body = await req.body;
  
  // Extended parsing handles nested objects
  // e.g., user[name]=John&user[age]=30&hobbies[]=reading&hobbies[]=coding
  res.json({
    message: 'Profile updated',
    profile: body
  });
});

// Example 3: File upload with metadata
router.post('/api/documents', async (req, res) => {
  const body = await req.body;
  
  const documents = [];
  const metadata = {};
  
  for (const [key, value] of Object.entries(body)) {
    if (value && typeof value === 'object' && value.filename) {
      // It's a file
      documents.push({
        fieldName: key,
        filename: value.filename,
        mimetype: value.mimetype,
        size: value.size,
        stored: value.inMemory ? 'memory' : 'disk',
        path: value.path
      });
    } else {
      // It's metadata
      metadata[key] = value;
    }
  }
  
  res.json({
    message: 'Documents received',
    documents,
    metadata,
    totalFiles: documents.length
  });
});

// Example 4: Content negotiation with body parsing
router.post('/api/data', async (req, res) => {
  const body = await req.body;
  
  // Check what the client accepts
  if (req.acceptsJSON()) {
    res.json({
      format: 'json',
      data: body
    });
  } else if (req.acceptsHTML()) {
    res.html(`
      <html>
        <body>
          <h1>Data Received</h1>
          <pre>${JSON.stringify(body, null, 2)}</pre>
        </body>
      </html>
    `);
  } else {
    res.text(`Data received: ${JSON.stringify(body)}`);
  }
});

// Example 5: Combining cookies and body parsing
router.post('/api/session', async (req, res) => {
  const body = await req.body;
  const cookies = req.cookies;
  const signedCookies = req.signedCookies;
  
  // Check for existing session
  const sessionId = signedCookies.sessionId || crypto.randomBytes(16).toString('hex');
  
  // Set signed cookie
  res.cookie('sessionId', sessionId, {
    signed: true,
    httpOnly: true,
    maxAge: 86400000 // 24 hours
  });
  
  res.json({
    message: 'Session created/updated',
    sessionId,
    userData: body,
    existingCookies: Object.keys(cookies).length,
    isNewSession: !signedCookies.sessionId
  });
});

// Example 6: Streaming large files efficiently
router.post('/api/stream', bodyParser({
  multipartLimit: '100mb',
  fileMemoryLimit: '1mb' // Files larger than 1MB go to disk
}), async (req, res) => {
  const body = await req.body;
  
  const results = [];
  for (const [key, value] of Object.entries(body)) {
    if (value && value.filename) {
      // Process file
      if (value.path) {
        // File is on disk, we can stream it
        console.log(`Large file stored at: ${value.path}`);
        results.push({
          file: value.filename,
          size: value.size,
          location: 'disk',
          path: value.path
        });
      } else if (value.buffer) {
        // Small file in memory
        results.push({
          file: value.filename,
          size: value.size,
          location: 'memory'
        });
      }
    }
  }
  
  res.json({
    message: 'Files processed',
    files: results
  });
});

// Example 7: Custom body parser for specific route
router.post('/api/webhook',
  bodyParser({
    raw: true,
    rawType: 'buffer',
    rawLimit: '10mb',
    verify: (req, res, buf, encoding) => {
      // Verify webhook signature
      const signature = req.headers['x-webhook-signature'];
      if (!signature) {
        throw new Error('Missing webhook signature');
      }
      
      // Example: Verify HMAC signature
      const crypto = require('crypto');
      const hmac = crypto.createHmac('sha256', 'webhook-secret');
      const expectedSignature = hmac.update(buf).digest('hex');
      
      if (signature !== expectedSignature) {
        throw new Error('Invalid webhook signature');
      }
    }
  }),
  async (req, res) => {
    const rawBody = await req.body;
    
    // Parse the raw buffer
    const data = JSON.parse(rawBody.toString());
    
    res.json({
      message: 'Webhook received',
      event: data.event,
      timestamp: new Date().toISOString()
    });
  }
);

// Example 8: Conditional body parsing based on content-type
router.post('/api/flexible', async (req, res) => {
  const body = await req.body;
  
  // The middleware automatically detects and parses based on content-type
  const contentType = req.headers['content-type'];
  
  res.json({
    message: 'Flexible endpoint',
    contentType,
    bodyType: typeof body,
    isArray: Array.isArray(body),
    body
  });
});

// Error handling middleware
router.use((err, req, res, next) => {
  console.error('Error occurred:', err);
  
  if (err.name === 'BodyParserError') {
    res.status(err.statusCode).json({
      error: err.message,
      code: err.code
    });
  } else {
    res.status(500).json({
      error: 'Internal server error',
      message: err.message
    });
  }
});

const crypto = require('crypto');
const server = createServer(router);
const PORT = 3003;

server.listen(PORT, () => {
  console.log(`Body parser integration example running on http://localhost:${PORT}`);
  console.log('\nExample requests:');
  
  console.log('\n1. Create user (JSON):');
  console.log(`curl -X POST http://localhost:${PORT}/api/users -H "Content-Type: application/json" -d '{"name":"John Doe","email":"john@example.com","age":30}'`);
  
  console.log('\n2. Update profile (nested form data):');
  console.log(`curl -X POST http://localhost:${PORT}/api/profile -H "Content-Type: application/x-www-form-urlencoded" -d "user[name]=Jane&user[email]=jane@example.com&user[age]=25&settings[notifications]=true&settings[theme]=dark&tags[]=developer&tags[]=nodejs"`);
  
  console.log('\n3. Upload documents:');
  console.log(`curl -X POST http://localhost:${PORT}/api/documents -F "resume=@package.json" -F "cover=@README.md" -F "title=Job Application" -F "position=Senior Developer"`);
  
  console.log('\n4. Content negotiation:');
  console.log(`curl -X POST http://localhost:${PORT}/api/data -H "Content-Type: application/json" -H "Accept: application/json" -d '{"test":"data"}'`);
  console.log(`curl -X POST http://localhost:${PORT}/api/data -H "Content-Type: application/json" -H "Accept: text/html" -d '{"test":"data"}'`);
  
  console.log('\n5. Session with cookies:');
  console.log(`curl -X POST http://localhost:${PORT}/api/session -H "Content-Type: application/json" -b "sessionId=test123" -c cookies.txt -d '{"username":"alice","role":"admin"}'`);
  
  console.log('\n6. Large file streaming:');
  console.log(`curl -X POST http://localhost:${PORT}/api/stream -F "video=@large-file.mp4" -F "thumbnail=@thumb.jpg"`);
  
  console.log('\n7. Webhook with signature (will fail without correct signature):');
  console.log(`curl -X POST http://localhost:${PORT}/api/webhook -H "Content-Type: application/json" -H "X-Webhook-Signature: invalid" -d '{"event":"payment.completed","amount":100}'`);
  
  console.log('\n8. Flexible endpoint (auto-detects content type):');
  console.log(`curl -X POST http://localhost:${PORT}/api/flexible -H "Content-Type: application/json" -d '{"format":"json"}'`);
  console.log(`curl -X POST http://localhost:${PORT}/api/flexible -H "Content-Type: application/x-www-form-urlencoded" -d "format=urlencoded&test=true"`);
});