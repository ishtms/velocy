const { Router, createServer } = require('../lib');

// Create router instance with WebSocket options
const router = new Router({
  websocket: {
    heartbeatInterval: 30000,  // Send ping every 30 seconds
    heartbeatTimeout: 60000,   // Close connection if no pong in 60 seconds
    maxPayloadSize: 10 * 1024 * 1024,  // 10MB max message size
    enableQueue: true,  // Enable message queuing for offline clients
    maxQueueSize: 100   // Max 100 queued messages per client
  }
});

// HTTP routes
router.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Velocy WebSocket Demo</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 20px; }
        .container { max-width: 800px; margin: 0 auto; }
        .message-box { border: 1px solid #ccc; padding: 10px; margin: 10px 0; min-height: 200px; max-height: 400px; overflow-y: auto; }
        .input-group { display: flex; gap: 10px; margin: 10px 0; }
        input, button { padding: 10px; }
        input { flex: 1; }
        .status { padding: 10px; background: #f0f0f0; border-radius: 5px; margin: 10px 0; }
        .connected { background: #d4f4dd; }
        .disconnected { background: #f4d4d4; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>Velocy WebSocket Demo</h1>
        
        <div class="status" id="status">Disconnected</div>
        
        <h2>Chat Room</h2>
        <div class="input-group">
          <input type="text" id="roomInput" placeholder="Enter room name" value="general">
          <button onclick="joinRoom()">Join Room</button>
          <button onclick="leaveRoom()">Leave Room</button>
        </div>
        
        <div class="message-box" id="messages"></div>
        
        <div class="input-group">
          <input type="text" id="messageInput" placeholder="Type a message..." onkeypress="if(event.key==='Enter')sendMessage()">
          <button onclick="sendMessage()">Send</button>
        </div>
        
        <h3>Actions</h3>
        <button onclick="connectWS()">Connect</button>
        <button onclick="disconnectWS()">Disconnect</button>
        <button onclick="sendBroadcast()">Send Broadcast</button>
        <button onclick="sendPing()">Send Ping</button>
      </div>
      
      <script>
        let ws = null;
        let currentRoom = null;
        
        function connectWS() {
          if (ws && ws.readyState === WebSocket.OPEN) {
            addMessage('Already connected', 'system');
            return;
          }
          
          const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
          ws = new WebSocket(protocol + '//' + window.location.host + '/ws/chat');
          
          ws.onopen = () => {
            updateStatus('Connected', true);
            addMessage('Connected to WebSocket server', 'system');
          };
          
          ws.onmessage = (event) => {
            try {
              const data = JSON.parse(event.data);
              handleMessage(data);
            } catch (e) {
              addMessage('Received: ' + event.data, 'server');
            }
          };
          
          ws.onclose = () => {
            updateStatus('Disconnected', false);
            addMessage('Disconnected from server', 'system');
            currentRoom = null;
          };
          
          ws.onerror = (error) => {
            addMessage('WebSocket error: ' + error, 'error');
          };
        }
        
        function disconnectWS() {
          if (ws) {
            ws.close();
            ws = null;
          }
        }
        
        function sendMessage() {
          const input = document.getElementById('messageInput');
          const message = input.value.trim();
          
          if (!message) return;
          if (!ws || ws.readyState !== WebSocket.OPEN) {
            addMessage('Not connected to server', 'error');
            return;
          }
          
          ws.send(JSON.stringify({
            type: 'message',
            room: currentRoom,
            text: message
          }));
          
          input.value = '';
        }
        
        function joinRoom() {
          const roomName = document.getElementById('roomInput').value.trim();
          if (!roomName) return;
          
          if (!ws || ws.readyState !== WebSocket.OPEN) {
            addMessage('Not connected to server', 'error');
            return;
          }
          
          ws.send(JSON.stringify({
            type: 'join',
            room: roomName
          }));
          
          currentRoom = roomName;
          addMessage('Joining room: ' + roomName, 'system');
        }
        
        function leaveRoom() {
          if (!currentRoom) {
            addMessage('Not in any room', 'error');
            return;
          }
          
          if (!ws || ws.readyState !== WebSocket.OPEN) {
            addMessage('Not connected to server', 'error');
            return;
          }
          
          ws.send(JSON.stringify({
            type: 'leave',
            room: currentRoom
          }));
          
          addMessage('Leaving room: ' + currentRoom, 'system');
          currentRoom = null;
        }
        
        function sendBroadcast() {
          if (!ws || ws.readyState !== WebSocket.OPEN) {
            addMessage('Not connected to server', 'error');
            return;
          }
          
          ws.send(JSON.stringify({
            type: 'broadcast',
            text: 'Hello everyone!'
          }));
        }
        
        function sendPing() {
          if (!ws || ws.readyState !== WebSocket.OPEN) {
            addMessage('Not connected to server', 'error');
            return;
          }
          
          ws.send(JSON.stringify({
            type: 'ping'
          }));
          addMessage('Sent ping to server', 'system');
        }
        
        function handleMessage(data) {
          switch (data.type) {
            case 'message':
              addMessage(data.from + ': ' + data.text, 'message');
              break;
            case 'joined':
              addMessage(data.user + ' joined ' + data.room, 'system');
              break;
            case 'left':
              addMessage(data.user + ' left ' + data.room, 'system');
              break;
            case 'broadcast':
              addMessage('[Broadcast] ' + data.text, 'broadcast');
              break;
            case 'pong':
              addMessage('Received pong from server', 'system');
              break;
            case 'error':
              addMessage('Error: ' + data.message, 'error');
              break;
            default:
              addMessage('Unknown message type: ' + JSON.stringify(data), 'server');
          }
        }
        
        function addMessage(text, type = 'message') {
          const messagesDiv = document.getElementById('messages');
          const messageDiv = document.createElement('div');
          messageDiv.style.padding = '5px';
          messageDiv.style.borderRadius = '3px';
          messageDiv.style.marginBottom = '5px';
          
          switch(type) {
            case 'system':
              messageDiv.style.background = '#f0f0f0';
              messageDiv.style.fontStyle = 'italic';
              break;
            case 'error':
              messageDiv.style.background = '#ffe0e0';
              messageDiv.style.color = '#cc0000';
              break;
            case 'broadcast':
              messageDiv.style.background = '#e0f0ff';
              break;
            case 'message':
              messageDiv.style.background = '#f9f9f9';
              break;
          }
          
          messageDiv.textContent = '[' + new Date().toLocaleTimeString() + '] ' + text;
          messagesDiv.appendChild(messageDiv);
          messagesDiv.scrollTop = messagesDiv.scrollHeight;
        }
        
        function updateStatus(text, connected) {
          const statusDiv = document.getElementById('status');
          statusDiv.textContent = text;
          statusDiv.className = 'status ' + (connected ? 'connected' : 'disconnected');
        }
        
        // Auto-connect on page load
        window.onload = () => {
          connectWS();
        };
      </script>
    </body>
    </html>
  `);
});

// WebSocket route for chat
router.ws('/ws/chat', (ws, req) => {
  // Generate unique user ID
  const userId = 'user_' + Math.random().toString(36).substr(2, 9);
  ws.metadata.userId = userId;
  
  console.log(`WebSocket connection established: ${userId}`);
  
  // Send welcome message
  ws.send(JSON.stringify({
    type: 'message',
    from: 'Server',
    text: `Welcome! Your ID is ${userId}`
  }));
  
  // Handle incoming messages
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data);
      
      switch (message.type) {
        case 'join':
          handleJoinRoom(ws, message.room);
          break;
          
        case 'leave':
          handleLeaveRoom(ws, message.room);
          break;
          
        case 'message':
          handleChatMessage(ws, message);
          break;
          
        case 'broadcast':
          handleBroadcast(ws, message);
          break;
          
        case 'ping':
          ws.send(JSON.stringify({ type: 'pong' }));
          break;
          
        default:
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Unknown message type'
          }));
      }
    } catch (err) {
      console.error('Error processing message:', err);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Invalid message format'
      }));
    }
  });
  
  // Handle disconnection
  ws.on('close', () => {
    console.log(`WebSocket disconnected: ${userId}`);
    
    // Notify rooms that user left
    for (const room of ws.rooms) {
      router.room(room).broadcast(JSON.stringify({
        type: 'left',
        user: userId,
        room: room
      }), { except: ws.id });
    }
  });
  
  // Handle errors
  ws.on('error', (err) => {
    console.error(`WebSocket error for ${userId}:`, err);
  });
});

// Helper functions for chat functionality
function handleJoinRoom(ws, room) {
  if (!room) {
    ws.send(JSON.stringify({
      type: 'error',
      message: 'Room name required'
    }));
    return;
  }
  
  ws.join(room);
  
  // Notify others in room
  router.room(room).broadcast(JSON.stringify({
    type: 'joined',
    user: ws.metadata.userId,
    room: room
  }), { except: ws.id });
  
  // Confirm to user
  ws.send(JSON.stringify({
    type: 'message',
    from: 'Server',
    text: `You joined room: ${room}`
  }));
}

function handleLeaveRoom(ws, room) {
  if (!room || !ws.inRoom(room)) {
    ws.send(JSON.stringify({
      type: 'error',
      message: 'Not in that room'
    }));
    return;
  }
  
  ws.leave(room);
  
  // Notify others in room
  router.room(room).broadcast(JSON.stringify({
    type: 'left',
    user: ws.metadata.userId,
    room: room
  }));
  
  // Confirm to user
  ws.send(JSON.stringify({
    type: 'message',
    from: 'Server',
    text: `You left room: ${room}`
  }));
}

function handleChatMessage(ws, message) {
  if (!message.room) {
    ws.send(JSON.stringify({
      type: 'error',
      message: 'Please join a room first'
    }));
    return;
  }
  
  if (!ws.inRoom(message.room)) {
    ws.send(JSON.stringify({
      type: 'error',
      message: `You are not in room: ${message.room}`
    }));
    return;
  }
  
  // Broadcast message to room
  router.room(message.room).broadcast(JSON.stringify({
    type: 'message',
    from: ws.metadata.userId,
    text: message.text,
    room: message.room
  }));
}

function handleBroadcast(ws, message) {
  // Broadcast to all connected clients
  router.broadcast(JSON.stringify({
    type: 'broadcast',
    from: ws.metadata.userId,
    text: message.text || 'Hello everyone!'
  }));
}

// WebSocket route with parameters
router.ws('/ws/room/:roomId', (ws, req) => {
  const roomId = req.params.roomId;
  
  // Auto-join the room from URL
  ws.join(roomId);
  
  ws.send(JSON.stringify({
    type: 'message',
    from: 'Server',
    text: `You joined room ${roomId} via direct URL`
  }));
  
  ws.on('message', (data) => {
    // Broadcast to room
    router.room(roomId).broadcast(data);
  });
});

// WebSocket route for notifications
router.ws('/ws/notifications', (ws, req) => {
  // Send periodic notifications
  const notificationInterval = setInterval(() => {
    if (ws.state === 1) { // OPEN state
      ws.send(JSON.stringify({
        type: 'notification',
        timestamp: new Date().toISOString(),
        message: 'Server time update'
      }));
    }
  }, 10000); // Every 10 seconds
  
  ws.on('close', () => {
    clearInterval(notificationInterval);
  });
});

// Create and start server
const server = createServer(router);
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`WebSocket endpoints:`);
  console.log(`  - ws://localhost:${PORT}/ws/chat (main chat)`);
  console.log(`  - ws://localhost:${PORT}/ws/room/:roomId (direct room access)`);
  console.log(`  - ws://localhost:${PORT}/ws/notifications (server notifications)`);
});