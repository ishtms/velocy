const Request = require('./Request');
const Response = require('./Response');

/**
 * Route tree node for efficient routing with support for parameters, wildcards, and catch-all routes.
 * Uses a tree structure for fast route matching with O(segments) complexity.
 * Each node can have static children, one parameter node, wildcard nodes, and catch-all nodes.
 * 
 * @class RouteNode
 */
class RouteNode {
  /**
   * Creates a new route tree node.
   * Organizes route matching with different node types for optimal performance.
   * Static routes are fastest, then parameters, then wildcards.
   * 
   * @constructor
   */
  constructor() {
    /**
     * @type {Object<string, Function|Function[]>}
     * @description HTTP method handlers (GET, POST, etc.)
     */
    this.handler = Object.create(null);
    
    /**
     * @type {Object<string, RouteNode>}
     * @description Static child segments
     */
    this.children = Object.create(null);
    
    /**
     * @type {RouteNode|null}
     * @description Parameter node (:param)
     */
    this.param = null;
    
    /**
     * @type {string|null}
     * @description Parameter name for capturing
     */
    this.paramName = null;
    
    /**
     * @type {RouteNode|null}
     * @description Single-segment wildcard (*) node
     */
    this.wildcard = null;
    
    /**
     * @type {string|null}
     * @description Name for capturing wildcard value (optional)
     */
    this.wildcardName = null;
    
    /**
     * @type {RouteNode|null}
     * @description Multi-segment wildcard (**) node
     */
    this.catchAll = null;
    
    /**
     * @type {string|null}
     * @description Name for capturing catch-all value (optional)
     */
    this.catchAllName = null;
    
    /**
     * @type {boolean}
     * @description Indicates if this node represents a pattern like *.js
     * @default false
     */
    this.isPattern = false;
  }
}

/**
 * High-performance HTTP router with radix tree implementation.
 * Uses a radix tree (compressed trie) for O(log n) route lookup with support for
 * parameters, wildcards, middleware, and advanced features like caching and performance monitoring.
 * The router is designed for zero-cost abstractions - features are only loaded when used.
 * 
 * @class Router
 * @example
 * const router = new Router({ performance: true, cache: true });
 * 
 * // Basic routing
 * router.get('/users/:id', (req, res) => {
 *   res.json({ id: req.params.id });
 * });
 * 
 * // Middleware
 * router.use('/api', authMiddleware);
 * router.useError(errorHandler);
 * 
 * // Nested routers
 * const apiRouter = new Router();
 * router.nest('/api', apiRouter);
 */
class Router {
  /**
   * Creates a new Router instance with optional performance optimizations.
   * Uses lazy initialization for features to keep the router lightweight
   * when advanced features aren't needed. Performance features are opt-in.
   * 
   * @constructor
   * @param {Object} [options={}] - Router configuration options
   * @param {string} [options.cookieSecret] - Secret for signed cookies
   * @param {boolean} [options.performance=false] - Enable performance monitoring
   * @param {boolean} [options.cache=false] - Enable route and URL caching
   * @param {number} [options.routeCacheSize=500] - Route cache size
   * @param {number} [options.urlCacheSize=200] - URL parsing cache size
   * @param {Object} [options.websocket] - WebSocket configuration
   */
  constructor(options = {}) {
    /**
     * @type {RouteNode}
     * @description Root node of the route tree
     */
    this.rootNode = new RouteNode();
    
    // Lazy-loaded features - only initialized when used
    /**
     * @type {Function[]|null}
     * @private
     */
    this._globalMiddleware = null;
    
    /**
     * @type {Map<string, Function[]>|null}
     * @private
     */
    this._pathMiddleware = null;
    
    /**
     * @type {Function[]|null}
     * @private
     */
    this._errorMiddleware = null;
    
    /**
     * @type {string|null}
     * @private
     */
    this._cookieSecret = options.cookieSecret || null;
    
    /**
     * @type {Object|null}
     * @private
     */
    this._viewEngine = null;
    
    /**
     * @type {Object|null}
     * @private
     */
    this._wsRouter = null;
    
    /**
     * @type {Object}
     * @private
     */
    this._wsOptions = options.websocket || {};
    
    /**
     * @type {Object|null}
     * @private
     */
    this._settings = null;
    
    /**
     * @type {Object|null}
     * @private
     */
    this._locals = null;
    
    // Performance features - disabled by default for zero cost
    /**
     * @type {boolean}
     * @private
     */
    this._performanceEnabled = options.performance === true;
    
    /**
     * @type {boolean}
     * @private
     */
    this._cacheEnabled = options.cache === true;
    
    /**
     * @type {Object|null}
     * @private
     */
    this._routeCache = null;
    
    /**
     * @type {Object|null}
     * @private
     */
    this._urlCache = null;
    
    /**
     * @type {Object|null}
     * @private
     */
    this._stringInterner = null;
    
    /**
     * @type {Object|null}
     * @private
     */
    this._paramsPool = null;
    
    /**
     * @type {Map|null}
     * @private
     */
    this._regexCache = null;
    
    /**
     * @type {Object|null}
     * @private
     */
    this._performanceHooks = null;
    
    /**
     * @type {Map|null}
     * @private
     */
    this._normalizedPaths = null;
    
    /**
     * @type {Array|null}
     * @private
     */
    this._pathSegmentBuffer = null;
    
    /**
     * @type {Map|null}
     * @private
     */
    this._exactRoutes = null;
    
    // Only initialize performance features if explicitly enabled
    if (this._performanceEnabled || this._cacheEnabled) {
      this.#initializePerformanceOptimizations(options);
    }
  }

  /**
   * Lazy getter for global middleware array.
   * Creates the array only when first accessed to minimize memory usage.
   * Global middleware runs on every request before route-specific handlers.
   * 
   * @returns {Function[]} Array of global middleware functions
   * @private
   */
  get globalMiddleware() {
    if (!this._globalMiddleware) this._globalMiddleware = [];
    return this._globalMiddleware;
  }

  /**
   * Lazy getter for path-specific middleware map.
   * Creates the map only when first accessed for memory efficiency.
   * Path middleware runs only for requests matching specific path prefixes.
   * 
   * @returns {Map<string, Function[]>} Map of path to middleware arrays
   * @private
   */
  get pathMiddleware() {
    if (!this._pathMiddleware) this._pathMiddleware = new Map();
    return this._pathMiddleware;
  }

  /**
   * Lazy getter for error middleware array.
   * Creates the array only when first accessed.
   * Error middleware handles errors that occur during request processing.
   * 
   * @returns {Function[]} Array of error middleware functions
   * @private
   */
  get errorMiddleware() {
    if (!this._errorMiddleware) this._errorMiddleware = [];
    return this._errorMiddleware;
  }

  /**
   * Lazy getter for view engine instance.
   * Creates and configures the view engine only when first accessed.
   * Applies saved settings like view cache and view paths.
   * 
   * @returns {ViewEngine} Configured view engine instance
   */
  get viewEngine() {
    if (!this._viewEngine) {
      const ViewEngine = require('../utils/viewEngine');
      this._viewEngine = new ViewEngine();
      
      // Initialize settings if needed
      if (this._settings) {
        this._viewEngine.setCaching(this._settings['view cache']);
        this._viewEngine.setViewPaths([this._settings['views']]);
      }
      
      // Register the built-in simple template engine as fallback
      this._viewEngine.registerEngine('html', ViewEngine.simpleEngine());
    }
    return this._viewEngine;
  }

