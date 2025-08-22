const { WebSocketServer } = require('./WebSocket');

/**
 * WebSocket Router implementation providing HTTP-like routing for WebSocket connections.
 * Enables path-based routing, middleware support, and parameter extraction for WebSocket
 * endpoints. Works similarly to HTTP routers but for WebSocket upgrade requests.
 * 
 * Features include:
 * - Path-based routing with parameter extraction (/chat/:room)
 * - Wildcard pattern matching (/api/*)
 * - Middleware chain support with error handling
 * - Route prioritization by specificity
 * - Integration with WebSocketServer for connection management
 * 
 * Routes are matched during the HTTP upgrade phase based on the request URL.
 * Once a WebSocket connection is established, the matched route handlers are
 * executed with the connection instance and extracted parameters.
 * 
 * @class WebSocketRouter
 * @example
 * const wsRouter = new WebSocketRouter();
 * 
 * // Add middleware
 * wsRouter.use(authMiddleware);
 * 
 * // Add routes with parameter extraction
 * wsRouter.route('/chat/:room', (ws, params) => {
 *   ws.join(params.room);
 *   ws.send(`Welcome to ${params.room}!`);
 * });
 * 
 * // Wildcard routes
 * wsRouter.route('/api/*', apiHandler);
 * 
 * // Handle upgrade in HTTP server
 * server.on('upgrade', (req, socket, head) => {
 *   wsRouter.handleUpgrade(req, socket, head);
 * });
 */
class WebSocketRouter {
  /**
   * Creates a new WebSocket router instance.
   * Initializes the routing system with support for exact matches, parameterized routes,
   * and wildcard patterns. Also sets up the underlying WebSocket server for connection handling.
   * 
   * @constructor
   * @param {Object} [options={}] - Router configuration options
   * @param {boolean} [options.enableQueue] - Enable message queuing for offline clients
   * @param {number} [options.maxQueueSize] - Maximum queued messages per client
   * @param {Function} [options.handleProtocols] - WebSocket subprotocol negotiation handler
   * @param {number} [options.maxPayloadSize] - Maximum payload size for connections
   * @param {number} [options.heartbeatInterval] - Heartbeat interval for connections
   * @param {number} [options.heartbeatTimeout] - Heartbeat timeout for connections
   * @example
   * const router = new WebSocketRouter({
   *   enableQueue: true,
   *   maxQueueSize: 100,
   *   heartbeatInterval: 30000
   * });
   */
  constructor(options = {}) {
    /**
     * @type {Map<string, Object>}
     * @description Flat map of route patterns to route information objects
     */
    this.routes = new Map();
    
    /**
     * @type {Function[]}
     * @description Array of middleware functions to run before route handlers
     */
    this.middleware = [];
    
    /**
     * @type {Function[]}
     * @description Array of error handling middleware functions
     */
    this.errorHandlers = [];
    
    /**
     * @type {WebSocketServer}
     * @description Underlying WebSocket server for connection management
     */
    this.wsServer = new WebSocketServer(options);
    
    /**
     * @type {Object}
     * @description Route tree organized by type for efficient matching
     */
    this.routeTree = {
      /** @type {Map<string, Object>} Exact path matches without parameters */
      exact: new Map(),
      /** @type {Object[]} Parameterized routes sorted by specificity */
      params: [],
      /** @type {Object[]} Wildcard pattern routes */
      patterns: []
    };
  }
  
  /**
   * Registers a WebSocket route with the specified path pattern and handlers.
   * Supports parameter extraction using colon syntax (:param) and wildcard matching
   * using asterisk (*). Routes are organized by type for efficient matching during
   * the upgrade process. Multiple handlers can be provided and will be executed in sequence.
   * 
   * @param {string} path - Route path pattern supporting parameters and wildcards
   * @param {...Function} handlers - Handler functions for WebSocket connections
   * @returns {WebSocketRouter} Returns this router instance for method chaining
   * @throws {Error} If no handlers are provided
   * @example
   * // Exact path matching
   * router.route('/chat', (ws) => {
   *   ws.send('Welcome to chat!');
   * });
   * 
   * // Parameter extraction
   * router.route('/room/:roomId', (ws, params) => {
   *   ws.join(params.roomId);
   *   ws.send(`Joined room: ${params.roomId}`);
   * });
   * 
   * // Wildcard matching
   * router.route('/api/*', authMiddleware, (ws, params) => {
   *   // Handle all API WebSocket connections
   * });
   * 
   * // Multiple handlers
   * router.route('/secure/:id', authMiddleware, validationMiddleware, mainHandler);
   */
  route(path, ...handlers) {
    if (handlers.length === 0) {
      throw new Error(`No handler provided for WebSocket route ${path}`);
    }
    
    // Parse the route pattern
    const routeInfo = this.#parseRoute(path);
    routeInfo.handlers = handlers.flat();
    
    // Store in appropriate structure
    if (routeInfo.isExact) {
      this.routeTree.exact.set(path, routeInfo);
    } else if (routeInfo.hasParams) {
      this.routeTree.params.push(routeInfo);
      // Sort by specificity (routes with fewer params come first)
      this.routeTree.params.sort((a, b) => a.params.length - b.params.length);
    } else if (routeInfo.hasWildcard) {
      this.routeTree.patterns.push(routeInfo);
    }
    
    // Also store in flat map for quick lookup
    this.routes.set(path, routeInfo);
    
    return this;
  }
  
