/**
 * Velocy Framework Middleware Collection
 * 
 * Export all available middleware modules for convenient access
 * 
 * @module middleware
 */

const bodyParser = require('./bodyParser');
const cookieParser = require('./cookieParser');
const cors = require('./cors');
const staticMiddleware = require('./static');
const compression = require('./compression');
const rateLimit = require('./rateLimit');
const session = require('./session');
const validator = require('./validator');

module.exports = {
  bodyParser,
  cookieParser,
  cors,
  static: staticMiddleware,
  compression,
  rateLimit,
  session,
  validator,
  validate: validator
};

// Also export individual middleware for direct access
module.exports.bodyParser = bodyParser;
module.exports.cookieParser = cookieParser;
module.exports.cors = cors;
module.exports.static = staticMiddleware;
module.exports.compression = compression;
module.exports.rateLimit = rateLimit;
module.exports.session = session;
module.exports.validator = validator;
module.exports.validate = validator;