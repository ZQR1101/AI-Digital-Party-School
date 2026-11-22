// RAG 混合检索系统单元测试
// 覆盖：文档解析分块 → BM25 / 向量双路召回 → RRF 融合 → Reranker 重排
//       → 问答防幻觉兜底 → 学习画像个性化联动 → Qdrant 超时不挂起
process.env.NODE_ENV = 'test';
process.env.QDRANT_ENABLED = 'false';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const DocumentParser = require('../src/rag/documentParser');
const { BM25Retriever, tokenize } = require('../src/rag/bm25');
const { VectorStore, EmbeddingClient, cosineSimilarity } = require('../src/rag/vectorStore');
const { reciprocalRankFusion } = require('../src/rag/fusion');
const Reranker = require('../src/rag/reranker');
const RagService = require('../src/services/ragService');
const { AIClient } = require('../src/services/aiClient');
const LearningProfileService = require('../src/services/learningProfileService');

const KNOWLEDGE_DIR = path.resolve(__dirname, '../knowledge');

// 测试环境禁止调用外部大模型，统一走确定性兜底逻辑
const originalGenerateRagAnswer = AIClient.generateRagAnswer;
const originalGeneratePersonalizedRagAnswer = AIClient.generatePersonalizedRagAnswer;
AIClient.generateRagAnswer = async () => { throw new Error('测试环境禁用外部 LLM'); };
AIClient.generatePersonalizedRagAnswer = async () => { throw new Error('测试环境禁用外部 LLM'); };

test.after(() => {
  AIClient.generateRagAnswer = originalGenerateRagAnswer;
  AIClient.generatePersonalizedRagAnswer = originalGeneratePersonalizedRagAnswer;
});

// ---------------- 文档解析与分块 ----------------

test('文档解析：Markdown 按标题分块并保留来源元数据', () => {
  const markdown = [
    '# 制度规范',
    '',
    '## 第一节',
    '组织生活会每年至少召开一次。',
    '',
    '## 第二节',
    '民主生活会由领导班子成员参加。'
  ].join('\n');

  const chunks = DocumentParser.parseMarkdown(markdown, 'test.md');
  assert.ok(chunks.length >= 2);
  assert.ok(chunks.every(c => c.id && c.source === 'test.md' && c.title && c.content));
  assert.ok(chunks.some(c => c.content.includes('组织生活会')));
});

test('文档解析：真实党校知识库可加载且包含业务场景资料', () => {
  const chunks = DocumentParser.loadFromDirectory(KNOWLEDGE_DIR);
  assert.ok(chunks.length > 10);
  assert.ok(chunks.some(c => c.content.includes('组织生活会') && c.content.includes('民主生活会')));
  assert.ok(chunks.some(c => c.content.includes('已完成') && c.content.includes('应完成')));
});

// ---------------- BM25 关键词检索 ----------------

test('BM25：中文分词包含二元组，相关文档排序靠前', () => {
  const tokens = tokenize('党支部组织生活会');
  assert.ok(tokens.includes('组织'));
  assert.ok(tokens.includes('生活'));
  assert.ok(tokens.includes('组织生')); // 支持到三元gram，提升中文召回率

  const retriever = new BM25Retriever();
  retriever.index([
    { id: 'a', title: '组织生活会', content: '党支部每年至少召开一次组织生活会，开展批评与自我批评。' },
    { id: 'b', title: '纪律处分', content: '党的纪律分为政治纪律、组织纪律和廉洁纪律。' }
  ]);
  const hits = retriever.search('组织生活会', 2);
  assert.equal(hits[0].chunk.id, 'a');
  assert.ok(hits[0].bm25Score > 0);
});

test('BM25：查询词无命中时返回空列表', () => {
  const retriever = new BM25Retriever();
  retriever.index([{ id: 'a', title: '统计口径', content: '学习完成率按任务人次计算。' }]);
  assert.equal(retriever.search('量子纠缠飞船维修').length, 0);
});

// ---------------- 向量检索与 Qdrant 超时防护 ----------------

test('Embedding：本地嵌入为 1024 维单位向量且结果确定', () => {
  const first = EmbeddingClient.localEmbed('组织生活会制度');
  const second = EmbeddingClient.localEmbed('组织生活会制度');
  assert.equal(first.length, 1024);
  assert.ok(Math.abs(cosineSimilarity(first, second) - 1) < 1e-6);
});

test('Qdrant 未启用：连接检查立即返回 false，不产生网络等待', async () => {
  const store = new VectorStore();
  const startedAt = Date.now();
  assert.equal(await store.checkQdrant(), false);
  assert.ok(Date.now() - startedAt < 200, '未启用 Qdrant 时不应发起网络请求');
});

test('Qdrant 不可达：连接检查受硬超时约束，不会挂起', async () => {
  const previous = process.env.QDRANT_ENABLED;
  process.env.QDRANT_ENABLED = 'true';
  try {
    const store = new VectorStore({ qdrantUrl: 'http://10.255.255.1:6333' });
    const startedAt = Date.now();
    assert.equal(await store.checkQdrant(), false);
    assert.ok(Date.now() - startedAt < 2000, 'Qdrant 探测必须在硬超时内结束');
  } finally {
    if (previous === undefined) delete process.env.QDRANT_ENABLED;
    else process.env.QDRANT_ENABLED = previous;
  }
});

