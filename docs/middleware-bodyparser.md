# Body Parser Middleware

A comprehensive body parsing middleware for the Velocy framework that handles JSON, URL-encoded, multipart form data, and raw body parsing using only Node.js built-in modules.

## Features

- **Zero Dependencies**: Uses only Node.js built-in modules
- **Multiple Content Types**: JSON, URL-encoded, multipart/form-data, raw/text
- **Streaming Support**: Efficient memory usage with configurable limits
- **Extended URL Encoding**: Support for nested objects and arrays
- **File Uploads**: Handles multipart file uploads with memory/disk storage
- **Security**: Size limits, verification hooks, and error handling
- **Caching**: Avoids re-parsing the same request body
- **Raw Body Preservation**: Optional access to unparsed body

## Installation

The body parser is included with Velocy:

```javascript
const { bodyParser } = require('velocy/lib/middleware');
```

## Basic Usage

```javascript
const { Router, createServer } = require('velocy');
const bodyParser = require('velocy/lib/middleware/bodyParser');

const router = new Router();

// Apply body parser to all routes
router.use(bodyParser());

router.post('/api/data', async (req, res) => {
  const body = await req.body; // Already parsed by middleware
  res.json({ received: body });
});

const server = createServer(router);
```

## Configuration Options

```javascript
bodyParser({
  // JSON parsing
  json: true,                    // Enable JSON parsing (default: true)
  jsonLimit: '100kb',            // Size limit for JSON bodies
  
  // URL-encoded parsing
  urlencoded: true,              // Enable URL-encoded parsing (default: true)
  urlencodedLimit: '100kb',      // Size limit for URL-encoded bodies
  extended: true,                // Support nested objects/arrays (default: true)
  parameterLimit: 1000,          // Max number of parameters
  
  // Multipart parsing
  multipart: true,               // Enable multipart parsing (default: true)
  multipartLimit: '10mb',        // Size limit for multipart bodies
  fileMemoryLimit: '1mb',        // Max file size to keep in memory
  tempDirectory: os.tmpdir(),    // Directory for temporary files
  
  // Raw body parsing
  raw: false,                    // Enable raw body parsing (default: false)
  rawLimit: '100kb',             // Size limit for raw bodies
  rawType: 'string',             // 'buffer' or 'string' (default: 'string')
  
  // General options
  preserveRawBody: false,        // Store raw body in req.rawBody
  cache: true,                   // Cache parsed body (default: true)
  verify: undefined              // Verification function
})
```

## Content Type Specific Parsers

### JSON Parser

```javascript
// JSON-only parser with custom options
router.use(bodyParser.json({
  jsonLimit: '5mb',
  preserveRawBody: true,
  verify: (req, res, buf, encoding) => {
    // Custom verification logic
    if (buf.length > 1000000) {
      throw new Error('JSON body too large');
    }
  }
}));
```

### URL-Encoded Parser

```javascript
// URL-encoded parser with extended mode
router.use(bodyParser.urlencoded({
  extended: true,  // Enables nested object support
  parameterLimit: 2000,
  urlencodedLimit: '500kb'
}));

// Handles: user[name]=John&user[age]=30&tags[]=nodejs&tags[]=velocy
```

### Multipart Parser

```javascript
// Multipart parser for file uploads
router.use(bodyParser.multipart({
  multipartLimit: '50mb',
  fileMemoryLimit: '5mb',  // Files > 5MB go to disk
  tempDirectory: './uploads'
}));

router.post('/upload', async (req, res) => {
  const body = await req.body;
  
  // Files have this structure:
  // {
  //   fieldName: 'avatar',
  //   filename: 'photo.jpg',
  //   mimetype: 'image/jpeg',
  //   size: 102400,
  //   inMemory: false,
  //   path: '/tmp/upload_xyz'  // If stored on disk
  //   buffer: Buffer           // If in memory
  // }
});
```

### Raw/Text Parser

```javascript
// Raw body parser
router.use(bodyParser.raw({
  rawLimit: '10mb',
  rawType: 'buffer'  // Returns Buffer instead of string
}));

// Text parser (convenience method)
router.use(bodyParser.text({
  rawLimit: '1mb'
}));
```

## Advanced Usage

### Conditional Parsing

```javascript
// Apply different parsers to different routes
router.post('/api/json', bodyParser.json(), handler);
router.post('/api/form', bodyParser.urlencoded(), handler);
router.post('/api/upload', bodyParser.multipart(), handler);
```

### Verification and Security

```javascript
// Webhook signature verification
router.post('/webhook', bodyParser({
  raw: true,
  rawType: 'buffer',
  verify: (req, res, buf, encoding) => {
    const signature = req.headers['x-webhook-signature'];
    const hmac = crypto.createHmac('sha256', 'secret');
    const expected = hmac.update(buf).digest('hex');
    
    if (signature !== expected) {
      throw new Error('Invalid signature');
    }
  }
}), async (req, res) => {
  // Body is verified
  const data = JSON.parse(req.body.toString());
  res.json({ received: data });
});
```

### Accessing Raw Body