  /**
   * Lazy getter for WebSocket router.
   * Creates the WebSocket router only when WebSocket routes are defined.
   * Passes through WebSocket configuration options from constructor.
   * 
   * @returns {WebSocketRouter} WebSocket router instance
   */
  get wsRouter() {
    if (!this._wsRouter) {
      const WebSocketRouter = require('./WebSocketRouter');
      this._wsRouter = new WebSocketRouter(this._wsOptions);
    }
    return this._wsRouter;
  }

  /**
   * Lazy getter for router settings object.
   * Initializes with sensible defaults based on environment.
   * View caching is enabled in production for better performance.
   * 
   * @returns {Object} Settings object
   */
  get settings() {
    if (!this._settings) {
      const path = require('node:path');
      this._settings = Object.create(null);
      // Enable view caching in production for better performance
      this._settings['view cache'] = process.env.NODE_ENV === 'production';
      this._settings['views'] = path.resolve(process.cwd(), 'views');
      this._settings['view engine'] = null;
    }
    return this._settings;
  }

  /**
   * Lazy getter for locals object.
   * Locals are variables available to all views rendered by this router.
   * Useful for passing common data like site title, user info, etc.
   * 
   * @returns {Object} Locals object for view rendering
   */
  get locals() {
    if (!this._locals) this._locals = Object.create(null);
    return this._locals;
  }

  /**
   * Gets the cookie secret used for signing cookies.
   * Required for signed cookies to prevent tampering.
   * 
   * @returns {string|null} Cookie secret or null if not set
   */
  get cookieSecret() {
    return this._cookieSecret;
  }

  /**
   * Sets the cookie secret for signing cookies.
   * Should be a long, random string kept secret.
   * 
   * @param {string} value - Secret string for cookie signing
   */
  set cookieSecret(value) {
    this._cookieSecret = value;
  }

  /**
   * Initializes performance optimization components when enabled.
   * Sets up route caching, URL parsing cache, string interning, and performance monitoring.
   * Only called if performance or cache options are enabled to maintain zero-cost abstraction.
   * 
   * @param {Object} options - Performance configuration options
   * @param {number} [options.routeCacheSize=500] - Maximum cached routes
   * @param {number} [options.urlCacheSize=200] - Maximum cached URL parses
   * @param {boolean|Object} [options.performance] - Performance monitoring config
   * @private
   */
  #initializePerformanceOptimizations(options) {
    const { RouteCache, URLParseCache, ObjectPool, StringInterner } = require('../utils/cache');
    
    // Route caching
    const cacheSize = options.routeCacheSize || 500;
    this._routeCache = new RouteCache(cacheSize);
    
    // URL parsing cache
    this._urlCache = new URLParseCache(options.urlCacheSize || 200);
    
    // String interning for common strings
    this._stringInterner = new StringInterner(500);
    
    // Object pools for request/response objects
    // Disabled params pool due to frozen object issues
    // When params are frozen in Request.js, they can't be reused
    this._paramsPool = null;
    
    // Pre-compiled regex cache
    this._regexCache = new Map();
    
    // Performance monitoring
    if (options.performance) {
      const { createPerformanceHooks } = require('../utils/performance');
      this._performanceHooks = createPerformanceHooks(options.performance);
    }
    
    // Path normalization cache
    this._normalizedPaths = new Map();
    
    // Pre-allocated arrays for path splitting
    this._pathSegmentBuffer = new Array(20); // Most paths have < 20 segments
    
