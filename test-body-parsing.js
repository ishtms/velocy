const { Router, createServer } = require("./lib/velocy");

const router = new Router();

// JSON body parsing
router.post("/api/json", async (req, res) => {
  console.log("Content-Type:", req.headers["content-type"]);
  console.log("Is JSON?", req.is("json"));
  
  const body = await req.body;
  console.log("Parsed JSON body:", body);
  
  res.json({
    received: body,
    type: "json"
  });
});

// URL-encoded form data
router.post("/api/form", async (req, res) => {
  console.log("Content-Type:", req.headers["content-type"]);
  console.log("Is form?", req.is("application/x-www-form-urlencoded"));
  
  const body = await req.body;
  console.log("Parsed form body:", body);
  
  res.json({
    received: body,
    type: "form"
  });
});

// Multipart form data (file upload simulation)
router.post("/api/upload", async (req, res) => {
  console.log("Content-Type:", req.headers["content-type"]);
  console.log("Is multipart?", req.is("multipart/form-data"));
  
  const body = await req.body;
  console.log("Parsed multipart body:", body);
  
  // Check for files in the body
  const response = {
    fields: {},
    files: {}
  };
  
  for (const [key, value] of Object.entries(body)) {
    if (value && typeof value === 'object' && value.filename) {
      response.files[key] = {
        filename: value.filename,
        size: value.content ? value.content.length : 0
      };
    } else {
      response.fields[key] = value;
    }
  }
  
  res.json(response);
});

// Raw body access
router.post("/api/raw", async (req, res) => {
  const rawBody = await req.getRawBody();
  console.log("Raw body buffer:", rawBody);
  console.log("Raw body string:", rawBody.toString());
  
  res.json({
    size: rawBody.length,
    preview: rawBody.toString().substring(0, 100)
  });
});

// Body size limit test
router.post("/api/large", async (req, res) => {
  // Set a smaller limit for testing
  req.bodyLimit = 1024; // 1KB limit
  
  try {
    const body = await req.body;
    res.json({ success: true, body });
  } catch (error) {
    res.status(413).json({ 
      error: "Payload too large",
      message: error.message 
    });
  }
});

const server = createServer(router);
const PORT = 3001;

server.listen(PORT, () => {
  console.log(`Body parsing test server running on http://localhost:${PORT}`);
  console.log("\nTest commands:");
  console.log("\n1. JSON body:");
  console.log(`curl -X POST http://localhost:${PORT}/api/json -H "Content-Type: application/json" -d '{"name":"Alice","age":25,"hobbies":["reading","coding"]}'`);
  
  console.log("\n2. Form data:");
  console.log(`curl -X POST http://localhost:${PORT}/api/form -H "Content-Type: application/x-www-form-urlencoded" -d "username=bob&password=secret123&remember=true"`);
  
  console.log("\n3. Multipart form data:");
  console.log(`curl -X POST http://localhost:${PORT}/api/upload -F "name=Charlie" -F "file=@package.json" -F "description=Test upload"`);
  
  console.log("\n4. Raw body:");
  console.log(`curl -X POST http://localhost:${PORT}/api/raw -H "Content-Type: text/plain" -d "This is raw text data"`);
  
  console.log("\n5. Large body (will fail with 1KB limit):");
  console.log(`curl -X POST http://localhost:${PORT}/api/large -H "Content-Type: application/json" -d '{"data":"` + 'x'.repeat(2000) + `"}'`);
});