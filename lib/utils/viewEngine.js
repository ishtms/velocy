const fs = require("node:fs");
const path = require("node:path");
const { promisify } = require("node:util");

const readFile = promisify(fs.readFile);
const stat = promisify(fs.stat);

/**
 * ViewEngine - Manages template engines and view rendering for Velocy
 * Provides a flexible system for registering and using multiple template engines
 */
class ViewEngine {
  constructor() {
    this.engines = Object.create(null); // Registered template engines by extension
    this.cache = Object.create(null); // View cache for production
    this.cacheEnabled = false; // Default to development mode
    this.defaultEngine = null; // Default template engine extension
    this.viewPaths = []; // Array of directories to search for views
    this.locals = Object.create(null); // Application-wide locals
  }

  /**
   * Registers a template engine for a specific file extension
   * @param {string} ext - File extension (e.g., 'ejs', 'pug', 'hbs')
   * @param {Function} engine - Engine function (path, options, callback) or object with compile/render
   * @returns {ViewEngine} For chaining
   */
  registerEngine(ext, engine) {
    // Normalize extension (remove leading dot if present)
    const normalizedExt = ext.startsWith('.') ? ext.slice(1) : ext;
    
    // Validate engine
    if (typeof engine !== 'function' && (!engine || typeof engine.compile !== 'function')) {
      throw new Error(`Template engine for .${normalizedExt} must be a function or have a compile method`);
    }
    
    this.engines[normalizedExt] = engine;
    
    // Set as default if it's the first engine registered
    if (!this.defaultEngine) {
      this.defaultEngine = normalizedExt;
    }
    
    return this;
  }

  /**
   * Sets the default template engine
   * @param {string} ext - File extension to use as default
   * @returns {ViewEngine} For chaining
   */
  setDefaultEngine(ext) {
    const normalizedExt = ext.startsWith('.') ? ext.slice(1) : ext;
    
    if (!this.engines[normalizedExt]) {
      throw new Error(`Cannot set default engine: .${normalizedExt} engine not registered`);
    }
    
    this.defaultEngine = normalizedExt;
    return this;
  }

  /**
   * Sets view directories to search for templates
   * @param {string|Array<string>} paths - Directory path(s) to search for views
   * @returns {ViewEngine} For chaining
   */
  setViewPaths(paths) {
    if (typeof paths === 'string') {
      this.viewPaths = [path.resolve(paths)];
    } else if (Array.isArray(paths)) {
      this.viewPaths = paths.map(p => path.resolve(p));
    } else {
      throw new Error('View paths must be a string or array of strings');
    }
    return this;
  }

  /**
   * Adds a directory to the view paths
   * @param {string} viewPath - Directory path to add
   * @returns {ViewEngine} For chaining
   */
  addViewPath(viewPath) {
    this.viewPaths.push(path.resolve(viewPath));
    return this;
  }

  /**
   * Sets whether view caching is enabled
   * @param {boolean} enabled - Whether to enable caching
   * @returns {ViewEngine} For chaining
   */
  setCaching(enabled) {
    this.cacheEnabled = !!enabled;
    if (!enabled) {
      // Clear cache when disabling
      this.cache = Object.create(null);
    }
    return this;
  }

  /**
   * Clears the view cache
   * @returns {ViewEngine} For chaining
   */
  clearCache() {
    this.cache = Object.create(null);
    return this;
  }

  /**
   * Resolves a view file path
   * @param {string} view - View name (with or without extension)
   * @returns {Promise<{path: string, ext: string}>} Resolved file path and extension
   * @private
   */
  async #resolveView(view) {
    // If view is already an absolute path, check if it exists
    if (path.isAbsolute(view)) {
      try {
        const stats = await stat(view);
        if (stats.isFile()) {
          const ext = path.extname(view).slice(1);
          return { path: view, ext };
        }
      } catch (err) {
        // File doesn't exist at absolute path
      }
    }
    
    // Check if view has an extension
    let viewExt = path.extname(view).slice(1);
    const viewWithoutExt = viewExt ? view.slice(0, -(viewExt.length + 1)) : view;
    
    // If no extension provided, use default engine
    if (!viewExt && this.defaultEngine) {
      viewExt = this.defaultEngine;
    }
    
    // Try each view path
    for (const viewPath of this.viewPaths) {
      // Build potential file paths
      const candidates = [];
      
      if (viewExt) {
        // Try with provided/default extension
        candidates.push(path.join(viewPath, `${viewWithoutExt}.${viewExt}`));
      } else {
        // Try all registered extensions
        for (const ext of Object.keys(this.engines)) {
          candidates.push(path.join(viewPath, `${view}.${ext}`));
        }
      }
      
      // Check each candidate
      for (const candidate of candidates) {
        try {
          const stats = await stat(candidate);
          if (stats.isFile()) {
            const ext = path.extname(candidate).slice(1);
            return { path: candidate, ext };
          }
        } catch (err) {
          // File doesn't exist, try next
        }
      }
    }
    
