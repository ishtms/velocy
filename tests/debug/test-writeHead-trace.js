const Router = require('./lib/core/Router');
const http = require('http');

const app = new Router();

app.use((req, res, next) => {
  const originalWriteHead = res.writeHead;
  res.writeHead = function(...args) {
    console.log('writeHead called with args:', args);
    return originalWriteHead.apply(this, args);
  };
  next();
});

app.get('/test', (req, res) => {
  const data = 'x'.repeat(100);
  res.set('Content-Type', 'text/plain');
  console.log('Handler: about to send');
  console.log('res.headersSent before send:', res.headersSent);
  res.send(data);
  console.log('res.headersSent after send:', res.headersSent);
});

const server = http.createServer((req, res) => {
  app.handleRequest(req, res);
});

server.listen(3340, () => {
  const req = http.request({
    hostname: 'localhost',
    port: 3340,
    path: '/test',
    method: 'GET'
  }, (res) => {
    console.log('Response headers:', res.headers);
    server.close();
  });
  
  req.end();
});
