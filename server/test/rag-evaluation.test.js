// RAG 检索效果回归测试
// 将评测集中的代表性 query 固化为断言：混合检索须在 Top-K 命中正确来源文档。
// 与 rag-evaluate.js 共享评测理念，但作为 CI 门禁保证检索质量不回退。
process.env.NODE_ENV = 'test';
process.env.QDRANT_ENABLED = 'false';

const test = require('node:test');
const assert = require('node:assert/strict');

const RagService = require('../src/services/ragService');

const CASES = [
  { query: '支部每年开的那次组织生活 和领导干部的批评会是不是一回事', source: '党组织生活制度规范.md' },
  { query: '刚入党还没转正的预备党员算不算有党龄 这个年限从哪天起算', source: '党员组织关系与党籍管理.md' },
  { query: '月工资四千块 每个月党费要交多少比例', source: '党费收缴使用与管理规定.md' },
  { query: '作为一名党员 可以行使哪些权利', source: '党章核心要义与党员权利义务.md' },
  { query: '违反党纪之后 可能受到哪几种处分', source: '党规党纪与纪律处分要点.md' },
  { query: '支部委员会任期满了 改选新的班子要走什么流程', source: '党的基层组织建设与换届选举.md' },
  { query: '党史上那个生死攸关的转折点是哪次会议', source: '党史学习教育要点.md' },
  { query: '后台看板里学习完成率这个指标是怎么算出来的', source: '指标统计口径.md' }
];

test('混合检索在 Top-4 命中各领域问题的正确来源文档', async () => {
  await RagService.init(true);
  for (const item of CASES) {
    const hits = await RagService.hybridSearch(item.query, { topK: 4 });
    const sources = hits.map(h => h.chunk.source);
    assert.ok(
      sources.includes(item.source),
      `「${item.query}」应在 Top-4 命中 ${item.source}，实际: ${sources.join(', ')}`
    );
  }
});

test('检索后端诊断信息可正确暴露实际使用的算法', async () => {
  await RagService.init(true);
  const status = RagService.getBackendStatus();
  assert.ok(status.embedding, '应包含 embedding 后端信息');
  assert.ok(status.reranker, '应包含 reranker 后端信息');
  assert.ok(status.chunkCount > 0, '应已加载知识库分块');
  assert.ok(status.vectorDim > 0, '应已确定向量维度');
  assert.equal(typeof status.embedding.semantic, 'boolean', 'semantic 应为布尔值');
});
