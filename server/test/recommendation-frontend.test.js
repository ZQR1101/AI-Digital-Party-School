const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('党员端个性化推荐能进入公共学习内容', () => {
  const app = fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8');
  const home = fs.readFileSync(path.join(__dirname, '../../src-qianduan/Home-index.vue'), 'utf8');
  const router = fs.readFileSync(path.join(__dirname, '../../src-qianduan/router/index.js'), 'utf8');
  const service = fs.readFileSync(path.join(__dirname, '../src/services/contentService.js'), 'utf8');
  const recApi = fs.readFileSync(path.join(__dirname, '../../src-qianduan/api/recommendations.js'), 'utf8');
  assert.match(app, /\/api\/contents/, '未挂载党员公共内容接口');
  assert.match(service, /getPublicById/, '公共内容详情缺少查询方法');
  assert.match(home, /\/learn\//, '首页开始学习未进入内容详情');
  assert.match(recApi, /\/ai\/recommendations\/me/, '首页未请求个性化推荐接口');
  assert.match(router, /\/learn\/:id/, '缺少学习内容路由');
});
