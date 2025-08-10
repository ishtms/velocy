const { Router, createServer } = require("./index");

// Create a new router instance
const app = new Router();

// Logger middleware (global)
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  const start = Date.now();

  // Capture the original end function
  const originalEnd = res.end.bind(res);
  res.end = function (...args) {
    const duration = Date.now() - start;
    console.log(`  -> Response sent in ${duration}ms`);
    return originalEnd(...args);
  };

  next();
});

// Simple auth middleware (global)
app.use((req, res, next) => {
  // Check for auth header
  const authHeader = req.headers?.authorization;

  if (authHeader && authHeader.startsWith("Bearer ")) {
    req.user = { id: 1, name: "Test User" };
  }

  next();
});

// Error handler middleware (4 parameters)
app.use((err, req, res, next) => {
  console.error("Error caught by middleware:", err.message);

  if (!res.headersSent) {
    res.status(500).json({
      error: "Internal Server Error",
      message: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
});

// Path-specific middleware for /api routes
app.use("/api", (req, res, next) => {
  console.log("API middleware - URL:", req.url);

  // Require authentication for API routes
  if (!req.user) {
    return res.status(401).json({ error: "Authentication required" });
  }

  next();
});

// Multiple middleware on a single route
app.get(
  "/",
  (req, res, next) => {
    console.log("First middleware for /");
    req.customData = "Hello from middleware";
    next();
  },
  (req, res, next) => {
    console.log("Second middleware for /");
    req.customData += " - modified";
    next();
  },
  (req, res) => {
    res.json({
      message: "Welcome to Velocy with middleware!",
      customData: req.customData,
    });
  }
);

// Route with multiple handlers using array syntax
const validateUser = (req, res, next) => {
  if (!req.params.id || isNaN(req.params.id)) {
    return res.status(400).json({ error: "Invalid user ID" });
  }
  next();
};

const loadUser = async (req, res, next) => {
  // Simulate async operation
  await new Promise((resolve) => setTimeout(resolve, 100));
  req.userData = { id: req.params.id, name: `User ${req.params.id}` };
  next();
};

app.get("/users/:id", [validateUser, loadUser], (req, res) => {
  res.json({
    user: req.userData,
    authenticatedAs: req.user,
  });
});

// API routes (will be affected by /api middleware)
app.get("/api/data", (req, res) => {
  res.json({
    data: "Protected API data",
    user: req.user,
  });
});

// Route that throws an error (to test error middleware)
app.get("/error", (req, res, next) => {
  next(new Error("Something went wrong!"));
});

// Async route that throws an error
app.get("/async-error", async (req, res) => {
  await new Promise((resolve) => setTimeout(resolve, 50));
  throw new Error("Async error occurred!");
});

// Test async middleware
app.get(
  "/async-test",
  async (req, res, next) => {
    console.log("Starting async middleware");
    await new Promise((resolve) => setTimeout(resolve, 100));
    req.asyncData = "Processed asynchronously";
    console.log("Async middleware complete");
    next();
  },
  (req, res) => {
    res.json({
      message: "Async middleware test",
      data: req.asyncData,
    });
  }
);

// Start the server
const server = createServer(app);
const PORT = 3000;

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log("\nTest endpoints:");
  console.log("  GET /                - Multiple middleware demo");
  console.log("  GET /users/123       - Route with validation and async loading");
  console.log("  GET /api/data        - Protected API route (requires auth header)");
  console.log("  GET /error           - Triggers error handling");
  console.log("  GET /async-error     - Triggers async error handling");
  console.log("  GET /async-test      - Tests async middleware");
  console.log('\nTry with auth header: curl -H "Authorization: Bearer token" http://localhost:3000/api/data');
});
