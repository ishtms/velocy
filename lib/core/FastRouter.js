/**
 * Fast Router - Zero-cost abstraction implementation
 * Only pay for features you use
 */

class RouteNode {
  constructor() {
    this.handler = Object.create(null);
    this.children = Object.create(null);
    this.param = null;
    this.paramName = null;
  }
}

class FastRouter {
  constructor() {
    this.rootNode = new RouteNode();
  }

  addRoute(httpMethod, routePath, requestHandler) {
    let currentNode = this.rootNode;
    let pathStart = 1,
      pathEnd = 1,
      pathLength = routePath.length;
    for (; pathEnd <= pathLength; ++pathEnd) {
      if (pathEnd === pathLength || routePath[pathEnd] === "/") {
        let pathSegment = routePath.substring(pathStart, pathEnd);
        let nextNode;
        if (pathSegment[0] === ":") {
          if (!currentNode.param) {
            currentNode.param = new RouteNode();
            currentNode.param.paramName = pathSegment.substring(1);
          }
          nextNode = currentNode.param;
        } else {
          nextNode = currentNode.children[pathSegment] || (currentNode.children[pathSegment] = new RouteNode());
        }
        currentNode = nextNode;
        pathStart = pathEnd + 1;
      }
    }
    currentNode.handler[httpMethod] = requestHandler;
  }

  handleRequest(nativeReq, nativeRes) {
    const { method, url } = nativeReq;
    const queryDelimiter = url.indexOf("?");
    const routePath = queryDelimiter === -1 ? url : url.substring(0, queryDelimiter);
    const routeHandler = this.#findRouteHandler(method, routePath);

    if (!routeHandler) {
      nativeRes.writeHead(404);
      nativeRes.end("Route Not Found");
      return;
    }

    nativeReq.params = routeHandler.extractedParams;
    nativeReq.queryParams = new URLSearchParams(queryDelimiter === -1 ? "" : url.substring(queryDelimiter));

    const routeHandlerFunc = routeHandler.requestHandler;

    if (typeof routeHandlerFunc === "function") {
      try {
        // Call handler - if it returns a promise, handle async
        const result = routeHandlerFunc(nativeReq, nativeRes);
        if (result && typeof result.then === 'function') {
          result.catch(err => {
            const statusCode = err.statusCode || err.status || 500;
            nativeRes.writeHead(statusCode);
            nativeRes.end(process.env.NODE_ENV === 'production' 
              ? (statusCode === 500 ? 'Internal Server Error' : err.message || 'Error')
              : err.stack || err.toString());
          });
        }
      } catch (err) {
        const statusCode = err.statusCode || err.status || 500;
        nativeRes.writeHead(statusCode);
        nativeRes.end(process.env.NODE_ENV === 'production' 
          ? (statusCode === 500 ? 'Internal Server Error' : err.message || 'Error')
          : err.stack || err.toString());
      }
    } else {
      nativeRes.writeHead(404);
      nativeRes.end("Route Not Found");
    }
  }

  #findRouteHandler(httpMethod, routePath) {
    let currentNode = this.rootNode;
    let extractedParams = Object.create(null);
    let pathStart = 1;
    const pathLength = routePath.length;

    for (let pathEnd = 1; pathEnd <= pathLength; ++pathEnd) {
      if (pathEnd === pathLength || routePath[pathEnd] === "/") {
        const pathSegment = routePath.substring(pathStart, pathEnd);
        let nextNode = currentNode.children[pathSegment];

        if (!nextNode && currentNode.param) {
          nextNode = currentNode.param;
          extractedParams[currentNode.param.paramName] = pathSegment;
        }

        if (!nextNode) return null;

        currentNode = nextNode;
        pathStart = pathEnd + 1;
      }
    }

    if (!currentNode.handler[httpMethod]) return null;
    return { requestHandler: currentNode.handler[httpMethod], extractedParams };
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

module.exports = FastRouter;