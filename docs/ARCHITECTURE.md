# Velocy Architecture Documentation

## Table of Contents

- [Overview](#overview)
- [Design Principles](#design-principles)
- [Core Architecture](#core-architecture)
- [Component Architecture](#component-architecture)
- [Router Architecture](#router-architecture)
- [Middleware System](#middleware-system)
- [WebSocket Architecture](#websocket-architecture)
- [Performance Optimizations](#performance-optimizations)
- [Memory Management](#memory-management)
- [Security Architecture](#security-architecture)
- [Extension Points](#extension-points)

---

## Overview

Velocy is a high-performance, zero-dependency HTTP framework for Node.js built with a focus on speed, modularity, and developer experience. The framework is designed using a layered architecture that provides flexibility while maintaining optimal performance.

### Key Architectural Decisions

1. **Zero Dependencies**: All functionality is implemented using Node.js built-in modules
2. **Lazy Loading**: Features are loaded only when used to minimize overhead
3. **Modular Design**: Clear separation between core routing and optional features
4. **Performance First**: Multiple router implementations for different use cases
5. **Progressive Enhancement**: Start minimal, add features as needed

---

## Design Principles

### 1. Zero-Cost Abstractions
Features that aren't used don't impact performance. This is achieved through:
- Lazy initialization of components
- Property getters that defer instantiation
- Conditional module loading
- Fast-path optimizations for simple cases

### 2. Composition Over Inheritance
Components are composed rather than inherited:
```javascript
// Instead of deep inheritance hierarchies
class Router {
  constructor() {
    this._core = new RoutingCore()
    this._middleware = null  // Lazy loaded
    this._websocket = null   // Lazy loaded
  }
}
```

### 3. Explicit Over Implicit
Configuration and behavior are explicit:
- No hidden global state
- Clear initialization patterns
- Predictable behavior

### 4. Performance Layers
Three distinct performance layers:
1. **FastRouter**: Raw performance, minimal features
2. **SimpleRouter**: Basic middleware, good performance
3. **Router**: Full features, optimized performance

---

## Core Architecture

```
┌─────────────────────────────────────────────┐
│              User Application               │
├─────────────────────────────────────────────┤
│                 Velocy API                  │
├─────────────┬───────────────┬───────────────┤
│   Router    │  Middleware   │   Utilities   │
├─────────────┼───────────────┼───────────────┤
│  FastRouter │  bodyParser   │     Cache     │
│ SimpleRouter│  cookieParser │  Performance  │
│   Router    │     cors      │  ViewEngine   │
│             │  compression  │   WebSocket   │
│             │   rateLimit   │               │
│             │    session    │               │
│             │     static    │               │
│             │   validator   │               │
├─────────────┴───────────────┴───────────────┤
│           Node.js Built-in Modules          │
│     (http, https, fs, crypto, zlib, etc)    │
└─────────────────────────────────────────────┘
```

### Layer Descriptions

#### Application Layer
User code that consumes Velocy APIs to build web applications.

#### API Layer
Public interfaces exposed by Velocy:
- Router classes
- Middleware functions
- Utility helpers
- Configuration options

#### Component Layer
Internal implementations:
- **Routing Core**: Path matching and handler execution
- **Middleware System**: Request/response pipeline
- **Utilities**: Shared functionality

#### Node.js Layer
Built-in Node.js modules used throughout:
- `http/https`: Server creation and request handling
- `fs`: Static file serving
- `crypto`: Cookie signing, session IDs
- `zlib`: Compression
- `querystring`: URL parsing
- `path`: File path operations

---

## Component Architecture

### Directory Structure

```
velocy/
├── index.js                 # Main entry point
├── lib/
│   ├── core/               # Core components
│   │   ├── Router.js       # Full-featured router
│   │   ├── FastRouter.js   # Minimal router
│   │   ├── SimpleRouter.js # Basic router
│   │   ├── Request.js      # Enhanced request
│   │   ├── Response.js     # Enhanced response
│   │   ├── WebSocket.js    # WebSocket handler
│   │   └── WebSocketRouter.js # WS routing
│   ├── middleware/         # Built-in middleware
│   │   ├── bodyParser.js   # Body parsing
│   │   ├── cookieParser.js # Cookie parsing
│   │   ├── cors.js         # CORS handling
│   │   ├── compression.js  # Response compression
│   │   ├── rateLimit.js    # Rate limiting
│   │   ├── session.js      # Session management
│   │   ├── static.js       # Static file serving
│   │   ├── validator.js    # Request validation
│   │   └── index.js        # Middleware exports
│   └── utils/              # Utility modules
│       ├── cache.js        # LRU cache
│       ├── performance.js  # Performance monitoring
│       ├── viewEngine.js   # Template engine
│       ├── websocket.js    # WebSocket utilities
│       ├── engineAdapters.js # Template adapters
│       └── index.js        # Utility exports
├── examples/               # Example implementations
├── tests/                  # Test suite
├── benchmarks/            # Performance benchmarks
└── docs/                  # Documentation
```

### Component Responsibilities

#### Core Components

**Router Classes**
- Route registration and matching
- Middleware pipeline management
- Request handling and dispatching
- WebSocket upgrade handling

**Request/Response**
- Enhanced HTTP objects
- Helper methods for common operations
- Cookie and session integration
- Content negotiation

**WebSocket**
- Connection management
- Room/channel support
- Broadcasting capabilities
- Event handling

#### Middleware Components

Each middleware follows a consistent pattern:
```javascript
module.exports = function(options = {}) {
  // Initialization
  const config = { ...defaults, ...options }
  
  // Return middleware function
  return function(req, res, next) {
    // Processing logic
    next()
  }
}
```

#### Utility Components

**Cache**: LRU cache for route matching and compiled templates
**Performance**: Request timing and metrics collection
**ViewEngine**: Template engine abstraction and caching

---

## Router Architecture

### Three-Tier Router System

```
         ┌──────────────┐
         │   FastRouter │ ← Minimal overhead
         └──────┬───────┘   No middleware
                │            Raw performance
                ▼
         ┌──────────────┐
         │ SimpleRouter │ ← Basic middleware
         └──────┬───────┘   Lightweight
                │            Good performance
                ▼
         ┌──────────────┐
         │    Router    │ ← Full features
         └──────────────┘   Lazy loading
                            Optimized performance
```

### Route Matching Algorithm

#### 1. Exact Match (O(1))
Static routes are stored in a Map for instant lookup:
```javascript
this._exactRoutes.get(`${method}:${path}`)
```

#### 2. Pattern Match (O(n))
Dynamic routes use optimized pattern matching:
```javascript
for (const route of this._patternRoutes) {
  if (route.pattern.test(path)) {
    // Extract parameters
    return route
  }
}
```

#### 3. Wildcard Match
Catch-all routes for 404 handling:
```javascript
this._wildcardRoutes.get(method) || this._wildcardRoutes.get('*')
```

### Route Registration Flow

```
app.get('/users/:id', handler)
         ↓
Parse path pattern
         ↓
Generate regex if needed
         ↓
Store in appropriate structure:
  - Exact routes → Map
  - Pattern routes → Array
  - Wildcard routes → Map
         ↓
Clear route cache
```

### Request Handling Pipeline

```
Incoming Request
       ↓
Parse URL and method
       ↓
Check route cache (if enabled)
       ↓
Match route:
  1. Try exact match
  2. Try pattern match
  3. Try wildcard match
       ↓
Execute global middleware
       ↓
Execute route middleware
       ↓
Execute route handler
       ↓
Send response
```

---

## Middleware System

### Middleware Architecture

```
Request → [Global MW] → [Route MW] → [Handler] → [Error MW] → Response
             ↓              ↓            ↓            ↓
          [next()]      [next()]    [next(err)]  [handle]
```

### Middleware Types

#### 1. Global Middleware
Applied to all requests:
```javascript
router.use(cors())
router.use(bodyParser())
```

#### 2. Path-Specific Middleware
Applied to specific path prefixes:
```javascript
router.use('/api', authMiddleware)
router.use('/admin', adminMiddleware)
```

#### 3. Route Middleware
Applied to specific routes:
```javascript
router.get('/users', authenticate, authorize, getUsers)
```

#### 4. Error Middleware
Handles errors from previous middleware:
```javascript
router.useError((err, req, res, next) => {
  res.status(500).json({ error: err.message })
})
```

### Middleware Execution Model

```javascript
class MiddlewareExecutor {
  execute(middlewares, req, res, done) {
    let index = 0
    
    function next(err) {
      if (err) return done(err)
      
      const middleware = middlewares[index++]
      if (!middleware) return done()
      
      try {
        if (middleware.length === 4) {
          // Error middleware
          if (err) middleware(err, req, res, next)
          else next()
        } else {
          // Regular middleware
          middleware(req, res, next)
        }
      } catch (error) {
        next(error)
      }
    }
    
    next()
  }
}
```

### Lazy Middleware Loading

Middleware system is initialized only when first used:

```javascript
class Router {
  get middleware() {
    if (!this._middlewareSystem) {
      this._middlewareSystem = new MiddlewareSystem()
    }
    return this._middlewareSystem
  }
  
  use(...args) {
    return this.middleware.use(...args)
  }
}
```

---

## WebSocket Architecture

### WebSocket System Components

```
┌─────────────────────────────────────┐
│         WebSocket Client            │
└─────────────┬───────────────────────┘
              ↓ Upgrade Request
┌─────────────────────────────────────┐
│          HTTP Server                │
└─────────────┬───────────────────────┘
              ↓ Upgrade Event
┌─────────────────────────────────────┐
│       WebSocket Router              │
├─────────────────────────────────────┤
│  - Path matching                    │
│  - Connection handling              │
│  - Room management                  │
└─────────────┬───────────────────────┘
              ↓
┌─────────────────────────────────────┐
│     WebSocket Connection            │
├─────────────────────────────────────┤
│  - Message handling                 │
│  - Broadcasting                     │
│  - Room operations                  │
└─────────────────────────────────────┘
```

### Connection Lifecycle

```
1. HTTP Upgrade Request
       ↓
2. Route Matching
       ↓
3. WebSocket Handshake
       ↓
4. Connection Established
       ↓
5. Message Exchange
       ↓
6. Connection Close
```

### Room/Channel System

```javascript
class RoomManager {
  constructor() {
    this.rooms = new Map()  // room -> Set<connection>
    this.connections = new Map()  // connection -> Set<room>
  }
  
  join(connection, room) {
    // Add connection to room
    if (!this.rooms.has(room)) {
      this.rooms.set(room, new Set())
    }
    this.rooms.get(room).add(connection)
    
    // Track rooms for connection
    if (!this.connections.has(connection)) {
      this.connections.set(connection, new Set())
    }
    this.connections.get(connection).add(room)
  }
  
  broadcast(room, message, exclude) {
    const connections = this.rooms.get(room)
    if (connections) {
      for (const conn of connections) {
        if (conn !== exclude && conn.readyState === OPEN) {
          conn.send(message)
        }
      }
    }
  }
}
```

---

## Performance Optimizations

### 1. Route Caching

```javascript
class RouteCache {
  constructor(maxSize = 1000) {
    this.cache = new LRUCache(maxSize)
  }
  
  get(method, path) {
    return this.cache.get(`${method}:${path}`)
  }
  
  set(method, path, result) {
    this.cache.set(`${method}:${path}`, result)
  }
}
```

**Benefits**:
- Avoid repeated route matching
- O(1) lookup for cached routes
- Automatic cache invalidation

### 2. Lazy Feature Loading

```javascript
class Router {
  get viewEngine() {
    if (!this._viewEngine) {
      const ViewEngine = require('./utils/viewEngine')
      this._viewEngine = new ViewEngine(this.options)
    }
    return this._viewEngine
  }
}
```

**Benefits**:
- Reduced initial memory usage
- Faster startup time
- Pay only for used features

### 3. String Interning

```javascript
class StringIntern {
  constructor() {
    this.strings = new Map()
  }
  
  intern(str) {
    if (!this.strings.has(str)) {
      this.strings.set(str, str)
    }
    return this.strings.get(str)
  }
}
```

**Benefits**:
- Reduced memory for duplicate strings
- Faster string comparisons
- Better cache locality

### 4. Object Pooling

```javascript
class ObjectPool {
  constructor(factory, reset) {
    this.pool = []
    this.factory = factory
    this.reset = reset
  }
  
  acquire() {
    return this.pool.pop() || this.factory()
  }
  
  release(obj) {
    this.reset(obj)
    this.pool.push(obj)
  }
}
```

**Benefits**:
- Reduced GC pressure
- Consistent performance
- Lower memory allocation

### 5. Fast Path Optimizations

```javascript
handleRequest(req, res) {
  // Fast path for exact routes
  const exact = this._exactRoutes.get(`${req.method}:${req.url}`)
  if (exact) {
    return exact.handler(req, res)
  }
  
  // Slower path for pattern matching
  return this._handleWithPatterns(req, res)
}
```

---

## Memory Management

### Memory Optimization Strategies

#### 1. Lazy Initialization
Components are created only when needed:
- Middleware system: ~500KB saved when unused
- WebSocket system: ~1MB saved when unused
- View engine: ~300KB saved when unused

#### 2. Shared Resources
Common resources are shared across instances:
- Compiled regex patterns
- Interned strings
- Template cache

#### 3. Automatic Cleanup
Resources are automatically cleaned up:
- WebSocket connections on close
- Session data on expiry
- Cache entries on LRU eviction

### Memory Profiling

```javascript
router.getMemoryUsage = function() {
  return {
    routes: this._routes.size * 200,  // ~200 bytes per route
    middleware: this._middleware?.length * 500,  // ~500 bytes per MW
    cache: this._cache?.size * 1000,  // ~1KB per cached route
    websockets: this._wsConnections?.size * 5000,  // ~5KB per connection
    total: process.memoryUsage().heapUsed
  }
}
```

---

## Security Architecture

### Security Layers

```
┌─────────────────────────────────────┐
│          Application Layer          │
│     (User authentication, etc)      │
├─────────────────────────────────────┤
│         Framework Layer             │
│   (CORS, Rate limiting, Sessions)   │
├─────────────────────────────────────┤
│          Transport Layer            │
│        (HTTPS, WSS support)         │
└─────────────────────────────────────┘
```

### Built-in Security Features

#### 1. CORS Protection
```javascript
router.use(cors({
  origin: 'https://trusted-domain.com',
  credentials: true
}))
```

#### 2. Rate Limiting
```javascript
router.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
}))
```

#### 3. Cookie Security
```javascript
res.cookie('session', value, {
  httpOnly: true,  // Prevent XSS
  secure: true,    // HTTPS only
  sameSite: 'strict'  // CSRF protection
})
```

#### 4. Input Validation
```javascript
router.use(validator({
  body: {
    email: { type: 'email', required: true }
  }
}))
```

### Security Best Practices

1. **Always use HTTPS in production**
2. **Enable security headers** (helmet middleware compatible)
3. **Validate and sanitize input**
4. **Use secure session configuration**
5. **Implement rate limiting**
6. **Keep dependencies updated** (though Velocy has zero deps)

---

## Extension Points

### Custom Middleware

```javascript
function customMiddleware(options) {
  return function(req, res, next) {
    // Custom logic
    next()
  }
}

router.use(customMiddleware({ /* options */ }))
```

### Custom Router Implementation

```javascript
class CustomRouter extends Router {
  constructor(options) {
    super(options)
    // Custom initialization
  }
  
  // Override methods as needed
  handleRequest(req, res) {
    // Custom request handling
    super.handleRequest(req, res)
  }
}
```

### Template Engine Integration

```javascript
const customEngine = {
  compile: function(template, options) {
    return function(data) {
      // Render template with data
      return renderedHTML
    }
  }
}

router.engine('custom', customEngine)
```

### Plugin System

```javascript
class VelocyPlugin {
  install(router, options) {
    // Add functionality to router
    router.customMethod = function() { /* ... */ }
    
    // Register middleware
    router.use(this.middleware())
    
    // Add routes
    router.get('/plugin-route', this.handler)
  }
}

router.plugin(new VelocyPlugin())
```

---

## Performance Benchmarks

### Benchmark Architecture

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  Benchmark   │────▶│    Server    │────▶│   Results    │
│   Client     │     │  (Velocy)    │     │  Collection  │
└──────────────┘     └──────────────┘     └──────────────┘
       │                                           │
       └───────────────────────────────────────────┘
                    Analysis & Reporting
```

### Performance Metrics

- **Throughput**: Requests per second
- **Latency**: Response time percentiles (p50, p95, p99)
- **Memory**: Heap usage and growth
- **CPU**: Utilization percentage

### Optimization Results

| Router Type | RPS | Avg Latency (ms) | Memory (MB) |
|------------|-----|------------------|-------------|
| FastRouter | 55,342 | 2.31 | 45 |
| SimpleRouter | 49,998 | 2.56 | 52 |
| Router (minimal) | 48,479 | 2.64 | 58 |
| Router (full) | 41,554 | 3.08 | 85 |

---

## Future Architecture Considerations

### Planned Enhancements

1. **HTTP/2 Support**: Native HTTP/2 with stream multiplexing
2. **Worker Threads**: CPU-intensive task offloading
3. **Cluster Mode**: Built-in cluster management
4. **GraphQL Integration**: First-class GraphQL support
5. **Service Mesh**: Microservices communication patterns

### Scaling Considerations

```
┌─────────────┐
│ Load Balancer│
└──────┬──────┘
       │
┌──────▼──────┬──────────┬──────────┐
│  Worker 1   │ Worker 2 │ Worker N │
├─────────────┼──────────┼──────────┤
│   Velocy    │  Velocy  │  Velocy  │
└─────────────┴──────────┴──────────┘
       │             │           │
       └─────────────┼───────────┘
                     │
              ┌──────▼──────┐
              │   Database  │
              └─────────────┘
```

### Monitoring & Observability

Future architecture will include:
- OpenTelemetry integration
- Distributed tracing
- Metrics exporters
- Health check endpoints
- Custom dashboards

---

## Conclusion

Velocy's architecture is designed to provide maximum flexibility while maintaining optimal performance. The layered approach, lazy loading, and multiple router implementations allow developers to choose the right balance between features and performance for their specific use case.

The zero-dependency philosophy ensures long-term stability and security, while the modular design makes it easy to extend and customize the framework for specific needs.