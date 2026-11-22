/**
 * RAG 检索效果评测
 *
 * 对比三种检索策略在带标注评测集上的表现：
 *   - BM25（关键词检索）
 *   - Vector（语义向量检索）
 *   - Hybrid+Rerank（本系统：BM25 + 向量 + RRF 融合 + Reranker 重排）
 *
 * 指标：Hit@K、Recall@K、MRR（Mean Reciprocal Rank）
 * 输出：控制台报告 + server/rag-eval-report.json（可归档）
 *
 * 用法：
 *   NODE_ENV=test node rag-evaluate.js
 * 说明：
 *   默认禁用 Qdrant、使用内存索引保证可复现。
 *   若已配置真实 Embedding/Reranker，则三种策略中 Vector 与 Hybrid 会体现真实语义能力。
 */
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { BM25Retriever } = require('./src/rag/bm25');
const { VectorStore } = require('./src/rag/vectorStore');
const { reciprocalRankFusion } = require('./src/rag/fusion');
const Reranker = require('./src/rag/reranker');
const DocumentParser = require('./src/rag/documentParser');
const RagService = require('./src/services/ragService');

const KNOWLEDGE_DIR = path.resolve(__dirname, 'knowledge');
const K = 3;

/**
 * 评测集：每条含 query 与应命中的来源文档（ground truth）。
 * 刻意采用口语化 / 同义改写提问（而非照抄文档标题），
 * 以考察语义检索相对纯关键词 BM25 的召回与排序差异。
 * 文档名取自 knowledge/ 目录。
 */
const EVAL_SET = [
  { query: '支部每年开的那次组织生活 和领导干部的批评会是不是一回事', relevant: ['党组织生活制度规范.md'] },
  { query: '三会一课到底指的是哪三会哪一课', relevant: ['党组织生活制度规范.md'] },
  { query: '党员之间谈心谈话 以及年底打分评议是怎么安排的', relevant: ['党组织生活制度规范.md'] },
  { query: '刚入党还没转正的预备党员算不算有党龄 这个年限从哪天起算', relevant: ['党员组织关系与党籍管理.md'] },
  { query: '调到别的单位上班 党组织关系需不需要跟着转走', relevant: ['党员组织关系与党籍管理.md'] },
  { query: '月工资四千块 每个月党费要交多少比例', relevant: ['党费收缴使用与管理规定.md'] },
  { query: '大家交上来的党费一般用在哪些地方', relevant: ['党费收缴使用与管理规定.md'] },
  { query: '从递交申请到成为正式党员 中间要经过哪些步骤', relevant: ['党员教育管理与发展工作细则.md'] },
  { query: '作为一名党员 可以行使哪些权利', relevant: ['党章核心要义与党员权利义务.md'] },
  { query: '党员必须做好的八件事具体是哪些', relevant: ['党章核心要义与党员权利义务.md'] },
  { query: '违反党纪之后 可能受到哪几种处分', relevant: ['党规党纪与纪律处分要点.md'] },
  { query: '支部委员会任期满了 改选新的班子要走什么流程', relevant: ['党的基层组织建设与换届选举.md'] },
  { query: '基层党支部平时主要要干好哪些事情', relevant: ['党的基层组织建设与换届选举.md'] },
  { query: '规定里对新闻报道和宣传报道有什么具体约束', relevant: ['中央八项规定精神与作风建设.md'] },
  { query: '形式主义官僚主义享乐主义和奢靡之风分别指什么', relevant: ['中央八项规定精神与作风建设.md'] },
  { query: '党史上那个生死攸关的转折点是哪次会议', relevant: ['党史学习教育要点.md'] },
  { query: '我们党的发展历史大致可以分成哪几个阶段', relevant: ['党史学习教育要点.md'] },
  { query: '后台看板里学习完成率这个指标是怎么算出来的', relevant: ['指标统计口径.md'] },
  { query: '怎样才算一名活跃的党员 统计上怎么定义', relevant: ['指标统计口径.md'] }
];

