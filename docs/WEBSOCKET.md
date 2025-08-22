# Velocy WebSocket Support

Comprehensive WebSocket support for the Velocy framework, built using only Node.js built-in modules.

## Features

- **RFC 6455 Compliant**: Full WebSocket protocol implementation
- **Zero Dependencies**: Uses only Node.js built-in modules
- **Routing System**: Path-based WebSocket routing with parameters
- **Room/Channel Support**: Group connections for targeted messaging
- **Broadcasting**: Efficient message distribution to multiple clients
- **Heartbeat/Ping-Pong**: Automatic connection health monitoring
- **Message Queuing**: Optional queuing for offline clients
- **Binary & Text Support**: Handle both message types
- **Auto-reconnection**: Client-side reconnection utilities

## Quick Start

```javascript
const { Router, createServer } = require('velocy');

const router = new Router();

// Simple WebSocket route
router.ws('/ws/echo', (ws, req) => {
  ws.on('message', (data) => {
    ws.send(`Echo: ${data}`);
  });
});

const server = createServer(router);
server.listen(3000);
```

## WebSocket Routes

### Basic Route

```javascript
router.ws('/ws/chat', (ws, req) => {
  console.log('New WebSocket connection');
  
  ws.on('message', (data) => {
    console.log('Received:', data);
    ws.send('Message received');
  });
  
  ws.on('close', () => {
    console.log('Connection closed');
  });
});
```

### Parameterized Routes

```javascript
router.ws('/ws/user/:userId', (ws, req) => {
  const userId = req.params.userId;
  console.log(`User ${userId} connected`);
  
  ws.metadata.userId = userId;
});
```

### Middleware Support

```javascript
// WebSocket middleware
router.ws('/ws/protected', 
  // Authentication middleware
  (ws, req, next) => {
    const token = req.query.token;
    if (!token) {
      ws.close(1008, 'Unauthorized');
      return;
    }
    ws.metadata.authenticated = true;
    next();
  },
  // Main handler
  (ws, req) => {
    ws.send('Welcome to protected endpoint');
  }
);
```

## Room Management

### Joining and Leaving Rooms

```javascript
router.ws('/ws/chat', (ws, req) => {
  // Join a room
  ws.join('general');
  
  // Check if in room
  if (ws.inRoom('general')) {
    console.log('User is in general room');
  }
  
  // Leave a room
  ws.leave('general');
  
  // Join multiple rooms
  ws.join('room1');
  ws.join('room2');
  
  // Get all rooms
  console.log('User rooms:', Array.from(ws.rooms));
});
```

### Broadcasting to Rooms

```javascript
// Broadcast to specific room
router.room('general').broadcast({
  type: 'announcement',
  message: 'Server maintenance in 5 minutes'
});

// Broadcast to room except sender
router.room('general').broadcast(data, {
  except: ws.id
});

// Get room statistics
const roomSize = router.room('general').size();
const connections = router.room('general').getConnections();
```

## Broadcasting

### Global Broadcast

```javascript
// Broadcast to all WebSocket connections
router.broadcast({
  type: 'system',
  message: 'Server announcement'
});

// Broadcast with exceptions
router.broadcast(data, {
  except: [ws1.id, ws2.id]
});
```

### Route-specific Broadcast

```javascript
// Broadcast to all connections on a specific route
router.to('/ws/chat').broadcast({
  type: 'route-message',
  data: 'Hello chat users'
});
```

## Connection Management

### Connection Metadata

```javascript
router.ws('/ws/game', (ws, req) => {
  // Store custom metadata
  ws.metadata = {
    userId: req.query.userId,
    username: req.query.username,
    joinedAt: new Date(),
    score: 0
  };
  
  // Access metadata later
  ws.on('message', (data) => {
    console.log(`${ws.metadata.username}: ${data}`);
  });
});
```

### Connection Info

```javascript
// Get connection information
const info = ws.getInfo();
console.log(info);
// {
//   id: 'uuid-here',
//   state: 1, // OPEN
//   rooms: ['general', 'games'],
//   metadata: { ... },
//   remoteAddress: '127.0.0.1',
//   remotePort: 54321
// }
```

## Message Handling

### Text Messages

```javascript
ws.on('message', (data, isBinary) => {
  if (!isBinary) {
    // Handle text message
    const text = data; // Already a string
    console.log('Text message:', text);
    
    // Parse JSON if needed
    try {
      const json = JSON.parse(text);
      handleJsonMessage(json);
    } catch (e) {
      // Handle plain text
    }
  }
});

// Send text
ws.send('Hello World');
ws.send(JSON.stringify({ type: 'chat', message: 'Hello' }));
```

### Binary Messages

