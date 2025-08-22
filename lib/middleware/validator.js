/**
 * Request Validator Middleware for Velocy Framework
 * 
 * A comprehensive validation middleware that provides schema-based validation
 * for request body, params, query, and headers without external dependencies.
 * 
 * @module validator
 */

const { promisify } = require('node:util');
const crypto = require('node:crypto');

/**
 * Custom validation error class
 */
class ValidationError extends Error {
  constructor(errors, statusCode = 400) {
    const message = 'Validation failed';
    super(message);
    this.name = 'ValidationError';
    this.statusCode = statusCode;
    this.errors = errors;
    this.isValidationError = true;
  }

  toJSON() {
    return {
      error: this.message,
      statusCode: this.statusCode,
      details: this.errors
    };
  }
}

/**
 * Type validators - core validation functions
 */
const TypeValidators = {
  /**
   * Validates string type with options
   */
  string(value, options = {}) {
    if (options.coerce && value != null && typeof value !== 'string') {
      value = String(value);
    }

    if (typeof value !== 'string') {
      return { valid: false, error: 'Value must be a string' };
    }

    if (options.minLength != null && value.length < options.minLength) {
      return { valid: false, error: `String must be at least ${options.minLength} characters` };
    }

    if (options.maxLength != null && value.length > options.maxLength) {
      return { valid: false, error: `String must be at most ${options.maxLength} characters` };
    }

    if (options.min != null && value.length < options.min) {
      return { valid: false, error: `String must be at least ${options.min} characters` };
    }

    if (options.max != null && value.length > options.max) {
      return { valid: false, error: `String must be at most ${options.max} characters` };
    }

    if (options.pattern && !options.pattern.test(value)) {
      return { valid: false, error: `String does not match required pattern` };
    }

    if (options.enum && !options.enum.includes(value)) {
      return { valid: false, error: `Value must be one of: ${options.enum.join(', ')}` };
    }

    return { valid: true, value };
  },

  /**
   * Validates number type with options
   */
  number(value, options = {}) {
    if (options.coerce && value != null) {
      const coerced = Number(value);
      if (!isNaN(coerced)) {
        value = coerced;
      }
    }

    if (typeof value !== 'number' || isNaN(value)) {
      return { valid: false, error: 'Value must be a number' };
    }

    if (options.min != null && value < options.min) {
      return { valid: false, error: `Number must be at least ${options.min}` };
    }

    if (options.max != null && value > options.max) {
      return { valid: false, error: `Number must be at most ${options.max}` };
    }

    if (options.integer && !Number.isInteger(value)) {
      return { valid: false, error: 'Value must be an integer' };
    }

    if (options.positive && value <= 0) {
      return { valid: false, error: 'Number must be positive' };
    }

    if (options.negative && value >= 0) {
      return { valid: false, error: 'Number must be negative' };
    }

    return { valid: true, value };
  },

  /**
   * Validates boolean type with options
   */
  boolean(value, options = {}) {
    if (options.coerce && value != null) {
      if (value === 'true' || value === '1' || value === 1) {
        value = true;
      } else if (value === 'false' || value === '0' || value === 0 || value === '') {
        value = false;
      }
    }

    if (typeof value !== 'boolean') {
      return { valid: false, error: 'Value must be a boolean' };
    }

    return { valid: true, value };
  },

  /**
   * Validates array type with options
   */
  array(value, options = {}) {
    if (!Array.isArray(value)) {
      // Try to coerce if it's a single value
      if (options.coerce && value != null) {
        value = [value];
      } else {
        return { valid: false, error: 'Value must be an array' };
      }
    }

    // Check both min/max and minLength/maxLength for compatibility
    const minLength = options.minLength ?? options.min;
    const maxLength = options.maxLength ?? options.max;
    
    if (minLength != null && value.length < minLength) {
      return { valid: false, error: `Array must have at least ${minLength} items` };
    }

    if (maxLength != null && value.length > maxLength) {
      return { valid: false, error: `Array must have at most ${maxLength} items` };
    }

    if (options.unique && new Set(value).size !== value.length) {
      return { valid: false, error: 'Array must contain unique values' };
    }

    // Validate array items if schema provided
    if (options.items) {
      const errors = [];
      const validatedItems = [];
      
      for (let i = 0; i < value.length; i++) {
        const result = validateValue(value[i], options.items, `[${i}]`);
        if (!result.valid) {
          errors.push(...result.errors.map(e => ({
            ...e,
            path: `[${i}]${e.path ? '.' + e.path : ''}`
          })));
        } else {
          validatedItems.push(result.value);
        }
      }

      if (errors.length > 0) {
        return { valid: false, errors };
      }

      value = validatedItems;
    }

    return { valid: true, value };
  },

  /**
   * Validates object type with options
   */
  object(value, options = {}) {
    if (value == null || typeof value !== 'object' || Array.isArray(value)) {
      return { valid: false, error: 'Value must be an object' };
    }

    const result = { ...value };
    const errors = [];

    // Validate nested properties if schema provided
    if (options.properties) {
      for (const [key, schema] of Object.entries(options.properties)) {
        const propResult = validateValue(value[key], schema, key);
        if (!propResult.valid) {
          errors.push(...propResult.errors.map(e => ({
            ...e,
            path: key + (e.path ? '.' + e.path : '')
          })));
        } else if (propResult.value !== undefined) {
          result[key] = propResult.value;
        }
      }
    }

    // Check for unknown properties
    if (options.strict || options.additionalProperties === false) {
      const allowedKeys = new Set(Object.keys(options.properties || {}));
      for (const key of Object.keys(value)) {
        if (!allowedKeys.has(key)) {
          errors.push({
            path: key,
            message: `Unknown property: ${key}`
          });
        }
      }
    }

    if (errors.length > 0) {
      return { valid: false, errors };
    }

    return { valid: true, value: result };
  },

  /**
   * Validates date type with options
   */
  date(value, options = {}) {
    let date = value;

    if (options.coerce && value != null) {
      if (typeof value === 'string' || typeof value === 'number') {
        date = new Date(value);
      }
    }

    if (!(date instanceof Date) || isNaN(date.getTime())) {
      if (typeof value === 'string') {
        date = new Date(value);
        if (isNaN(date.getTime())) {
          return { valid: false, error: 'Value must be a valid date' };
        }
      } else {
        return { valid: false, error: 'Value must be a valid date' };
      }
    }

    if (options.min && date < new Date(options.min)) {
      return { valid: false, error: `Date must be after ${options.min}` };
    }

    if (options.max && date > new Date(options.max)) {
      return { valid: false, error: `Date must be before ${options.max}` };
    }

    return { valid: true, value: date };
  },

  /**
   * Validates email format
   */
  email(value, options = {}) {
    const stringResult = TypeValidators.string(value, { coerce: options.coerce });
    if (!stringResult.valid) return stringResult;

    value = stringResult.value;

    // Basic email regex - not perfect but good enough for most cases
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    
    if (!emailRegex.test(value)) {
      return { valid: false, error: 'Value must be a valid email address' };
    }

    // Additional checks
    if (value.length > 320) {
      return { valid: false, error: 'Email address is too long' };
    }

    const [localPart, domain] = value.split('@');
    if (localPart.length > 64) {
      return { valid: false, error: 'Email local part is too long' };
    }

    return { valid: true, value: value.toLowerCase() };
  },

  /**
   * Validates URL format
   */
  url(value, options = {}) {
    const stringResult = TypeValidators.string(value, { coerce: options.coerce });
    if (!stringResult.valid) return stringResult;

    value = stringResult.value;

    try {
      const url = new URL(value);
      
      // Default to only allowing http and https protocols
      const allowedProtocols = options.protocols || ['http', 'https'];
      const protocol = url.protocol.slice(0, -1); // Remove trailing ':'
      
      if (!allowedProtocols.includes(protocol)) {
        return { valid: false, error: `URL protocol must be one of: ${allowedProtocols.join(', ')}` };
      }

      return { valid: true, value };
    } catch (e) {
      return { valid: false, error: 'Value must be a valid URL' };
    }
  },

  /**
   * Validates UUID format
   */
  uuid(value, options = {}) {
    const stringResult = TypeValidators.string(value, { coerce: options.coerce });
    if (!stringResult.valid) return stringResult;

    value = stringResult.value;

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    
    if (!uuidRegex.test(value)) {
      return { valid: false, error: 'Value must be a valid UUID' };
    }

    return { valid: true, value: value.toLowerCase() };
  },

  /**
   * Validates MongoDB ObjectID format
   */
  objectId(value, options = {}) {
    const stringResult = TypeValidators.string(value, { coerce: options.coerce });
    if (!stringResult.valid) return stringResult;

    value = stringResult.value;

    const objectIdRegex = /^[0-9a-f]{24}$/i;
    
    if (!objectIdRegex.test(value)) {
      return { valid: false, error: 'Value must be a valid ObjectId' };
    }

    return { valid: true, value };
  },

  /**
   * Validates phone number format
   */
  phone(value, options = {}) {
    const stringResult = TypeValidators.string(value, { coerce: options.coerce });
    if (!stringResult.valid) return stringResult;

    value = stringResult.value;

    // Remove all non-digit characters for validation
    const digits = value.replace(/\D/g, '');
    
    if (digits.length < 10 || digits.length > 15) {
      return { valid: false, error: 'Value must be a valid phone number' };
    }

    // Normalize to E.164 format if possible
    let normalized = value;
    if (options.normalize) {
      normalized = '+' + digits;
    }

    return { valid: true, value: normalized };
  },

  /**
   * Validates IP address format
   */
  ip(value, options = {}) {
    const stringResult = TypeValidators.string(value, { coerce: options.coerce });
    if (!stringResult.valid) return stringResult;

    value = stringResult.value;

    const ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
    const ipv6Regex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;

    const version = options.version || 'any';
    
    if (version === 'v4' || version === 4) {
      if (!ipv4Regex.test(value)) {
        return { valid: false, error: 'Value must be a valid IPv4 address' };
      }
    } else if (version === 'v6' || version === 6) {
      if (!ipv6Regex.test(value)) {
        return { valid: false, error: 'Value must be a valid IPv6 address' };
      }
    } else {
      if (!ipv4Regex.test(value) && !ipv6Regex.test(value)) {
        return { valid: false, error: 'Value must be a valid IP address' };
      }
    }

    return { valid: true, value };
  }
};

