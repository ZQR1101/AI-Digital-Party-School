/**
 * RAG 检索后端诊断脚本
 *
 * 用法：
 *   node rag-diagnose.js              # 仅检查配置与健康状态，不产生外部请求
 *   node rag-diagnose.js --live       # 额外发起真实 Embedding/Rerank 调用与端到端问答
 *
 * 目的：验证真实语义检索是否接通，输出可归档的诊断结论。
 */
require('dotenv').config();

const path = require('path');
const { EmbeddingClient } = require('./src/rag/vectorStore');
const Reranker = require('./src/rag/reranker');
const RagService = require('./src/services/ragService');

const LIVE = process.argv.includes('--live');

function mask(key) {
  if (!key) return '(未配置)';
  return key.slice(0, 6) + '...' + key.slice(-4);
}

function printConfig() {
  console.log('=== RAG 检索后端配置诊断 ===\n');
  const e = EmbeddingClient.getBackendInfo();
  const r = Reranker.getBackendInfo();

  console.log('【Embedding】');
  console.log('  API 端点   :', process.env.EMBEDDING_API_URL || '(未配置 → 本地哈希降级)');
  console.log('  专用 Key   :', mask(process.env.EMBEDDING_API_KEY || process.env.AI_API_KEY));
  console.log('  模型       :', e.model || process.env.EMBEDDING_MODEL || 'BAAI/bge-m3');
  console.log('  目标维度   :', e.dim || 1024);

  console.log('\n【Reranker】');
  console.log('  API 端点   :', process.env.RERANKER_API_URL || '(未配置 → 本地关键词降级)');
  console.log('  专用 Key   :', mask(process.env.RERANKER_API_KEY || process.env.EMBEDDING_API_KEY || process.env.AI_API_KEY));
  console.log('  模型       :', r.model || 'BAAI/bge-reranker-v2-m3');

  const realConfigured = EmbeddingClient.isApiConfigured() && Reranker.isApiConfigured();
  console.log('\n结论:', realConfigured
    ? '✅ 真实 Embedding + Reranker 均已配置（语义检索通路就绪）'
    : '⚠️ 存在未配置项，未配置部分将降级为本地关键词算法（非语义）');
}

async function runLive() {
  console.log('\n=== 真实调用验证 (--live) ===\n');

  // 1. Embedding 真实调用
  try {
    const vecs = await EmbeddingClient.embedTexts(['党支部组织生活会与民主生活会的区别']);
    const info = EmbeddingClient.getBackendInfo();
    console.log('Embedding 后端:', info.backend, '| semantic:', info.semantic, '| 维度:', vecs[0].length);
  } catch (err) {
    console.error('Embedding 调用异常:', err.message);
  }

  // 2. Rerank 真实调用
  const candidates = [
    { chunk: { title: '组织生活会', content: '组织生活会是党支部每年召开一次的组织生活制度' }, rrfScore: 1 },
    { chunk: { title: '民主生活会', content: '民主生活会是党员领导干部召开的批评与自我批评会议' }, rrfScore: 0.5 }
  ];
  try {
    const ranked = await Reranker.rerank('组织生活会与民主生活会区别', candidates, 2);
    const info = Reranker.getBackendInfo();
    console.log('Reranker 后端:', info.backend, '| semantic:', info.semantic, '| 返回:', ranked.length);
    ranked.forEach((r, i) => console.log(`  ${i + 1}. ${r.chunk.title} score=${r.relevanceScore.toFixed(4)}`));
  } catch (err) {
    console.error('Reranker 调用异常:', err.message);
  }

  // 3. 端到端问答 + 后端状态
  try {
    await RagService.init(true);
    const status = RagService.getBackendStatus();
    console.log('\n端到端后端状态:');
    console.log('  embedding.backend:', status.embedding.backend, '| semantic:', status.embedding.semantic);
    console.log('  reranker.backend :', status.reranker.backend, '| semantic:', status.reranker.semantic);
    console.log('  分块数:', status.chunkCount, '| 实际向量维度:', status.vectorDim);

    const question = '党支部组织生活会和民主生活会有什么区别？';
    const answer = await RagService.ask(question);
    console.log('\n问答验证:', question);
    console.log('  grounded:', answer.isGrounded, '| 来源数:', answer.sources.length);
    console.log('  首条来源:', answer.sources[0]?.title || '(无)');
  } catch (err) {
    console.error('端到端问答异常:', err.message);
  }
}

(async () => {
  printConfig();
  if (LIVE) await runLive();
  process.exit(0);
})();
