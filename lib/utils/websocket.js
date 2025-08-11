const crypto = require('node:crypto');

/**
 * WebSocket utility functions
 */

/**
 * Generate WebSocket accept key from client key
 * @param {string} key - Client's Sec-WebSocket-Key
 * @returns {string} Accept key for response
 */
function generateAcceptKey(key) {
  return crypto
    .createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');
}

/**
 * Validate WebSocket request headers
 * @param {Object} headers - Request headers
 * @returns {Object} Validation result
 */
function validateWebSocketHeaders(headers) {
  const errors = [];
  
  // Check required headers
  if (!headers.upgrade || headers.upgrade.toLowerCase() !== 'websocket') {
    errors.push('Missing or invalid Upgrade header');
  }
  
  if (!headers.connection || !headers.connection.toLowerCase().includes('upgrade')) {
    errors.push('Missing or invalid Connection header');
  }
  
  if (!headers['sec-websocket-key']) {
    errors.push('Missing Sec-WebSocket-Key header');
  } else {
    // Validate key format (should be base64 encoded 16 bytes)
    const key = headers['sec-websocket-key'];
    const keyBuffer = Buffer.from(key, 'base64');
    if (keyBuffer.length !== 16) {
      errors.push('Invalid Sec-WebSocket-Key length');
    }
  }
  
  if (!headers['sec-websocket-version'] || headers['sec-websocket-version'] !== '13') {
    errors.push('Missing or unsupported Sec-WebSocket-Version');
  }
  
  return {
    valid: errors.length === 0,
    errors,
    key: headers['sec-websocket-key'],
    version: headers['sec-websocket-version'],
    protocols: headers['sec-websocket-protocol'] ? 
      headers['sec-websocket-protocol'].split(',').map(p => p.trim()) : [],
    extensions: headers['sec-websocket-extensions'] ?
      headers['sec-websocket-extensions'].split(',').map(e => e.trim()) : []
  };
}

/**
 * Parse WebSocket URL to extract path and query parameters
 * @param {string} url - WebSocket URL
 * @returns {Object} Parsed URL components
 */
function parseWebSocketUrl(url) {
  const queryIndex = url.indexOf('?');
  
  if (queryIndex === -1) {
    return {
      path: url,
      query: {},
      queryString: ''
    };
  }
  
  const path = url.slice(0, queryIndex);
  const queryString = url.slice(queryIndex + 1);
  const query = {};
  
  // Parse query parameters
  if (queryString) {
    const params = new URLSearchParams(queryString);
    for (const [key, value] of params) {
      if (query[key]) {
        // Handle multiple values
        if (Array.isArray(query[key])) {
          query[key].push(value);
        } else {
          query[key] = [query[key], value];
        }
      } else {
        query[key] = value;
      }
    }
  }
  
  return {
    path,
    query,
    queryString
  };
}

/**
 * Create a WebSocket message frame
 * @param {Object} options - Frame options
 * @returns {Buffer} WebSocket frame
 */
function createFrame(options) {
  const {
    opcode = 0x1, // Default to text frame
    payload = Buffer.alloc(0),
    fin = true,
    rsv1 = false,
    rsv2 = false,
    rsv3 = false,
    masked = false,
    maskKey = null
  } = options;
  
  // Ensure payload is a Buffer
  const payloadBuffer = Buffer.isBuffer(payload) ? 
    payload : Buffer.from(payload, 'utf8');
  
  const payloadLength = payloadBuffer.length;
  
  // Calculate frame size
  let frameSize = 2; // Minimum frame size
  if (payloadLength > 65535) {
    frameSize += 8; // 64-bit length
  } else if (payloadLength > 125) {
    frameSize += 2; // 16-bit length
  }
  if (masked) {
    frameSize += 4; // Mask key
  }
  frameSize += payloadLength;
  
  const frame = Buffer.allocUnsafe(frameSize);
  let offset = 0;
  
  // First byte: FIN, RSV, Opcode
  frame[offset++] = 
    (fin ? 0x80 : 0) |
    (rsv1 ? 0x40 : 0) |
    (rsv2 ? 0x20 : 0) |
    (rsv3 ? 0x10 : 0) |
    (opcode & 0x0f);
  
  // Second byte: Mask flag and payload length
  if (payloadLength < 126) {
    frame[offset++] = (masked ? 0x80 : 0) | payloadLength;
  } else if (payloadLength < 65536) {
    frame[offset++] = (masked ? 0x80 : 0) | 126;
    frame.writeUInt16BE(payloadLength, offset);
    offset += 2;
  } else {
    frame[offset++] = (masked ? 0x80 : 0) | 127;
    // Write 64-bit length (JavaScript number precision limitations apply)
    frame.writeUInt32BE(Math.floor(payloadLength / 0x100000000), offset);
    offset += 4;
    frame.writeUInt32BE(payloadLength % 0x100000000, offset);
    offset += 4;
  }
  
  // Mask key if needed
  if (masked) {
    const key = maskKey || crypto.randomBytes(4);
    key.copy(frame, offset);
    offset += 4;
    
    // Mask payload
    for (let i = 0; i < payloadLength; i++) {
      frame[offset + i] = payloadBuffer[i] ^ key[i % 4];
    }
  } else {
    // Copy unmasked payload
    payloadBuffer.copy(frame, offset);
  }
  
  return frame;
}