test('向量检索：内存索引返回带分数的 Top-K 结果', async () => {
  const store = new VectorStore();
  await store.index([
    { id: 'a', title: '组织生活会', content: '党支部组织生活会每年至少一次' },
    { id: 'b', title: '纪律处分', content: '党的六项纪律' }
  ]);
  const hits = await store.search('组织生活会', 2);
  assert.equal(hits.length, 2);
  assert.ok(hits.every(hit => hit.chunk && typeof hit.vectorScore === 'number'));
});

// ---------------- RRF 融合 ----------------

test('RRF：双路共同命中的文档获得更高融合分', () => {
  const docA = { id: 'a', title: 'A', content: 'A' };
  const docB = { id: 'b', title: 'B', content: 'B' };
  const merged = reciprocalRankFusion(
    [{ chunk: docA, bm25Score: 2 }, { chunk: docB, bm25Score: 1 }],
    [{ chunk: docA, vectorScore: 0.9 }],
    { topN: 10 }
  );

  assert.equal(merged[0].chunk.id, 'a');
  assert.ok(merged[0].rrfScore > merged[1].rrfScore);
  assert.equal(merged[0].bm25Rank, 1);
  assert.equal(merged[0].vectorRank, 1);
  assert.equal(merged[1].vectorRank, null);
});

test('RRF：topN 参数限制融合结果条数', () => {
  const docs = ['a', 'b', 'c', 'd'].map(id => ({ chunk: { id, title: id, content: id }, bm25Score: 1 }));
  assert.equal(reciprocalRankFusion(docs, [], { topN: 2 }).length, 2);
});

// ---------------- Reranker 重排 ----------------

test('Reranker：标题与原文精确命中获得更高相关分', () => {
  const candidates = [
    { chunk: { title: '无关文档', content: '随机内容' }, rrfScore: 0.02 },
    {
      chunk: { title: '组织生活会与民主生活会的区别', content: '组织生活会与民主生活会在参加主体上存在区别' },
      rrfScore: 0.01
    }
  ];
  const ranked = Reranker.localRerank('组织生活会与民主生活会有什么区别', candidates, 2);
  assert.equal(ranked[0].chunk.title, '组织生活会与民主生活会的区别');
  assert.ok(ranked[0].relevanceScore > ranked[1].relevanceScore);
  assert.ok(ranked.every(item => item.relevanceScore >= 0.05 && item.relevanceScore <= 0.98));
});

test('Reranker：空候选集返回空数组', () => {
  assert.deepEqual(Reranker.localRerank('任意问题', [], 5), []);
});

// ---------------- 业务问答与防幻觉 ----------------

test('混合检索：返回 RRF 与重排分数，且不会因 Qdrant 挂起', async () => {
  await RagService.init(true);
  const startedAt = Date.now();
  const hits = await RagService.hybridSearch('组织生活会与民主生活会有什么区别', { topK: 3 });
  assert.ok(Date.now() - startedAt < 2000, '混合检索不得出现外部服务等待');
  assert.ok(hits.length > 0);
  assert.ok(hits.every(hit => typeof hit.relevanceScore === 'number' && typeof hit.rrfScore === 'number'));
});

test('业务场景：组织生活会与民主生活会的区别可检索并带来源回答', async () => {
  const result = await RagService.ask('党支部组织生活会和民主生活会有什么区别？');
  assert.equal(result.scene, 'knowledge_qa');
  assert.equal(result.isGrounded, true);
  assert.ok(result.sources.length > 0);
  assert.ok(result.answer.includes('组织生活会'));
  assert.ok(result.sources[0].source.includes('党组织生活制度规范'));
});

test('防幻觉：知识库无相关内容时明确拒答且不返回来源', async () => {
  const trace = {};
  const result = await RagService.ask('外星文明飞船发动机维修手册如何保养？', { trace });
  assert.equal(result.isGrounded, false);
  assert.equal(result.sources.length, 0);
  assert.match(result.answer, /暂未收录/);
  assert.equal(trace.ragOutcome, 'no_relevant_knowledge');
});

test('向下兼容：search 接口保持标题、来源、内容与分数的结构', async () => {
  const results = await RagService.search('学习完成率统计口径', 2);
  assert.ok(results.length > 0);
  assert.ok(results[0].title && results[0].source && results[0].content);
  assert.equal(typeof results[0].score, 'number');
});

// ---------------- 学习画像 + RAG 联动 ----------------

test('个性化问答：读取薄弱知识点并给出针对性学习建议', async () => {
  const originalGetProfile = LearningProfileService.getProfile;
  LearningProfileService.getProfile = async () => ({
    userName: '测试学员',
    completionRate: 70,
    completedTasks: 7,
    totalTasks: 10,
    weakCategories: [{ category: '组织纪律', wrongRate: 60, wrongCount: 3 }],
    recentWrongQuestions: [{ category: '组织纪律' }]
  });

  try {
    const result = await RagService.personalizedAsk('我最近哪些知识点掌握得不好？', { userId: 1 });
    assert.equal(result.scene, 'learning_evaluation');
    assert.equal(result.profileSummary.userName, '测试学员');
    assert.ok(result.suggestions.some(item => item.title.includes('组织纪律')));
    assert.ok(result.answer.includes('组织纪律'));
    assert.ok(result.sources.length > 0);
  } finally {
    LearningProfileService.getProfile = originalGetProfile;
  }
});

test('个性化问答：缺少学员身份时拒绝访问', async () => {
  await assert.rejects(
    () => RagService.personalizedAsk('我薄弱在哪里', {}),
    /学员身份无效/
  );
});