function sourceOf(hit) {
  // hybrid/rerank 结果里是 { chunk }，bm25/vector 也是 { chunk }
  const chunk = hit.chunk || hit;
  return chunk.source || chunk.title || '';
}

function metrics(rankedSources, relevant, k = K) {
  const top = rankedSources.slice(0, k);
  const relSet = new Set(relevant);
  const hit = top.some(s => relSet.has(s)) ? 1 : 0;
  const found = new Set(top.filter(s => relSet.has(s)));
  const recall = relevant.length ? found.size / relevant.length : 0;
  let rr = 0;
  for (let i = 0; i < top.length; i++) {
    if (relSet.has(top[i])) { rr = 1 / (i + 1); break; }
  }
  return { hit, recall, rr };
}

function aggregate(rows) {
  const n = rows.length || 1;
  return {
    hitAtK: +(rows.reduce((s, r) => s + r.hit, 0) / n).toFixed(4),
    recallAtK: +(rows.reduce((s, r) => s + r.recall, 0) / n).toFixed(4),
    mrr: +(rows.reduce((s, r) => s + r.rr, 0) / n).toFixed(4)
  };
}

(async () => {
  process.env.QDRANT_ENABLED = 'false';

  const chunks = DocumentParser.loadFromDirectory(KNOWLEDGE_DIR);
  const bm25 = new BM25Retriever();
  bm25.index(chunks);
  const vectorStore = new VectorStore();
  await vectorStore.index(chunks);

  const results = { bm25: [], vector: [], hybrid: [] };

  for (const item of EVAL_SET) {
    // 1. BM25 单路
    const bm25Hits = bm25.search(item.query, K);
    results.bm25.push(metrics(bm25Hits.map(sourceOf), item.relevant));

    // 2. 向量单路
    const vectorHits = await vectorStore.search(item.query, K);
    results.vector.push(metrics(vectorHits.map(sourceOf), item.relevant));

    // 3. Hybrid + Rerank（复用 RagService 完整链路）
    const hybridHits = await RagService.hybridSearch(item.query, { topK: K });
    results.hybrid.push(metrics(hybridHits.map(sourceOf), item.relevant));
  }

  const summary = {
    bm25: aggregate(results.bm25),
    vector: aggregate(results.vector),
    hybrid: aggregate(results.hybrid)
  };

  const backend = RagService.getBackendStatus();

  console.log('\n========== RAG 检索效果评测 ==========');
  console.log(`评测集: ${EVAL_SET.length} 条 | K=${K} | 分块数=${chunks.length}`);
  console.log('检索后端:', backend.embedding.backend, '/', backend.reranker.backend);
  console.log('----------------------------------------');
  const fmt = (name, m) => console.log(
    `${name.padEnd(16)} Hit@${K}=${m.hitAtK.toFixed(3)}  Recall@${K}=${m.recallAtK.toFixed(3)}  MRR=${m.mrr.toFixed(3)}`
  );
  fmt('BM25', summary.bm25);
  fmt('Vector', summary.vector);
  fmt('Hybrid+Rerank', summary.hybrid);
  console.log('========================================\n');

  const report = {
    generatedAt: new Date().toISOString(),
    evalCount: EVAL_SET.length,
    k: K,
    chunkCount: chunks.length,
    backend: {
      embedding: backend.embedding,
      reranker: backend.reranker
    },
    summary,
    details: EVAL_SET.map((item, i) => ({
      query: item.query,
      relevant: item.relevant,
      bm25: results.bm25[i],
      vector: results.vector[i],
      hybrid: results.hybrid[i]
    }))
  };
  const reportPath = path.resolve(__dirname, 'rag-eval-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
  console.log('评测报告已写入:', reportPath);

  process.exit(0);
})().catch(err => {
  console.error('评测失败:', err);
  process.exit(1);
});
