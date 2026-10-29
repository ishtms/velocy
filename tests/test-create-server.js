const assert = require('node:assert/strict');
const { Router, createServer } = require('../lib');

const server = createServer(new Router(), { headersTimeout: 12345, requestTimeout: 23456 });
assert.equal(server.headersTimeout, 12345);
assert.equal(server.requestTimeout, 23456);
