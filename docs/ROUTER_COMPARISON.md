# Velocy Router Comparison Guide

## Overview

Velocy provides three different router implementations, each optimized for specific use cases. This guide will help you choose the right router for your application.

## Quick Comparison Table

| Feature | FastRouter | SimpleRouter | Router |
|---------|------------|--------------|--------|
| **Performance** | ⚡⚡⚡⚡⚡ | ⚡⚡⚡⚡ | ⚡⚡⚡ |
| **Memory Usage** | ~2MB | ~2.5MB | ~5MB+ |
| **Startup Time** | <10ms | <15ms | <25ms |
| **Middleware Support** | ❌ | ✅ Basic | ✅ Full |
| **WebSockets** | ❌ | ❌ | ✅ |
| **Templates** | ❌ | ❌ | ✅ |
| **Request Helpers** | ❌ | ✅ Limited | ✅ Full |
| **Response Helpers** | ❌ | ✅ Limited | ✅ Full |
| **Route Caching** | ❌ | ❌ | ✅ |
| **Cookies** | ❌ | ❌ | ✅ |
| **Sessions** | ❌ | ❌ | ✅ |
| **Error Handling** | Basic | Basic | Advanced |
| **Static Files** | ❌ | ✅ | ✅ |
| **Body Parsing** | ❌ | ✅ | ✅ |
| **CORS** | ❌ | ✅ | ✅ |
| **Compression** | ❌ | ✅ | ✅ |
| **Rate Limiting** | ❌ | ✅ | ✅ |
| **Validation** | ❌ | ✅ | ✅ |

---

## FastRouter

### When to Use

FastRouter is ideal when you need:
- Maximum performance for simple APIs
- Minimal memory footprint
- Direct control over request/response
- Microservice endpoints
- Webhook handlers
- Health check endpoints

### Characteristics

```javascript
const { FastRouter } = require('velocy')
const http = require('http')

const router = new FastRouter()

// Direct, minimal overhead routing
router.get('/api/status', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end('{"status":"ok"}')
})

// Simple parameter extraction
router.get('/api/users/:id', (req, res) => {
  const userId = req.params.id  // Automatically extracted
  res.writeHead(200)
  res.end(`User ${userId}`)
})

const server = http.createServer((req, res) => {
  router.handleRequest(req, res)
})

server.listen(3000)
```

### Performance Profile

```bash
❯ rewrk -d 10s -c 128 -t 1 -h "http://localhost:3333/api/status"

Beginning round 1...
Benchmarking 128 connections @ http://localhost:3333/api/status for 10 second(s)
  Latencies:
    Avg      Stdev    Min      Max      
    2.31ms   1.87ms   0.42ms   124.53ms  
  Requests:
    Total: 553187  Req/Sec: 55342.28
  Transfer:
    Total: 90.26 MB Transfer Rate: 9.03 MB/Sec
```

- **Memory**: ~45MB for 1000 routes

### Limitations

- No middleware support
- No built-in body parsing
- No cookie/session handling
- No WebSocket support
- Manual error handling
- Basic response methods only

### Best Practices

```javascript
// ✅ DO: Use for high-performance endpoints
router.get('/metrics', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' })
  res.end(getMetrics())
})

// ❌ DON'T: Try to add middleware
// This won't work with FastRouter
router.use(someMiddleware)  // Not supported!

// ✅ DO: Handle errors manually
router.get('/api/data', (req, res) => {
  try {
    const data = getData()
    res.writeHead(200)
    res.end(JSON.stringify(data))
  } catch (err) {
    res.writeHead(500)
    res.end('Internal Server Error')
  }
})
```

---

## SimpleRouter

### When to Use

SimpleRouter is ideal when you need:
- Good performance with basic middleware
- Simple authentication/authorization
- Basic API services
- Static file serving
- Simple web applications
- Gradual migration from FastRouter

### Characteristics

```javascript
const { SimpleRouter } = require('velocy')
const { createServer } = require('velocy')

const router = new SimpleRouter()

// Basic middleware support
router.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`)
  next()
})

// Path-specific middleware
router.use('/api', (req, res, next) => {
  // API authentication
  if (!req.headers.authorization) {
    res.writeHead(401)
    res.end('Unauthorized')
    return
  }
  next()
})

// Route with helpers
router.get('/api/users', (req, res) => {
  res.json({ users: [] })  // JSON helper available
})

createServer(router).listen(3000)
```

### Performance Profile

```bash
❯ rewrk -d 10s -c 128 -t 1 -h "http://localhost:3333/api/users"

