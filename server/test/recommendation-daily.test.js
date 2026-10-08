const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');
const { applyDailyOrder } = require('../src/services/recommendationService');

test('同一天的推荐顺序保持首次结果，不随重算重排', () => {
  const first = [
    { contentId: 3, title: 'A' },
    { contentId: 1, title: 'B' },
    { contentId: 8, title: 'C' },
  ];
  const reshuffled = [
    { contentId: 8, title: 'C' },
    { contentId: 5, title: 'D' },
    { contentId: 3, title: 'A' },
    { contentId: 1, title: 'B' },
  ];
  const pinned = applyDailyOrder(reshuffled, first.map((item) => item.contentId), 3);
  assert.deepEqual(pinned.map((item) => item.contentId), [3, 1, 8]);
});

test('下架的推荐会被后续候选补上，其余顺序不变', () => {
  const ranked = [
    { contentId: 9, title: 'new' },
    { contentId: 1, title: 'keep' },
    { contentId: 4, title: 'keep2' },
  ];
  const pinned = applyDailyOrder(ranked, [1, 2, 4], 3);
  assert.deepEqual(pinned.map((item) => item.contentId), [1, 4, 9]);
});

test('当天已生成的推荐不再重新请求 AI，首页也不再全屏等待分析', () => {
  const service = fs.readFileSync(path.join(__dirname, '../src/services/recommendationService.js'), 'utf8');
  const home = fs.readFileSync(path.join(__dirname, '../../src-qianduan/Home-index.vue'), 'utf8');
  const catalog = fs.readFileSync(path.join(__dirname, '../../src-qianduan/Catalog-index.vue'), 'utf8');
  const cache = fs.readFileSync(path.join(__dirname, '../../src-qianduan/api/recCache.js'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '../../src-qianduan/App.vue'), 'utf8');
  const aiIndex = service.indexOf('rankLearningContents');
  const cacheIndex = service.indexOf("recommendationMode: 'daily_cache'");
  assert.ok(cacheIndex >= 0 && cacheIndex < aiIndex, '当天快照命中后仍会先请求 AI');
  assert.match(home, /readRecCache/, '首页未读取当日推荐缓存');
  assert.match(cache, /sessionStorage/, '推荐缓存未写入浏览器');
  assert.match(home, /defineOptions\(\{ name: 'HomePage' \}\)/, '首页未命名，keep-alive 无法生效');
  assert.match(app, /keep-alive include="HomePage,CatalogPage,TaskListPage"/, '离开学习页后课程列表被销毁导致重复加载');
  assert.match(catalog, /loadCourses\(\)/, '学习页仍把课程列表和 AI 推荐绑在一起等待');
  assert.doesNotMatch(catalog, /Promise\.all\(\[\s*listPublicContents/, '学习页仍等待推荐接口才展示课程');
});

test('首页推荐区域支持横向拖动滑动', () => {
  const home = fs.readFileSync(path.join(__dirname, '../../src-qianduan/Home-index.vue'), 'utf8');
  const scroller = fs.readFileSync(path.join(__dirname, '../../src-qianduan/components/HScroll.vue'), 'utf8');
  const taskPage = fs.readFileSync(path.join(__dirname, '../../src-qianduan/Task-index.vue'), 'utf8');
  const listPage = fs.readFileSync(path.join(__dirname, '../../src-qianduan/TaskList-index.vue'), 'utf8');
  assert.match(home, /HScroll/, '首页未使用横向滑动容器');
  assert.match(scroller, /overflow-x:\s*auto/, '滑动容器未开启横向滚动');
  assert.match(scroller, /pointerdown/, '滑动容器未处理拖动');
  assert.match(scroller, /setInterval\(tick, 3800\)/, '推荐滑动未自动轮播');
  assert.doesNotMatch(taskPage, /标记为已学完/, '学习页仍允许自行点击完成');
  assert.match(taskPage, /wordCount/, '学习页未按字数核算学习时长');
  assert.match(taskPage, /已学/, '学习页未展示已学时长');
  assert.match(taskPage, /loadedSeconds\.value \+ sessionSeconds\.value/, '中途退出后未累计已学时长');
  assert.match(listPage, /applyTaskProgress/, '任务列表未同步学习页进度');
  assert.match(taskPage, /if \(seconds <= 0 \|\| need <= 0\) return 0/, '学习页进度未从零起算');
  // 只匹配进度百分比的保底形状；requiredSeconds 的「最短应学 5 秒」用的是 Math.round，不应被误伤
  assert.doesNotMatch(taskPage, /Math\.max\(5,\s*Math\.min/, '学习页仍使用 5% 保底进度');
  assert.doesNotMatch(taskPage, /if \(!completed\.value\) await persist\(false\)/, '进入任务页仍立即写入进度');
});

test.after(async () => {
  const db = require('../src/config/db');
  try { await db.end(); } catch {}
});
