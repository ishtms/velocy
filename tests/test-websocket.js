const { TestRunner, createTestServer, assert, assertEqual, wait } = require('./test-helper');
const { Router, WebSocketRouter, WebSocketServer } = require('../index');
const WebSocket = require('ws');

const runner = new TestRunner('WebSocket Tests');

runner.test('Should establish WebSocket connection', async () => {
  const app = new Router();
  
  app.ws('/ws', (ws, req) => {
    ws.on('message', (message) => {
      ws.send(`Echo: ${message}`);
    });
  });
  
  const server = await createTestServer(app);
  
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
    
    await new Promise((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
    });
    
    // Send a message
    ws.send('Hello WebSocket');
    
    // Wait for response
    const response = await new Promise((resolve) => {
      ws.on('message', (data) => {
        resolve(data.toString());
      });
    });
    
    assertEqual(response, 'Echo: Hello WebSocket');
    
    ws.close();
    await wait(100);
  } finally {
    await server.close();
  }
});

runner.test('Should handle multiple WebSocket clients', async () => {
  const app = new Router();
  const connections = new Set();
  
  app.ws('/broadcast', (ws, req) => {
    connections.add(ws);
    
    ws.on('message', (message) => {
      // Broadcast to all connected clients
      connections.forEach(client => {
        if (client.readyState === 1) { // OPEN state
          client.send(`Broadcast: ${message}`);
        }
      });
    });
    
    ws.on('close', () => {
      connections.delete(ws);
    });
  });
  
  const server = await createTestServer(app);
  
  try {
    // Connect two clients
    const ws1 = new WebSocket(`ws://127.0.0.1:${server.port}/broadcast`);
    const ws2 = new WebSocket(`ws://127.0.0.1:${server.port}/broadcast`);
    
    await Promise.all([
      new Promise((resolve) => ws1.on('open', resolve)),
      new Promise((resolve) => ws2.on('open', resolve))
    ]);
    
    // Set up message listeners
    const messages1 = [];
    const messages2 = [];
    
    ws1.on('message', (data) => messages1.push(data.toString()));
    ws2.on('message', (data) => messages2.push(data.toString()));
    
    // Send message from client 1
    ws1.send('Hello from client 1');
    
    await wait(100);
    
    // Both clients should receive the broadcast
    assert(messages1.length > 0, 'Client 1 should receive message');
    assert(messages2.length > 0, 'Client 2 should receive message');
    assertEqual(messages1[0], 'Broadcast: Hello from client 1');
    assertEqual(messages2[0], 'Broadcast: Hello from client 1');
    
    ws1.close();
    ws2.close();
    await wait(100);
  } finally {
    await server.close();
  }
});

runner.test('Should handle WebSocket with query parameters', async () => {
  const app = new Router();
  
  app.ws('/ws', (ws, req) => {
    const { name } = req.query;
    ws.send(`Welcome ${name || 'Guest'}`);
  });
  
  const server = await createTestServer(app);
  
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws?name=John`);
    
    const message = await new Promise((resolve, reject) => {
      ws.on('open', () => {
        ws.on('message', (data) => {
          resolve(data.toString());
        });
      });
      ws.on('error', reject);
    });
    
    assertEqual(message, 'Welcome John');
    
    ws.close();
    await wait(100);
  } finally {
    await server.close();
  }
});

runner.test('Should handle WebSocket ping/pong', async () => {
  const app = new Router();
  
  app.ws('/ws', (ws, req) => {
    let pingReceived = false;
    
    ws.on('ping', () => {
      pingReceived = true;
      ws.pong();
    });
    
    ws.on('pong', () => {
      ws.send('Pong received');
    });
    
    // Send initial ping to client
    setTimeout(() => ws.ping(), 50);
  });
  
  const server = await createTestServer(app);
  
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
    let pongReceived = false;
    
    await new Promise((resolve) => ws.on('open', resolve));
    
    ws.on('ping', () => {
      ws.pong();
      pongReceived = true;
    });
    
    await wait(150);
    
    assert(pongReceived, 'Should receive ping and send pong');
    
    ws.close();
    await wait(100);
  } finally {
    await server.close();
  }
});

runner.test('Should handle WebSocket binary data', async () => {
  const app = new Router();
  
  app.ws('/binary', (ws, req) => {
    ws.on('message', (data) => {
      // Echo binary data back
      if (Buffer.isBuffer(data)) {
        ws.send(data);
      }
    });
  });
  
  const server = await createTestServer(app);
  
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/binary`);
    
    await new Promise((resolve) => ws.on('open', resolve));
    
    // Send binary data
    const binaryData = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05]);
    ws.send(binaryData);
    
    const response = await new Promise((resolve) => {
      ws.on('message', (data) => {
        resolve(data);
      });
    });
    
    assert(Buffer.isBuffer(response), 'Should receive buffer');
    assert(Buffer.compare(binaryData, response) === 0, 'Binary data should match');
    
    ws.close();
    await wait(100);
  } finally {
    await server.close();
  }
});