/**
 * WebSocket auto-reconnect client helper
 * @class
 */
class ReconnectingWebSocket {
  constructor(url, options = {}) {
    this.url = url;
    this.options = {
      reconnectInterval: options.reconnectInterval || 1000,
      maxReconnectInterval: options.maxReconnectInterval || 30000,
      reconnectDecay: options.reconnectDecay || 1.5,
      maxReconnectAttempts: options.maxReconnectAttempts || null,
      ...options
    };
    
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    this.forcedClose = false;
    this.ws = null;
    
    this.connect();
  }
  
  connect() {
    // Note: This is a placeholder for client-side WebSocket creation
    // In a real implementation, this would create a WebSocket connection
    // For server-side Node.js, you'd use a WebSocket client library
    
    // Reset forced close flag
    this.forcedClose = false;
    
    // Simulate connection (would be real WebSocket in practice)
    
    // In real implementation:
    // this.ws = new WebSocket(this.url);
    // this.ws.onopen = () => this.handleOpen();
    // this.ws.onclose = (e) => this.handleClose(e);
    // this.ws.onerror = (e) => this.handleError(e);
    // this.ws.onmessage = (e) => this.handleMessage(e);
  }
  
  handleOpen() {
    this.reconnectAttempts = 0;
    
    if (this.options.onopen) {
      this.options.onopen();
    }
  }
  
  handleClose(event) {
    if (!this.forcedClose) {
      if (this.options.onclose) {
        this.options.onclose(event);
      }
      
      this.reconnect();
    }
  }
  
  handleError(error) {
    if (this.options.onerror) {
      this.options.onerror(error);
    }
  }
  
  handleMessage(event) {
    if (this.options.onmessage) {
      this.options.onmessage(event);
    }
  }
  
  reconnect() {
    if (this.options.maxReconnectAttempts && 
        this.reconnectAttempts >= this.options.maxReconnectAttempts) {
      return;
    }
    
    this.reconnectAttempts++;
    
    const timeout = Math.min(
      this.options.reconnectInterval * Math.pow(this.options.reconnectDecay, this.reconnectAttempts - 1),
      this.options.maxReconnectInterval
    );
    
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, timeout);
  }
  
  send(data) {
    if (this.ws && this.ws.readyState === 1) {
      this.ws.send(data);
    }
    // Silently fail if not connected
  }
  
  close() {
    this.forcedClose = true;
    
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    
    if (this.ws) {
      this.ws.close();
    }
  }
}

/**
 * Message framing utilities
 */
const MessageFraming = {
  /**
   * Fragment a large message into multiple frames
   * @param {Buffer} data - Data to fragment
   * @param {number} maxFrameSize - Maximum frame size
   * @returns {Buffer[]} Array of frames
   */
  fragment(data, maxFrameSize = 65536) {
    const frames = [];
    let offset = 0;
    
    while (offset < data.length) {
      const chunkSize = Math.min(maxFrameSize, data.length - offset);
      const chunk = data.slice(offset, offset + chunkSize);
      const isLast = offset + chunkSize >= data.length;
      
      const frame = createFrame({
        opcode: offset === 0 ? 0x1 : 0x0, // TEXT for first, CONTINUATION for rest
        payload: chunk,
        fin: isLast
      });
      
      frames.push(frame);
      offset += chunkSize;
    }
    
    return frames;
  },
  
  /**
   * Check if a frame is a control frame
   * @param {number} opcode - Frame opcode
   * @returns {boolean}
   */
  isControlFrame(opcode) {
    return (opcode & 0x8) !== 0;
  },
  
  /**
   * Check if a frame is a data frame
   * @param {number} opcode - Frame opcode
   * @returns {boolean}
   */
  isDataFrame(opcode) {
    return (opcode & 0x8) === 0;
  }
};

module.exports = {
  generateAcceptKey,
  validateWebSocketHeaders,
  parseWebSocketUrl,
  createFrame,
  ReconnectingWebSocket,
  MessageFraming
};