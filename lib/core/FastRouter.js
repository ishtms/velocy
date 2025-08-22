/**
 * Fast Router - Zero-cost abstraction implementation using a radix tree structure.
 * Only pay for features you use. Built for maximum performance with minimal overhead
 * by using a tree-based routing algorithm that avoids regex compilation costs.
 * 
 * @class FastRouter
 * @since 1.0.0
 * @example
 * const router = new FastRouter();
 * router.get('/users/:id', (req, res) => {
 *   res.json({ userId: req.params.id });
 * });
 */

const Request = require('./Request');
const Response = require('./Response');

/**
 * Internal route tree node representing a single path segment in the routing tree.
 * Using a radix tree structure for O(log n) lookup performance instead of O(n) linear search.
 * Object.create(null) is used to avoid prototype pollution and improve performance.
 * 
 * @class RouteNode
 * @private
 */
class RouteNode {
  /**
   * Creates a new route node with null prototype objects for better performance
   * and security (avoiding prototype pollution attacks).
   */
  constructor() {
    /** @type {Object.<string, Function>} HTTP method to handler function mapping */
    this.handler = Object.create(null);
    
    /** @type {Object.<string, RouteNode>} Static route segments mapping */
    this.children = Object.create(null);
    
    /** @type {RouteNode|null} Parametric route node (for :param segments) */
    this.param = null;
    
    /** @type {string|null} Parameter name for this node (without the ':' prefix) */
    this.paramName = null;
  }
}

/**
 * High-performance HTTP router implementation using a radix tree for optimal route matching.
 * Designed for zero-cost abstraction - you only pay for the routes you define.
 * 
 * @class FastRouter
 */
class FastRouter {
  /**
   * Creates a new FastRouter instance with an empty route tree.
   * The root node serves as the entry point for all route lookups.
   */
  constructor() {
    /** @type {RouteNode} Root node of the routing tree */
    this.rootNode = new RouteNode();
  }

  /**
   * Adds a new route to the routing tree. Uses a radix tree structure for efficient
   * route matching without regex compilation overhead. Supports parameterized routes
   * with colon syntax (e.g., '/users/:id').
   * 
   * @param {string} httpMethod - HTTP method (GET, POST, PUT, DELETE, PATCH)
   * @param {string} routePath - Route pattern, may include parameters like '/users/:id'
   * @param {Function} requestHandler - Handler function(req, res) to execute for this route
   * @throws {TypeError} If httpMethod is not a string or requestHandler is not a function
   * @example
   * router.addRoute('GET', '/users/:id/posts/:postId', (req, res) => {
   *   const { id, postId } = req.params;
   *   // Handle the request
   * });
   */
  addRoute(httpMethod, routePath, requestHandler) {
    let currentNode = this.rootNode;
    let pathStart = 1,  // Skip the leading '/'
      pathEnd = 1,
      pathLength = routePath.length;
    
    // Parse path segments by walking through the route character by character
    // This approach avoids split() allocation overhead for better performance
    for (; pathEnd <= pathLength; ++pathEnd) {
      if (pathEnd === pathLength || routePath[pathEnd] === "/") {
        let pathSegment = routePath.substring(pathStart, pathEnd);
        let nextNode;
        
        // Handle parameterized routes (segments starting with ':')
        if (pathSegment[0] === ":") {
          if (!currentNode.param) {
            currentNode.param = new RouteNode();
            currentNode.param.paramName = pathSegment.substring(1); // Remove the ':'
          }
          nextNode = currentNode.param;
        } else {
          // Handle static route segments with lazy node creation
          nextNode = currentNode.children[pathSegment] || (currentNode.children[pathSegment] = new RouteNode());
        }
        currentNode = nextNode;
        pathStart = pathEnd + 1;
      }
    }
    
    // Store the handler at the leaf node for this specific HTTP method
    currentNode.handler[httpMethod] = requestHandler;
  }

  handleRequest(nativeReq, nativeRes) {
    const { method, url } = nativeReq;
    const queryDelimiter = url.indexOf("?");
    const routePath = queryDelimiter === -1 ? url : url.substring(0, queryDelimiter);
    const routeHandler = this.#findRouteHandler(method, routePath);

    // Create Request/Response wrappers for consistent API
    const req = new Request(nativeReq, this);
    const res = new Response(nativeRes, this);

    if (!routeHandler) {
      res.status(404).send("Route Not Found");
      return;
    }

    req.params = routeHandler.extractedParams;
    req.queryParams = new URLSearchParams(queryDelimiter === -1 ? "" : url.substring(queryDelimiter));

    const routeHandlerFunc = routeHandler.requestHandler;

    if (typeof routeHandlerFunc === "function") {
      try {
        // Call handler - if it returns a promise, handle async
        const result = routeHandlerFunc(req, res);
        if (result && typeof result.then === 'function') {
          result.catch(err => {
            const statusCode = err.statusCode || err.status || 500;
            res.status(statusCode).send(process.env.NODE_ENV === 'production' 
              ? (statusCode === 500 ? 'Internal Server Error' : err.message || 'Error')
              : err.stack || err.toString());
          });
        }
      } catch (err) {
        const statusCode = err.statusCode || err.status || 500;
        res.status(statusCode).send(process.env.NODE_ENV === 'production' 
          ? (statusCode === 500 ? 'Internal Server Error' : err.message || 'Error')
          : err.stack || err.toString());
      }
    } else {
      res.status(404).send("Route Not Found");
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