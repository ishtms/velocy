const { EventEmitter } = require('node:events');
const assert = require('node:assert/strict');
const { WebSocketConnection, WebSocketRouter, WebSocketServer, WS_STATES } = require('../lib');

class Socket extends EventEmitter {
  constructor() {
    super();
    this.destroyed = false;
    this.writes = [];
  }
  write(data, callback) { this.writes.push(Buffer.from(data)); if (callback) callback(); }
  end(data, callback) {
    if (typeof data === 'function') [data, callback] = [undefined, data];
    this.ended = true;
    if (data) this.write(data);
    if (callback) callback();
  }
  pause() { this.paused = true; }
  resume() { this.paused = false; }
  destroy() { this.destroyed = true; this.emit('close'); }
}

for (const maxPayloadSize of [-1, 1.5, Infinity]) {
  assert.throws(() => new WebSocketConnection(new Socket(), {}, { maxPayloadSize }), RangeError);
  assert.throws(() => new WebSocketServer({ maxPayloadSize }), RangeError);
}

{
  const socket = new Socket();
  const connection = new WebSocketConnection(socket, {}, { heartbeatInterval: 0 });
  assert.throws(() => connection.close(1005), RangeError);
  assert.throws(() => connection.close(1010), RangeError);
  assert.throws(() => connection.close(1000, {}), TypeError);
  connection.close(1000, '€'.repeat(100));
  assert.equal(socket.writes[0][1], socket.writes[1].length);
  assert(socket.writes[1].length <= 125);
  assert.doesNotThrow(() => new TextDecoder('utf-8', { fatal: true }).decode(socket.writes[1].subarray(2)));
  socket.destroy();
}

{
  const socket = new Socket();
  const server = new WebSocketServer();
  let received;
  server.on('connection', ws => ws.on('message', message => { received = message; }));
  const req = { headers: {
    upgrade: 'websocket', connection: 'keep-alive, Upgrade',
    'sec-websocket-version': '13',
    'sec-websocket-key': Buffer.from('1234567890123456').toString('base64')
  } };
  server.handleUpgrade(req, socket, Buffer.from([0x81, 0x82, 0, 0, 0, 0, 0x6f, 0x6b]));
  assert.equal(received, 'ok');
  socket.destroy();
}

{
  const socket = new Socket();
  const router = new WebSocketRouter();
  let received;
  router.route('/early', async ws => {
    await Promise.resolve();
    ws.on('message', message => { received = message; });
  });
  const req = { url: '/early', headers: {
    upgrade: 'websocket', connection: 'Upgrade',
    'sec-websocket-version': '13',
    'sec-websocket-key': Buffer.from('1234567890123456').toString('base64')
  } };
  router.handleUpgrade(req, socket, Buffer.from([0x81, 0x82, 0, 0, 0, 0, 0x6f, 0x6b]));
  assert.equal(socket.paused, true);
  setImmediate(() => {
    assert.equal(received, 'ok');
    assert.equal(socket.paused, false);
    socket.destroy();
  });
}

{
  const socket = new Socket();
  const router = new WebSocketRouter();
  let connection;
  router.route('/failed', () => { throw new Error('handler failed'); });
  router.wsServer.on('connection', ws => {
    connection = ws;
    ws.send = () => { throw new Error('error response failed'); };
  });
  const req = { url: '/failed', headers: {
    upgrade: 'websocket', connection: 'Upgrade',
    'sec-websocket-version': '13',
    'sec-websocket-key': Buffer.from('1234567890123456').toString('base64')
  } };
  router.handleUpgrade(req, socket, Buffer.alloc(0));
  setImmediate(() => {
    assert.equal(connection.state, WS_STATES.CLOSING);
    assert.equal(socket.ended, true);
    assert.equal(socket.paused, false);
    socket.destroy();
  });
}

{
  const socket = new Socket();
  const server = new WebSocketServer({ handleProtocols: () => 'chat\r\nX-Injected: yes' });
  const req = { headers: {
    upgrade: 'websocket', connection: 'Upgrade',
    'sec-websocket-version': '13',
    'sec-websocket-key': Buffer.from('1234567890123456').toString('base64'),
    'sec-websocket-protocol': 'chat'
  } };
  assert.equal(server.handleUpgrade(req, socket, Buffer.alloc(0)), null);
  assert.match(socket.writes[0].toString(), /^HTTP\/1\.1 400/);
}

