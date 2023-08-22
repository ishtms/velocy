/**
 * This file will be used to base our benchmarking off of.
 * It will be used to test the performance of our framework.
 */

const http = require('http');
  
const server = http.createServer((req, res) => {
  res.end('Hello World');
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Server is listening on port ${PORT}`);
});