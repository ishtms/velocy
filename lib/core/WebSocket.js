const crypto = require('node:crypto');
const EventEmitter = require('node:events');
const { Buffer } = require('node:buffer');

// WebSocket opcodes
const OPCODES = {
  CONTINUATION: 0x0,
  TEXT: 0x1,
  BINARY: 0x2,
  CLOSE: 0x8,
  PING: 0x9,
  PONG: 0xa
};

// WebSocket close codes
const CLOSE_CODES = {
  NORMAL: 1000,
  GOING_AWAY: 1001,
  PROTOCOL_ERROR: 1002,
  UNSUPPORTED_DATA: 1003,
  NO_STATUS_RECEIVED: 1005,
  ABNORMAL_CLOSURE: 1006,
  INVALID_FRAME_PAYLOAD: 1007,
  POLICY_VIOLATION: 1008,
  MESSAGE_TOO_BIG: 1009,
  MANDATORY_EXTENSION: 1010,
  INTERNAL_ERROR: 1011,
  SERVICE_RESTART: 1012,
  TRY_AGAIN_LATER: 1013
};

// WebSocket connection states
const STATES = {
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3
};

/**
 * WebSocket connection class
 * Implements RFC 6455 WebSocket protocol
 */
class WebSocketConnection extends EventEmitter {
  constructor(socket, req, options = {}) {
    super();
    
    this.socket = socket;
    this.req = req;
    this.id = crypto.randomUUID();
    this.state = STATES.OPEN;
    this.rooms = new Set();
    this.metadata = {};
    
    // Options
    this.maxPayloadSize = options.maxPayloadSize || 100 * 1024 * 1024; // 100MB default
    this.heartbeatInterval = options.heartbeatInterval || 30000; // 30 seconds
    this.heartbeatTimeout = options.heartbeatTimeout || 60000; // 60 seconds
    
    // Frame parsing state
    this.fragments = [];
    this.fragmentedOpcode = null;
    this.buffer = Buffer.alloc(0);
    
    // Heartbeat management
    this.lastPing = Date.now();
    this.lastPong = Date.now();
    this.heartbeatTimer = null;
    this.timeoutTimer = null;
    
    // Setup socket handlers
    this.#setupSocket();
    
    // Start heartbeat
    if (this.heartbeatInterval > 0) {
      this.#startHeartbeat();
    }
  }
  
