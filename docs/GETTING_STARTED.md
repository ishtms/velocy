# Getting Started with Velocy

## Table of Contents

- [Installation](#installation)
- [Hello World](#hello-world)
- [Core Concepts](#core-concepts)
- [Choosing a Router](#choosing-a-router)
- [Basic Routing](#basic-routing)
- [Middleware](#middleware)
- [Request & Response](#request--response)
- [Static Files](#static-files)
- [Body Parsing](#body-parsing)
- [WebSockets](#websockets)
- [Error Handling](#error-handling)
- [Production Deployment](#production-deployment)
- [Next Steps](#next-steps)

---

## Installation

Install Velocy using your preferred package manager:

```bash
# npm
npm install velocy

# yarn
yarn add velocy

# pnpm
pnpm add velocy
```

Velocy has **zero dependencies** and works with Node.js 14.x and above.

---

## Hello World

Create your first Velocy application in just a few lines:

```javascript
// server.js
const { Router, createServer } = require('velocy')

const app = new Router()

app.get('/', (req, res) => {
  res.send('Hello, World!')
})

createServer(app).listen(3000, () => {
  console.log('Server running at http://localhost:3000')
})
```

Run your server:

```bash
node server.js
```

Visit http://localhost:3000 in your browser to see your application!

---

## Core Concepts

### 1. Routers

Velocy provides three router implementations:

- **FastRouter**: Maximum performance, minimal features
- **SimpleRouter**: Good performance with basic middleware
- **Router**: Full features including WebSockets, templates, and more

### 2. Middleware

Functions that execute during the request-response cycle:

```javascript
function middleware(req, res, next) {
  // Do something
  next() // Pass control to next middleware
}
```

### 3. Routes

URL patterns that match incoming requests:

```javascript
app.get('/users/:id', handler)  // GET /users/123
app.post('/users', handler)     // POST /users
app.all('/api/*', handler)      // Any method, any /api/* path
```

---

## Choosing a Router

### Decision Guide

```javascript
// Need maximum performance? Use FastRouter
const { FastRouter } = require('velocy')
const app = new FastRouter()
// ✅ 55,000+ requests/sec
// ❌ No middleware, WebSockets, or helpers

// Need basic features? Use SimpleRouter
const { SimpleRouter } = require('velocy')
const app = new SimpleRouter()
// ✅ 50,000+ requests/sec
// ✅ Basic middleware
// ❌ No WebSockets or templates

// Need full features? Use Router
const { Router } = require('velocy')
const app = new Router()
// ✅ All features
// ✅ 41,000+ requests/sec
// ✅ WebSockets, templates, sessions, etc.
```

---

## Basic Routing

### HTTP Methods

```javascript
const { Router } = require('velocy')
const app = new Router()

// GET request
app.get('/users', (req, res) => {
  res.json({ users: [] })
})

// POST request
app.post('/users', (req, res) => {
  res.status(201).json({ created: true })
})

// PUT request
app.put('/users/:id', (req, res) => {
  const userId = req.params.id
  res.json({ updated: userId })
})

// DELETE request
app.delete('/users/:id', (req, res) => {
  res.status(204).end()
})

// Multiple methods
app.route('/items')
  .get(getItems)
  .post(createItem)
  .put(updateItem)
```

### Route Parameters

```javascript
// Single parameter
app.get('/users/:id', (req, res) => {
  res.json({ userId: req.params.id })
})

// Multiple parameters
app.get('/posts/:year/:month/:day', (req, res) => {
  const { year, month, day } = req.params
  res.json({ date: `${year}-${month}-${day}` })
})

// Optional parameters (using multiple routes)
app.get('/posts/:id', getPost)
app.get('/posts', getAllPosts)

// Wildcards
app.get('/files/*', (req, res) => {
  const filePath = req.params['*']
  res.send(`File: ${filePath}`)
})
```

### Query Strings

```javascript
app.get('/search', (req, res) => {
  const { q, page = 1, limit = 10 } = req.query
  // GET /search?q=velocy&page=2&limit=20
  res.json({
    query: q,
    page: parseInt(page),
    limit: parseInt(limit)
  })
})
```

---

## Middleware

### Using Built-in Middleware

```javascript
const { Router } = require('velocy')
const { cors, bodyParser, compression } = require('velocy/middleware')

const app = new Router()

// Global middleware
app.use(cors())              // Enable CORS
app.use(compression())       // Compress responses
app.use(bodyParser())        // Parse request bodies

// Path-specific middleware
app.use('/api', authenticate)  // Only for /api routes

// Route-specific middleware
app.get('/admin', 
  authenticate,
  authorize('admin'),
  adminDashboard
)
```

### Creating Custom Middleware

```javascript
// Logger middleware
function logger(req, res, next) {
  console.log(`${req.method} ${req.url}`)
  next()
}

// Authentication middleware
function authenticate(req, res, next) {
  const token = req.headers.authorization
  
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  
  // Verify token...
  req.user = { id: 1, name: 'John' }
  next()
}

// Error handling middleware
function errorHandler(err, req, res, next) {
  console.error(err.stack)
  res.status(500).json({ error: 'Something went wrong!' })
}

app.use(logger)
app.use(authenticate)
app.useError(errorHandler)  // Error middleware goes last
```

---

## Request & Response

### Request Object

```javascript
app.get('/info', (req, res) => {
  // URL info
  console.log(req.url)         // Full URL
  console.log(req.path)        // Path without query
  console.log(req.query)       // Query parameters
  console.log(req.params)      // Route parameters
  
  // Headers
  console.log(req.headers)     // All headers
  console.log(req.get('content-type'))  // Specific header
  
  // Body (with bodyParser)
  console.log(req.body)        // Parsed body
  
  // Other
  console.log(req.method)      // HTTP method
  console.log(req.ip)          // Client IP
  console.log(req.cookies)     // Cookies (with cookieParser)
  console.log(req.session)     // Session (with session middleware)
})
```

### Response Object

```javascript
app.get('/response-examples', (req, res) => {
  // Send JSON
  res.json({ message: 'Hello' })
  
  // Send with status
  res.status(404).json({ error: 'Not found' })
  
  // Send text
  res.send('Plain text')
  
  // Send HTML
  res.send('<h1>HTML</h1>')
  
  // Set headers
  res.set('X-Custom-Header', 'value')
  res.set({
    'X-Header-1': 'value1',
    'X-Header-2': 'value2'
  })
  
  // Redirect
  res.redirect('/new-location')
  res.redirect(301, '/permanent-redirect')
  
  // Cookies
  res.cookie('name', 'value', {
    httpOnly: true,
    secure: true,
    maxAge: 86400000  // 24 hours
  })
  res.clearCookie('name')
})
```

---

## Static Files

Serve static files like images, CSS, and JavaScript:

```javascript
const { static } = require('velocy/middleware')

// Serve files from 'public' directory
app.use(static('public'))
// Files in public/ are available at /

// With virtual path
app.use('/assets', static('public'))
// Files in public/ are available at /assets/

// Multiple directories
app.use('/css', static('styles'))
app.use('/js', static('scripts'))
app.use('/images', static('images'))

// With options
app.use(static('public', {
  index: 'index.html',      // Default file
  dotfiles: 'ignore',        // Hide dotfiles
  maxAge: '1d',              // Cache for 1 day
  etag: true                 // Enable ETags
}))
```

Directory structure:
```
project/
├── server.js
├── public/
│   ├── css/
│   │   └── style.css
│   ├── js/
│   │   └── app.js
│   └── images/
│       └── logo.png
```

---

## Body Parsing

Parse incoming request bodies:

```javascript
const { bodyParser } = require('velocy/middleware')

// Parse all body types
app.use(bodyParser())

// Or configure specific types
app.use(bodyParser({
  json: true,        // Parse JSON
  urlencoded: true,  // Parse URL-encoded
  multipart: false,  // Parse multipart (file uploads)
  limit: '1mb'       // Size limit
}))

// Handle JSON
app.post('/api/data', (req, res) => {
  console.log(req.body)  // Parsed JSON object
  res.json({ received: req.body })
})

// Handle form data
app.post('/form', (req, res) => {
  const { name, email } = req.body
  res.send(`Hello ${name}!`)
})

// Handle file uploads (multipart enabled)
app.post('/upload', bodyParser({ multipart: true }), (req, res) => {
  console.log(req.files)  // Uploaded files
  console.log(req.body)   // Other form fields
  res.json({ uploaded: true })
})
```

---

## WebSockets

Real-time bidirectional communication (Router only):

```javascript
const { Router } = require('velocy')
const app = new Router()

// WebSocket endpoint
app.ws('/chat', (ws, req) => {
  console.log('New WebSocket connection')
  
  // Join a room
  ws.join('general')
  
  // Handle messages
  ws.on('message', (data) => {
    console.log('Received:', data)
    
    // Echo back
    ws.send(`Echo: ${data}`)
    
    // Broadcast to room
    ws.broadcast(data, 'general')
  })
  
  // Handle disconnect
  ws.on('close', () => {
    console.log('Connection closed')
  })
})

// Client-side (browser)
const ws = new WebSocket('ws://localhost:3000/chat')

ws.onopen = () => {
  ws.send('Hello server!')
}

ws.onmessage = (event) => {
  console.log('Message:', event.data)
}
```

---

## Error Handling

### Synchronous Errors

```javascript
app.get('/error', (req, res) => {
  throw new Error('Something went wrong!')
})

// Error handler
app.useError((err, req, res, next) => {
  console.error(err.stack)
  res.status(500).json({
    error: process.env.NODE_ENV === 'production' 
      ? 'Internal Server Error' 
      : err.message
  })
})
```

### Asynchronous Errors

```javascript
// Use try-catch for async routes
app.get('/async', async (req, res) => {
  try {
    const data = await fetchData()
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Or create an async handler wrapper
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next)
}

app.get('/async-wrapped', asyncHandler(async (req, res) => {
  const data = await fetchData()  // Errors automatically caught
  res.json(data)
}))
```

### 404 Handling

```javascript
// Add at the end of all routes
app.all('*', (req, res) => {
  res.status(404).json({ error: 'Not Found' })
})
```

---

## Production Deployment

### Environment Variables

```javascript
const port = process.env.PORT || 3000
const nodeEnv = process.env.NODE_ENV || 'development'

const app = new Router({
  cache: nodeEnv === 'production',  // Enable caching in production
  performance: nodeEnv === 'development'  // Performance monitoring in dev
})

// Production middleware
if (nodeEnv === 'production') {
  app.use(compression())  // Enable compression
  app.use(helmet())       // Security headers
}
```

### Clustering

```javascript
const cluster = require('cluster')
const os = require('os')

if (cluster.isMaster) {
  const cpuCount = os.cpus().length
  
  for (let i = 0; i < cpuCount; i++) {
    cluster.fork()
  }
  
  cluster.on('exit', (worker) => {
    console.log(`Worker ${worker.process.pid} died`)
    cluster.fork()  // Restart worker
  })
} else {
  // Worker process
  const { Router, createServer } = require('velocy')
  const app = new Router()
  
  // Your app setup...
  
  createServer(app).listen(3000)
}
```

### Process Management with PM2

```bash
# Install PM2
npm install -g pm2

# Start application
pm2 start server.js -i max  # Use all CPU cores

# Monitor
pm2 monit

# Restart
pm2 restart server

# Stop
pm2 stop server
```

### Security Best Practices

```javascript
const { rateLimit, cors, helmet } = require('velocy/middleware')

// Rate limiting
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 100  // Limit to 100 requests
}))

// CORS configuration
app.use(cors({
  origin: 'https://yourdomain.com',
  credentials: true
}))

// Security headers (if using helmet)
app.use(helmet())

// Input validation
const { validator } = require('velocy/middleware')

app.post('/api/users', 
  validator({
    body: {
      email: { type: 'email', required: true },
      password: { type: 'string', min: 8 }
    }
  }),
  createUser
)
```

---

## Next Steps

### Learn More

1. **[API Reference](./API_REFERENCE.md)** - Complete API documentation
2. **[Router Comparison](./ROUTER_COMPARISON.md)** - Choose the right router
3. **[Middleware Guide](./MIDDLEWARE_GUIDE.md)** - Deep dive into middleware
4. **[Architecture](./ARCHITECTURE.md)** - Understand Velocy's internals
5. **[Performance Guide](./PERFORMANCE.md)** - Optimization techniques

### Example Applications

Check out the `examples/` directory for complete applications:

- **Basic API** - REST API with CRUD operations
- **Real-time Chat** - WebSocket chat application
- **Static Site** - Serving static files with templates
- **Full Application** - Complete web app with auth, sessions, and more

### Community

- **GitHub**: [github.com/velocy/velocy](https://github.com/velocy/velocy)
- **Issues**: Report bugs or request features
- **Discussions**: Ask questions and share ideas

### Migration Guides

- [From Express](./MIGRATION_EXPRESS.md)
- [From Fastify](./MIGRATION_FASTIFY.md)
- [From Koa](./MIGRATION_KOA.md)

---

## Quick Reference

### Creating a Full Application

```javascript
const { Router, createServer } = require('velocy')
const { 
  bodyParser, 
  cookieParser, 
  session,
  static,
  cors,
  compression,
  rateLimit
} = require('velocy/middleware')

// Create router with options
const app = new Router({
  cache: true,
  performance: process.env.NODE_ENV === 'development'
})

// Global middleware
app.use(cors())
app.use(compression())
app.use(bodyParser())
app.use(cookieParser())
app.use(session({
  secret: 'your-secret-key',
  resave: false,
  saveUninitialized: false
}))

// Rate limiting
app.use('/api', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
}))

// Static files
app.use('/public', static('public'))

// Routes
app.get('/', (req, res) => {
  res.send('<h1>Welcome to Velocy!</h1>')
})

app.get('/api/data', (req, res) => {
  res.json({ 
    message: 'API endpoint',
    timestamp: Date.now()
  })
})

// WebSocket
app.ws('/socket', (ws, req) => {
  ws.on('message', (data) => {
    ws.send(`Echo: ${data}`)
  })
})

// Error handling
app.useError((err, req, res, next) => {
  console.error(err)
  res.status(500).json({ error: 'Server error' })
})

// 404 handler
app.all('*', (req, res) => {
  res.status(404).send('Page not found')
})

// Start server
const server = createServer(app)
const port = process.env.PORT || 3000

server.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`)
})
```

---

## Summary

You've learned the basics of Velocy! Key takeaways:

1. **Choose the right router** for your needs (Fast, Simple, or Full)
2. **Use middleware** to add functionality
3. **Handle routes** with parameters and query strings
4. **Parse bodies** and serve static files
5. **Add WebSockets** for real-time features
6. **Handle errors** gracefully
7. **Deploy to production** with security and performance in mind

Happy coding with Velocy! 🚀