```javascript
ws.on('message', (data, isBinary) => {
  if (isBinary) {
    // Handle binary message
    const buffer = data; // Buffer instance
    console.log('Binary message:', buffer.length, 'bytes');
  }
});

// Send binary
ws.sendBinary(Buffer.from([1, 2, 3, 4]));
ws.sendBinary(Buffer.from('Hello', 'utf8'));
```

## Heartbeat & Health Monitoring

### Configuration

```javascript
const router = new Router({
  websocket: {
    heartbeatInterval: 30000,  // Send ping every 30 seconds
    heartbeatTimeout: 60000,   // Close if no pong within 60 seconds
    maxPayloadSize: 10 * 1024 * 1024  // 10MB max message size
  }
});
```

### Manual Ping/Pong

```javascript
// Send ping
ws.ping();
ws.ping('optional-data');

// Handle pong
ws.on('pong', (data) => {
  console.log('Received pong:', data);
});

// Send pong (usually automatic)
ws.pong();
```

## Error Handling

### Connection-level Errors

```javascript
ws.on('error', (error) => {
  console.error('WebSocket error:', error);
});

// Close with error code
ws.close(1011, 'Internal server error');
```

### Router-level Error Handling

```javascript
const wsRouter = router.getWebSocketRouter();

wsRouter.error((error, ws, context) => {
  console.error('WebSocket error:', error);
  
  // Send error to client
  ws.send(JSON.stringify({
    type: 'error',
    message: error.message
  }));
  
  // Log with context
  console.log('Error context:', {
    route: context.route,
    params: context.params,
    userId: ws.metadata.userId
  });
});
```

## Message Queuing

### Enable Message Queuing

```javascript
const router = new Router({
  websocket: {
    enableQueue: true,
    maxQueueSize: 100  // Max messages per client
  }
});
```

### Queue Messages for Offline Clients

```javascript
// Messages sent to disconnected clients are queued
router.getWebSocketRouter().wsServer.sendTo(clientId, {
  type: 'notification',
  message: 'You have a new message'
});

// When client reconnects, queued messages are delivered automatically
```

## WebSocket Options

### Router Configuration

```javascript
const router = new Router({
  websocket: {
    // Heartbeat configuration
    heartbeatInterval: 30000,     // Ping interval (ms)
    heartbeatTimeout: 60000,      // Timeout for pong (ms)
    
    // Message limits
    maxPayloadSize: 104857600,    // Max message size (100MB)
    
    // Message queuing
    enableQueue: true,             // Enable offline message queue
    maxQueueSize: 100,            // Max queued messages per client
    
    // Protocol negotiation
    handleProtocols: (protocols) => {
      // Select subprotocol
      if (protocols.includes('chat')) {
        return 'chat';
      }
      return null;
    }
  }
});
```

### Runtime Configuration

```javascript
// Update WebSocket options at runtime
router.configureWebSocket({
  heartbeatInterval: 60000,
  maxPayloadSize: 50 * 1024 * 1024
});
```

## Statistics & Monitoring

```javascript
// Get server statistics
const stats = router.getWebSocketRouter().getStats();
console.log(stats);
// {
//   connections: 42,
//   rooms: 5,
//   routes: 3,
//   queuedMessages: 12
// }

// Get specific room stats
const roomStats = {
  name: 'general',
  size: router.room('general').size(),
  connections: router.room('general').getConnections().length
};
```

## Closing Connections

### Individual Connection

```javascript
// Normal close
ws.close();

// Close with code and reason
ws.close(1000, 'Normal closure');

// Common close codes
ws.close(1001, 'Going away');
ws.close(1002, 'Protocol error');
ws.close(1003, 'Unsupported data');
ws.close(1008, 'Policy violation');
ws.close(1011, 'Internal error');
```

### Mass Closure

```javascript
// Close all connections
router.getWebSocketRouter().closeAll(1001, 'Server shutdown');

// Close all in a room
router.room('general').getConnections().forEach(ws => {
  ws.close(1000, 'Room closed');
});
```

## Client-Side Utilities

### Auto-Reconnecting WebSocket

```javascript
// Note: This is a utility class for documentation
// In practice, use a WebSocket client library for Node.js

const { ReconnectingWebSocket } = require('velocy').websocketUtils;

const ws = new ReconnectingWebSocket('ws://localhost:3000/ws/chat', {
  reconnectInterval: 1000,
  maxReconnectInterval: 30000,
  reconnectDecay: 1.5,
  maxReconnectAttempts: null, // Infinite
  
  onopen: () => console.log('Connected'),
  onclose: (e) => console.log('Disconnected'),
  onerror: (e) => console.error('Error:', e),
  onmessage: (e) => console.log('Message:', e.data)
});
```

## Example: Complete Chat Application

