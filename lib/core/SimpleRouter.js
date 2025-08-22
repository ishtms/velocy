const Request = require('./Request');
const Response = require('./Response');

class SimpleRouter {
  constructor() {
    this.routes = new Map();
  }

  addRoute(httpMethod, routePath, requestHandler) {
    this.routes.set(`${httpMethod}:${routePath}`, requestHandler);
  }

  handleRequest(nativeReq, nativeRes) {
    // Create Request/Response wrappers for consistent API
    const req = new Request(nativeReq, this);
    const res = new Response(nativeRes, this);
    
    const key = `${nativeReq.method}:${nativeReq.url}`;
    const handler = this.routes.get(key);
    
    if (handler) {
      try {
        handler(req, res);
      } catch (err) {
        const statusCode = err.statusCode || err.status || 500;
        res.status(statusCode).send(err.message || 'Internal Server Error');
      }
    } else {
      res.status(404).send('Route Not Found');
    }
  }

  get(routePath, requestHandler) {
    this.addRoute("GET", routePath, requestHandler);
    return this;
  }

  post(routePath, requestHandler) {
    this.addRoute("POST", routePath, requestHandler);
    return this;
  }

  put(routePath, requestHandler) {
    this.addRoute("PUT", routePath, requestHandler);
    return this;
  }

  delete(routePath, requestHandler) {
    this.addRoute("DELETE", routePath, requestHandler);
    return this;
  }

  patch(routePath, requestHandler) {
    this.addRoute("PATCH", routePath, requestHandler);
    return this;
  }
}

module.exports = SimpleRouter;