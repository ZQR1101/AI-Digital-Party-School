const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const TaskService = require('../src/services/taskService');
const LearningRecordService = require('../src/services/learningRecordService');

test('移动端任务进度使用接口返回值而不是写死百分比', () => {
  const listPage = fs.readFileSync(path.join(__dirname, '../../src-qianduan/TaskList-index.vue'), 'utf8');
  const homePage = fs.readFileSync(path.join(__dirname, '../../src-qianduan/Home-index.vue'), 'utf8');
  assert.doesNotMatch(listPage, /return 12/, '任务页进度被写死为 12%');
  assert.doesNotMatch(listPage, /return 65/, '任务页进度被写死为 65%');
  assert.match(listPage, /item\.progress/, '任务页未使用接口进度');
  assert.doesNotMatch(homePage, /status === 'assigned' return 32|return 32/, '首页进度被写死');
  assert.match(homePage, /progress/, '首页未展示任务进度');
});

test('学习进度随学习时长增加，完成后为 100%', () => {
  assert.equal(TaskService.memberProgress('pending', 0), 0);
  assert.equal(TaskService.memberProgress('inProgress', 1), 0);
  assert.ok(TaskService.memberProgress('inProgress', 8) < 5, '刚进入学习不应直接显示 5%');
  assert.ok(TaskService.memberProgress('inProgress', 180) > TaskService.memberProgress('inProgress', 60));
  assert.equal(TaskService.memberProgress('completed', 10), 100);
  assert.ok(TaskService.memberProgress('inProgress', 180) < 100);
});

test('提交学习记录后任务进度会增加', async () => {
  const db = require('../src/config/db');
  const [contents] = await db.query("SELECT id FROM contents WHERE type != 'video' ORDER BY id ASC LIMIT 1");
  assert.ok(contents[0], '缺少文章类型公共内容');
  const id = await TaskService.create({
    title: '[test] progress updates',
    contentId: contents[0].id,
    organizationId: 4,
    deadline: '2026-12-31 23:59:59',
    status: 'published',
  });
  try {
    const before = await TaskService.getUserTasks(3, { page: 1, pageSize: 50 });
    const rowBefore = before.list.find((item) => Number(item.taskId) === Number(id));
    await LearningRecordService.submit(3, { taskId: id, studySeconds: 20, completed: true });
    const after = await TaskService.getUserTasks(3, { page: 1, pageSize: 50 });
    const rowAfter = after.list.find((item) => Number(item.taskId) === Number(id));
    assert.ok(rowBefore, '任务未出现在李四列表');
    assert.equal(rowBefore.progress, 0);
    assert.ok(rowAfter.progress > rowBefore.progress, '提交学习时长后进度没有增加');
    assert.notEqual(rowAfter.status, 'completed', '点击完成或短时上报不应直接记为学完');
  } finally {
    await TaskService.delete(id);
  }
});

test.after(async () => {
  const db = require('../src/config/db');
  try { await db.end(); } catch {}
});
