const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const discoverTests = require('./discover-tests');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'velocy-discovery-'));
try {
  assert.deepEqual(discoverTests(directory), []);
  for (const name of ['test-z.js', 'test-a.js', 'test-helper.js', 'other.js', 'test-c.txt']) {
    fs.writeFileSync(path.join(directory, name), '');
  }
  fs.mkdirSync(path.join(directory, 'nested'));
  fs.writeFileSync(path.join(directory, 'nested', 'test-hidden.js'), '');
  assert.deepEqual(discoverTests(directory), ['test-a.js', 'test-z.js']);
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
