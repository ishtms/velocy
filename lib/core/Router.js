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

  // Lazy getters for features - only create when accessed
  get globalMiddleware() {
    if (!this._globalMiddleware) this._globalMiddleware = [];
    return this._globalMiddleware;
  }

  get pathMiddleware() {
    if (!this._pathMiddleware) this._pathMiddleware = new Map();
    return this._pathMiddleware;
  }

  get errorMiddleware() {
    if (!this._errorMiddleware) this._errorMiddleware = [];
    return this._errorMiddleware;
  }

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

  get wsRouter() {
    if (!this._wsRouter) {
      const WebSocketRouter = require('./WebSocketRouter');
      this._wsRouter = new WebSocketRouter(this._wsOptions);
    }
    return this._wsRouter;
  }

  get settings() {
    if (!this._settings) {
      const path = require('node:path');
      this._settings = Object.create(null);
      this._settings['view cache'] = process.env.NODE_ENV === 'production';
      this._settings['views'] = path.resolve(process.cwd(), 'views');
      this._settings['view engine'] = null;
    }
    return this._settings;
  }

  get locals() {
    if (!this._locals) this._locals = Object.create(null);
    return this._locals;
  }

  get cookieSecret() {
    return this._cookieSecret;
  }

  set cookieSecret(value) {
    this._cookieSecret = value;
  }

  /**
   * Initialize performance optimization components
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
    this._paramsPool = new ObjectPool(
      () => Object.create(null),
      (obj) => {
        for (const key in obj) {
          delete obj[key];
        }
      },
      100
    );
    
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
   * Build fast exact match map for static routes
   */
  #buildExactRoutesMap() {
    if (!this._exactRoutes) return;
    this._exactRoutes.clear();
    this.#traverseForExactRoutes(this.rootNode, '');
  }

  /**
   * Traverse tree to find exact static routes
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

  addRoute(httpMethod, routePath, ...handlers) {
    // Invalidate caches when routes change
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
    
    // Store all handlers in a chain
    currentNode.handler[httpMethod] = handlerChain.length === 1 ? handlerChain[0] : handlerChain;
  }

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

  printTree() {
    this.#printNode(this.rootNode, "Root");
  }

  #printNode(node, prefix, level = 0, prefixSymbol = "") {
    let indentation = " ".repeat(level * 4);

    console.log(`${prefixSymbol ? `${indentation}${prefixSymbol} ${prefix || "/"}` : prefix}`);

    // Print handlers for this node
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

    // Recursively print children
    for (const [childPrefix, childNode] of Object.entries(node.children)) {
      this.#printNode(childNode, childPrefix, level + 1, "├─");
    }

    // Recursively print parameterized child
    if (node.param) {
      this.#printNode(node.param, `:${node.param.paramName}`, level + 1, "├─");
    }
    
    // Print wildcard nodes
    if (node.wildcard) {
      const wildcardLabel = node.wildcardName === "*" ? "*" : `*${node.wildcardName}`;
      this.#printNode(node.wildcard, wildcardLabel, level + 1, "├─");
    }
    
    if (node.catchAll) {
      const catchAllLabel = node.catchAllName === "**" ? "**" : `**${node.catchAllName}`;
      this.#printNode(node.catchAll, catchAllLabel, level + 1, "├─");
    }
  }

  async handleRequest(nativeReq, nativeRes) {
    try {
      // Fast path for simple requests without middleware or advanced features
      if (!this._globalMiddleware && !this._pathMiddleware && !this._errorMiddleware && !this._viewEngine && !this._performanceEnabled) {
        return this.#handleSimpleRequest(nativeReq, nativeRes);
      }
      
      // Full-featured path with Request/Response wrappers
      const req = new Request(nativeReq, this);
      const res = new Response(nativeRes, this, nativeReq);

      // Run performance hooks if enabled
      if (this._performanceHooks?.beforeRequest) {
        this._performanceHooks.beforeRequest(req, res);
      }

      // Create a next function for middleware chain
      let middlewareIndex = 0;
      const globalMiddleware = this._globalMiddleware || [];
      const pathMiddleware = this._pathMiddleware;
      
      // Collect path-specific middleware
      const pathMiddlewares = [];
      if (pathMiddleware) {
        const url = req.path || req.url;
        for (const [pathPrefix, middlewares] of pathMiddleware.entries()) {
          if (url.startsWith(pathPrefix)) {
            pathMiddlewares.push(...middlewares);
          }
        }
      }
      
      const allMiddleware = [...globalMiddleware, ...pathMiddlewares];

      const next = async (err) => {
        if (err) {
          // Handle error
          return this.#handleError(err, req, res);
        }

        if (middlewareIndex < allMiddleware.length) {
          const middleware = allMiddleware[middlewareIndex++];
          try {
            // Check if it's an error middleware (4 parameters)
            if (middleware.length === 4) {
              // Skip error middleware in normal flow
              return next();
            }
            await middleware(req, res, next);
          } catch (error) {
            next(error);
          }
        } else {
          // All middleware executed, now handle the route
          const { method, url } = req;
          
          // Parse URL and check cache
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
          
          // Try exact route match first if available
          let routeHandler;
          if (this._exactRoutes) {
            const exactKey = `${method}:${routePath}`;
            const exactMatch = this._exactRoutes.get(exactKey);
            if (exactMatch) {
              routeHandler = exactMatch;
            }
          }
          
          // Fallback to tree traversal
          if (!routeHandler) {
            // Check route cache if enabled
            if (this._routeCache) {
              const cacheKey = `${method}:${routePath}`;
              routeHandler = this._routeCache.get(cacheKey);
              
              if (!routeHandler) {
                routeHandler = this.#findRouteHandler(method, routePath);
                if (routeHandler) {
                  this._routeCache.set(cacheKey, routeHandler);
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

          // Use pooled params object if available
          req.params = this._paramsPool ? 
            Object.assign(this._paramsPool.acquire(), routeHandler.params || routeHandler.extractedParams || {}) :
            routeHandler.params || routeHandler.extractedParams || {};
          
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
                  // Always provide next function, even for the last handler
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
          
          // Return params object to pool
          if (this._paramsPool && req.params) {
            this._paramsPool.release(req.params);
            req.params = null;
          }
        }
      };

      // Start middleware chain
      await next();
      
      // Run performance hooks if enabled
      if (this._performanceHooks?.afterRequest) {
        this._performanceHooks.afterRequest(req, res);
      }
    } catch (err) {
      // Last resort error handling
      const res = nativeRes.status ? nativeRes : new Response(nativeRes, this, nativeReq);
      const req = nativeReq.params ? nativeReq : new Request(nativeReq, this);
      this.#handleError(err, req, res);
    }
  }

  // Fast path for simple requests without middleware or advanced features
  async #handleSimpleRequest(nativeReq, nativeRes) {
    const { method, url } = nativeReq;
    const queryDelimiter = url.indexOf("?");
    const routePath = queryDelimiter === -1 ? url : url.substring(0, queryDelimiter);
    const routeHandler = this.#findRouteHandler(method, routePath);

    // Create lightweight Request/Response wrappers even in fast path
    const req = new Request(nativeReq, this);
    const res = new Response(nativeRes, this, nativeReq);

    if (!routeHandler) {
      res.status(404).send("Route Not Found");
      return;
    }

    req.params = routeHandler.extractedParams;
    req.queryParams = new URLSearchParams(queryDelimiter === -1 ? "" : url.substring(queryDelimiter));

    const handler = routeHandler.requestHandler;

    // Handle route-specific middleware chain even in simple path
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
        // Provide next function even for single handlers
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

  #handleError(err, req, res) {
    // Try error middleware first
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
          // No more error middleware, use default error handling
          this.#defaultErrorHandler(error || err, req, res);
        }
      };
      errorNext(err);
    } else {
      this.#defaultErrorHandler(err, req, res);
    }
  }

  #defaultErrorHandler(err, req, res) {
    const statusCode = err.statusCode || err.status || 500;
    
    // Check if response was already sent
    if (res.headersSent || res.finished) {
      return;
    }
    
    // Handle ValidationError specially
    if (err.isValidationError && err.toJSON) {
      res.status(statusCode).json(err.toJSON());
      return;
    }
    
    // Create a JSON error response
    const errorResponse = {
      error: err.message || (statusCode === 500 ? 'Internal Server Error' : 'Error'),
      statusCode: statusCode
    };
    
    // Include stack trace in development for debugging
    if (process.env.NODE_ENV !== 'production') {
      errorResponse.stack = err.stack;
    }
    
    // Add error code if available
    if (err.code) {
      errorResponse.code = err.code;
    }
    
    res.status(statusCode).json(errorResponse);
  }

  /**
   * Check if a segment matches a pattern with wildcards
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

  #findRouteHandler(httpMethod, routePath) {
    let currentNode = this.rootNode;
    let extractedParams = Object.create(null);
    let pathStart = 1;
    const pathLength = routePath.length;
    let catchAllNode = null;
    let catchAllParams = null;
    let catchAllStart = -1;
    let wildcardIndex = 0; // Track wildcard indices for numbering
    
    // HEAD requests should use GET handlers
    const methodsToCheck = httpMethod === 'HEAD' ? ['HEAD', 'GET'] : [httpMethod];

    for (let pathEnd = 1; pathEnd <= pathLength; ++pathEnd) {
      if (pathEnd === pathLength || routePath[pathEnd] === "/") {
        const pathSegment = decodeURIComponent(routePath.substring(pathStart, pathEnd));
        let nextNode = null;
        
        // First, try exact static match
        nextNode = currentNode.children[pathSegment];
        
        // If no exact match, check for pattern matches (e.g., *.js)
        if (!nextNode) {
          for (const [pattern, node] of Object.entries(currentNode.children)) {
            if (node.isPattern && this.#matchesPattern(pattern, pathSegment)) {
              nextNode = node;
              // Extract the matched part if the pattern has a capture group
              if (pattern.includes('*')) {
                const wildcardName = pattern.replace(/\*/g, '') || '*';
                extractedParams[wildcardName] = pathSegment;
              }
              break;
            }
          }
        }
        
        // Check parameter match (higher priority than wildcard)
        if (!nextNode && currentNode.param) {
          nextNode = currentNode.param;
          extractedParams[currentNode.param.paramName] = pathSegment;
        }
        
        // Check single-segment wildcard (*) - lowest priority
        if (!nextNode && currentNode.wildcard) {
          nextNode = currentNode.wildcard;
          const wildcardName = currentNode.wildcardName || "*";
          // Store with both wildcard name and numeric index
          if (wildcardName === "*") {
            extractedParams['*'] = pathSegment; // Always store with '*' key
            extractedParams[wildcardIndex++] = pathSegment; // Also store with numeric index
          } else {
            extractedParams[wildcardName] = pathSegment;
          }
        }
        
        // Remember catch-all node if we have one at this point
        if (currentNode.catchAll) {
          for (const method of methodsToCheck) {
            if (currentNode.catchAll.handler[method]) {
              catchAllNode = currentNode.catchAll;
              catchAllParams = { ...extractedParams };
              catchAllStart = pathStart;
              const catchAllName = currentNode.catchAllName || "**";
              const remainingPath = routePath.substring(pathStart);
              
              // If catch-all name is "*", also store with numeric index
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
          // No more matches, check if we had a catch-all earlier
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

    // Check if current node has a handler for this method
    for (const method of methodsToCheck) {
      if (currentNode.handler[method]) {
        return { requestHandler: currentNode.handler[method], extractedParams };
      }
    }
    
    // Check if there's a catch-all at the current node
    if (currentNode.catchAll) {
      for (const method of methodsToCheck) {
        if (currentNode.catchAll.handler[method]) {
          const catchAllName = currentNode.catchAllName || "**";
          // If we're at the end of the path, there's nothing remaining
          // But if pathStart is less than pathLength, capture the remaining part
          const remainingPath = pathStart <= pathLength ? routePath.substring(pathStart) : "";
          
          // If catch-all name is "*", also store with numeric index
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
    
    // Fall back to earlier catch-all if we had one
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
   * Add global middleware
   */
  use(...args) {
    // Helper function to check if a function is error middleware (4 parameters)
    const isErrorMiddleware = (fn) => fn.length === 4;
    
    if (args.length === 1 && typeof args[0] === 'function') {
      // Check if it's error middleware
      if (isErrorMiddleware(args[0])) {
        if (!this._errorMiddleware) this._errorMiddleware = [];
        this._errorMiddleware.push(args[0]);
      } else {
        // Global middleware: use(middleware)
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
   * Add error handling middleware
   */
  useError(errorMiddleware) {
    if (!this._errorMiddleware) this._errorMiddleware = [];
    this._errorMiddleware.push(errorMiddleware);
    return this;
  }

  /**
   * Define a setting
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
   * Get a setting value
   */
  getSetting(name) {
    return this.settings[name];
  }

  /**
   * Register a template engine
   */
  engine(ext, engineFunc) {
    this.viewEngine.registerEngine(ext, engineFunc);
    return this;
  }

  get(routePath, ...requestHandler) {
    this.addRoute("GET", routePath, ...requestHandler);
    return this;
  }

  post(routePath, ...requestHandler) {
    this.addRoute("POST", routePath, ...requestHandler);
    return this;
  }

  put(routePath, ...requestHandler) {
    this.addRoute("PUT", routePath, ...requestHandler);
    return this;
  }

  delete(routePath, ...requestHandler) {
    this.addRoute("DELETE", routePath, ...requestHandler);
    return this;
  }

  patch(routePath, ...requestHandler) {
    this.addRoute("PATCH", routePath, ...requestHandler);
    return this;
  }

  head(routePath, ...requestHandler) {
    this.addRoute("HEAD", routePath, ...requestHandler);
    return this;
  }

  options(routePath, ...requestHandler) {
    this.addRoute("OPTIONS", routePath, ...requestHandler);
    return this;
  }

  all(routePath, ...requestHandler) {
    const methods = ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"];
    for (const method of methods) {
      this.addRoute(method, routePath, ...requestHandler);
    }
    return this;
  }

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

  #nestNodes(currentNode, nodeToNest, prefix) {
    const newRouter = new Router();
    this.#generateNestedRoutes(nodeToNest, prefix, newRouter);
    this.#mergeNodes(currentNode, newRouter.rootNode);
  }

  /**
   * Handle WebSocket upgrade
   */
  handleUpgrade(request, socket, head) {
    if (this._wsRouter) {
      return this._wsRouter.handleUpgrade(request, socket, head);
    }
    return false;
  }

  /**
   * Add WebSocket route
   */
  ws(path, ...handlers) {
    this.wsRouter.route(path, ...handlers);
    return this;
  }
}

module.exports = Router;