Beginning round 1...
Benchmarking 128 connections @ http://localhost:3333/api/users for 10 second(s)
  Latencies:
    Avg      Stdev    Min      Max      
    2.56ms   2.09ms   0.49ms   141.28ms  
  Requests:
    Total: 499824  Req/Sec: 49998.41
  Transfer:
    Total: 81.56 MB Transfer Rate: 8.16 MB/Sec
```

- **Memory**: ~52MB for 1000 routes

### Features

```javascript
// ✅ Middleware support
router.use(cors())
router.use(bodyParser())

// ✅ Static files
router.use('/static', static('public'))

// ✅ Basic helpers
router.get('/users/:id', (req, res) => {
  // Request helpers
  const contentType = req.get('content-type')
  const accepts = req.accepts('json')
  
  // Response helpers
  res.status(200)
  res.json({ id: req.params.id })
})

// ❌ No WebSockets
router.ws('/socket')  // Not supported!

// ❌ No templates
res.render('index')  // Not supported!
```

### Migration Path

```javascript
// From FastRouter to SimpleRouter

// Before (FastRouter):
const router = new FastRouter()
router.get('/', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end('{"message":"Hello"}')
})

// After (SimpleRouter):
const router = new SimpleRouter()
router.get('/', (req, res) => {
  res.json({ message: 'Hello' })  // Simpler with helpers
})

// Now you can add middleware:
router.use(compression())
router.use(rateLimit({ max: 100 }))
```

---

## Router (Full-Featured)

### When to Use

Router is ideal when you need:
- Full-featured web applications
- WebSocket support
- Template rendering
- Session management
- Complex middleware chains
- Enterprise applications
- Real-time features

### Characteristics

```javascript
const { Router } = require('velocy')
const { createServer } = require('velocy')

const router = new Router({
  cache: true,               // Enable route caching
  performance: true,         // Enable monitoring
  cookieSecret: 'secret',    // Cookie signing
  websocket: {               // WebSocket config
    perMessageDeflate: true
  }
})

// Full middleware support
router.use(cors())
router.use(compression())
router.use(bodyParser())
router.use(cookieParser())
router.use(session({
  secret: 'session-secret',
  resave: false,
  saveUninitialized: false
}))

// WebSocket support
router.ws('/chat', (ws, req) => {
  ws.on('message', (msg) => {
    ws.broadcast(msg, 'chat-room')
  })
  
  ws.join('chat-room')
})

// Template rendering
router.get('/', (req, res) => {
  res.render('index', {
    title: 'Home',
    user: req.session.user
  })
})

// Complex route handling
router.post('/api/users',
  authenticate,
  authorize('admin'),
  validate({
    body: {
      email: { type: 'email', required: true },
      password: { type: 'string', min: 8 }
    }
  }),
  async (req, res) => {
    const user = await createUser(req.body)
    res.status(201).json(user)
  }
)

createServer(router).listen(3000)
```

### Performance Profile

```bash
❯ rewrk -d 10s -c 128 -t 1 -h "http://localhost:3333/api/users"

Beginning round 1...
Benchmarking 128 connections @ http://localhost:3333/api/users for 10 second(s)
  Latencies:
    Avg      Stdev    Min      Max      
    3.08ms   2.71ms   0.68ms   187.34ms  
  Requests:
    Total: 415378  Req/Sec: 41554.12
  Transfer:
    Total: 67.79 MB Transfer Rate: 6.78 MB/Sec
```

- **Memory**: ~58-85MB for 1000 routes (depending on features enabled)

### Advanced Features

```javascript
// ✅ Route caching for performance
const router = new Router({
  cache: true,
  routeCacheSize: 2000  // Larger cache for more routes
})

// ✅ Performance monitoring
const router = new Router({
  performance: {
    enabled: true,
    logSlowRequests: true,
    slowRequestThreshold: 100
  }
})

// Get performance stats
const stats = router.getPerformanceStats()

// ✅ Subrouters for organization
const apiRouter = new Router()
apiRouter.get('/users', getUsers)
apiRouter.post('/users', createUser)

router.nest('/api/v1', apiRouter)

// ✅ Error handling middleware
router.useError((err, req, res, next) => {
  console.error(err)
  res.status(500).json({
    error: process.env.NODE_ENV === 'production' 
      ? 'Internal Server Error' 
      : err.message
  })
})

