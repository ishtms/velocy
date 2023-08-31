# Velocy
A blazing fast, minimal backend framework for Node.js

Import the `Router` class, and the `createServer` utility -
```js
const { Router, createServer } = require('velocy');
```

Initialize the router
```js
const router = new Router()
```

Register an endpoint 
```js
router.get('/', (req, res) => res.end('Hello, world!'))

// Or add dynamic parameters
router.get('/api/:version/user/:userId', (req, res) => {
  const { version, userId } = req.params;
  res.end(`API version: ${version}, User ID: ${userId}`);
})

// add a catch-all route
router.get('*', (req, res) => res.end('404 Not Found'))
```
Start the server
```js
createServer(router).listen(3000);
```


![](https://uddrapi.com/api/img?page=velocy_homepage)
