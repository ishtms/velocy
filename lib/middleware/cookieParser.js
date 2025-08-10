/**
 * Cookie parser middleware factory
 * @param {string} secret - Secret for signed cookies (optional)
 * @returns {Function} Middleware function
 */
function cookieParser(secret) {
  return function cookieParserMiddleware(req, res, next) {
    // Set the cookie secret if provided
    if (secret && !req.constructor.prototype.cookieSecret) {
      Object.defineProperty(req, 'cookieSecret', {
        value: secret,
        writable: false,
        enumerable: false,
        configurable: false
      });
    }
    
    // Trigger cookie parsing by accessing the getter
    const _ = req.cookies; // This will parse cookies lazily
    
    // Continue to next middleware
    if (next) next();
  };
}

module.exports = cookieParser;