{
  const socket = new Socket();
  const server = new WebSocketServer();
  const req = { headers: {
    upgrade: 'websocket', connection: 'Upgrade',
    'sec-websocket-version': '13',
    'sec-websocket-key': Buffer.from('1234567890123456').toString('base64'),
    'sec-websocket-protocol': 'chat,,admin'
  } };
  assert.equal(server.handleUpgrade(req, socket, Buffer.alloc(0)), null);
  assert.match(socket.writes[0].toString(), /^HTTP\/1\.1 400/);
}

{
  const socket = new Socket();
  const connection = new WebSocketConnection(socket, {}, { heartbeatInterval: 0 });
  socket.emit('data', Buffer.from([0x81, 0x81, 0, 0, 0, 0, 0xff]));
  assert.equal(connection.state, WS_STATES.CLOSING);
  assert.equal(socket.ended, true);
  assert.equal(socket.writes[1].readUInt16BE(0), 1007);
  socket.destroy();
}

{
  const socket = new Socket();
  const connection = new WebSocketConnection(socket, {}, { maxPayloadSize: 10 });
  socket.emit('data', Buffer.from([0x81, 0x01, 0x61]));
  assert.equal(connection.state, WS_STATES.CLOSING);
  assert.equal(socket.ended, true);
  assert.equal(socket.writes[1].readUInt16BE(0), 1002);
  socket.destroy();
}

{
  const socket = new Socket();
  const connection = new WebSocketConnection(socket, {}, { heartbeatInterval: 0, maxPayloadSize: 1 });
  let closeEvent;
  let closeCount = 0;
  connection.on('close', (code, reason) => { closeCount++; closeEvent = { code, reason }; });
  connection.close(1001, 'server shutdown');
  assert.equal(connection.state, WS_STATES.CLOSING);
  socket.emit('data', Buffer.from([0x88, 0x8c, 0, 0, 0, 0, 0x03, 0xe8, ...Buffer.from('peer close')]));
  assert.equal(connection.state, WS_STATES.CLOSING);
  assert.deepEqual(closeEvent, { code: 1000, reason: 'peer close' });
  assert.equal(closeCount, 1);
  assert.equal(socket.writes.length, 2, 'server close frame must not be echoed twice');
  assert.equal(socket.ended, true);
  assert.notEqual(connection.closeTimer, null);
  socket.emit('close');
  assert.equal(connection.state, WS_STATES.CLOSED);
  assert.equal(closeCount, 1);
  assert.equal(connection.closeTimer, null);
}

for (const header of [Buffer.from([0x81, 0x8b]), Buffer.from([0x81, 0xfe, 0x00, 0x80])]) {
  const socket = new Socket();
  const connection = new WebSocketConnection(socket, {}, { maxPayloadSize: 10 });
  let closed = 0;
  connection.on('close', () => closed++);
  socket.emit('data', header);
  assert.equal(connection.state, WS_STATES.CLOSING);
  assert.equal(socket.writes[1].readUInt16BE(0), 1009);
  socket.emit('data', Buffer.alloc(100));
  assert.equal(connection.buffer.length, 0);
  socket.destroy();
  assert.equal(closed, 1);
}

for (const header of [
  Buffer.from([0x89, 0xfe, 0x00, 0x7e, 0, 0, 0, 0]),
  Buffer.from([0x89, 0xff, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0])
]) {
  const socket = new Socket();
  const connection = new WebSocketConnection(socket, {}, { heartbeatInterval: 0 });
  socket.emit('data', header);
  assert.equal(connection.state, WS_STATES.CLOSING);
  assert.equal(socket.writes[1].readUInt16BE(0), 1002);
  socket.destroy();
}

for (const header of [Buffer.from([0xc1, 0x80]), Buffer.from([0x09, 0x80]), Buffer.from([0x89, 0xfe]), Buffer.from([0x83, 0x80])]) {
  const socket = new Socket();
  const connection = new WebSocketConnection(socket, {}, { maxPayloadSize: 2048 });
  socket.emit('data', header);
  assert.equal(connection.state, WS_STATES.CLOSING);
  assert.equal(socket.writes[1].readUInt16BE(0), 1002);
  socket.destroy();
}