```javascript
router.use(bodyParser({
  preserveRawBody: true
}));

router.post('/api/data', async (req, res) => {
  const parsed = await req.body;      // Parsed body
  const raw = req.rawBody;            // Raw Buffer
  
  console.log('Parsed:', parsed);
  console.log('Raw size:', raw.length);
  
  res.json({ parsed, rawSize: raw.length });
});
```

### Handling Large Files

```javascript
router.use(bodyParser({
  multipartLimit: '100mb',
  fileMemoryLimit: '1mb'  // Only keep files < 1MB in memory
}));

router.post('/upload', async (req, res) => {
  const body = await req.body;
  
  for (const [key, file] of Object.entries(body)) {
    if (file && file.filename) {
      if (file.inMemory) {
        // Small file - process from memory
        console.log('Processing from memory:', file.buffer);
      } else {
        // Large file - stream from disk
        const stream = fs.createReadStream(file.path);
        // Process stream...
        
        // Clean up temp file when done
        fs.unlink(file.path, () => {});
      }
    }
  }
});
```

## Error Handling

The middleware provides detailed error information:

```javascript
router.use((err, req, res, next) => {
  if (err.name === 'BodyParserError') {
    res.status(err.statusCode).json({
      error: err.message,
      code: err.code
    });
  }
});
```

Error codes:
- `LIMIT_FILE_SIZE`: Body exceeds size limit
- `INVALID_JSON`: Malformed JSON
- `MISSING_BOUNDARY`: Missing boundary in multipart
- `PARSE_ERROR`: General parsing error

## Performance Considerations

1. **Size Limits**: Always set appropriate size limits to prevent DoS attacks
2. **File Storage**: Configure `fileMemoryLimit` based on available memory
3. **Caching**: The `cache` option prevents re-parsing the same body
4. **Streaming**: Large files are automatically streamed to disk
5. **Temp Files**: Ensure temp directory has sufficient space and permissions

## Integration with Request Class

The body parser middleware integrates seamlessly with Velocy's Request class:

```javascript
router.post('/api/mixed', async (req, res) => {
  // These all work together
  const body = await req.body;        // Parsed by middleware
  const cookies = req.cookies;        // From Request class
  const query = req.query;            // From Request class
  const isJson = req.is('json');      // Content-type checking
  const acceptsJson = req.acceptsJSON(); // Content negotiation
  
  res.json({
    body,
    cookies,
    query,
    contentType: req.headers['content-type']
  });
});
```

## Examples

### Complete Form Handler

```javascript
router.post('/contact', bodyParser(), async (req, res) => {
  const body = await req.body;
  
  // Validate required fields
  const required = ['name', 'email', 'message'];
  const missing = required.filter(field => !body[field]);
  
  if (missing.length > 0) {
    return res.status(400).json({
      error: `Missing required fields: ${missing.join(', ')}`
    });
  }
  
  // Process form
  await processContactForm(body);
  
  res.json({ success: true });
});
```

### File Upload with Progress

```javascript
router.post('/upload-progress', bodyParser.multipart({
  multipartLimit: '100mb'
}), async (req, res) => {
  const body = await req.body;
  const files = [];
  
  for (const [field, value] of Object.entries(body)) {
    if (value && value.filename) {
      files.push({
        field,
        name: value.filename,
        size: value.size,
        type: value.mimetype
      });
    }
  }
  
  res.json({
    message: 'Upload complete',
    files,
    totalSize: files.reduce((sum, f) => sum + f.size, 0)
  });
});
```

### API with Multiple Content Types

```javascript
router.post('/api/flexible', bodyParser(), async (req, res) => {
  const body = await req.body;
  const contentType = req.headers['content-type'];
  
  // Handle different content types
  if (req.is('json')) {
    // JSON request
    await handleJSON(body);
  } else if (req.is('urlencoded')) {
    // Form data
    await handleForm(body);
  } else if (req.is('multipart')) {
    // File upload
    await handleFiles(body);
  }
  
  res.json({ processed: true });
});
```

## Migration from Express body-parser

The API is designed to be familiar to Express users:

```javascript
// Express
const bodyParser = require('body-parser');
app.use(bodyParser.json({ limit: '5mb' }));
app.use(bodyParser.urlencoded({ extended: true }));

// Velocy
const { bodyParser } = require('velocy/lib/middleware');
router.use(bodyParser({
  jsonLimit: '5mb',
  extended: true
}));
```

## Security Best Practices

1. **Always set size limits** appropriate for your use case
2. **Validate content types** before processing
3. **Use verification hooks** for webhook endpoints
4. **Clean up temp files** after processing
5. **Implement rate limiting** for upload endpoints
6. **Validate and sanitize** all parsed data
7. **Use HTTPS** for sensitive data transmission

## Troubleshooting

### Body is undefined
- Ensure middleware is applied before route handlers
- Check Content-Type header is set correctly
- Verify body is not empty

### Files not parsing
- Check Content-Type includes boundary parameter
- Ensure multipart parsing is enabled
- Verify file size is within limits

### Memory issues with large files
- Reduce `fileMemoryLimit` to store files on disk
- Increase `multipartLimit` if needed
- Ensure temp directory has space

### Parsing errors
- Check for malformed JSON or form data
- Verify character encoding is correct
- Enable `preserveRawBody` to debug raw content