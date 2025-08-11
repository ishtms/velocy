# Velocy

<div align="center">
  <img src="https://raw.githubusercontent.com/ishtms/velocy/0400965766a9be07cf04d8a7bd44c2d3811e8569/assets/benchmark.webp" alt="Velocy Benchmark" />
  
  **A blazing fast, zero-dependency HTTP framework for Node.js**
  
  [![npm version](https://img.shields.io/npm/v/velocy.svg)](https://www.npmjs.com/package/velocy)
  [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
</div>

## Features

- 🚀 **Blazing Fast** - Radix tree-based router with performance optimizations
- 📦 **Zero Dependencies** - Built entirely with Node.js built-in modules
- 🛣️ **Advanced Routing** - Dynamic parameters, wildcards, and pattern matching
- 🔌 **WebSocket Support** - Full WebSocket implementation with rooms and broadcasting
- 🎯 **Middleware System** - Express-style middleware with async support
- 🎨 **Template Engines** - Built-in template engine support with caching
- 🔒 **Security Features** - CORS, rate limiting, session management, and validation
- 📊 **Performance Monitoring** - Built-in performance tracking and optimization
- 🗜️ **Compression** - Gzip, deflate, and brotli compression support
- 🍪 **Cookie Management** - Cookie parsing and signing capabilities

## Installation

```bash
npm install velocy
# or
yarn add velocy
# or
pnpm add velocy
```

## Quick Start

```javascript
const { Router, createServer } = require("velocy");

const app = new Router();

// Basic route
app.get("/", (req, res) => {
  res.json({ message: "Hello, Velocy!" });
});

// Dynamic parameters
app.get("/users/:id", (req, res) => {
  res.json({ userId: req.params.id });
});

// Start server
createServer(app).listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});
```

## Table of Contents

- [Routing](#routing)
- [Middleware](#middleware)
- [Request & Response](#request--response)
- [WebSockets](#websockets)
- [Template Engines](#template-engines)
- [Static Files](#static-files)
- [Body Parsing](#body-parsing)
- [Cookies](#cookies)
- [Sessions](#sessions)
- [CORS](#cors)
- [Compression](#compression)
- [Rate Limiting](#rate-limiting)
- [Validation](#validation)
- [Performance Optimization](#performance-optimization)
- [API Reference](#api-reference)

## Routing

### Basic Routing

```javascript
const { Router } = require("velocy");
const app = new Router();

// HTTP methods
app.get("/users", (req, res) => res.json({ users: [] }));
app.post("/users", (req, res) => res.json({ created: true }));
app.put("/users/:id", (req, res) => res.json({ updated: req.params.id }));
app.delete("/users/:id", (req, res) => res.json({ deleted: req.params.id }));
app.patch("/users/:id", (req, res) => res.json({ patched: req.params.id }));

// Route chaining
app.get("/posts", listPosts).post("/posts", createPost).get("/posts/:id", getPost);
```

### Dynamic Parameters

```javascript
// Single parameter
app.get("/users/:id", (req, res) => {
  res.json({ userId: req.params.id });
});

// Multiple parameters
app.get("/users/:userId/posts/:postId", (req, res) => {
  res.json({
    userId: req.params.userId,
    postId: req.params.postId,
  });
});

// Optional parameters with wildcards
app.get("/files/*", (req, res) => {
  res.json({ file: req.params["*"] });
});
```

### Wildcards

```javascript
// Single-segment wildcard (*)
app.get("/static/*.js", (req, res) => {
  res.json({ jsFile: req.params["*"] });
});

// Multi-segment wildcard (**)
app.get("/api/**", (req, res) => {
  res.json({ path: req.params["**"] });
});

// Named wildcards
app.get("/assets/*filename", (req, res) => {
  res.json({ filename: req.params.filename });
});
```

### Router Merging and Nesting

```javascript
// Create modular routers
const userRouter = new Router();
userRouter.get("/profile", getUserProfile);
userRouter.post("/settings", updateSettings);

const apiRouter = new Router();
apiRouter.get("/status", getApiStatus);

// Merge routers
const mainRouter = new Router();
mainRouter.merge(userRouter);
mainRouter.merge(apiRouter);

// Nest routers with prefix
const app = new Router();
app.nest("/api/v1", mainRouter);
// Routes available at: /api/v1/profile, /api/v1/settings, /api/v1/status
```

### Route Debugging

```javascript
// Print the route tree for debugging
app.printTree();
// Outputs a visual representation of all registered routes
```

## Middleware

### Global Middleware

```javascript
const { Router, bodyParser, cookieParser } = require("velocy");
const app = new Router();

// Apply middleware globally
app.use(cookieParser());
app.use(bodyParser.json());

// Custom middleware
app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

// Async middleware
app.use(async (req, res, next) => {
  await authenticateUser(req);
  next();
});
```

### Path-Specific Middleware

```javascript
// Apply middleware to specific paths
app.use("/admin", authenticateAdmin);
app.use("/api", rateLimiter);

// Multiple middleware
app.use("/protected", [authenticate, authorize, logAccess]);
```

### Error Handling Middleware

```javascript
// Error middleware (4 parameters)
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.statusCode || 500).json({
    error: err.message || "Internal Server Error",
  });
});
```

## Request & Response

### Enhanced Request Object

```javascript
app.get("/example", (req, res) => {
  // URL and query parsing
  console.log(req.url); // Full URL
  console.log(req.path); // Path without query
  console.log(req.query); // Parsed query parameters

  // Headers
  console.log(req.headers); // All headers
  console.log(req.get("content-type")); // Get specific header

  // Content negotiation
  console.log(req.accepts("json")); // Check if client accepts JSON
  console.log(req.acceptsEncodings(["gzip", "deflate"]));
  console.log(req.acceptsLanguages(["en", "es"]));

  // Request info
  console.log(req.ip); // Client IP
  console.log(req.protocol); // http or https
  console.log(req.secure); // Is HTTPS?
  console.log(req.xhr); // Is AJAX request?

  // Cookies (with cookieParser middleware)
  console.log(req.cookies); // Parsed cookies
  console.log(req.signedCookies); // Signed cookies
});
```

### Enhanced Response Object

```javascript
app.get("/example", (req, res) => {
  // JSON response
  res.json({ success: true });

  // Status codes
  res.status(201).json({ created: true });

  // Redirects
  res.redirect("/new-location");
  res.redirect(301, "/permanent-redirect");

  // Headers
  res.set("X-Custom-Header", "value");
  res.set({
    "X-Header-1": "value1",
    "X-Header-2": "value2",
  });

  // Cookies
  res.cookie("session", "abc123", {
    maxAge: 900000,
    httpOnly: true,
    secure: true,
    sameSite: "strict",
  });

  // File sending
  res.sendFile("/path/to/file.pdf");
  res.download("/path/to/file.pdf", "custom-name.pdf");

  // Content type
  res.type("html").send("<h1>Hello</h1>");
  res.type("text/plain").send("Plain text");
});
```

## WebSockets

### WebSocket Server Setup

```javascript
const { Router, createServer } = require("velocy");

const app = new Router({
  websocket: {
    heartbeatInterval: 30000, // Ping every 30 seconds
    heartbeatTimeout: 60000, // Close if no pong in 60 seconds
    maxPayloadSize: 10 * 1024 * 1024, // 10MB max message size
    enableQueue: true, // Queue messages for offline clients
    maxQueueSize: 100, // Max queued messages per client
  },
});

// WebSocket routes
app.ws("/chat", (ws, req) => {
  console.log("New WebSocket connection");

  ws.on("message", (data) => {
    // Echo message back
    ws.send(JSON.stringify({ echo: data }));
  });

  ws.on("close", () => {
    console.log("Connection closed");
  });
});

createServer(app).listen(3000);
```

### WebSocket Rooms and Broadcasting

```javascript
// Join/leave rooms
app.ws("/chat", (ws, req) => {
  // Join a room
  ws.join("general");

  ws.on("message", (data) => {
    const msg = JSON.parse(data);

    if (msg.type === "join") {
      ws.join(msg.room);
      ws.send(JSON.stringify({ joined: msg.room }));
    }

    if (msg.type === "leave") {
      ws.leave(msg.room);
      ws.send(JSON.stringify({ left: msg.room }));
    }

    if (msg.type === "broadcast") {
      // Broadcast to all in room
      app.wsRouter.broadcast(
        msg.room,
        JSON.stringify({
          from: ws.id,
          message: msg.text,
        })
      );
    }
  });
});

// Broadcast to all connected clients
app.wsRouter.broadcastAll(JSON.stringify({ announcement: "Server message" }));

// Get room information
const roomClients = app.wsRouter.getRoom("general");
const allRooms = app.wsRouter.getRooms();
```

## Template Engines

### Built-in Template Engine

```javascript
const { Router, createServer } = require("velocy");
const app = new Router();

// Configure views
app.set("views", "./views");
app.set("view engine", "html");
app.set("view cache", true); // Enable caching in production

// Render templates
app.get("/", (req, res) => {
  res.render("index", {
    title: "Velocy App",
    user: { name: "John" },
  });
});

// With layout
app.get("/about", (req, res) => {
  res.render("about", {
    title: "About Us",
    layout: "layouts/main",
  });
});
```

### Custom Template Engines

```javascript
// Register a custom engine
app.engine("ejs", {
  compile: (template, options) => {
    // Return compiled function
    return (locals) => {
      // Render template with locals
      return renderedHtml;
    };
  },
});

// Use the custom engine
app.set("view engine", "ejs");
```

## Static Files

### Serving Static Files

```javascript
const { Router, static: staticMiddleware } = require("velocy");
const app = new Router();

// Serve static files from 'public' directory
app.use(
  "/static",
  staticMiddleware("./public", {
    index: "index.html", // Default file
    dotfiles: "ignore", // How to handle dotfiles
    etag: true, // Enable ETags
    lastModified: true, // Send Last-Modified header
    maxAge: "1d", // Cache control max-age
    immutable: true, // Add immutable directive
    fallthrough: true, // Pass to next middleware if not found
    acceptRanges: true, // Enable range requests
    cacheControl: true, // Send Cache-Control header

    // Custom headers
    setHeaders: (res, path, stat) => {
      if (path.endsWith(".pdf")) {
        res.set("Content-Disposition", "attachment");
      }
    },
  })
);

// Multiple static directories
app.use("/assets", staticMiddleware("./assets"));
app.use("/downloads", staticMiddleware("./files"));
```

## Body Parsing

### JSON and URL-encoded

```javascript
const { Router, bodyParser } = require("velocy");
const app = new Router();

// Parse JSON bodies
app.use(
  bodyParser.json({
    limit: "10mb", // Size limit
    strict: true, // Only accept arrays and objects
    reviver: null, // JSON.parse reviver function
    type: "application/json", // Content-type to parse
  })
);

// Parse URL-encoded bodies
app.use(
  bodyParser.urlencoded({
    extended: true, // Use querystring library
    limit: "10mb", // Size limit
    parameterLimit: 1000, // Max number of parameters
    type: "application/x-www-form-urlencoded",
  })
);

// Access parsed body
app.post("/users", (req, res) => {
  console.log(req.body); // Parsed body
  res.json({ received: req.body });
});
```

### Multipart Form Data

```javascript
// Parse multipart form data
app.use(
  bodyParser.multipart({
    uploadDir: "./uploads", // Directory for file uploads
    keepExtensions: true, // Keep file extensions
    maxFileSize: 10 * 1024 * 1024, // 10MB max file size
    maxFields: 1000, // Max number of fields
    maxFieldsSize: 20 * 1024 * 1024, // 20MB max for all fields
    hash: "md5", // Calculate file hash
    multiples: true, // Parse multiple files

    // File filter
    fileFilter: (part) => {
      // Only accept images
      return part.mimetype.startsWith("image/");
    },
  })
);

// Handle file uploads
app.post("/upload", (req, res) => {
  console.log(req.body); // Form fields
  console.log(req.files); // Uploaded files

  res.json({
    fields: req.body,
    files: req.files,
  });
});
```

### Raw Body

```javascript
// Parse raw body
app.use(
  bodyParser.raw({
    type: "application/octet-stream",
    limit: "10mb",
  })
);

// Parse text body
app.use(
  bodyParser.text({
    type: "text/plain",
    defaultCharset: "utf-8",
    limit: "1mb",
  })
);
```

## Cookies

### Cookie Parsing and Setting

```javascript
const { Router, cookieParser } = require("velocy");
const app = new Router();

// Enable cookie parsing with optional secret for signed cookies
app.use(cookieParser("optional-secret-key"));

// Read cookies
app.get("/cookies", (req, res) => {
  console.log(req.cookies); // Regular cookies
  console.log(req.signedCookies); // Signed cookies

  res.json({
    cookies: req.cookies,
    signed: req.signedCookies,
  });
});

// Set cookies
app.get("/set-cookie", (req, res) => {
  // Simple cookie
  res.cookie("name", "value");

  // Cookie with options
  res.cookie("session", "abc123", {
    domain: ".example.com", // Cookie domain
    path: "/", // Cookie path
    secure: true, // HTTPS only
    httpOnly: true, // Not accessible via JavaScript
    maxAge: 900000, // Max age in milliseconds
    expires: new Date(Date.now() + 900000), // Expiration date
    sameSite: "strict", // CSRF protection
    signed: true, // Sign the cookie
  });

  res.json({ set: true });
});

// Clear cookies
app.get("/clear-cookie", (req, res) => {
  res.clearCookie("name");
  res.clearCookie("session", { path: "/" });
  res.json({ cleared: true });
});
```

## Sessions

### Session Management

```javascript
const { Router, session } = require("velocy");
const app = new Router();

// Configure sessions
app.use(
  session({
    secret: "keyboard-cat", // Secret for signing session ID
    resave: false, // Don't save unchanged sessions
    saveUninitialized: false, // Don't create empty sessions
    rolling: true, // Reset expiry on activity

    cookie: {
      secure: true, // HTTPS only
      httpOnly: true, // Not accessible via JavaScript
      maxAge: 1000 * 60 * 60, // 1 hour
      sameSite: "strict", // CSRF protection
    },

    name: "sessionId", // Cookie name
    genid: () => generateId(), // Custom ID generator

    store: new MemoryStore({
      // Session store (default: memory)
      checkPeriod: 86400000, // Prune expired entries every 24h
    }),
  })
);

// Use sessions
app.get("/login", (req, res) => {
  req.session.userId = 123;
  req.session.username = "john";
  res.json({ logged_in: true });
});

app.get("/profile", (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Not logged in" });
  }

  res.json({
    userId: req.session.userId,
    username: req.session.username,
  });
});

app.get("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: "Could not log out" });
    }
    res.json({ logged_out: true });
  });
});
```

## CORS

### Cross-Origin Resource Sharing

```javascript
const { Router, cors } = require("velocy");
const app = new Router();

// Enable CORS with default settings
app.use(cors());

// Custom CORS configuration
app.use(
  cors({
    origin: "https://example.com", // Allowed origin
    // or multiple origins
    origin: ["https://example.com", "https://app.example.com"],
    // or dynamic origin
    origin: (origin, callback) => {
      if (isAllowed(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },

    methods: ["GET", "POST", "PUT", "DELETE"], // Allowed methods
    allowedHeaders: ["Content-Type", "Authorization"], // Allowed headers
    exposedHeaders: ["Content-Length", "X-Token"], // Headers exposed to client
    credentials: true, // Allow credentials
    maxAge: 86400, // Preflight cache duration
    preflightContinue: false, // Pass preflight to next handler
    optionsSuccessStatus: 204, // Status for successful OPTIONS
  })
);

// CORS for specific routes
app.get("/api/public", cors(), handler);

// Different CORS per route
const corsOptions = {
  origin: "https://trusted.com",
  credentials: true,
};
app.get("/api/private", cors(corsOptions), handler);
```

## Compression

### Response Compression

```javascript
const { Router, compression } = require("velocy");
const app = new Router();

// Enable compression with default settings
app.use(compression());

// Custom compression configuration
app.use(
  compression({
    threshold: 1024, // Min size to compress (bytes)
    level: 6, // Compression level (0-9)
    memLevel: 8, // Memory level (1-9)
    strategy: 0, // Compression strategy
    chunkSize: 16384, // Chunk size
    windowBits: 15, // Window bits

    filter: (req, res) => {
      // Custom logic to determine if response should be compressed
      if (req.headers["x-no-compression"]) {
        return false;
      }
      return compression.filter(req, res);
    },

    // Brotli options
    brotli: {
      enabled: true,
      quality: 4, // Brotli quality (0-11)
      lgwin: 22, // Brotli window size
    },
  })
);
```

## Rate Limiting

### Request Rate Limiting

```javascript
const { Router, rateLimit } = require("velocy");
const app = new Router();

// Basic rate limiting
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Max 100 requests per window
    message: "Too many requests", // Error message
    statusCode: 429, // Error status code
    headers: true, // Send rate limit headers
    skipSuccessfulRequests: false, // Count all requests
    skipFailedRequests: false, // Count failed requests

    // Custom key generator
    keyGenerator: (req) => {
      return req.ip; // Default: use IP address
    },

    // Custom handler
    handler: (req, res) => {
      res.status(429).json({
        error: "Too many requests",
        retryAfter: req.rateLimit.resetTime,
      });
    },

    // Skip certain requests
    skip: (req) => {
      return req.ip === "127.0.0.1";
    },
  })
);

// Different limits for different routes
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  skipSuccessfulRequests: true,
});

app.use("/api", apiLimiter);
app.use("/auth/login", authLimiter);
```

## Validation

### Request Validation

```javascript
const { Router, validator } = require("velocy");
const app = new Router();

// Validate request body
app.post(
  "/users",
  validator.body({
    username: {
      type: "string",
      required: true,
      minLength: 3,
      maxLength: 20,
      pattern: /^[a-zA-Z0-9_]+$/,
    },
    email: {
      type: "string",
      required: true,
      format: "email",
    },
    age: {
      type: "number",
      min: 18,
      max: 120,
    },
    roles: {
      type: "array",
      items: {
        type: "string",
        enum: ["user", "admin", "moderator"],
      },
    },
  }),
  (req, res) => {
    // Request body is validated
    res.json({ user: req.body });
  }
);

// Validate query parameters
app.get(
  "/search",
  validator.query({
    q: {
      type: "string",
      required: true,
      minLength: 1,
    },
    limit: {
      type: "number",
      default: 10,
      min: 1,
      max: 100,
    },
    offset: {
      type: "number",
      default: 0,
      min: 0,
    },
  }),
  (req, res) => {
    res.json({ results: [] });
  }
);

// Validate route parameters
app.get(
  "/users/:id",
  validator.params({
    id: {
      type: "string",
      pattern: /^[0-9a-f]{24}$/, // MongoDB ObjectId
    },
  }),
  (req, res) => {
    res.json({ userId: req.params.id });
  }
);

// Custom validation
app.post(
  "/register",
  validator.custom(async (req) => {
    if (req.body.password !== req.body.confirmPassword) {
      throw new Error("Passwords do not match");
    }

    const userExists = await checkUserExists(req.body.email);
    if (userExists) {
      throw new Error("Email already registered");
    }

    return true;
  }),
  (req, res) => {
    res.json({ registered: true });
  }
);

// Sanitization
app.post(
  "/comment",
  validator.body({
    text: {
      type: "string",
      required: true,
      sanitize: {
        trim: true,
        escape: true,
        lowercase: false,
      },
    },
  }),
  (req, res) => {
    res.json({ comment: req.body.text });
  }
);
```

## Performance Optimization

### Enable Performance Features

```javascript
const { Router } = require("velocy");

// Create router with performance optimizations
const app = new Router({
  // Caching
  cache: true, // Enable route caching
  routeCacheSize: 1000, // Cache up to 1000 routes
  urlCacheSize: 500, // Cache up to 500 parsed URLs

  // Performance monitoring
  performance: {
    enabled: true, // Enable performance tracking
    windowSize: 60000, // 1-minute window for metrics
  },

  // Object pooling
  enablePooling: true, // Enable object pooling
  poolSize: 100, // Pool size for reusable objects

  // Other optimizations
  trustProxy: true, // Trust proxy headers
  caseSensitive: false, // Case-insensitive routing
  mergeParams: true, // Merge params from parent router
  strict: false, // Non-strict routing (trailing slash)
});

// Monitor performance
app.on("performance", (metrics) => {
  console.log("Requests/sec:", metrics.requestsPerSecond);
  console.log("Avg response time:", metrics.avgResponseTime);
  console.log("Cache hit rate:", metrics.cacheHitRate);
});

// Performance hooks
app.hook("beforeRoute", (req) => {
  req.startTime = Date.now();
});

app.hook("afterRoute", (req, res) => {
  const duration = Date.now() - req.startTime;
  res.set("X-Response-Time", `${duration}ms`);
});
```

### Benchmarking

```javascript
// Run benchmarks
const { benchmark } = require("velocy/benchmark");

benchmark({
  routes: app,
  requests: 10000,
  concurrent: 100,
  warmup: 1000,
}).then((results) => {
  console.log("Throughput:", results.throughput);
  console.log("Latency p50:", results.latency.p50);
  console.log("Latency p99:", results.latency.p99);
});
```

## API Reference

### Router Class

```javascript
class Router {
  // HTTP methods
  get(path, ...handlers)
  post(path, ...handlers)
  put(path, ...handlers)
  delete(path, ...handlers)
  patch(path, ...handlers)
  head(path, ...handlers)
  options(path, ...handlers)
  all(path, ...handlers)

  // Middleware
  use(...middleware)
  use(path, ...middleware)

  // Router composition
  merge(router)
  nest(prefix, router)

  // WebSocket
  ws(path, handler)

  // Settings
  set(setting, value)
  get(setting)
  enable(setting)
  disable(setting)
  enabled(setting)
  disabled(setting)

  // Template engines
  engine(ext, engine)
  render(view, locals, callback)

  // Events
  on(event, handler)
  off(event, handler)
  emit(event, ...args)

  // Utilities
  printTree()
  getRoutes()
  clearCache()
}
```

### Request Object

```javascript
interface Request {
  // Properties
  app: Router
  baseUrl: string
  body: any
  cookies: object
  fresh: boolean
  hostname: string
  ip: string
  ips: string[]
  method: string
  originalUrl: string
  params: object
  path: string
  protocol: string
  query: object
  route: object
  secure: boolean
  signedCookies: object
  stale: boolean
  subdomains: string[]
  xhr: boolean

  // Methods
  accepts(types: string|string[]): string|false
  acceptsCharsets(charsets: string|string[]): string|false
  acceptsEncodings(encodings: string|string[]): string|false
  acceptsLanguages(languages: string|string[]): string|false
  get(header: string): string
  is(type: string|string[]): string|false
  range(size: number): object|number|string
}
```

### Response Object

```javascript
interface Response {
  // Properties
  app: Router
  headersSent: boolean
  locals: object
  statusCode: number
  statusMessage: string

  // Methods
  append(header: string, value: string|string[]): Response
  attachment(filename?: string): Response
  clearCookie(name: string, options?: object): Response
  contentType(type: string): Response
  cookie(name: string, value: any, options?: object): Response
  download(path: string, filename?: string, callback?: Function): void
  end(data?: any, encoding?: string): void
  format(object: object): Response
  get(header: string): string
  json(object: any): Response
  jsonp(object: any): Response
  links(links: object): Response
  location(url: string): Response
  redirect(status?: number, url?: string): void
  render(view: string, locals?: object, callback?: Function): void
  send(body: any): Response
  sendFile(path: string, options?: object, callback?: Function): void
  sendStatus(statusCode: number): Response
  set(header: string|object, value?: string): Response
  status(statusCode: number): Response
  type(type: string): Response
  vary(header: string): Response
}
```

## Examples

### Complete Application Example

```javascript
const {
  Router,
  createServer,
  bodyParser,
  cookieParser,
  session,
  cors,
  compression,
  rateLimit,
  static: staticMiddleware,
} = require("velocy");

// Create app with optimizations
const app = new Router({
  cache: true,
  performance: true,
});

// Global middleware
app.use(compression());
app.use(cors());
app.use(cookieParser("secret"));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(
  session({
    secret: "keyboard cat",
    resave: false,
    saveUninitialized: false,
  })
);

// Rate limiting
app.use(
  "/api",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
  })
);

// Static files
app.use("/public", staticMiddleware("./public"));

// View engine
app.set("views", "./views");
app.set("view engine", "html");

// Routes
app.get("/", (req, res) => {
  res.render("index", { title: "Home" });
});

app.get("/api/users", (req, res) => {
  res.json({ users: [] });
});

app.post("/api/users", (req, res) => {
  // Create user
  res.status(201).json({ created: true });
});

// WebSocket
app.ws("/ws", (ws, req) => {
  ws.on("message", (msg) => {
    ws.send(`Echo: ${msg}`);
  });
});

// Error handling
app.use((err, req, res, next) => {
  res.status(500).json({ error: err.message });
});

// Start server
const server = createServer(app);
server.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});
```

## Performance Benchmarks

Velocy is designed for maximum performance with zero dependencies. Here are benchmark results comparing Velocy to other popular frameworks:

![Benchmark Results](/assets/benchmark.webp)

- **Requests/sec**: 50,000+ on standard hardware
- **Latency**: Sub-millisecond response times
- **Memory**: Minimal memory footprint
- **Startup**: Fast cold start times

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT © [Ishtmeet Singh](https://github.com/ishtms)

## Support

- 📧 Email: ish.rissam@gmail.com
- 🐛 Issues: [GitHub Issues](https://github.com/ishtms/velocy/issues)
- 💬 Discussions: [GitHub Discussions](https://github.com/ishtms/velocy/discussions)

## Links

- [GitHub Repository](https://github.com/ishtms/velocy)
- [NPM Package](https://www.npmjs.com/package/velocy)
- [Documentation](https://github.com/ishtms/velocy#readme)

---

<div align="center">
  Made with ❤️ by the Velocy team
</div>
