const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseOrganizationQuery,
  resolveTimeRange,
  extractOrganizationName
} = require('../src/ai/queryParser');
const { calculateEvaluation } = require('../src/ai/scoring');
const {
  extractJson,
  containsUnexpectedNumber,
  collectNumbers,
  validateRecommendationRanking
} = require('../src/services/aiClient');
const RagService = require('../src/services/ragService');

test('解析今年三支部学习完成率', () => {
  const parsed = parseOrganizationQuery('今年三支部学习完成率', new Date('2026-08-08T00:00:00+08:00'));
  assert.equal(parsed.metric, 'learning_completion_rate');
  assert.equal(parsed.organizationName, '三支部');
  assert.equal(parsed.timeRange.startDate, '2026-01-01 00:00:00');
  assert.equal(parsed.timeRange.endDate, '2027-01-01 00:00:00');
});

test('解析指定年月和月度趋势', () => {
  const parsed = parseOrganizationQuery('查询学生第一党支部2025年3月考试平均分趋势');
  assert.equal(parsed.metric, 'average_exam_score');
  assert.equal(parsed.organizationName, '学生第一党支部');
  assert.equal(parsed.groupBy, 'month');
  assert.equal(parsed.timeRange.startDate, '2025-03-01 00:00:00');
  assert.equal(parsed.timeRange.endDate, '2025-04-01 00:00:00');
});

test('无法识别的指标会被拒绝', () => {
  assert.throws(() => parseOrganizationQuery('帮我删除三支部'), /暂不支持该指标/);
});

test('组织名称与时间范围辅助解析', () => {
  assert.equal(extractOrganizationName('去年教师党支部学习时长'), '教师党支部');
  assert.equal(resolveTimeRange('去年', new Date('2026-08-08')).label, '2025年');
});

test('综合评分由固定权重确定', () => {
  const result = calculateEvaluation({
    totalTasks: 10,
    completionRate: 90,
    activeDays: 20,
    totalStudyHours: 20,
    assessments: { quiz: { count: 1, avgScore: 70 }, exam: { count: 1, avgScore: 90 } }
  });
  assert.equal(result.score, 88);
  assert.equal(result.level, '良好');
  assert.equal(result.ruleVersion, '2026.2');
});

test('AI JSON提取与额外数字检测', () => {
  assert.deepEqual(extractJson('```json\n{"summary":"良好"}\n```'), { summary: '良好' });
  assert.throws(() => extractJson('{"summary":"良好"'), /不是完整的JSON/);
  assert.equal(containsUnexpectedNumber({ summary: '综合得分86分' }, new Set(['86'])), false);
  assert.equal(containsUnexpectedNumber({ summary: '排名第3' }, new Set(['86'])), true);
});

test('AI推荐只允许候选公共内容且校验语义分', () => {
  const candidates = [{ contentId: 12 }, { contentId: 18 }];
  const input = { wrongCount: 3, candidates };
  const valid = validateRecommendationRanking({ recommendations: [
    { contentId: 12, semanticScore: 92, matchedEvidence: ['近期党纪学习错题'], reason: '与近期薄弱知识点高度相关' }
  ] }, candidates, collectNumbers(input));
  assert.equal(valid[0].contentId, 12);
  assert.equal(valid[0].semanticScore, 92);
  assert.throws(() => validateRecommendationRanking({ recommendations: [
    { contentId: 99, semanticScore: 80, reason: '推荐内容' }
  ] }, candidates), /候选集之外/);
  assert.throws(() => validateRecommendationRanking({ recommendations: [
    { contentId: 12, semanticScore: 120, reason: '推荐内容' }
  ] }, candidates), /语义分无效/);
});

test('知识库能够检索学习完成率口径', async () => {
  const results = await RagService.search('学习完成率统计口径', 2);
  assert.ok(results.length > 0);
  assert.match(results[0].content, /已完成.*应完成/);
});