    // No view found
    const searchPaths = this.viewPaths.length > 0 
      ? this.viewPaths.join(', ')
      : 'no view directories configured';
    throw new Error(`Failed to find view "${view}" in: ${searchPaths}`);
  }

  /**
   * Renders a view with the given data
   * @param {string} view - View name or path
   * @param {Object} data - Data to pass to the template
   * @param {Object} options - Rendering options
   * @returns {Promise<string>} Rendered HTML
   */
  async render(view, data = {}, options = {}) {
    // Resolve view file path
    const { path: viewPath, ext } = await this.#resolveView(view);
    
    // Get the engine for this extension
    const engine = this.engines[ext];
    if (!engine) {
      throw new Error(`No template engine registered for .${ext} files`);
    }
    
    // Check cache
    const cacheKey = viewPath;
    if (this.cacheEnabled && this.cache[cacheKey]) {
      return this.#executeEngine(this.cache[cacheKey], data, options, viewPath);
    }
    
    // Read the template file
    const template = await readFile(viewPath, 'utf8');
    
    // Compile the template if needed
    let compiled;
    if (typeof engine === 'function') {
      // Engine is a simple render function
      compiled = { engine, template };
    } else if (typeof engine.compile === 'function') {
      // Engine has a compile method
      compiled = { 
        engine: engine.compile(template, { 
          filename: viewPath,
          ...options 
        }),
        isCompiled: true
      };
    } else {
      throw new Error(`Template engine for .${ext} must be a function or have a compile method`);
    }
    
    // Cache if enabled
    if (this.cacheEnabled) {
      this.cache[cacheKey] = compiled;
    }
    
    // Execute the engine
    return this.#executeEngine(compiled, data, options, viewPath);
  }

  /**
   * Executes a template engine
   * @private
   */
  async #executeEngine(compiled, data, options, viewPath) {
    // Merge locals: app.locals -> res.locals -> data
    const mergedData = {
      ...this.locals,
      ...options.locals,
      ...data,
      // Add helper properties
      __filename: viewPath,
      __dirname: path.dirname(viewPath)
    };
    
    if (compiled.isCompiled) {
      // Already compiled, just execute
      return compiled.engine(mergedData);
    }
    
    // Execute engine function
    const { engine, template } = compiled;
    
    // Support both callback and promise-based engines
    return new Promise((resolve, reject) => {
      // Try to detect if engine returns a promise
      const result = engine(viewPath || template, mergedData, (err, html) => {
        if (err) reject(err);
        else resolve(html);
      });
      
      // If engine returns a promise, use it
      if (result && typeof result.then === 'function') {
        result.then(resolve).catch(reject);
      }
      // Otherwise, the callback will handle it
    });
  }

  /**
   * Built-in simple template engine for basic variable substitution
   * Supports {{variable}} syntax with basic HTML escaping
   */
  static simpleEngine() {
    return (template, data, callback) => {
      try {
        // Function to escape HTML
        const escapeHtml = (str) => {
          if (str == null) return '';
          return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
        };
        
        // Function to get nested property
        const getNestedProperty = (obj, path) => {
          return path.split('.').reduce((current, prop) => {
            return current ? current[prop] : undefined;
          }, obj);
        };
        
        // Replace variables with data
        let rendered = template;
        
        // Support both escaped {{variable}} and raw {{{variable}}}
        rendered = rendered.replace(/\{\{\{(.+?)\}\}\}|\{\{(.+?)\}\}/g, (match, raw, escaped) => {
          const key = (raw || escaped).trim();
          const value = getNestedProperty(data, key);
          
          // Don't escape if using triple braces
          if (raw) {
            return value == null ? '' : String(value);
          }
          
          // Escape HTML for double braces
          return escapeHtml(value);
        });
        
        // Support simple conditionals: {{#if condition}}...{{/if}}
        rendered = rendered.replace(/\{\{#if\s+(.+?)\}\}([\s\S]*?)\{\{\/if\}\}/g, (match, condition, content) => {
          const value = getNestedProperty(data, condition.trim());
          return value ? content : '';
        });
        
        // Support simple loops: {{#each array}}...{{/each}}
        rendered = rendered.replace(/\{\{#each\s+(.+?)\}\}([\s\S]*?)\{\{\/each\}\}/g, (match, arrayPath, content) => {
          const array = getNestedProperty(data, arrayPath.trim());
          if (!Array.isArray(array)) return '';
          
          return array.map((item, index) => {
            // Create a new context with item data
            const itemData = {
              ...data,
              this: item,
              '@index': index,
              '@first': index === 0,
              '@last': index === array.length - 1
            };
            
            // Recursively process the content
            return content.replace(/\{\{\{(.+?)\}\}\}|\{\{(.+?)\}\}/g, (m, r, e) => {
              const k = (r || e).trim();
              const v = k === 'this' ? item : getNestedProperty(itemData, k);
              return r ? (v == null ? '' : String(v)) : escapeHtml(v);
            });
          }).join('');
        });
        
        callback(null, rendered);
      } catch (err) {
        callback(err);
      }
    };
  }

  /**
   * Layout support wrapper for engines
   * Wraps an engine to add layout support
   */
  static withLayout(engine, options = {}) {
    const { layoutKey = 'layout', bodyKey = 'body' } = options;
    
    return async (viewPath, data, callback) => {
      try {
        // First render the view
        const body = await new Promise((resolve, reject) => {
          engine(viewPath, data, (err, html) => {
            if (err) reject(err);
            else resolve(html);
          });
        });
        
        // Check if layout is specified
        const layoutPath = data[layoutKey];
        if (!layoutPath) {
          callback(null, body);
          return;
        }
        
        // Render the layout with the body content
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
}

module.exports = ViewEngine;