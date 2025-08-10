const { Router, createServer } = require("./lib/velocy");

const router = new Router();

// Content negotiation example
router.get("/data", async (req, res) => {
  const data = {
    message: "Hello World",
    timestamp: new Date().toISOString(),
    version: "1.0.0"
  };
  
  // Check what the client accepts
  const acceptType = req.accepts("json", "html", "xml", "text");
  
  console.log("Accept header:", req.headers.accept);
  console.log("Best match:", acceptType);
  
  switch(acceptType) {
    case "json":
      res.json(data);
      break;
      
    case "html":
      res.set("Content-Type", "text/html; charset=utf-8");
      res.send(`
        <!DOCTYPE html>
        <html>
          <head><title>Data</title></head>
          <body>
            <h1>${data.message}</h1>
            <p>Timestamp: ${data.timestamp}</p>
            <p>Version: ${data.version}</p>
          </body>
        </html>
      `);
      break;
      
    case "xml":
      res.set("Content-Type", "application/xml");
      res.send(`<?xml version="1.0" encoding="UTF-8"?>
        <data>
          <message>${data.message}</message>
          <timestamp>${data.timestamp}</timestamp>
          <version>${data.version}</version>
        </data>
      `);
      break;
      
    case "text":
      res.set("Content-Type", "text/plain");
      res.send(`Message: ${data.message}\nTimestamp: ${data.timestamp}\nVersion: ${data.version}`);
      break;
      
    default:
      res.status(406).send("Not Acceptable");
  }
});

// Test content type checking
router.post("/echo", async (req, res) => {
  const contentInfo = {
    contentType: req.headers["content-type"],
    isJson: req.is("json"),
    isForm: req.is("form"),
    isMultipart: req.is("multipart"),
    isText: req.is("text"),
    isHtml: req.is("html"),
    matchedType: req.is("json", "form", "multipart", "text", "html")
  };
  
  const body = await req.body;
  
  res.json({
    contentInfo,
    body
  });
});

// Test Accept header with quality values
router.get("/preferences", async (req, res) => {
  // Parse all accepted types
  const allAccepted = req.accepts();
  
  res.json({
    acceptHeader: req.headers.accept,
    allAcceptedTypes: allAccepted,
    acceptsJson: req.acceptsJSON(),
    acceptsHtml: req.acceptsHTML(),
    bestOf: {
      "json_vs_xml": req.accepts("json", "xml"),
      "html_vs_text": req.accepts("html", "text"),
      "any_image": req.accepts("image/png", "image/jpeg", "image/*")
    }
  });
});

// Wildcard type matching
router.get("/image", async (req, res) => {
  const imageType = req.accepts("image/png", "image/jpeg", "image/webp", "image/*");
  
  if (!imageType) {
    res.status(406).json({ error: "Client doesn't accept images" });
    return;
  }
  
  res.json({
    message: `Would send image of type: ${imageType}`,
    acceptedType: imageType
  });
});

const server = createServer(router);
const PORT = 3002;

server.listen(PORT, () => {
  console.log(`Content negotiation test server running on http://localhost:${PORT}`);
  console.log("\nTest commands:");
  
  console.log("\n1. Request JSON:");
  console.log(`curl http://localhost:${PORT}/data -H "Accept: application/json"`);
  
  console.log("\n2. Request HTML:");
  console.log(`curl http://localhost:${PORT}/data -H "Accept: text/html"`);
  
  console.log("\n3. Request XML:");
  console.log(`curl http://localhost:${PORT}/data -H "Accept: application/xml"`);
  
  console.log("\n4. Request plain text:");
  console.log(`curl http://localhost:${PORT}/data -H "Accept: text/plain"`);
  
  console.log("\n5. Request with quality values:");
  console.log(`curl http://localhost:${PORT}/data -H "Accept: text/html;q=0.9, application/json;q=1.0, */*;q=0.1"`);
  
  console.log("\n6. Test content type detection:");
  console.log(`curl -X POST http://localhost:${PORT}/echo -H "Content-Type: application/json" -d '{"test":true}'`);
  
  console.log("\n7. Test accept preferences:");
  console.log(`curl http://localhost:${PORT}/preferences -H "Accept: text/html;q=0.9, application/json;q=1.0, application/xml;q=0.5"`);
  
  console.log("\n8. Test image type negotiation:");
  console.log(`curl http://localhost:${PORT}/image -H "Accept: image/webp, image/png;q=0.9, image/*;q=0.8"`);
});