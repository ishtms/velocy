# Velocy API Reference

## Table of Contents

- [Core Classes](#core-classes)
  - [Router](#router)
  - [FastRouter](#fastrouter)
  - [SimpleRouter](#simplerouter)
  - [Request](#request)
  - [Response](#response)
  - [WebSocket](#websocket)
  - [WebSocketRouter](#websocketrouter)
- [Middleware](#middleware)
  - [bodyParser](#bodyparser)
  - [cookieParser](#cookieparser)
  - [cors](#cors)
  - [compression](#compression)
  - [rateLimit](#ratelimit)
  - [session](#session)
  - [static](#static)
  - [validator](#validator)
- [Utilities](#utilities)
  - [cache](#cache)
  - [performance](#performance)
  - [viewEngine](#viewengine)
- [Helper Functions](#helper-functions)

---

## Core Classes

### Router

The main router class with full feature support including middleware, WebSockets, templates, and more.

#### Constructor

```javascript
new Router(options)
```

**Options:**
- `cache` {boolean|Object} - Enable route caching (default: false)
  - `cache.enabled` {boolean} - Enable/disable caching
  - `cache.size` {number} - Maximum cache entries (default: 1000)
  - `cache.ttl` {number} - Cache TTL in milliseconds
- `performance` {boolean|Object} - Enable performance monitoring (default: false)
  - `performance.enabled` {boolean} - Enable monitoring
  - `performance.windowSize` {number} - Monitoring window in ms (default: 60000)
  - `performance.logSlowRequests` {boolean} - Log slow requests
  - `performance.slowRequestThreshold` {number} - Slow request threshold in ms
- `cookieSecret` {string} - Secret for cookie signing
- `websocket` {Object} - WebSocket configuration
  - `websocket.perMessageDeflate` {boolean} - Enable compression
  - `websocket.maxPayload` {number} - Maximum payload size
- `trustProxy` {boolean} - Trust proxy headers (default: false)
- `routeCacheSize` {number} - Route cache size (default: 1000)

#### Methods

##### Route Registration

```javascript
router.get(path, ...handlers)
router.post(path, ...handlers)
router.put(path, ...handlers)
router.delete(path, ...handlers)
router.patch(path, ...handlers)
router.head(path, ...handlers)
router.options(path, ...handlers)
router.all(path, ...handlers)
```

**Parameters:**
- `path` {string} - Route path with optional parameters (e.g., "/users/:id")
- `handlers` {Function[]} - One or more request handlers

**Returns:** Router instance for chaining

##### Middleware

```javascript
router.use([path], ...middleware)
```

**Parameters:**
- `path` {string} (optional) - Path prefix for middleware
- `middleware` {Function[]} - Middleware functions

##### WebSocket Routes

```javascript
router.ws(path, handler)
```

**Parameters:**
- `path` {string} - WebSocket endpoint path
- `handler` {Function} - WebSocket connection handler

##### Error Handling

```javascript
router.useError(handler)
```

**Parameters:**
- `handler` {Function} - Error handling middleware (err, req, res, next)

##### Request Handling

```javascript
router.handleRequest(req, res)
```

**Parameters:**
- `req` {http.IncomingMessage} - Node.js request object
- `res` {http.ServerResponse} - Node.js response object

##### Subrouters

```javascript
router.nest(prefix, subrouter)
```

**Parameters:**
- `prefix` {string} - Path prefix for subrouter
- `subrouter` {Router} - Router instance to mount

##### Static Files

```javascript
// Static files - use middleware instead
const { static: staticMiddleware } = require('velocy')
router.use(staticMiddleware(path, [options]))
```

**Parameters:**
- `path` {string} - Directory path to serve
- `options` {Object} - Static file serving options
  - `index` {string|boolean} - Index file name (default: 'index.html')
  - `extensions` {string[]} - Default extensions to try
  - `dotfiles` {string} - How to handle dotfiles ('allow', 'deny', 'ignore')
  - `etag` {boolean} - Enable ETag generation
  - `maxAge` {number} - Cache max-age in milliseconds

##### Performance

```javascript
// Performance stats - not available as a method
// Performance monitoring is configured via Router options
new Router({ performance: true })
```

---

### FastRouter

Minimal overhead router for maximum performance scenarios.

#### Constructor

```javascript
new FastRouter()
```

No options - designed for zero configuration and maximum speed.

#### Methods

##### Route Registration

```javascript
fastRouter.get(path, handler)
fastRouter.post(path, handler)
fastRouter.put(path, handler)
fastRouter.delete(path, handler)
fastRouter.patch(path, handler)
fastRouter.head(path, handler)
fastRouter.options(path, handler)
```

**Parameters:**
- `path` {string} - Route path with optional parameters
- `handler` {Function} - Request handler function

##### Request Handling

```javascript
fastRouter.handleRequest(req, res)
```

**Parameters:**
- `req` {http.IncomingMessage} - Node.js request object
- `res` {http.ServerResponse} - Node.js response object

**Note:** FastRouter provides raw Node.js req/res objects without additional methods.

---

### SimpleRouter

Lightweight router with basic middleware support but without advanced features.

#### Constructor

```javascript
new SimpleRouter()
```

#### Methods

Inherits basic routing methods from FastRouter and adds:

##### Middleware Support

```javascript
simpleRouter.use([path], middleware)
```

**Parameters:**
- `path` {string} (optional) - Path prefix
- `middleware` {Function} - Middleware function

---

### Request

Enhanced request object with additional properties and methods.

#### Properties

- `params` {Object} - Route parameters
- `query` {Object} - Parsed query string
- `body` {any} - Request body (when body parser is used)
- `cookies` {Object} - Parsed cookies
- `session` {Object} - Session data
- `ip` {string} - Client IP address
- `protocol` {string} - Request protocol (http/https)
- `secure` {boolean} - Is HTTPS request
- `xhr` {boolean} - Is XMLHttpRequest
- `hostname` {string} - Request hostname
- `path` {string} - Request path without query string
- `originalUrl` {string} - Original request URL

#### Methods

##### get(header)

Get request header value.

```javascript
req.get('content-type')
```

**Parameters:**
- `header` {string} - Header name (case-insensitive)

**Returns:** Header value or undefined

##### accepts(types)

Check if request accepts given content types.

```javascript
req.accepts(['json', 'html'])
req.accepts('application/json')
```

**Parameters:**
- `types` {string|string[]} - Content type(s) to check

**Returns:** Best matching type or false

##### is(type)

Check if request content-type matches.

```javascript
req.is('json')
req.is('application/json')
```

**Parameters:**
- `type` {string} - Content type to check

**Returns:** Boolean

---

### Response

Enhanced response object with helper methods.

#### Methods

##### json(data)

Send JSON response.

```javascript
res.json({ success: true })
```

**Parameters:**
- `data` {any} - Data to send as JSON

##### status(code)

Set response status code.

```javascript
res.status(404).json({ error: 'Not found' })
```

**Parameters:**
- `code` {number} - HTTP status code

**Returns:** Response object for chaining

##### send(data)

Send response with automatic content-type detection.

```javascript
res.send('Hello')           // text/html
res.send({ msg: 'Hi' })     // application/json
res.send(Buffer.from('...')) // application/octet-stream
```

**Parameters:**
- `data` {string|Object|Buffer} - Response data

##### redirect([status], url)

Redirect request.

```javascript
res.redirect('/login')
res.redirect(301, '/new-location')
```

**Parameters:**
- `status` {number} (optional) - Status code (default: 302)
- `url` {string} - Redirect URL

##### set(field, [value])

Set response header(s).

```javascript
res.set('X-Custom', 'value')
res.set({
  'X-Custom': 'value',
  'X-Another': 'value2'
})
```

**Parameters:**
- `field` {string|Object} - Header name or object of headers
- `value` {string} - Header value (when field is string)

##### cookie(name, value, [options])

Set cookie.

```javascript
res.cookie('session', 'abc123', {
  httpOnly: true,
  secure: true,
  maxAge: 86400000
})
```

**Parameters:**
- `name` {string} - Cookie name
- `value` {string} - Cookie value
- `options` {Object} - Cookie options
  - `domain` {string} - Cookie domain
  - `path` {string} - Cookie path (default: '/')
  - `secure` {boolean} - HTTPS only
  - `httpOnly` {boolean} - HTTP only
  - `maxAge` {number} - Max age in milliseconds
  - `expires` {Date} - Expiration date
  - `sameSite` {string} - SameSite attribute

##### clearCookie(name, [options])

Clear cookie.

```javascript
res.clearCookie('session')
```

**Parameters:**
- `name` {string} - Cookie name
- `options` {Object} - Cookie options (must match original)

##### render(view, [data])

Render template.

```javascript
res.render('index', { title: 'Home' })
```

**Parameters:**
- `view` {string} - Template name
- `data` {Object} - Template data

##### download(path, [filename])

Send file as download.

```javascript
res.download('/path/to/file.pdf')
res.download('/path/to/file.pdf', 'custom-name.pdf')
```

**Parameters:**
- `path` {string} - File path
- `filename` {string} (optional) - Download filename

##### sendFile(path, [options])

Send file.

```javascript
res.sendFile('/path/to/file.html')
```

**Parameters:**
- `path` {string} - File path
- `options` {Object} - Options
  - `root` {string} - Root directory
  - `headers` {Object} - Custom headers

##### type(type)

Set Content-Type header.

```javascript
res.type('json')
res.type('application/json')
```

**Parameters:**
- `type` {string} - Content type

---

### WebSocket

WebSocket connection handler.

#### Events

```javascript
ws.on('message', (data) => {
  // Handle message
})

ws.on('close', () => {
  // Handle close
})

ws.on('error', (err) => {
  // Handle error
})
```

#### Methods

##### send(data)

Send data to client.

```javascript
ws.send('Hello')
ws.send(JSON.stringify({ type: 'notification' }))
```

**Parameters:**
- `data` {string|Buffer} - Data to send

##### close([code], [reason])

Close connection.

```javascript
ws.close()
ws.close(1000, 'Normal closure')
```

**Parameters:**
- `code` {number} (optional) - Close code
- `reason` {string} (optional) - Close reason

##### join(room)

Join a room/channel.

```javascript
ws.join('chat-room-1')
```

**Parameters:**
- `room` {string} - Room name

##### leave(room)

Leave a room/channel.

```javascript
ws.leave('chat-room-1')
```

**Parameters:**
- `room` {string} - Room name

##### broadcast(data, [room])

Broadcast to all connections or specific room.

```javascript
ws.broadcast('User joined')
ws.broadcast('New message', 'chat-room-1')
```

**Parameters:**
- `data` {string|Buffer} - Data to broadcast
- `room` {string} (optional) - Room to broadcast to

---

## Middleware

### bodyParser

Parse request bodies (JSON, URL-encoded, multipart).

```javascript
const { bodyParser } = require('velocy/middleware')

router.use(bodyParser({
  json: true,           // Parse JSON bodies (default: true)
  urlencoded: true,     // Parse URL-encoded bodies (default: true)
  multipart: false,     // Parse multipart/form-data (default: false)
  limit: '1mb',         // Body size limit
  strict: true,         // Only parse objects and arrays (JSON)
  encoding: 'utf-8'     // Text encoding
}))
```

### cookieParser

Parse cookies from request headers.

```javascript
const { cookieParser } = require('velocy/middleware')

router.use(cookieParser({
  decode: decodeURIComponent,  // Custom decode function
  secret: 'secret-key'          // Secret for signed cookies
}))
```

### cors

Enable CORS (Cross-Origin Resource Sharing).

```javascript
const { cors } = require('velocy/middleware')

router.use(cors({
  origin: '*',                    // Allowed origins
  methods: ['GET', 'POST'],       // Allowed methods
  allowedHeaders: ['Content-Type'], // Allowed headers
  exposedHeaders: [],             // Exposed headers
  credentials: false,              // Include credentials
  maxAge: 86400,                  // Preflight cache time
  optionsSuccessStatus: 204       // OPTIONS response status
}))
```

### compression

Compress responses using gzip, deflate, or brotli.

```javascript
const { compression } = require('velocy/middleware')

router.use(compression({
  threshold: 1024,           // Minimum size to compress (bytes)
  level: 6,                  // Compression level (1-9)
  memLevel: 8,               // Memory level (1-9)
  strategy: 0,               // Compression strategy
  filter: (req, res) => true, // Custom filter function
  encoding: 'gzip'           // Default encoding
}))
```

### rateLimit

Rate limiting middleware.

```javascript
const { rateLimit } = require('velocy/middleware')

router.use(rateLimit({
  windowMs: 15 * 60 * 1000,  // Time window (15 minutes)
  max: 100,                   // Max requests per window
  message: 'Too many requests', // Error message
  statusCode: 429,            // Error status code
  headers: true,              // Send rate limit headers
  skipSuccessfulRequests: false, // Skip successful requests
  skipFailedRequests: false,  // Skip failed requests
  keyGenerator: (req) => req.ip, // Custom key generator
  handler: (req, res) => {},   // Custom handler
  onLimitReached: (req) => {}  // Callback on limit
}))
```

### session

Session management middleware.

```javascript
const { session } = require('velocy/middleware')

router.use(session({
  secret: 'session-secret',     // Session secret (required)
  name: 'sessionId',            // Cookie name
  resave: false,                // Force save unchanged sessions
  saveUninitialized: false,     // Save new empty sessions
  cookie: {                     // Cookie options
    secure: false,              // HTTPS only
    httpOnly: true,             // HTTP only
    maxAge: 86400000,           // Max age (24 hours)
    sameSite: 'lax'            // SameSite policy
  },
  genid: () => uuid(),          // Custom ID generator
  store: memoryStore,           // Session store (memory default)
  rolling: false,               // Reset expiry on activity
  unset: 'keep'                 // Action on unset ('destroy'|'keep')
}))
```

### static

Serve static files.

```javascript
const { static } = require('velocy/middleware')

router.use('/public', static('public', {
  index: 'index.html',         // Index file
  extensions: ['html', 'htm'], // Try these extensions
  dotfiles: 'ignore',          // Dotfile handling
  etag: true,                  // Enable ETags
  lastModified: true,          // Send Last-Modified
  maxAge: 0,                   // Cache max-age
  redirect: true,              // Redirect directories to trailing /
  setHeaders: (res, path) => {} // Custom headers function
}))
```

### validator

Request validation middleware.

```javascript
const { validator } = require('velocy/middleware')

router.post('/users', 
  validator({
    body: {
      email: {
        type: 'string',
        required: true,
        pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
        message: 'Invalid email'
      },
      age: {
        type: 'number',
        min: 18,
        max: 120,
        required: true
      }
    },
    query: {
      limit: {
        type: 'number',
        default: 10,
        max: 100
      }
    },
    params: {
      id: {
        type: 'string',
        pattern: /^[0-9a-f]{24}$/
      }
    }
  }),
  (req, res) => {
    // Validated data available in req.body, req.query, req.params
  }
)
```

---

## Utilities

### cache

LRU cache implementation.

```javascript
const { cache } = require('velocy/lib/utils')
// Note: Cache is the internal class, not directly exported

const cache = new Cache({
  max: 1000,              // Maximum entries
  ttl: 60000,             // TTL in milliseconds
  updateAgeOnGet: false,  // Update age on get
  stale: false            // Return stale entries
})

// Set value
cache.set('key', 'value', { ttl: 30000 })

// Get value
const value = cache.get('key')

// Check existence
cache.has('key')

// Delete entry
cache.delete('key')

// Clear all
cache.clear()

// Get stats
const stats = cache.getStats()
```

### performance

Performance monitoring utilities.

```javascript
const { performance } = require('velocy/lib/utils')
// Note: Performance utilities are internal

const monitor = new PerformanceMonitor({
  windowSize: 60000,        // Monitoring window (ms)
  sampleRate: 1,            // Sample rate (0-1)
  enabled: true             // Enable monitoring
})

// Start timing
const timer = monitor.startTimer('operation')

// End timing
timer.end()

// Get metrics
const metrics = monitor.getMetrics()

// Get specific metric
const avgResponseTime = monitor.getMetric('responseTime')
```

### viewEngine

Template engine integration.

```javascript
const { ViewEngine } = require('velocy/lib/utils')

const viewEngine = new ViewEngine({
  views: './views',         // Views directory
  engine: 'ejs',            // Template engine
  cache: true,              // Cache compiled templates
  defaultExtension: 'ejs'   // Default file extension
})

// Render template
const html = await viewEngine.render('index', { title: 'Home' })

// Register custom engine
viewEngine.registerEngine('custom', {
  compile: (template, options) => {
    return (data) => {
      // Render template with data
    }
  }
})
```

---

## Helper Functions

### createServer

Create HTTP server with router.

```javascript
const { createServer } = require('velocy')

const server = createServer(router, {
  port: 3000,
  host: 'localhost',
  backlog: 511
})

server.listen(3000)
```





---

## Type Definitions

```typescript
interface RouterOptions {
  cache?: boolean | CacheOptions
  performance?: boolean | PerformanceOptions
  cookieSecret?: string
  websocket?: WebSocketOptions
  trustProxy?: boolean
  routeCacheSize?: number
}

interface CacheOptions {
  enabled: boolean
  size: number
  ttl: number
}

interface PerformanceOptions {
  enabled: boolean
  windowSize: number
  logSlowRequests: boolean
  slowRequestThreshold: number
}

interface WebSocketOptions {
  perMessageDeflate: boolean
  maxPayload: number
}

interface Handler {
  (req: Request, res: Response, next?: NextFunction): void | Promise<void>
}

interface ErrorHandler {
  (err: Error, req: Request, res: Response, next: NextFunction): void | Promise<void>
}

interface NextFunction {
  (err?: Error): void
}
```