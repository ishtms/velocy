# Body Parser Middleware

A no-deps body parsing middleware for the Velocy framework that handles JSON, URL-encoded, multipart form data, and raw body parsing using only Node.js built-in modules.

## Features

- **Zero Dependencies**: Uses only Node.js built-in modules
- **Multiple Content Types**: JSON, URL-encoded, multipart/form-data, raw/text
- **Bounded Body Collection**: Configurable byte, form-structure, and multipart limits
- **Extended URL Encoding**: Support for nested objects and arrays
- **File Uploads**: Handles multipart file uploads with memory/disk storage
- **Security**: Size limits, verification hooks, and error handling
- **Caching**: Avoids re-parsing the same request body
- **Raw Body Preservation**: Optional access to unparsed body

## Installation

The body parser is included with Velocy:

```javascript
const { bodyParser } = require("velocy/lib/middleware");
```

## Basic Usage

```javascript
const { Router, createServer } = require("velocy");
const bodyParser = require("velocy/lib/middleware/bodyParser");

const router = new Router();

// Apply body parser to all routes
router.use(bodyParser());

router.post("/api/data", async (req, res) => {
  const body = await req.body; // Already parsed by middleware
  res.json({ received: body });
});

const server = createServer(router);
```

## Configuration Options

```javascript
bodyParser({
  // JSON parsing
  json: true, // Enable JSON parsing (default: true)
  jsonLimit: "100kb", // Size limit for JSON bodies

  // URL-encoded parsing
  urlencoded: true, // Enable URL-encoded parsing (default: true)
  urlencodedLimit: "100kb", // Size limit for URL-encoded bodies
  extended: true, // Support nested objects/arrays (default: true)
  parameterLimit: 1000, // Max number of parameters
  depthLimit: 32, // Max bracket segments in extended URL-encoded keys
  arrayLimit: 1000, // Max extended-form array length/index + 1

  // Multipart parsing
  multipart: true, // Enable multipart parsing (default: true)
  multipartLimit: "10mb", // Size limit for multipart bodies
  fileMemoryLimit: "1mb", // Max file size to keep in memory
  tempDirectory: os.tmpdir(), // Directory for temporary files
  maxFiles: 100,
  maxFields: 1000,
  maxParts: 1100, // Total multipart parts, including files and fields
  maxHeaderSize: "16kb", // Per-part header bytes (excluding final CRLF CRLF)
  maxFieldSize: "1mb", // Per-field value bytes

  // Raw body parsing
  raw: false, // Enable raw body parsing (default: false)
  rawLimit: "100kb", // Size limit for raw bodies
  rawType: "string", // 'buffer' or 'string' (default: 'string')

  // General options
  preserveRawBody: false, // Store raw body in req.rawBody
  cache: true, // Cache parsed body (default: true)
  verify: undefined, // Awaited for every enabled body type, before parsing/storage
});
```

## Content Type Specific Parsers

### JSON Parser

```javascript
// JSON-only parser with custom options
router.use(
  bodyParser.json({
    jsonLimit: "5mb",
    preserveRawBody: true,
    verify: (req, res, buf, encoding) => {
      // Custom verification logic
      if (buf.length > 1000000) {
        throw new Error("JSON body too large");
      }
    },
  })
);
```

### URL-Encoded Parser

```javascript
// URL-encoded parser with extended mode
router.use(
  bodyParser.urlencoded({
    extended: true, // Enables nested object support
    parameterLimit: 2000,
    urlencodedLimit: "500kb",
  })
);

// Handles: user[name]=John&user[age]=30&tags[]=nodejs&tags[]=velocy
```

### Multipart Parser

```javascript
// Multipart parser for file uploads
router.use(
  bodyParser.multipart({
    multipartLimit: "50mb",
    fileMemoryLimit: "5mb", // Files > 5MB go to disk
    tempDirectory: "./uploads",
  })
);

router.post("/upload", async (req, res) => {
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
router.use(
  bodyParser.raw({
    rawLimit: "10mb",
    rawType: "buffer", // Returns Buffer instead of string
  })
);

// Text parser (convenience method)
router.use(
  bodyParser.text({
    rawLimit: "1mb",
  })
);
```

## Advanced Usage

### Conditional Parsing

```javascript
// Apply different parsers to different routes
router.post("/api/json", bodyParser.json(), handler);
router.post("/api/form", bodyParser.urlencoded(), handler);
router.post("/api/upload", bodyParser.multipart(), handler);
```

### Verification and Security

```javascript
// Webhook signature verification
router.post(
  "/webhook",
  bodyParser({
    raw: true,
    rawType: "buffer",
    verify: (req, res, buf, encoding) => {
      const signature = req.headers["x-webhook-signature"];
      const secret = process.env.WEBHOOK_SECRET; // Provision through your secret store.
      if (!secret) throw new Error("Webhook verification is not configured");
      const hmac = crypto.createHmac("sha256", secret);
      const expected = hmac.update(buf).digest("hex");

      if (typeof signature !== "string" || !/^[0-9a-f]{64}$/.test(signature) ||
          !crypto.timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expected, "hex"))) {
        throw new Error("Invalid signature");
      }
    },
  }),
  async (req, res) => {
    // Body is verified
    const data = JSON.parse(req.body.toString());
    res.json({ received: data });
  }
);
```

