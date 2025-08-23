const Request = require('./Request');
const Response = require('./Response');

/**
 * Path trie node for efficient path prefix matching for middleware.
 * Each node represents a path segment and can store middleware functions.
 * 
 * @class PathTrieNode
 */
class PathTrieNode {
  constructor() {
    this.children = Object.create(null);
    this.middlewares = [];
    this.prefix = null;
  }
}

/**
 * Path trie for efficient path-based middleware lookups.
 * Provides O(segments) lookup time instead of O(n) linear scan.
 * 
 * @class PathTrie
 */
class PathTrie {
  constructor() {
    this.root = new PathTrieNode();
  }
  
  /**
   * Inserts a path and its middleware into the trie.
   * Optimized to avoid split/filter allocations.
   * 
   * @param {string} path - Path prefix
   * @param {Function} middleware - Middleware function
   */
  insert(path, middleware) {
    let node = this.root;
    const pathLength = path.length;
    let i = 0;
    
    while (i < pathLength) {
      // Skip leading and repeated slashes
      while (i < pathLength && path.charCodeAt(i) === 47) i++; // 47 = '/'
      if (i >= pathLength) break;
      
      // Find next segment
      let j = i;
      while (j < pathLength && path.charCodeAt(j) !== 47) j++;
      const segment = path.slice(i, j);
      
      if (!node.children[segment]) {
        node.children[segment] = new PathTrieNode();
      }
      node = node.children[segment];
      i = j;
    }
    
    node.prefix = path;
    node.middlewares.push(middleware);
  }
  
  /**
   * Finds all matching middleware for a given path.
   * Returns middleware for all matching prefixes.
   * Optimized to avoid split/filter and string concatenation.
   * 
   * @param {string} path - Request path
   * @returns {Array<{prefix: string, middlewares: Function[]}>} Matching middleware
   */
  findAllMatches(path) {
    const matches = [];
    let node = this.root;
    
    // Check root level middleware (for '/' prefix)
    if (node.middlewares.length > 0) {
      matches.push({ prefix: '/', middlewares: node.middlewares });
    }
    
    const pathLength = path.length;
    let i = 0;
    
    // Iterate through path without splitting
    while (i < pathLength) {
      // Skip leading and repeated slashes
      while (i < pathLength && path.charCodeAt(i) === 47) i++; // 47 = '/'
      if (i >= pathLength) break;
      
      // Find next segment
      let j = i;
      while (j < pathLength && path.charCodeAt(j) !== 47) j++;
      const segment = path.slice(i, j);
      
      // Check if segment exists in trie
      const child = node.children[segment];
      if (!child) break;
      
      node = child;
      if (node.middlewares.length > 0) {
        // Use the prefix stored on the node or compute it
        matches.push({ 
          prefix: node.prefix || path.slice(0, j), 
          middlewares: node.middlewares 
        });
      }
      
      i = j;
    }
    
    return matches;
  }
  
