const Request = require('./Request');
const Response = require('./Response');

/**
 * Minimal HTTP router implementation using Map-based exact route matching.
 * Designed for simplicity and scenarios where route parameters are not needed.
 * Trades flexibility for simplicity - no support for dynamic routes, wildcards, 
 * or middleware, but offers predictable O(1) route lookup performance.
 * 
 * This router is ideal for static route scenarios, API endpoints with fixed paths,
 * or applications where routing complexity is handled at a higher level.
 * 
 * @class SimpleRouter
 * @example
 * const router = new SimpleRouter();
 * router.get('/health', (req, res) => res.send('OK'));
 * router.post('/webhook/stripe', handleStripeWebhook);
 */
class SimpleRouter {
  /**
   * Creates a new SimpleRouter instance with an empty route map.
   * Uses a Map for O(1) route lookup by combining HTTP method and path as key.
   * 
   * @constructor
   */
  constructor() {
    /**
     * @type {Map<string, Function>}
     * @description Route storage using "METHOD:PATH" as key for exact matching
     * @example "GET:/users" -> handlerFunction
     */
    this.routes = new Map();
  }

  /**
   * Registers a route handler for a specific HTTP method and exact path.
   * No support for parameters, wildcards, or pattern matching - uses exact string matching.
   * The route key format is "METHOD:PATH" for efficient Map-based lookup.
   * 
   * @param {string} httpMethod - HTTP method (GET, POST, PUT, DELETE, PATCH)
   * @param {string} routePath - Exact route path, must match request URL exactly
   * @param {Function} requestHandler - Handler function(req, res) to execute
   * @throws {TypeError} If httpMethod is not a string or requestHandler is not a function
   * @example
   * router.addRoute('GET', '/api/users', (req, res) => {
   *   res.json(users);
   * });
   */
  addRoute(httpMethod, routePath, requestHandler) {
    this.routes.set(`${httpMethod}:${routePath}`, requestHandler);
  }

  /**
   * Processes incoming HTTP requests using exact route matching.
   * Creates Request/Response wrapper objects for consistent API across router implementations.
   * No middleware support - handlers are called directly if route matches.
   * 
   * @param {IncomingMessage} nativeReq - Node.js native request object
   * @param {ServerResponse} nativeRes - Node.js native response object
   * @returns {void}
   * @example
   * const server = http.createServer((req, res) => {
   *   router.handleRequest(req, res);
   * });
   */
  handleRequest(nativeReq, nativeRes) {
    // Create Request/Response wrappers for consistent API across router types
    const req = new Request(nativeReq, this);
    const res = new Response(nativeRes, this);
    
    // Build exact match key from method and full URL (including query string)
    // This means '/users?id=1' and '/users' are treated as different routes
    const key = `${nativeReq.method}:${nativeReq.url}`;
    const handler = this.routes.get(key);
    
    if (handler) {
      try {
        // Execute handler directly - no middleware chain or parameter extraction
        handler(req, res);
      } catch (err) {
        // Basic error handling without sophisticated error middleware support
        const statusCode = err.statusCode || err.status || 500;
        res.status(statusCode).send(err.message || 'Internal Server Error');
      }
    } else {
      res.status(404).send('Route Not Found');
    }
  }

  /**
   * Registers a GET route handler for the exact specified path.
   * 
   * @param {string} routePath - Exact route path that must match the request URL
   * @param {Function} requestHandler - Handler function to execute for GET requests
   * @returns {SimpleRouter} Returns this router instance for method chaining
   * @example
   * router.get('/health', (req, res) => res.send('OK'));
   */
  get(routePath, requestHandler) {
    this.addRoute("GET", routePath, requestHandler);
    return this;
  }

  /**
   * Registers a POST route handler for the exact specified path.
   * 
   * @param {string} routePath - Exact route path that must match the request URL
   * @param {Function} requestHandler - Handler function to execute for POST requests
   * @returns {SimpleRouter} Returns this router instance for method chaining
   * @example
   * router.post('/api/users', (req, res) => {
   *   // Create user logic
   * });
   */
  post(routePath, requestHandler) {
    this.addRoute("POST", routePath, requestHandler);
    return this;
  }

  /**
   * Registers a PUT route handler for the exact specified path.
   * 
   * @param {string} routePath - Exact route path that must match the request URL
   * @param {Function} requestHandler - Handler function to execute for PUT requests
   * @returns {SimpleRouter} Returns this router instance for method chaining
   * @example
   * router.put('/api/users/123', (req, res) => {
   *   // Update specific user logic
   * });
   */
  put(routePath, requestHandler) {
    this.addRoute("PUT", routePath, requestHandler);
    return this;
  }

  /**
   * Registers a DELETE route handler for the exact specified path.
   * 
   * @param {string} routePath - Exact route path that must match the request URL
   * @param {Function} requestHandler - Handler function to execute for DELETE requests
   * @returns {SimpleRouter} Returns this router instance for method chaining
   * @example
   * router.delete('/api/users/123', (req, res) => {
   *   // Delete specific user logic
   * });
   */
  delete(routePath, requestHandler) {
    this.addRoute("DELETE", routePath, requestHandler);
    return this;
  }

  /**
   * Registers a PATCH route handler for the exact specified path.
   * 
   * @param {string} routePath - Exact route path that must match the request URL
   * @param {Function} requestHandler - Handler function to execute for PATCH requests
   * @returns {SimpleRouter} Returns this router instance for method chaining
   * @example
   * router.patch('/api/users/123', (req, res) => {
   *   // Partially update specific user logic
   * });
   */
  patch(routePath, requestHandler) {
    this.addRoute("PATCH", routePath, requestHandler);
    return this;
  }
}

module.exports = SimpleRouter;