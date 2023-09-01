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
Merge routers 
```js
const { Router, createServer } = require("velocy");

function getUserList(req, res) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end("/users: " + JSON.stringify({ users: ["Ishtmeet", "Jon"] }));
}

function showUserInfo(req, res) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end("/users/:id: " + JSON.stringify({ user: req.extractedParams.id }));
}

function teamsList(req, res) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end("/teams: " + JSON.stringify({ teams: ["Team Red", "Team Blue"] }));
}
const base_routes = new Router().get("/", (req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Hello World");
});

const user_routes = new Router().get("/users", getUserList).get("/users/:id", showUserInfo);
const team_routes = new Router().get("/teams", teamsList);

const main_router = new Router();
main_router.merge(user_routes);
main_router.merge(team_routes);
main_router.merge(base_routes)

// Response 
// GET /            -> Hello world
// GET /users       -> {"users":["Ishtmeet","Jon"]}
// GET /users/:id   -> {"user":"1"}
// GET /teams       -> {"teams":["Team Red","Team Blue"]}

```

Nest routers
```js
const { Router, createServer } = require("velocy");

function getUserList(req, res) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end("/users: " + JSON.stringify({ users: ["Ishtmeet", "Jon"] }));
}

function showUserInfo(req, res) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end("/users/:id: " + JSON.stringify({ user: req.extractedParams.id }));
}

function teamsList(req, res) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end("/teams: " + JSON.stringify({ teams: ["Team Red", "Team Blue"] }));
}
const base_routes = new Router().get("/", (req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Hello World");
});

const user_routes = new Router().get("/users", getUserList).get("/users/:id", showUserInfo);
const team_routes = new Router().get("/teams", teamsList);

const main_router = new Router();
main_router.merge(user_routes);
main_router.merge(team_routes);
main_router.merge(base_routes)

const api_router = new Router();
api_router.nest('/api/v1', main_router)

createServer(api_router).listen(3000, () => {
    console.log("Server is running on port 3000");
});

// Response 
// GET /api/v1             -> 404 Not Found
// GET /api/v1/            -> Hello world
// GET /api/v1/users       -> {"users":["Ishtmeet","Jon"]}
// GET /api/v1/users/:id   -> {"user":"1"}
// GET /api/v1/teams       -> {"teams":["Team Red","Team Blue"]}
```
![](https://uddrapi.com/api/img?page=velocy_homepage)
