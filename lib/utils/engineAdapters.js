/**
 * Template Engine Adapters for Velocy
 * 
 * This module provides adapter functions to integrate popular template engines
 * with Velocy's view engine system. These are reference implementations showing
 * how to properly integrate third-party template engines.
 * 
 * Note: The actual template engine packages are not included as dependencies.
 * Users must install them separately if they want to use them.
 */

/**
 * EJS (Embedded JavaScript) Adapter
 * Install: npm install ejs
 * 
 * @example
 * const ejs = require('ejs');
 * app.engine('ejs', engineAdapters.createEjsAdapter(ejs));
 * app.set('view engine', 'ejs');
 */
function createEjsAdapter(ejs) {
  return (filePath, data, callback) => {
    // EJS renderFile already supports callbacks
    ejs.renderFile(filePath, data, {}, callback);
  };
}

/**
 * Pug (formerly Jade) Adapter
 * Install: npm install pug
 * 
 * @example
 * const pug = require('pug');
 * app.engine('pug', engineAdapters.createPugAdapter(pug));
 * app.set('view engine', 'pug');
 */
function createPugAdapter(pug) {
  return (filePath, data, callback) => {
    try {
      // Pug compile + render pattern
      const compiled = pug.compileFile(filePath);
      const html = compiled(data);
      callback(null, html);
    } catch (err) {
      callback(err);
    }
  };
}

/**
 * Handlebars Adapter
 * Install: npm install handlebars
 * 
 * @example
 * const handlebars = require('handlebars');
 * const fs = require('fs');
 * app.engine('hbs', engineAdapters.createHandlebarsAdapter(handlebars, fs));
 * app.set('view engine', 'hbs');
 */
function createHandlebarsAdapter(handlebars, fs) {
  const cache = {};
  
  return (filePath, data, callback) => {
    const readAndCompile = (cb) => {
      fs.readFile(filePath, 'utf8', (err, template) => {
        if (err) return cb(err);
        
        try {
          const compiled = handlebars.compile(template);
          cb(null, compiled);
        } catch (compileErr) {
          cb(compileErr);
        }
      });
    };
    
    // Simple caching in production
    if (process.env.NODE_ENV === 'production' && cache[filePath]) {
      try {
        const html = cache[filePath](data);
        callback(null, html);
      } catch (err) {
        callback(err);
      }
    } else {
      readAndCompile((err, compiled) => {
        if (err) return callback(err);
        
        if (process.env.NODE_ENV === 'production') {
          cache[filePath] = compiled;
        }
        
        try {
          const html = compiled(data);
          callback(null, html);
        } catch (renderErr) {
          callback(renderErr);
        }
      });
    }
  };
}

/**
 * Mustache Adapter
 * Install: npm install mustache
 * 
 * @example
 * const mustache = require('mustache');
 * const fs = require('fs');
 * app.engine('mustache', engineAdapters.createMustacheAdapter(mustache, fs));
 * app.set('view engine', 'mustache');
 */
function createMustacheAdapter(mustache, fs) {
  return (filePath, data, callback) => {
    fs.readFile(filePath, 'utf8', (err, template) => {
      if (err) return callback(err);
      
      try {
        const html = mustache.render(template, data);
        callback(null, html);
      } catch (renderErr) {
        callback(renderErr);
      }
    });
  };
}

/**
 * Nunjucks Adapter
 * Install: npm install nunjucks
 * 
 * @example
 * const nunjucks = require('nunjucks');
 * nunjucks.configure('views', { autoescape: true });
 * app.engine('njk', engineAdapters.createNunjucksAdapter(nunjucks));
 * app.set('view engine', 'njk');
 */
function createNunjucksAdapter(nunjucks) {
  return (filePath, data, callback) => {
    nunjucks.render(filePath, data, callback);
  };
}

/**
 * Eta Adapter (lightweight EJS alternative)
 * Install: npm install eta
 * 
 * @example
 * const eta = require('eta');
 * app.engine('eta', engineAdapters.createEtaAdapter(eta));
 * app.set('view engine', 'eta');
 */
function createEtaAdapter(eta) {
  return async (filePath, data, callback) => {
    try {
      const html = await eta.renderFile(filePath, data);
      callback(null, html);
    } catch (err) {
      callback(err);
    }
  };
}

/**
 * Liquid Adapter (Shopify's template language)
 * Install: npm install liquidjs
 * 
 * @example
 * const { Liquid } = require('liquidjs');
 * const liquid = new Liquid();
 * app.engine('liquid', engineAdapters.createLiquidAdapter(liquid));
 * app.set('view engine', 'liquid');
 */
