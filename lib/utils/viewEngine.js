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
    this.engines = Object.create(null);
    this.cache = Object.create(null);
    this.cacheEnabled = false;
    this.defaultEngine = null;
    this.viewPaths = [];
    this.locals = Object.create(null);
  }

  /**
   * Registers a template engine for a specific file extension
   * @param {string} ext - File extension (e.g., 'ejs', 'pug', 'hbs')
   * @param {Function} engine - Engine function (path, options, callback) or object with compile/render
   * @returns {ViewEngine} For chaining
   */
  registerEngine(ext, engine) {
    const normalizedExt = ext.startsWith('.') ? ext.slice(1) : ext;
    
    if (typeof engine !== 'function' && (!engine || typeof engine.compile !== 'function')) {
      throw new Error(`Template engine for .${normalizedExt} must be a function or have a compile method`);
    }
    
    this.engines[normalizedExt] = engine;
    
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
    if (path.isAbsolute(view)) {
      try {
        const stats = await stat(view);
        if (stats.isFile()) {
          const ext = path.extname(view).slice(1);
          return { path: view, ext };
        }
      } catch (err) {
      }
    }
    
    let viewExt = path.extname(view).slice(1);
    const viewWithoutExt = viewExt ? view.slice(0, -(viewExt.length + 1)) : view;
    
    if (!viewExt && this.defaultEngine) {
      viewExt = this.defaultEngine;
    }
    
    for (const viewPath of this.viewPaths) {
      const candidates = [];
      
      if (viewExt) {
        candidates.push(path.join(viewPath, `${viewWithoutExt}.${viewExt}`));
      } else {
        for (const ext of Object.keys(this.engines)) {
          candidates.push(path.join(viewPath, `${view}.${ext}`));
        }
      }
      
      for (const candidate of candidates) {
        try {
          const stats = await stat(candidate);
          if (stats.isFile()) {
            const ext = path.extname(candidate).slice(1);
            return { path: candidate, ext };
          }
        } catch (err) {
        }
      }
    }
    
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
    const { path: viewPath, ext } = await this.#resolveView(view);
    
    const engine = this.engines[ext];
    if (!engine) {
      throw new Error(`No template engine registered for .${ext} files`);
    }
    
    const cacheKey = viewPath;
    if (this.cacheEnabled && this.cache[cacheKey]) {
      return this.#executeEngine(this.cache[cacheKey], data, options, viewPath);
    }
    
    const template = await readFile(viewPath, 'utf8');
    
    let compiled;
    if (typeof engine === 'function') {
      compiled = { engine, template };
    } else if (typeof engine.compile === 'function') {
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
    
    if (this.cacheEnabled) {
      this.cache[cacheKey] = compiled;
    }
    
    return this.#executeEngine(compiled, data, options, viewPath);
  }

  /**
   * Executes a template engine
   * @private
   */
  async #executeEngine(compiled, data, options, viewPath) {
    const mergedData = {
      ...this.locals,
      ...options.locals,
      ...data,
      __filename: viewPath,
      __dirname: path.dirname(viewPath)
    };
    
    if (compiled.isCompiled) {
      return compiled.engine(mergedData);
    }
    
    const { engine, template } = compiled;
    
    return new Promise((resolve, reject) => {
      const result = engine(template || viewPath, mergedData, (err, html) => {
        if (err) reject(err);
        else resolve(html);
      });
      
      if (result && typeof result.then === 'function') {
        result.then(resolve).catch(reject);
      }
    });
  }

  /**
   * Built-in simple template engine for basic variable substitution
   * Supports {{variable}} syntax with basic HTML escaping
   */
  static simpleEngine() {
    return (template, data, callback) => {
      try {
        const escapeHtml = (str) => {
          if (str == null) return '';
          return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
        };
        
        const getNestedProperty = (obj, path) => {
          return path.split('.').reduce((current, prop) => {
            return current ? current[prop] : undefined;
          }, obj);
        };
        
        let rendered = template;
        
        rendered = rendered.replace(/\{\{#each\s+(.+?)\}\}([\s\S]*?)\{\{\/each\}\}/g, (match, arrayPath, content) => {
          const array = getNestedProperty(data, arrayPath.trim());
          if (!Array.isArray(array)) return '';
          
          return array.map((item, index) => {
            const itemData = {
              ...data,
              this: item,
              '@index': index,
              '@first': index === 0,
              '@last': index === array.length - 1
            };
            
            return content.replace(/\{\{\{(.+?)\}\}\}|\{\{(.+?)\}\}/g, (m, r, e) => {
              const k = (r || e).trim();
              let v;
              if (k === 'this') {
                v = item;
              } else if (k.startsWith('this.')) {
                v = getNestedProperty(item, k.substring(5));
              } else {
                v = getNestedProperty(itemData, k);
              }
              return r ? (v == null ? '' : String(v)) : escapeHtml(v);
            });
          }).join('');
        });
        
        rendered = rendered.replace(/\{\{#if\s+(.+?)\}\}([\s\S]*?)\{\{\/if\}\}/g, (match, condition, content) => {
          const value = getNestedProperty(data, condition.trim());
          return value ? content : '';
        });
        
        rendered = rendered.replace(/\{\{\{(.+?)\}\}\}|\{\{(.+?)\}\}/g, (match, raw, escaped) => {
          const key = (raw || escaped).trim();
          const value = getNestedProperty(data, key);
          
          if (raw) {
            return value == null ? '' : String(value);
          }
          
          return escapeHtml(value);
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
        const body = await new Promise((resolve, reject) => {
          engine(viewPath, data, (err, html) => {
            if (err) reject(err);
            else resolve(html);
          });
        });
        
        const layoutPath = data[layoutKey];
        if (!layoutPath) {
          callback(null, body);
          return;
        }
        
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