  #setupSocket() {
    this.socket.on('data', (data) => this.#handleData(data));
    this.socket.on('close', () => this.#handleClose());
    this.socket.on('error', (err) => this.#handleError(err));
  }
  
  #startHeartbeat() {
    this.heartbeatTimer = setInterval(() => {
      if (this.state !== STATES.OPEN) {
        this.#stopHeartbeat();
        return;
      }
      
      // Check for timeout
      if (Date.now() - this.lastPong > this.heartbeatTimeout) {
        this.close(CLOSE_CODES.GOING_AWAY, 'Heartbeat timeout');
        return;
      }
      
      // Send ping
      this.ping();
    }, this.heartbeatInterval);
  }
  
  #stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
    }
  }
  
  #handleData(data) {
    // Append new data to buffer
    this.buffer = Buffer.concat([this.buffer, data]);
    
    // Process frames while we have enough data
    while (this.buffer.length >= 2) {
      const frame = this.#parseFrame();
      if (!frame) break; // Not enough data for a complete frame
      
      this.#processFrame(frame);
    }
  }
  
  #parseFrame() {
    let offset = 0;
    const buffer = this.buffer;
    
    if (buffer.length < 2) return null;
    
    // Parse first byte: FIN (1 bit) + RSV (3 bits) + Opcode (4 bits)
    const firstByte = buffer[offset++];
    const fin = !!(firstByte & 0x80);
    const rsv1 = !!(firstByte & 0x40);
    const rsv2 = !!(firstByte & 0x20);
    const rsv3 = !!(firstByte & 0x10);
    const opcode = firstByte & 0x0f;
    
    // Parse second byte: MASK (1 bit) + Payload length (7 bits)
    const secondByte = buffer[offset++];
    const masked = !!(secondByte & 0x80);
    let payloadLength = secondByte & 0x7f;
    
    // Extended payload length
    if (payloadLength === 126) {
      if (buffer.length < offset + 2) return null;
      payloadLength = buffer.readUInt16BE(offset);
      offset += 2;
    } else if (payloadLength === 127) {
      if (buffer.length < offset + 8) return null;
      // JavaScript can't handle 64-bit integers precisely, but this should be fine for practical use
      const high = buffer.readUInt32BE(offset);
      const low = buffer.readUInt32BE(offset + 4);
      payloadLength = high * 0x100000000 + low;
      offset += 8;
      
      if (payloadLength > this.maxPayloadSize) {
        this.close(CLOSE_CODES.MESSAGE_TOO_BIG, 'Payload too large');
        return null;
      }
    }
    
    // Masking key
    let maskKey = null;
    if (masked) {
      if (buffer.length < offset + 4) return null;
      maskKey = buffer.slice(offset, offset + 4);
      offset += 4;
    }
    
    // Check if we have the complete payload
    if (buffer.length < offset + payloadLength) return null;
    
    // Extract payload
    let payload = buffer.slice(offset, offset + payloadLength);
    
    // Unmask payload if needed
    if (masked) {
      for (let i = 0; i < payload.length; i++) {
        payload[i] ^= maskKey[i % 4];
      }
    }
    
    // Remove processed data from buffer
    this.buffer = buffer.slice(offset + payloadLength);
    
    return {
      fin,
      rsv1,
      rsv2,
      rsv3,
      opcode,
      masked,
      payload
    };
  }
  
  #processFrame(frame) {
    const { fin, opcode, payload } = frame;
    
    // Handle control frames
    if (opcode & 0x8) {
      switch (opcode) {
        case OPCODES.CLOSE:
          this.#handleCloseFrame(payload);
          break;
        case OPCODES.PING:
          this.#handlePingFrame(payload);
          break;
        case OPCODES.PONG:
          this.#handlePongFrame(payload);
          break;
        default:
          this.close(CLOSE_CODES.PROTOCOL_ERROR, 'Unknown control opcode');
      }
      return;
    }
    
    // Handle data frames
    if (opcode === OPCODES.CONTINUATION) {
      // Continuation frame
      if (this.fragmentedOpcode === null) {
        this.close(CLOSE_CODES.PROTOCOL_ERROR, 'Unexpected continuation frame');
        return;
      }
      this.fragments.push(payload);
    } else {
      // New message
      if (this.fragmentedOpcode !== null) {
        this.close(CLOSE_CODES.PROTOCOL_ERROR, 'Expected continuation frame');
        return;
      }
      
      if (!fin) {
        // Start of fragmented message
        this.fragmentedOpcode = opcode;
        this.fragments = [payload];
        return;
      }
      
      // Complete message
      this.#handleMessage(opcode, payload);
    }
    
    // Check if fragmented message is complete
    if (fin && this.fragmentedOpcode !== null) {
      const completePayload = Buffer.concat(this.fragments);
      this.#handleMessage(this.fragmentedOpcode, completePayload);
      this.fragmentedOpcode = null;
      this.fragments = [];
    }
  }
  
  #handleMessage(opcode, payload) {
    if (opcode === OPCODES.TEXT) {
      try {
        const text = payload.toString('utf8');
        this.emit('message', text, false);
      } catch (err) {
        this.close(CLOSE_CODES.INVALID_FRAME_PAYLOAD, 'Invalid UTF-8');
      }
    } else if (opcode === OPCODES.BINARY) {
      this.emit('message', payload, true);
    }
  }
  
  #handleCloseFrame(payload) {
    let code = CLOSE_CODES.NO_STATUS_RECEIVED;
    let reason = '';
    
    if (payload.length >= 2) {
      code = payload.readUInt16BE(0);
      reason = payload.slice(2).toString('utf8');
    }
    
    // Store close code and reason for later
    this.closeCode = code;
    this.closeReason = reason;
    
    // Send close frame back if we haven't already
    if (this.state === STATES.OPEN) {
      this.state = STATES.CLOSING;
      this.#sendFrame(OPCODES.CLOSE, payload);
    }
    
    // Emit close event with code and reason
    this.emit('close', code, reason);
    
    this.close(code, reason);
  }
  
  #handlePingFrame(payload) {
    // Respond with pong
    if (this.state === STATES.OPEN) {
      this.#sendFrame(OPCODES.PONG, payload);
    }
  }
  
  #handlePongFrame(payload) {
    this.lastPong = Date.now();
    this.emit('pong', payload);
  }
  
  #handleClose() {
    if (this.state === STATES.CLOSED) return;
    
    this.state = STATES.CLOSED;
    this.#stopHeartbeat();
    
    // Use stored close code/reason if available, otherwise use defaults
    const code = this.closeCode || CLOSE_CODES.ABNORMAL_CLOSURE;
    const reason = this.closeReason || 'Connection lost';
    
    // Only emit if we haven't already emitted from #handleCloseFrame
    if (!this.closeCode) {
      this.emit('close', code, reason);
    }
    
    // Clean up
    this.socket.removeAllListeners();
    this.removeAllListeners();
  }
  
  #handleError(err) {
    this.emit('error', err);
    this.close(CLOSE_CODES.INTERNAL_ERROR, 'Socket error');
  }
  
  #sendFrame(opcode, payload = Buffer.alloc(0)) {
    if (this.state !== STATES.OPEN && opcode !== OPCODES.CLOSE) {
      return false;
    }
    
    // Ensure payload is a Buffer
    if (typeof payload === 'string') {
      payload = Buffer.from(payload, 'utf8');
    } else if (!Buffer.isBuffer(payload)) {
      payload = Buffer.from(payload);
    }
    
    const payloadLength = payload.length;
    let frame;
    
    if (payloadLength < 126) {
      frame = Buffer.allocUnsafe(2);
      frame[0] = 0x80 | opcode; // FIN = 1, opcode
      frame[1] = payloadLength;
    } else if (payloadLength < 65536) {
      frame = Buffer.allocUnsafe(4);
      frame[0] = 0x80 | opcode;
      frame[1] = 126;
      frame.writeUInt16BE(payloadLength, 2);
    } else {
      frame = Buffer.allocUnsafe(10);
      frame[0] = 0x80 | opcode;
      frame[1] = 127;
      // Split 64-bit length into two 32-bit values
      frame.writeUInt32BE(Math.floor(payloadLength / 0x100000000), 2);
      frame.writeUInt32BE(payloadLength % 0x100000000, 6);
    }
    
    // Send frame header and payload
    try {
      this.socket.write(frame);
      if (payloadLength > 0) {
        this.socket.write(payload);
      }
      return true;
    } catch (err) {
      this.#handleError(err);
      return false;
    }
  }
  
  /**
   * Send a text or binary message
   * @param {string|Buffer|object} data - Data to send
   * @returns {boolean} Success status
   */
  send(data) {
    // If it's a Buffer, send as binary
    if (Buffer.isBuffer(data)) {
      return this.#sendFrame(OPCODES.BINARY, data);
    }
    // If it's an object (but not Buffer), stringify it
    if (typeof data === 'object') {
      data = JSON.stringify(data);
    }
    return this.#sendFrame(OPCODES.TEXT, data);
  }
  
  /**
   * Send a binary message
   * @param {Buffer} data - Binary data to send
   * @returns {boolean} Success status
   */
  sendBinary(data) {
    return this.#sendFrame(OPCODES.BINARY, data);
  }
  
  /**
   * Send a ping frame
   * @param {Buffer|string} data - Optional ping payload
   * @returns {boolean} Success status
   */
  ping(data = Buffer.alloc(0)) {
    this.lastPing = Date.now();
    return this.#sendFrame(OPCODES.PING, data);
  }
  
  /**
   * Send a pong frame
   * @param {Buffer|string} data - Optional pong payload
   * @returns {boolean} Success status
   */
  pong(data = Buffer.alloc(0)) {
    return this.#sendFrame(OPCODES.PONG, data);
  }
  
  /**
   * Close the WebSocket connection
   * @param {number} code - Close code
   * @param {string} reason - Close reason
   */
  close(code = CLOSE_CODES.NORMAL, reason = '') {
    if (this.state === STATES.CLOSED) return;
    
    if (this.state === STATES.OPEN) {
      this.state = STATES.CLOSING;
      
      // Send close frame
      const reasonBuffer = Buffer.from(reason, 'utf8');
      const payload = Buffer.allocUnsafe(2 + reasonBuffer.length);
      payload.writeUInt16BE(code, 0);
      reasonBuffer.copy(payload, 2);
      
      this.#sendFrame(OPCODES.CLOSE, payload);
    }
    
    // Close the socket after a timeout
    setTimeout(() => {
      if (this.socket && !this.socket.destroyed) {
        this.socket.destroy();
      }
    }, 1000);
    
    this.state = STATES.CLOSED;
    this.#stopHeartbeat();
  }
  
  /**
   * Join a room
   * @param {string} room - Room name
   */
  join(room) {
    this.rooms.add(room);
    this.emit('join', room);
  }
  
  /**
   * Leave a room
   * @param {string} room - Room name
   */
  leave(room) {
    this.rooms.delete(room);
    this.emit('leave', room);
  }
  
  /**
   * Check if in a room
   * @param {string} room - Room name
   * @returns {boolean}
   */
  inRoom(room) {
    return this.rooms.has(room);
  }
  
  /**
   * Get connection info
   * @returns {Object} Connection information
   */
  getInfo() {
    return {
      id: this.id,
      state: this.state,
      rooms: Array.from(this.rooms),
      metadata: this.metadata,
      remoteAddress: this.socket.remoteAddress,
      remotePort: this.socket.remotePort
    };
  }
  
  /**
   * Get readyState (alias for state, for compatibility)
   * @returns {number} Connection state
   */
  get readyState() {
    return this.state;
  }
}

