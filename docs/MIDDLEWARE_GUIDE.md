# Velocy Middleware Guide

## Table of Contents

- [Overview](#overview)
- [Built-in Middleware](#built-in-middleware)
  - [Body Parser](#body-parser)
  - [Cookie Parser](#cookie-parser)
  - [CORS](#cors)
  - [Compression](#compression)
  - [Rate Limiting](#rate-limiting)
  - [Session Management](#session-management)
  - [Static Files](#static-files)
  - [Validator](#validator)
- [Middleware Execution](#middleware-execution)
- [Custom Middleware](#custom-middleware)
- [Error Handling](#error-handling)
- [Performance Considerations](#performance-considerations)
- [Best Practices](#best-practices)

---

## Overview

Middleware functions are executed sequentially during the request-response cycle. They have access to the request object (req), response object (res), and the next middleware function in the stack.

### Middleware Signature

```javascript
function middleware(req, res, next) {
  // Perform operations
  next() // Pass control to next middleware
}

// Async middleware
async function asyncMiddleware(req, res, next) {
  await someAsyncOperation()
  next()
}

// Error handling middleware
function errorMiddleware(err, req, res, next) {
  // Handle error
  res.status(500).json({ error: err.message })
}
```

---

## Built-in Middleware

### Body Parser

Parse incoming request bodies in JSON, URL-encoded, and multipart formats.

#### Basic Usage

```javascript
const { bodyParser } = require('velocy/middleware')

// Parse all body types
router.use(bodyParser())

// Or with specific options
router.use(bodyParser({
  json: true,           // Parse application/json
  urlencoded: true,     // Parse application/x-www-form-urlencoded
  multipart: false,     // Parse multipart/form-data
  text: false,          // Parse text/plain
  raw: false            // Parse application/octet-stream
}))
```

#### Configuration Options

```javascript
router.use(bodyParser({
  // JSON parsing options
  json: {
    limit: '1mb',              // Body size limit
    strict: true,              // Only accept arrays and objects
    reviver: null,             // JSON.parse reviver function
    type: 'application/json'  // Content-Type to match
  },
  
  // URL-encoded parsing options
  urlencoded: {
    limit: '1mb',              // Body size limit
    extended: true,            // Use qs library behavior
    parameterLimit: 1000,      // Maximum number of parameters
    type: 'application/x-www-form-urlencoded'
  },
  
  // Multipart parsing options
  multipart: {
    limit: '10mb',             // Total size limit
    files: true,               // Parse files
    fields: true,              // Parse fields
    maxFiles: 10,              // Maximum number of files
    maxFields: 100,            // Maximum number of fields
    uploadDir: '/tmp'          // Temporary upload directory
  },
  
  // Text parsing options
  text: {
    limit: '1mb',              // Body size limit
    type: 'text/plain',        // Content-Type to match
    defaultCharset: 'utf-8'    // Default charset
  },
  
  // Raw parsing options
  raw: {
    limit: '1mb',              // Body size limit
    type: 'application/octet-stream'  // Content-Type to match
  },
  
  // Global options
  encoding: 'utf-8',           // Default encoding
  verify: (req, res, buf, encoding) => {
    // Verify body content
    // Throw error to reject
  }
}))
```

#### Examples

```javascript
// JSON body parsing
router.post('/api/users', bodyParser(), (req, res) => {
  console.log(req.body)  // Parsed JSON object
  res.json({ created: true })
})

// File upload handling
router.post('/upload', 
  bodyParser({ 
    multipart: {
      limit: '50mb',
      uploadDir: './uploads'
    }
  }), 
  (req, res) => {
    console.log(req.files)  // Uploaded files
    console.log(req.body)   // Other form fields
    res.json({ uploaded: true })
  }
)

// Custom content type
router.post('/xml', 
  bodyParser({
    raw: {
      type: 'application/xml',
      limit: '5mb'
    }
  }),
  (req, res) => {
    const xml = req.body.toString()  // Raw buffer
    // Parse XML...
    res.json({ received: true })
  }
)
```

---

### Cookie Parser

Parse Cookie header and populate req.cookies with an object keyed by cookie names.

#### Basic Usage

```javascript
const { cookieParser } = require('velocy/middleware')

// Basic cookie parsing
router.use(cookieParser())

// With secret for signed cookies
router.use(cookieParser('secret-key'))

// With options
router.use(cookieParser('secret-key', {
  decode: decodeURIComponent,  // Custom decode function
  signed: true                  // Parse signed cookies
}))
```

#### Working with Cookies

```javascript
router.use(cookieParser('my-secret'))

router.get('/', (req, res) => {
  // Access cookies
  console.log(req.cookies)        // All cookies
  console.log(req.signedCookies)  // Signed cookies only
  
  // Set cookies
  res.cookie('name', 'value', {
    domain: '.example.com',
    path: '/',
    secure: true,      // HTTPS only
    httpOnly: true,    // Not accessible via JavaScript
    maxAge: 900000,    // Milliseconds
    expires: new Date(Date.now() + 900000),
    sameSite: 'strict' // CSRF protection
  })
  
  // Set signed cookie
  res.cookie('session', 'data', { signed: true })
  
  // Clear cookie
  res.clearCookie('name')
  
  res.send('Cookies set')
})
```

#### Advanced Examples

```javascript
// Cookie-based authentication
router.use(cookieParser('secret'))

router.post('/login', (req, res) => {
  // Authenticate user...
  
  // Set secure session cookie
  res.cookie('sessionId', generateSessionId(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    signed: true
  })
  
  res.json({ success: true })
})

router.get('/protected', (req, res) => {
  const sessionId = req.signedCookies.sessionId
  
  if (!sessionId || !isValidSession(sessionId)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  
  res.json({ data: 'protected' })
})

// Cookie consent management
router.use((req, res, next) => {
  if (!req.cookies.consent) {
    // First visit, set consent cookie
    res.cookie('consent', 'pending', {
      maxAge: 365 * 24 * 60 * 60 * 1000  // 1 year
    })
  }
  next()
})
```

---

### CORS

Enable Cross-Origin Resource Sharing (CORS) with various options.

#### Basic Usage

```javascript
const { cors } = require('velocy/middleware')

// Enable CORS for all origins
router.use(cors())

// Enable CORS for specific origin
router.use(cors({
  origin: 'https://example.com'
}))
```

#### Configuration Options

```javascript
router.use(cors({
  // Allowed origins
  origin: '*',                    // Allow all origins (without credentials)
  // or
  origin: true,                  // Allow any origin dynamically (works with credentials)
  // or
  origin: 'https://example.com',  // Single origin
  // or
  origin: ['https://example.com', 'https://app.example.com'],  // Multiple origins
  // or
  origin: /^https:\/\/.*\.example\.com$/,  // Regex pattern
  // or
  origin: (origin, callback) => {  // Dynamic origin
    if (allowedOrigins.includes(origin)) {
      callback(null, true)
    } else {
      callback(new Error('Not allowed by CORS'))
    }
  },
  
  // Allowed methods
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  
  // Allowed headers
  allowedHeaders: ['Content-Type', 'Authorization'],
  
  // Headers to expose to the client
  exposedHeaders: ['Content-Length', 'X-Custom-Header'],
  
  // Allow credentials
  credentials: true,
  
  // Max age for preflight cache (seconds)
  maxAge: 86400,
  
  // Success status for OPTIONS requests
  optionsSuccessStatus: 204,
  
  // Preflight continue
  preflightContinue: false
}))
```

#### Examples

```javascript
// Development CORS (allow everything)
if (process.env.NODE_ENV === 'development') {
  router.use(cors({
    origin: true, // Allow all origins dynamically
    credentials: true
  }))
  // Note: Cannot use origin: '*' with credentials: true
  // Use origin: true to allow any origin with credentials
}

// Production CORS (restricted)
if (process.env.NODE_ENV === 'production') {
  router.use(cors({
    origin: [
      'https://app.example.com',
      'https://www.example.com'
    ],
    credentials: true,
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400
  }))
}

// Per-route CORS
router.options('/api/public', cors())  // Enable preflight
router.get('/api/public', cors({
  origin: '*'
}), (req, res) => {
  res.json({ data: 'public' })
})

// Dynamic CORS based on request
router.use(cors({
  origin: (origin, callback) => {
    // Check if origin is in database
    db.getAllowedOrigins((err, origins) => {
      if (err) return callback(err)
      
      if (!origin || origins.includes(origin)) {
        callback(null, true)
      } else {
        callback(new Error('Not allowed'))
      }
    })
  }
}))
```

---

### Compression

Compress response bodies for all requests using gzip, deflate, or brotli.

#### Basic Usage

```javascript
const { compression } = require('velocy/middleware')

// Enable compression with defaults
router.use(compression())

// With options
router.use(compression({
  threshold: 1024,    // Minimum size to compress (bytes)
  level: 6,           // Compression level (0-9)
  encoding: 'gzip'    // Default encoding
}))
```

#### Configuration Options

```javascript
router.use(compression({
  // Compression threshold
  threshold: 1024,          // Don't compress if smaller than 1KB
  // or
  threshold: '1kb',         // String format
  
  // Compression level (0-9)
  level: 6,                 // Default level
  // 0: No compression
  // 1: Fastest compression
  // 9: Best compression
  
  // Memory level (1-9)
  memLevel: 8,              // How much memory to use
  
  // Strategy
  strategy: 0,              // Compression strategy
  // 0: Default strategy
  // 1: Filtered
  // 2: Huffman only
  // 3: RLE
  // 4: Fixed
  
  // Window bits
  windowBits: 15,           // Size of history buffer
  
  // Chunk size
  chunkSize: 16 * 1024,     // Size of chunks
  
  // Filter function
  filter: (req, res) => {
    // Return true to compress
    // Check content-type
    const type = res.getHeader('Content-Type')
    return /text|json|javascript|css|html|xml/.test(type)
  },
  
  // Preferred encoding order
  encodings: ['br', 'gzip', 'deflate'],
  
  // Brotli options (Node.js 11.7.0+)
  brotli: {
    quality: 4,             // Brotli quality (0-11)
    lgwin: 22               // Window size
  }
}))
```

#### Examples

```javascript
// Selective compression
router.use(compression({
  filter: (req, res) => {
    // Don't compress images
    if (req.url.match(/\.(jpg|jpeg|png|gif|webp)$/)) {
      return false
    }
    
    // Compress everything else
    return compression.filter(req, res)
  },
  threshold: 512  // Compress if larger than 512 bytes
}))

// High compression for static assets
router.use('/assets', compression({
  level: 9,
  threshold: 0  // Compress everything
}))

// API responses with moderate compression
router.use('/api', compression({
  level: 6,
  threshold: 1024
}))

// Disable compression for specific route
router.get('/stream', (req, res, next) => {
  res.setHeader('x-no-compression', '1')
  next()
}, compression({
  filter: (req, res) => {
    // Check for no-compression flag
    if (res.getHeader('x-no-compression')) {
      return false
    }
    return true
  }
}), streamHandler)

// Brotli compression (best for text)
router.use(compression({
  encodings: ['br', 'gzip'],  // Prefer Brotli
  brotli: {
    quality: 11  // Maximum compression
  }
}))
```

---

### Rate Limiting

Limit repeated requests to public APIs and endpoints.

#### Basic Usage

```javascript
const { rateLimit } = require('velocy/middleware')

// Basic rate limiting
router.use(rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 100                    // Limit to 100 requests
}))
```

#### Configuration Options

```javascript
router.use(rateLimit({
  // Time window in milliseconds
  windowMs: 15 * 60 * 1000,     // 15 minutes
  
  // Maximum requests per window
  max: 100,
  
  // Message when rate limit exceeded
  message: 'Too many requests, please try again later',
  // or
  message: {
    error: 'Rate limit exceeded',
    retryAfter: 900  // Seconds
  },
  
  // Status code when rate limit exceeded
  statusCode: 429,
  
  // Send rate limit headers
  headers: true,                 // Send X-RateLimit-* headers
  
  // Draft specification headers
  draft_polli_ratelimit_headers: false,  // Use draft-7 headers
  
  // Skip successful requests
  skipSuccessfulRequests: false,
  
  // Skip failed requests
  skipFailedRequests: false,
  
  // Key generator function
  keyGenerator: (req) => {
    return req.ip  // Default: use IP address
    // or
    return req.user?.id || req.ip  // User ID if authenticated
  },
  
  // Handler when rate limit exceeded
  handler: (req, res) => {
    res.status(429).json({
      error: 'Too many requests'
    })
  },
  
  // Callback when limit reached
  onLimitReached: (req, res, options) => {
    console.log(`Rate limit exceeded for ${req.ip}`)
  },
  
  // Store (default: in-memory)
  store: new CustomStore(),
  
  // Skip function
  skip: (req) => {
    // Skip rate limiting for certain requests
    return req.ip === '127.0.0.1'
  },
  
  // Request weight
  requestWeight: (req) => {
    // Give different weights to different requests
    if (req.path.startsWith('/api/heavy')) {
      return 5  // Count as 5 requests
    }
    return 1
  }
}))
```

#### Examples

```javascript
// Different limits for different endpoints
const strictLimit = rateLimit({
  windowMs: 1 * 60 * 1000,  // 1 minute
  max: 5,
  message: 'Too many login attempts'
})

const standardLimit = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 100
})

router.post('/auth/login', strictLimit, loginHandler)
router.use('/api', standardLimit)

// User-based rate limiting
router.use(rateLimit({
  keyGenerator: (req) => {
    return req.user?.id || req.ip
  },
  max: (req) => {
    // Premium users get higher limits
    if (req.user?.premium) {
      return 1000
    }
    return 100
  }
}))

// Progressive rate limiting
let requestCounts = new Map()

router.use(rateLimit({
  keyGenerator: (req) => req.ip,
  max: (req) => {
    const key = req.ip
    const count = requestCounts.get(key) || 0
    
    // Progressively stricter limits
    if (count > 1000) return 10   // Very strict
    if (count > 500) return 50    // Strict
    if (count > 100) return 100   // Moderate
    return 200                    // Lenient
  },
  onLimitReached: (req) => {
    const key = req.ip
    const count = requestCounts.get(key) || 0
    requestCounts.set(key, count + 1)
  }
}))

// API endpoint specific limits
router.get('/api/search', rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 30,
  message: 'Search rate limit exceeded'
}), searchHandler)

router.post('/api/data', rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 10,
  requestWeight: (req) => {
    // Heavier operations count more
    const size = req.body?.size || 1
    return Math.min(size, 10)
  }
}), dataHandler)
```

---

### Session Management

Create and manage user sessions with various storage backends.

#### Basic Usage

```javascript
const { session } = require('velocy/middleware')

router.use(session({
  secret: 'keyboard cat',
  resave: false,
  saveUninitialized: false
}))
```

#### Configuration Options

```javascript
router.use(session({
  // Secret for signing session ID cookie
  secret: 'secret-key',
  // or
  secret: ['key1', 'key2'],  // Multiple secrets (rotation)
  
  // Session cookie name
  name: 'sessionId',
  
  // Force save session even if unmodified
  resave: false,
  
  // Save uninitialized sessions
  saveUninitialized: false,
  
  // Session cookie settings
  cookie: {
    secure: true,           // HTTPS only
    httpOnly: true,         // Not accessible via JS
    domain: '.example.com',
    path: '/',
    expires: new Date(Date.now() + 3600000),
    maxAge: 3600000,        // 1 hour
    sameSite: 'lax'         // CSRF protection
  },
  
  // Session ID generator
  genid: (req) => {
    return generateUniqueId()
  },
  
  // Session store (default: memory)
  store: new SessionStore(),
  
  // Proxy trust
  proxy: true,
  
  // Rolling session expiry
  rolling: false,
  
  // Action when session.destroy() called
  unset: 'destroy'  // or 'keep'
}))
```

#### Session Stores

```javascript
// In-memory store (default - not for production)
const { MemoryStore } = require('velocy/stores')

router.use(session({
  secret: 'secret',
  store: new MemoryStore({
    checkPeriod: 86400000  // Prune expired entries every 24h
  })
}))

// File store
const { FileStore } = require('velocy/stores')

router.use(session({
  secret: 'secret',
  store: new FileStore({
    path: './sessions',
    ttl: 3600,  // Seconds
    reapInterval: 3600
  })
}))

// Custom store implementation
class CustomStore {
  constructor(options) {
    this.sessions = new Map()
  }
  
  get(sid, callback) {
    callback(null, this.sessions.get(sid))
  }
  
  set(sid, session, callback) {
    this.sessions.set(sid, session)
    callback(null)
  }
  
  destroy(sid, callback) {
    this.sessions.delete(sid)
    callback(null)
  }
  
  touch(sid, session, callback) {
    // Update expiry
    callback(null)
  }
}
```

#### Working with Sessions

```javascript
router.use(session({
  secret: 'secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000  // 24 hours
  }
}))

// Login
router.post('/login', async (req, res) => {
  const { username, password } = req.body
  
  const user = await authenticate(username, password)
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' })
  }
  
  // Store user in session
  req.session.user = {
    id: user.id,
    username: user.username,
    role: user.role
  }
  
  // Regenerate session ID for security
  req.session.regenerate((err) => {
    if (err) {
      return res.status(500).json({ error: 'Session error' })
    }
    
    req.session.user = user
    req.session.save((err) => {
      if (err) {
        return res.status(500).json({ error: 'Session save error' })
      }
      res.json({ success: true, user })
    })
  })
})

// Protect routes
router.use('/admin', (req, res, next) => {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'Access denied' })
  }
  next()
})

// Logout
router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Logout failed' })
    }
    
    res.clearCookie('sessionId')
    res.json({ success: true })
  })
})

// Session data manipulation
router.get('/cart', (req, res) => {
  // Initialize cart if not exists
  if (!req.session.cart) {
    req.session.cart = []
  }
  
  res.json({ cart: req.session.cart })
})

router.post('/cart/add', (req, res) => {
  if (!req.session.cart) {
    req.session.cart = []
  }
  
  req.session.cart.push(req.body.item)
  
  // Manually save session
  req.session.save((err) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to save cart' })
    }
    res.json({ cart: req.session.cart })
  })
})
```

---

### Static Files

Serve static files from a directory.

#### Basic Usage

```javascript
const { static } = require('velocy/middleware')

// Serve files from 'public' directory
router.use(static('public'))

// With virtual path prefix
router.use('/static', static('public'))
```

#### Configuration Options

```javascript
router.use(static('public', {
  // Index file names
  index: 'index.html',         // Default index file
  // or
  index: ['index.html', 'index.htm'],  // Multiple index files
  // or
  index: false,                 // Disable directory index
  
  // Default file extensions
  extensions: ['html', 'htm'],  // Try these extensions
  
  // Dotfile handling
  dotfiles: 'ignore',           // Options: 'allow', 'deny', 'ignore'
  
  // Enable/disable etag generation
  etag: true,
  
  // Set Cache-Control header
  maxAge: 0,                    // Cache max-age in ms
  // or
  maxAge: '1d',                 // String format
  
  // Redirect directories to trailing slash
  redirect: true,
  
  // Set Last-Modified header
  lastModified: true,
  
  // Set custom headers
  setHeaders: (res, path, stat) => {
    res.setHeader('X-Served-By', 'Velocy')
    
    // Set cache headers based on file type
    if (path.endsWith('.js') || path.endsWith('.css')) {
      res.setHeader('Cache-Control', 'public, max-age=31536000')
    }
  },
  
  // Custom file system
  fs: customFs,
  
  // Fallback for client-side routing
  fallthrough: true,
  
  // Serve hidden files
  hidden: false,
  
  // Enable range requests
  acceptRanges: true,
  
  // Enable response caching
  cacheControl: true,
  
  // Immutable cache control
  immutable: false
}))
```

#### Examples

```javascript
// Development static files
if (process.env.NODE_ENV === 'development') {
  router.use(static('public', {
    etag: false,
    lastModified: false,
    maxAge: 0  // No caching
  }))
}

// Production static files
if (process.env.NODE_ENV === 'production') {
  router.use(static('public', {
    etag: true,
    maxAge: '1y',  // Cache for 1 year
    immutable: true,
    setHeaders: (res, path) => {
      // Versioned assets can be cached forever
      if (path.match(/\.[0-9a-f]{8}\./)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
      }
    }
  }))
}

// Multiple static directories
router.use('/css', static('public/css', { maxAge: '1d' }))
router.use('/js', static('public/js', { maxAge: '1d' }))
router.use('/images', static('public/images', { maxAge: '7d' }))

// SPA fallback
router.use(static('build', {
  index: 'index.html',
  fallthrough: false
}))

// Catch-all for client-side routing
router.get('*', (req, res) => {
  res.sendFile('build/index.html')
})

// Protected static files
router.use('/private', (req, res, next) => {
  if (!req.session.authenticated) {
    return res.status(401).send('Unauthorized')
  }
  next()
}, static('private-files'))

// Custom cache headers by file type
router.use(static('public', {
  setHeaders: (res, path) => {
    const ext = path.split('.').pop()
    
    const cacheRules = {
      'html': 'no-cache',
      'css': 'public, max-age=86400',     // 1 day
      'js': 'public, max-age=86400',      // 1 day
      'jpg': 'public, max-age=604800',    // 1 week
      'png': 'public, max-age=604800',    // 1 week
      'ico': 'public, max-age=2592000'    // 30 days
    }
    
    if (cacheRules[ext]) {
      res.setHeader('Cache-Control', cacheRules[ext])
    }
  }
}))
```

---

### Validator

Validate request data (body, query, params) against schemas.

#### Basic Usage

```javascript
const { validator } = require('velocy/middleware')

router.post('/users', 
  validator({
    body: {
      email: { type: 'email', required: true },
      age: { type: 'number', min: 18 }
    }
  }),
  (req, res) => {
    // req.body is validated
    res.json({ success: true })
  }
)
```

#### Validation Rules

```javascript
validator({
  // Validate request body
  body: {
    // String validation
    name: {
      type: 'string',
      required: true,
      minLength: 2,
      maxLength: 50,
      pattern: /^[a-zA-Z\s]+$/,
      transform: (value) => value.trim(),
      message: 'Name must be 2-50 characters'
    },
    
    // Number validation
    age: {
      type: 'number',
      required: true,
      min: 0,
      max: 120,
      integer: true,
      message: 'Age must be between 0 and 120'
    },
    
    // Email validation
    email: {
      type: 'email',
      required: true,
      normalize: true,  // Lowercase
      unique: async (value) => {
        // Check database
        return !await userExists(value)
      },
      message: 'Email already exists'
    },
    
    // Boolean validation
    active: {
      type: 'boolean',
      default: true
    },
    
    // Date validation
    birthDate: {
      type: 'date',
      required: false,
      min: new Date('1900-01-01'),
      max: new Date(),
      format: 'YYYY-MM-DD'
    },
    
    // Array validation
    tags: {
      type: 'array',
      required: false,
      minItems: 1,
      maxItems: 10,
      items: {
        type: 'string',
        minLength: 2
      },
      unique: true  // No duplicates
    },
    
    // Object validation
    address: {
      type: 'object',
      required: false,
      properties: {
        street: { type: 'string', required: true },
        city: { type: 'string', required: true },
        zip: { type: 'string', pattern: /^\d{5}$/ }
      }
    },
    
    // Enum validation
    role: {
      type: 'enum',
      values: ['user', 'admin', 'moderator'],
      default: 'user'
    },
    
    // Custom validation
    password: {
      type: 'string',
      required: true,
      minLength: 8,
      validate: (value) => {
        // Custom validation logic
        const hasUpper = /[A-Z]/.test(value)
        const hasLower = /[a-z]/.test(value)
        const hasNumber = /\d/.test(value)
        const hasSpecial = /[!@#$%^&*]/.test(value)
        
        if (!hasUpper || !hasLower || !hasNumber || !hasSpecial) {
          throw new Error('Password must contain uppercase, lowercase, number, and special character')
        }
        return true
      }
    }
  },
  
  // Validate query parameters
  query: {
    page: {
      type: 'number',
      default: 1,
      min: 1,
      transform: (value) => parseInt(value)
    },
    limit: {
      type: 'number',
      default: 10,
      min: 1,
      max: 100,
      transform: (value) => parseInt(value)
    },
    sort: {
      type: 'enum',
      values: ['asc', 'desc'],
      default: 'asc'
    }
  },
  
  // Validate route parameters
  params: {
    id: {
      type: 'string',
      pattern: /^[0-9a-f]{24}$/,  // MongoDB ObjectId
      message: 'Invalid ID format'
    }
  },
  
  // Global options
  options: {
    abortEarly: false,    // Validate all fields
    stripUnknown: true,   // Remove unknown fields
    convert: true         // Type conversion
  }
})
```

#### Advanced Examples

```javascript
// Complex validation with dependencies
router.post('/register',
  validator({
    body: {
      password: {
        type: 'string',
        required: true,
        minLength: 8
      },
      confirmPassword: {
        type: 'string',
        required: true,
        validate: (value, { body }) => {
          if (value !== body.password) {
            throw new Error('Passwords do not match')
          }
          return true
        }
      },
      acceptTerms: {
        type: 'boolean',
        required: true,
        validate: (value) => {
          if (!value) {
            throw new Error('You must accept the terms')
          }
          return true
        }
      }
    }
  }),
  registerHandler
)

// Conditional validation
router.put('/users/:id',
  validator({
    params: {
      id: { type: 'string', required: true }
    },
    body: {
      email: {
        type: 'email',
        required: false,
        unique: async (value, { params }) => {
          // Check if email is unique (excluding current user)
          return !await emailExistsExcept(value, params.id)
        }
      },
      role: {
        type: 'enum',
        values: ['user', 'admin'],
        validate: (value, { user }) => {
          // Only admins can set admin role
          if (value === 'admin' && user.role !== 'admin') {
            throw new Error('Insufficient permissions')
          }
          return true
        }
      }
    }
  }),
  updateUserHandler
)

// Sanitization and transformation
router.post('/articles',
  validator({
    body: {
      title: {
        type: 'string',
        required: true,
        transform: (value) => {
          // Sanitize and format
          return value
            .trim()
            .replace(/<[^>]*>/g, '')  // Remove HTML
            .substring(0, 100)         // Limit length
        }
      },
      content: {
        type: 'string',
        required: true,
        transform: (value) => {
          // Sanitize HTML
          return sanitizeHtml(value, {
            allowedTags: ['b', 'i', 'em', 'strong', 'a'],
            allowedAttributes: {
              'a': ['href']
            }
          })
        }
      },
      tags: {
        type: 'array',
        transform: (value) => {
          // Normalize tags
          return value.map(tag => 
            tag.toLowerCase().trim()
          ).filter(Boolean)
        }
      }
    }
  }),
  createArticleHandler
)

// Custom error handling
router.post('/api/data',
  validator({
    body: {
      data: { type: 'object', required: true }
    },
    onError: (errors, req, res) => {
      // Custom error response
      res.status(422).json({
        error: 'Validation failed',
        details: errors.map(err => ({
          field: err.field,
          message: err.message,
          value: err.value
        }))
      })
    }
  }),
  dataHandler
)
```

---

## Middleware Execution

### Execution Order

```javascript
// 1. Global middleware (in order of registration)
router.use(logger)           // Runs 1st
router.use(bodyParser())     // Runs 2nd
router.use(cookieParser())   // Runs 3rd

// 2. Path-specific middleware
router.use('/api', auth)     // Runs for /api/* routes

// 3. Route-specific middleware
router.get('/users',
  authenticate,              // Runs 1st for this route
  authorize('admin'),        // Runs 2nd for this route
  getUsers                   // Final handler
)

// 4. Error middleware (if error occurs)
router.useError(errorHandler)   // Catches any errors
```

### Async Middleware

```javascript
// Promise-based async middleware
router.use(async (req, res, next) => {
  try {
    const data = await fetchData()
    req.data = data
    next()
  } catch (err) {
    next(err)  // Pass error to error handler
  }
})

// Async/await in route handlers
router.get('/async', async (req, res) => {
  const result = await someAsyncOperation()
  res.json(result)
})

// Error handling for async routes
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next)
}

router.get('/users', asyncHandler(async (req, res) => {
  const users = await User.findAll()
  res.json(users)
}))
```

---

## Custom Middleware

### Creating Custom Middleware

```javascript
// Simple middleware
function requestLogger(req, res, next) {
  console.log(`${new Date().toISOString()} ${req.method} ${req.url}`)
  next()
}

// Middleware with options
function customMiddleware(options = {}) {
  const defaults = {
    enabled: true,
    verbose: false
  }
  
  const config = { ...defaults, ...options }
  
  return function(req, res, next) {
    if (!config.enabled) {
      return next()
    }
    
    // Middleware logic
    if (config.verbose) {
      console.log('Processing request...')
    }
    
    // Add methods/properties to req/res
    req.customData = 'value'
    res.customMethod = function() { /* ... */ }
    
    next()
  }
}

// Middleware that modifies response
function responseTime(req, res, next) {
  const start = Date.now()
  
  // Override res.end
  const originalEnd = res.end
  res.end = function(...args) {
    const duration = Date.now() - start
    res.setHeader('X-Response-Time', `${duration}ms`)
    originalEnd.apply(res, args)
  }
  
  next()
}

// Authentication middleware
function authenticate(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1]
  
  if (!token) {
    return res.status(401).json({ error: 'No token provided' })
  }
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    req.user = decoded
    next()
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' })
  }
}

// Role-based authorization
function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' })
    }
    
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' })
    }
    
    next()
  }
}
```

---

## Error Handling

### Error Middleware

```javascript
// Basic error handler
router.useError((err, req, res, next) => {
  console.error(err.stack)
  res.status(500).json({ error: 'Internal Server Error' })
})

// Comprehensive error handler
router.useError((err, req, res, next) => {
  // Default to 500 server error
  let status = err.status || 500
  let message = err.message || 'Internal Server Error'
  
  // Specific error types
  if (err.name === 'ValidationError') {
    status = 422
    message = 'Validation failed'
  } else if (err.name === 'UnauthorizedError') {
    status = 401
    message = 'Unauthorized'
  } else if (err.name === 'CastError') {
    status = 400
    message = 'Invalid ID format'
  }
  
  // Log error
  console.error({
    error: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    ip: req.ip,
    timestamp: new Date().toISOString()
  })
  
  // Send error response
  res.status(status).json({
    error: message,
    ...(process.env.NODE_ENV === 'development' && {
      stack: err.stack,
      details: err
    })
  })
})

// Multiple error handlers
router.useError((err, req, res, next) => {
  // Handle validation errors
  if (err.type === 'validation') {
    return res.status(422).json({
      error: 'Validation failed',
      fields: err.fields
    })
  }
  next(err)  // Pass to next error handler
})

router.useError((err, req, res, next) => {
  // Handle all other errors
  res.status(500).json({ error: 'Server error' })
})
```

---

## Performance Considerations

### Middleware Order Optimization

```javascript
// ✅ GOOD: Static files before body parsing
router.use('/static', static('public'))  // No body parsing needed
router.use(bodyParser())                 // Only for routes that need it

// ❌ BAD: Body parsing for all requests
router.use(bodyParser())                 // Parses even static files
router.use('/static', static('public'))
```

### Conditional Middleware

```javascript
// Only parse JSON for API routes
router.use('/api', bodyParser({ json: true }))

// Skip middleware for certain routes
router.use((req, res, next) => {
  // Skip logging for health checks
  if (req.url === '/health') {
    return next()
  }
  
  console.log(`${req.method} ${req.url}`)
  next()
})
```

### Caching Middleware Results

```javascript
const cache = new Map()

function cacheMiddleware(duration = 60000) {
  return (req, res, next) => {
    const key = `${req.method}:${req.url}`
    const cached = cache.get(key)
    
    if (cached && Date.now() - cached.timestamp < duration) {
      return res.json(cached.data)
    }
    
    // Override res.json to cache response
    const originalJson = res.json.bind(res)
    res.json = (data) => {
      cache.set(key, {
        data,
        timestamp: Date.now()
      })
      originalJson(data)
    }
    
    next()
  }
}

router.get('/api/expensive', cacheMiddleware(300000), expensiveOperation)
```

---

## Best Practices

### 1. Order Matters

```javascript
// Correct order
router.use(cors())           // 1. CORS headers
router.use(compression())    // 2. Compress responses
router.use(static('public')) // 3. Static files (no parsing needed)
router.use(bodyParser())     // 4. Parse bodies
router.use(cookieParser())   // 5. Parse cookies
router.use(session())        // 6. Session (needs cookies)
router.use(authenticate)     // 7. Auth (needs session)
```

### 2. Use Path-Specific Middleware

```javascript
// Only apply to specific paths
router.use('/api', [
  rateLimit({ max: 100 }),
  authenticate,
  bodyParser()
])

router.use('/admin', [
  authenticate,
  authorize('admin')
])
```

### 3. Error Handling

```javascript
// Always have error handler at the end
router.use(routes)
router.useError(errorHandler)  // Catches all errors
```

### 4. Security Layers

```javascript
// Apply security middleware globally
router.use(helmet())         // Security headers
router.use(cors())          // CORS protection
router.use(rateLimit())     // Rate limiting
router.use(validator())     // Input validation
```

### 5. Performance Optimization

```javascript
// Conditional middleware loading
if (process.env.NODE_ENV === 'production') {
  router.use(compression())
  router.use(cache())
} else {
  router.use(logger('dev'))
}
```

---

## Troubleshooting

### Common Issues

#### Middleware Not Executing
```javascript
// Check order - middleware must be registered before routes
router.use(middleware)  // ✅ Before routes
router.get('/route', handler)

// Not:
router.get('/route', handler)
router.use(middleware)  // ❌ After routes - won't run
```

#### Body Parser Not Working
```javascript
// Ensure body parser is before route handlers
router.use(bodyParser())  // ✅ First
router.post('/api', handler)

// Check Content-Type header
// Body parser only works with correct Content-Type
```

#### Session Not Persisting
```javascript
// Check cookie settings
router.use(session({
  secret: 'secret',
  cookie: {
    secure: true,  // Only works with HTTPS
    sameSite: 'none'  // For cross-origin requests
  }
}))
```

#### CORS Issues
```javascript
// Ensure CORS is before routes
router.use(cors({
  origin: 'http://localhost:3000',
  credentials: true  // If using cookies
}))

// For preflight requests
router.options('*', cors())  // Handle OPTIONS
```