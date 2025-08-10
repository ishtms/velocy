// Core modules
const Router = require('./core/Router');
const Request = require('./core/Request');
const Response = require('./core/Response');
const SimpleRouter = require('./core/SimpleRouter');
const WebSocketRouter = require('./core/WebSocketRouter');
const { WebSocketConnection, WebSocketServer, OPCODES, CLOSE_CODES, STATES } = require('./core/WebSocket');

// Middleware modules
const cors = require('./middleware/cors');
const cookieParser = require('./middleware/cookieParser');
const staticMiddleware = require('./middleware/static');

// Utility modules
const { createServer, buildQueryString } = require('./utils');
const websocketUtils = require('./utils/websocket');

module.exports = {
  // Core classes
  Router,
  Request,
  Response,
  SimpleRouter,
  WebSocketRouter,
  WebSocketConnection,
  WebSocketServer,
  
  // WebSocket constants
  WS_OPCODES: OPCODES,
  WS_CLOSE_CODES: CLOSE_CODES,
  WS_STATES: STATES,
  
  // Middleware
  cors,
  cookieParser,
  static: staticMiddleware,
  
  // Utilities
  createServer,
  buildQueryString,
  websocketUtils
};