/**
 * WebSocket Server class
 * Manages WebSocket connections and broadcasting
 */
class WebSocketServer extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.connections = new Map();
    this.rooms = new Map(); // room -> Set of connection IDs
    this.options = options;
    
    // Message queue for offline clients (optional)
    this.messageQueue = options.enableQueue ? new Map() : null;
    this.maxQueueSize = options.maxQueueSize || 100;
  }
  
  /**
   * Handle WebSocket upgrade
   * @param {Request} req - HTTP request
   * @param {Socket} socket - TCP socket
   * @param {Buffer} head - Upgrade head
   * @returns {WebSocketConnection} WebSocket connection
   */
  handleUpgrade(req, socket, head) {
    // Validate WebSocket headers
    const key = req.headers['sec-websocket-key'];
    const version = req.headers['sec-websocket-version'];
    
    if (!key || version !== '13') {
      socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      return null;
    }
    
    // Generate accept key
    const acceptKey = crypto
      .createHash('sha1')
      .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
      .digest('base64');
    
    // Send upgrade response
    const responseHeaders = [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${acceptKey}`
    ];
    
    // Handle subprotocols if requested
    const protocols = req.headers['sec-websocket-protocol'];
    if (protocols && this.options.handleProtocols) {
      const selectedProtocol = this.options.handleProtocols(protocols.split(',').map(p => p.trim()));
      if (selectedProtocol) {
        responseHeaders.push(`Sec-WebSocket-Protocol: ${selectedProtocol}`);
      }
    }
    
    socket.write(responseHeaders.join('\r\n') + '\r\n\r\n');
    
    // Create WebSocket connection
    const ws = new WebSocketConnection(socket, req, this.options);
    
    // Add to connections map
    this.connections.set(ws.id, ws);
    
    // Setup connection event handlers
    ws.on('close', () => {
      this.#handleConnectionClose(ws);
    });
    
    ws.on('join', (room) => {
      this.#addToRoom(ws.id, room);
    });
    
    ws.on('leave', (room) => {
      this.#removeFromRoom(ws.id, room);
    });
    
    // Emit connection event
    this.emit('connection', ws, req);
    
    // Process queued messages if any
    if (this.messageQueue && this.messageQueue.has(ws.id)) {
      const messages = this.messageQueue.get(ws.id);
      this.messageQueue.delete(ws.id);
      
      for (const msg of messages) {
        ws.send(msg);
      }
    }
    
    return ws;
  }
  
  #handleConnectionClose(ws) {
    // Remove from all rooms
    for (const room of ws.rooms) {
      this.#removeFromRoom(ws.id, room);
    }
    
    // Remove from connections
    this.connections.delete(ws.id);
    
    // Emit disconnection event
    this.emit('disconnection', ws);
  }
  
  #addToRoom(connectionId, room) {
    if (!this.rooms.has(room)) {
      this.rooms.set(room, new Set());
    }
    this.rooms.get(room).add(connectionId);
  }
  
  #removeFromRoom(connectionId, room) {
    const roomConnections = this.rooms.get(room);
    if (roomConnections) {
      roomConnections.delete(connectionId);
      if (roomConnections.size === 0) {
        this.rooms.delete(room);
      }
    }
  }
  
  /**
   * Broadcast to all connections
   * @param {*} data - Data to broadcast
   * @param {Object} options - Broadcast options
   */
  broadcast(data, options = {}) {
    const { except, binary } = options;
    const exceptSet = except ? new Set(Array.isArray(except) ? except : [except]) : null;
    
    for (const [id, ws] of this.connections) {
      if (exceptSet && exceptSet.has(id)) continue;
      
      if (binary) {
        ws.sendBinary(data);
      } else {
        ws.send(data);
      }
    }
  }
  
  /**
   * Broadcast to a specific room
   * @param {string} room - Room name
   * @param {*} data - Data to broadcast
   * @param {Object} options - Broadcast options
   */
  broadcastToRoom(room, data, options = {}) {
    const { except, binary } = options;
    const exceptSet = except ? new Set(Array.isArray(except) ? except : [except]) : null;
    const roomConnections = this.rooms.get(room);
    
    if (!roomConnections) return;
    
    for (const id of roomConnections) {
      if (exceptSet && exceptSet.has(id)) continue;
      
      const ws = this.connections.get(id);
      if (ws) {
        if (binary) {
          ws.sendBinary(data);
        } else {
          ws.send(data);
        }
      }
    }
  }
  
  /**
   * Send to a specific connection
   * @param {string} connectionId - Connection ID
   * @param {*} data - Data to send
   * @param {Object} options - Send options
   */
  sendTo(connectionId, data, options = {}) {
    const ws = this.connections.get(connectionId);
    
    if (ws) {
      if (options.binary) {
        ws.sendBinary(data);
      } else {
        ws.send(data);
      }
    } else if (this.messageQueue) {
      // Queue message for offline client
      if (!this.messageQueue.has(connectionId)) {
        this.messageQueue.set(connectionId, []);
      }
      
      const queue = this.messageQueue.get(connectionId);
      if (queue.length < this.maxQueueSize) {
        queue.push(data);
      }
    }
  }
  
  /**
   * Get connection by ID
   * @param {string} connectionId - Connection ID
   * @returns {WebSocketConnection|null}
   */
  getConnection(connectionId) {
    return this.connections.get(connectionId) || null;
  }
  
  /**
   * Get all connections in a room
   * @param {string} room - Room name
   * @returns {WebSocketConnection[]}
   */
  getRoom(room) {
    const roomConnections = this.rooms.get(room);
    if (!roomConnections) return [];
    
    const connections = [];
    for (const id of roomConnections) {
      const ws = this.connections.get(id);
      if (ws) connections.push(ws);
    }
    return connections;
  }
  
  /**
   * Get server statistics
   * @returns {Object} Server stats
   */
  getStats() {
    return {
      connections: this.connections.size,
      rooms: this.rooms.size,
      queuedMessages: this.messageQueue ? this.messageQueue.size : 0
    };
  }
  
  /**
   * Close all connections
   * @param {number} code - Close code
   * @param {string} reason - Close reason
   */
  closeAll(code = CLOSE_CODES.GOING_AWAY, reason = 'Server shutdown') {
    for (const ws of this.connections.values()) {
      ws.close(code, reason);
    }
  }
}

module.exports = {
  WebSocketConnection,
  WebSocketServer,
  OPCODES,
  CLOSE_CODES,
  STATES
};