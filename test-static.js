/**
 * Test file for static middleware functionality
 * Demonstrates various features of the static file serving middleware
 */

const { Router, createServer, static: staticMiddleware } = require('./lib');
const path = require('path');
const fs = require('fs');

// Create test directory structure
const testDir = path.join(__dirname, 'test-static-files');
const publicDir = path.join(testDir, 'public');
const assetsDir = path.join(publicDir, 'assets');

// Create directories if they don't exist
if (!fs.existsSync(testDir)) {
  fs.mkdirSync(testDir, { recursive: true });
}
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}
if (!fs.existsSync(assetsDir)) {
  fs.mkdirSync(assetsDir, { recursive: true });
}

// Create test files
const indexHtml = `<!DOCTYPE html>
<html>
<head>
  <title>Velocy Static Test</title>
  <link rel="stylesheet" href="/assets/style.css">
</head>
<body>
  <h1>Welcome to Velocy Static File Server</h1>
  <p>This is a test of the static middleware.</p>
  <img src="/assets/test.svg" alt="Test SVG">
  <script src="/assets/app.js"></script>
</body>
</html>`;

const styleCss = `body {
  font-family: -apple-system, BlinkMacSystemFont, sans-serif;
  max-width: 800px;
  margin: 50px auto;
  padding: 20px;
  background: #f5f5f5;
}

h1 {
  color: #333;
  border-bottom: 2px solid #0066cc;
  padding-bottom: 10px;
}

p {
  line-height: 1.6;
  color: #666;
}`;

const appJs = `console.log('Velocy static middleware test loaded!');

// Test fetch with Range request
async function testRangeRequest() {
  const response = await fetch('/assets/app.js', {
    headers: {
      'Range': 'bytes=0-50'
    }
  });
  
  console.log('Range request status:', response.status);
  console.log('Content-Range:', response.headers.get('Content-Range'));
}

// Test conditional request
async function testConditionalRequest() {
  const response1 = await fetch('/assets/style.css');
  const etag = response1.headers.get('ETag');
  const lastModified = response1.headers.get('Last-Modified');
  
  console.log('ETag:', etag);
  console.log('Last-Modified:', lastModified);
  
  // Make conditional request with ETag
  const response2 = await fetch('/assets/style.css', {
    headers: {
      'If-None-Match': etag
    }
  });
  
  console.log('Conditional request status:', response2.status);
}

// Run tests
setTimeout(() => {
  testRangeRequest();
  testConditionalRequest();
}, 1000);`;

const testSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <circle cx="50" cy="50" r="40" fill="#0066cc" />
  <text x="50" y="55" text-anchor="middle" fill="white" font-size="20">V</text>
</svg>`;

const testJson = {
  name: "Velocy",
  version: "1.0.0",
  description: "Minimal HTTP framework",
  features: [
    "Static file serving",
    "ETag support",
    "Range requests",
    "Directory listing",
    "Compression support"
  ]
};

// Write test files
fs.writeFileSync(path.join(publicDir, 'index.html'), indexHtml);
fs.writeFileSync(path.join(assetsDir, 'style.css'), styleCss);
fs.writeFileSync(path.join(assetsDir, 'app.js'), appJs);
fs.writeFileSync(path.join(assetsDir, 'test.svg'), testSvg);
fs.writeFileSync(path.join(assetsDir, 'data.json'), JSON.stringify(testJson, null, 2));

// Create a .gz version of style.css to test compression
const zlib = require('zlib');
const cssGzipped = zlib.gzipSync(styleCss);
fs.writeFileSync(path.join(assetsDir, 'style.css.gz'), cssGzipped);

// Create router
const router = new Router();

// Configure static middleware with various options
const staticFiles = staticMiddleware({
  root: publicDir,
  index: ['index.html', 'index.htm'],
  dotfiles: 'ignore',
  etag: true,
  lastModified: true,
  maxAge: 3600000, // 1 hour
  immutable: false,
  directoryListing: true,
  gzip: true,
  brotli: true,
  headers: {
    'X-Powered-By': 'Velocy'
  }
});

// Mount static middleware at root
router.get('/*', staticFiles);

// Add some API routes to demonstrate mixing static and dynamic
router.get('/api/status', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    message: 'API endpoint working alongside static files'
  });
});

// Create server
const server = createServer(router);

// Start server
const PORT = process.env.PORT || 3456;
server.listen(PORT, () => {
  console.log(`
Static File Server Test Running!
================================

Server: http://localhost:${PORT}

Test URLs:
- http://localhost:${PORT}/                    (index.html)
- http://localhost:${PORT}/assets/             (directory listing)
- http://localhost:${PORT}/assets/style.css    (CSS file)
- http://localhost:${PORT}/assets/app.js       (JavaScript file)
- http://localhost:${PORT}/assets/test.svg     (SVG image)
- http://localhost:${PORT}/assets/data.json    (JSON data)
- http://localhost:${PORT}/api/status          (API endpoint)

Features to test:
1. Open browser DevTools Network tab
2. Load the main page and observe:
   - ETag headers
   - Cache-Control headers
   - Content-Type detection
   - Gzip compression (if supported by browser)
3. Reload the page to see 304 Not Modified responses
4. Check console for Range request tests
5. Try accessing non-existent files for 404 handling
6. Navigate to /assets/ to see directory listing

Press Ctrl+C to stop the server.
  `);
});