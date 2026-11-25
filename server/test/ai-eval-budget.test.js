const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');

const { createBudget } = require('../ai-eval/lib/budget');
const { instrumentOnlineCalls, resolveTraceArgument } = require('../ai-eval/run-eval');
const { requestModel } = require('../src/ai/modelTransport');

const ORIGINAL_POST = axios.post;
const ORIGINAL_ENV = {
  AI_API_URL: process.env.AI_API_URL,
  AI_API_KEY: process.env.AI_API_KEY,
  AI_TIMEOUT_MS: process.env.AI_TIMEOUT_MS
};

function restoreEnv() {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function makeHarness(limits) {
  const budget = createBudget({
    maxRequests: limits?.maxRequests ?? 10,
    maxCostCny: limits?.maxCostCny ?? 1000,
    pricePerMillionTokens: limits?.pricePerMillionTokens ?? 1000000
  });

  // 与真实 AIClient 相同：LLM 方法签名为 (input, trace = {})，内部走 modelTransport。
  const AIClient = {
    isConfigured: () => true,
    generateRagAnswer: async ({ question, context }, trace = {}) => requestModel({
      payload: { model: 'mock-model', messages: [{ role: 'user', content: `${question}\n${context}` }] },
      budgetMs: 5000,
      parse: (content) => content
    }, trace)
  };
  const EmbeddingClient = {
    isApiConfigured: () => false,
    batchSize: 8,
    embedTexts: async () => []
  };
  const Reranker = {
    isApiConfigured: () => false,
    rerank: async (_q, candidates) => candidates
  };

  instrumentOnlineCalls({ AIClient, RagService: {}, Reranker, EmbeddingClient }, budget);
  return { AIClient, budget };
}

function mockResponse({ content, usage }) {
  return { data: { choices: [{ message: { content } }], usage } };
}

test('在线包装器取最后一个参数作为 trace，而不是请求体对象', () => {
  const input = { question: '党务问题', context: '参考资料[1]' };
  const trace = { requestId: 'trace-1' };
  const args = [input, trace];
  assert.equal(resolveTraceArgument(args), trace);
  assert.equal(args[0], input, '请求体不得被替换为 trace');

  const onlyInput = { question: '只有请求体' };
  const args2 = [onlyInput];
  const created = resolveTraceArgument(args2);
  assert.equal(args2[0], onlyInput);
  assert.equal(args2[1], created);
  assert.deepEqual(created, {});
});

test('Mock HTTP：首次调用成功，Token 与成本统计准确且不重复累计', async (t) => {
  t.after(() => { axios.post = ORIGINAL_POST; restoreEnv(); });
  process.env.AI_API_URL = 'http://127.0.0.1:9/mock';
  process.env.AI_API_KEY = 'mock';
  process.env.AI_TIMEOUT_MS = '5000';

  let calls = 0;
  axios.post = async () => {
    calls += 1;
    return mockResponse({ content: '依据资料[1]回答', usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } });
  };

  const { AIClient, budget } = makeHarness();
  const trace = {};
  const answer = await AIClient.generateRagAnswer({ question: '党务问题', context: '参考资料[1]' }, trace);

  assert.equal(answer, '依据资料[1]回答');
  assert.equal(calls, 1);
  assert.equal(trace.attempts, 1);
  const usage = budget.summary();
  assert.equal(usage.requests, 1);
  assert.equal(usage.byKind.llm, 1);
  assert.equal(usage.promptTokens, 10);
  assert.equal(usage.completionTokens, 5);
  assert.equal(usage.totalTokens, 15);
  assert.equal(usage.estimatedCostCny, 15); // 15 tokens × ¥1,000,000 / 1M
  assert.equal(usage.stopped, false);

  // 收尾重复观测同一 trace 不得二次记账
  budget.recordUsage(trace);
  assert.equal(budget.summary().totalTokens, 15);
  assert.equal(budget.summary().requests, 1);
});

test('Mock HTTP：网络失败重试后成功，重试请求计入预算', async (t) => {
  t.after(() => { axios.post = ORIGINAL_POST; restoreEnv(); });
  process.env.AI_API_URL = 'http://127.0.0.1:9/mock';
  process.env.AI_API_KEY = 'mock';
  process.env.AI_TIMEOUT_MS = '5000';

  let calls = 0;
  axios.post = async () => {
    calls += 1;
    if (calls === 1) throw Object.assign(new Error('connection reset'), { code: 'ECONNRESET' });
    return mockResponse({ content: '重试后的答案', usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 } });
  };

  const { AIClient, budget } = makeHarness();
  const answer = await AIClient.generateRagAnswer({ question: '党务问题', context: '参考资料' }, {});

  assert.equal(answer, '重试后的答案');
  assert.equal(calls, 2, '首次请求 + 1 次重试');
  const usage = budget.summary();
  assert.equal(usage.requests, 2);
  assert.equal(usage.byKind.llm, 2);
  assert.equal(usage.totalTokens, 20);
  assert.equal(usage.estimatedCostCny, 20);
});

test('Mock HTTP：重试将超预算时立即中断，不再发起第二次请求', async (t) => {
  t.after(() => { axios.post = ORIGINAL_POST; restoreEnv(); });
  process.env.AI_API_URL = 'http://127.0.0.1:9/mock';
  process.env.AI_API_KEY = 'mock';
  process.env.AI_TIMEOUT_MS = '5000';

  let calls = 0;
  axios.post = async () => {
    calls += 1;
    throw Object.assign(new Error('connection reset'), { code: 'ECONNRESET' });
  };

  const { AIClient, budget } = makeHarness({ maxRequests: 1 });
  const trace = {};
  const answer = await AIClient.generateRagAnswer({ question: '党务问题', context: '参考资料' }, trace);

  assert.equal(answer, null);
  assert.equal(calls, 1, '预算已用尽，不得发起第二次 HTTP 请求');
  assert.equal(trace.errorType, 'budget_stopped');
  const usage = budget.summary();
  assert.equal(usage.requests, 1);
  assert.equal(usage.stopped, true);
  assert.match(usage.stopReason, /上限 1/);
});
