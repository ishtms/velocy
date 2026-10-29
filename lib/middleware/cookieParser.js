/**
 * Cookie parser middleware factory
 * @param {string} secret - Secret for signed cookies (optional)
 * @returns {Function} Middleware function
 */
function cookieParser(secret) {
  if (secret !== undefined &&
      ((typeof secret !== 'string' && !Buffer.isBuffer(secret)) || !secret.length)) {
    throw new TypeError('Cookie secret must be a non-empty string or Buffer');
  }
  return function cookieParserMiddleware(req, res, next) {
    if (secret) {
      // Configure both directions before lazy parsing/signing. Conflicting
      // Router/middleware secrets must fail rather than mint unverifiable cookies.
      res._setCookieSecret?.(secret);
      if (Object.hasOwn(req, 'cookieSecret')) {
        if (!Buffer.from(req.cookieSecret).equals(Buffer.from(secret))) {
          throw new Error('Conflicting cookie signing configuration');
        }
      } else {
        Object.defineProperty(req, 'cookieSecret', { value: secret });
      }
    }
    
    // Trigger cookie parsing by accessing the getter
    const _ = req.cookies; // This will parse cookies lazily
    
    // Continue to next middleware
    if (next) next();
  };
}

module.exports = cookieParser;
