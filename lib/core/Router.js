const Request = require('./Request');
const Response = require('./Response');
const ViewEngine = require('../utils/viewEngine');
const WebSocketRouter = require('./WebSocketRouter');
const path = require('node:path');

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
    this.globalMiddleware = [];
    this.pathMiddleware = new Map(); // Maps path prefixes to middleware arrays
    this.errorMiddleware = [];
    this.cookieSecret = options.cookieSecret || null; // Secret for signed cookies
    this.viewEngine = new ViewEngine(); // Template engine manager
    this.settings = Object.create(null); // Application settings
    this.locals = Object.create(null); // Application-wide locals for templates
    
    // WebSocket support
    this.wsRouter = null;
    this.wsOptions = options.websocket || {};
    
    // Initialize default settings
    this.settings['view cache'] = process.env.NODE_ENV === 'production';
    this.settings['views'] = path.resolve(process.cwd(), 'views');
    this.settings['view engine'] = null;
    
    // Apply initial settings to view engine
    this.viewEngine.setCaching(this.settings['view cache']);
    this.viewEngine.setViewPaths([this.settings['views']]);
    
    // Register the built-in simple template engine as fallback
    this.viewEngine.registerEngine('html', ViewEngine.simpleEngine());
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
        // Check for named wildcards like *filename or **rest
        else if (pathSegment.startsWith("*")) {
          if (pathSegment.startsWith("**")) {
            // Named catch-all wildcard
            if (!currentNode.catchAll) {
              currentNode.catchAll = new RouteNode();
              currentNode.catchAllName = pathSegment.substring(2) || "**";
            }
            nextNode = currentNode.catchAll;
          } else {
            // Named single-segment wildcard
            if (!currentNode.wildcard) {
              currentNode.wildcard = new RouteNode();
              currentNode.wildcardName = pathSegment.substring(1) || "*";
            }
            nextNode = currentNode.wildcard;
          }
        }
        // Check for parameterized route
        else if (pathSegment[0] === ":") {
          if (!currentNode.param) {
            currentNode.param = new RouteNode();
            currentNode.param.paramName = pathSegment.substring(1);
          }
          nextNode = currentNode.param;
        }
        // Static route segment
        else {
          nextNode = currentNode.children[pathSegment] || (currentNode.children[pathSegment] = new RouteNode());
        }
        currentNode = nextNode;
        pathStart = pathEnd + 1;
      }
    }
    
    // Store the handler chain instead of single handler
    // For backward compatibility, unwrap single handlers
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
      // Transfer pattern flag if present
      if (subNode.isPattern) {
        currentNode.children[pathSegment].isPattern = true;
      }
      this.#mergeNodes(currentNode.children[pathSegment], subNode);
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
        currentNode.wildcardName = nodeToMerge.wildcardName;
      }
      this.#mergeNodes(currentNode.wildcard, nodeToMerge.wildcard);
    }
    // Merge catch-all nodes
    if (nodeToMerge.catchAll) {
      if (!currentNode.catchAll) {
        currentNode.catchAll = new RouteNode();
        currentNode.catchAllName = nodeToMerge.catchAllName;
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

    // Recursively print children (static routes and patterns)
    for (const [childPrefix, childNode] of Object.entries(node.children)) {
      const displayPrefix = childNode.isPattern ? `[pattern: ${childPrefix}]` : childPrefix;
      this.#printNode(childNode, displayPrefix, level + 1, "├─");
    }

    // Recursively print parameterized child
    if (node.param) {
      this.#printNode(node.param, `:${node.param.paramName}`, level + 1, "├─");
    }

    // Recursively print single-segment wildcard
    if (node.wildcard) {
      const wildcardLabel = node.wildcardName === "*" ? "*" : `*${node.wildcardName}`;
      this.#printNode(node.wildcard, wildcardLabel, level + 1, "├─");
    }

    // Recursively print catch-all wildcard
    if (node.catchAll) {
      const catchAllLabel = node.catchAllName === "**" ? "**" : `**${node.catchAllName}`;
      this.#printNode(node.catchAll, catchAllLabel, level + 1, "└─");
    }
  }

  /**
   * Registers a template engine for a specific file extension
   * @param {string} ext - File extension (e.g., 'ejs', 'pug', 'hbs')
   * @param {Function} engine - Engine function or object with compile method
   * @returns {Router} For chaining
   */
  engine(ext, engine) {
    this.viewEngine.registerEngine(ext, engine);
    
    // If this is the first non-HTML engine, set it as default
    if (!this.settings['view engine'] && ext !== 'html') {
      this.settings['view engine'] = ext;
      this.viewEngine.setDefaultEngine(ext);
    }
    
    return this;
  }

  /**
   * Sets an application setting
   * @param {string} name - Setting name
   * @param {*} value - Setting value
   * @returns {Router} For chaining
   */
  set(name, value) {
    this.settings[name] = value;
    
    // Handle special settings
    switch (name) {
      case 'views':
        // Configure view directories
        if (typeof value === 'string') {
          this.viewEngine.setViewPaths([path.resolve(value)]);
        } else if (Array.isArray(value)) {
          this.viewEngine.setViewPaths(value.map(p => path.resolve(p)));
        }
        break;
        
      case 'view engine':
        // Set default template engine
        if (value) {
          const ext = value.startsWith('.') ? value.slice(1) : value;
          this.viewEngine.setDefaultEngine(ext);
        }
        break;
        
      case 'view cache':
        // Configure view caching
        this.viewEngine.setCaching(!!value);
        break;
    }
    
    return this;
  }

  /**
   * Gets an application setting
   * @param {string} name - Setting name
   * @returns {*} Setting value
   */
  getSetting(name) {
    return this.settings[name];
  }

  /**
   * Enables a boolean setting
   * @param {string} name - Setting name
   * @returns {Router} For chaining
   */
  enable(name) {
    return this.set(name, true);
  }

  /**
   * Disables a boolean setting
   * @param {string} name - Setting name
   * @returns {Router} For chaining
   */
  disable(name) {
    return this.set(name, false);
  }

  /**
   * Checks if a setting is enabled
   * @param {string} name - Setting name
   * @returns {boolean} Whether the setting is enabled
   */
  enabled(name) {
    return !!this.settings[name];
  }

  /**
   * Checks if a setting is disabled
   * @param {string} name - Setting name
   * @returns {boolean} Whether the setting is disabled
   */
  disabled(name) {
    return !this.settings[name];
  }

  async handleRequest(nativeReq, nativeRes) {
    // Sync app.locals to view engine
    this.viewEngine.locals = this.locals;
    
    const req = new Request(nativeReq, { cookieSecret: this.cookieSecret });
    const res = new Response(nativeRes, { 
      cookieSecret: this.cookieSecret,
      viewEngine: this.viewEngine
    });

    const { method, url } = nativeReq;
    const queryDelimiter = url.indexOf("?");
    const routePath = queryDelimiter === -1 ? url : url.substring(0, queryDelimiter);
    const routeHandler = this.#findRouteHandler(method, routePath);

    if (!routeHandler) {
      res.status(404).send("Route Not Found");
      return;
    }

    req.params = routeHandler.extractedParams;
    // Query parameters are now available via req.query getter with enhanced parsing

    // Build the complete middleware chain
    const middlewareChain = [];
    
    // 1. Add global middleware
    middlewareChain.push(...this.globalMiddleware);
    
    // 2. Add path-specific middleware
    for (const [pathPrefix, pathMiddlewares] of this.pathMiddleware.entries()) {
      if (routePath.startsWith(pathPrefix)) {
        // Adjust req.url for mounted middleware
        const originalUrl = req.url;
        const mountPath = pathPrefix === '/' ? '' : pathPrefix;
        middlewareChain.push(...pathMiddlewares.map(mw => {
          // Wrap middleware to adjust the URL for mounted paths
          if (mw.length === 4) {
            // Error middleware
            return mw;
          }
          return (req, res, next) => {
            if (mountPath) {
              req.url = req.url.substring(mountPath.length) || '/';
              req.baseUrl = mountPath;
            }
            const result = mw(req, res, (err) => {
              if (mountPath) {
                req.url = originalUrl;
                delete req.baseUrl;
              }
              next(err);
            });
            if (result && typeof result.then === 'function') {
              return result.catch(err => next(err));
            }
          };
        }));
      }
    }
    
    // 3. Add route-specific middleware/handlers
    const routeHandlerFunc = routeHandler.requestHandler;
    if (Array.isArray(routeHandlerFunc)) {
      middlewareChain.push(...routeHandlerFunc);
    } else if (typeof routeHandlerFunc === 'function') {
      middlewareChain.push(routeHandlerFunc);
    } else {
      res.status(404).send("Route Not Found");
      return;
    }
    
    // Execute the middleware chain
    await this.#executeMiddleware(middlewareChain, req, res);
  }

  async #executeMiddleware(middlewareChain, req, res) {
    let index = 0;
    const errorHandlers = this.errorMiddleware;
    
    const next = async (err) => {
      // If error is passed, switch to error handling mode
      if (err) {
        return this.#handleError(err, req, res, errorHandlers);
      }
      
      if (index >= middlewareChain.length) {
        // No more middleware to execute
        return;
      }
      
      const middleware = middlewareChain[index++];
      
      // Skip error middleware in normal flow (4-parameter functions)
      if (middleware.length === 4) {
        return next();
      }
      
      try {
        // Execute middleware
        const result = middleware(req, res, next);
        
        // Handle async middleware
        if (result && typeof result.then === 'function') {
          await result;
        }
      } catch (error) {
        // Catch sync and async errors
        await this.#handleError(error, req, res, errorHandlers);
      }
    };
    
    // Start the middleware chain
    await next();
  }
  
  async #handleError(err, req, res, errorHandlers) {
    // Combine route-specific error handlers with global error handlers
    const allErrorHandlers = [...errorHandlers];
    
    let index = 0;
    const nextError = async (error) => {
      if (index >= allErrorHandlers.length) {
        // No error handler caught it, use default
        if (!res.headersSent && !res.finished) {
          res.status(500).send(process.env.NODE_ENV === 'production' 
            ? 'Internal Server Error' 
            : err.stack || err.toString());
        }
        return;
      }
      
      const errorHandler = allErrorHandlers[index++];
      
      try {
        const result = errorHandler(error || err, req, res, nextError);
        if (result && typeof result.then === 'function') {
          await result;
        }
      } catch (nextErr) {
        // Error in error handler, try next one
        await nextError(nextErr);
      }
    };
    
    await nextError(err);
  }

  #findRouteHandler(httpMethod, routePath) {
    // Remove trailing slash for consistency (except for root path)
    const normalizedPath = routePath.length > 1 && routePath.endsWith('/') 
      ? routePath.slice(0, -1) 
      : routePath;
    
    // Try to find the best matching route using priority-based search
    const result = this.#findBestMatch(this.rootNode, httpMethod, normalizedPath, 1, Object.create(null));
    
    if (!result) return null;
    
    return {
      requestHandler: result.handler,
      extractedParams: result.params
    };
  }

  #matchesPattern(segment, pattern) {
    // Convert wildcard pattern to regex
    // Support patterns like: *.js, prefix*, *suffix, pre*fix
    const regexPattern = pattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')  // Escape special regex chars except *
      .replace(/\*/g, '(.*)');  // Replace * with regex capture group
    
    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(segment);
  }

  #extractWildcardFromPattern(segment, pattern) {
    // Extract the part that matches the wildcard
    const regexPattern = pattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')  // Escape special regex chars except *
      .replace(/\*/g, '(.*)');  // Replace * with regex capture group
    
    const regex = new RegExp(`^${regexPattern}$`);
    const match = segment.match(regex);
    return match ? match[1] : null;
  }

  #findBestMatch(node, method, path, startPos, params) {
    // Base case: we've consumed the entire path
    if (startPos >= path.length || (startPos === path.length - 1 && path[startPos] === '/')) {
      if (node.handler[method]) {
        return { handler: node.handler[method], params };
      }
      // Check if root has a handler when path is exactly "/"
      if (path === "/" && startPos === 1 && node.handler[method]) {
        return { handler: node.handler[method], params };
      }
    }
    
    // Find the next segment
    let endPos = startPos;
    while (endPos < path.length && path[endPos] !== '/') {
      endPos++;
    }
    
    const segment = path.substring(startPos, endPos);
    const nextStartPos = endPos < path.length ? endPos + 1 : endPos;
    
    // Priority 1: Try exact static match and pattern matches
    // First try exact match
    if (node.children[segment]) {
      const result = this.#findBestMatch(node.children[segment], method, path, nextStartPos, params);
      if (result) return result;
    }
    
    // Try pattern-based matches (like *.js)
    for (const [pattern, childNode] of Object.entries(node.children)) {
      if (childNode.isPattern && this.#matchesPattern(segment, pattern)) {
        const patternParams = { ...params };
        // Extract the wildcard portion and store it
        const wildcardMatch = this.#extractWildcardFromPattern(segment, pattern);
        if (wildcardMatch) {
          patternParams['*'] = wildcardMatch;
        }
        const result = this.#findBestMatch(childNode, method, path, nextStartPos, patternParams);
        if (result) return result;
      }
    }
    
    // Priority 2: Try parameter match
    if (node.param) {
      const newParams = { ...params, [node.param.paramName]: segment };
      const result = this.#findBestMatch(node.param, method, path, nextStartPos, newParams);
      if (result) return result;
    }
    
    // Priority 3: Try single-segment wildcard
    if (node.wildcard) {
      const wildcardParams = { ...params };
      // Store the wildcard value if it has a name
      if (node.wildcardName && node.wildcardName !== "*") {
        wildcardParams[node.wildcardName] = segment;
      } else {
        // Store unnamed wildcard in special property for potential use
        wildcardParams['*'] = segment;
      }
      const result = this.#findBestMatch(node.wildcard, method, path, nextStartPos, wildcardParams);
      if (result) return result;
    }
    
    // Priority 4: Try catch-all wildcard (matches rest of path)
    if (node.catchAll) {
      // Catch-all matches everything from current position
      const remainingPath = path.substring(startPos);
      const catchAllParams = { ...params };
      
      // Store the matched path in params
      if (node.catchAllName && node.catchAllName !== "**") {
        catchAllParams[node.catchAllName] = remainingPath;
      } else {
        // Store unnamed catch-all in special property
        catchAllParams['**'] = remainingPath;
      }
      
      // First, try to find a direct handler at the catch-all node
      if (node.catchAll.handler[method]) {
        return { handler: node.catchAll.handler[method], params: catchAllParams };
      }
      
      // For complex patterns like /api/**/users/:id, we need to try matching
      // the remaining path against the catch-all node's children
      // This allows catch-all to act as a "skip any segments" operator
      
      // Try continuing from current position (for patterns like /**/something)
      const directResult = this.#findBestMatch(node.catchAll, method, path, startPos, catchAllParams);
      if (directResult) return directResult;
      
      // Try skipping segments one by one to find matches
      // This enables /api/**/users to match /api/v1/admin/users
      let scanPos = nextStartPos;
      while (scanPos <= path.length) {
        // Update the catch-all captured value as we skip segments
        const skippedPath = path.substring(startPos, scanPos > startPos ? scanPos - 1 : startPos);
        const scanParams = { ...params };
        if (node.catchAllName && node.catchAllName !== "**") {
          scanParams[node.catchAllName] = skippedPath;
        } else {
          scanParams['**'] = skippedPath;
        }
        
        // Try matching from this position
        const scanResult = this.#findBestMatch(node.catchAll, method, path, scanPos, scanParams);
        if (scanResult) return scanResult;
        
        // Find next segment boundary
        if (scanPos >= path.length) break;
        while (scanPos < path.length && path[scanPos] !== '/') {
          scanPos++;
        }
        scanPos = scanPos < path.length ? scanPos + 1 : scanPos + 1;
      }
    }
    
    return null;
  }

  // Middleware registration method
  use(...args) {
    // Handle different use() signatures
    if (args.length === 0) {
      throw new Error('use() requires at least one middleware function');
    }
    
    let path = '/';
    let middlewares = args;
    
    // Check if first argument is a path
    if (typeof args[0] === 'string') {
      path = args[0];
      middlewares = args.slice(1);
    }
    
    // Flatten middleware arrays
    const flatMiddlewares = [];
    for (const mw of middlewares) {
      if (Array.isArray(mw)) {
        flatMiddlewares.push(...mw);
      } else if (typeof mw === 'function') {
        flatMiddlewares.push(mw);
      } else if (mw && typeof mw === 'object' && typeof mw.handle === 'function') {
        // Support for sub-routers or middleware objects with handle method
        flatMiddlewares.push((req, res, next) => mw.handle(req, res, next));
      } else {
        throw new Error('Middleware must be a function or an array of functions');
      }
    }
    
    // Separate error middleware from regular middleware
    for (const middleware of flatMiddlewares) {
      if (middleware.length === 4) {
        // Error middleware (err, req, res, next)
        this.errorMiddleware.push(middleware);
      } else {
        // Regular middleware
        if (path === '/') {
          // Global middleware
          this.globalMiddleware.push(middleware);
        } else {
          // Path-specific middleware
          if (!this.pathMiddleware.has(path)) {
            this.pathMiddleware.set(path, []);
          }
          this.pathMiddleware.get(path).push(middleware);
        }
      }
    }
    
    return this;
  }

  get(routePath, ...handlers) {
    this.addRoute("GET", routePath, ...handlers);
    return this;
  }

  post(routePath, ...handlers) {
    this.addRoute("POST", routePath, ...handlers);
    return this;
  }

  put(routePath, ...handlers) {
    this.addRoute("PUT", routePath, ...handlers);
    return this;
  }

  delete(routePath, ...handlers) {
    this.addRoute("DELETE", routePath, ...handlers);
    return this;
  }

  patch(routePath, ...handlers) {
    this.addRoute("PATCH", routePath, ...handlers);
    return this;
  }

  merge(routerToMerge) {
    this.#mergeNodes(this.rootNode, routerToMerge.rootNode);
  }

  nest(prefix, routerToNest) {
    this.#nestNodes(this.rootNode, routerToNest.rootNode, prefix);
    return this;
  }

  #nestNodes(currentNode, nodeToNest, prefix) {
    const newRouter = new Router();
    this.#generateNestedRoutes(nodeToNest, prefix, newRouter);
    this.#mergeNodes(currentNode, newRouter.rootNode);
  }

  /**
   * WebSocket route registration
   * @param {string} path - WebSocket route path
   * @param {...Function} handlers - WebSocket handlers
   * @returns {Router} For chaining
   */
  ws(path, ...handlers) {
    if (!this.wsRouter) {
      this.wsRouter = new WebSocketRouter(this.wsOptions);
    }
    this.wsRouter.route(path, ...handlers);
    return this;
  }

  /**
   * Handle WebSocket upgrade requests
   * @param {Request} req - HTTP request
   * @param {Socket} socket - TCP socket
   * @param {Buffer} head - Upgrade head
   */
  handleWebSocketUpgrade(req, socket, head) {
    if (!this.wsRouter) {
      socket.end('HTTP/1.1 404 Not Found\r\n\r\n');
      return;
    }
    
    // Parse query parameters for WebSocket requests
    const queryDelimiter = req.url.indexOf("?");
    if (queryDelimiter !== -1) {
      const queryString = req.url.substring(queryDelimiter + 1);
      req.query = Object.fromEntries(new URLSearchParams(queryString));
    } else {
      req.query = {};
    }
    
    this.wsRouter.handleUpgrade(req, socket, head);
  }

  /**
   * Get WebSocket router instance
   * @returns {WebSocketRouter|null}
   */
  getWebSocketRouter() {
    return this.wsRouter;
  }

  /**
   * Configure WebSocket options
   * @param {Object} options - WebSocket options
   * @returns {Router} For chaining
   */
  configureWebSocket(options) {
    this.wsOptions = { ...this.wsOptions, ...options };
    if (this.wsRouter) {
      // Update existing router options
      Object.assign(this.wsRouter.wsServer.options, options);
    }
    return this;
  }

  /**
   * WebSocket broadcast helper
   * @param {*} data - Data to broadcast
   * @param {Object} options - Broadcast options
   */
  broadcast(data, options = {}) {
    if (this.wsRouter) {
      this.wsRouter.broadcast(data, options);
    }
  }

  /**
   * Get WebSocket room helper
   * @param {string} room - Room name
   * @returns {Object|null} Room helper
   */
  room(room) {
    if (!this.wsRouter) return null;
    return this.wsRouter.room(room);
  }

  /**
   * Get WebSocket route helper
   * @param {string} path - Route path
   * @returns {Object|null} Route helper
   */
  to(path) {
    if (!this.wsRouter) return null;
    return this.wsRouter.to(path);
  }
}

module.exports = Router;