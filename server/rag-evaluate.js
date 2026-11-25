/**
 * 历史 RAG 检索评测脚本（保留兼容，不再维护第二套评测逻辑）。
 *
 * 已整合到统一评测体系：
 *   - 评测集：ai-eval/datasets/legacy-rag.dataset.json（原内嵌 19 题）
 *   - 指标库：ai-eval/lib/metrics.js
 *   - 完整基线（40 检索题 / 分块级证据 / 四方案 / 问答 / 问数 / 权限）：
 *     node ai-eval/run-eval.js --mode=offline
 *
 * 本脚本输出 rag-eval-report.json 仅为兼容历史引用。
 * 局限：19 题、50 个分块、仅文档级 Recall@3=100%，
 *   "命中正确文档" 不等于命中正确分块、更不等于答案证据正确。
 *
 * 用法：NODE_ENV=test node rag-evaluate.js
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
const { hitAtK, recallAtK, reciprocalRank, mean } = require('./ai-eval/lib/metrics');

const KNOWLEDGE_DIR = path.resolve(__dirname, 'knowledge');
const K = 3;
const EVAL_SET = require('./ai-eval/datasets/legacy-rag.dataset.json').cases;

function sourceOf(hit) {
  return (hit.chunk || hit).source || (hit.chunk || hit).title || '';
}

function metricsFor(rankedSources, relevant) {
  return {
    hit: hitAtK(rankedSources, relevant, K),
    recall: recallAtK(rankedSources, relevant, K),
    rr: reciprocalRank(rankedSources, relevant, K)
  };
}

function aggregate(rows) {
  return {
    hitAtK: mean(rows.map((r) => r.hit)),
    recallAtK: mean(rows.map((r) => r.recall)),
    mrr: mean(rows.map((r) => r.rr))
  };
}

(async () => {
  process.env.QDRANT_ENABLED = 'false';

  const chunks = await DocumentParser.loadFromDirectoryAsync(KNOWLEDGE_DIR);
  const bm25 = new BM25Retriever();
  bm25.index(chunks);
  const vectorStore = new VectorStore();
  await vectorStore.index(chunks);

  const results = { bm25: [], vector: [], hybrid: [] };
  for (const item of EVAL_SET) {
    results.bm25.push(metricsFor(bm25.search(item.query, K).map(sourceOf), item.relevant));
    results.vector.push(metricsFor((await vectorStore.search(item.query, K)).map(sourceOf), item.relevant));
    // Hybrid + Rerank 复用 RagService 完整链路
    results.hybrid.push(metricsFor((await RagService.hybridSearch(item.query, { topK: K })).map(sourceOf), item.relevant));
  }

  const summary = {
    bm25: aggregate(results.bm25),
    vector: aggregate(results.vector),
    hybrid: aggregate(results.hybrid)
  };
  const backend = RagService.getBackendStatus();

  console.log('\n========== 历史 RAG 检索评测（文档级，仅兼容） ==========');
  console.log(`评测集: ${EVAL_SET.length} 条 | K=${K} | 分块数=${chunks.length}`);
  console.log('检索后端:', backend.embedding.backend, '/', backend.reranker.backend);
  for (const [name, value] of Object.entries(summary)) {
    console.log(`${name.padEnd(16)} Hit@${K}=${value.hitAtK.toFixed(3)}  Recall@${K}=${value.recallAtK.toFixed(3)}  MRR=${value.mrr.toFixed(3)}`);
  }
  console.log('注意：文档级指标不能代表分块/证据级质量，完整评测请运行 ai-eval/run-eval.js');
  console.log('============================================================\n');

  const report = {
    generatedAt: new Date().toISOString(),
    evalCount: EVAL_SET.length,
    k: K,
    chunkCount: chunks.length,
    backend: { embedding: backend.embedding, reranker: backend.reranker },
    summary,
    limitations: [
      '仅 19 道题、文档级Recall@3，命中正确文档不等于命中正确分块或答案证据。',
      '统一基线见 ai-eval/reports/latest.md（40 检索样本、文档级+分块级、四方案对比）。'
    ],
    details: EVAL_SET.map((item, i) => ({
      query: item.query, relevant: item.relevant,
      bm25: results.bm25[i], vector: results.vector[i], hybrid: results.hybrid[i]
    }))
  };
  fs.writeFileSync(path.resolve(__dirname, 'rag-eval-report.json'), JSON.stringify(report, null, 2), 'utf8');
  process.exit(0);
})().catch((err) => {
  console.error('评测失败:', err);
  process.exit(1);
});
