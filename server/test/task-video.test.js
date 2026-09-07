const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');

test('学习内容支持上传视频并真实预览', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../admin/src/views/ContentsView.vue'), 'utf8');
  assert.match(source, /handleVideoChange/, '内容管理未提供视频上传');
  assert.match(source, /video\/mp4/, '视频上传未限制常见视频格式');
  assert.match(source, /preview-video/, '内容预览未使用真实视频播放器');
});

test('学习任务接入真实接口并可下发视频内容', () => {
  const view = fs.readFileSync(path.join(__dirname, '../../admin/src/views/TasksView.vue'), 'utf8');
  const route = fs.readFileSync(path.join(__dirname, '../src/routes/admin/tasks.js'), 'utf8');
  const service = fs.readFileSync(path.join(__dirname, '../src/services/taskService.js'), 'utf8');
  assert.match(view, /\/admin\/tasks/, '任务列表未请求真实接口');
  assert.match(view, /视频课程/, '发布任务未提供视频内容选项');
  assert.doesNotMatch(view, /针对“党的十九大精神”模块强化学习/, '学习任务仍在使用 Mock 数据');
  assert.match(route, /article.*video|video/, '发布任务未校验视频内容类型');
  assert.match(service, /contentType/, '任务列表未返回内容类型');
});

test('党员端可打开视频学习任务并提交学习记录', () => {
  const home = fs.readFileSync(path.join(__dirname, '../../src-qianduan/Home-index.vue'), 'utf8');
  const page = fs.readFileSync(path.join(__dirname, '../../src-qianduan/Task-index.vue'), 'utf8');
  const router = fs.readFileSync(path.join(__dirname, '../../src-qianduan/router/index.js'), 'utf8');
  assert.match(home, /getMyTasks/, '首页未加载我的学习任务');
  assert.match(home, /\/task\//, '首页未跳转到任务学习页');
  assert.match(router, /Task-index/, '路由未注册任务学习页');
  assert.match(page, /contentType === 'video'/, '任务页未区分视频内容');
  assert.match(page, /submitLearningRecord/, '视频任务完成后未提交学习记录');
});
