/**
 * Velocy Demo Server - Comprehensive API Testing Server
 * This server demonstrates all features of the Velocy framework
 */

const {
  Router,
  createServer,
  bodyParser,
  cookieParser,
  cors,
  static: staticMiddleware,
  session,
  rateLimit,
  compression,
} = require("./index");

const path = require("path");
const fs = require("fs");

// Create main router
const app = new Router();

// Enable CORS for the UI
app.use(
  cors({
    origin: true, // Allow all origins in development
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-API-Key"],
    credentials: true,
  }),
);

// Compression middleware
app.use(compression());

// Cookie parser
app.use(cookieParser("super-secret-key"));

// Session middleware
app.use(
  session({
    secret: "velocy-demo-secret",
    resave: false,
    saveUninitialized: true,
    cookie: {
      secure: false,
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24, // 24 hours
    },
  }),
);

// Body parser for different content types
app.use(bodyParser.json({ limit: "10mb" }));
app.use(bodyParser.urlencoded({ extended: true, limit: "10mb" }));
app.use(bodyParser.raw({ type: "application/octet-stream", limit: "50mb" }));
app.use(bodyParser.text({ type: "text/plain" }));

// Rate limiting for API routes
app.use(
  "/api",
  rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: "Too many requests from this IP, please try again later.",
  }),
);

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  const originalEnd = res.end;

  res.end = function (...args) {
    const duration = Date.now() - start;
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} - ${res.statusCode} (${duration}ms)`);
    originalEnd.apply(res, args);
  };

  next();
});

// Simple static file serving for UI
const serveUIFile = (req, res, filePath) => {
  // Default to index.html if no file specified
  if (!filePath || filePath === "" || filePath === "/") {
    filePath = "index.html";
  }

  const fullPath = path.join(__dirname, "ui", filePath);

  // Security check
  if (!fullPath.startsWith(path.join(__dirname, "ui"))) {
    res.status(403).send("Forbidden");
    return;
  }

  // Determine content type
  const ext = path.extname(fullPath).toLowerCase();
  const contentTypes = {
    ".html": "text/html",
    ".css": "text/css",
    ".js": "application/javascript",
    ".json": "application/json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
  };

  const contentType = contentTypes[ext] || "application/octet-stream";

  // Read and send file
  fs.readFile(fullPath, (err, data) => {
    if (err) {
      if (err.code === "ENOENT") {
        res.status(404).send("Not Found");
      } else {
        res.status(500).send("Internal Server Error");
      }
      return;
    }

    res.set("Content-Type", contentType);
    res.set("Cache-Control", "no-cache");
    res.end(data);
  });
};

// Route handlers for UI
app.get("/ui", (req, res) => {
  serveUIFile(req, res, "index.html");
});

app.get("/ui/", (req, res) => {
  serveUIFile(req, res, "index.html");
});

app.get("/ui/**", (req, res) => {
  const filePath = req.params["**"];
  serveUIFile(req, res, filePath);
});

// In-memory data store for demo
let users = [
  { id: 1, name: "John Doe", email: "john@example.com", role: "admin" },
  { id: 2, name: "Jane Smith", email: "jane@example.com", role: "user" },
  { id: 3, name: "Bob Johnson", email: "bob@example.com", role: "user" },
];

let nextUserId = 4;

// ==================== API ROUTES ====================

// Welcome route
app.get("/", (req, res) => {
  res.json({
    message: "Welcome to Velocy Demo Server!",
    version: "1.0.0",
    endpoints: {
      ui: "http://localhost:3000/ui",
      api: "http://localhost:3000/api",
      websocket: "ws://localhost:3000/ws",
    },
  });
});

// Test endpoint
app.get("/api/test", (req, res) => {
  res.json({
    message: "API is working!",
    timestamp: new Date().toISOString(),
    headers: req.headers,
    query: req.query,
    ip: req.ip,
    method: req.method,
  });
});

// Echo endpoint
app.post("/api/echo", (req, res) => {
  res.json({
    echo: req.body,
    contentType: req.headers["content-type"],
    size: JSON.stringify(req.body).length,
  });
});

// ==================== USER CRUD OPERATIONS ====================

// Get all users
app.get("/api/users", (req, res) => {
  const { page = 1, limit = 10, sort = "id", order = "asc" } = req.query;

  let sortedUsers = [...users];
  sortedUsers.sort((a, b) => {
    if (order === "asc") {
      return a[sort] > b[sort] ? 1 : -1;
    } else {
      return a[sort] < b[sort] ? 1 : -1;
    }
  });

  const startIndex = (page - 1) * limit;
  const endIndex = startIndex + parseInt(limit);
  const paginatedUsers = sortedUsers.slice(startIndex, endIndex);

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

// Get user by ID
app.get("/api/users/:id", (req, res) => {
  const user = users.find((u) => u.id === parseInt(req.params.id));

  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  res.json(user);
});

// Create new user
app.post("/api/users", (req, res) => {
  const { name, email, role = "user" } = req.body;

  if (!name || !email) {
    return res.status(400).json({
      error: "Name and email are required",
    });
  }

  // Check if email already exists
  if (users.find((u) => u.email === email)) {
    return res.status(409).json({
      error: "Email already exists",
    });
  }

  const newUser = {
    id: nextUserId++,
    name,
    email,
    role,
    createdAt: new Date().toISOString(),
  };

  users.push(newUser);
  res.status(201).json(newUser);
});

// Update user
app.put("/api/users/:id", (req, res) => {
  const userId = parseInt(req.params.id);
  const userIndex = users.findIndex((u) => u.id === userId);

  if (userIndex === -1) {
    return res.status(404).json({ error: "User not found" });
  }

  const { name, email, role } = req.body;

  if (email && email !== users[userIndex].email) {
    if (users.find((u) => u.email === email && u.id !== userId)) {
      return res.status(409).json({
        error: "Email already exists",
      });
    }
  }

  users[userIndex] = {
    ...users[userIndex],
    ...(name && { name }),
    ...(email && { email }),
    ...(role && { role }),
    updatedAt: new Date().toISOString(),
  };

  res.json(users[userIndex]);
});

// Delete user
app.delete("/api/users/:id", (req, res) => {
  const userId = parseInt(req.params.id);
  const userIndex = users.findIndex((u) => u.id === userId);

  if (userIndex === -1) {
    return res.status(404).json({ error: "User not found" });
  }

  const deletedUser = users.splice(userIndex, 1)[0];
  res.json({
    message: "User deleted successfully",
    user: deletedUser,
  });
});

// ==================== FILE UPLOAD ====================

// File upload endpoint
app.post("/api/upload", (req, res) => {
  // In a real application, you would handle multipart/form-data here
  // For demo purposes, we'll simulate file upload

  const contentType = req.headers["content-type"] || "";

  if (contentType.includes("multipart/form-data")) {
    // Simulate file upload success
    res.json({
      message: "Files uploaded successfully",
      files: [
        { name: "example.pdf", size: 1024000, type: "application/pdf" },
        { name: "image.jpg", size: 2048000, type: "image/jpeg" },
      ],
    });
  } else {
    res.status(400).json({
      error: "Please use multipart/form-data for file uploads",
    });
  }
});

// ==================== COOKIE TESTING ====================

// Get cookies
app.get("/api/cookies", (req, res) => {
  res.json({
    cookies: req.cookies,
    signedCookies: req.signedCookies,
  });
});

// Set cookies
app.post("/api/cookies", (req, res) => {
  const { name, value, options = {} } = req.body;

  if (!name || !value) {
    return res.status(400).json({
      error: "Cookie name and value are required",
    });
  }

  res.cookie(name, value, options);
  res.json({
    message: "Cookie set successfully",
    cookie: { name, value, options },
  });
});

// Clear cookie
app.delete("/api/cookies/:name", (req, res) => {
  res.clearCookie(req.params.name);
  res.json({
    message: `Cookie '${req.params.name}' cleared`,
  });
});

// ==================== AUTHENTICATION ====================

// Login endpoint
app.post("/api/login", (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({
      error: "Username and password are required",
    });
  }

  // Simulate authentication
  if (username === "admin" && password === "password") {
    const token = Buffer.from(`${username}:${Date.now()}`).toString("base64");

    // Set session
    req.session.user = { username, role: "admin" };

    res.json({
      success: true,
      token,
      user: { username, role: "admin" },
    });
  } else {
    res.status(401).json({
      error: "Invalid credentials",
    });
  }
});

// Logout endpoint
app.post("/api/logout", (req, res) => {
  req.session.destroy();
  res.json({ message: "Logged out successfully" });
});

// Protected route
app.get("/api/protected", (req, res) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      error: "Authorization required",
    });
  }

  const token = authHeader.substring(7);

  // Simulate token validation
  try {
    const decoded = Buffer.from(token, "base64").toString();
    const [username] = decoded.split(":");

    res.json({
      message: "Access granted to protected resource",
      user: username,
    });
  } catch (error) {
    res.status(401).json({
      error: "Invalid token",
    });
  }
});

// ==================== SESSION TESTING ====================

app.get("/api/session", (req, res) => {
  if (!req.session.views) {
    req.session.views = 0;
  }

  req.session.views++;

  res.json({
    sessionId: req.sessionID,
    views: req.session.views,
    user: req.session.user || null,
  });
});

// ==================== WILDCARD ROUTES ====================

// Static file pattern matching
app.get("/static/*.css", (req, res) => {
  res.json({
    message: "CSS file requested",
    file: req.params["*"],
    type: "text/css",
  });
});

// Catch-all API route
app.get("/api/**", (req, res) => {
  res.json({
    message: "Catch-all API route",
    path: req.params["**"],
    fullPath: req.url,
  });
});

// ==================== ERROR HANDLING ====================

// Error handler (4-parameter signature for error middleware)
app.use((err, req, res, next) => {
  console.error("Error:", err);

  res.status(err.statusCode || 500).json({
    error: err.message || "Internal Server Error",
    ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
  });
});

// ==================== WEBSOCKET ROUTES ====================

// WebSocket route
app.ws("/ws", (ws, req) => {
  console.log("WebSocket client connected");

  ws.on("message", (message) => {
    console.log("Received:", message.toString());

    // Echo the message back
    ws.send(
      JSON.stringify({
        type: "echo",
        data: message.toString(),
        timestamp: new Date().toISOString(),
      }),
    );

    // Broadcast to all clients
    app.getWebSocketRouter().broadcast(
      JSON.stringify({
        type: "broadcast",
        data: message.toString(),
        from: "server",
        timestamp: new Date().toISOString(),
      }),
    );
  });

  ws.on("close", () => {
    console.log("WebSocket client disconnected");
  });

  // Send welcome message
  ws.send(
    JSON.stringify({
      type: "welcome",
      message: "Connected to Velocy WebSocket server",
      timestamp: new Date().toISOString(),
    }),
  );
});

// ==================== SERVER SETUP ====================

const server = createServer(app);

// Debug: Print route tree
console.log("\nRegistered routes:");
app.printTree();

// Start server
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║                                                          ║
║     Velocy Demo Server Running!                         ║
║                                                          ║
║     🚀 Server:     http://localhost:${PORT}              ║
║     🎨 UI:         http://localhost:${PORT}/ui           ║
║     📡 API:        http://localhost:${PORT}/api          ║
║     🔌 WebSocket:  ws://localhost:${PORT}/ws             ║
║                                                          ║
║     Test Credentials:                                   ║
║     Username: admin                                     ║
║     Password: password                                  ║
║                                                          ║
╚══════════════════════════════════════════════════════════╝
    `);
});
