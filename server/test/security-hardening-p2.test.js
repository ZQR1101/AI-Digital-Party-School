// P2 加固回归：首页真实统计接口 + 后台服务端分页/筛选改造 + CI
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '../..');

test('首页统计：streak/weekHours 来自接口而非硬编码', () => {
  const home = fs.readFileSync(path.join(ROOT, 'src-qianduan/Home-index.vue'), 'utf8');
  assert.doesNotMatch(home, /const streak = 12/, '不得硬编码连续天数');
  assert.doesNotMatch(home, /0\.8 \+ 2\.1/, '不得用假公式计算本周时长');
  assert.match(home, /getHomeSummary/, '首页未调用真实统计接口');
  const api = fs.readFileSync(path.join(ROOT, 'src-qianduan/api/report.js'), 'utf8');
  assert.match(api, /\/reports\/summary/);
  const routes = fs.readFileSync(path.join(ROOT, 'server/src/routes/reports.js'), 'utf8');
  assert.match(routes, /router\.get\('\/summary'/);
});

test('首页统计服务：按学习记录计算连续天数与本周时长', async t => {
  const db = require('../src/config/db');
  const HomeSummaryService = require('../src/services/homeSummaryService');
  const now = new Date();
  const dayKey = n => new Date(now.getTime() - n * 86400000).toISOString();
  t.mock.method(db, 'query', async () => [[
    { studySeconds: 3600, status: 'completed', updatedAt: dayKey(0) },
    { studySeconds: 1800, status: 'inProgress', updatedAt: dayKey(1) },
    { studySeconds: 600, status: 'completed', updatedAt: dayKey(2) }
  ]]);
  const summary = await HomeSummaryService.getSummary(1);
  assert.equal(summary.streak, 3);
  assert.ok(summary.weekHours >= 1.5);
  assert.equal(summary.completedCount, 2);
  assert.equal(summary.pendingCount, 1);
});

test('后台内容/任务页：改为服务端分页，不再一次性拉取全量', () => {
  const contents = fs.readFileSync(path.join(ROOT, 'admin/src/views/ContentsView.vue'), 'utf8');
  assert.doesNotMatch(contents, /pageSize: 100 /, '内容页仍一次性拉 100 条');
  assert.match(contents, /page: currentPage\.value/);
  assert.match(contents, /:total="total"/);
  assert.match(contents, /@current-change="loadContents"/);

  const tasks = fs.readFileSync(path.join(ROOT, 'admin/src/views/TasksView.vue'), 'utf8');
  // 主列表请求必须使用服务端分页；loadOptions 的下拉选项保留固定上限可接受
  const loadTasksBody = tasks.slice(tasks.indexOf('async function loadTasks'), tasks.indexOf('async function loadOptions'));
  assert.doesNotMatch(loadTasksBody, /pageSize: 200/, '任务主列表仍一次性拉 200 条');
  assert.match(tasks, /page: currentPage\.value/);
  assert.match(tasks, /:total="total"/);
  assert.match(tasks, /@current-change="loadTasks"/);
});

test('后端内容列表支持分类筛选与状态值映射', () => {
  const service = fs.readFileSync(path.join(ROOT, 'server/src/services/contentService.js'), 'utf8');
  assert.match(service, /category/);
  assert.match(service, /offShelf.*offlined/);
});

test('CI 工作流覆盖后端测试、两端构建与安全扫描', () => {
  const ci = fs.readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8');
  assert.match(ci, /npm test/);
  assert.match(ci, /npm run build/);
  assert.match(ci, /npm audit/);
  assert.match(ci, /secret-scan/);
});