  /**
   * Gets all entries in the trie for iteration/merging.
   * Used for router composition operations.
   * 
   * @returns {Map<string, Function[]>} Map of paths to middleware arrays
   */
  getAllEntries() {
    const entries = new Map();
    
    const traverse = (node, path) => {
      if (node.middlewares.length > 0) {
        entries.set(node.prefix || path || '/', node.middlewares);
      }
      
      for (const segment in node.children) {
        const childNode = node.children[segment];
        const childPath = path ? `${path}/${segment}` : `/${segment}`;
        traverse(childNode, childPath);
      }
    };
    
    traverse(this.root, '');
    return entries;
  }
}

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
     * @description Static child segments (exact matches only)
     */
    this.children = Object.create(null);
    
    /**
     * @type {Array<{pattern: string, regex: RegExp, node: RouteNode, wildcardName: string}>|null}
     * @description Pattern children with precompiled regex (e.g., *.js, api*)
     */
    this.patternChildren = null;
    
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
    this._paramsPool = null;
    
    
    /**
     * @type {Object|null}
     * @private
     */
    this._performanceHooks = null;
    
    
    /**
     * @type {PathTrie|null}
     * @description Trie structure for efficient path error middleware lookups
     * @private
     */
    this._pathErrorMiddlewareTrie = null;
    
    /**
     * @type {PathTrie|null}
     * @description Trie structure for efficient path middleware lookups
     * @private
     */
    this._pathMiddlewareTrie = null;
    
    
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
    const { RouteCache, URLParseCache, ObjectPool } = require('../utils/cache');
    
    // Route caching
    const cacheSize = options.routeCacheSize || 500;
    this._routeCache = new RouteCache(cacheSize);
    
    // URL parsing cache
    this._urlCache = new URLParseCache(options.urlCacheSize || 200);
    
    
    // Object pools for request/response objects
    // Re-enabled after fixing frozen object issues in Request.js
    this._paramsPool = new ObjectPool(
      () => Object.create(null),  // Factory function
      (obj) => {  // Reset function - clear all properties
        for (const key in obj) {
          delete obj[key];
        }
      },
      100  // Pool size
    );
    
    
    // Performance monitoring
    if (options.performance) {
      const { createPerformanceHooks } = require('../utils/performance');
      this._performanceHooks = createPerformanceHooks(options.performance);
    }
    
    
    // Fast exact match map for static routes
    this._exactRoutes = new Map();
    // Don't build here - will be built incrementally during addRoute
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
    for (const method in node.handler) {
      const handler = node.handler[method];
      const key = `${method}:${currentPath || '/'}`;
      // Use requestHandler to match the structure returned by #findRouteHandler
      this._exactRoutes.set(key, { requestHandler: handler, extractedParams: {} });
    }
    
    // Only traverse static children (not params, wildcards, or patterns)
    for (const segment in node.children) {
      const child = node.children[segment];
      // Static children won't have isPattern flag
      if (!segment.includes(':') && !segment.includes('*')) {
        const childPath = currentPath + '/' + segment;
        this.#traverseForExactRoutes(child, childPath);
      }
    }
    // Don't traverse patternChildren as they're not exact routes
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
    for (const method in currentNode.handler) {
      const handler = currentNode.handler[method];
      newRouter.addRoute(method, currentPrefix, handler);
    }
    // Generate routes for static children
    for (const pathSegment in currentNode.children) {
      const subNode = currentNode.children[pathSegment];
      const nestedPath = `${currentPrefix}/${pathSegment}`;
      this.#generateNestedRoutes(subNode, nestedPath, newRouter);
    }
    
    // Generate routes for pattern children
    if (currentNode.patternChildren) {
      for (const pc of currentNode.patternChildren) {
        const nestedPath = `${currentPrefix}/${pc.pattern}`;
        this.#generateNestedRoutes(pc.node, nestedPath, newRouter);
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
      // Incremental exact route update
      if (this._exactRoutes) {
        this._exactRoutes.set(`${httpMethod}:/`, { requestHandler: currentNode.handler[httpMethod], extractedParams: {} });
      }
      return;
    }
    
    let pathStart = 1,
      pathEnd = 1,
      pathLength = routePath.length;
    let allStatic = true;
    
    for (; pathEnd <= pathLength; ++pathEnd) {
      if (pathEnd === pathLength || routePath[pathEnd] === "/") {
        let pathSegment = routePath.substring(pathStart, pathEnd);
        
        // Check if this segment makes the route non-static
        if (pathSegment[0] === ':' || pathSegment === '*' || pathSegment === '**' || pathSegment.includes('*')) {
          allStatic = false;
        }
        
        // Use the centralized helper to determine segment type and get/create the appropriate node
        const isLastSegment = pathEnd === pathLength;
        const nextNode = this.#routeSegmentToNode(currentNode, pathSegment, isLastSegment, routePath, pathEnd);
        
        currentNode = nextNode;
        pathStart = pathEnd + 1;
      }
    }
    
    currentNode.handler[httpMethod] = handlerChain.length === 1 ? handlerChain[0] : handlerChain;
    
    // Incremental exact route map update for static routes
    if (this._exactRoutes && allStatic) {
      this._exactRoutes.set(`${httpMethod}:${routePath}`, { requestHandler: currentNode.handler[httpMethod], extractedParams: {} });
    }
  }

  /**
   * Handles static segment creation in route tree.
   * 
   * @param {RouteNode} currentNode - Current node in the tree
   * @param {string} segment - Path segment
   * @returns {RouteNode} The created or existing node
   * @private
   */
  #handleStaticSegment(currentNode, segment) {
    if (!currentNode.children[segment]) {
      currentNode.children[segment] = new RouteNode();
    }
    return currentNode.children[segment];
  }

  /**
   * Handles parameter segment creation in route tree.
   * 
   * @param {RouteNode} currentNode - Current node in the tree
   * @param {string} segment - Path segment starting with ':'
   * @returns {RouteNode} The created or existing parameter node
   * @private
   */
  #handleParameterSegment(currentNode, segment) {
    if (!currentNode.param) {
      currentNode.param = new RouteNode();
      currentNode.param.paramName = segment.substring(1);
    }
    return currentNode.param;
  }

  /**
   * Handles wildcard segment creation in route tree.
   * 
   * @param {RouteNode} currentNode - Current node in the tree
   * @param {string} segment - Wildcard segment (*, *name)
   * @returns {RouteNode} The created or existing wildcard node
   * @private
   */
  #handleWildcardSegment(currentNode, segment) {
    if (!currentNode.wildcard) {
      currentNode.wildcard = new RouteNode();
      currentNode.wildcardName = segment.startsWith('*') ? segment.substring(1) || '*' : '*';
    }
    return currentNode.wildcard;
  }

  /**
   * Handles catch-all segment creation in route tree.
   * 
   * @param {RouteNode} currentNode - Current node in the tree
   * @param {string} segment - Catch-all segment (**, **name)
   * @returns {RouteNode} The created or existing catch-all node
   * @private
   */
  #handleCatchAllSegment(currentNode, segment) {
    if (!currentNode.catchAll) {
      currentNode.catchAll = new RouteNode();
      if (segment === '**') {
        currentNode.catchAllName = '**';
      } else if (segment.startsWith('**')) {
        currentNode.catchAllName = segment.substring(2) || '**';
      } else {
        currentNode.catchAllName = segment === '*' ? '*' : '**';
      }
    }
    return currentNode.catchAll;
  }

  /**
   * Handles pattern segment creation in route tree.
   * Pattern segments contain wildcards with static parts (e.g., *.js, prefix*)
   * 
   * @param {RouteNode} currentNode - Current node in the tree
   * @param {string} segment - Pattern segment
   * @returns {RouteNode} The created or existing pattern node
   * @private
   */
  #handlePatternSegment(currentNode, segment) {
    // Initialize patternChildren array if needed
    if (!currentNode.patternChildren) {
      currentNode.patternChildren = [];
    }
    
    // Check if pattern already exists
    for (const pc of currentNode.patternChildren) {
      if (pc.pattern === segment) {
        return pc.node;
      }
    }
    
    // Create new pattern node
    const node = new RouteNode();
    node.isPattern = true;
    
    // Precompile regex pattern once at node creation
    const regexPattern = segment
      .split('*')
      .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))  // Escape special regex chars
      .join('.*');  // Replace * with .*
    const regex = new RegExp(`^${regexPattern}$`);
    const wildcardName = segment.replace(/\*/g, '') || '*';
    
    // Store in patternChildren array for fast iteration
    currentNode.patternChildren.push({
      pattern: segment,
      regex: regex,
      node: node,
      wildcardName: wildcardName
    });
    
    return node;
  }

  /**
   * Routes a path segment to the appropriate node type.
   * Centralizes the logic for determining segment type and creating nodes.
   * 
   * @param {RouteNode} currentNode - Current node in the tree
   * @param {string} segment - Path segment to process
   * @param {boolean} isLastSegment - Whether this is the last segment
   * @param {string} fullPath - Full route path for context
   * @param {number} position - Current position in path
   * @returns {RouteNode} The appropriate node for this segment
   * @private
   */
  #routeSegmentToNode(currentNode, segment, isLastSegment, fullPath, position) {
    // Check for segments containing wildcards with static parts (e.g., *.js, prefix*, *suffix)
    const wildcardIndex = segment.indexOf('*');
    if (wildcardIndex !== -1 && segment !== '*' && segment !== '**' && !segment.startsWith('*')) {
      // Complex wildcard pattern with static parts
      return this.#handlePatternSegment(currentNode, segment);
    }
    // Check for catch-all wildcard (**)
    else if (segment === '**') {
      return this.#handleCatchAllSegment(currentNode, segment);
    }
    // Check for single-segment wildcard (*)
    else if (segment === '*') {
      // IMPORTANT: Wildcard logic explanation
      // A single '*' can mean two things:
      // 1. Single-segment wildcard: matches one path segment (e.g., /api/*/details)
      // 2. Catch-all: matches everything from this point (e.g., /api/*)
      // 
      // We treat '*' as catch-all ONLY when it's the absolute last segment.
      // This ensures /api/*/details works correctly (wildcard for middle segment)
      // while /api/* still works as catch-all.
      const hasMoreSegmentsAfter = position < fullPath.length && fullPath.indexOf('/', position) !== -1;
      
      if (isLastSegment && !hasMoreSegmentsAfter) {
        // It's a catch-all at the end of the route
        return this.#handleCatchAllSegment(currentNode, segment);
      } else {
        // It's a single-segment wildcard
        return this.#handleWildcardSegment(currentNode, segment);
      }
    }
    // Check for named wildcards like *filename or **path
    else if (segment.startsWith('**')) {
      return this.#handleCatchAllSegment(currentNode, segment);
    }
    else if (segment.startsWith('*')) {
      return this.#handleWildcardSegment(currentNode, segment);
    }
    // Check for parameters
    else if (segment[0] === ':') {
      return this.#handleParameterSegment(currentNode, segment);
    } else {
      // Static segment
      return this.#handleStaticSegment(currentNode, segment);
    }
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
    for (const method in nodeToMerge.handler) {
      const handler = nodeToMerge.handler[method];
      currentNode.handler[method] = handler;
    }
    // Merge static children
    for (const pathSegment in nodeToMerge.children) {
      const subNode = nodeToMerge.children[pathSegment];
      if (!currentNode.children[pathSegment]) {
        currentNode.children[pathSegment] = new RouteNode();
      }
      this.#mergeNodes(currentNode.children[pathSegment], subNode);
    }
    
    // Merge pattern children
    if (nodeToMerge.patternChildren) {
      if (!currentNode.patternChildren) {
        currentNode.patternChildren = [];
      }
      for (const pc of nodeToMerge.patternChildren) {
        // Check if pattern already exists
        let found = false;
        for (const existing of currentNode.patternChildren) {
          if (existing.pattern === pc.pattern) {
            // Merge into existing pattern node
            this.#mergeNodes(existing.node, pc.node);
            found = true;
            break;
          }
        }
        if (!found) {
          // Add new pattern
          currentNode.patternChildren.push({
            pattern: pc.pattern,
            regex: pc.regex,
            node: pc.node,
            wildcardName: pc.wildcardName
          });
        }
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

    for (const method in node.handler) {
      const handler = node.handler[method];
      const handlerName =
        handler.name ||
        handler
          .toString()
          .replace(/[\n]/g, "")
          .replace(/[\s]{2,}/g, " ")
          .substring(0, 30) + "...";
      console.log(`${indentation}    └─ [${method}] ↠  ${handlerName}`);
    }

    // Print static children
    for (const childPrefix in node.children) {
      const childNode = node.children[childPrefix];
      this.#printNode(childNode, childPrefix, level + 1, "├─");
    }
    
    // Print pattern children
    if (node.patternChildren) {
      for (const pc of node.patternChildren) {
        this.#printNode(pc.node, `[pattern: ${pc.pattern}]`, level + 1, "├─");
      }
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
      if (!this._globalMiddleware && !this._pathMiddlewareTrie && !this._pathErrorMiddlewareTrie && !this._errorMiddleware && !this._viewEngine && !this._performanceEnabled) {
        return this.#handleSimpleRequest(nativeReq, nativeRes);
      }
      
      const req = new Request(nativeReq, this);
      const res = new Response(nativeRes, this, nativeReq);

      if (this._performanceHooks?.beforeRequest) {
        this._performanceHooks.beforeRequest(req, res);
      }

      let middlewareIndex = 0;
      const globalMiddleware = this._globalMiddleware || [];
      
      // Collect path-specific middleware using trie for efficient lookup
      const pathMiddlewares = [];
      if (this._pathMiddlewareTrie) {
        const url = req.path || req.url;
        const matches = this._pathMiddlewareTrie.findAllMatches(url);
        for (const match of matches) {
          req.baseUrl = match.prefix;
          pathMiddlewares.push(...match.middlewares);
        }
      }
      
      // Execute middleware without array allocation - process global then path middleware
      const globalLength = globalMiddleware.length;
      const pathLength = pathMiddlewares.length;
      const totalLength = globalLength + pathLength;

      const next = async (err) => {
        if (err) {
          return this.#handleError(err, req, res);
        }

        if (middlewareIndex < totalLength) {
          // Select middleware from appropriate array without creating new array
          const middleware = middlewareIndex < globalLength
            ? globalMiddleware[middlewareIndex]
            : pathMiddlewares[middlewareIndex - globalLength];
          
          middlewareIndex++;
          
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
                // Don't clone params here; we'll copy directly into pool later
                routeHandler = {
                  handler: cached.handler,
                  requestHandler: cached.handler,
                  params: cached.params || null,
                  extractedParams: cached.params || null
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

          const sourceParams = routeHandler.params || routeHandler.extractedParams;
          
          if (this._paramsPool && sourceParams) {
            // Borrow object from pool and copy params directly into it
            const pooledParams = this._paramsPool.borrow();
            for (const key in sourceParams) {
              pooledParams[key] = sourceParams[key];
            }
            req.params = pooledParams;
            req._pooledParams = pooledParams; // Track for later return to pool
          } else {
            // Fallback to creating new object if pool not available
            req.params = sourceParams ? Object.assign(Object.create(null), sourceParams) : Object.create(null);
          }
          
          // Lazy query parameter parsing
          let _qp = null;
          Object.defineProperty(req, 'queryParams', {
            configurable: true,
            enumerable: true,
            get() {
              if (_qp === null) {
                _qp = new URLSearchParams(queryString);
              }
              return _qp;
            }
          });

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
          
          // Return pooled params object for reuse
          if (this._paramsPool && req._pooledParams) {
            // The pool's reset function will clear the object
            this._paramsPool.return(req._pooledParams);
            req._pooledParams = null;
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
    // Lazy query parameter parsing
    const queryString = queryDelimiter === -1 ? "" : url.substring(queryDelimiter);
    let _qp = null;
    Object.defineProperty(req, 'queryParams', {
      configurable: true,
      enumerable: true,
      get() {
        if (_qp === null) {
          _qp = new URLSearchParams(queryString);
        }
        return _qp;
      }
    });

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
   * Checks both path-specific and global error middleware.
   * 
   * @param {Error} err - The error that occurred
   * @param {Request} req - Request object
   * @param {Response} res - Response object
   * @private
   */
  #handleError(err, req, res) {
    // Process error middleware without array allocation
    let pathErrorMatches = [];
    if (this._pathErrorMiddlewareTrie) {
      const url = req.path || req.url;
      pathErrorMatches = this._pathErrorMiddlewareTrie.findAllMatches(url);
    }
    
    const globalErrorMiddleware = this._errorMiddleware || [];
    let pathMatchIndex = 0;
    let middlewareIndex = 0;

    const errorNext = async (error) => {
      const currentError = error || err;

      let handler = null;
      // First, iterate through all middlewares from all matching path prefixes
      if (pathMatchIndex < pathErrorMatches.length) {
        const match = pathErrorMatches[pathMatchIndex];
        if (middlewareIndex < match.middlewares.length) {
          handler = match.middlewares[middlewareIndex++];
        } else {
          // Move to the next path prefix match
          pathMatchIndex++;
          middlewareIndex = 0;
          return errorNext(currentError); // Recurse to check the next match
        }
      } 
      // After path middlewares, iterate through global error middlewares
      else if (middlewareIndex < globalErrorMiddleware.length) {
        handler = globalErrorMiddleware[middlewareIndex++];
      }

      if (handler) {
        try {
          await handler(currentError, req, res, errorNext);
        } catch (newError) {
          errorNext(newError);
        }
      } else {
        // If no more handlers, use the default
        this.#defaultErrorHandler(currentError, req, res);
      }
    };

    errorNext(err);
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
    let wildcardIndex = 0;

    for (let pathEnd = 1; pathEnd <= pathLength; ++pathEnd) {
      if (pathEnd === pathLength || routePath[pathEnd] === "/") {
        const rawSegment = routePath.substring(pathStart, pathEnd);
        // Only decode if segment contains encoded characters
        const pathSegment = rawSegment.indexOf('%') >= 0
          ? (() => { try { return decodeURIComponent(rawSegment); } catch { return rawSegment; } })()
          : rawSegment;
        let nextNode = null;
        
        // First try exact static match (O(1))
        nextNode = currentNode.children[pathSegment];
        
        // If no static match, check pattern children (usually very few)
        if (!nextNode && currentNode.patternChildren) {
          for (const pc of currentNode.patternChildren) {
            if (pc.regex.test(pathSegment)) {
              nextNode = pc.node;
              if (pc.wildcardName) {
                extractedParams[pc.wildcardName] = pathSegment;
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
            // Pick the first available handler from methodsToCheck
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
      const path = args[0];
      if (isErrorMiddleware(args[1])) {
        // Update trie for efficient lookups
        this.#updatePathErrorMiddlewareTrie(path, args[1]);
      } else {
        // Update trie for efficient lookups
        this.#updatePathMiddlewareTrie(path, args[1]);
      }
    } else if (args.length >= 2 && typeof args[0] === 'string') {
      // Path-specific with multiple middlewares: use('/path', middleware1, middleware2, ...)
      const path = args[0];
      const middlewares = args.slice(1);
      
      // Separate error and normal middleware
      const errorMiddlewares = middlewares.filter(isErrorMiddleware);
      const normalMiddlewares = middlewares.filter(m => !isErrorMiddleware(m));
      
      if (errorMiddlewares.length > 0) {
        // Update trie for efficient lookups
        for (const errorMiddleware of errorMiddlewares) {
          this.#updatePathErrorMiddlewareTrie(path, errorMiddleware);
        }
      }
      
      if (normalMiddlewares.length > 0) {
        // Update trie for efficient lookups
        for (const middleware of normalMiddlewares) {
          this.#updatePathMiddlewareTrie(path, middleware);
        }
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
    
    // Merge path middleware using trie's getAllEntries() method
    if (routerToMerge._pathMiddlewareTrie) {
      const entries = routerToMerge._pathMiddlewareTrie.getAllEntries();
      for (const [path, middlewares] of entries.entries()) {
        for (const middleware of middlewares) {
          this.#updatePathMiddlewareTrie(path, middleware);
        }
      }
    }
    
    if (routerToMerge._errorMiddleware && routerToMerge._errorMiddleware.length > 0) {
      if (!this._errorMiddleware) this._errorMiddleware = [];
      this._errorMiddleware.push(...routerToMerge._errorMiddleware);
    }
    
    // Merge path-specific error middleware using trie's getAllEntries() method
    if (routerToMerge._pathErrorMiddlewareTrie) {
      const entries = routerToMerge._pathErrorMiddlewareTrie.getAllEntries();
      for (const [path, errorMiddlewares] of entries.entries()) {
        for (const errorMiddleware of errorMiddlewares) {
          this.#updatePathErrorMiddlewareTrie(path, errorMiddleware);
        }
      }
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
      // Update trie for efficient lookups
      for (const middleware of routerToNest._globalMiddleware) {
        this.#updatePathMiddlewareTrie(prefix, middleware);
      }
    }
    
    // Nest path middleware using trie's getAllEntries() method
    if (routerToNest._pathMiddlewareTrie) {
      const entries = routerToNest._pathMiddlewareTrie.getAllEntries();
      for (const [path, middlewares] of entries.entries()) {
        const nestedPath = prefix + path;
        for (const middleware of middlewares) {
          this.#updatePathMiddlewareTrie(nestedPath, middleware);
        }
      }
    }
    
    // Nest path error middleware using trie's getAllEntries() method
    if (routerToNest._pathErrorMiddlewareTrie) {
      const entries = routerToNest._pathErrorMiddlewareTrie.getAllEntries();
      for (const [path, errorMiddlewares] of entries.entries()) {
        const nestedPath = prefix + path;
        for (const errorMiddleware of errorMiddlewares) {
          this.#updatePathErrorMiddlewareTrie(nestedPath, errorMiddleware);
        }
      }
    }
    
    // Invalidate caches
    if (this._routeCache) this._routeCache.invalidate();
    if (this._exactRoutes) this.#buildExactRoutesMap();
    
    return this;
  }

  /**
   * Internal helper for nesting route nodes with a prefix.
   * Directly traverses and inserts prefixed routes into the tree.
   * Optimized to avoid creating temporary router instances.
   * 
   * @param {RouteNode} currentNode - Current router's root node
   * @param {RouteNode} nodeToNest - Node to nest with prefix
   * @param {string} prefix - Path prefix to apply
   * @private
   */
  #nestNodes(currentNode, nodeToNest, prefix) {
    // Direct tree traversal and insertion without temporary router
    this.#directNestNodes(currentNode, nodeToNest, prefix.split('/').filter(s => s));
  }
  
  /**
   * Directly nests nodes by traversing and inserting with prefix segments.
   * Avoids the overhead of creating a temporary router.
   * 
   * @param {RouteNode} targetNode - Target node to insert into
   * @param {RouteNode} sourceNode - Source node to nest
   * @param {string[]} prefixSegments - Array of prefix path segments
   * @private
   */
  #directNestNodes(targetNode, sourceNode, prefixSegments) {
    // Navigate to the target position for the prefix
    let currentTarget = targetNode;
    for (const segment of prefixSegments) {
      if (!currentTarget.children[segment]) {
        currentTarget.children[segment] = new RouteNode();
      }
      currentTarget = currentTarget.children[segment];
    }
    
    // Now merge the source node at this position
    this.#mergeNodes(currentTarget, sourceNode);
  }
  
  /**
   * Updates the path middleware trie for efficient lookups.
   * Creates the trie lazily on first use.
   * 
   * @param {string} path - Path prefix for middleware
   * @param {Function} middleware - Middleware function to add
   * @private
   */
  #updatePathMiddlewareTrie(path, middleware) {
    if (!this._pathMiddlewareTrie) {
      this._pathMiddlewareTrie = new PathTrie();
    }
    this._pathMiddlewareTrie.insert(path, middleware);
  }

  /**
   * Updates the path error middleware trie for efficient lookups.
   * Creates the trie lazily on first use.
   * 
   * @param {string} path - Path prefix for error middleware
   * @param {Function} errorMiddleware - Error middleware function to add
   * @private
   */
  #updatePathErrorMiddlewareTrie(path, errorMiddleware) {
    if (!this._pathErrorMiddlewareTrie) {
      this._pathErrorMiddlewareTrie = new PathTrie();
    }
    this._pathErrorMiddlewareTrie.insert(path, errorMiddleware);
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