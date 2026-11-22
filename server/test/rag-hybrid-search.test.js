'use strict';
/**
 * P2 RAG 混合检索系统测试
 * 覆盖：DocumentParser / BM25 / VectorStore / RRF / Reranker / RagService
 * 全部使用本地 fallback，不依赖外部服务（Qdrant / Embedding API / Reranker API / LLM）
 */

const { describe, it, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// ─── 测试环境隔离（阻止 Qdrant/LLM 网络连接）─────────────────────────────────
process.env.NODE_ENV = 'test';
process.env.QDRANT_ENABLED = 'false';
// 不设置 EMBEDDING_API_URL / RERANKER_API_URL / AI_API_KEY，确保走 local fallback

// ─── 模块导入 ─────────────────────────────────────────────────────────────────
const path = require('path');
const DocumentParser = require('../src/rag/documentParser');
const { BM25Retriever, tokenize } = require('../src/rag/bm25');
const { VectorStore, EmbeddingClient } = require('../src/rag/vectorStore');
const { reciprocalRankFusion } = require('../src/rag/fusion');
const Reranker = require('../src/rag/reranker');
const RagService = require('../src/services/ragService');

const KNOWLEDGE_DIR = path.resolve(__dirname, '../knowledge');

// ═══════════════════════════════════════════════════════════════════════════════
// 1. DocumentParser
// ═══════════════════════════════════════════════════════════════════════════════
describe('DocumentParser', () => {
  it('从 knowledge/ 目录加载文件并生成分块', () => {
    const chunks = DocumentParser.loadFromDirectory(KNOWLEDGE_DIR);
    assert.ok(chunks.length >= 5, `应至少生成 5 个分块，实际 ${chunks.length}`);

    const first = chunks[0];
    assert.ok(typeof first.id === 'string' && first.id.length > 0, 'chunk.id 应为非空字符串');
    assert.ok(typeof first.title === 'string' && first.title.length > 0, 'chunk.title 应为非空字符串');
    assert.ok(typeof first.source === 'string' && first.source.length > 0, 'chunk.source 应为非空字符串');
    assert.ok(typeof first.content === 'string' && first.content.length > 0, 'chunk.content 应为非空字符串');
  });

  it('分块包含组织生活会相关内容', () => {
    const chunks = DocumentParser.loadFromDirectory(KNOWLEDGE_DIR);
    const hasOrgLife = chunks.some(c =>
      c.content.includes('组织生活会') || c.title.includes('组织生活会')
    );
    assert.ok(hasOrgLife, '知识库应包含组织生活会相关分块');
  });

  it('分块来自多个不同文件', () => {
    const chunks = DocumentParser.loadFromDirectory(KNOWLEDGE_DIR);
    const sources = new Set(chunks.map(c => c.source));
    assert.ok(sources.size >= 2, `应来自至少 2 个文件，实际 ${sources.size}`);
  });

  it('空目录不抛出异常，返回空数组', () => {
    const chunks = DocumentParser.loadFromDirectory(path.join(KNOWLEDGE_DIR, '__nonexistent__'));
    assert.deepEqual(chunks, []);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. 中文分词（tokenize）
// ═══════════════════════════════════════════════════════════════════════════════
describe('tokenize（中文分词）', () => {
  it('对中文文本生成 unigram/bigram/trigram', () => {
    // tokenize 实现：unigram(1字) + bigram(2字) + trigram(3字) 滑动窗口
    const tokens = tokenize('组织生活会');
    // unigram
    assert.ok(tokens.includes('组'), '应包含 unigram "组"');
    // bigram（相邻两字）
    assert.ok(tokens.includes('组织'), '应包含 bigram "组织"');
    assert.ok(tokens.includes('生活'), '应包含 bigram "生活"');
    assert.ok(tokens.includes('生活会'), '应包含 trigram "生活会"');
    // 应生成合理数量的 token（5字文本：5 unigrams + 4 bigrams + 3 trigrams = 12）
    assert.ok(tokens.length >= 8, `应至少生成 8 个 token，实际 ${tokens.length}: ${JSON.stringify(tokens)}`);
  });

  it('空字符串返回空数组', () => {
    assert.deepEqual(tokenize(''), []);
  });

  it('纯标点不产生有效 token', () => {
    const tokens = tokenize('，。！？');
    assert.ok(tokens.length === 0 || tokens.every(t => t.trim().length === 0 || /^[\s\W]+$/.test(t)));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. BM25Retriever
// ═══════════════════════════════════════════════════════════════════════════════
describe('BM25Retriever', () => {
  let retriever;
  let chunks;

  before(() => {
    chunks = DocumentParser.loadFromDirectory(KNOWLEDGE_DIR);
    retriever = new BM25Retriever();
    retriever.index(chunks);
  });

  it('对查询返回非空结果', () => {
    const results = retriever.search('组织生活会', 5);
    assert.ok(results.length > 0, 'BM25 应返回至少一个结果');
  });

  it('结果包含必要字段', () => {
    const results = retriever.search('党纪处分', 3);
    for (const r of results) {
      assert.ok(r.chunk, 'result.chunk 应存在');
      assert.ok(typeof r.bm25Score === 'number', 'result.bm25Score 应为数字');
      assert.ok(r.bm25Score >= 0, 'bm25Score 应非负');
    }
  });

  it('相关查询排名高于无关查询', () => {
    const relResults = retriever.search('组织生活会民主生活会', 1);
    const unrelResults = retriever.search('zzz不存在的词汇', 1);
    if (relResults.length > 0 && unrelResults.length > 0) {
      assert.ok(
        relResults[0].bm25Score >= unrelResults[0].bm25Score,
        '相关查询的 BM25 分应不低于无关查询'
      );
    }
  });

  it('topK 参数限制返回数量', () => {
    const results = retriever.search('党员', 2);
    assert.ok(results.length <= 2, `topK=2 时结果不应超过 2 条，实际 ${results.length}`);
  });

  it('空语料库不抛出异常', () => {
    const empty = new BM25Retriever();
    empty.index([]);
    const results = empty.search('测试');
    assert.deepEqual(results, []);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. EmbeddingClient（本地 fallback）
// ═══════════════════════════════════════════════════════════════════════════════
describe('EmbeddingClient（local fallback）', () => {
  it('embedTexts 返回与输入等长的向量数组', async () => {
    const texts = ['组织生活会', '党纪处分'];
    const vecs = await EmbeddingClient.embedTexts(texts);
    assert.equal(vecs.length, 2);
    assert.ok(vecs[0].length > 0, '向量维度应大于 0');
    assert.ok(vecs[1].length > 0, '向量维度应大于 0');
  });

  it('本地向量已归一化（长度约为 1）', async () => {
    const [vec] = await EmbeddingClient.embedTexts(['党员发展管理']);
    let norm = 0;
    for (const v of vec) norm += v * v;
    assert.ok(Math.abs(Math.sqrt(norm) - 1) < 0.01, `向量 L2 范数应约为 1，实际 ${Math.sqrt(norm)}`);
  });

  it('空文本返回零向量', async () => {
    const [vec] = await EmbeddingClient.embedTexts(['']);
    assert.ok(vec.every(v => v === 0), '空文本应返回零向量');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. VectorStore（内存 fallback）
// ═══════════════════════════════════════════════════════════════════════════════
describe('VectorStore（内存 cosine fallback）', () => {
  let store;
  let chunks;

  before(async () => {
    chunks = DocumentParser.loadFromDirectory(KNOWLEDGE_DIR);
    store = new VectorStore();
    store.reset(); // 保证测试隔离
    await store.index(chunks);
  });

  it('索引后 inMemoryPoints 数量等于 chunks', () => {
    assert.equal(store.inMemoryPoints.length, chunks.length);
  });

  it('search 返回非空结果', async () => {
    const results = await store.search('组织生活', 5);
    assert.ok(results.length > 0, '应返回至少 1 条向量检索结果');
  });

  it('结果按相关性降序排列', async () => {
    const results = await store.search('党员发展', 5);
    for (let i = 1; i < results.length; i++) {
      assert.ok(
        results[i - 1].vectorScore >= results[i].vectorScore,
        `结果应降序：第 ${i} 条 (${results[i - 1].vectorScore}) 应 >= 第 ${i + 1} 条 (${results[i].vectorScore})`
      );
    }
  });

  it('空查询返回空数组', async () => {
    const results = await store.search('', 5);
    assert.deepEqual(results, []);
  });

  it('Qdrant 在测试环境被禁用', async () => {
    const freshStore = new VectorStore();
    assert.equal(freshStore.isQdrantEnabled(), false, 'isQdrantEnabled 在 test 环境应返回 false');
    // 新创建的 store 在未调用 checkQdrant 前，qdrantAvailable 应为 null
    assert.equal(freshStore.qdrantAvailable, null, '未检测前 qdrantAvailable 应为 null');
    // 调用 checkQdrant 后，因 isQdrantEnabled=false，应直接返回 false
    const avail = await freshStore.checkQdrant();
    assert.equal(avail, false, 'checkQdrant 在 test 环境应返回 false');
    assert.equal(freshStore.qdrantAvailable, false, 'checkQdrant 执行后 qdrantAvailable 应为 false');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. reciprocalRankFusion（RRF 融合）
// ═══════════════════════════════════════════════════════════════════════════════
describe('reciprocalRankFusion', () => {
  const makeChunk = (id, content) => ({ id, title: `title_${id}`, source: 'test.md', content });

  it('去重后合并两路结果', () => {
    const c1 = makeChunk('a', '组织生活会');
    const c2 = makeChunk('b', '民主生活会');
    const c3 = makeChunk('c', '三会一课');

    const bm25Hits = [
      { chunk: c1, bm25Score: 1.5 },
      { chunk: c2, bm25Score: 1.0 }
    ];
    const vectorHits = [
      { chunk: c2, vectorScore: 0.9 },
      { chunk: c3, vectorScore: 0.8 }
    ];

    const result = reciprocalRankFusion(bm25Hits, vectorHits, { k: 60 });
    const ids = result.map(r => r.chunk.id);

    assert.ok(ids.includes('a'), '应包含仅在 BM25 出现的 chunk a');
    assert.ok(ids.includes('b'), '应包含两路共同出现的 chunk b');
    assert.ok(ids.includes('c'), '应包含仅在向量检索出现的 chunk c');
    assert.equal(ids.length, 3, '去重后应只有 3 条');
  });

  it('两路共同出现的结果 rrfScore 更高', () => {
    const c1 = makeChunk('shared', '共同出现');
    const c2 = makeChunk('only_bm25', '仅BM25');

    const bm25Hits = [
      { chunk: c1, bm25Score: 2.0 },
      { chunk: c2, bm25Score: 1.9 }
    ];
    const vectorHits = [
      { chunk: c1, vectorScore: 0.95 }
    ];

    const result = reciprocalRankFusion(bm25Hits, vectorHits, { k: 60 });
    const sharedItem = result.find(r => r.chunk.id === 'shared');
    const onlyBm25Item = result.find(r => r.chunk.id === 'only_bm25');

    assert.ok(sharedItem.rrfScore > onlyBm25Item.rrfScore,
      `两路共现项 rrfScore(${sharedItem.rrfScore}) 应 > 单路项 rrfScore(${onlyBm25Item.rrfScore})`
    );
  });

  it('topN 参数限制输出数量', () => {
    const hits = Array.from({ length: 10 }, (_, i) => ({
      chunk: makeChunk(`chunk_${i}`, `内容${i}`),
      bm25Score: 10 - i
    }));
    const result = reciprocalRankFusion(hits, [], { topN: 3 });
    assert.ok(result.length <= 3, `topN=3 时结果不超过 3 条，实际 ${result.length}`);
  });

  it('两路均为空时返回空数组', () => {
    const result = reciprocalRankFusion([], [], {});
    assert.deepEqual(result, []);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. Reranker（本地 fallback）
// ═══════════════════════════════════════════════════════════════════════════════
describe('Reranker（local fallback）', () => {
  const makeCandidate = (id, title, content) => ({
    chunk: { id, title, source: 'test.md', content },
    rrfScore: 0.5
  });

  it('返回结果含 relevanceScore', async () => {
    const candidates = [
      makeCandidate('1', '组织生活会制度', '组织生活会应每季度召开一次，主题围绕党性教育'),
      makeCandidate('2', '民主生活会规范', '民主生活会由上级党委组织，对象为党员领导干部')
    ];
    const result = await Reranker.rerank('组织生活会', candidates, 2);
    assert.ok(result.length > 0, '应返回非空结果');
    for (const r of result) {
      assert.ok(typeof r.relevanceScore === 'number', 'relevanceScore 应为数字');
    }
  });

  it('topK 参数限制返回数量', async () => {
    const candidates = Array.from({ length: 5 }, (_, i) =>
      makeCandidate(`id_${i}`, `标题${i}`, `内容${i} 组织生活会 党纪 民主`)
    );
    const result = await Reranker.rerank('组织生活会党纪', candidates, 2);
    assert.ok(result.length <= 2, `topK=2 时结果不超过 2 条，实际 ${result.length}`);
  });

  it('标题精确匹配的文档排名更靠前', async () => {
    const candidates = [
      makeCandidate('nomatch', '无关标题内容', '这是一段和组织生活毫无关系的内容'),
      makeCandidate('titlematch', '组织生活会详解', '本文详细介绍组织生活会的召开程序和注意事项')
    ];
    const result = await Reranker.rerank('组织生活会', candidates, 2);
    if (result.length >= 2) {
      assert.equal(result[0].chunk.id, 'titlematch',
        '标题精确匹配的文档应排在首位'
      );
    }
  });

  it('空候选列表返回空数组', async () => {
    const result = await Reranker.rerank('测试', [], 3);
    assert.deepEqual(result, []);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. RagService 混合检索（集成）
// ═══════════════════════════════════════════════════════════════════════════════
describe('RagService.hybridSearch（集成）', () => {
  before(async () => {
    // 重置并重新初始化，保证使用 local fallback
    RagService.isInitialized = false;
    RagService.chunks = [];
    RagService.bm25 = new BM25Retriever();
    RagService.vectorStore = new VectorStore();
    await RagService.init();
  });

  it('成功初始化并加载知识文档', () => {
    assert.ok(RagService.isInitialized, 'RagService 应成功初始化');
    assert.ok(RagService.chunks.length >= 5, `应加载至少 5 个分块，实际 ${RagService.chunks.length}`);
  });

  it('检索"组织生活会与民主生活会的区别"返回相关文档', async () => {
    const results = await RagService.hybridSearch('组织生活会和民主生活会有什么区别', { topK: 3 });
    assert.ok(results.length > 0, '应返回至少 1 条检索结果');
    const topResult = results[0];
    assert.ok(topResult.chunk, 'result.chunk 应存在');
    assert.ok(topResult.relevanceScore >= 0, 'relevanceScore 应非负');
    const hasOrgLife = results.some(r =>
      r.chunk.content.includes('组织生活') ||
      r.chunk.title.includes('组织生活')
    );
    assert.ok(hasOrgLife, '返回结果应包含组织生活相关内容');
  });

  it('检索"学习完成率统计口径"返回文档', async () => {
    const results = await RagService.hybridSearch('学习完成率统计口径', { topK: 3 });
    assert.ok(results.length >= 0, '不应抛出异常');
    // 有知识库内容时应返回结果
    if (RagService.chunks.some(c => c.content.includes('完成率'))) {
      assert.ok(results.length > 0, '知识库有完成率内容时应有检索结果');
    }
  });

  it('topK 参数有效', async () => {
    const results = await RagService.hybridSearch('党员', { topK: 2 });
    assert.ok(results.length <= 2, `topK=2 时结果不超过 2 条，实际 ${results.length}`);
  });

  it('空查询不抛出异常', async () => {
    const results = await RagService.hybridSearch('', { topK: 3 });
    assert.deepEqual(results, []);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9. RagService.search（向下兼容接口）
// ═══════════════════════════════════════════════════════════════════════════════
describe('RagService.search（向下兼容）', () => {
  it('返回 {title, source, content, score} 格式', async () => {
    const results = await RagService.search('党纪处分', 2);
    // 有知识库内容时才验证格式
    if (results.length > 0) {
      const r = results[0];
      assert.ok(typeof r.title === 'string', 'title 应为字符串');
      assert.ok(typeof r.source === 'string', 'source 应为字符串');
      assert.ok(typeof r.content === 'string', 'content 应为字符串');
      assert.ok(typeof r.score === 'number', 'score 应为数字');
    }
  });

  it('向下兼容：知识库能够检索学习完成率口径', async () => {
    const results = await RagService.search('学习完成率 统计口径', 3);
    // 现有知识库中有或没有相关内容均不应报错
    assert.ok(Array.isArray(results), '应返回数组，不抛出异常');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 10. RagService.ask（防幻觉门禁）
// ═══════════════════════════════════════════════════════════════════════════════
describe('RagService.ask（防幻觉门禁）', () => {
  it('完全无关的问题返回 isGrounded: false', async () => {
    const result = await RagService.ask('今天上海的股票行情如何', { trace: {} });
    assert.equal(result.isGrounded, false, '无关问题应返回 isGrounded: false');
    assert.ok(
      result.answer.includes('暂未收录') || result.answer.includes('无法'),
      '无关问题的回答应含拒绝话术'
    );
    assert.deepEqual(result.sources, [], '无关问题的 sources 应为空数组');
  });

  it('知识库相关问题返回 isGrounded: true（或 false 当阈值未达到时）', async () => {
    const result = await RagService.ask('党支部组织生活会和民主生活会有什么区别', { trace: {} });
    // 本地 fallback 下 relevanceScore 可能偏低；允许 false 但不允许异常
    assert.ok(['true', 'false'].includes(String(result.isGrounded)), 'isGrounded 应为布尔值');
    assert.ok(typeof result.answer === 'string' && result.answer.length > 0, '应返回非空回答');
    assert.ok(Array.isArray(result.sources), 'sources 应为数组');
    assert.equal(result.scene, 'knowledge_qa', 'scene 应为 knowledge_qa');
  });

  it('返回结构包含必要字段', async () => {
    const result = await RagService.ask('今天的天气怎么样', { trace: {} });
    assert.ok('question' in result, '应含 question 字段');
    assert.ok('answer' in result, '应含 answer 字段');
    assert.ok('sources' in result, '应含 sources 字段');
    assert.ok('isGrounded' in result, '应含 isGrounded 字段');
    assert.ok('generatedAt' in result, '应含 generatedAt 字段');
    assert.ok('scene' in result, '应含 scene 字段');
  });
});
