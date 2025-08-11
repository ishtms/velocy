// Core modules
const Router = require('./core/Router');
const FastRouter = require('./core/FastRouter');
const Request = require('./core/Request');
const Response = require('./core/Response');
const SimpleRouter = require('./core/SimpleRouter');
const WebSocketRouter = require('./core/WebSocketRouter');
const { WebSocketConnection, WebSocketServer, OPCODES, CLOSE_CODES, STATES } = require('./core/WebSocket');

// Middleware modules
const bodyParser = require('./middleware/bodyParser');
const cors = require('./middleware/cors');
const cookieParser = require('./middleware/cookieParser');
const staticMiddleware = require('./middleware/static');
const compression = require('./middleware/compression');
const rateLimit = require('./middleware/rateLimit');
const session = require('./middleware/session');
const validator = require('./middleware/validator');

// Utility modules
const { createServer, buildQueryString } = require('./utils');
const websocketUtils = require('./utils/websocket');

module.exports = {
  // Core classes
  Router,
  FastRouter,
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
  bodyParser,
  cors,
  cookieParser,
  static: staticMiddleware,
  compression,
  rateLimit,
  session,
  validator,
  validate: validator,
  
  // Utilities
  createServer,
  buildQueryString,
  websocketUtils
};