function createLiquidAdapter(liquid) {
  return async (filePath, data, callback) => {
    try {
      const html = await liquid.renderFile(filePath, data);
      callback(null, html);
    } catch (err) {
      callback(err);
    }
  };
}

/**
 * Creates a caching wrapper for any template engine
 * This adds production caching to engines that don't have it built-in
 * 
 * @param {Function} engine - The engine function to wrap
 * @param {Object} options - Caching options
 * @returns {Function} Wrapped engine with caching
 */
function withCaching(engine, options = {}) {
  const {
    enabled = process.env.NODE_ENV === 'production',
    maxSize = 100,
    ttl = null // Time to live in milliseconds (null = no expiry)
  } = options;
  
  const cache = new Map();
  
  return (filePath, data, callback) => {
    if (!enabled) {
      return engine(filePath, data, callback);
    }
    
    const cacheKey = filePath;
    const cached = cache.get(cacheKey);
    
    // Check if cached and not expired
    if (cached) {
      if (!ttl || Date.now() - cached.timestamp < ttl) {
        try {
          // If cached value is a compiled function, execute it
          const html = typeof cached.value === 'function' 
            ? cached.value(data) 
            : cached.value;
          return callback(null, html);
        } catch (err) {
          // On error, invalidate cache and re-render
          cache.delete(cacheKey);
        }
      } else {
        // Expired
        cache.delete(cacheKey);
      }
    }
    
    // Render and cache
    engine(filePath, data, (err, html) => {
      if (err) return callback(err);
      
      // Implement LRU by removing oldest if at max size
      if (cache.size >= maxSize) {
        const firstKey = cache.keys().next().value;
        cache.delete(firstKey);
      }
      
      cache.set(cacheKey, {
        value: html,
        timestamp: Date.now()
      });
      
      callback(null, html);
    });
  };
}

/**
 * Creates an engine adapter that supports layouts
 * Wraps any engine to add layout support
 * 
 * @param {Function} engine - The engine function to wrap
 * @param {Object} options - Layout options
 * @returns {Function} Wrapped engine with layout support
 */
function withLayouts(engine, options = {}) {
  const {
    layoutsDir = 'views/layouts',
    defaultLayout = 'main',
    layoutKey = 'layout',
    bodyKey = 'body'
  } = options;
  
  const path = require('node:path');
  
  return async (filePath, data, callback) => {
    try {
      // First render the main view
      const renderView = () => new Promise((resolve, reject) => {
        engine(filePath, data, (err, html) => {
          if (err) reject(err);
          else resolve(html);
        });
      });
      
      const body = await renderView();
      
      // Check if layout is specified
      const layout = data[layoutKey] || defaultLayout;
      if (!layout || layout === false) {
        return callback(null, body);
      }
      
      // Construct layout path
      const layoutPath = path.isAbsolute(layout) 
        ? layout 
        : path.join(layoutsDir, layout + path.extname(filePath));
      
      // Render the layout with the body
      const layoutData = {
        ...data,
        [bodyKey]: body
      };
      
      engine(layoutPath, layoutData, callback);
    } catch (err) {
      callback(err);
    }
  };
}

/**
 * Creates an engine adapter that supports partials/includes
 * Note: Most engines have their own partial support, this is for simple engines
 * 
 * @param {Function} engine - The engine function to wrap
 * @param {Object} options - Partial options
 * @returns {Function} Wrapped engine with partial support
 */
function withPartials(engine, options = {}) {
  const {
    partialsDir = 'views/partials',
    partialPrefix = 'partial_'
  } = options;
  
  const path = require('node:path');
  const fs = require('node:fs');
  
  return async (filePath, data, callback) => {
    try {
      // Pre-load partials into data
      const partials = {};
      
      if (fs.existsSync(partialsDir)) {
        const files = fs.readdirSync(partialsDir);
        
        for (const file of files) {
          const name = path.basename(file, path.extname(file));
          const partialPath = path.join(partialsDir, file);
          
          // Render each partial
          const partial = await new Promise((resolve, reject) => {
            engine(partialPath, data, (err, html) => {
              if (err) reject(err);
              else resolve(html);
            });
          });
          
          partials[partialPrefix + name] = partial;
        }
      }
      
      // Merge partials into data
      const enhancedData = {
        ...data,
        ...partials
      };
      
      engine(filePath, enhancedData, callback);
    } catch (err) {
      callback(err);
    }
  };
}

module.exports = {
  createEjsAdapter,
  createPugAdapter,
  createHandlebarsAdapter,
  createMustacheAdapter,
  createNunjucksAdapter,
  createEtaAdapter,
  createLiquidAdapter,
  withCaching,
  withLayouts,
  withPartials
};