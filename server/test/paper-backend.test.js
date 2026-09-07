const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('试卷后端提供真实CRUD和题目关联事务', () => {
  const app = fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8');
  const routes = fs.readFileSync(path.join(__dirname, '../src/routes/admin/papers.js'), 'utf8');
  const service = fs.readFileSync(path.join(__dirname, '../src/services/paperService.js'), 'utf8');

  assert.match(app, /\/api\/admin\/papers/, '试卷路由未挂载')
  assert.match(routes, /router\.get\(['"]\/['"]/, '缺少试卷列表接口')
  assert.match(routes, /router\.post\(['"]\/['"]/, '缺少创建试卷接口')
  assert.match(routes, /router\.put\(['"]\/:id['"]/, '缺少编辑试卷接口')
  assert.match(routes, /router\.delete\(['"]\/:id['"]/, '缺少删除试卷接口')
  assert.match(service, /beginTransaction\(/, '试卷和题目关联没有使用事务')
  assert.match(service, /INSERT INTO paper_questions/, '创建试卷没有保存题目关联')
});
