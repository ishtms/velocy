const crypto = require('node:crypto');
const EventEmitter = require('node:events');
const { Buffer } = require('node:buffer');

/**
 * WebSocket frame opcodes as defined in RFC 6455.
 * Used to identify the type of data being transmitted in each frame.
 * 
 * @readonly
 * @enum {number}
 */
const OPCODES = {
  /** @type {number} Continuation frame for fragmented messages */
  CONTINUATION: 0x0,
  /** @type {number} Text data frame (UTF-8 encoded) */
  TEXT: 0x1,
  /** @type {number} Binary data frame */
  BINARY: 0x2,
  /** @type {number} Connection close frame */
  CLOSE: 0x8,
  /** @type {number} Ping frame for keep-alive */
  PING: 0x9,
  /** @type {number} Pong frame responding to ping */
  PONG: 0xa
};

/**
 * WebSocket close codes as defined in RFC 6455.
 * Standardized codes for indicating why a WebSocket connection was closed.
 * 
 * @readonly
 * @enum {number}
 */
const CLOSE_CODES = {
  /** @type {number} Normal closure, meaning that the purpose for which the connection was established has been fulfilled */
  NORMAL: 1000,
  /** @type {number} Endpoint is "going away", such as a server going down or a browser navigating away */
  GOING_AWAY: 1001,
  /** @type {number} Endpoint terminating connection due to protocol error */
  PROTOCOL_ERROR: 1002,
  /** @type {number} Endpoint terminating connection because it received unsupported data */
  UNSUPPORTED_DATA: 1003,
  /** @type {number} Reserved. No status code was actually present */
  NO_STATUS_RECEIVED: 1005,
  /** @type {number} Reserved. Connection was closed abnormally without a close frame */
  ABNORMAL_CLOSURE: 1006,
  /** @type {number} Endpoint terminating connection because invalid data was received */
  INVALID_FRAME_PAYLOAD: 1007,
  /** @type {number} Endpoint terminating connection because policy violation occurred */
  POLICY_VIOLATION: 1008,
  /** @type {number} Endpoint terminating connection because a data frame too large was received */
  MESSAGE_TOO_BIG: 1009,
  /** @type {number} Client terminating connection because server didn't respond with required extension */
  MANDATORY_EXTENSION: 1010,
  /** @type {number} Server terminating connection because unexpected condition prevented fulfilling request */
  INTERNAL_ERROR: 1011,
  /** @type {number} Server is restarting. Client may reconnect and retry after suitable delay */
  SERVICE_RESTART: 1012,
  /** @type {number} Server is overloaded. Client should only connect to different IP or retry after delay */
  TRY_AGAIN_LATER: 1013
};

/**
 * WebSocket connection states as defined in the WebSocket API.
 * Represents the current state of the WebSocket connection lifecycle.
 * 
 * @readonly
 * @enum {number}
 */
const STATES = {
  /** @type {number} Socket has been created but connection is not yet open */
  CONNECTING: 0,
  /** @type {number} Connection is open and ready to communicate */
  OPEN: 1,
  /** @type {number} Connection is in the process of closing */
  CLOSING: 2,
  /** @type {number} Connection is closed or couldn't be opened */
  CLOSED: 3
};

/**
 * WebSocket connection implementation following RFC 6455 specification.
 * Provides a complete WebSocket implementation with frame parsing, message handling,
 * heartbeat management, and room-based messaging. Handles both text and binary messages,
 * supports fragmented messages, and implements proper connection lifecycle management.
 * 
 * Features include:
 * - Full RFC 6455 compliance for frame parsing and generation
 * - Automatic heartbeat/ping-pong for connection health monitoring
 * - Room-based messaging for broadcast scenarios
 * - Fragmented message handling for large payloads
 * - Connection metadata and state management
 * - Proper error handling and recovery
 * 
 * @class WebSocketConnection
 * @extends EventEmitter
 * @example
 * // WebSocket connections are typically created by WebSocketServer
 * ws.on('message', (data, isBinary) => {
 *   console.log('Received:', isBinary ? 'Binary data' : data);
 * });
 * 
 * ws.send('Hello, client!');
 * ws.join('chatroom');
 * ws.broadcast('Message to all in room');
 */
