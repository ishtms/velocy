class SimpleRouter {
  constructor() {
    this.routes = new Map();
  }

  addRoute(httpMethod, routePath, requestHandler) {
    this.routes.set(routePath, requestHandler);
  }

  handleRequest(req, res) {
    this.routes.get(req.url)(req, res);
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