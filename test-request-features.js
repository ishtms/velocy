const { Router, createServer, Request } = require("./lib/velocy");

// Create a new router
const router = new Router();

// Test route that demonstrates all Request features
router.post("/test", async (req, res) => {
  console.log("=== Request Features Test ===");
  
  // 1. Headers (normalized to lowercase)
  console.log("Headers:", req.headers);
  console.log("Content-Type:", req.headers["content-type"]);
  
  // 2. Path and Query
  console.log("Path:", req.path);
  console.log("Query (as object):", req.query);
  
  // 3. Request metadata
  console.log("IP:", req.ip);
  console.log("Hostname:", req.hostname);
  console.log("Protocol:", req.protocol);
  console.log("Base URL:", req.baseUrl);
  
  // 4. Cookies
  console.log("Cookies:", req.cookies);
  
  // 5. Content type checking
  console.log("Is JSON?", req.is("json"));
  console.log("Is form data?", req.is("application/x-www-form-urlencoded"));
  console.log("Is multipart?", req.is("multipart/form-data"));
  
  // 6. Content negotiation
  console.log("Accepts JSON?", req.acceptsJSON());
  console.log("Accepts HTML?", req.acceptsHTML());
  console.log("Best match:", req.accepts("json", "html", "xml"));
  
  // 7. Body parsing (async)
  const body = await req.body;
  console.log("Parsed body:", body);
  
  // 8. Dynamic route params
  console.log("Route params:", req.params);
  
  res.json({
    success: true,
    received: {
      path: req.path,
      query: req.query,
      cookies: req.cookies,
      body: body,
      params: req.params,
      ip: req.ip,
      hostname: req.hostname,
      protocol: req.protocol,
      contentType: req.is("json", "form", "multipart"),
      accepts: req.accepts("json", "html", "xml")
    }
  });
});

// Test route with dynamic parameters
router.get("/users/:id", async (req, res) => {
  res.json({
    userId: req.params.id,
    query: req.query
  });
});

// Test multipart form data
router.post("/upload", async (req, res) => {
  const body = await req.body;
  console.log("Multipart body:", body);
  
  res.json({
    success: true,
    fields: body
  });
});

// Test query string parsing with arrays
router.get("/search", async (req, res) => {
  console.log("Query params:", req.query);
  
  res.json({
    query: req.query
  });
});

// Create and start server
const server = createServer(router);
const PORT = 3000;

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log("\nTest endpoints:");
  console.log("1. POST http://localhost:3000/test - Test all request features");
  console.log("2. GET http://localhost:3000/users/123?filter=active - Test params and query");
  console.log("3. POST http://localhost:3000/upload - Test multipart form data");
  console.log("4. GET http://localhost:3000/search?tags[]=javascript&tags[]=node&sort=desc - Test array query params");
  console.log("\nExample curl commands:");
  console.log('curl -X POST http://localhost:3000/test -H "Content-Type: application/json" -H "Cookie: session=abc123; user=john" -d \'{"name":"John","age":30}\'');
  console.log('curl http://localhost:3000/users/42?filter=active&limit=10');
  console.log('curl "http://localhost:3000/search?tags[]=js&tags[]=node&filter=recent"');
});