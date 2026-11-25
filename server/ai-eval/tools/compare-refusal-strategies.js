/**
 * 拒答策略对比（只读诊断）：固定阈值 / 分数差距 / 主题证据匹配 / 组合策略。
 *
 * 阈值与策略只在 dev 上选择；heldout 仅作为最终独立复核写入报告，
 * 不用于反复调参。原始样本与标准答案不作任何改动。
 *
 * 用法：node ai-eval/tools/compare-refusal-strategies.js
 * 输出：ai-eval/reports/refusal-strategy-analysis.json
 */
const fs = require('fs');
const path = require('path');

const RagService = require('../../src/services/ragService');
const { hasTopicEvidence } = require('../../src/rag/evidenceGate');
for (const key of [
  'EMBEDDING_API_URL', 'EMBEDDING_API_KEY', 'RERANKER_API_URL', 'RERANKER_API_KEY',
  'DASHSCOPE_API_KEY', 'AI_API_KEY', 'AI_API_URL', 'AI_MODEL'
]) process.env[key] = '';
process.env.NODE_ENV = 'test';
process.env.QDRANT_ENABLED = 'false';

const ROOT = path.resolve(__dirname, '../..');
const DATASETS = path.join(ROOT, 'ai-eval/datasets');
const OUTPUT = path.join(ROOT, 'ai-eval/reports/refusal-strategy-analysis.json');
const BASE_THRESHOLD = 0.24; // 离线本地回退阈值（业务原值，不因本次优化提高）
const FIXED_THRESHOLD = 0.27; // 仅在 dev 上选取：dev 拒答最高 0.26、正常问答最低 0.27
const GAP_THRESHOLD = 0.02;   // 仅在 dev 上尝试：Top1-Top2 分差策略

const load = (name) => JSON.parse(fs.readFileSync(path.join(DATASETS, `${name}.dataset.json`), 'utf8'));

async function main() {
  await RagService.init(true);
  const rows = [];
  for (const [dataset, textKey] of [['refusal', 'query'], ['qa', 'question']]) {
    for (const item of load(dataset).cases) {
      const query = item[textKey];
      const hits = await RagService.hybridSearch(query, { topK: 5, topN: 20 });
      const evidence = hasTopicEvidence(query, hits.map((h) => h.chunk), { topK: 3 });
      const scores = hits.map((h) => h.relevanceScore);
      rows.push({
        id: item.id, dataset, split: item.split, query,
        topScore: scores[0] ?? 0,
        scoreGap: scores.length > 1 ? Math.round((scores[0] - scores[1]) * 100) / 100 : 0,
        sources: hits.map((h) => h.chunk.source),
        evidencePass: evidence.pass,
        evidencePhrases: evidence.phrases,
        evidenceMatched: evidence.matched,
        hasRealAnswerEvidence: dataset === 'qa' && evidence.pass
      });
    }
  }

  const strategies = {
    // V1 基线：只按原始相关性阈值判定
    baseline: (r) => r.topScore < BASE_THRESHOLD,
    // 方案 A：仅提高固定阈值（明确不在生产采用，只作对照）
    fixedThreshold: (r) => r.topScore < FIXED_THRESHOLD,
    // 方案 B：仅用 Top1/Top2 分差
    scoreGap: (r) => r.scoreGap < GAP_THRESHOLD,
    // 方案 C：保留原阈值 + 主题证据匹配
    evidenceMatch: (r) => r.topScore < BASE_THRESHOLD || !r.evidencePass,
    // 方案 D：固定阈值 + 主题证据（本次实际采用的组合等价于方案 C：阈值不动）
    combined: (r) => r.topScore < BASE_THRESHOLD || !r.evidencePass
  };

  const evaluate = (rows, predicate, expectedRefusal) => {
    const subset = rows.filter((r) => r.dataset === expectedRefusal);
    const normal = rows.filter((r) => r.dataset !== expectedRefusal);
    const refused = subset.filter(predicate).length;
    const overRefused = normal.filter(predicate).length;
    return {
      samples: subset.length,
      refused,
      refusalRate: Math.round((refused / subset.length) * 10000) / 10000,
      normalSamples: normal.length,
      overRefused,
      overRefusalRate: Math.round((overRefused / normal.length) * 10000) / 10000
    };
  };

  const analysis = {
    generatedAt: new Date().toISOString(),
    datasetVersion: load('refusal').version,
    note: 'dev 用于选择策略；heldout 仅最终独立复核。基线与所有备选方案均在同一原始样本上计算，未改标注。',
    thresholds: { base: BASE_THRESHOLD, fixed: FIXED_THRESHOLD, gap: GAP_THRESHOLD },
    selectedStrategy: 'evidenceMatch（保留原阈值 0.24 + 主题证据匹配；未提高全局阈值）',
    byStrategy: Object.fromEntries(Object.entries(strategies).map(([name, predicate]) => [name, {
      dev: evaluate(rows.filter((r) => r.split === 'dev'), predicate, 'refusal'),
      heldoutFinalCheckOnly: evaluate(rows.filter((r) => r.split === 'heldout'), predicate, 'refusal')
    }])),
    cases: rows
  };

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, `${JSON.stringify(analysis, null, 2)}\n`, 'utf8');
  console.log(`拒答策略分析已写入 ${OUTPUT}`);
  for (const [name, result] of Object.entries(analysis.byStrategy)) {
    console.log(`${name.padEnd(15)} dev 拒答 ${result.dev.refusalRate} 误拒 ${result.dev.overRefusalRate} ｜ heldout(最终复核) 拒答 ${result.heldoutFinalCheckOnly.refusalRate} 误拒 ${result.heldoutFinalCheckOnly.overRefusalRate}`);
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
