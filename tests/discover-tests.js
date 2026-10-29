const fs = require('node:fs');

module.exports = function discoverTests(directory) {
  return fs.readdirSync(directory)
    .filter(file => file.startsWith('test-') && file.endsWith('.js') && file !== 'test-helper.js')
    .sort();
};
