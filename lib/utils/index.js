const http = require("node:http");
const ViewEngine = require("./viewEngine");
const engineAdapters = require("./engineAdapters");

/**
 * Creates an HTTP server with the provided router
 * @param {Router} router - Router instance to handle requests
 * @returns {http.Server} Node.js HTTP server
 */
function createServer(router) {
  const server = http.createServer((req, res) => {
    router.handleRequest(req, res);
  });
  
  // Handle WebSocket upgrade requests
  server.on('upgrade', (req, socket, head) => {
    // Check if this is a WebSocket upgrade request
    if (req.headers.upgrade && req.headers.upgrade.toLowerCase() === 'websocket') {
      router.handleWebSocketUpgrade(req, socket, head);
    } else {
      // Not a WebSocket upgrade
      socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    }
  });
  
  return server;
}

/**
 * Builds a query string from an object, supporting nested objects and arrays
 * @param {Object} obj - The object to convert to a query string
 * @param {Object} options - Options for building the query string
 * @param {boolean} options.encode - Whether to URL encode values (default: true)
 * @param {boolean} options.skipNulls - Whether to skip null and undefined values (default: false)
 * @param {boolean} options.arrayFormat - Format for arrays: 'brackets' (default), 'indices', 'repeat', 'comma'
 * @returns {string} The built query string (without leading '?')
 */
function buildQueryString(obj, options = {}) {
  const {
    encode = true,
    skipNulls = false,
    arrayFormat = 'brackets'
  } = options;
  
  const pairs = [];
  
  /**
   * Encodes a value for use in a query string
   */
  const encodeValue = (val) => {
    if (!encode) return String(val);
    return encodeURIComponent(String(val));
  };
  
  /**
   * Recursively builds query string pairs
   */
  const buildPairs = (currentObj, prefix = '') => {
    if (currentObj === null || currentObj === undefined) {
      if (!skipNulls) {
        pairs.push(`${prefix}=${currentObj === null ? 'null' : ''}`);
      }
      return;
    }
    
    if (Array.isArray(currentObj)) {
      if (currentObj.length === 0) {
        // Empty array
        if (!skipNulls) {
          if (arrayFormat === 'brackets') {
            pairs.push(`${prefix}[]`);
          } else {
            pairs.push(`${prefix}=`);
          }
        }
        return;
      }
      
      currentObj.forEach((val, index) => {
        let key;
        switch (arrayFormat) {
          case 'brackets':
            key = `${prefix}[]`;
            break;
          case 'indices':
            key = `${prefix}[${index}]`;
            break;
          case 'repeat':
            key = prefix;
            break;
          case 'comma':
            // Handle comma format specially
            if (index === 0) {
              const values = currentObj.map(v => encodeValue(v)).join(',');
              pairs.push(`${prefix}=${values}`);
            }
            return;
          default:
            key = `${prefix}[]`;
        }
        
        if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
          // Nested object in array
          buildPairs(val, `${key}`);
        } else {
          const encodedVal = val === null ? 'null' : 
                            val === undefined ? '' : 
                            typeof val === 'boolean' ? String(val) :
                            encodeValue(val);
          pairs.push(`${key}=${encodedVal}`);
        }
      });
      return;
    }
    
    if (typeof currentObj === 'object') {
      // Handle nested objects
      for (const [key, val] of Object.entries(currentObj)) {
        const newPrefix = prefix ? `${prefix}[${key}]` : key;
        
        if (typeof val === 'object' && val !== null) {
          buildPairs(val, newPrefix);
        } else {
          if (val === null || val === undefined) {
            if (!skipNulls) {
              pairs.push(`${newPrefix}=${val === null ? 'null' : ''}`);
            }
          } else {
            const encodedVal = typeof val === 'boolean' ? String(val) : encodeValue(val);
            pairs.push(`${newPrefix}=${encodedVal}`);
          }
        }
      }
      return;
    }
    
    // Primitive value at root level
    const encodedVal = typeof currentObj === 'boolean' ? String(currentObj) : encodeValue(currentObj);
    pairs.push(`${prefix}=${encodedVal}`);
  };
  
  buildPairs(obj);
  
  return pairs.join('&');
}

module.exports = {
  createServer,
  buildQueryString,
  ViewEngine,
  engineAdapters
};