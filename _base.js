/**
 * This file will be used to set the baseline for our numbers while benchmarking
 */

const http = require('http');
  
const server = http.createServer((req, res) => {
  res.end('Hello World');
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Server is listening on port ${PORT}`);
});
