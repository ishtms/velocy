const Request = require('./Request');
const Response = require('./Response');

class RouteNode {
  constructor() {
    this.handler = Object.create(null);
    this.children = Object.create(null);
    this.param = null;
    this.paramName = null;
    this.wildcard = null;  // Single-segment wildcard (*) node
    this.wildcardName = null;  // Name for capturing wildcard value (optional)
    this.catchAll = null;  // Multi-segment wildcard (**) node
    this.catchAllName = null;  // Name for capturing catch-all value (optional)
    this.isPattern = false;  // Indicates if this node represents a pattern like *.js
  }
}

class Router {
  constructor(options = {}) {
    this.rootNode = new RouteNode();
    
    // Lazy-loaded features - only initialized when used
    this._globalMiddleware = null;
    this._pathMiddleware = null;
    this._errorMiddleware = null;
    this._cookieSecret = options.cookieSecret || null;
    this._viewEngine = null;
    this._wsRouter = null;
    this._wsOptions = options.websocket || {};
    this._settings = null;
    this._locals = null;
    
    // Performance features - disabled by default for zero cost
    this._performanceEnabled = options.performance === true;
    this._cacheEnabled = options.cache === true;
    this._routeCache = null;
    this._urlCache = null;
    this._stringInterner = null;
    this._paramsPool = null;
    this._regexCache = null;
    this._performanceHooks = null;
    this._normalizedPaths = null;
    this._pathSegmentBuffer = null;
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
      this._exactRoutes.set(key, { handler, params: {} });
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
          if (!currentNode.wildcard) {
            currentNode.wildcard = new RouteNode();
            currentNode.wildcardName = "*";  // Default name for wildcard
          }
          nextNode = currentNode.wildcard;
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
      const res = new Response(nativeRes, this);

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
          
          // Handle route-specific middleware chain
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
            await handler(req, res);
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
      const res = nativeRes.statusCode ? nativeRes : new Response(nativeRes, this);
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

    if (!routeHandler) {
      nativeRes.writeHead(404);
      nativeRes.end("Route Not Found");
      return;
    }

    nativeReq.params = routeHandler.extractedParams;
    nativeReq.queryParams = new URLSearchParams(queryDelimiter === -1 ? "" : url.substring(queryDelimiter));

    const routeHandlerFunc = routeHandler.requestHandler[routePath] || routeHandler.requestHandler;

    if (typeof routeHandlerFunc === "function") {
      try {
        await routeHandlerFunc(nativeReq, nativeRes);
      } catch (err) {
        // Simple error handling
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
    
    res.status(statusCode).send(process.env.NODE_ENV === 'production' 
      ? (statusCode === 500 ? 'Internal Server Error' : err.message || 'Error')
      : err.stack || err.toString());
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

    for (let pathEnd = 1; pathEnd <= pathLength; ++pathEnd) {
      if (pathEnd === pathLength || routePath[pathEnd] === "/") {
        const pathSegment = routePath.substring(pathStart, pathEnd);
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
        
        // Check single-segment wildcard (*)
        if (!nextNode && currentNode.wildcard) {
          nextNode = currentNode.wildcard;
          const wildcardName = currentNode.wildcardName || "*";
          extractedParams[wildcardName] = pathSegment;
        }
        
        // Check parameter match
        if (!nextNode && currentNode.param) {
          nextNode = currentNode.param;
          extractedParams[currentNode.param.paramName] = pathSegment;
        }
        
        // Remember catch-all node if we have one at this point
        if (currentNode.catchAll && currentNode.catchAll.handler[httpMethod]) {
          catchAllNode = currentNode.catchAll;
          catchAllParams = { ...extractedParams };
          catchAllStart = pathStart;
          const catchAllName = currentNode.catchAllName || "**";
          catchAllParams[catchAllName] = routePath.substring(pathStart);
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
    if (currentNode.handler[httpMethod]) {
      return { requestHandler: currentNode.handler[httpMethod], extractedParams };
    }
    
    // Check if there's a catch-all at the current node
    if (currentNode.catchAll && currentNode.catchAll.handler[httpMethod]) {
      const catchAllName = currentNode.catchAllName || "**";
      extractedParams[catchAllName] = "";  // Empty string for exact match at catch-all position
      return { 
        requestHandler: currentNode.catchAll.handler[httpMethod], 
        extractedParams 
      };
    }
    
    // Fall back to earlier catch-all if we had one
    if (catchAllNode) {
      return { 
        requestHandler: catchAllNode.handler[httpMethod], 
        extractedParams: catchAllParams 
      };
    }
    
    return null;
  }

  /**
   * Add global middleware
   */
  use(...args) {
    // Lazy initialize middleware array
    if (!this._globalMiddleware) this._globalMiddleware = [];
    
    if (args.length === 1 && typeof args[0] === 'function') {
      // Global middleware: use(middleware)
      this._globalMiddleware.push(args[0]);
    } else if (args.length === 2 && typeof args[0] === 'string' && typeof args[1] === 'function') {
      // Path-specific middleware: use('/path', middleware)
      if (!this._pathMiddleware) this._pathMiddleware = new Map();
      const path = args[0];
      if (!this._pathMiddleware.has(path)) {
        this._pathMiddleware.set(path, []);
      }
      this._pathMiddleware.get(path).push(args[1]);
    } else if (args.length >= 2 && typeof args[0] === 'string') {
      // Path-specific with multiple middlewares: use('/path', middleware1, middleware2, ...)
      if (!this._pathMiddleware) this._pathMiddleware = new Map();
      const path = args[0];
      const middlewares = args.slice(1);
      if (!this._pathMiddleware.has(path)) {
        this._pathMiddleware.set(path, []);
      }
      this._pathMiddleware.get(path).push(...middlewares);
    } else if (args.length > 1 && typeof args[0] === 'function') {
      // Multiple global middlewares: use(middleware1, middleware2, ...)
      this._globalMiddleware.push(...args);
    } else if (typeof args[0] === 'object' && args[0].handle) {
      // Express-style app mounting
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
  ws(path, handler) {
    this.wsRouter.addRoute(path, handler);
    return this;
  }
}

module.exports = Router;