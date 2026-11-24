// 组织树范围过滤：书记只读本组织子树，祖先路径必须保留（否则树形 UI 整棵为空）
const test = require('node:test');
const assert = require('node:assert');
const filterTreeByAllowedIds = require('../src/utils/orgTreeFilter');

const TREE = [
  {
    id: 1, name: '学校党委', type: 'committee',
    children: [
      {
        id: 2, name: '信息工程学院党委', type: 'committee',
        children: [
          {
            id: 3, name: '软件工程系党总支', type: 'generalBranch',
            children: [
              { id: 4, name: '学生第一党支部', type: 'branch', children: [{ id: 5, name: '第一党小组', type: 'group' }] },
              { id: 9, name: '机关党委', type: 'committee' },
            ],
          },
        ],
      },
      { id: 10, name: '机关党委', type: 'committee' },
    ],
  },
];

test('命中节点的整棵子树保留（含后代），且祖先路径完整', () => {
  const filtered = filterTreeByAllowedIds(TREE, [4, 5]);
  assert.equal(filtered.length, 1, '只应保留一条祖先路径');
  const root = filtered[0];
  assert.equal(root.id, 1, '根祖先（学校党委）应保留');
  assert.equal(root.children.length, 1);
  const college = root.children[0];
  assert.equal(college.id, 2);
  assert.equal(college.children.length, 1);
  const branch = college.children[0];
  assert.equal(branch.id, 3);
  assert.equal(branch.children.length, 1, '兄弟分支（机关党委）应被剪除');
  const own = branch.children[0];
  assert.equal(own.id, 4, '书记本组织应保留');
  assert.equal(own.children.length, 1, '本组织子树（下级党小组）应整棵保留');
  assert.equal(own.children[0].id, 5);
  assert.equal(own.children[0].children, undefined);
});

test('未命中任何节点时返回空数组', () => {
  assert.deepEqual(filterTreeByAllowedIds(TREE, [999]), []);
  assert.deepEqual(filterTreeByAllowedIds([], [1]), []);
  assert.deepEqual(filterTreeByAllowedIds(null, [1]), []);
});

test('命中根节点时整棵树保留', () => {
  const filtered = filterTreeByAllowedIds(TREE, [1]);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].children.length, 2, '根命中时全部子树保留');
});

test('入参兼容 Set 与数组', () => {
  assert.equal(filterTreeByAllowedIds(TREE, new Set([4, 5])).length, 1);
  assert.equal(filterTreeByAllowedIds(TREE, ['4', '5']).length, 1, '字符串 ID 亦应命中');
});
