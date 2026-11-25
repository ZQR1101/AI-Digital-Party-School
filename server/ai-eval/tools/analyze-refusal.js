/**
 * 拒答门禁诊断（离线、只读）：打印每条拒答样本与问答样本的检索分数分布、
 * Top1/Top2 分差、证据 token 覆盖率，用于比较「固定阈值 / 分数差距 / 证据匹配」策略。
 *
 * 用法：node ai-eval/tools/analyze-refusal.js [--json]
 */
const fs = require('fs');
const path = require('path');

// 业务模块在 require 时加载 dotenv，先加载再清空外部 Key（dotenv 不覆盖已有变量）
const RagService = require('../../src/services/ragService');
const { tokenize } = require('../../src/rag/bm25');
for (const key of [
  'EMBEDDING_API_URL', 'EMBEDDING_API_KEY', 'RERANKER_API_URL', 'RERANKER_API_KEY',
  'DASHSCOPE_API_KEY', 'AI_API_KEY', 'AI_API_URL', 'AI_MODEL'
]) process.env[key] = '';
process.env.NODE_ENV = 'test';
process.env.QDRANT_ENABLED = 'false';

const DATASETS = path.resolve(__dirname, '../datasets');
const load = (name) => JSON.parse(fs.readFileSync(path.join(DATASETS, `${name}.dataset.json`), 'utf8'));

/** 排除高频虚词后，统计查询中多字 token（长度≥2）在分块正文中的覆盖率 */
function evidenceCoverage(query, chunk) {
  const tokens = [...new Set(tokenize(query).filter((t) => t.length >= 2))];
  if (!tokens.length) return { coverage: 0, weighted: 0, hits: [], tokens };
  const text = `${String(chunk?.title || '')} ${String(chunk?.content || '')}`.toLowerCase();
  const hits = tokens.filter((t) => text.includes(t));
  const idf = RagService.bm25.idf;
  const totalWeight = tokens.reduce((n, t) => n + (idf.get(t) || 0.05), 0);
  const hitWeight = hits.reduce((n, t) => n + (idf.get(t) || 0.05), 0);
  return {
    coverage: Math.round((hits.length / tokens.length) * 10000) / 10000,
    weighted: totalWeight ? Math.round((hitWeight / totalWeight) * 10000) / 10000 : 0,
    hits,
    tokens
  };
}

async function main() {
  await RagService.init(true);
  const bm25Top = (q, n) => RagService.bm25.search(q, n);
  const output = [];
  for (const [datasetName, textKey] of [['refusal', 'query'], ['qa', 'question']]) {
    for (const item of load(datasetName).cases) {
      const query = item[textKey];
      const hits = await RagService.hybridSearch(query, { topK: 5, topN: 20 });
      const bm25 = bm25Top(query, 5);
      const top = hits[0];
      const evidence = evidenceCoverage(query, top?.chunk);
      const bestWeighted = Math.max(0, ...hits.slice(0, 3).map((h) => evidenceCoverage(query, h.chunk).weighted));
      const scores = hits.map((h) => h.relevanceScore);
      output.push({
        dataset: datasetName,
        id: item.id,
        split: item.split,
        query,
        expectedSource: item.expectedSource || null,
        domain: item.domain || null,
        scores,
        gap12: scores.length > 1 ? Math.round((scores[0] - scores[1]) * 100) / 100 : null,
        sources: hits.map((h) => h.chunk.source),
        bm25Sources: bm25.map((h) => h.chunk.source),
        evidenceCoverage: evidence.coverage,
        weightedEvidence: evidence.weighted,
        bestWeightedEvidenceTop3: bestWeighted,
        evidenceTokens: evidence.hits,
        topTokens: evidence.tokens,
        topChunk: top ? `${top.chunk.source} / ${top.chunk.title}` : null
      });
    }
  }
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    for (const row of output) {
      console.log(`${row.dataset.padEnd(8)} ${row.id.padEnd(9)} ${row.split.padEnd(8)} gap=${String(row.gap12).padEnd(5)} ev=${row.evidenceCoverage.toFixed(2)} wEv=${row.weightedEvidence.toFixed(2)} best3=${row.bestWeightedEvidenceTop3.toFixed(2)} scores=[${row.scores.join(',')}] ${row.query}`);
      console.log(`         top=${row.topChunk} evidenceTokens=[${row.evidenceTokens.join('|')}]`);
    }
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