runner.test('Should handle WebSocket close events', async () => {
  const app = new Router();
  let serverClosed = false;
  
  app.ws('/ws', (ws, req) => {
    ws.on('close', (code, reason) => {
      serverClosed = true;
    });
  });
  
  const server = await createTestServer(app);
  
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
    
    await new Promise((resolve) => ws.on('open', resolve));
    
    // Close with code and reason
    ws.close(1000, 'Normal closure');
    
    await wait(100);
    
    assert(serverClosed, 'Server should receive close event');
  } finally {
    await server.close();
  }
});

runner.test('Should handle WebSocket errors gracefully', async () => {
  const app = new Router();
  
  app.ws('/ws', (ws, req) => {
    ws.on('message', (message) => {
      if (message === 'error') {
        // Simulate an error
        ws.emit('error', new Error('Test error'));
      } else {
        ws.send('OK');
      }
    });
    
    ws.on('error', (err) => {
      ws.send(`Error: ${err.message}`);
    });
  });
  
  const server = await createTestServer(app);
  
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
    
    await new Promise((resolve) => ws.on('open', resolve));
    
    // Send normal message
    ws.send('hello');
    
    let response = await new Promise((resolve) => {
      ws.once('message', (data) => resolve(data.toString()));
    });
    
    assertEqual(response, 'OK');
    
    // Trigger error
    ws.send('error');
    
    response = await new Promise((resolve) => {
      ws.once('message', (data) => resolve(data.toString()));
    });
    
    assertEqual(response, 'Error: Test error');
    
    ws.close();
    await wait(100);
  } finally {
    await server.close();
  }
});

runner.test('Should handle WebSocket route parameters', async () => {
  const app = new Router();
  
  app.ws('/room/:roomId', (ws, req) => {
    const roomId = req.params.roomId;
    ws.send(`Joined room: ${roomId}`);
  });
  
  const server = await createTestServer(app);
  
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/room/lobby`);
    
    const message = await new Promise((resolve, reject) => {
      ws.on('open', () => {
        ws.on('message', (data) => {
          resolve(data.toString());
        });
      });
      ws.on('error', reject);
    });
    
    assertEqual(message, 'Joined room: lobby');
    
    ws.close();
    await wait(100);
  } finally {
    await server.close();
  }
});

runner.test('Should handle WebSocket JSON messages', async () => {
  const app = new Router();
  
  app.ws('/json', (ws, req) => {
    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message);
        ws.send(JSON.stringify({
          type: 'response',
          original: data,
          timestamp: Date.now()
        }));
      } catch (err) {
        ws.send(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
  });
  
  const server = await createTestServer(app);
  
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/json`);
    
    await new Promise((resolve) => ws.on('open', resolve));
    
    // Send JSON message
    ws.send(JSON.stringify({ action: 'test', value: 42 }));
    
    const response = await new Promise((resolve) => {
      ws.on('message', (data) => {
        resolve(JSON.parse(data.toString()));
      });
    });
    
    assertEqual(response.type, 'response');
    assertEqual(response.original.action, 'test');
    assertEqual(response.original.value, 42);
    assert(response.timestamp, 'Should have timestamp');
    
    ws.close();
    await wait(100);
  } finally {
    await server.close();
  }
});

// Run the tests
runner.run().then(success => {
  process.exit(success ? 0 : 1);
});