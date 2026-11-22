const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const db = require('../src/config/db');
const { AIClient } = require('../src/services/aiClient');
const LearningProfileService = require('../src/services/learningProfileService');
const RecommendationService = require('../src/services/recommendationService');
const ReportService = require('../src/services/reportService');
const { calculateEvaluation } = require('../src/ai/scoring');

const candidates = [{ contentId: 42, title: '公开课程' }];
const providerResponse = (data, usage) => ({ data: { choices: [{ message: { content: JSON.stringify(data) } }], usage } });
const ranking = { recommendations: [{ contentId: 42, semanticScore: 92 }] };

function configureModel(t, timeout = '800') {
  const config = { AI_API_URL: 'http://127.0.0.1:1', AI_API_KEY: 'test-token', AI_MODEL: 'test-model', AI_TIMEOUT_MS: timeout };
  const original = Object.fromEntries(Object.keys(config).map(key => [key, process.env[key]]));
  Object.assign(process.env, config);
  t.after(() => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

test.after(() => db.end());

test('临时上游异常重试一次，记录模型、耗时、尝试次数和返回的用量', async t => {
  configureModel(t);
  let failures = 0;
  const post = t.mock.method(axios, 'post', async (_, __, options) => {
    assert.ok(options.timeout <= 800);
    if (!failures++) throw { response: { status: 503, headers: { 'retry-after': '0' } } };
    return providerResponse(ranking, { prompt_tokens: 120, completion_tokens: 20, total_tokens: 140 });
  });
  const trace = {};
  const result = await AIClient.rankLearningContents({}, candidates, trace);
  assert.equal(result[0].semanticScore, 92);
  assert.equal(post.mock.callCount(), 2);
  assert.equal(trace.model, 'test-model');
  assert.equal(trace.errorType, 'upstream_unavailable');
  assert.equal(trace.attempts, 2);
  assert.equal(trace.resultMode, 'model');
  assert.equal(trace.fallbackReason, undefined);
  assert.equal(trace.promptTokens, 120);
  assert.equal(trace.completionTokens, 20);
  assert.equal(trace.totalTokens, 140);
  assert.ok(trace.modelDurationMs >= 0);
});

test('上游限流等待超过预算时立即降级，鉴权错误也不重试', async t => {
  configureModel(t);
  let status = 429;
  const post = t.mock.method(axios, 'post', async () => {
    throw { response: { status, headers: { 'retry-after': '60' } } };
  });
  for (const [code, reason] of [[429, 'rate_limited'], [401, 'model_auth']]) {
    status = code;
    const trace = {};
    assert.equal(await AIClient.rankLearningContents({}, candidates, trace), null);
    assert.equal(trace.fallbackReason, reason);
    assert.equal(trace.attempts, 1);
    assert.equal(trace.totalTokens, undefined);
  }
  assert.equal(post.mock.callCount(), 2);
});

test('超时触发取消与明确降级，保持请求时限', async t => {
  configureModel(t, '40');
  const post = t.mock.method(axios, 'post', async (_, __, options) => {
    if (options.signal.aborted) throw Object.assign(new Error('cancelled'), { code: 'ERR_CANCELED' });
    return new Promise((_, reject) => {
      const keepAlive = setTimeout(() => reject(new Error('timer did not cancel')), 1000);
      options.signal.addEventListener('abort', () => {
        clearTimeout(keepAlive);
        reject(Object.assign(new Error('cancelled'), { code: 'ERR_CANCELED' }));
      }, { once: true });
    });
  });
  const trace = {};
  assert.equal(await AIClient.rankLearningContents({}, candidates, trace), null);
  assert.equal(trace.fallbackReason, 'timeout');
  assert.equal(post.mock.callCount(), 1);
  assert.ok(trace.modelDurationMs < 1000);
});

test('无效输出直接降级，保留模型实际返回的用量', async t => {
  configureModel(t);
  let response;
  const post = t.mock.method(axios, 'post', async () => response);
  for (const invalid of [
    { recommendations: [{ contentId: '42', semanticScore: 90 }] },
    { recommendations: [{ contentId: 99, semanticScore: 90 }] },
    { recommendations: [ranking.recommendations[0], ranking.recommendations[0]] },
    { ...ranking, extra: true }
  ]) {
    response = providerResponse(invalid, { total_tokens: 83 });
    const trace = {};
    assert.equal(await AIClient.rankLearningContents({}, candidates, trace), null);
    assert.equal(trace.errorType, 'invalid_output');
    assert.equal(trace.fallbackReason, 'invalid_output');
    assert.equal(trace.attempts, 1);
    assert.equal(trace.totalTokens, 83);
  }
  assert.equal(post.mock.callCount(), 4);
});

test('测验与考试独立计分，模型试图改分时使用原评分和规则评语', async t => {
  configureModel(t);
  const profile = {
    totalTasks: 5, completionRate: 80, totalStudyHours: 0, activeDays: 0,
    avgScore: 92, totalExams: 2, weakCategories: [], knowledgeProgress: [],
    assessments: { quiz: { count: 1, avgScore: 50 }, exam: { count: 1, avgScore: 90 } }
  };
  assert.equal(calculateEvaluation(profile).score, 76);
  t.mock.method(LearningProfileService, 'getProfile', async () => profile);
  t.mock.method(RecommendationService, 'getReportRecommendations', async () => []);
  t.mock.method(axios, 'post', async () => providerResponse({
    score: 100,
    summary: '分数已修改', strengths: [], weaknesses: [],
    suggestions: [{ title: '复习课程', content: '继续复习', knowledgePoint: null }]
  }));
  const trace = {};
  const report = await ReportService.generateReport(1, trace);
  assert.deepEqual(report.dimensions, { completion: 80, activity: null, quiz: 50, exam: 90 });
  assert.equal(report.score, 76);
  assert.equal(report.generatedBy, 'rules');
  assert.equal(trace.fallbackReason, 'invalid_output');
});