// ✅ View engine configuration
router.engine('ejs', require('ejs'))
router.set('views', './views')
router.set('view engine', 'ejs')
```

### WebSocket Features

```javascript
// Room management
router.ws('/game', (ws, req) => {
  const roomId = req.query.room
  
  ws.join(roomId)
  
  ws.on('message', (data) => {
    const msg = JSON.parse(data)
    
    // Broadcast to room
    ws.broadcast(JSON.stringify({
      type: 'move',
      data: msg
    }), roomId)
  })
  
  ws.on('close', () => {
    ws.leave(roomId)
    ws.broadcast(JSON.stringify({
      type: 'player-left'
    }), roomId)
  })
})

// Global WebSocket middleware
router.wsUse((ws, req, next) => {
  // Authenticate WebSocket connection
  if (!req.session.user) {
    ws.close(1008, 'Unauthorized')
    return
  }
  next()
})
```

---

## Migration Guide

### From FastRouter to SimpleRouter

```javascript
// Step 1: Change import
// Before:
const { FastRouter } = require('velocy')
// After:
const { SimpleRouter } = require('velocy')

// Step 2: Update response methods
// Before:
router.get('/api/data', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
})

// After:
router.get('/api/data', (req, res) => {
  res.json(data)
})

// Step 3: Add middleware
router.use(cors())
router.use(bodyParser())
```

### From SimpleRouter to Router

```javascript
// Step 1: Change import and add configuration
// Before:
const { SimpleRouter } = require('velocy')
const router = new SimpleRouter()

// After:
const { Router } = require('velocy')
const router = new Router({
  cache: true,
  performance: true
})

// Step 2: Add advanced features
// WebSockets
router.ws('/live', (ws, req) => {
  // WebSocket logic
})

// Templates
router.engine('ejs', require('ejs'))
router.get('/', (req, res) => {
  res.render('index', { title: 'Home' })
})

// Sessions
router.use(session({
  secret: 'secret-key'
}))
```

### From Express to Velocy

```javascript
// Express
const express = require('express')
const app = express()

app.use(express.json())
app.use(express.static('public'))

app.get('/users/:id', (req, res) => {
  res.json({ id: req.params.id })
})

app.listen(3000)

// Velocy (Router)
const { Router, createServer } = require('velocy')
const { bodyParser, static } = require('velocy/middleware')

const app = new Router()

app.use(bodyParser())
app.use('/public', static('public'))

app.get('/users/:id', (req, res) => {
  res.json({ id: req.params.id })
})

createServer(app).listen(3000)
```

---

## Decision Tree

```
Start
  │
  ├─ Need middleware?
  │    │
  │    ├─ No → FastRouter ⚡
  │    │
  │    └─ Yes
  │         │
  │         ├─ Need WebSockets/Templates/Sessions?
  │         │    │
  │         │    ├─ No → SimpleRouter ⚡⚡
  │         │    │
  │         │    └─ Yes → Router ⚡⚡⚡
  │
  └─ Performance Critical?
       │
       ├─ Yes
       │    │
       │    ├─ Can work without middleware? → FastRouter
       │    │
       │    └─ Need basic middleware? → SimpleRouter
       │
       └─ No → Router (Full comfort)
```

---

## Performance Optimization Tips

### For FastRouter

```javascript
// 1. Use direct methods
router.get('/fast', (req, res) => {
  res.writeHead(200)
  res.end('fast')  // Fastest possible response
})

// 2. Pre-stringify JSON
const cached = JSON.stringify({ status: 'ok' })
router.get('/status', (req, res) => {
  res.writeHead(200, { 
    'Content-Type': 'application/json',
    'Content-Length': cached.length 
  })
  res.end(cached)
})

// 3. Avoid parameter extraction if not needed
router.get('/static-route', handler)  // Faster than /:param
```

### For SimpleRouter

```javascript
// 1. Minimize middleware
// Only use what you need
router.use(cors())  // ✅ If needed
// router.use(compression())  // ❌ Skip if not needed

// 2. Use path-specific middleware
router.use('/api', authMiddleware)  // Only for /api routes

// 3. Order matters
// Put most frequently accessed routes first
router.get('/health', healthCheck)  // Accessed frequently
router.get('/users/:id', getUser)   // Less frequent
```

### For Router

```javascript
// 1. Enable caching
const router = new Router({
  cache: true,
  routeCacheSize: 2000
})

// 2. Lazy-load features
// Don't initialize features you won't use
const router = new Router()  // Start minimal
// Only when needed:
router.ws('/socket', handler)  // WebSocket system loads here

// 3. Use route-specific middleware
router.get('/public', publicHandler)  // No auth needed
router.get('/private', authenticate, privateHandler)  // Auth only here

// 4. Optimize template rendering
router.engine('ejs', require('ejs'))
router.set('view cache', true)  // Cache compiled templates
```

---

## Memory Comparison

### Memory Usage Patterns

```javascript
// FastRouter: ~2MB base + 200 bytes/route
const fast = new FastRouter()
// 1000 routes ≈ 2MB + 200KB = 2.2MB