### Accessing Raw Body

```javascript
router.use(
  bodyParser({
    preserveRawBody: true,
  })
);

router.post("/api/data", async (req, res) => {
  const parsed = await req.body; // Parsed body
  const raw = req.rawBody; // Raw Buffer

  console.log("Parsed:", parsed);
  console.log("Raw size:", raw.length);

  res.json({ parsed, rawSize: raw.length });
});
```

### Handling Large Files

```javascript
router.use(
  bodyParser({
    multipartLimit: "100mb",
    fileMemoryLimit: "1mb", // Only keep files < 1MB in memory
  })
);

router.post("/upload", async (req, res) => {
  const body = await req.body;

  for (const [key, file] of Object.entries(req.files || {})) {
    if (file && file.filename) {
      if (file.inMemory) {
        // Small file - process from memory
        console.log("Processing from memory:", file.buffer);
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
  if (err.name === "BodyParserError") {
    res.status(err.statusCode).json({
      error: err.message,
      code: err.code,
    });
  }
});
```

Error codes:

- `LIMIT_FILE_SIZE`: Body exceeds size limit
- `INVALID_JSON`: Malformed JSON
- `MISSING_BOUNDARY`: Missing boundary in multipart
- `INVALID_BOUNDARY`, `INVALID_MULTIPART`: Invalid boundary or malformed/incomplete multipart framing
- `INVALID_FORM_KEY`: Unsafe prototype key, malformed bracket syntax, or nonnumeric array property
- `LIMIT_FORM_DEPTH`, `LIMIT_ARRAY_SIZE`: Extended form structure exceeds configured limits (413)
- `LIMIT_FILE_COUNT`, `LIMIT_FIELD_COUNT`, `LIMIT_PART_COUNT`: Multipart count limit exceeded (413)
- `LIMIT_FIELD_SIZE`, `LIMIT_HEADER_SIZE`: Multipart field/header byte limit exceeded (413)
- `INVALID_FILENAME`: Upload filename is not a safe basename
- `EMPTY_FILE`: Empty file rejected by `allowEmptyFiles: false`
- `REQUEST_ABORTED`: Request aborted or closed before body completion
- `BODY_ALREADY_CONSUMED`, `INVALID_BODY_STREAM`: Body already read or decoded by earlier middleware
- `UPLOAD_CLEANUP_FAILED`: Failed-upload rollback could not remove a created file (500; requires operator attention)
- `PARSE_ERROR`: General parsing error

`parameterLimit` applies to both simple and extended URL-encoded parsing, including
when `preserveRawBody` is enabled. Only the first configured number of form
parameters is parsed; later parameters are ignored. Repeated keys count separately.
The raw body, when preserved, remains complete and subject to `urlencodedLimit`.

### Input safety and compatibility

- Multipart boundaries are case-insensitive **parameter names** with case-sensitive values.
  Quoted boundary values (including internal spaces) are supported, up to 70 characters.
  Delimiters must be complete MIME delimiter lines; bare boundary text or prefix
  lookalikes inside binary content are preserved. Incomplete bodies and malformed
  headers now fail with 400 instead of silently producing partial results.
- Content-Disposition parameters are parsed as MIME tokens or quoted strings,
  including quoted-pair escapes for quotes/backslashes. Parameter names are
  case-insensitive; `filename` presence (even an empty value) selects file parsing
  and all file-specific policies. `originalFilename` contains the decoded MIME
  parameter value, not literal header escape sequences; file bytes remain binary.
  Malformed parameters, case-insensitive duplicates, and unsupported extended or
  continued `filename*`/`name*` variants fail with `INVALID_MULTIPART` (400), never
  fall back to a regular field. Text resembling parameters inside a quoted value
  cannot create extra parameters or change the field/file classification.
- Multipart fields/files are separate null-prototype maps (`req.body`/`req.files`),
  so a field and file with the same name are both retained. An empty `filename=""`
  is still a file and obeys `allowEmptyFiles`. Prototype-related multipart field
  names and extended-form path segments (`__proto__`, `constructor`, `prototype`)
  are rejected. Extended forms accept numeric array keys or final `[]` push syntax;
  array properties such as `length` and nested empty bracket paths are rejected.
  Malformed bracket syntax no longer silently drops trailing key text.
- Defaults now bound extended forms to 32 bracket levels and array length 1000,
  and multipart to 100 files, 1000 fields, 1100 total parts, 16 KiB headers per part,
  and 1 MiB per field. Set these explicitly when legitimate applications need more.
  Count/depth limits must be non-negative safe integers; zero forbids that resource.
  The total byte limit remains authoritative for all request bytes. These form
  structural limits do not validate JSON schemas or application business data.
