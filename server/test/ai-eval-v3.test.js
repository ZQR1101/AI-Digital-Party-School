const test = require('node:test');
const assert = require('node:assert/strict');

const { selectSamples, PRESETS } = require('../ai-eval/lib/select-samples');
const { runV3, v3Limits, configSummary } = require('../ai-eval/tools/run-online-v3');

const KEY_NAMES = [
  'AI_EVAL_ONLINE', 'AI_API_URL', 'AI_API_KEY', 'AI_MODEL',
  'EMBEDDING_API_URL', 'EMBEDDING_API_KEY', 'RERANKER_API_URL', 'RERANKER_API_KEY',
  'AI_EVAL_V3_MAX_REQUESTS', 'AI_EVAL_V3_MAX_COST_CNY', 'AI_EVAL_V3_PRICE_PER_MTOK'
];
const ORIGINAL_ENV = Object.fromEntries(KEY_NAMES.map((k) => [k, process.env[k]]));

function restoreEnv() {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

test('V3 预设固定为 20 条 dev 样本且 heldout 单独成组', () => {
  const dev = selectSamples({ preset: 'v3-online' });
  assert.equal(dev.meta.count, 20);
  assert.deepEqual(dev.meta.splitCounts, { dev: 20 });
  assert.equal(dev.meta.idsByDataset.retrieval.length, 8);
  assert.equal(dev.meta.idsByDataset.qa.length, 5);
  assert.equal(dev.meta.idsByDataset.refusal.length, 4);
  assert.equal(dev.meta.idsByDataset.nlq.length, 3);
  assert.deepEqual(dev.meta.idsByDataset.retrieval, PRESETS['v3-online'].retrieval);

  const heldout = selectSamples({ preset: 'v3-heldout' });
  assert.equal(heldout.meta.count, 5);
  assert.deepEqual(heldout.meta.splitCounts, { heldout: 5 });
});

test('V3 按 ID / 类别 / 数量筛选，不自动扩样', () => {
  const byIds = selectSamples({ ids: 'ret-030,qa-001', limit: 2 });
  assert.deepEqual(byIds.cases.map((c) => c.id), ['ret-030', 'qa-001']);
  assert.equal(byIds.meta.truncated, false);

  const byCategory = selectSamples({ categories: '相似概念', split: 'dev', limit: 10 });
  assert.deepEqual(byCategory.cases.map((c) => c.id), ['ret-030', 'ret-039']);

  assert.throws(() => selectSamples({ ids: 'ret-001', limit: 21 }), /上限为 20/);
  assert.throws(() => selectSamples({ ids: 'ret-999' }), /未找到样本 ID/);
  assert.throws(() => selectSamples({ preset: 'v3-online', split: 'dev' }), /不可同时使用/);
});

test('V3 在线预算默认收紧，CLI 参数不可超过 20 条', () => {
  for (const key of ['AI_EVAL_V3_MAX_REQUESTS', 'AI_EVAL_V3_MAX_COST_CNY', 'AI_EVAL_V3_PRICE_PER_MTOK']) {
    delete process.env[key];
  }
  const limits = v3Limits();
  assert.equal(limits.maxRequests, 80);
  assert.equal(limits.maxCostCny, 2);
  assert.equal(limits.pricePerMillionTokens, 8);
  assert.equal(v3Limits({ maxRequests: 12, maxCostCny: 0.5 }).maxRequests, 12);
});

test('在线配置不完整时明确 not_run，不发起任何真实请求', async (t) => {
  t.after(restoreEnv);
  process.env.AI_EVAL_ONLINE = '1';
  process.env.AI_API_URL = '';
  process.env.AI_API_KEY = '';
  process.env.EMBEDDING_API_URL = '';
  process.env.EMBEDDING_API_KEY = '';
  process.env.RERANKER_API_URL = '';
  process.env.RERANKER_API_KEY = '';

  const report = await runV3({ mode: 'online', preset: 'v3-online' });
  assert.equal(report.status, 'not_run');
  assert.match(report.stopReason, /真实模型未完整配置/);
  assert.equal(report.usage.requests, 0);
  assert.equal(report.suites.retrieval.status, 'not_run');
  assert.equal(report.suites.qa.status, 'not_run');
  assert.equal(report.suites.refusal.status, 'not_run');
  assert.equal(report.suites.nlq.status, 'not_run');
});

test('未显式开启 AI_EVAL_ONLINE 时在线评测停止且不调用接口', async (t) => {
  t.after(restoreEnv);
  process.env.AI_EVAL_ONLINE = '0';
  process.env.AI_API_URL = 'http://127.0.0.1:9/v1/chat/completions';
  process.env.AI_API_KEY = 'test-only';
  process.env.EMBEDDING_API_URL = 'http://127.0.0.1:9/v1/embeddings';
  process.env.EMBEDDING_API_KEY = 'test-only';
  process.env.RERANKER_API_URL = 'http://127.0.0.1:9/v1/reranks';
  process.env.RERANKER_API_KEY = 'test-only';

  const report = await runV3({ mode: 'online', preset: 'v3-heldout' });
  assert.equal(report.status, 'stopped');
  assert.match(report.stopReason, /AI_EVAL_ONLINE=1/);
  assert.equal(report.usage.requests, 0);
});

test('配置摘要不泄漏 API Key', (t) => {
  t.after(restoreEnv);
  process.env.AI_API_KEY = 'SENTINEL_LLM_KEY';
  process.env.EMBEDDING_API_KEY = 'SENTINEL_EMBEDDING_KEY';
  process.env.RERANKER_API_KEY = 'SENTINEL_RERANK_KEY';
  const summary = configSummary(v3Limits({ maxRequests: 5, maxCostCny: 0.1 }));
  const text = JSON.stringify(summary);
  assert.ok(!text.includes('SENTINEL_LLM_KEY'));
  assert.ok(!text.includes('SENTINEL_EMBEDDING_KEY'));
  assert.ok(!text.includes('SENTINEL_RERANK_KEY'));
});
