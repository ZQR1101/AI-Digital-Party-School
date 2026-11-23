// 阿里云百炼 DashScope 适配测试
// 验证 Embedding/Reranker 客户端对百炼 OpenAI 兼容端点的请求体、响应解析、
// 单批上限与 DASHSCOPE_API_KEY 回退均正确，确保切换平台后语义检索通路可用。
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const { EmbeddingClient } = require('../src/rag/vectorStore');
const Reranker = require('../src/rag/reranker');

function setupEnv(t, extra = {}) {
  const config = {
    EMBEDDING_API_URL: 'https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings',
    EMBEDDING_MODEL: 'text-embedding-v4',
    EMBEDDING_API_KEY: '',
    EMBEDDING_TIMEOUT_MS: '800',
    RERANKER_API_URL: 'https://dashscope.aliyuncs.com/compatible-api/v1/reranks',
    RERANKER_MODEL: 'qwen3-rerank',
    RERANKER_API_KEY: '',
    RERANKER_TIMEOUT_MS: '800',
    ...extra
  };
  const keys = Object.keys(config);
  const original = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  Object.assign(process.env, config);
  t.after(() => {
    for (const [k, v] of Object.entries(original)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
}

test('百炼 Embedding：请求体含模型与文本数组，按 index 还原向量', async (t) => {
  setupEnv(t, { DASHSCOPE_API_KEY: 'sk-dashscope-test' });
  const originalPost = axios.post;
  let captured;
  axios.post = async (url, payload) => {
    captured = { url, payload };
    // 百炼返回可能乱序，用 index 标记
    return {
      data: {
        data: [
          { index: 1, embedding: [0, 1] },
          { index: 0, embedding: [1, 0] }
        ]
      }
    };
  };
  t.after(() => { axios.post = originalPost; });

  const vecs = await EmbeddingClient.embedTexts(['甲', '乙']);
  assert.equal(captured.url, 'https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings');
  assert.equal(captured.payload.model, 'text-embedding-v4');
  assert.deepEqual(captured.payload.input, ['甲', '乙']);
  // 按 index 还原后第一条应为 [1,0]
  assert.deepEqual(Array.from(vecs[0]), [1, 0]);
  assert.deepEqual(Array.from(vecs[1]), [0, 1]);
  assert.equal(EmbeddingClient.getBackendInfo().backend, 'api');
  assert.equal(EmbeddingClient.getBackendInfo().semantic, true);
});

test('百炼 Embedding：单批不超过 10 行（text-embedding-v4 上限）', async (t) => {
  setupEnv(t, { DASHSCOPE_API_KEY: 'sk-dashscope-test' });
  const originalPost = axios.post;
  const batchSizes = [];
  axios.post = async (url, payload) => {
    batchSizes.push(payload.input.length);
    return {
      data: { data: payload.input.map((_, i) => ({ index: i, embedding: [1, 0] })) }
    };
  };
  t.after(() => { axios.post = originalPost; });

  const texts = Array.from({ length: 23 }, (_, i) => `文本${i}`);
  const vecs = await EmbeddingClient.embedTexts(texts);
  assert.equal(vecs.length, 23);
  assert.ok(batchSizes.every(n => n <= 10), `实际批量: ${batchSizes}`);
  assert.deepEqual(batchSizes, [10, 10, 3]);
});

test('百炼 Reranker：请求体匹配 compatible-api/v1/reranks，解析 relevance_score', async (t) => {
  setupEnv(t, { DASHSCOPE_API_KEY: 'sk-dashscope-test' });
  const originalPost = axios.post;
  let captured;
  axios.post = async (url, payload) => {
    captured = { url, payload };
    return {
      data: {
        results: [
          { index: 0, relevance_score: 0.2 },
          { index: 1, relevance_score: 0.9 }
        ]
      }
    };
  };
  t.after(() => { axios.post = originalPost; });

  const candidates = [
    { chunk: { title: 'A', content: '内容A' }, rrfScore: 0.5 },
    { chunk: { title: 'B', content: '内容B' }, rrfScore: 0.4 }
  ];
  const ranked = await Reranker.rerank('测试问题', candidates, 2);
  assert.equal(captured.url, 'https://dashscope.aliyuncs.com/compatible-api/v1/reranks');
  assert.equal(captured.payload.model, 'qwen3-rerank');
  assert.equal(captured.payload.query, '测试问题');
  assert.deepEqual(captured.payload.documents, ['A\n内容A', 'B\n内容B']);
  assert.equal(captured.payload.top_n, 2);
  // 按 relevance_score 降序，index=1 应排第一
  assert.equal(ranked[0].chunk.title, 'B');
  assert.equal(ranked[0].relevanceScore, 0.9);
  assert.equal(ranked[0].model, 'reranker-api');
});

test('DASHSCOPE_API_KEY 回退：未设专用 Key 时 Bearer 使用百炼 Key', async (t) => {
  setupEnv(t, { DASHSCOPE_API_KEY: 'sk-fallback-test' });
  const originalPost = axios.post;
  let capturedHeaders;
  axios.post = async (url, payload, config) => {
    capturedHeaders = config.headers;
    return { data: { data: [{ index: 0, embedding: [1, 0] }] } };
  };
  t.after(() => { axios.post = originalPost; });

  await EmbeddingClient.embedTexts(['测试']);
  assert.equal(capturedHeaders.Authorization, 'Bearer sk-fallback-test');
});