- Upload filename callbacks must synchronously return a nonempty basename of at
  most 255 UTF-8 bytes, without path separators, platform-special/control characters,
  trailing dots/spaces, or Windows reserved device names. This applies to in-memory files too. Client filenames
  remain untrusted metadata, never storage paths. Disk creation uses exclusive
  `wx` mode and permissions `0600`: existing files/symlinks and duplicate callback
  names fail rather than being overwritten. Use an application-controlled upload
  directory whose parent directories cannot be renamed or replaced by attackers;
  exclusive creation does not secure an attacker-writable ancestor directory.
- Every parser now awaits `verify(req, res, buffer, charset)` once, regardless of
  `preserveRawBody`; rejecting the hook prevents parsing and upload creation.
  Previously, hooks were skipped for raw/multipart and when preservation was off.
  `preserveRawBody` now retains the exact multipart/raw bytes, not a multipart
  placeholder or a re-encoded text representation. Do not log sensitive raw bodies.
- Aborts/premature closes settle with an error. Size violations reject promptly
  without retaining later chunks; remaining incoming bytes are drained. Configure
  server request/header timeouts, connection/rate limits, and a trusted proxy as
  appropriate: body limits are not a complete slow-client/traffic defense.
- Parsed null/empty JSON is cached as `null` rather than falling through to a
  second read of the consumed native request. Chunked bodies are parsed on DELETE
  and other methods as well as POST/PUT/PATCH; verification cannot be skipped by
  omitting `Content-Length` on a chunked request. Invalid JSON errors do not echo
  submitted payload fragments to the client.
- Disk files created during a failed multipart parse/write/cancellation are removed
  before the error is delivered. Successful uploads belong to the application:
  remove them after use, including on downstream handler failures. `fileMemoryLimit`
  selects final storage, not streaming parsing: the entire multipart body is
  buffered first, with additional collection/copy overhead. Concurrent requests
  multiply this memory requirement.

## Performance Considerations

1. **Size Limits**: Always set appropriate size limits to prevent DoS attacks. Numeric and parsed string limits must be non-negative safe integers that fit in a Node.js Buffer; invalid values throw during middleware configuration. `parameterLimit` must be a positive safe integer.
2. **File Storage**: Configure `fileMemoryLimit` based on available memory
3. **Caching**: The `cache` option prevents re-parsing the same body
4. **Buffering**: Multipart bodies are buffered before selected files are written to disk; set conservative total limits and bound concurrency
5. **Temp Files**: Ensure temp directory has sufficient space and permissions

## Integration with Request Class

The body parser middleware integrates seamlessly with Velocy's Request class:

```javascript
router.post("/api/mixed", async (req, res) => {
  // These all work together
  const body = await req.body; // Parsed by middleware
  const cookies = req.cookies; // From Request class
  const query = req.query; // From Request class
  const isJson = req.is("json"); // Content-type checking
  const acceptsJson = req.acceptsJSON(); // Content negotiation

  res.json({
    body,
    cookies,
    query,
    contentType: req.headers["content-type"],
  });
});
```

## Examples

### Complete Form Handler

```javascript
router.post("/contact", bodyParser(), async (req, res) => {
  const body = await req.body;

  // Validate required fields
  const required = ["name", "email", "message"];
  const missing = required.filter((field) => !body[field]);

  if (missing.length > 0) {
    return res.status(400).json({
      error: `Missing required fields: ${missing.join(", ")}`,
    });
  }

  // Process form
  await processContactForm(body);

  res.json({ success: true });
});
```

### File Upload with Progress

```javascript
router.post(
  "/upload-progress",
  bodyParser.multipart({
    multipartLimit: "100mb",
  }),
  async (req, res) => {
    const body = await req.body;
    const files = [];

    for (const [field, value] of Object.entries(req.files || {})) {
      if (value && value.filename) {
        files.push({
          field,
          name: value.filename,
          size: value.size,
          type: value.mimetype,
        });
      }
    }

    res.json({
      message: "Upload complete",
      files,
      totalSize: files.reduce((sum, f) => sum + f.size, 0),
    });
  }
);
```

### API with Multiple Content Types

```javascript
router.post("/api/flexible", bodyParser(), async (req, res) => {
  const body = await req.body;
  const contentType = req.headers["content-type"];

  // Handle different content types
  if (req.is("json")) {
    // JSON request
    await handleJSON(body);
  } else if (req.is("urlencoded")) {
    // Form data
    await handleForm(body);
  } else if (req.is("multipart")) {
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
const bodyParser = require("body-parser");
app.use(bodyParser.json({ limit: "5mb" }));
app.use(bodyParser.urlencoded({ extended: true }));

// Velocy
const { bodyParser } = require("velocy/lib/middleware");
router.use(
  bodyParser({
    jsonLimit: "5mb",
    extended: true,
  })
);
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

- Reduce `multipartLimit` and concurrent uploads to bound body collection
- `fileMemoryLimit` selects final disk storage; it does not eliminate full-body buffering
- Ensure temp directory has space

### Parsing errors

- Check for malformed JSON or form data
- Verify character encoding is correct
- Enable `preserveRawBody` to debug raw content