  /**
   * Shorthand for route()
   */
  ws(path, ...handlers) {
    return this.route(path, ...handlers);
  }
  
  /**
   * Add middleware for all WebSocket connections
   * @param {...Function} middleware - Middleware functions
   * @returns {WebSocketRouter} For chaining
   */
  use(...middleware) {
    this.middleware.push(...middleware.flat());
    return this;
  }
  
  /**
   * Add error handler
   * @param {Function} handler - Error handler function
   * @returns {WebSocketRouter} For chaining
   */
  error(handler) {
    this.errorHandlers.push(handler);
    return this;
  }
  
  /**
   * Handle WebSocket upgrade request
   * @param {Request} req - HTTP request
   * @param {Socket} socket - TCP socket
   * @param {Buffer} head - Upgrade head
   */
  handleUpgrade(req, socket, head) {
    const path = this.#extractPath(req.url);
    const route = this.#matchRoute(path);
    
    if (!route) {
      // No matching route
      socket.end('HTTP/1.1 404 Not Found\r\n\r\n');
      return;
    }
    
    // Extract route parameters
    if (route.params) {
      req.params = route.params;
    }
    
    // Parse query parameters
    const queryIndex = req.url.indexOf('?');
    if (queryIndex !== -1) {
      const queryString = req.url.slice(queryIndex + 1);
      req.query = {};
      const params = new URLSearchParams(queryString);
      for (const [key, value] of params) {
        req.query[key] = value;
      }
    } else {
      req.query = {};
    }
    
    // Create WebSocket connection
    const ws = this.wsServer.handleUpgrade(req, socket, head);
    if (!ws) return;
    
    // Store route info on the connection
    ws.route = route.path;
    ws.routePattern = route.pattern;
    
    // Apply middleware and handlers
    this.#executeHandlers(ws, req, route);
  }
  
  #parseRoute(path) {
    const segments = path.split('/').filter(s => s);
    const params = [];
    let hasWildcard = false;
    let pattern = '^';
    
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      pattern += '\\/';
      
