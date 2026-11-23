const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const db = require('../src/config/db');
const OrganizationService = require('../src/services/organizationService');

/**
 * 组织子树计算是数据范围授权（书记只见本组织及下级）的基础。
 * 统计服务改为"一次组织快照 + descendantIdsFromRows"后，
 * 必须保证快照算法与逐次查询版 getDescendantIds 完全等价，权限语义不变。
 */
test('descendantIdsFromRows 与 getDescendantIds 在同一组织快照上结果完全一致', async t => {
  const rows = [
    { id: 1, parentId: null },
    { id: 2, parentId: 1 },
    { id: 3, parentId: '1' },  // parentId 为字符串（历史数据兼容）
    { id: 4, parentId: 2 },
    { id: 5, parentId: 2 },
    { id: 6, parentId: 3 },
    { id: 7, parentId: 99 },   // 悬挂节点：父组织不存在
    { id: 8, parentId: 9 },    // 环状引用
    { id: 9, parentId: 8 },
  ];
  t.mock.method(db, 'query', async () => [rows]);

  for (const orgId of [1, 2, 3, 4, 5, 6, 7, 8, 9, 99, '1']) {
    const expected = await OrganizationService.getDescendantIds(orgId);
    const actual = OrganizationService.descendantIdsFromRows(orgId, rows);
    assert.deepEqual(
      actual,
      expected,
      `orgId=${orgId}: 快照算法与查询版结果不一致`
    );
  }
  // 根不存在返回空数组（组织失效 → 无任何可见范围的三态语义）
  assert.deepEqual(await OrganizationService.getDescendantIds(99), []);
  assert.deepEqual(OrganizationService.descendantIdsFromRows(99, rows), []);
  // 空快照
  assert.deepEqual(OrganizationService.descendantIdsFromRows(1, []), []);
  // 结果包含根自身且全部为数字
  const ids = OrganizationService.descendantIdsFromRows(1, rows);
  assert.ok(ids.includes(1));
  assert.ok(ids.every(id => Number.isInteger(id)));
});

test('统计服务不再逐组织全表查询组织表（N+1 已消除，防复发）', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/services/statisticsService.js'), 'utf8');
  assert.doesNotMatch(
    source,
    /getDescendantIds\s*\(/,
    '统计服务应使用组织快照 descendantIdsFromRows，不得逐个调用 getDescendantIds'
  );
  assert.match(source, /descendantIdsFromRows\(/, '统计服务应使用快照算法计算子树');
});
