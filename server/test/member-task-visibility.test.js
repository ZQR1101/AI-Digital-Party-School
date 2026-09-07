const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const OrganizationService = require('../src/services/organizationService');
const TaskService = require('../src/services/taskService');

test('党员可见组织范围包含本级及全部上级', () => {
  const rows = [
    { id: 1, parentId: null },
    { id: 2, parentId: 1 },
    { id: 3, parentId: 2 },
    { id: 4, parentId: 3 },
    { id: 9, parentId: 1 },
  ];
  assert.deepEqual(OrganizationService.ancestorIdsFromRows(4, rows), [4, 3, 2, 1]);
  assert.equal(OrganizationService.ancestorIdsFromRows(4, rows).includes(9), false);
});

test('党员任务查询覆盖上级组织下发的任务', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/services/taskService.js'), 'utf8');
  assert.match(source, /getAncestorIds/, '党员任务列表未按组织上级链路同步');
  assert.match(source, /organizationId IN/, '党员任务列表仍只匹配本级组织');
});

test('上级组织发布的任务应对下级党员可见', async () => {
  const id = await TaskService.create({
    title: '[test] ancestor visibility',
    contentId: 2,
    organizationId: 1,
    deadline: '2026-12-31 23:59:59',
    status: 'published',
  });
  try {
    const result = await TaskService.getUserTasks(3, { page: 1, pageSize: 50 });
    assert.ok(
      result.list.some((item) => Number(item.taskId) === Number(id)),
      '李四看不到学校党委下发的任务'
    );
  } finally {
    await TaskService.delete(id);
  }
});

test.after(async () => {
  const db = require('../src/config/db');
  await db.end();
});
