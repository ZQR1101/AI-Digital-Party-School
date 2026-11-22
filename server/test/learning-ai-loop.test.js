const test = require('node:test');
const assert = require('node:assert/strict');
const LearningProfileService = require('../src/services/learningProfileService');
const RecommendationService = require('../src/services/recommendationService');
const { calculateEvaluation } = require('../src/ai/scoring');
const { AIClient, validateEvaluationNarrative } = require('../src/services/aiClient');

test.after(() => require('../src/config/db').end());

const topic = '组织生活';
const profileRows = [
  { kind: 'quiz', score: 33.33, results: [
    { category: topic, questionId: 1, correct: false },
    { category: topic, questionId: 2, correct: false },
    { category: topic, questionId: 3, correct: true }
  ] }
];

test('错题来自交卷事实，复测通过后更新同一知识点的诊断', () => {
  const before = LearningProfileService.summarizeAssessmentAttempts(profileRows);
  assert.deepEqual(before.assessments.quiz, { count: 1, avgScore: 33.33 });
  assert.equal(before.weakCategories[0].wrongRate, 67);
  assert.equal(before.weakCategories[0].wrongCount, 2);

  const after = LearningProfileService.summarizeAssessmentAttempts([
    { kind: 'exam', score: 100, results: JSON.stringify([{ category: topic, questionId: 9, correct: true }]) },
    ...profileRows
  ]);
  assert.deepEqual(after.assessments.exam, { count: 1, avgScore: 100 });
  assert.deepEqual(after.weakCategories, []);
  assert.deepEqual(after.knowledgeProgress, [{
    category: topic,
    latest: { correctCount: 1, attempts: 1 },
    previous: { correctCount: 1, attempts: 3 }
  }]);
});

test('报告按北京时间统计最近三十个日历日', () => {
  const result = LearningProfileService.reportWindow(new Date('2026-11-21T16:05:00Z'));
  assert.equal(result.startDate, '2026-10-24');
  assert.equal(result.endDate, '2026-11-22');
  assert.equal(result.start.toISOString(), '2026-10-23T16:00:00.000Z');
  assert.equal(result.end.toISOString(), '2026-11-22T16:00:00.000Z');
});

test('没有已判分记录时不生成综合分，有测验而无正式考试时不重复计分', () => {
  const profile = {
    totalTasks: 5, completionRate: 80, totalStudyHours: 0, activeDays: 0,
    assessments: { quiz: { count: 0, avgScore: null }, exam: { count: 0, avgScore: null } }
  };
  assert.equal(calculateEvaluation(profile).score, null);
  profile.assessments.quiz = { count: 1, avgScore: 40 };
  const scored = calculateEvaluation(profile);
  assert.equal(scored.score, 64);
  assert.equal(scored.dimensions.exam, null);
  assert.equal(scored.weights.exam, 0);
});

test('旧课程能按知识点进入候选，大模型打分不会覆盖真实推荐证据', () => {
  const known = { id: 1, title: '早期课程', tags: topic, createdAt: '2024-01-01' };
  const recent = Array.from({ length: 61 }, (_, index) => ({
    id: index + 2, title: '新课程', tags: '其他主题', createdAt: '2026-11-01'
  }));
  const { weakCategories } = LearningProfileService.summarizeAssessmentAttempts(profileRows);
  const ranked = RecommendationService.rankCandidates([...recent, known], weakCategories).slice(0, 20);
  assert.equal(ranked[0].contentId, known.id);
  const merged = RecommendationService.mergeAIRanking(ranked, [
    { contentId: 1, semanticScore: 12, reason: '不应使用的模型理由' },
    { contentId: 2, semanticScore: 100 }
  ]);
  assert.equal(merged[0].contentId, known.id);
  assert.match(merged[0].reason, /3 道题有 2 道答错/);
  assert.deepEqual(merged[0].evidence, [{ category: topic, attempts: 3, wrongCount: 2, wrongRate: 67 }]);
});

test('同日已有推荐复用快照，新交卷重算推荐', async t => {
  const course = { id: 1, title: '组织生活复习', tags: topic, createdAt: '2026-11-01' };
  const diagnosed = LearningProfileService.summarizeAssessmentAttempts(profileRows);
  let revision = '1';
  let saved = { ids: [], items: [] };
  const generate = t.mock.method(AIClient, 'rankLearningContents', async () => null);
  t.mock.method(LearningProfileService, 'getAssessmentRevision', async () => revision);
  t.mock.method(LearningProfileService, 'getProfile', async () => ({ ...diagnosed, learningHistory: [] }));
  t.mock.method(RecommendationService, 'getPublicCandidates', async () => [course]);
  t.mock.method(RecommendationService, 'loadDailySnapshot', async () => saved);
  t.mock.method(RecommendationService, 'saveDailySnapshot', async (_, __, items, savedRevision) => {
    saved = { ids: items.map(item => item.contentId), items, revision: savedRevision };
  });
  assert.equal((await RecommendationService.getForUser(9)).cached, false);
  assert.equal((await RecommendationService.getForUser(9)).cached, true);
  revision = '2';
  assert.equal((await RecommendationService.getForUser(9)).cached, false);
  assert.equal(generate.mock.callCount(), 2);
});

test('模型评语缺失结构或引用未观察到的知识点时会触发规则回退', () => {
  const facts = { score: 60, weakKnowledgePoints: [{ category: topic, wrongCount: 2 }] };
  const good = {
    summary: '当前已获得 60 分', strengths: [], weaknesses: [],
    suggestions: [{ title: '复习错题', content: '复习近期测评', knowledgePoint: topic }]
  };
  assert.deepEqual(validateEvaluationNarrative(good, facts), good);
  assert.throws(() => validateEvaluationNarrative({ ...good, weaknesses: null }, facts), /格式/);
  assert.throws(() => validateEvaluationNarrative({
    ...good, suggestions: [{ ...good.suggestions[0], knowledgePoint: '未观察主题' }]
  }, facts), /未知知识点/);
  assert.throws(() => validateEvaluationNarrative({ ...good, summary: '共答错 3 道' }, facts), /数字/);
});
