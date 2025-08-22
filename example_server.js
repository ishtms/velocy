/**
 * Velocy Framework - Comprehensive Example Server
 *
 * This example demonstrates EVERY feature of the Velocy framework.
 * Visit http://localhost:4000 for interactive documentation and testing.
 *
 * @author Velocy Framework
 * @version 1.0.0
 */

const path = require("path");
const fs = require("fs").promises;
const crypto = require("crypto");

// Import ALL Velocy features
const {
  // Core Routers
  Router,
  FastRouter,
  SimpleRouter,
  WebSocketRouter,

  // WebSocket Classes
  WebSocketConnection,
  WebSocketServer,
  WS_OPCODES,
  WS_CLOSE_CODES,
  WS_STATES,

  // Core Classes
  Request,
  Response,

  // Middleware
  bodyParser,
  cors,
  cookieParser,
  static: staticMiddleware,
  compression,
  rateLimit,
  session,
  validator,
  validate,

  // Utilities
  createServer,
  buildQueryString,
  websocketUtils,
} = require("./index");

// ==================== CONFIGURATION ====================

const PORT = process.env.PORT || 4000;
const SESSION_SECRET = "velocy-example-secret-key-2024";
const COOKIE_SECRET = "velocy-cookie-secret-key-2024";

// ==================== INITIALIZE ROUTERS ====================

// Main router with all features enabled
const app = new Router({
  performance: true, // Enable performance monitoring
  cache: true, // Enable route caching
  routeCacheSize: 1000, // Route cache size
  urlCacheSize: 500, // URL parsing cache size
  cookieSecret: COOKIE_SECRET,
  websocket: {
    enableQueue: true,
    maxQueueSize: 100,
    heartbeatInterval: 30000,
    heartbeatTimeout: 60000,
    maxPayloadSize: 10 * 1024 * 1024, // 10MB
  },
});

// Create additional routers for demonstration
const fastRouter = new FastRouter();
const simpleRouter = new SimpleRouter();

// ==================== GLOBAL MIDDLEWARE ====================

// 1. CORS - Cross-Origin Resource Sharing
app.use(
  cors({
    origin: (origin, callback) => {
      // Custom origin validation
      const allowedOrigins = ["http://localhost:4000", "http://localhost:3000"];
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"],
    allowedHeaders: ["Content-Type", "Authorization", "X-API-Key", "X-Custom-Header"],
    exposedHeaders: ["X-Total-Count", "X-Page-Count"],
    credentials: true,
    maxAge: 86400, // 24 hours
    optionsSuccessStatus: 204,
  }),
);

// 2. Compression - Response compression
app.use(
  compression({
    threshold: 1024, // Only compress responses > 1KB
    level: 6, // Compression level (0-9)
    filter: (req, res) => {
      // Custom filter function - don't compress if client requests no compression
      if (req.headers["x-no-compression"]) {
        return false;
      }
      // Compress for typical text-based content types
      const contentType = res.getHeader("Content-Type") || "";
      return /json|text|javascript|css|html|xml/.test(contentType);
    },
  }),
);

app.get("/plaintext", (req, res) => res.send("hello, world."));

// 3. Cookie Parser - Parse and sign cookies
app.use(cookieParser(COOKIE_SECRET));

// 4. Session Management
app.use(
  session({
    secret: SESSION_SECRET,
    name: "velocy.sid",
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      secure: false, // Set to true in production with HTTPS
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24, // 24 hours
      sameSite: "lax",
    },
    genid: () => {
      return "sess_" + crypto.randomBytes(16).toString("hex");
    },
  }),
);

// 5. Body Parser - Parse all content types
app.use(
  bodyParser({
    // JSON parsing
    json: true,
    jsonLimit: "10mb",
    strict: true,
    reviver: (key, value) => {
      // Custom JSON reviver
      if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
        return new Date(value);
      }
      return value;
    },

    // URL-encoded parsing
    urlencoded: true,
    urlencodedLimit: "10mb",
    extended: true,
    parameterLimit: 10000,

    // Multipart parsing (for file uploads)
    multipart: true,
    multipartLimit: "50mb",
    fileMemoryLimit: "5mb",
    maxFileSize: "50mb",

    // Text parsing
    text: true,
    textLimit: "1mb",

    // Raw parsing
    raw: false, // Disable raw parsing to let multipart handle file uploads
  }),
);

