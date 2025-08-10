const { Router, createServer } = require('./lib/velocy');

const router = new Router();

// Test JSON response
router.get('/api/users', (req, res) => {
  res.json({ users: [{ id: 1, name: 'John' }, { id: 2, name: 'Jane' }] });
});

// Test smart send with object (auto-JSON)
router.get('/api/data', (req, res) => {
  res.send({ message: 'This will be sent as JSON automatically' });
});

// Test send with string (HTML)
router.get('/', (req, res) => {
  res.send('<h1>Welcome to Velocy!</h1>');
});

// Test status chaining with JSON
router.get('/api/error', (req, res) => {
  res.status(500).json({ error: 'Internal Server Error' });
});

// Test redirect
router.get('/old-page', (req, res) => {
  res.redirect('/new-page', 301);
});

// Test cookie setting
router.get('/set-cookie', (req, res) => {
  res
    .cookie('sessionId', 'abc123', {
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
      maxAge: 3600000, // 1 hour
      path: '/'
    })
    .cookie('theme', 'dark', {
      maxAge: 86400000 // 1 day
    })
    .send('Cookies set!');
});

// Test clear cookie
router.get('/clear-cookie', (req, res) => {
  res
    .clearCookie('sessionId')
    .send('Cookie cleared!');
});

// Test content type setting
router.get('/api/xml', (req, res) => {
  res
    .type('xml')
    .send('<?xml version="1.0"?><root><message>Hello XML</message></root>');
});

// Test type shortcuts
router.get('/api/text', (req, res) => {
  res
    .type('text')
    .send('Plain text response');
});

// Test header setting
router.get('/custom-headers', (req, res) => {
  res
    .set('X-Custom-Header', 'CustomValue')
    .set({
      'X-Another-Header': 'AnotherValue',
      'X-Third-Header': 'ThirdValue'
    })
    .send('Headers set!');
});

// Test append headers (for multiple Set-Cookie headers)
router.get('/multiple-cookies', (req, res) => {
  res
    .append('Set-Cookie', 'first=value1; Path=/')
    .append('Set-Cookie', 'second=value2; Path=/')
    .append('Set-Cookie', 'third=value3; Path=/')
    .send('Multiple cookies set using append!');
});

// Test sendFile (create a test file first)
const fs = require('fs');
const path = require('path');

// Create a test HTML file
const testFilePath = path.join(__dirname, 'test.html');
fs.writeFileSync(testFilePath, `
<!DOCTYPE html>
<html>
<head>
    <title>Test File</title>
</head>
<body>
    <h1>This is a test HTML file</h1>
    <p>Served using res.sendFile()</p>
</body>
</html>
`);

router.get('/file', async (req, res) => {
  await res.sendFile('./test.html', {
    maxAge: 3600,
    etag: true,
    lastModified: true
  });
});

// Test sendFile with non-existent file (404 handling)
router.get('/missing-file', async (req, res) => {
  await res.sendFile('./non-existent.html');
});

// Test Buffer sending
router.get('/buffer', (req, res) => {
  const buffer = Buffer.from('This is buffer data', 'utf-8');
  res.send(buffer);
});

// Test method chaining
router.get('/chain', (req, res) => {
  res
    .status(201)
    .set('X-Request-Id', '12345')
    .cookie('test', 'value')
    .type('json')
    .send({ success: true, message: 'Method chaining works!' });
});

// Create and start server
const server = createServer(router);
const PORT = 3000;

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log('\nTest endpoints:');
  console.log('GET http://localhost:3000/ - HTML response');
  console.log('GET http://localhost:3000/api/users - JSON response');
  console.log('GET http://localhost:3000/api/data - Auto-JSON from object');
  console.log('GET http://localhost:3000/api/error - Error with status 500');
  console.log('GET http://localhost:3000/old-page - Redirect to /new-page');
  console.log('GET http://localhost:3000/set-cookie - Set cookies');
  console.log('GET http://localhost:3000/clear-cookie - Clear cookie');
  console.log('GET http://localhost:3000/api/xml - XML response');
  console.log('GET http://localhost:3000/api/text - Plain text');
  console.log('GET http://localhost:3000/custom-headers - Custom headers');
  console.log('GET http://localhost:3000/multiple-cookies - Multiple cookies');
  console.log('GET http://localhost:3000/file - Serve HTML file');
  console.log('GET http://localhost:3000/missing-file - 404 file not found');
  console.log('GET http://localhost:3000/buffer - Buffer response');
  console.log('GET http://localhost:3000/chain - Method chaining demo');
  console.log('\nPress Ctrl+C to stop the server');
});