```javascript
const { Router, createServer } = require('velocy');

const router = new Router({
  websocket: {
    heartbeatInterval: 30000,
    enableQueue: true
  }
});

// Track users
const users = new Map();

router.ws('/ws/chat', (ws, req) => {
  const userId = generateUserId();
  const username = req.query.username || `User${userId}`;
  
  // Store user info
  users.set(ws.id, { userId, username });
  ws.metadata = { userId, username };
  
  // Join default room
  ws.join('lobby');
  
  // Announce join
  router.room('lobby').broadcast({
    type: 'user-joined',
    username,
    timestamp: Date.now()
  }, { except: ws.id });
  
  // Handle messages
  ws.on('message', (data) => {
    const message = JSON.parse(data);
    
    switch (message.type) {
      case 'chat':
        router.room(message.room || 'lobby').broadcast({
          type: 'chat',
          from: username,
          text: message.text,
          timestamp: Date.now()
        });
        break;
        
      case 'join-room':
        ws.join(message.room);
        ws.send(JSON.stringify({
          type: 'joined-room',
          room: message.room
        }));
        break;
        
      case 'leave-room':
        ws.leave(message.room);
        break;
        
      case 'private-message':
        const recipient = findUserByUsername(message.to);
        if (recipient) {
          router.getWebSocketRouter().wsServer.sendTo(recipient.id, {
            type: 'private-message',
            from: username,
            text: message.text
          });
        }
        break;
    }
  });
  
  // Handle disconnect
  ws.on('close', () => {
    users.delete(ws.id);
    
    router.room('lobby').broadcast({
      type: 'user-left',
      username,
      timestamp: Date.now()
    });
  });
});

function generateUserId() {
  return Math.random().toString(36).substr(2, 9);
}

function findUserByUsername(username) {
  for (const [id, user] of users) {
    if (user.username === username) {
      return { id, ...user };
    }
  }
  return null;
}

const server = createServer(router);
server.listen(3000, () => {
  console.log('Chat server running on ws://localhost:3000/ws/chat');
});
```

## WebSocket Constants

```javascript
const { WS_OPCODES, WS_CLOSE_CODES, WS_STATES } = require('velocy');

// Opcodes
WS_OPCODES.TEXT       // 0x1
WS_OPCODES.BINARY     // 0x2
WS_OPCODES.CLOSE      // 0x8
WS_OPCODES.PING       // 0x9
WS_OPCODES.PONG       // 0xa

// Connection states
WS_STATES.CONNECTING  // 0
WS_STATES.OPEN        // 1
WS_STATES.CLOSING     // 2
WS_STATES.CLOSED      // 3

// Close codes
WS_CLOSE_CODES.NORMAL              // 1000
WS_CLOSE_CODES.GOING_AWAY          // 1001
WS_CLOSE_CODES.PROTOCOL_ERROR      // 1002
WS_CLOSE_CODES.UNSUPPORTED_DATA    // 1003
WS_CLOSE_CODES.INVALID_FRAME_PAYLOAD // 1007
WS_CLOSE_CODES.POLICY_VIOLATION    // 1008
WS_CLOSE_CODES.MESSAGE_TOO_BIG     // 1009
WS_CLOSE_CODES.INTERNAL_ERROR      // 1011
```

## Performance Considerations

1. **Message Batching**: Combine multiple small messages when possible
2. **Binary Format**: Use binary messages for large data transfers
3. **Room Limits**: Monitor room sizes for broadcast performance
4. **Heartbeat Tuning**: Adjust intervals based on network conditions
5. **Payload Limits**: Set appropriate maxPayloadSize for your use case
6. **Connection Limits**: Implement connection throttling if needed

## Security Best Practices

1. **Authentication**: Validate tokens/credentials during handshake
2. **Origin Validation**: Check Origin header for CORS
3. **Rate Limiting**: Implement message rate limiting
4. **Input Validation**: Validate all incoming messages
5. **SSL/TLS**: Use wss:// in production
6. **Message Size**: Enforce reasonable payload limits
7. **Room Access**: Implement room authorization logic

## Browser Client Example

```html
<!DOCTYPE html>
<html>
<head>
  <title>WebSocket Client</title>
</head>
<body>
  <script>
    const ws = new WebSocket('ws://localhost:3000/ws/chat');
    
    ws.onopen = () => {
      console.log('Connected');
      ws.send(JSON.stringify({ type: 'hello' }));
    };
    
    ws.onmessage = (event) => {
      console.log('Received:', event.data);
    };
    
    ws.onerror = (error) => {
      console.error('Error:', error);
    };
    
    ws.onclose = () => {
      console.log('Disconnected');
    };
    
    // Send message
    function sendMessage(text) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'message',
          text: text
        }));
      }
    }
  </script>
</body>
</html>
```