// 6. Custom logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  const originalEnd = res.end;

  // Track response
  res.end = function (...args) {
    const duration = Date.now() - start;
    const size = res.getHeader("content-length") || 0;

    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} - ${res.statusCode} (${duration}ms) ${size}B`);

    // Call original end
    originalEnd.apply(res, args);
  };

  next();
});

// 7. Request ID middleware
app.use((req, res, next) => {
  req.id = crypto.randomBytes(8).toString("hex");
  res.set("X-Request-ID", req.id);
  next();
});

// 8. Track request count
app.use((req, res, next) => {
  const count = app.getSetting("requestCount") || 0;
  app.set("requestCount", count + 1);
  next();
});

// ==================== IN-MEMORY DATA STORE ====================

const dataStore = {
  users: new Map([
    [1, { id: 1, name: "Admin User", email: "admin@velocy.com", role: "admin", createdAt: new Date("2024-01-01") }],
    [2, { id: 2, name: "John Doe", email: "john@example.com", role: "user", createdAt: new Date("2024-01-15") }],
    [3, { id: 3, name: "Jane Smith", email: "jane@example.com", role: "moderator", createdAt: new Date("2024-02-01") }],
  ]),
  posts: new Map(),
  files: new Map(),
  websocketClients: new Map(),
  messageHistory: [],
  apiKeys: new Map([["demo-api-key-123", { name: "Demo API Key", permissions: ["read", "write"] }]]),
};

let nextUserId = 4;
let nextPostId = 1;

// ==================== VIEW ENGINE CONFIGURATION ====================

// Import ViewEngine
const ViewEngine = require("./lib/utils/viewEngine");

// Configure view engine settings
app.set("views", path.join(__dirname, "views"));
app.set("view cache", process.env.NODE_ENV === "production");

// Register the simple template engine for .html files
app.engine("html", ViewEngine.simpleEngine());

// Set app-wide locals for templates
app.viewEngine.locals.version = "v1.0.0";
app.viewEngine.locals.appName = "Velocy Framework";

// ==================== STATIC FILE SERVING ====================

// Serve CSS files
app.use(
  "/css",
  staticMiddleware(path.join(__dirname, "public/css"), {
    maxAge: process.env.NODE_ENV === "production" ? "7d" : 0,
    etag: true,
    lastModified: true,
    dotfiles: "ignore",
  }),
);

// Serve JS files
app.use(
  "/js",
  staticMiddleware(path.join(__dirname, "public/js"), {
    maxAge: process.env.NODE_ENV === "production" ? "7d" : 0,
    etag: true,
    lastModified: true,
    dotfiles: "ignore",
  }),
);

// Serve image files
app.use(
  "/images",
  staticMiddleware(path.join(__dirname, "public/images"), {
    maxAge: process.env.NODE_ENV === "production" ? "30d" : 0,
    etag: true,
    lastModified: true,
    dotfiles: "ignore",
  }),
);

// Also serve from /public for backward compatibility
app.use(
  "/public",
  staticMiddleware(path.join(__dirname, "public"), {
    maxAge: "1d",
    etag: true,
    lastModified: true,
    index: ["index.html", "index.htm"],
    dotfiles: "ignore",
    extensions: ["html", "css", "js", "json"],
  }),
);

// ==================== ROOT DOCUMENTATION ROUTE ====================

app.get("/", (req, res) => {
  // Track page views in session
  if (!req.session.views) {
    req.session.views = 0;
  }
  req.session.views++;

  // Prepare data for template
  const templateData = {
    title: "Velocy Framework Demo",
    description: "High-Performance Node.js Web Framework with Express Compatibility",
    serverTime: new Date().toLocaleString(),
    session: req.session,
    version: app.viewEngine.locals.version,

    // Features for the grid
    features: [
      { icon: "⚡", title: "High Performance", description: "Optimized for speed with route caching and object pooling" },
      { icon: "🔌", title: "WebSocket Support", description: "Built-in WebSocket server with rooms and broadcasting" },
      { icon: "🛡️", title: "Security", description: "CORS, rate limiting, and secure session management" },
      { icon: "📦", title: "Middleware", description: "Rich ecosystem of built-in middleware" },
      { icon: "🎨", title: "Template Engine", description: "Flexible view rendering with multiple engine support" },
      { icon: "📁", title: "Static Files", description: "Efficient static file serving with caching" },
    ],

    // Endpoints for documentation
    endpoints: {
      crud: [
        { method: "get", path: "/api/users", description: "List all users with pagination" },
        { method: "post", path: "/api/users", description: "Create a new user" },
        { method: "put", path: "/api/users/:id", description: "Update user by ID" },
        { method: "patch", path: "/api/users/:id", description: "Partial update user" },
        { method: "delete", path: "/api/users/:id", description: "Delete user by ID" },
      ],
      request: [
        { method: "get", path: "/demo/request-info", description: "Shows all request properties" },
        { method: "get", path: "/demo/params/:id/:action", description: "Route parameters demo" },
        { method: "get", path: "/demo/query", description: "Query string parsing" },
      ],
      response: [
        { method: "get", path: "/demo/json", description: "JSON response" },
        { method: "get", path: "/demo/redirect", description: "Redirect demo" },
        { method: "get", path: "/demo/stream", description: "Streaming response" },
      ],
    },

    // Statistics
    stats: {
      requests: app.getSetting("requestCount") || 0,
      routes: app.getRoutesCount ? app.getRoutesCount() : "N/A",
      uptime: process.uptime().toFixed(0) + "s",
      memory: (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2) + " MB",
    },
  };

  // Render the template
  res.render("index.html", templateData);
});

// ==================== ALL HTTP METHODS DEMONSTRATION ====================

// GET method
app.get("/api/users", (req, res) => {
  const { page = 1, limit = 10, sort = "id", order = "asc", search } = req.query;

  let users = Array.from(dataStore.users.values());

  // Search
  if (search) {
    users = users.filter(
      (u) => u.name.toLowerCase().includes(search.toLowerCase()) || u.email.toLowerCase().includes(search.toLowerCase()),
    );
  }

  // Sort
  users.sort((a, b) => {
    const aVal = a[sort];
    const bVal = b[sort];
    return order === "asc" ? (aVal > bVal ? 1 : -1) : aVal < bVal ? 1 : -1;
  });

  // Paginate
  const startIndex = (page - 1) * limit;
  const endIndex = startIndex + parseInt(limit);
  const paginatedUsers = users.slice(startIndex, endIndex);

  res.set("X-Total-Count", users.length.toString());
  res.set("X-Page-Count", Math.ceil(users.length / limit).toString());

  res.json({
    data: paginatedUsers,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total: users.length,
      totalPages: Math.ceil(users.length / limit),
    },
  });
});

// POST method with validation
app.post(
  "/api/users",
  validator({
    body: {
      name: { type: "string", required: true, minLength: 2, maxLength: 50 },
      email: { type: "email", required: true },
      role: { type: "string", enum: ["admin", "user", "moderator"], default: "user" },
      age: { type: "number", min: 0, max: 150 },
      tags: { type: "array", items: { type: "string" }, maxItems: 10 },
    },
  }),
  (req, res) => {
    const user = {
      id: nextUserId++,
      ...req.body,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    dataStore.users.set(user.id, user);

    res.status(201).json({
      message: "User created successfully",
      user,
    });
  },
);

// PUT method - Full update
app.put("/api/users/:id", (req, res) => {
  const id = parseInt(req.params.id);
  const user = dataStore.users.get(id);

  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  const updatedUser = {
    id,
    ...req.body,
    createdAt: user.createdAt,
    updatedAt: new Date(),
  };

  dataStore.users.set(id, updatedUser);
  res.json(updatedUser);
});

// PATCH method - Partial update
app.patch("/api/users/:id", (req, res) => {
  const id = parseInt(req.params.id);
  const user = dataStore.users.get(id);

  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  const updatedUser = {
    ...user,
    ...req.body,
    id, // Prevent ID change
    updatedAt: new Date(),
  };

  dataStore.users.set(id, updatedUser);
  res.json(updatedUser);
});

// DELETE method
app.delete("/api/users/:id", (req, res) => {
  const id = parseInt(req.params.id);

  if (!dataStore.users.has(id)) {
    return res.status(404).json({ error: "User not found" });
  }

  const user = dataStore.users.get(id);
  dataStore.users.delete(id);

  res.json({
    message: "User deleted successfully",
    user,
  });
});

// HEAD method
app.head("/api/users/:id", (req, res) => {
  const id = parseInt(req.params.id);

  if (!dataStore.users.has(id)) {
    res.status(404).end();
  } else {
    res.status(200).end();
  }
});

// OPTIONS method
app.options("/api/users", (req, res) => {
  res.set("Allow", "GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS");
  res.set("X-Accepted-Methods", "GET, POST, PUT, PATCH, DELETE");
  res.status(204).end();
});

// ALL method - Handles all HTTP methods
app.all("/api/echo", (req, res) => {
  res.json({
    method: req.method,
    path: req.path,
    headers: req.headers,
    query: req.query,
    body: req.body,
    params: req.params,
    cookies: req.cookies,
    signedCookies: req.signedCookies,
    ip: req.ip,
    hostname: req.hostname,
    protocol: req.protocol,
    secure: req.secure,
    xhr: req.xhr,
  });
});

// Minimal echo endpoint - returns only essential information
app.all("/api/echo/minimal", (req, res) => {
  res.json({
    method: req.method,
    path: req.path,
    query: req.query,
    body: req.body,
    params: req.params,
  });
});

// ==================== REQUEST OBJECT FEATURES ====================

app.get("/demo/request-info", (req, res) => {
  res.json({
    // All request properties
    method: req.method,
    url: req.url,
    path: req.path,
    query: req.query,
    params: req.params,
    headers: req.headers,
    cookies: req.cookies,
    signedCookies: req.signedCookies,
    body: req.body,
    ip: req.ip,
    ips: req.ips,
    hostname: req.hostname,
    protocol: req.protocol,
    secure: req.secure,
    xhr: req.xhr,
    fresh: req.fresh,
    stale: req.stale,

    // Custom properties
    id: req.id,
    sessionID: req.sessionID,
    session: req.session,

    // Methods demonstration
    get: {
      contentType: req.get("content-type"),
      userAgent: req.get("user-agent"),
      host: req.get("host"),
    },
    accepts: {
      json: req.accepts("json"),
      html: req.accepts("html"),
      text: req.accepts("text"),
    },
    is: {
      json: req.is("json"),
      html: req.is("html"),
      urlencoded: req.is("urlencoded"),
    },
  });
});

// Route parameters
app.get("/demo/params/:id/:action", (req, res) => {
  res.json({
    params: req.params,
    id: req.params.id,
    action: req.params.action,
  });
});

// Query string
app.get("/demo/query", (req, res) => {
  res.json({
    query: req.query,
    queryString: buildQueryString(req.query),
  });
});

// ==================== RESPONSE OBJECT FEATURES ====================

// JSON response
app.get("/demo/json", (req, res) => {
  res.json({
    message: "This is a JSON response",
    timestamp: new Date(),
    data: { foo: "bar", nested: { value: 123 } },
  });
});

// Send various types
app.get("/demo/send/:type", (req, res) => {
  const { type } = req.params;

  switch (type) {
    case "string":
      res.send("This is a string response");
      break;
    case "html":
      res.send("<h1>HTML Response</h1><p>This is HTML content</p>");
      break;
    case "buffer":
      res.send(Buffer.from("This is a buffer response"));
      break;
    case "number":
      res.status(418).send(418); // I'm a teapot
      break;
    default:
      res.send({ type: "object", message: "Default object response" });
  }
});

// Redirect
app.get("/demo/redirect", (req, res) => {
  const { permanent, url } = req.query;

  if (url) {
    res.redirect(permanent === "true" ? 301 : 302, url);
  } else {
    res.redirect("/");
  }
});

// Status codes
app.get("/demo/status/:code", (req, res) => {
  const code = parseInt(req.params.code) || 200;
  res.status(code).json({
    statusCode: code,
    message: `Response with status ${code}`,
  });
});

// Headers manipulation
app.get("/demo/headers", (req, res) => {
  res.set("X-Custom-Header", "Custom Value");
  res.set({
    "X-Multiple-1": "Value 1",
    "X-Multiple-2": "Value 2",
  });
  res.append("X-Append", "First");
  res.append("X-Append", "Second");
  res.type("application/json");

  res.json({
    message: "Check response headers",
    headers: res.getHeaders(),
  });
});

// Content type
app.get("/demo/type/:type", (req, res) => {
  const { type } = req.params;
  res.type(type);

  switch (type) {
    case "json":
      res.send({ message: "JSON content" });
      break;
    case "xml":
      res.send('<?xml version="1.0"?><message>XML content</message>');
      break;
    case "text":
      res.send("Plain text content");
      break;
    case "html":
      res.send("<h1>HTML content</h1>");
      break;
    default:
      res.send("Default content");
  }
});

// File operations
app.get("/demo/download", (req, res) => {
  const content = "This is a sample file content for download demonstration.";
  const filename = "sample.txt";

  res.attachment(filename);
  res.send(content);
});

// Streaming response
app.get("/demo/stream", (req, res) => {
  res.type("text/plain");

  let counter = 0;
  const interval = setInterval(() => {
    res.write(`Stream chunk ${++counter}\n`);

    if (counter >= 5) {
      clearInterval(interval);
      res.end("Stream complete\n");
    }
  }, 1000);
});

// ==================== COOKIE MANAGEMENT ====================

app.get("/cookies/set", (req, res) => {
  // Regular cookie
  res.cookie("regular", "regular-value", {
    maxAge: 900000,
    httpOnly: false,
  });

  // HTTP-only cookie
  res.cookie("httponly", "secure-value", {
    maxAge: 900000,
    httpOnly: true,
  });

  // Signed cookie
  res.cookie("signed", "signed-value", {
    maxAge: 900000,
    httpOnly: true,
    signed: true,
  });

  // Session cookie (no maxAge)
  res.cookie("session", "session-value");

  // Secure cookie (HTTPS only)
  res.cookie("secure", "secure-value", {
    secure: true,
    sameSite: "strict",
  });

  res.json({
    message: "Cookies set successfully",
    cookies: {
      regular: "regular-value",
      httponly: "secure-value (httpOnly)",
      signed: "signed-value (signed)",
      session: "session-value (session)",
      secure: "secure-value (secure, HTTPS only)",
    },
  });
});

app.get("/cookies/get", (req, res) => {
  res.json({
    cookies: req.cookies,
    signedCookies: req.signedCookies,
  });
});

app.get("/cookies/signed", (req, res) => {
  const value = req.signedCookies.signed || "Not found";
  res.json({
    signed: value,
    valid: value !== "Not found",
  });
});

app.get("/cookies/clear", (req, res) => {
  res.clearCookie("regular");
  res.clearCookie("httponly");
  res.clearCookie("signed");
  res.clearCookie("session");
  res.clearCookie("secure");

  res.json({ message: "All cookies cleared" });
});

// ==================== SESSION MANAGEMENT ====================

app.get("/session/info", (req, res) => {
  if (!req.session.views) {
    req.session.views = 0;
  }
  req.session.views++;

  res.json({
    sessionID: req.sessionID,
    session: req.session,
    views: req.session.views,
    cookie: req.session.cookie,
    isNew: req.session.isNew,
  });
});

app.post("/session/data", (req, res) => {
  const { key, value } = req.body;

  if (!key) {
    return res.status(400).json({ error: "Key is required" });
  }

  req.session[key] = value;

  res.json({
    message: "Session data stored",
    session: req.session,
  });
});

app.delete("/session/destroy", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: "Failed to destroy session" });
    }

    res.clearCookie("velocy.sid");
    res.json({ message: "Session destroyed" });
  });
});

app.get("/session/regenerate", (req, res) => {
  const oldId = req.sessionID;

  req.session.regenerate((err) => {
    if (err) {
      return res.status(500).json({ error: "Failed to regenerate session" });
    }

    res.json({
      message: "Session regenerated",
      oldID: oldId,
      newID: req.sessionID,
    });
  });
});

// ==================== AUTHENTICATION & AUTHORIZATION ====================

// Middleware for checking authentication
const requireAuth = (req, res, next) => {
  if (!req.session.user) {
    return res.status(401).json({ error: "Authentication required" });
  }
  next();
};

// Middleware for checking API key
const requireApiKey = (req, res, next) => {
  const apiKey = req.get("X-API-Key");

  if (!apiKey || !dataStore.apiKeys.has(apiKey)) {
    return res.status(403).json({ error: "Valid API key required" });
  }

  req.apiKey = dataStore.apiKeys.get(apiKey);
  next();
};

app.post("/auth/login", (req, res) => {
  const { username, password } = req.body;

  // Simple demo authentication
  if (username === "admin" && password === "password") {
    req.session.user = {
      username: "admin",
      role: "admin",
      loginTime: new Date(),
    };

    res.json({
      success: true,
      user: req.session.user,
      sessionID: req.sessionID,
    });
  } else {
    res.status(401).json({
      error: "Invalid credentials",
    });
  }
});

app.post("/auth/logout", (req, res) => {
  const user = req.session.user;

  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: "Logout failed" });
    }

    res.clearCookie("velocy.sid");
    res.json({
      message: "Logged out successfully",
      user,
    });
  });
});

app.get("/auth/protected", requireAuth, (req, res) => {
  res.json({
    message: "This is a protected route",
    user: req.session.user,
  });
});

app.get("/auth/api-protected", requireApiKey, (req, res) => {
  res.json({
    message: "This route requires API key",
    apiKey: req.apiKey,
  });
});

// ==================== RATE LIMITING ====================

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: "Too many requests from this IP, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      error: "Rate limit exceeded",
      retryAfter: req.rateLimit.resetTime,
    });
  },
});

const strictLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 5, // only 5 requests per minute
  skipSuccessfulRequests: false,
  skipFailedRequests: false,
});

app.use("/api/rate-limited", strictLimiter);
app.get("/api/rate-limited", (req, res) => {
  res.json({
    message: "This endpoint is rate limited",
    remaining: req.rateLimit.remaining,
    limit: req.rateLimit.limit,
    resetTime: new Date(req.rateLimit.resetTime),
  });
});

// ==================== VALIDATION EXAMPLES ====================

// User validation schema
const userSchema = {
  body: {
    name: {
      type: "string",
      required: true,
      minLength: 2,
      maxLength: 50,
      pattern: /^[a-zA-Z\s]+$/,
      transform: (value) => value.trim(),
    },
    email: {
      type: "email",
      required: true,
      transform: (value) => value.toLowerCase(),
    },
    age: {
      type: "number",
      min: 0,
      max: 150,
      coerce: true,
    },
    role: {
      type: "string",
      enum: ["admin", "user", "moderator"],
      default: "user",
    },
    preferences: {
      type: "object",
      properties: {
        newsletter: { type: "boolean", default: false },
        notifications: { type: "boolean", default: true },
      },
    },
    tags: {
      type: "array",
      items: { type: "string" },
      minItems: 0,
      maxItems: 10,
      uniqueItems: true,
    },
  },
};

app.post("/validate/user", validator(userSchema), (req, res) => {
  res.json({
    message: "Validation passed",
    data: req.body,
  });
});

// Custom validation
app.post(
  "/validate/custom",
  validator({
    body: {
      password: {
        type: "string",
        required: true,
        minLength: 8,
        custom: (value) => {
          if (!/[A-Z]/.test(value)) {
            return "Password must contain at least one uppercase letter";
          }
          if (!/[a-z]/.test(value)) {
            return "Password must contain at least one lowercase letter";
          }
          if (!/[0-9]/.test(value)) {
            return "Password must contain at least one number";
          }
          if (!/[!@#$%^&*]/.test(value)) {
            return "Password must contain at least one special character";
          }
          return true;
        },
      },
      confirmPassword: {
        type: "string",
        required: true,
        custom: (value, { body }) => {
          if (value !== body.password) {
            return "Passwords do not match";
          }
          return true;
        },
      },
    },
  }),
  (req, res) => {
    res.json({
      message: "Password validation passed",
      strength: "strong",
    });
  },
);

// Async validation
app.post(
  "/validate/async",
  validator({
    body: {
      username: {
        type: "string",
        required: true,
        minLength: 3,
        custom: async (value) => {
          // Simulate async check (e.g., database lookup)
          await new Promise((resolve) => setTimeout(resolve, 100));

          if (value === "admin" || value === "root") {
            return "Username is reserved";
          }

          // Check if username exists
          const exists = Array.from(dataStore.users.values()).some((u) => u.name.toLowerCase() === value.toLowerCase());

          if (exists) {
            return "Username already taken";
          }

          return true;
        },
      },
    },
  }),
  (req, res) => {
    res.json({
      message: "Username is available",
      username: req.body.username,
    });
  },
);

// ==================== FILE OPERATIONS ====================

// File upload handler
app.post("/upload", (req, res) => {
  console.log("Upload request received");
  console.log("Content-Type:", req.get("content-type"));
  console.log("req.body:", req.body);
  console.log("req.files:", req.files);

  const fileId = crypto.randomBytes(8).toString("hex");
  let file;

  // Check if multipart data with files
  if (req.files && Object.keys(req.files).length > 0) {
    // Handle multipart file upload
    // req.files is an object where keys are field names
    const firstFieldName = Object.keys(req.files)[0];
    const uploadedFile = req.files[firstFieldName];

    // Handle both single file and array of files
    const fileData = Array.isArray(uploadedFile) ? uploadedFile[0] : uploadedFile;

    file = {
      id: fileId,
      name: fileData.originalFilename || fileData.filename || "unnamed.txt",
      size: fileData.size || (fileData.buffer ? fileData.buffer.length : 0),
      type: fileData.mimetype || fileData.contentType || "application/octet-stream",
      uploadedAt: new Date(),
      content: fileData.buffer || fileData.path || fileData.content || fileData,
    };
  } else if (req.body) {
    // Handle other content types (JSON, text, raw)
    file = {
      id: fileId,
      name: req.body.filename || "unnamed.txt",
      size: req.body.size || (typeof req.body === "string" ? req.body.length : JSON.stringify(req.body).length),
      type: req.get("content-type"),
      uploadedAt: new Date(),
      content: req.body,
    };
  } else {
    return res.status(400).json({ error: "No file or data uploaded" });
  }

  dataStore.files.set(fileId, file);

  res.status(201).json({
    message: "File uploaded successfully",
    fileId,
    file: {
      id: file.id,
      name: file.name,
      size: file.size,
      type: file.type,
      uploadedAt: file.uploadedAt,
    },
  });
});

// File download
app.get("/download/:filename", (req, res) => {
  const { filename } = req.params;
  const file = Array.from(dataStore.files.values()).find((f) => f.name === filename);

  if (!file) {
    return res.status(404).json({ error: "File not found" });
  }

  res.attachment(file.name);
  res.type(file.type || "application/octet-stream");
  res.send(file.content);
});

// List files
app.get("/files/list", (req, res) => {
  const files = Array.from(dataStore.files.values()).map((f) => ({
    id: f.id,
    name: f.name,
    size: f.size,
    type: f.type,
    uploadedAt: f.uploadedAt,
  }));

  res.json({ files });
});

// ==================== NESTED ROUTING ====================

// Create a nested router
const nestedRouter = new Router();

nestedRouter.get("/route", (req, res) => {
  res.json({
    message: "This is a nested route",
    path: req.path,
    baseUrl: req.baseUrl,
  });
});

nestedRouter.get("/deep/path", (req, res) => {
  res.json({
    message: "Deep nested route",
    level: "nested/sub/deep/path",
  });
});

// Another nested router
const apiV2Router = new Router();

apiV2Router.get("/users", (req, res) => {
  res.json({
    version: "v2",
    users: Array.from(dataStore.users.values()),
  });
});

apiV2Router.get("/info", (req, res) => {
  res.json({
    version: "v2",
    message: "API Version 2",
  });
});

// Mount nested routers
app.nest("/nested/sub", nestedRouter);
app.nest("/api/v2", apiV2Router);

// ==================== WILDCARD & CATCH-ALL ROUTES ====================

// Single segment wildcard
app.get("/files/*.pdf", (req, res) => {
  res.json({
    message: "PDF file route",
    filename: req.params["*"],
    extension: "pdf",
  });
});

// Pattern matching
app.get("/assets/*.css", (req, res) => {
  res.type("text/css");
  res.send(`/* CSS file: ${req.params["*"]} */\nbody { margin: 0; }`);
});

// Multi-segment catch-all
app.get("/catch/**", (req, res) => {
  res.json({
    message: "Catch-all route",
    caught: req.params["**"],
    fullPath: req.path,
  });
});

// ==================== WEBSOCKET IMPLEMENTATION ====================

// Main WebSocket endpoint
app.ws("/ws", (ws, req) => {
  const clientId = crypto.randomBytes(8).toString("hex");

  console.log(`WebSocket client connected: ${clientId}`);
  dataStore.websocketClients.set(clientId, ws);

  // Send welcome message
  ws.send(
    JSON.stringify({
      type: "welcome",
      clientId,
      message: "Connected to Velocy WebSocket server",
      timestamp: new Date(),
    }),
  );

  // Handle messages
  ws.on("message", (message) => {
    try {
      const data = JSON.parse(message);
      console.log(`WebSocket message from ${clientId}:`, data);

      // Store in history
      dataStore.messageHistory.push({
        clientId,
        data,
        timestamp: new Date(),
      });

      // Echo back
      ws.send(
        JSON.stringify({
          type: "echo",
          original: data,
          clientId,
          timestamp: new Date(),
        }),
      );

      // Broadcast to all clients
      app.wsRouter.broadcast(
        JSON.stringify({
          type: "broadcast",
          from: clientId,
          data,
          timestamp: new Date(),
        }),
        { except: ws },
      );
    } catch (error) {
      ws.send(
        JSON.stringify({
          type: "error",
          message: "Invalid message format",
          error: error.message,
        }),
      );
    }
  });

  // Handle close
  ws.on("close", () => {
    console.log(`WebSocket client disconnected: ${clientId}`);
    dataStore.websocketClients.delete(clientId);

    // Notify others
    app.wsRouter.broadcast(
      JSON.stringify({
        type: "client_left",
        clientId,
        timestamp: new Date(),
      }),
    );
  });

  // Handle errors
  ws.on("error", (error) => {
    console.error(`WebSocket error for ${clientId}:`, error);
  });
});

// Room-based chat WebSocket
app.ws("/ws/chat/:room", (ws, req) => {
  const room = req.params.room;
  const userId = crypto.randomBytes(4).toString("hex");

  // Join room
  ws.join(room);

  // Welcome message
  ws.send(
    JSON.stringify({
      type: "joined",
      room,
      userId,
      message: `Welcome to room: ${room}`,
    }),
  );

  // Notify room
  app.wsRouter.room(room).broadcast(
    JSON.stringify({
      type: "user_joined",
      userId,
      room,
      timestamp: new Date(),
    }),
    { except: ws },
  );

  // Handle messages
  ws.on("message", (message) => {
    // Broadcast to room
    app.wsRouter.room(room).broadcast(
      JSON.stringify({
        type: "chat",
        room,
        userId,
        message: message.toString(),
        timestamp: new Date(),
      }),
    );
  });

  // Handle disconnect
  ws.on("close", () => {
    ws.leave(room);

    app.wsRouter.room(room).broadcast(
      JSON.stringify({
        type: "user_left",
        userId,
        room,
        timestamp: new Date(),
      }),
    );
  });
});

// Broadcasting endpoint
app.ws("/ws/broadcast", (ws, req) => {
  ws.on("message", (message) => {
    // Broadcast to all WebSocket clients
    app.wsRouter.broadcast(message);
  });
});

// WebSocket statistics
app.get("/api/ws/stats", (req, res) => {
  res.json({
    totalClients: dataStore.websocketClients.size,
    clients: Array.from(dataStore.websocketClients.keys()),
    messageHistory: dataStore.messageHistory.slice(-10), // Last 10 messages
    // Note: getRooms() method not available in current WebSocketRouter implementation
    rooms: [],
  });
});

// ==================== PERFORMANCE MONITORING ====================

app.get("/demo/performance", (req, res) => {
  const stats = {
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage(),
    cpuUsage: process.cpuUsage(),
    requestsServed: app.getSetting("requestCount") || 0,
    routerCache: {
      enabled: app._cacheEnabled,
      routeCacheSize: app._routeCache ? app._routeCache.size : 0,
      urlCacheSize: app._urlCache ? app._urlCache.size : 0,
    },
    performance: {
      enabled: app._performanceEnabled,
      metrics: app._performanceMetrics || {},
    },
  };

  res.json(stats);
});

// Track request count - moved to earlier in middleware stack
// (This was interfering with route matching when placed after routes)

// ==================== VIEW ENGINE & TEMPLATING ====================

// Set view engine settings
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "html");

// Enable various settings
app.enable("case sensitive routing");
app.enable("strict routing");
app.enable("trust proxy");
app.enable("x-powered-by");

// Note: Using ViewEngine.simpleEngine() for .html files which supports {{#if}} and {{#each}}

// Render view
app.get("/demo/render", (req, res) => {
  // Since we don't have actual view files, we'll simulate
  const html = `
    <h1>{{title}}</h1>
    <p>{{message}}</p>
    <p>Time: {{time}}</p>
  `;

  // Simulate template rendering
  let rendered = html;
  const data = {
    title: "Velocy Template Engine",
    message: "This is a rendered view",
    time: new Date().toISOString(),
  };

  for (const [key, value] of Object.entries(data)) {
    rendered = rendered.replace(new RegExp(`{{${key}}}`, "g"), value);
  }

  res.type("html").send(rendered);
});

// ==================== ERROR HANDLING ====================

// Custom error class
class AppError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
  }
}

// Route that throws an error
app.get("/demo/error", (req, res, next) => {
  next(new AppError("This is a demonstration error", 500));
});

// Async error
app.get("/demo/async-error", async (req, res, next) => {
  try {
    await new Promise((resolve, reject) => {
      setTimeout(() => reject(new Error("Async error")), 100);
    });
  } catch (error) {
    next(error);
  }
});

// 404 handler - DISABLED because it blocks route matching in Velocy Router
// The Velocy Router processes middleware added with app.use() before checking routes,
// which causes all requests to return 404. This is different from Express behavior.
// TODO: Implement a proper 404 handler that only runs after route matching fails
/*
app.use((req, res, next) => {
  // Only send 404 if response hasn't been sent yet
  if (!res.headersSent) {
    res.status(404).json({
      error: 'Not Found',
      path: req.path,
      method: req.method,
      timestamp: new Date()
    });
  }
});
*/

// Global error handler (4 parameters)
app.useError((err, req, res, next) => {
  const statusCode = err.statusCode || err.status || 500;
  const message = err.message || "Internal Server Error";

  console.error("Error:", err);

  res.status(statusCode).json({
    error: message,
    statusCode,
    path: req.path,
    method: req.method,
    timestamp: new Date(),
    ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
  });
});

// ==================== FASTROUTER DEMONSTRATION ====================

// FastRouter and SimpleRouter are standalone routers, not nestable
// They're demonstrated here as alternative routing options

// Setup FastRouter endpoints
fastRouter.get("/fast", (req, res) => {
  res.json({ message: "FastRouter response", router: "FastRouter" });
});

fastRouter.post("/fast/data", (req, res) => {
  res.json({ received: req.body, router: "FastRouter" });
});

// FastRouter would be used as the main router instead of Router
// const app = new FastRouter(); // Alternative to Router

// ==================== SIMPLEROUTER DEMONSTRATION ====================

// Setup SimpleRouter endpoints
simpleRouter.get("/simple", (req, res) => {
  res.json({ message: "SimpleRouter response", router: "SimpleRouter" });
});

simpleRouter.get("/simple/:id", (req, res) => {
  res.json({ id: req.params.id, router: "SimpleRouter" });
});

// SimpleRouter would be used as the main router for simple apps
// const app = new SimpleRouter(); // Alternative to Router

// Create nested Router instances instead
const fastRouterDemo = new Router();
fastRouterDemo.get("/fast", (req, res) => {
  res.json({ message: "Router emulating FastRouter", router: "Router" });
});
fastRouterDemo.post("/fast/data", (req, res) => {
  res.json({ received: req.body, router: "Router" });
});

const simpleRouterDemo = new Router();
simpleRouterDemo.get("/simple", (req, res) => {
  res.json({ message: "Router emulating SimpleRouter", router: "Router" });
});
simpleRouterDemo.get("/simple/:id", (req, res) => {
  res.json({ id: req.params.id, router: "Router" });
});

// Mount the Router instances
app.nest("/fastrouter", fastRouterDemo);
app.nest("/simplerouter", simpleRouterDemo);

// ==================== ADVANCED MIDDLEWARE FEATURES ====================

// Path-specific middleware
app.use("/admin", (req, res, next) => {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
});

app.get("/admin/dashboard", (req, res) => {
  res.json({
    message: "Admin dashboard",
    users: dataStore.users.size,
    files: dataStore.files.size,
    sessions: "Active",
  });
});

// Conditional middleware
const conditionalMiddleware = (condition) => {
  return (req, res, next) => {
    if (condition(req)) {
      console.log("Conditional middleware activated");
      // Do something
    }
    next();
  };
};

app.use(conditionalMiddleware((req) => req.query.debug === "true"));

// ==================== UTILITY FUNCTIONS DEMONSTRATION ====================

app.get("/demo/utils", (req, res) => {
  const queryObject = { foo: "bar", baz: 123, array: [1, 2, 3] };

  res.json({
    buildQueryString: buildQueryString(queryObject),
    websocketUtils: {
      available: typeof websocketUtils === "object",
    },
  });
});

// ==================== SERVER SETTINGS & LOCALS ====================

// Set application locals
app.locals.title = "Velocy Example Server";
app.locals.version = "1.0.0";
app.locals.author = "Velocy Framework";

app.get("/demo/settings", (req, res) => {
  res.json({
    settings: {
      "case sensitive routing": app.enabled("case sensitive routing"),
      "strict routing": app.enabled("strict routing"),
      "trust proxy": app.enabled("trust proxy"),
      "x-powered-by": app.enabled("x-powered-by"),
      views: app.getSetting("views"),
      "view engine": app.getSetting("view engine"),
    },
    locals: app.locals,
    disabled: {
      etag: app.disabled("etag"),
    },
  });
});

// ==================== ERROR HANDLING ====================

// NOTE: 404 handler cannot be added with app.use() in Velocy Router
// because middleware runs before route matching. The router will handle
// 404s internally when no route matches.

// General error handler
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  const message = err.message || "Internal Server Error";

  // Log error for debugging
  console.error(`[ERROR] ${status}: ${message}`);
  if (err.stack) {
    console.error(err.stack);
  }

  // Send error response
  if (req.xhr || (req.headers.accept && req.headers.accept.includes("application/json"))) {
    // JSON response for API requests
    res.status(status).json({
      error: {
        status,
        message,
        ...(process.env.NODE_ENV !== "production" && { stack: err.stack }),
      },
    });
  } else {
    // HTML response for browser requests
    res.status(status).render("error.html", {
      status,
      message,
      details: process.env.NODE_ENV !== "production" ? err.toString() : null,
      stack: process.env.NODE_ENV !== "production" ? err.stack : null,
    });
  }
});

// ==================== START SERVER ====================

// Create and start server
const server = createServer(app);

// Print configuration
console.log("\n╔══════════════════════════════════════════════════════════════╗");
console.log("║                                                              ║");
console.log("║           🚀 Velocy Framework - Example Server              ║");
console.log("║                                                              ║");
console.log("║           Demonstrating EVERY Feature Available             ║");
console.log("║                                                              ║");
console.log("╚══════════════════════════════════════════════════════════════╝\n");

console.log("📋 Configuration:");
console.log("├─ Performance Monitoring: ENABLED");
console.log("├─ Route Caching: ENABLED");
console.log("├─ Session Management: ENABLED");
console.log("├─ WebSocket Server: ENABLED");
console.log("├─ CORS: ENABLED");
console.log("├─ Compression: ENABLED");
console.log("└─ Rate Limiting: ENABLED\n");

console.log("🌳 Route Tree:");
app.printTree();

console.log("\n📊 Router Statistics:");
console.log(`├─ Middleware Stack: ${app.globalMiddleware.length} global`);
console.log(`├─ Nested Routers: 4 (main + 3 nested)`);
console.log(`└─ WebSocket Routes: 3\n`);

// Start listening
server.listen(PORT, () => {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║                                                              ║");
  console.log(`║   🎉 Server is running at http://localhost:${PORT}            ║`);
  console.log("║                                                              ║");
  console.log(`║   📖 Documentation: http://localhost:${PORT}/                ║`);
  console.log(`║   🧪 API Testing: http://localhost:${PORT}/api              ║`);
  console.log(`║   🔌 WebSocket: ws://localhost:${PORT}/ws                   ║`);
  console.log("║                                                              ║");
  console.log("║   Press Ctrl+C to stop the server                           ║");
  console.log("║                                                              ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
});

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\n\n🛑 Shutting down gracefully...");

  server.close(() => {
    console.log("✅ Server closed");
    process.exit(0);
  });

  // Force exit after 5 seconds
  setTimeout(() => {
    console.error("❌ Forced shutdown");
    process.exit(1);
  }, 5000);
});

module.exports = app;