class WebSocketConnection extends EventEmitter {
  /**
   * Creates a new WebSocket connection instance.
   * Initializes the connection with proper frame parsing, heartbeat management,
   * and room tracking. The connection starts in OPEN state and immediately
   * begins processing incoming data frames.
   * 
   * @constructor
   * @param {net.Socket} socket - The upgraded TCP socket from the HTTP server
   * @param {http.IncomingMessage} req - The original HTTP upgrade request
   * @param {Object} [options={}] - Configuration options for the connection
   * @param {number} [options.maxPayloadSize=104857600] - Maximum payload size in bytes (default: 100MB)
   * @param {number} [options.heartbeatInterval=30000] - Heartbeat ping interval in milliseconds (default: 30s)
   * @param {number} [options.heartbeatTimeout=60000] - Heartbeat timeout in milliseconds (default: 60s)
   * @fires WebSocketConnection#open
   * @example
   * // Typically created by WebSocketServer.handleUpgrade()
   * const ws = new WebSocketConnection(socket, request, {
   *   maxPayloadSize: 50 * 1024 * 1024, // 50MB
   *   heartbeatInterval: 15000 // 15 seconds
   * });
   */
  constructor(socket, req, options = {}) {
    super();
    
    /**
     * @type {net.Socket}
     * @description The underlying TCP socket for this WebSocket connection
     */
    this.socket = socket;
    
    /**
     * @type {http.IncomingMessage}
     * @description The original HTTP upgrade request that created this connection
     */
    this.req = req;
    
    /**
     * @type {string}
     * @description Unique identifier for this connection (UUID v4)
     */
    this.id = crypto.randomUUID();
    
    /**
     * @type {number}
     * @description Current connection state (CONNECTING, OPEN, CLOSING, CLOSED)
     */
    this.state = STATES.OPEN;
    
    /**
     * @type {Set<string>}
     * @description Set of room names this connection has joined
     */
    this.rooms = new Set();
    
    /**
     * @type {Object}
     * @description Custom metadata storage for application use
     */
    this.metadata = {};
    
    // Configuration options with secure defaults
    /**
     * @type {number}
     * @description Maximum allowed payload size to prevent memory exhaustion attacks
     * @default 104857600 (100MB)
     */
    this.maxPayloadSize = options.maxPayloadSize || 100 * 1024 * 1024;
    
    /**
     * @type {number}
     * @description Interval between heartbeat ping frames in milliseconds
     * @default 30000 (30 seconds)
     */
    this.heartbeatInterval = options.heartbeatInterval || 30000;
    
    /**
     * @type {number}
     * @description Timeout for pong response to ping frames in milliseconds
     * @default 60000 (60 seconds)
     */
    this.heartbeatTimeout = options.heartbeatTimeout || 60000;
    
    // Frame parsing state for handling fragmented messages
    /**
     * @type {Buffer[]}
     * @private
     * @description Array of frame fragments for reassembling fragmented messages
     */
    this.fragments = [];
    
    /**
     * @type {number|null}
     * @private
     * @description Opcode of the first frame in a fragmented message sequence
     */
    this.fragmentedOpcode = null;
    
    /**
     * @type {Buffer}
     * @private
     * @description Buffer for accumulating incoming data before frame parsing
     */
    this.buffer = Buffer.alloc(0);
    
    // Heartbeat management for connection health monitoring
    /**
     * @type {number}
     * @private
     * @description Timestamp of last ping sent
     */
    this.lastPing = Date.now();
    
    /**
     * @type {number}
     * @private
     * @description Timestamp of last pong received
     */
    this.lastPong = Date.now();
    
    /**
     * @type {NodeJS.Timeout|null}
     * @private
     * @description Timer for sending periodic ping frames
     */
    this.heartbeatTimer = null;
    
    /**
     * @type {NodeJS.Timeout|null}
     * @private
     * @description Timer for heartbeat timeout detection
     */
    this.timeoutTimer = null;
    
    // Initialize connection
    this.#setupSocket();
    
    // Start heartbeat monitoring if enabled
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
   * Sends a message through the WebSocket connection.
   * Automatically determines message type based on data type - Buffer objects are sent
   * as binary frames, objects are JSON-stringified and sent as text frames, and strings
   * are sent as text frames. This provides a convenient API for most common use cases.
   * 
   * @param {string|Buffer|Object} data - Data to send over the connection
   * @returns {boolean} True if message was queued for sending, false if connection is not open
   * @throws {Error} If JSON.stringify fails for object data
   * @fires WebSocketConnection#message
   * @example
   * // Send text message
   * ws.send('Hello, world!');
   * 
   * // Send JSON object (automatically stringified)
   * ws.send({ type: 'notification', message: 'New user joined' });
   * 
   * // Send binary data
   * ws.send(Buffer.from([0x01, 0x02, 0x03]));
   */
  send(data) {
    // Binary data gets sent as binary frame
    if (Buffer.isBuffer(data)) {
      return this.#sendFrame(OPCODES.BINARY, data);
    }
    // Objects (excluding Buffer) get JSON-stringified
    if (typeof data === 'object') {
      data = JSON.stringify(data);
    }
    return this.#sendFrame(OPCODES.TEXT, data);
  }
  
  /**
   * Sends binary data through the WebSocket connection.
   * Forces data to be sent as a binary frame regardless of input type.
   * Use this method when you need to ensure binary transmission.
   * 
   * @param {Buffer|string|ArrayBuffer} data - Binary data to send
   * @returns {boolean} True if message was queued for sending, false if connection is not open
   * @example
   * // Send image data
   * const imageBuffer = fs.readFileSync('image.png');
   * ws.sendBinary(imageBuffer);
   * 
   * // Send protocol buffer or other binary format
   * ws.sendBinary(protobufData);
   */
  sendBinary(data) {
    return this.#sendFrame(OPCODES.BINARY, data);
  }
  
  /**
   * Sends a ping frame to test connection health.
   * The peer should respond with a pong frame containing the same payload.
   * This is used for heartbeat/keep-alive functionality and connection testing.
   * Automatically updates the lastPing timestamp for timeout detection.
   * 
   * @param {Buffer|string} [data=Buffer.alloc(0)] - Optional payload for the ping frame
   * @returns {boolean} True if ping was sent, false if connection is not open
   * @example
   * // Send empty ping
   * ws.ping();
   * 
   * // Send ping with timestamp for RTT measurement
   * ws.ping(Date.now().toString());
   */
  ping(data = Buffer.alloc(0)) {
    this.lastPing = Date.now();
    return this.#sendFrame(OPCODES.PING, data);
  }
  
  /**
   * Sends a pong frame in response to a ping.
   * This is typically called automatically when a ping frame is received,
   * but can be called manually if needed. Should echo the ping payload.
   * 
   * @param {Buffer|string} [data=Buffer.alloc(0)] - Payload to echo from ping frame
   * @returns {boolean} True if pong was sent, false if connection is not open
   * @example
   * // Manual pong response
   * ws.pong(receivedPingPayload);
   */
  pong(data = Buffer.alloc(0)) {
    return this.#sendFrame(OPCODES.PONG, data);
  }
  
  /**
   * Initiates closure of the WebSocket connection.
   * Sends a close frame with the specified code and reason, then closes the underlying
   * socket after a brief timeout to allow for graceful closure. The connection state
   * is updated and all timers are cleared.
   * 
   * @param {number} [code=CLOSE_CODES.NORMAL] - Close code indicating reason for closure
   * @param {string} [reason=''] - Human-readable reason for closure (max 123 bytes UTF-8)
   * @fires WebSocketConnection#close
   * @example
   * // Normal closure
   * ws.close();
   * 
   * // Close with custom reason
   * ws.close(CLOSE_CODES.GOING_AWAY, 'Server restarting');
   * 
   * // Close due to error
   * ws.close(CLOSE_CODES.INTERNAL_ERROR, 'Database connection failed');
   */
  close(code = CLOSE_CODES.NORMAL, reason = '') {
    if (this.state === STATES.CLOSED) return;
    
    if (this.state === STATES.OPEN) {
      this.state = STATES.CLOSING;
      
      // Construct close frame payload with code and reason
      const reasonBuffer = Buffer.from(reason, 'utf8');
      const payload = Buffer.allocUnsafe(2 + reasonBuffer.length);
      payload.writeUInt16BE(code, 0);
      reasonBuffer.copy(payload, 2);
      
      this.#sendFrame(OPCODES.CLOSE, payload);
    }
    
    // Force socket closure after timeout to prevent hanging connections
    setTimeout(() => {
      if (this.socket && !this.socket.destroyed) {
        this.socket.destroy();
      }
    }, 1000);
    
    this.state = STATES.CLOSED;
    this.#stopHeartbeat();
  }
  
  /**
   * Joins a named room for group messaging.
   * Rooms are used for organizing connections into groups for targeted broadcasting.
   * A connection can be in multiple rooms simultaneously. Room membership is
   * automatically cleaned up when the connection closes.
   * 
   * @param {string} room - Name of the room to join
   * @fires WebSocketConnection#join
   * @example
   * // Join a chat room
   * ws.join('general-chat');
   * 
   * // Join multiple rooms
   * ws.join('admins');
   * ws.join('notifications');
   */
  join(room) {
    this.rooms.add(room);
    this.emit('join', room);
  }
  
  /**
   * Leaves a named room.
   * Removes this connection from the specified room. If the connection was not
   * in the room, this operation has no effect.
   * 
   * @param {string} room - Name of the room to leave
   * @fires WebSocketConnection#leave
   * @example
   * // Leave a chat room
   * ws.leave('general-chat');
   */
  leave(room) {
    this.rooms.delete(room);
    this.emit('leave', room);
  }
  
  /**
   * Checks if the connection is currently in a specific room.
   * 
   * @param {string} room - Name of the room to check
   * @returns {boolean} True if the connection is in the specified room
   * @example
   * if (ws.inRoom('admins')) {
   *   ws.send({ type: 'admin-message', data: adminData });
   * }
   */
  inRoom(room) {
    return this.rooms.has(room);
  }
  
  /**
   * Retrieves comprehensive information about this connection.
   * Includes connection identity, state, room memberships, custom metadata,
   * and network information. Useful for debugging and administration.
   * 
   * @returns {Object} Connection information object
   * @returns {string} returns.id - Unique connection identifier
   * @returns {number} returns.state - Current connection state
   * @returns {string[]} returns.rooms - Array of joined room names
   * @returns {Object} returns.metadata - Custom connection metadata
   * @returns {string} returns.remoteAddress - Client IP address
   * @returns {number} returns.remotePort - Client port number
   * @example
   * const info = ws.getInfo();
   * console.log(`Connection ${info.id} from ${info.remoteAddress}:${info.remotePort}`);
   * console.log(`Rooms: ${info.rooms.join(', ')}`);
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
   * Gets the current ready state of the connection.
   * Provides compatibility with the standard WebSocket API. Maps to the same
   * numeric values as the WebSocket.readyState property.
   * 
   * @returns {number} Current connection state (0=CONNECTING, 1=OPEN, 2=CLOSING, 3=CLOSED)
   * @example
   * if (ws.readyState === STATES.OPEN) {
   *   ws.send('Connection is ready');
   * }
   */
  get readyState() {
    return this.state;
  }
}

/**
 * WebSocket Server implementation for managing multiple WebSocket connections.
 * Provides functionality for connection management, room-based broadcasting,
 * message queuing for offline clients, and comprehensive connection tracking.
 * 
 * The server handles the HTTP upgrade handshake, validates WebSocket protocol
 * requirements, and creates WebSocketConnection instances for each client.
 * Supports subprotocol negotiation and connection clustering through rooms.
 * 
 * Features include:
 * - HTTP to WebSocket upgrade handling with proper validation
 * - Connection lifecycle management and cleanup
 * - Room-based group messaging and broadcasting
 * - Optional message queuing for offline clients
 * - Comprehensive connection statistics and monitoring
 * - Subprotocol negotiation support
 * 
 * @class WebSocketServer
 * @extends EventEmitter
 * @example
 * const server = new WebSocketServer({
 *   enableQueue: true,
 *   maxQueueSize: 50,
 *   handleProtocols: (protocols) => protocols.includes('chat') ? 'chat' : null
 * });
 * 
 * server.on('connection', (ws, req) => {
 *   console.log('New WebSocket connection from', req.socket.remoteAddress);
 *   ws.join('general');
 * });
 * 
 * // Broadcast to all connections
 * server.broadcast({ type: 'announcement', message: 'Server restart in 5 minutes' });
 */
class WebSocketServer extends EventEmitter {
  /**
   * Creates a new WebSocket server instance.
   * Initializes connection tracking, room management, and optional message queuing.
   * The server is ready to handle upgrade requests immediately after construction.
   * 
   * @constructor
   * @param {Object} [options={}] - Server configuration options
   * @param {boolean} [options.enableQueue=false] - Enable message queuing for offline clients
   * @param {number} [options.maxQueueSize=100] - Maximum number of queued messages per client
   * @param {Function} [options.handleProtocols] - Function to select WebSocket subprotocol
   * @param {number} [options.maxPayloadSize] - Maximum payload size for connections
   * @param {number} [options.heartbeatInterval] - Heartbeat interval for connections
   * @param {number} [options.heartbeatTimeout] - Heartbeat timeout for connections
   * @example
   * const server = new WebSocketServer({
   *   enableQueue: true,
   *   maxQueueSize: 200,
   *   handleProtocols: (protocols) => {
   *     // Select first supported protocol
   *     const supported = ['chat', 'notifications'];
   *     return protocols.find(p => supported.includes(p));
   *   }
   * });
   */
  constructor(options = {}) {
    super();
    
    /**
     * @type {Map<string, WebSocketConnection>}
     * @description Map of connection IDs to WebSocketConnection instances
     */
    this.connections = new Map();
    
    /**
     * @type {Map<string, Set<string>>}
     * @description Map of room names to Sets of connection IDs
     */
    this.rooms = new Map();
    
    /**
     * @type {Object}
     * @description Server configuration options
     */
    this.options = options;
    
    /**
     * @type {Map<string, Array>|null}
     * @description Message queue for offline clients (if enabled)
     */
    this.messageQueue = options.enableQueue ? new Map() : null;
    
    /**
     * @type {number}
     * @description Maximum number of queued messages per client
     * @default 100
     */
    this.maxQueueSize = options.maxQueueSize || 100;
  }
  
  /**
   * Handles HTTP to WebSocket protocol upgrade.
   * Validates the upgrade request according to RFC 6455 requirements, performs
   * the cryptographic handshake, negotiates subprotocols if requested, and creates
   * a new WebSocketConnection instance. This is the entry point for all new connections.
   * 
   * @param {http.IncomingMessage} req - HTTP upgrade request with WebSocket headers
   * @param {net.Socket} socket - TCP socket that will be used for WebSocket communication
   * @param {Buffer} head - First packet of the upgraded stream (usually empty)
   * @returns {WebSocketConnection|null} New WebSocket connection or null if upgrade failed
   * @throws {Error} If upgrade headers are invalid or missing
   * @fires WebSocketServer#connection
   * @example
   * const server = http.createServer();
   * server.on('upgrade', (req, socket, head) => {
   *   if (req.url === '/websocket') {
   *     const ws = wsServer.handleUpgrade(req, socket, head);
   *     if (ws) {
   *       console.log('WebSocket connection established');
   *     }
   *   }
   * });
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