      if (segment.startsWith(':')) {
        // Parameter segment
        const paramName = segment.slice(1);
        params.push({ name: paramName, index: i });
        pattern += '([^\\/]+)';
      } else if (segment === '*') {
        // Single segment wildcard
        hasWildcard = true;
        pattern += '[^\\/]+';
      } else if (segment === '**') {
        // Multi-segment wildcard
        hasWildcard = true;
        pattern += '.*';
      } else {
        // Literal segment
        pattern += segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      }
    }
    
    pattern += '$';
    
    return {
      path,
      pattern: new RegExp(pattern),
      segments,
      params,
      hasParams: params.length > 0,
      hasWildcard,
      isExact: params.length === 0 && !hasWildcard,
      handlers: []
    };
  }
  
  #extractPath(url) {
    const queryIndex = url.indexOf('?');
    return queryIndex === -1 ? url : url.slice(0, queryIndex);
  }
  
  #matchRoute(path) {
    // Try exact match first
    const exactRoute = this.routeTree.exact.get(path);
    if (exactRoute) {
      return {
        ...exactRoute,
        params: null
      };
    }
    
    // Try parameterized routes
    for (const route of this.routeTree.params) {
      const match = path.match(route.pattern);
      if (match) {
        const params = {};
        for (let i = 0; i < route.params.length; i++) {
          params[route.params[i].name] = match[i + 1];
        }
        return {
          ...route,
          params
        };
      }
    }
    
    // Try wildcard patterns
    for (const route of this.routeTree.patterns) {
      if (route.pattern.test(path)) {
        return {
          ...route,
          params: null
        };
      }
    }
    
    return null;
  }
  
  async #executeHandlers(ws, req, route) {
    // Create handler context
    const context = {
      ws,
      req,
      route: route.path,
      params: req.params || {},
      query: req.query || {}
    };
    
    // Combine middleware and route handlers
    const allHandlers = [...this.middleware, ...route.handlers];
    
    // Execute handlers in sequence
    let index = 0;
    
    const next = async (err) => {
      if (err) {
        return this.#handleError(err, context);
      }
      
      if (index >= allHandlers.length) return;
      
      const handler = allHandlers[index++];
      
      try {
        // Check if handler accepts next callback
        if (handler.length >= 3) {
          // Middleware style with next
          await new Promise((resolve, reject) => {
            handler(ws, req, (err) => {
              if (err) reject(err);
              else resolve();
            });
          });
          await next();
        } else {
          // Simple handler
          await handler(ws, req);
          // Continue to next handler
          await next();
        }
      } catch (error) {
        await this.#handleError(error, context);
      }
    };
    
    // Start execution
    await next();
  }
  
  async #handleError(error, context) {
    const { ws } = context;
    
    // Try error handlers
    for (const handler of this.errorHandlers) {
      try {
        await handler(error, ws, context);
        return; // Error handled
      } catch (err) {
        // Error handler failed, try next
        continue;
      }
    }
    
    // Default error handling - silently handle in production
    // Send error to client if connection is open
    if (ws && ws.state === 1) {
      ws.send(JSON.stringify({
        type: 'error',
        message: error.message || 'Internal server error'
      }));
    }
  }
  
  /**
   * Get broadcast helper for specific route
   * @param {string} path - Route path
   * @returns {Object} Broadcast helper
   */
  to(path) {
    const self = this;
    
    return {
      /**
       * Broadcast to all connections on this route
       * @param {*} data - Data to broadcast
       * @param {Object} options - Broadcast options
       */
      broadcast(data, options = {}) {
        const connections = [];
        
        for (const ws of self.wsServer.connections.values()) {
          if (ws.route === path || (ws.routePattern && self.#matchRoute(ws.route)?.path === path)) {
            connections.push(ws);
          }
        }
        
        const { except } = options;
        const exceptSet = except ? new Set(Array.isArray(except) ? except : [except]) : null;
        
        for (const ws of connections) {
          if (exceptSet && exceptSet.has(ws.id)) continue;
          ws.send(data);
        }
      },
      
      /**
       * Get all connections on this route
       * @returns {Array} Connections
       */
      getConnections() {
        const connections = [];
        
        for (const ws of self.wsServer.connections.values()) {
          if (ws.route === path || (ws.routePattern && self.#matchRoute(ws.route)?.path === path)) {
            connections.push(ws);
          }
        }
        
        return connections;
      }
    };
  }
  
  /**
   * Get room helper
   * @param {string} room - Room name
   * @returns {Object} Room helper
   */
  room(room) {
    const self = this;
    
    return {
      /**
       * Broadcast to all connections in this room
       * @param {*} data - Data to broadcast
       * @param {Object} options - Broadcast options
       */
      broadcast(data, options = {}) {
        self.wsServer.broadcastToRoom(room, data, options);
      },
      
      /**
       * Get all connections in this room
       * @returns {Array} Connections
       */
      getConnections() {
        return self.wsServer.getRoom(room);
      },
      
      /**
       * Get room size
       * @returns {number} Number of connections
       */
      size() {
        const roomConnections = self.wsServer.rooms.get(room);
        return roomConnections ? roomConnections.size : 0;
      }
    };
  }
  
  /**
   * Broadcast to all WebSocket connections
   * @param {*} data - Data to broadcast
   * @param {Object} options - Broadcast options
   */
  broadcast(data, options = {}) {
    this.wsServer.broadcast(data, options);
  }
  
  /**
   * Get server statistics
   * @returns {Object} Statistics
   */
  getStats() {
    const stats = this.wsServer.getStats();
    stats.routes = this.routes.size;
    return stats;
  }
  
  /**
   * Close all connections
   * @param {number} code - Close code
   * @param {string} reason - Close reason
   */
  closeAll(code, reason) {
    this.wsServer.closeAll(code, reason);
  }
}

module.exports = WebSocketRouter;