// SimpleRouter: ~2.5MB base + 250 bytes/route  
const simple = new SimpleRouter()
// 1000 routes ≈ 2.5MB + 250KB = 2.75MB
// +500KB per global middleware

// Router: ~5MB base + 300 bytes/route
const full = new Router({ cache: true })
// 1000 routes ≈ 5MB + 300KB = 5.3MB
// +1MB with WebSockets active
// +500KB with template engine
// +2MB with sessions (1000 active)
```

### Memory Optimization

```javascript
// 1. Choose the right router
// Don't use Router if SimpleRouter suffices

// 2. Limit cache sizes
const router = new Router({
  cache: {
    enabled: true,
    size: 500  // Smaller cache for less memory
  }
})

// 3. Clean up WebSocket connections
router.ws('/socket', (ws, req) => {
  ws.on('close', () => {
    // Clean up resources
    delete connections[ws.id]
  })
})

// 4. Use streaming for large responses
router.get('/large-file', (req, res) => {
  const stream = fs.createReadStream('large.json')
  stream.pipe(res)  // Stream instead of loading in memory
})
```

---

## Real-World Examples

### FastRouter: Metrics Endpoint

```javascript
const { FastRouter } = require('velocy')
const router = new FastRouter()

// Prometheus metrics endpoint
router.get('/metrics', (req, res) => {
  const metrics = collectMetrics()
  res.writeHead(200, {
    'Content-Type': 'text/plain',
    'Cache-Control': 'no-cache'
  })
  res.end(metrics)
})

// Health check
router.get('/health', (req, res) => {
  res.writeHead(200)
  res.end('OK')
})

// Ready check
router.get('/ready', (req, res) => {
  if (isReady()) {
    res.writeHead(200)
    res.end('Ready')
  } else {
    res.writeHead(503)
    res.end('Not Ready')
  }
})
```

### SimpleRouter: REST API

```javascript
const { SimpleRouter } = require('velocy')
const { bodyParser, cors, rateLimit } = require('velocy/middleware')

const router = new SimpleRouter()

// Middleware
router.use(cors())
router.use(bodyParser())
router.use(rateLimit({ max: 100 }))

// Simple auth middleware
router.use('/api', (req, res, next) => {
  const token = req.headers.authorization
  if (!token || !validateToken(token)) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }
  next()
})

// CRUD operations
router.get('/api/items', (req, res) => {
  res.json(getItems())
})

router.post('/api/items', (req, res) => {
  const item = createItem(req.body)
  res.status(201).json(item)
})

router.put('/api/items/:id', (req, res) => {
  const item = updateItem(req.params.id, req.body)
  res.json(item)
})

router.delete('/api/items/:id', (req, res) => {
  deleteItem(req.params.id)
  res.status(204).end()
})
```

### Router: Full Application

```javascript
const { Router } = require('velocy')
const { 
  bodyParser, 
  cookieParser, 
  session, 
  static,
  compression 
} = require('velocy/middleware')

const router = new Router({
  cache: true,
  performance: true,
  cookieSecret: 'secret'
})

// Global middleware
router.use(compression())
router.use(bodyParser())
router.use(cookieParser())
router.use(session({
  secret: 'session-secret',
  resave: false,
  saveUninitialized: false
}))

// Static files
router.use('/assets', static('public'))

// View engine
router.engine('ejs', require('ejs'))
router.set('views', './views')
router.set('view engine', 'ejs')

// Routes
router.get('/', (req, res) => {
  res.render('index', {
    user: req.session.user,
    title: 'Welcome'
  })
})

// API routes
const api = new Router()
api.get('/users', getUsers)
api.post('/users', createUser)
router.nest('/api', api)

// WebSocket for real-time
router.ws('/chat', (ws, req) => {
  const user = req.session.user
  
  ws.join('main-chat')
  
  ws.on('message', (msg) => {
    ws.broadcast(JSON.stringify({
      user: user.name,
      message: msg,
      timestamp: Date.now()
    }), 'main-chat')
  })
})

// Error handling
router.useError((err, req, res, next) => {
  console.error(err)
  res.status(500).render('error', {
    message: 'Something went wrong'
  })
})
```

---

## Conclusion

Choose your router based on your needs:

- **FastRouter**: When every microsecond counts
- **SimpleRouter**: When you need basic features with good performance  
- **Router**: When you need the full power of a modern web framework

Remember: You can always start with FastRouter and upgrade as your needs grow. The API is designed to make migration straightforward.