/**
 * Sanitization helpers
 */
const Sanitizers = {
  /**
   * Trims whitespace from strings
   */
  trim(value) {
    if (typeof value === 'string') {
      return value.trim();
    }
    return value;
  },

  /**
   * Converts string to lowercase
   */
  toLowerCase(value) {
    if (typeof value === 'string') {
      return value.toLowerCase();
    }
    return value;
  },

  /**
   * Converts string to uppercase
   */
  toUpperCase(value) {
    if (typeof value === 'string') {
      return value.toUpperCase();
    }
    return value;
  },

  /**
   * Escapes HTML entities
   */
  escapeHtml(value) {
    if (typeof value !== 'string') return value;
    
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
      '/': '&#x2F;'
    };
    
    return value.replace(/[&<>"'\/]/g, char => map[char]);
  },

  /**
   * Removes HTML tags
   */
  stripHtml(value) {
    if (typeof value !== 'string') return value;
    return value.replace(/<[^>]*>/g, '');
  },

  /**
   * Normalizes whitespace (multiple spaces to single)
   */
  normalizeWhitespace(value) {
    if (typeof value !== 'string') return value;
    return value.replace(/\s+/g, ' ').trim();
  },

  /**
   * Removes non-alphanumeric characters
   */
  alphanumeric(value) {
    if (typeof value !== 'string') return value;
    return value.replace(/[^a-zA-Z0-9]/g, '');
  },

  /**
   * Normalizes email
   */
  normalizeEmail(value) {
    if (typeof value !== 'string') return value;
    return value.toLowerCase().trim();
  },

  /**
   * Converts to integer
   */
  toInt(value) {
    const num = parseInt(value, 10);
    return isNaN(num) ? value : num;
  },

  /**
   * Converts to float
   */
  toFloat(value) {
    const num = parseFloat(value);
    return isNaN(num) ? value : num;
  },

  /**
   * Converts to boolean
   */
  toBoolean(value) {
    if (typeof value === 'boolean') return value;
    if (value === 'true' || value === '1' || value === 1) return true;
    if (value === 'false' || value === '0' || value === 0 || value === '') return false;
    return value;
  },

  /**
   * Converts to date
   */
  toDate(value) {
    if (value instanceof Date) return value;
    const date = new Date(value);
    return isNaN(date.getTime()) ? value : date;
  }
};

/**
 * Schema compilation cache for performance
 */
const schemaCache = new Map();

/**
 * Generates a cache key for a schema
 */
function getSchemaKey(schema) {
  const hash = crypto.createHash('sha256');
  hash.update(JSON.stringify(schema));
  return hash.digest('hex');
}

/**
 * Validates a value against a schema
 */
function validateValue(value, schema, path = '') {
  // Handle undefined/null values
  if (value === undefined || value === null) {
    if (schema.required) {
      return {
        valid: false,
        errors: [{
          path: path || 'value',
          message: schema.message || 'Value is required'
        }]
      };
    }
    
    // Apply default value if provided
    if ('default' in schema) {
      const defaultValue = typeof schema.default === 'function' 
        ? schema.default() 
        : schema.default;
      return { valid: true, value: defaultValue };
    }
    
    return { valid: true, value };
  }

  // Apply sanitizers first
  if (schema.sanitize) {
    const sanitizers = Array.isArray(schema.sanitize) ? schema.sanitize : [schema.sanitize];
    for (const sanitizer of sanitizers) {
      if (typeof sanitizer === 'string' && Sanitizers[sanitizer]) {
        value = Sanitizers[sanitizer](value);
      } else if (typeof sanitizer === 'function') {
        value = sanitizer(value);
      }
    }
  }

  // Determine validator type
  let type = schema.type;
  if (!type && schema.validator) {
    // Custom validator only
    type = 'custom';
  }

  // Run type validation
  if (type && type !== 'custom') {
    const validator = TypeValidators[type];
    if (!validator) {
      return {
        valid: false,
        errors: [{
          path: path || 'value',
          message: `Unknown type: ${type}`
        }]
      };
    }

    const result = validator(value, schema);
    if (!result.valid) {
      if (result.errors) {
        // Nested errors from object/array validation
        return {
          valid: false,
          errors: result.errors
        };
      }
      return {
        valid: false,
        errors: [{
          path: path || 'value',
          message: schema.message || result.error
        }]
      };
    }
    value = result.value;
  }

  // Run custom validator
  if (schema.validator) {
    try {
      const isValid = schema.validator(value, schema);
      if (isValid === false) {
        return {
          valid: false,
          errors: [{
            path: path || 'value',
            message: schema.message || 'Validation failed'
          }]
        };
      }
      // Allow validator to return modified value
      if (isValid !== true && isValid !== undefined) {
        value = isValid;
      }
    } catch (error) {
      return {
        valid: false,
        errors: [{
          path: path || 'value',
          message: schema.message || error.message || 'Validation failed'
        }]
      };
    }
  }

  return { valid: true, value };
}

/**
 * Validates a value against a schema (async version)
 */
async function validateValueAsync(value, schema, path = '') {
  // Handle undefined/null values
  if (value === undefined || value === null) {
    if (schema.required) {
      return {
        valid: false,
        errors: [{
          path: path || 'value',
          message: schema.message || 'Value is required'
        }]
      };
    }
    
    // Apply default value if provided
    if ('default' in schema) {
      const defaultValue = typeof schema.default === 'function' 
        ? await schema.default() 
        : schema.default;
      return { valid: true, value: defaultValue };
    }
    
    return { valid: true, value };
  }

  // Apply sanitizers first
  if (schema.sanitize) {
    const sanitizers = Array.isArray(schema.sanitize) ? schema.sanitize : [schema.sanitize];
    for (const sanitizer of sanitizers) {
      if (typeof sanitizer === 'string' && Sanitizers[sanitizer]) {
        value = Sanitizers[sanitizer](value);
      } else if (typeof sanitizer === 'function') {
        value = await sanitizer(value);
      }
    }
  }

  // Determine validator type
  let type = schema.type;
  if (!type && schema.validator) {
    // Custom validator only
    type = 'custom';
  }

  // Run type validation
  if (type && type !== 'custom') {
    const validator = TypeValidators[type];
    if (!validator) {
      return {
        valid: false,
        errors: [{
          path: path || 'value',
          message: `Unknown type: ${type}`
        }]
      };
    }

    const result = validator(value, schema);
    if (!result.valid) {
      if (result.errors) {
        // Nested errors from object/array validation
        return {
          valid: false,
          errors: result.errors
        };
      }
      return {
        valid: false,
        errors: [{
          path: path || 'value',
          message: schema.message || result.error
        }]
      };
    }
    value = result.value;
  }

  // Run custom validator (async)
  if (schema.validator) {
    try {
      const isValid = await schema.validator(value, schema);
      if (isValid === false) {
        return {
          valid: false,
          errors: [{
            path: path || 'value',
            message: schema.message || 'Validation failed'
          }]
        };
      }
      // Allow validator to return modified value
      if (isValid !== true && isValid !== undefined) {
        value = isValid;
      }
    } catch (error) {
      return {
        valid: false,
        errors: [{
          path: path || 'value',
          message: schema.message || error.message || 'Validation failed'
        }]
      };
    }
  }

  // Run async validator if provided
  if (schema.asyncValidator) {
    try {
      const isValid = await schema.asyncValidator(value, schema);
      if (isValid === false) {
        return {
          valid: false,
          errors: [{
            path: path || 'value',
            message: schema.message || 'Async validation failed'
          }]
        };
      }
      // Allow validator to return modified value
      if (isValid !== true && isValid !== undefined) {
        value = isValid;
      }
    } catch (error) {
      return {
        valid: false,
        errors: [{
          path: path || 'value',
          message: schema.message || error.message || 'Async validation failed'
        }]
      };
    }
  }

  return { valid: true, value };
}

/**
 * Creates a validation middleware from a schema
 * 
 * @param {Object} schema - Validation schema for body, params, query, headers
 * @param {Object} options - Validation options
 * @returns {Function} Middleware function
 */
function validate(schema, options = {}) {
  // Cache compiled schemas for performance
  const cacheKey = options.cache !== false ? getSchemaKey(schema) : null;
  
  if (cacheKey && schemaCache.has(cacheKey)) {
    return schemaCache.get(cacheKey);
  }

  // Determine if schema has any async validators
  const hasAsyncValidators = checkForAsyncValidators(schema);

  // Create the middleware function
  const middleware = async function validationMiddleware(req, res, next) {
    const errors = [];
    const validated = {};

    try {
      // Validate body
      if (schema.body) {
        const bodyValue = req.parsedBody !== undefined ? req.parsedBody : await req.body;
        const result = hasAsyncValidators 
          ? await validateValueAsync(bodyValue, { type: 'object', properties: schema.body }, 'body')
          : validateValue(bodyValue, { type: 'object', properties: schema.body }, 'body');
        
        if (!result.valid) {
          errors.push(...result.errors);
        } else {
          validated.body = result.value;
          // Update request body with validated/sanitized value
          req.parsedBody = result.value;
        }
      }

      // Validate params
      if (schema.params) {
        const result = hasAsyncValidators
          ? await validateValueAsync(req.params, { type: 'object', properties: schema.params }, 'params')
          : validateValue(req.params, { type: 'object', properties: schema.params }, 'params');
        
        if (!result.valid) {
          errors.push(...result.errors);
        } else {
          validated.params = result.value;
          // Update request params with validated/sanitized value
          req.extractedParams = result.value;
        }
      }

      // Validate query
      if (schema.query) {
        const result = hasAsyncValidators
          ? await validateValueAsync(req.query, { type: 'object', properties: schema.query }, 'query')
          : validateValue(req.query, { type: 'object', properties: schema.query }, 'query');
        
        if (!result.valid) {
          errors.push(...result.errors);
        } else {
          validated.query = result.value;
          // Store validated query for access
          req.validatedQuery = result.value;
        }
      }

      // Validate headers
      if (schema.headers) {
        const result = hasAsyncValidators
          ? await validateValueAsync(req.headers, { type: 'object', properties: schema.headers }, 'headers')
          : validateValue(req.headers, { type: 'object', properties: schema.headers }, 'headers');
        
        if (!result.valid) {
          errors.push(...result.errors);
        } else {
          validated.headers = result.value;
        }
      }

      // Check for validation errors
      if (errors.length > 0) {
        const validationError = new ValidationError(errors);
        
        if (options.errorHandler) {
          return options.errorHandler(validationError, req, res, next);
        }
        
        if (next) {
          return next(validationError);
        }
        
        // Default error response
        return res.status(validationError.statusCode).json(validationError.toJSON());
      }

      // Store validated data on request
      req.validated = validated;

      // Continue to next middleware
      if (next) {
        next();
      }
    } catch (error) {
      // Handle unexpected errors
      if (next) {
        next(error);
      } else {
        res.status(500).json({
          error: 'Internal validation error',
          message: error.message
        });
      }
    }
  };

  // Cache the middleware if caching is enabled
  if (cacheKey) {
    schemaCache.set(cacheKey, middleware);
  }

  return middleware;
}

/**
 * Checks if schema contains async validators
 */
function checkForAsyncValidators(schema) {
  const check = (obj) => {
    if (!obj || typeof obj !== 'object') return false;
    
    if (obj.asyncValidator) return true;
    
    for (const key of Object.keys(obj)) {
      const value = obj[key];
      if (value && typeof value === 'object') {
        if (check(value)) return true;
      }
    }
    
    return false;
  };
  
  return check(schema);
}

/**
 * Built-in validators for common use cases
 */
const Validators = {
  /**
   * Validates minimum length
   */
  minLength: (min) => (value) => {
    if (typeof value === 'string' && value.length >= min) return true;
    if (Array.isArray(value) && value.length >= min) return true;
    throw new Error(`Length must be at least ${min}`);
  },

  /**
   * Validates maximum length
   */
  maxLength: (max) => (value) => {
    if (typeof value === 'string' && value.length <= max) return true;
    if (Array.isArray(value) && value.length <= max) return true;
    throw new Error(`Length must be at most ${max}`);
  },

  /**
   * Validates regex pattern
   */
  pattern: (regex) => (value) => {
    if (typeof value === 'string' && regex.test(value)) return true;
    throw new Error('Value does not match required pattern');
  },

  /**
   * Validates value is in list
   */
  oneOf: (list) => (value) => {
    if (list.includes(value)) return true;
    throw new Error(`Value must be one of: ${list.join(', ')}`);
  },

  /**
   * Validates custom condition
   */
  custom: (fn, message) => (value) => {
    if (fn(value)) return true;
    throw new Error(message || 'Custom validation failed');
  },

  /**
   * Validates field equality
   */
  equals: (otherField) => (value, schema, req) => {
    const otherValue = req.body?.[otherField] || req.query?.[otherField];
    if (value === otherValue) return true;
    throw new Error(`Value must equal ${otherField}`);
  },

  /**
   * Validates field inequality
   */
  notEquals: (otherField) => (value, schema, req) => {
    const otherValue = req.body?.[otherField] || req.query?.[otherField];
    if (value !== otherValue) return true;
    throw new Error(`Value must not equal ${otherField}`);
  }
};

/**
 * Creates a schema builder for fluent API
 */
class SchemaBuilder {
  constructor() {
    this.schema = {};
  }

  string(options = {}) {
    this.schema.type = 'string';
    Object.assign(this.schema, options);
    return this;
  }

  number(options = {}) {
    this.schema.type = 'number';
    Object.assign(this.schema, options);
    return this;
  }

  boolean(options = {}) {
    this.schema.type = 'boolean';
    Object.assign(this.schema, options);
    return this;
  }

  array(options = {}) {
    this.schema.type = 'array';
    Object.assign(this.schema, options);
    return this;
  }

  object(options = {}) {
    this.schema.type = 'object';
    Object.assign(this.schema, options);
    return this;
  }

  date(options = {}) {
    this.schema.type = 'date';
    Object.assign(this.schema, options);
    return this;
  }

  email(options = {}) {
    this.schema.type = 'email';
    Object.assign(this.schema, options);
    return this;
  }

  url(options = {}) {
    this.schema.type = 'url';
    Object.assign(this.schema, options);
    return this;
  }

  required(message) {
    this.schema.required = true;
    if (message) this.schema.message = message;
    return this;
  }

  optional() {
    this.schema.required = false;
    return this;
  }

  default(value) {
    this.schema.default = value;
    return this;
  }

  min(value) {
    this.schema.min = value;
    return this;
  }

  max(value) {
    this.schema.max = value;
    return this;
  }

  pattern(regex) {
    this.schema.pattern = regex;
    return this;
  }

  enum(values) {
    this.schema.enum = values;
    return this;
  }

  sanitize(sanitizer) {
    if (!this.schema.sanitize) {
      this.schema.sanitize = [];
    }
    if (Array.isArray(this.schema.sanitize)) {
      this.schema.sanitize.push(sanitizer);
    } else {
      this.schema.sanitize = [this.schema.sanitize, sanitizer];
    }
    return this;
  }

  validator(fn) {
    this.schema.validator = fn;
    return this;
  }

  asyncValidator(fn) {
    this.schema.asyncValidator = fn;
    return this;
  }

  message(msg) {
    this.schema.message = msg;
    return this;
  }

  build() {
    return this.schema;
  }
}

/**
 * Helper function to create schema builder
 */
function schema() {
  return new SchemaBuilder();
}

/**
 * Chain-able field validator for specific sources
 */
class FieldValidator {
  constructor(source, field) {
    this.source = source; // 'body', 'query', 'params', 'headers'
    this.field = field;
    this.rules = {};
    this.isRequired = false;
    this.defaultValue = undefined;
  }

  required() {
    this.isRequired = true;
    return this;
  }

  optional() {
    this.isRequired = false;
    return this;
  }

  default(value) {
    this.defaultValue = value;
    return this;
  }

  isString() {
    this.rules.type = 'string';
    return this;
  }

  isNumber() {
    this.rules.type = 'number';
    return this;
  }

  isInteger() {
    this.rules.type = 'number';
    this.rules.integer = true;
    return this;
  }

  isFloat() {
    this.rules.type = 'number';
    this.rules.integer = false;
    return this;
  }

  positive() {
    this.rules.min = 0.00001; // Just above 0
    return this;
  }

  negative() {
    this.rules.max = -0.00001; // Just below 0
    return this;
  }

  isBoolean() {
    this.rules.type = 'boolean';
    return this;
  }

  isEmail() {
    this.rules.type = 'email';
    return this;
  }

  isURL() {
    this.rules.type = 'url';
    return this;
  }

  isUUID() {
    this.rules.type = 'uuid';
    return this;
  }

  isDate() {
    this.rules.type = 'date';
    return this;
  }

  isArray() {
    this.rules.type = 'array';
    return this;
  }

  isObject() {
    this.rules.type = 'object';
    return this;
  }

  each(itemSchema) {
    // If itemSchema is a function, we need to create a schema from it
    if (typeof itemSchema === 'function') {
      // Create a temporary FieldValidator to build the schema
      const tempValidator = new FieldValidator('temp', 'temp');
      // Call the function with the tempValidator to build the chain
      itemSchema(tempValidator);
      // Extract the built schema
      this.rules.items = tempValidator.buildSchema();
    } else {
      this.rules.items = itemSchema;
    }
    return this;
  }

  min(value) {
    this.rules.min = value;
    return this;
  }

  max(value) {
    this.rules.max = value;
    return this;
  }

  minLength(value) {
    this.rules.minLength = value;
    return this;
  }

  maxLength(value) {
    this.rules.maxLength = value;
    return this;
  }

  pattern(regex) {
    this.rules.pattern = regex;
    return this;
  }

  matches(regex) {
    // Pattern matching implies string type
    if (!this.rules.type) {
      this.rules.type = 'string';
    }
    this.rules.pattern = regex;
    return this;
  }

  enum(values) {
    this.rules.enum = values;
    return this;
  }

  custom(fn) {
    // Store the custom function to be wrapped later with req context
    this.customFn = fn;
    return this;
  }

  withMessage(message) {
    this.rules.message = message;
    return this;
  }

  // Build the validation schema
  buildSchema() {
    const schema = { ...this.rules };
    if (this.isRequired) {
      schema.required = true;
    }
    if (this.defaultValue !== undefined) {
      schema.default = this.defaultValue;
    }
    // Enable coercion for query and params since they come as strings
    if ((this.source === 'query' || this.source === 'params') && 
        (schema.type === 'number' || schema.type === 'boolean')) {
      schema.coerce = true;
    }
    return schema;
  }

  // Convert to middleware function
  toMiddleware() {
    const source = this.source;
    const field = this.field;
    const customFn = this.customFn;
    
    return async (req, res, next) => {
      // Build schema with req-aware custom validator if needed
      const schema = this.buildSchema();
      
      // If there's a custom function, wrap it to provide req context
      if (customFn) {
        schema.validator = (value) => {
          // Call the custom function with value and context object containing req
          return customFn(value, { req });
        };
      }
      try {
        let value;
        
        // Get value from appropriate source
        switch (source) {
          case 'body':
            // Check parsedBody first, then fall back to req.body
            if (req.parsedBody !== undefined && field in req.parsedBody) {
              value = req.parsedBody[field];
            } else if (req.body && typeof req.body === 'object' && !req.body.then) {
              value = req.body[field];
            } else if (req.body && typeof req.body.then === 'function') {
              const bodyData = await req.body;
              value = bodyData?.[field];
            }
            break;
          case 'query':
            value = req.query?.[field];
            break;
          case 'params':
            value = req.params?.[field];
            break;
          case 'headers':
            value = req.headers?.[field];
            break;
        }
        
        // Validate the value
        const result = validateValue(value, schema, `${source}.${field}`);
        
        if (!result.valid) {
          const error = new ValidationError(result.errors);
          if (next) {
            return next(error);
          } else {
            res.status(400).json(error.toJSON());
            return;
          }
        }
        
        // Update the value in request if validated/sanitized
        if (result.value !== undefined) {
          switch (source) {
            case 'body':
              // Initialize parsedBody with the full body data if not already set
              if (!req.parsedBody) {
                const bodyData = req.body && typeof req.body === 'object' && !req.body.then ? req.body : {};
                req.parsedBody = { ...bodyData };
              }
              req.parsedBody[field] = result.value;
              break;
            case 'query':
              if (!req.query) req.query = {};
              req.query[field] = result.value;
              break;
            case 'params':
              // Don't modify params - they're read-only route parameters
              // The validation is enough, no need to update them
              break;
          }
        }
        
        if (next) next();
      } catch (err) {
        if (next) {
          next(err);
        } else {
          res.status(500).json({ error: 'Validation error' });
        }
      }
    };
  }
}

// Create field validator factory functions
function createFieldValidator(source) {
  return function(field) {
    const validator = new FieldValidator(source, field);
    
    // Create a function that will be the middleware
    const middleware = function(req, res, next) {
      return validator.toMiddleware()(req, res, next);
    };
    
    // Add all validator methods to the middleware function for chaining
    const methods = Object.getOwnPropertyNames(FieldValidator.prototype);
    for (const method of methods) {
      if (method !== 'constructor' && method !== 'toMiddleware' && method !== 'buildSchema') {
        middleware[method] = function(...args) {
          validator[method](...args);
          return middleware; // Return middleware for chaining
        };
      }
    }
    
    return middleware;
  };
}

// Export main functions and utilities
module.exports = validate;
module.exports.validate = validate;
module.exports.ValidationError = ValidationError;
module.exports.TypeValidators = TypeValidators;
module.exports.Sanitizers = Sanitizers;
module.exports.Validators = Validators;
module.exports.schema = schema;
module.exports.SchemaBuilder = SchemaBuilder;

// Chain-able field validators
module.exports.body = createFieldValidator('body');
module.exports.query = createFieldValidator('query');
module.exports.param = createFieldValidator('params');
module.exports.params = createFieldValidator('params');
module.exports.header = createFieldValidator('headers');
module.exports.headers = createFieldValidator('headers');

// Convenience exports for common validators
module.exports.string = (options) => ({ type: 'string', ...options });
module.exports.number = (options) => ({ type: 'number', ...options });
module.exports.boolean = (options) => ({ type: 'boolean', ...options });
module.exports.array = (options) => ({ type: 'array', ...options });
module.exports.object = (options) => ({ type: 'object', ...options });
module.exports.date = (options) => ({ type: 'date', ...options });
module.exports.email = (options) => ({ type: 'email', ...options });
module.exports.url = (options) => ({ type: 'url', ...options });
module.exports.uuid = (options) => ({ type: 'uuid', ...options });
module.exports.objectId = (options) => ({ type: 'objectId', ...options });
module.exports.phone = (options) => ({ type: 'phone', ...options });
module.exports.ip = (options) => ({ type: 'ip', ...options });