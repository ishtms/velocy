const { Router, createServer } = require('./index');

const app = new Router();

// Simple route
app.get('/', (req, res) => {
  res.send('Hello from root!');
});

app.get('/test', (req, res) => {
  res.json({ message: 'Test route works!' });
});

const server = createServer(app);
server.listen(5001, () => {
  console.log('Test server running on http://localhost:5001');
});