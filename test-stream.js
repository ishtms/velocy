const { Router, compression } = require('./index');
const { Readable } = require('stream');
const http = require('http');

const app = new Router();

app.use(compression());

app.get('/stream', (req, res) => {
  console.log('Response type:', res.constructor.name);
  console.log('Has pipe?', typeof res.pipe);
  
  res.set('Content-Type', 'text/plain');
  
  const stream = new Readable({
    read() {
      this.push('Stream data\n');
      this.push(null);
    }
  });
  
  console.log('Attempting to pipe stream...');
  try {
    stream.pipe(res);
  } catch (err) {
    console.error('Pipe error:', err.message);
    res.status(500).send('Stream error: ' + err.message);
  }
});

const server = http.createServer((req, res) => {
  app.handleRequest(req, res);
});

server.listen(3459, () => {
  console.log('Test server on port 3459');
  
  http.get('http://localhost:3459/stream', (res) => {
    console.log('Status:', res.statusCode);
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      console.log('Response:', data);
      server.close();
    });
  });
});