for (const header of [Buffer.from([0x81, 0xfe, 0, 125]), Buffer.from([0x81, 0xff, 0x80, 0, 0, 0, 0, 0, 0, 0])]) {
  const socket = new Socket();
  const connection = new WebSocketConnection(socket, {}, { maxPayloadSize: 2048 });
  for (const byte of header) socket.emit('data', Buffer.from([byte]));
  assert.equal(connection.state, WS_STATES.CLOSING);
  assert.equal(socket.writes[1].readUInt16BE(0), 1002);
  socket.destroy();
}

for (const payloadLength of [126, 65536]) {
  const socket = new Socket();
  const connection = new WebSocketConnection(socket, {}, { maxPayloadSize: payloadLength });
  const mask = Buffer.alloc(4);
  const header = payloadLength < 126
    ? Buffer.from([0x82, 0x80 | payloadLength])
    : payloadLength < 65536
      ? Buffer.from([0x82, 0xfe, payloadLength >>> 8, payloadLength & 0xff])
      : Buffer.from([0x82, 0xff, 0, 0, 0, 0, 0, 1, 0, 0]);
  socket.emit('data', Buffer.concat([header, mask, Buffer.alloc(payloadLength)]));
  assert.equal(connection.state, WS_STATES.OPEN);
  socket.destroy();
}

for (const payload of [Buffer.from([0x03]), Buffer.from([0x03, 0xed]), Buffer.from([0x03, 0xe8, 0xff])]) {
  const socket = new Socket();
  const connection = new WebSocketConnection(socket, {}, { heartbeatInterval: 0 });
  const mask = Buffer.from([0, 0, 0, 0]);
  socket.emit('data', Buffer.concat([Buffer.from([0x88, 0x80 | payload.length]), mask, payload]));
  assert.equal(connection.state, WS_STATES.CLOSING);
  socket.destroy();
}

{
  const socket = new Socket();
  const connection = new WebSocketConnection(socket, {}, { maxPayloadSize: 10 });
  // Two masked fragments, each under the limit but together over it.
  socket.emit('data', Buffer.from([0x01, 0x86, 0, 0, 0, 0, 1, 2, 3, 4, 5, 6]));
  socket.emit('data', Buffer.from([0x80, 0x86, 0, 0, 0, 0, 1, 2, 3, 4, 5, 6]));
  assert.equal(connection.state, WS_STATES.CLOSING);
  assert.equal(socket.writes[1].readUInt16BE(0), 1009);
  assert.equal(connection.fragments.length, 0);
  socket.destroy();
}

{
  const socket = new Socket();
  const connection = new WebSocketConnection(socket, {}, { maxPayloadSize: 2048 });
  const messages = [];
  connection.on('message', message => messages.push(message));
  const frame = Buffer.concat([Buffer.from([0x81, 0xfe, 0x04, 0x00, 0, 0, 0, 0]), Buffer.alloc(1024, 0x61)]);
  for (const byte of frame) socket.emit('data', Buffer.from([byte]));
  assert.deepEqual(messages, ['a'.repeat(1024)]);
  assert.equal(connection.buffer.length, 0);
  socket.destroy();
}

{
  const socket = new Socket();
  const connection = new WebSocketConnection(socket, {}, { maxPayloadSize: 2048 });
  const first = Buffer.from([0x01, 0x81, 0, 0, 0, 0, 0x61]);
  const next = Buffer.from([0x00, 0x81, 0, 0, 0, 0, 0x61]);
  socket.emit('data', first);
  for (let i = 1; i < 1024; i++) socket.emit('data', next);
  assert.equal(connection.state, WS_STATES.OPEN);
  socket.emit('data', next);
  assert.equal(connection.state, WS_STATES.CLOSING);
  assert.equal(socket.writes[1].readUInt16BE(0), 1009);
  socket.destroy();
}

{
  const socket = new Socket();
  const connection = new WebSocketConnection(socket, {}, { maxPayloadSize: 2048 });
  let retained;
  connection.on('message', (message, binary) => { if (binary && !retained) retained = message; });
  socket.emit('data', Buffer.from([0x82, 0x83, 0, 0, 0, 0, 1, 2, 3, 0x82, 0xfe, 0x04, 0x00, 0, 0, 0, 0]));
  socket.emit('data', Buffer.alloc(1024, 7));
  assert.deepEqual(retained, Buffer.from([1, 2, 3]));
  socket.destroy();
}
