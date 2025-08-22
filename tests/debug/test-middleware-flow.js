const { Router } = require('../../index');
const http = require('http');

const app = new Router();

// Add some global middleware to ensure we're not in the simple path
app.use((req, res, next) => {
  console.log('Global middleware executed');
  next();
});

const middleware1 = (req, res, next) => {
  console.log('Middleware 1 executed');
  req.m1 = true;
  next();
};

const middleware2 = (req, res, next) => {
  console.log('Middleware 2 executed');
  req.m2 = true;
  next();
};

const handler = (req, res) => {
  console.log('Handler executed');
  res.json({ 
    m1: req.m1 || false, 
    m2: req.m2 || false
  });
};

app.get('/test', middleware1, middleware2, handler);

// Check what's stored
console.log('Has global middleware:', app._globalMiddleware ? 'yes' : 'no');
console.log('Route handler type:', Array.isArray(app.rootNode.children['test'].handler['GET']) ? 'array' : 'function');

// Create server and test
const server = http.createServer((req, res) => {
  console.log('\nRequest received:', req.method, req.url);
  app.handleRequest(req, res);
});

server.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  console.log('\nServer listening on port', port);
  
  // Make request
  const options = {
    hostname: '127.0.0.1',
    port: port,
    path: '/test',
    method: 'GET'
  };
  
  const req = http.request(options, (res) => {
    console.log('Response status:', res.statusCode);
    let body = '';
    res.on('data', chunk => body += chunk);
    res.on('end', () => {
      console.log('Response body:', body);
      server.close();
    });
  });
  
  req.on('error', (e) => {
    console.error('Request error:', e);
    server.close();
  });
  
  req.end();
});
