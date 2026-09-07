const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('人员管理页面接入真实用户和组织接口', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../admin/src/views/UsersView.vue'), 'utf8');
  assert.match(source, /\/admin\/users/, '人员列表未请求真实接口');
  assert.match(source, /\/admin\/organizations/, '所属组织未从组织接口加载');
  assert.match(source, /\/admin\/users\/import/, '批量导入未接入真实接口');
  assert.doesNotMatch(source, /人员已添加（Mock）/, '人员管理仍在使用 Mock 数据');
});

test('用户详情查询不返回密码哈希', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/services/userService.js'), 'utf8');
  assert.doesNotMatch(source, /SELECT u\.\*/, 'getById 不能使用 SELECT u.*，避免把密码哈希返回给前端');
});

test('人员导入把中文角色映射为系统角色', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/routes/admin/users.js'), 'utf8');
  assert.match(source, /normalizeImportedRole/, '导入未规范化角色字段');
  assert.match(source, /支部书记/, '导入应识别中文角色“支部书记”');
});
