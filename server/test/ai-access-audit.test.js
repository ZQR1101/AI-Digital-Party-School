const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../src/config/db');
const { selectOrganizationScope } = require('../src/services/organizationAccess');
const StatisticsService = require('../src/services/statisticsService');
const ReportService = require('../src/services/reportService');
const aiRoutes = require('../src/routes/ai');
const reportsRoutes = require('../src/routes/reports');
const statisticsRoutes = require('../src/routes/admin/statistics');

const organizations = [
  { id: 1, parentId: null, name: '学校党委' },
  { id: 2, parentId: 1, name: '第一党支部' },
  { id: 3, parentId: 1, name: '第二党支部' },
  { id: 4, parentId: 2, name: '第一小组' },
  { id: 5, parentId: 3, name: '第一小组' }
];
const secretary = { userId: 8, role: 'secretary', organizationId: 2 };

test.after(() => db.end());

test('书记默认只看本组织与下级，组织名称匹配也在授权范围内', () => {
  assert.deepEqual(selectOrganizationScope(secretary, {}, organizations).orgIds, [2, 4]);
  assert.deepEqual(selectOrganizationScope(secretary, { name: '第一小组' }, organizations).orgIds, [4]);
  for (const selector of [{ id: 1 }, { id: 3 }, { name: '第二党支部' }, { id: 999 }]) {
    assert.throws(() => selectOrganizationScope(secretary, selector, organizations), { statusCode: 403 });
  }
  assert.throws(() => selectOrganizationScope(secretary, { id: ['2', '3'] }, organizations), { statusCode: 400 });
  assert.throws(() => selectOrganizationScope({ role: 'admin' }, { name: '第一小组' }, organizations), { statusCode: 400 });
});

test('缺少组织、组织循环及非管理角色都默认拒绝', () => {
  assert.throws(() => selectOrganizationScope({ ...secretary, organizationId: null }, {}, organizations), { statusCode: 403 });
  assert.throws(() => selectOrganizationScope({ ...secretary, organizationId: 88 }, {}, organizations), { statusCode: 403 });
  assert.throws(() => selectOrganizationScope({ role: 'member' }, {}, organizations), { statusCode: 403 });
  const cyclic = organizations.map(row => row.id === 1 ? { ...row, parentId: 2 } : row);
  assert.throws(() => selectOrganizationScope(secretary, {}, cyclic), { statusCode: 403 });
  assert.deepEqual(StatisticsService.buildUserScope([]), { sql: ' AND 1 = 0', params: [] });
});

test('HTTP 问数与看板使用数据库当前角色和组织，越权与降级都写入脱敏审计', async t => {
  const oldSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'local-auth-test';
  t.after(() => {
    if (oldSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = oldSecret;
  });
  const statements = [];
  const entries = [];
  t.mock.method(db, 'query', async (query, params) => {
    const sql = typeof query === 'string' ? query : query.sql;
    statements.push(sql);
    if (sql.includes('users WHERE id = ?')) {
      const current = { 8: secretary, 9: { userId: 9, role: 'member', organizationId: 2 } }[params[0]];
      return [current ? [current] : []];
    }
    if (sql === 'SELECT id, name, parentId FROM organizations') return [organizations];
    if (sql.includes('INSERT INTO ai_audit_logs')) {
      entries.push(params);
      return [{ affectedRows: 1 }];
    }
    throw new Error('访问控制之前不应执行任何业务统计');
  });
  const dashboard = t.mock.method(StatisticsService, 'getDashboard', async ({ orgIds }) => ({ orgIds }));
  t.mock.method(ReportService, 'generateReport', async (_id, trace) => {
    Object.assign(trace, {
      model: 'mock-model', promptTokens: 4, completionTokens: 2, totalTokens: 6,
      attempts: 1, modelDurationMs: 12, errorType: 'invalid_output',
      fallbackReason: 'invalid_output', resultMode: 'rules'
    });
    return { generatedBy: 'rules', score: 76 };
  });

  const app = express();
  app.use(express.json());
  app.use('/api/ai', aiRoutes);
  app.use('/api/admin/statistics', statisticsRoutes);
  app.use('/api/reports', reportsRoutes);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  async function request(path, id, body) {
    const staleToken = jwt.sign({ userId: id, role: 'admin', organizationId: 3 }, process.env.JWT_SECRET);
    return fetch('http://127.0.0.1:' + server.address().port + path, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: 'Bearer ' + staleToken, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
  }
  const forbiddenQuery = await request('/api/ai/query', 8, { message: '第二党支部本月学习完成率' });
  assert.equal(forbiddenQuery.status, 403);
  assert.ok(forbiddenQuery.headers.get('x-request-id'));
  assert.equal((await request('/api/ai/chat', 9, { scene: 'organization_query', message: '学校党委学习完成率' })).status, 403);
  assert.equal((await request('/api/ai/report/me', 10)).status, 403);
  assert.equal((await request('/api/admin/statistics?organizationId=3', 8)).status, 403);
  assert.deepEqual((await (await request('/api/admin/statistics', 8)).json()).data.orgIds, [2, 4]);
  assert.equal(dashboard.mock.callCount(), 1);

  const legacyReport = await request('/api/reports/me', 8);
  assert.equal(legacyReport.status, 200);
  assert.equal((await legacyReport.json()).data.score, 76);
  const [denied, , , fallback] = entries;
  assert.equal(denied[0], 8);
  assert.equal(denied[1], 'secretary');
  assert.equal(denied[8], forbiddenQuery.headers.get('x-request-id'));
  assert.equal(denied[16], 'forbidden');
  assert.equal(denied[3], 'query');
  assert.equal(fallback[8], legacyReport.headers.get('x-request-id'));
  assert.deepEqual(fallback.slice(10), [12, 'mock-model', 4, 2, 6, 1, 'invalid_output', 'invalid_output']);
  assert.ok(!JSON.stringify(entries).includes('第二党支部本月学习完成率'));
  assert.ok(!statements.some(sql => sql.includes('FROM learning_tasks')));
});
