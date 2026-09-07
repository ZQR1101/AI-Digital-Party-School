const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('数据总览和组织架构页面接入真实接口', () => {
  const dashboard = fs.readFileSync(path.join(__dirname, '../../admin/src/views/DashboardView.vue'), 'utf8');
  const organizations = fs.readFileSync(path.join(__dirname, '../../admin/src/views/OrganizationsView.vue'), 'utf8');
  assert.match(dashboard, /\/admin\/statistics/, '数据总览未请求统计接口');
  assert.match(dashboard, /\/admin\/organizations/, '数据总览未加载真实组织');
  assert.doesNotMatch(dashboard, /1,286/, '数据总览仍在使用 Mock 人数');
  assert.match(organizations, /\/admin\/organizations/, '组织架构未请求真实接口');
  assert.doesNotMatch(organizations, /演示模式：删除操作已确认/, '组织删除仍是 Mock');
});

test('统计服务正确引用组织服务并处理根组织 parentId', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/services/statisticsService.js'), 'utf8');
  assert.match(source, /require\('\.\/organizationService'\)/, '统计服务应直接引用 OrganizationService');
  assert.doesNotMatch(source, /const \{ OrganizationService \}/, '不能解构 default export');
  assert.match(source, /parentId IS NULL/, '根组织统计不能使用 parentId = NULL');
});

test('组织树返回成员数和负责人姓名', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/services/organizationService.js'), 'utf8');
  assert.match(source, /directMembers/, '组织树缺少成员统计');
  assert.match(source, /leaderName/, '组织树缺少负责人姓名');
});
