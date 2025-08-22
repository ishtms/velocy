const { Router, createServer, cors, compression, bodyParser } = require('./index');

const app = new Router();

// Add middleware one by one to find the culprit
// console.log('Adding CORS...');
// app.use(cors());

// console.log('Adding compression...');
// app.use(compression({
//   threshold: 1024,
//   level: 6,
//   filter: (req, res) => {
//     const contentType = res.getHeader('Content-Type') || '';
//     return /json|text|javascript|css|html|xml/.test(contentType);
//   }
// }));

// console.log('Adding body parser...');
// app.use(bodyParser());

console.log('Adding routes...');
app.get('/', (req, res) => {
  res.send('Root route works!');
});

app.get('/test', (req, res) => {
  res.json({ message: 'Test route works!' });
});

// console.log('Adding 404 handler...');
// app.use((req, res, next) => {
//   if (!res.headersSent) {
//     res.status(404).send('Not Found');
//   }
// });

const server = createServer(app);
server.listen(5002, () => {
  console.log('Test server running on http://localhost:5002');
});