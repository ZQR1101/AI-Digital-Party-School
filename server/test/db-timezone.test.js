const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('MySQL DATETIME is parsed as UTC before clients format Beijing time', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/config/db.js'), 'utf8');
  assert.match(source, /timezone:\s*['"]Z['"]/, 'MySQL driver timezone must be UTC to avoid an extra eight-hour shift');
});
