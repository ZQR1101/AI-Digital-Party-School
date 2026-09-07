const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('题库列表SQL不使用未转义的MySQL保留字 usage 作为别名', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/services/questionService.js'), 'utf8');
  assert.doesNotMatch(source, /\bas usage\b/, 'usage 是 MySQL 保留字，未加反引号会导致题库列表 500');
  assert.match(source, /\bas usageCount\b/, '使用次数应使用 usageCount 别名');
});