    // Fast exact match map for static routes
    this._exactRoutes = new Map();
    this.#buildExactRoutesMap();
  }

  /**
   * Builds a fast lookup map for exact (static) routes.
   * Static routes without parameters can be matched in O(1) time using this map.
   * Called whenever routes are added or modified.
   * 
   * @private
   */
  #buildExactRoutesMap() {
    if (!this._exactRoutes) return;
    this._exactRoutes.clear();
    this.#traverseForExactRoutes(this.rootNode, '');
  }

  /**
   * Recursively traverses the route tree to find all exact static routes.
   * Populates the exact routes map for O(1) lookups of static paths.
   * Only processes static children, skipping parameter and wildcard nodes.
   * 
   * @param {RouteNode} node - Current node in traversal
   * @param {string} currentPath - Path built up to current node
   * @private
   */
  #traverseForExactRoutes(node, currentPath) {
    // Store handlers for current path
    for (const [method, handler] of Object.entries(node.handler)) {
      const key = `${method}:${currentPath || '/'}`;
      // Use requestHandler to match the structure returned by #findRouteHandler
      this._exactRoutes.set(key, { requestHandler: handler, extractedParams: {} });
    }
    
    // Only traverse static children (not params, wildcards)
    for (const [segment, child] of Object.entries(node.children)) {
      if (!child.isPattern && !segment.includes(':') && !segment.includes('*')) {
        const childPath = currentPath + '/' + segment;
        this.#traverseForExactRoutes(child, childPath);
      }
    }
  }

  /**
   * Recursively generates prefixed routes from a node tree.
   * Used for nesting routers with a path prefix.
   * Preserves all route types including parameters and wildcards.
   * 
   * @param {RouteNode} currentNode - Node to generate routes from
   * @param {string} currentPrefix - Current path prefix
   * @param {Router} newRouter - Router to add generated routes to
   * @private
   */
  #generateNestedRoutes(currentNode, currentPrefix, newRouter) {
    for (const [method, handler] of Object.entries(currentNode.handler)) {
      newRouter.addRoute(method, currentPrefix, handler);
    }
    for (const [pathSegment, subNode] of Object.entries(currentNode.children)) {
      // Preserve pattern nodes when generating nested routes
      const nestedPath = `${currentPrefix}/${pathSegment}`;
      this.#generateNestedRoutes(subNode, nestedPath, newRouter);
      // Transfer pattern flag if present
      if (subNode.isPattern) {
        const segments = nestedPath.split('/');
        let node = newRouter.rootNode;
        for (let i = 1; i < segments.length; i++) {
          const seg = segments[i];
          if (i === segments.length - 1 && seg.includes('*')) {
            // Mark the final node as a pattern
            if (node.children[seg]) {
              node.children[seg].isPattern = true;
            }
          }
          node = node.children[seg] || node.param || node.wildcard || node.catchAll;
          if (!node) break;
        }
      }
    }
    if (currentNode.param) {
      this.#generateNestedRoutes(currentNode.param, `${currentPrefix}/:${currentNode.param.paramName}`, newRouter);
    }
    // Handle wildcard nodes in nested routes
    if (currentNode.wildcard) {
      const wildcardPath = currentNode.wildcardName === "*" ? "*" : `*${currentNode.wildcardName}`;
      this.#generateNestedRoutes(currentNode.wildcard, `${currentPrefix}/${wildcardPath}`, newRouter);
    }
    if (currentNode.catchAll) {
      const catchAllPath = currentNode.catchAllName === "**" ? "**" : `**${currentNode.catchAllName}`;
      this.#generateNestedRoutes(currentNode.catchAll, `${currentPrefix}/${catchAllPath}`, newRouter);
    }
  }

  /**
   * Adds a route to the router's tree structure with optimized path parsing.
   * Handles parameters (:param), wildcards (*), catch-all (**), and pattern matching (*.js).
   * Using a tree structure provides O(segments) lookup time rather than O(routes).
   * 
   * @param {string} httpMethod - HTTP method (GET, POST, PUT, DELETE, etc.)
   * @param {string} routePath - Path pattern with support for parameters and wildcards
   * @param {...Function} handlers - One or more handler functions to execute for this route
   * @throws {Error} If no handlers are provided for the route
   * @example
   * // Simple route
   * router.addRoute('GET', '/users', getUsersHandler);
   * 
   * // Route with parameter
   * router.addRoute('GET', '/users/:id', getUserByIdHandler);
   * 
   * // Route with multiple handlers (middleware chain)
   * router.addRoute('POST', '/api/users', authMiddleware, validateUser, createUser);
   * 
   * // Wildcard patterns
   * router.addRoute('GET', '/static/*.js', serveJavaScript);
   * router.addRoute('GET', '/api/**', catchAllApiHandler);
   */
  addRoute(httpMethod, routePath, ...handlers) {
    // Invalidate caches when routes change - cache invalidation is necessary
    // because we build optimized lookup structures that become stale
    if (this._routeCache) this._routeCache.invalidate();
    if (this._exactRoutes) this.#buildExactRoutesMap();
    
    // Support both variadic arguments and array of handlers
    const handlerChain = handlers.length === 1 && Array.isArray(handlers[0]) 
      ? handlers[0] 
      : handlers;
    
    // Ensure at least one handler is provided
    if (handlerChain.length === 0) {
      throw new Error(`No handler provided for route ${httpMethod} ${routePath}`);
    }
    
    let currentNode = this.rootNode;
    
    // Root route requires special handling due to empty path segments
    if (routePath === '/') {
      currentNode.handler[httpMethod] = handlerChain.length === 1 ? handlerChain[0] : handlerChain;
      return;
    }
    
    let pathStart = 1,
      pathEnd = 1,
      pathLength = routePath.length;
    for (; pathEnd <= pathLength; ++pathEnd) {
      if (pathEnd === pathLength || routePath[pathEnd] === "/") {
        let pathSegment = routePath.substring(pathStart, pathEnd);
        let nextNode;
        
        // Check for segments containing wildcards with static parts (e.g., *.js, prefix*, *suffix)
        const wildcardIndex = pathSegment.indexOf('*');
        if (wildcardIndex !== -1 && pathSegment !== '*' && pathSegment !== '**' && !pathSegment.startsWith('*')) {
          // Complex wildcard pattern with static parts - store as special pattern node
          // For now, treat these as static segments with wildcard matching done at runtime
          // This maintains compatibility while allowing patterns like *.js
          nextNode = currentNode.children[pathSegment] || (currentNode.children[pathSegment] = new RouteNode());
          nextNode.isPattern = true;  // Mark as pattern for special handling
        }
        // Check for catch-all wildcard (**)
        else if (pathSegment === "**") {
          if (!currentNode.catchAll) {
            currentNode.catchAll = new RouteNode();
            currentNode.catchAllName = "**";  // Default name for catch-all
          }
          nextNode = currentNode.catchAll;
        }
        // Check for single-segment wildcard (*)
        else if (pathSegment === "*") {
          // Check if this is truly the last segment (no more slashes after)
          const isLastSegment = pathEnd === pathLength;
          const hasMoreSegmentsAfter = pathEnd < pathLength && routePath.indexOf('/', pathEnd) !== -1;
          
          // Treat * as catch-all only if it's the absolute last segment of the route
          if (isLastSegment && !hasMoreSegmentsAfter) {
            if (!currentNode.catchAll) {
              currentNode.catchAll = new RouteNode();
              currentNode.catchAllName = "*";  // Use * as catch-all name
            }
            nextNode = currentNode.catchAll;
          } else {
            if (!currentNode.wildcard) {
              currentNode.wildcard = new RouteNode();
              currentNode.wildcardName = "*";  // Default name for wildcard
            }
            nextNode = currentNode.wildcard;
          }
        }
        // Check for named wildcards like *filename or **path
        else if (pathSegment.startsWith("**")) {
          if (!currentNode.catchAll) {
            currentNode.catchAll = new RouteNode();
            currentNode.catchAllName = pathSegment.substring(2) || "**";  // Extract name after **
          }
          nextNode = currentNode.catchAll;
        }
        else if (pathSegment.startsWith("*")) {
          if (!currentNode.wildcard) {
            currentNode.wildcard = new RouteNode();
            currentNode.wildcardName = pathSegment.substring(1) || "*";  // Extract name after *
          }
          nextNode = currentNode.wildcard;
        }
        // Check for parameters
        else if (pathSegment[0] === ":") {
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
    
    currentNode.handler[httpMethod] = handlerChain.length === 1 ? handlerChain[0] : handlerChain;
  }

  /**
   * Recursively merges route tree nodes from one router into another.
   * Used internally for router composition through merge() and nest() operations.
   * Preserves all route types including parameters, wildcards, and patterns.
   * 
   * @param {RouteNode} currentNode - Target node to merge into
   * @param {RouteNode} nodeToMerge - Source node to merge from
   * @private
   */
  #mergeNodes(currentNode, nodeToMerge) {
    for (const [method, handler] of Object.entries(nodeToMerge.handler)) {
      currentNode.handler[method] = handler;
    }
    for (const [pathSegment, subNode] of Object.entries(nodeToMerge.children)) {
      if (!currentNode.children[pathSegment]) {
        currentNode.children[pathSegment] = new RouteNode();
      }
      this.#mergeNodes(currentNode.children[pathSegment], subNode);
      // Preserve pattern flag
      if (subNode.isPattern) {
        currentNode.children[pathSegment].isPattern = true;
      }
    }
    if (nodeToMerge.param) {
      if (!currentNode.param) {
        currentNode.param = new RouteNode();
        currentNode.param.paramName = nodeToMerge.param.paramName;
      }
      this.#mergeNodes(currentNode.param, nodeToMerge.param);
    }
    // Merge wildcard nodes
    if (nodeToMerge.wildcard) {
      if (!currentNode.wildcard) {
        currentNode.wildcard = new RouteNode();
        currentNode.wildcardName = nodeToMerge.wildcard.wildcardName || "*";
      }
      this.#mergeNodes(currentNode.wildcard, nodeToMerge.wildcard);
    }
    if (nodeToMerge.catchAll) {
      if (!currentNode.catchAll) {
        currentNode.catchAll = new RouteNode();
        currentNode.catchAllName = nodeToMerge.catchAll.catchAllName || "**";
      }
      this.#mergeNodes(currentNode.catchAll, nodeToMerge.catchAll);
    }
  }

  /**
   * Prints the complete route tree structure to console for debugging.
   * Useful for visualizing how routes are organized internally and
   * troubleshooting route matching issues.
   * 
   * @example
   * router.printTree();
   * // Output:
   * // Root
   * //   ├─ api
   * //     ├─ users
   * //       └─ [GET] ↠ getUsersHandler
   * //       ├─ :id
   * //         └─ [GET] ↠ getUserByIdHandler
   */
  printTree() {
    this.#printNode(this.rootNode, "Root");
  }

  /**
   * Recursively prints a route tree node and its children.
   * Helper method for printTree() that formats the output with proper indentation.
   * 
   * @param {RouteNode} node - Node to print
   * @param {string} prefix - Path prefix for this node
   * @param {number} [level=0] - Current depth level for indentation
   * @param {string} [prefixSymbol=""] - Symbol to use for tree visualization
   * @private
   */
  #printNode(node, prefix, level = 0, prefixSymbol = "") {
    let indentation = " ".repeat(level * 4);

    console.log(`${prefixSymbol ? `${indentation}${prefixSymbol} ${prefix || "/"}` : prefix}`);

    for (const [method, handler] of Object.entries(node.handler)) {
      const handlerName =
        handler.name ||
        handler
          .toString()
          .replace(/[\n]/g, "")
          .replace(/[\s]{2,}/g, " ")
          .substring(0, 30) + "...";
      console.log(`${indentation}    └─ [${method}] ↠  ${handlerName}`);
    }

    for (const [childPrefix, childNode] of Object.entries(node.children)) {
      this.#printNode(childNode, childPrefix, level + 1, "├─");
    }

    if (node.param) {
      this.#printNode(node.param, `:${node.param.paramName}`, level + 1, "├─");
    }
    
    if (node.wildcard) {
      const wildcardLabel = node.wildcardName === "*" ? "*" : `*${node.wildcardName}`;
      this.#printNode(node.wildcard, wildcardLabel, level + 1, "├─");
    }
    
    if (node.catchAll) {
      const catchAllLabel = node.catchAllName === "**" ? "**" : `**${node.catchAllName}`;
      this.#printNode(node.catchAll, catchAllLabel, level + 1, "├─");
    }
  }

  /**
   * Main request handler that processes incoming HTTP requests.
   * Implements a fast path for simple requests and a full-featured path for complex scenarios.
   * The fast path bypasses middleware and advanced features for maximum performance.
   * 
   * @param {http.IncomingMessage} nativeReq - Node.js native request object
   * @param {http.ServerResponse} nativeRes - Node.js native response object
   * @returns {Promise<void>} Resolves when request handling is complete
   * @example
   * const server = http.createServer((req, res) => {
   *   router.handleRequest(req, res);
   * });
   */
  async handleRequest(nativeReq, nativeRes) {
    try {
      // Fast path optimization: bypass middleware and features for simple requests
      // This significantly improves performance for basic route handling
      if (!this._globalMiddleware && !this._pathMiddleware && !this._errorMiddleware && !this._viewEngine && !this._performanceEnabled) {
        return this.#handleSimpleRequest(nativeReq, nativeRes);
      }
      
      const req = new Request(nativeReq, this);
      const res = new Response(nativeRes, this, nativeReq);

      if (this._performanceHooks?.beforeRequest) {
        this._performanceHooks.beforeRequest(req, res);
      }

      let middlewareIndex = 0;
      const globalMiddleware = this._globalMiddleware || [];
      const pathMiddleware = this._pathMiddleware;
      
      const pathMiddlewares = [];
      if (pathMiddleware) {
        const url = req.path || req.url;
        for (const [pathPrefix, middlewares] of pathMiddleware.entries()) {
          if (url.startsWith(pathPrefix)) {
            req.baseUrl = pathPrefix;
            pathMiddlewares.push(...middlewares);
          }
        }
      }
      
      const allMiddleware = [...globalMiddleware, ...pathMiddlewares];

      const next = async (err) => {
        if (err) {
          return this.#handleError(err, req, res);
        }

        if (middlewareIndex < allMiddleware.length) {
          const middleware = allMiddleware[middlewareIndex++];
          try {
            // Error middleware has 4 parameters, skip in normal flow
            if (middleware.length === 4) {
              return next();
            }
            await middleware(req, res, next);
          } catch (error) {
            next(error);
          }
        } else {
          const { method, url } = req;
          
          let routePath, queryString;
          if (this._urlCache) {
            const cached = this._urlCache.get(url);
            if (cached) {
              routePath = cached.path;
              queryString = cached.query;
            } else {
              const queryDelimiter = url.indexOf("?");
              routePath = queryDelimiter === -1 ? url : url.substring(0, queryDelimiter);
              queryString = queryDelimiter === -1 ? "" : url.substring(queryDelimiter);
              this._urlCache.set(url, { path: routePath, query: queryString });
            }
          } else {
            const queryDelimiter = url.indexOf("?");
            routePath = queryDelimiter === -1 ? url : url.substring(0, queryDelimiter);
            queryString = queryDelimiter === -1 ? "" : url.substring(queryDelimiter);
          }
          
          let routeHandler;
          if (this._exactRoutes) {
            const exactKey = `${method}:${routePath}`;
            const exactMatch = this._exactRoutes.get(exactKey);
            if (exactMatch) {
              routeHandler = exactMatch;
            }
          }
          
          if (!routeHandler) {
            if (this._routeCache) {
              const cached = this._routeCache.get(method, routePath);
              
              if (cached) {
                // Create fresh params object to avoid frozen object issues
                const unfrozenParams = cached.params ? { ...cached.params } : {};
                routeHandler = {
                  handler: cached.handler,
                  requestHandler: cached.handler,
                  params: unfrozenParams,
                  extractedParams: unfrozenParams
                };
              } else {
                routeHandler = this.#findRouteHandler(method, routePath);
                if (routeHandler) {
                  this._routeCache.set(method, routePath, 
                    routeHandler.handler || routeHandler.requestHandler,
                    routeHandler.params || routeHandler.extractedParams);
                }
              }
            } else {
              routeHandler = this.#findRouteHandler(method, routePath);
            }
          }

          if (!routeHandler) {
            res.status(404).send("Route Not Found");
            return;
          }

          const sourceParams = routeHandler.params || routeHandler.extractedParams || {};
          let usedPoolForParams = false;
          
          if (this._paramsPool) {
            // Fresh object needed - pooled objects may be frozen from previous use
            const freshParams = Object.create(null);
            for (const key in sourceParams) {
              freshParams[key] = sourceParams[key];
            }
            req.params = freshParams;
            usedPoolForParams = false; // Don't return frozen objects to pool
          } else {
            // Create a new object to avoid frozen object issues when not using pool
            req.params = Object.assign(Object.create(null), sourceParams);
          }
          
          // Store whether we used the pool on the request object itself
          req._usedPoolForParams = usedPoolForParams;
          
          req.queryParams = new URLSearchParams(queryString);

          const handler = routeHandler.handler || routeHandler.requestHandler;
          
          // Always treat handlers as a chain, even if it's a single function
          const handlerChain = Array.isArray(handler) ? handler : [handler];
          
          if (handlerChain.length > 0 && typeof handlerChain[0] === "function") {
            let handlerIndex = 0;
            const routeNext = async (err) => {
              if (err) {
                return this.#handleError(err, req, res);
              }
              
              if (handlerIndex < handlerChain.length) {
                const h = handlerChain[handlerIndex++];
                try {
                  await h(req, res, routeNext);
                } catch (error) {
                  routeNext(error);
                }
              }
            };
            await routeNext();
          } else {
            res.status(404).send("Route Not Found");
          }
          
          if (this._paramsPool && req.params && req._usedPoolForParams) {
            this._paramsPool.return(req.params);
            req.params = null;
            req._usedPoolForParams = false;
          }
        }
      };

      await next();
      
      if (this._performanceHooks?.afterRequest) {
        this._performanceHooks.afterRequest(req, res);
      }
    } catch (err) {
      const res = nativeRes.status ? nativeRes : new Response(nativeRes, this, nativeReq);
      const req = nativeReq.params ? nativeReq : new Request(nativeReq, this);
      this.#handleError(err, req, res);
    }
  }

  /**
   * Optimized request handler for simple requests without middleware.
   * Bypasses the full middleware chain for better performance on basic routes.
   * Still creates Request/Response wrappers for consistent API.
   * 
   * @param {http.IncomingMessage} nativeReq - Node.js native request object
   * @param {http.ServerResponse} nativeRes - Node.js native response object
   * @returns {Promise<void>} Resolves when request handling is complete
   * @private
   */
  async #handleSimpleRequest(nativeReq, nativeRes) {
    const { method, url } = nativeReq;
    const queryDelimiter = url.indexOf("?");
    const routePath = queryDelimiter === -1 ? url : url.substring(0, queryDelimiter);
    const routeHandler = this.#findRouteHandler(method, routePath);

    const req = new Request(nativeReq, this);
    const res = new Response(nativeRes, this, nativeReq);

    if (!routeHandler) {
      res.status(404).send("Route Not Found");
      return;
    }

    req.params = routeHandler.extractedParams;
    req.queryParams = new URLSearchParams(queryDelimiter === -1 ? "" : url.substring(queryDelimiter));

    const handler = routeHandler.requestHandler;

    if (Array.isArray(handler)) {
      let handlerIndex = 0;
      const routeNext = async (err) => {
        if (err) {
          return this.#handleError(err, req, res);
        }
        
        if (handlerIndex < handler.length) {
          const h = handler[handlerIndex++];
          try {
            await h(req, res, routeNext);
          } catch (error) {
            routeNext(error);
          }
        }
      };
      await routeNext();
    } else if (typeof handler === "function") {
      try {
        const next = (err) => {
          if (err) {
            this.#handleError(err, req, res);
          }
        };
        await handler(req, res, next);
      } catch (err) {
        this.#handleError(err, req, res);
      }
    } else {
      res.status(404).send("Route Not Found");
    }
  }

  /**
   * Handles errors that occur during request processing.
   * Attempts to use registered error middleware first, falling back to default handler.
   * Error middleware is executed in sequence until one handles the error.
   * 
   * @param {Error} err - The error that occurred
   * @param {Request} req - Request object
   * @param {Response} res - Response object
   * @private
   */
  #handleError(err, req, res) {
    // Try error middleware first - error middleware can transform or handle errors
    // before they reach the default handler
    if (this._errorMiddleware && this._errorMiddleware.length > 0) {
      let errorIndex = 0;
      const errorNext = async (error) => {
        if (errorIndex < this._errorMiddleware.length) {
          const errorMiddleware = this._errorMiddleware[errorIndex++];
          try {
            await errorMiddleware(error || err, req, res, errorNext);
          } catch (newError) {
            errorNext(newError);
          }
        } else {
          this.#defaultErrorHandler(error || err, req, res);
        }
      };
      errorNext(err);
    } else {
      this.#defaultErrorHandler(err, req, res);
    }
  }

  /**
   * Default error handler that sends JSON error responses.
   * Handles ValidationError specially and includes stack traces in development.
   * Prevents double-sending responses if headers were already sent.
   * 
   * @param {Error} err - The error to handle
   * @param {Request} req - Request object
   * @param {Response} res - Response object
   * @private
   */
  #defaultErrorHandler(err, req, res) {
    const statusCode = err.statusCode || err.status || 500;
    
    if (res.headersSent || res.finished) {
      return;
    }
    
    if (err.isValidationError && err.toJSON) {
      res.status(statusCode).json(err.toJSON());
      return;
    }
    
    const errorResponse = {
      error: err.message || (statusCode === 500 ? 'Internal Server Error' : 'Error'),
      statusCode: statusCode
    };
    
    if (process.env.NODE_ENV !== 'production') {
      errorResponse.stack = err.stack;
    }
    
    if (err.code) {
      errorResponse.code = err.code;
    }
    
    res.status(statusCode).json(errorResponse);
  }

  /**
   * Checks if a URL segment matches a pattern containing wildcards.
   * Supports patterns like *.js, prefix*, *suffix, and *middle*.
   * Converts wildcard patterns to regex for flexible matching.
   * 
   * @param {string} pattern - Pattern that may contain wildcards (*)
   * @param {string} segment - URL segment to match against pattern
   * @returns {boolean} True if segment matches the pattern
   * @private
   * @example
   * this.#matchesPattern('*.js', 'bundle.js'); // true
   * this.#matchesPattern('api*', 'api-v2'); // true
   * this.#matchesPattern('*test*', 'my-test-file'); // true
   */
  #matchesPattern(pattern, segment) {
    // For patterns like *.js, prefix*, *suffix, or *middle*
    if (pattern.includes('*')) {
      // Convert pattern to regex
      const regexPattern = pattern
        .split('*')
        .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))  // Escape special regex chars
        .join('.*');  // Replace * with .*
      const regex = new RegExp(`^${regexPattern}$`);
      return regex.test(segment);
    }
    return pattern === segment;
  }

  /**
   * Finds the appropriate route handler for a given HTTP method and path.
   * Implements route precedence: exact > parameter > wildcard > catch-all.
   * Also handles HEAD requests by falling back to GET handlers.
   * 
   * @param {string} httpMethod - HTTP method to match
   * @param {string} routePath - Request path to match
   * @returns {Object|null} Route handler object with requestHandler and extractedParams, or null if no match
   * @private
   */
  #findRouteHandler(httpMethod, routePath) {
    let currentNode = this.rootNode;
    let extractedParams = Object.create(null);
    
    // HEAD requests fall back to GET handlers per HTTP spec
    const methodsToCheck = httpMethod === 'HEAD' ? ['HEAD', 'GET'] : [httpMethod];
    
    if (routePath === '/') {
      for (const method of methodsToCheck) {
        if (currentNode.handler[method]) {
          return {
            requestHandler: currentNode.handler[method],
            extractedParams: extractedParams
          };
        }
      }
      return null;
    }
    
    let pathStart = 1;
    const pathLength = routePath.length;
    let catchAllNode = null;
    let catchAllParams = null;
    let catchAllStart = -1;
    let wildcardIndex = 0;

    for (let pathEnd = 1; pathEnd <= pathLength; ++pathEnd) {
      if (pathEnd === pathLength || routePath[pathEnd] === "/") {
        const pathSegment = decodeURIComponent(routePath.substring(pathStart, pathEnd));
        let nextNode = null;
        
        nextNode = currentNode.children[pathSegment];
        
        if (!nextNode) {
          for (const [pattern, node] of Object.entries(currentNode.children)) {
            if (node.isPattern && this.#matchesPattern(pattern, pathSegment)) {
              nextNode = node;
              if (pattern.includes('*')) {
                const wildcardName = pattern.replace(/\*/g, '') || '*';
                extractedParams[wildcardName] = pathSegment;
              }
              break;
            }
          }
        }
        
        if (!nextNode && currentNode.param) {
          nextNode = currentNode.param;
          extractedParams[currentNode.param.paramName] = pathSegment;
        }
        
        if (!nextNode && currentNode.wildcard) {
          nextNode = currentNode.wildcard;
          const wildcardName = currentNode.wildcardName || "*";
          // Dual storage for compatibility: both named and indexed access
          if (wildcardName === "*") {
            extractedParams['*'] = pathSegment;
            extractedParams[wildcardIndex++] = pathSegment;
          } else {
            extractedParams[wildcardName] = pathSegment;
          }
        }
        
        if (currentNode.catchAll) {
          for (const method of methodsToCheck) {
            if (currentNode.catchAll.handler[method]) {
              catchAllNode = currentNode.catchAll;
              catchAllParams = { ...extractedParams };
              catchAllStart = pathStart;
              const catchAllName = currentNode.catchAllName || "**";
              const remainingPath = routePath.substring(pathStart);
              
              if (catchAllName === "*") {
                catchAllParams['*'] = remainingPath;
                catchAllParams[wildcardIndex] = remainingPath;
              } else {
                catchAllParams[catchAllName] = remainingPath;
              }
              break;
            }
          }
        }
        
        if (!nextNode) {
          if (catchAllNode) {
            return { 
              requestHandler: catchAllNode.handler[httpMethod], 
              extractedParams: catchAllParams 
            };
          }
          return null;
        }
        
        currentNode = nextNode;
        pathStart = pathEnd + 1;
      }
    }

    for (const method of methodsToCheck) {
      if (currentNode.handler[method]) {
        return { requestHandler: currentNode.handler[method], extractedParams };
      }
    }
    
    if (currentNode.catchAll) {
      for (const method of methodsToCheck) {
        if (currentNode.catchAll.handler[method]) {
          const catchAllName = currentNode.catchAllName || "**";
          const remainingPath = pathStart <= pathLength ? routePath.substring(pathStart) : "";
          
          if (catchAllName === "*") {
            extractedParams['*'] = remainingPath;
            extractedParams[wildcardIndex] = remainingPath;
          } else {
            extractedParams[catchAllName] = remainingPath;
          }
          
          return { 
            requestHandler: currentNode.catchAll.handler[method], 
            extractedParams 
          };
        }
      }
    }
    
    if (catchAllNode) {
      for (const method of methodsToCheck) {
        if (catchAllNode.handler[method]) {
          return { 
            requestHandler: catchAllNode.handler[method], 
            extractedParams: catchAllParams 
          };
        }
      }
    }
    
    return null;
  }

  /**
   * Adds middleware to the router with flexible syntax support.
   * Supports global middleware, path-specific middleware, and error middleware.
   * Middleware functions with 4 parameters are treated as error handlers.
   * 
   * @param {...(string|Function)} args - Path (optional) and middleware function(s)
   * @returns {Router} This router instance for method chaining
   * @example
   * // Global middleware
   * router.use(authMiddleware);
   * 
   * // Path-specific middleware
   * router.use('/api', authMiddleware);
   * 
   * // Multiple middleware
   * router.use('/admin', authMiddleware, adminCheck);
   * 
   * // Error middleware (4 parameters)
   * router.use((err, req, res, next) => {
   *   console.error(err);
   *   res.status(500).send('Error');
   * });
   */
  use(...args) {
    const isErrorMiddleware = (fn) => fn.length === 4;
    
    if (args.length === 1 && typeof args[0] === 'function') {
      if (isErrorMiddleware(args[0])) {
        if (!this._errorMiddleware) this._errorMiddleware = [];
        this._errorMiddleware.push(args[0]);
      } else {
        if (!this._globalMiddleware) this._globalMiddleware = [];
        this._globalMiddleware.push(args[0]);
      }
    } else if (args.length === 2 && typeof args[0] === 'string' && typeof args[1] === 'function') {
      // Path-specific middleware: use('/path', middleware)
      if (isErrorMiddleware(args[1])) {
        // Path-specific error middleware
        if (!this._errorMiddleware) this._errorMiddleware = [];
        this._errorMiddleware.push(args[1]);
      } else {
        if (!this._pathMiddleware) this._pathMiddleware = new Map();
        const path = args[0];
        if (!this._pathMiddleware.has(path)) {
          this._pathMiddleware.set(path, []);
        }
        this._pathMiddleware.get(path).push(args[1]);
      }
    } else if (args.length >= 2 && typeof args[0] === 'string') {
      // Path-specific with multiple middlewares: use('/path', middleware1, middleware2, ...)
      const path = args[0];
      const middlewares = args.slice(1);
      
      // Separate error and normal middleware
      const errorMiddlewares = middlewares.filter(isErrorMiddleware);
      const normalMiddlewares = middlewares.filter(m => !isErrorMiddleware(m));
      
      if (errorMiddlewares.length > 0) {
        if (!this._errorMiddleware) this._errorMiddleware = [];
        this._errorMiddleware.push(...errorMiddlewares);
      }
      
      if (normalMiddlewares.length > 0) {
        if (!this._pathMiddleware) this._pathMiddleware = new Map();
        if (!this._pathMiddleware.has(path)) {
          this._pathMiddleware.set(path, []);
        }
        this._pathMiddleware.get(path).push(...normalMiddlewares);
      }
    } else if (args.length > 1 && typeof args[0] === 'function') {
      // Multiple global middlewares: use(middleware1, middleware2, ...)
      const errorMiddlewares = args.filter(isErrorMiddleware);
      const normalMiddlewares = args.filter(m => !isErrorMiddleware(m));
      
      if (errorMiddlewares.length > 0) {
        if (!this._errorMiddleware) this._errorMiddleware = [];
        this._errorMiddleware.push(...errorMiddlewares);
      }
      
      if (normalMiddlewares.length > 0) {
        if (!this._globalMiddleware) this._globalMiddleware = [];
        this._globalMiddleware.push(...normalMiddlewares);
      }
    } else if (typeof args[0] === 'object' && args[0].handle) {
      // Express-style app mounting
      if (!this._globalMiddleware) this._globalMiddleware = [];
      this._globalMiddleware.push((req, res, next) => {
        args[0].handle(req, res, next);
      });
    }
    
    return this;
  }

  /**
   * Adds error handling middleware to the router.
   * Error middleware is executed when errors occur during request processing.
   * Multiple error handlers are executed in order until one handles the error.
   * 
   * @param {Function} errorMiddleware - Error handling function with signature (err, req, res, next)
   * @returns {Router} This router instance for method chaining
   * @example
   * router.useError((err, req, res, next) => {
   *   if (err.name === 'ValidationError') {
   *     return res.status(400).json({ error: err.message });
   *   }
   *   next(err); // Pass to next error handler
   * });
   */
  useError(errorMiddleware) {
    if (!this._errorMiddleware) this._errorMiddleware = [];
    this._errorMiddleware.push(errorMiddleware);
    return this;
  }

  /**
   * Sets a configuration value for the router.
   * Automatically updates dependent systems like view engine when relevant settings change.
   * Common settings include 'view cache', 'views', and 'view engine'.
   * 
   * @param {string} name - Setting name
   * @param {*} value - Setting value
   * @returns {Router} This router instance for method chaining
   * @example
   * router.set('view cache', true);
   * router.set('views', path.join(__dirname, 'views'));
   * router.set('view engine', 'ejs');
   */
  set(name, value) {
    if (!this._settings) {
      this.settings; // Initialize settings via getter
    }
    this._settings[name] = value;
    
    // Update view engine settings if applicable
    if (this._viewEngine) {
      if (name === 'view cache') {
        this._viewEngine.setCaching(value);
      } else if (name === 'views') {
        const path = require('node:path');
        this._viewEngine.setViewPaths([path.resolve(process.cwd(), value)]);
      }
    }
    
    return this;
  }

  /**
   * Retrieves the value of a configuration setting.
   * Returns undefined if the setting doesn't exist.
   * 
   * @param {string} name - Setting name to retrieve
   * @returns {*} The setting value or undefined
   * @example
   * const viewsDir = router.getSetting('views');
   * const cacheEnabled = router.getSetting('view cache');
   */
  getSetting(name) {
    return this.settings[name];
  }

  /**
   * Enables a boolean setting by setting it to true.
   * Convenience method equivalent to set(name, true).
   * 
   * @param {string} name - Setting name to enable
   * @returns {Router} This router instance for method chaining
   * @example
   * router.enable('view cache');
   * router.enable('trust proxy');
   */
  enable(name) {
    this.set(name, true);
    return this;
  }

  /**
   * Disables a boolean setting by setting it to false.
   * Convenience method equivalent to set(name, false).
   * 
   * @param {string} name - Setting name to disable
   * @returns {Router} This router instance for method chaining
   * @example
   * router.disable('view cache');
   * router.disable('x-powered-by');
   */
  disable(name) {
    this.set(name, false);
    return this;
  }

  /**
   * Checks if a boolean setting is enabled (truthy).
   * Returns true if the setting exists and is truthy, false otherwise.
   * 
   * @param {string} name - Setting name to check
   * @returns {boolean} True if setting is enabled
   * @example
   * if (router.enabled('view cache')) {
   *   console.log('View caching is enabled');
   * }
   */
  enabled(name) {
    return Boolean(this.getSetting(name));
  }

  /**
   * Checks if a boolean setting is disabled (falsy).
   * Returns true if the setting doesn't exist or is falsy.
   * 
   * @param {string} name - Setting name to check
   * @returns {boolean} True if setting is disabled
   * @example
   * if (router.disabled('x-powered-by')) {
   *   console.log('X-Powered-By header is disabled');
   * }
   */
  disabled(name) {
    return !this.enabled(name);
  }

  /**
   * Registers a template engine for rendering views.
   * The engine function should accept (filePath, options, callback) parameters.
   * Multiple engines can be registered for different file extensions.
   * 
   * @param {string} ext - File extension (e.g., 'ejs', 'pug', 'hbs')
   * @param {Function} engineFunc - Template engine rendering function
   * @returns {Router} This router instance for method chaining
   * @example
   * // Register EJS engine
   * router.engine('ejs', require('ejs').renderFile);
   * 
   * // Register custom engine
   * router.engine('html', (filepath, options, callback) => {
   *   fs.readFile(filepath, 'utf8', (err, content) => {
   *     if (err) return callback(err);
   *     callback(null, content.replace(/\{\{(\w+)\}\}/g, (_, key) => options[key] || ''));
   *   });
   * });
   */
  engine(ext, engineFunc) {
    this.viewEngine.registerEngine(ext, engineFunc);
    return this;
  }

  /**
   * Registers a GET route handler.
   * GET requests are used for retrieving resources.
   * 
   * @param {string} routePath - Path pattern for the route
   * @param {...Function} requestHandler - One or more handler functions
   * @returns {Router} This router instance for method chaining
   * @example
   * router.get('/users', (req, res) => {
   *   res.json(users);
   * });
   * 
   * router.get('/users/:id', authMiddleware, (req, res) => {
   *   res.json(users[req.params.id]);
   * });
   */
  get(routePath, ...requestHandler) {
    this.addRoute("GET", routePath, ...requestHandler);
    return this;
  }

  /**
   * Registers a POST route handler.
   * POST requests are used for creating new resources.
   * 
   * @param {string} routePath - Path pattern for the route
   * @param {...Function} requestHandler - One or more handler functions
   * @returns {Router} This router instance for method chaining
   * @example
   * router.post('/users', validateUser, (req, res) => {
   *   const user = createUser(req.body);
   *   res.status(201).json(user);
   * });
   */
  post(routePath, ...requestHandler) {
    this.addRoute("POST", routePath, ...requestHandler);
    return this;
  }

  /**
   * Registers a PUT route handler.
   * PUT requests are used for updating existing resources (full replacement).
   * 
   * @param {string} routePath - Path pattern for the route
   * @param {...Function} requestHandler - One or more handler functions
   * @returns {Router} This router instance for method chaining
   * @example
   * router.put('/users/:id', authMiddleware, (req, res) => {
   *   users[req.params.id] = req.body;
   *   res.json(users[req.params.id]);
   * });
   */
  put(routePath, ...requestHandler) {
    this.addRoute("PUT", routePath, ...requestHandler);
    return this;
  }

  /**
   * Registers a DELETE route handler.
   * DELETE requests are used for removing resources.
   * 
   * @param {string} routePath - Path pattern for the route
   * @param {...Function} requestHandler - One or more handler functions
   * @returns {Router} This router instance for method chaining
   * @example
   * router.delete('/users/:id', authMiddleware, (req, res) => {
   *   delete users[req.params.id];
   *   res.status(204).send();
   * });
   */
  delete(routePath, ...requestHandler) {
    this.addRoute("DELETE", routePath, ...requestHandler);
    return this;
  }

  /**
   * Registers a PATCH route handler.
   * PATCH requests are used for partial updates to resources.
   * 
   * @param {string} routePath - Path pattern for the route
   * @param {...Function} requestHandler - One or more handler functions
   * @returns {Router} This router instance for method chaining
   * @example
   * router.patch('/users/:id', authMiddleware, (req, res) => {
   *   Object.assign(users[req.params.id], req.body);
   *   res.json(users[req.params.id]);
   * });
   */
  patch(routePath, ...requestHandler) {
    this.addRoute("PATCH", routePath, ...requestHandler);
    return this;
  }

  /**
   * Registers a HEAD route handler.
   * HEAD requests are like GET but only return headers, not body.
   * Falls back to GET handlers if no HEAD handler is defined.
   * 
   * @param {string} routePath - Path pattern for the route
   * @param {...Function} requestHandler - One or more handler functions
   * @returns {Router} This router instance for method chaining
   * @example
   * router.head('/files/:id', (req, res) => {
   *   res.set('Content-Length', fileSize);
   *   res.set('Content-Type', mimeType);
   *   res.end();
   * });
   */
  head(routePath, ...requestHandler) {
    this.addRoute("HEAD", routePath, ...requestHandler);
    return this;
  }

  /**
   * Registers an OPTIONS route handler.
   * OPTIONS requests are used for CORS preflight and discovering allowed methods.
   * 
   * @param {string} routePath - Path pattern for the route
   * @param {...Function} requestHandler - One or more handler functions
   * @returns {Router} This router instance for method chaining
   * @example
   * router.options('/api/*', cors());
   * 
   * router.options('/users/:id', (req, res) => {
   *   res.set('Allow', 'GET, PUT, DELETE');
   *   res.status(204).send();
   * });
   */
  options(routePath, ...requestHandler) {
    this.addRoute("OPTIONS", routePath, ...requestHandler);
    return this;
  }

  /**
   * Registers handlers for all HTTP methods on a route.
   * Useful for middleware that should run regardless of the HTTP method.
   * Registers for GET, POST, PUT, DELETE, PATCH, HEAD, and OPTIONS.
   * 
   * @param {string} routePath - Path pattern for the route
   * @param {...Function} requestHandler - One or more handler functions
   * @returns {Router} This router instance for method chaining
   * @example
   * // Apply auth to all methods on /admin routes
   * router.all('/admin/*', requireAuth);
   * 
   * // Handle all methods for a specific endpoint
   * router.all('/api/status', (req, res) => {
   *   res.json({ status: 'ok', method: req.method });
   * });
   */
  all(routePath, ...requestHandler) {
    const methods = ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"];
    for (const method of methods) {
      this.addRoute(method, routePath, ...requestHandler);
    }
    return this;
  }

  /**
   * Merges all routes from another router into this router.
   * Routes maintain their original paths without any prefix modification.
   * Also merges middleware and error handlers from the source router.
   * 
   * @param {Router} routerToMerge - Router instance to merge from
   * @returns {void}
   * @example
   * const apiRouter = new Router();
   * apiRouter.get('/users', getUsersHandler);
   * 
   * const mainRouter = new Router();
   * mainRouter.merge(apiRouter); // Now mainRouter has GET /users
   */
  merge(routerToMerge) {
    this.#mergeNodes(this.rootNode, routerToMerge.rootNode);
    
    // Merge middleware if present
    if (routerToMerge._globalMiddleware && routerToMerge._globalMiddleware.length > 0) {
      if (!this._globalMiddleware) this._globalMiddleware = [];
      this._globalMiddleware.push(...routerToMerge._globalMiddleware);
    }
    
    if (routerToMerge._pathMiddleware && routerToMerge._pathMiddleware.size > 0) {
      if (!this._pathMiddleware) this._pathMiddleware = new Map();
      for (const [path, middlewares] of routerToMerge._pathMiddleware.entries()) {
        if (!this._pathMiddleware.has(path)) {
          this._pathMiddleware.set(path, []);
        }
        this._pathMiddleware.get(path).push(...middlewares);
      }
    }
    
    if (routerToMerge._errorMiddleware && routerToMerge._errorMiddleware.length > 0) {
      if (!this._errorMiddleware) this._errorMiddleware = [];
      this._errorMiddleware.push(...routerToMerge._errorMiddleware);
    }
    
    // Invalidate caches
    if (this._routeCache) this._routeCache.invalidate();
    if (this._exactRoutes) this.#buildExactRoutesMap();
  }

  /**
   * Nests another router's routes under a path prefix.
   * All routes from the nested router will be prefixed with the specified path.
   * Middleware from the nested router becomes path-specific middleware.
   * 
   * @param {string} prefix - Path prefix for all nested routes
   * @param {Router} routerToNest - Router instance to nest
   * @returns {Router} This router instance for method chaining
   * @example
   * const apiRouter = new Router();
   * apiRouter.get('/users', getUsersHandler); // Will become /api/users
   * apiRouter.post('/users', createUserHandler); // Will become /api/users
   * 
   * const mainRouter = new Router();
   * mainRouter.nest('/api', apiRouter);
   */
  nest(prefix, routerToNest) {
    this.#nestNodes(this.rootNode, routerToNest.rootNode, prefix);
    
    // Nest middleware with prefix
    if (routerToNest._globalMiddleware && routerToNest._globalMiddleware.length > 0) {
      if (!this._pathMiddleware) this._pathMiddleware = new Map();
      if (!this._pathMiddleware.has(prefix)) {
        this._pathMiddleware.set(prefix, []);
      }
      this._pathMiddleware.get(prefix).push(...routerToNest._globalMiddleware);
    }
    
    if (routerToNest._pathMiddleware && routerToNest._pathMiddleware.size > 0) {
      if (!this._pathMiddleware) this._pathMiddleware = new Map();
      for (const [path, middlewares] of routerToNest._pathMiddleware.entries()) {
        const nestedPath = prefix + path;
        if (!this._pathMiddleware.has(nestedPath)) {
          this._pathMiddleware.set(nestedPath, []);
        }
        this._pathMiddleware.get(nestedPath).push(...middlewares);
      }
    }
    
    // Invalidate caches
    if (this._routeCache) this._routeCache.invalidate();
    if (this._exactRoutes) this.#buildExactRoutesMap();
    
    return this;
  }

  /**
   * Internal helper for nesting route nodes with a prefix.
   * Creates a new router with prefixed routes and merges it into the current router.
   * 
   * @param {RouteNode} currentNode - Current router's root node
   * @param {RouteNode} nodeToNest - Node to nest with prefix
   * @param {string} prefix - Path prefix to apply
   * @private
   */
  #nestNodes(currentNode, nodeToNest, prefix) {
    const newRouter = new Router();
    this.#generateNestedRoutes(nodeToNest, prefix, newRouter);
    this.#mergeNodes(currentNode, newRouter.rootNode);
  }

  /**
   * Handles HTTP to WebSocket protocol upgrade requests.
   * Delegates to the WebSocket router if WebSocket routes are defined.
   * Should be called from the HTTP server's 'upgrade' event.
   * 
   * @param {http.IncomingMessage} request - HTTP upgrade request
   * @param {net.Socket} socket - Network socket
   * @param {Buffer} head - First packet of upgraded stream
   * @returns {boolean} True if upgrade was handled, false otherwise
   * @example
   * server.on('upgrade', (request, socket, head) => {
   *   router.handleUpgrade(request, socket, head);
   * });
   */
  handleUpgrade(request, socket, head) {
    if (this._wsRouter) {
      return this._wsRouter.handleUpgrade(request, socket, head);
    }
    return false;
  }

  /**
   * Adds a WebSocket route handler.
   * WebSocket routes are matched during the HTTP upgrade handshake.
   * Creates the WebSocket router lazily on first use.
   * 
   * @param {string} path - Path pattern for WebSocket endpoint
   * @param {...Function} handlers - WebSocket connection handlers
   * @returns {Router} This router instance for method chaining
   * @example
   * router.ws('/chat', (ws, req) => {
   *   ws.on('message', (data) => {
   *     ws.send(`Echo: ${data}`);
   *   });
   * });
   * 
   * router.ws('/notifications/:userId', authenticate, (ws, req) => {
   *   subscribeToUserEvents(req.params.userId, ws);
   * });
   */
  ws(path, ...handlers) {
    this.wsRouter.route(path, ...handlers);
    return this;
  }
}

module.exports = Router;