const test = require('node:test');
const assert = require('node:assert/strict');
const {
  countStudyChars,
  requiredStudySeconds,
  memberProgress,
  shouldComplete,
} = require('../src/services/studyDuration');

test('按正文字数核算必学时长，300 字对应 1 分钟', () => {
  assert.equal(countStudyChars('<p>中国共产党廉洁自律准则要点说明</p>'), 15);
  const short = requiredStudySeconds({ title: '短文', summary: '简介', bodyOrVideoUrl: '学'.repeat(175) });
  assert.equal(short, 35);
  assert.equal(requiredStudySeconds({ bodyOrVideoUrl: '党'.repeat(300) }), 60);
  const longBody = '党'.repeat(1500);
  const long = requiredStudySeconds({ contentType: 'article', bodyOrVideoUrl: longBody });
  assert.equal(long, 300);
  assert.equal(requiredStudySeconds({ contentType: 'video', bodyOrVideoUrl: 'http://x' }), 0);
});

test('文章不能靠客户端 completed 标记完成，视频需计入时长达到应看时长', () => {
  const required = requiredStudySeconds({ bodyOrVideoUrl: '党'.repeat(1500) });
  assert.equal(shouldComplete({ contentType: 'article', studySeconds: 10, requiredSeconds: required, videoEnded: false }), false);
  assert.equal(shouldComplete({ contentType: 'article', studySeconds: required, requiredSeconds: required }), true);
  // 视频按时长核算：未知时长回退 60s，12s 即使播放结束也不能完成
  assert.equal(shouldComplete({ contentType: 'video', studySeconds: 12, videoEnded: true }), false);
  assert.equal(shouldComplete({ contentType: 'video', studySeconds: 12, videoEnded: false }), false);
  assert.equal(shouldComplete({ contentType: 'video', studySeconds: 60, videoEnded: true }), true);
  // 有真实时长时按 90% 核算：10 分钟视频需 540s
  assert.equal(shouldComplete({ contentType: 'video', studySeconds: 539, videoEnded: true, durationSeconds: 600 }), false);
  assert.equal(shouldComplete({ contentType: 'video', studySeconds: 540, videoEnded: true, durationSeconds: 600 }), true);
  // completed 布尔值单独不能完成：未播放结束不计
  assert.equal(shouldComplete({ contentType: 'video', studySeconds: 600, videoEnded: false, durationSeconds: 600 }), false);
});

test('进度按应学时长比例计算', () => {
  assert.equal(memberProgress('pending', 0, 180), 0);
  assert.equal(memberProgress('inProgress', 90, 180), 50);
  assert.equal(memberProgress('inProgress', 180, 180), 99);
  assert.equal(memberProgress('completed', 20, 180), 100);
});
