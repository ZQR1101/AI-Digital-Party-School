/**
 * 检索层评测：复用现有 BM25 / VectorStore / RRF / Reranker，不另造第二套 RAG。
 *
 * 四种可实现的配置：bm25 / vector / hybrid / hybrid_rerank。
 * 双粒度：document（chunk.source ∈ relevant）与 chunk（source 命中且内容包含 evidence 逐字片段）。
 * 指标：Hit@1/3/5、Recall@3/5、MRR@5、平均耗时与 P95。
 */
const { hitAtK, recallAtK, reciprocalRank, mean } = require('./metrics');

const CONFIGS = ['bm25', 'vector', 'hybrid', 'hybrid_rerank'];
const KS = [1, 3, 5];

function chunkSources(hits) {
  return hits.map((h) => (h.chunk || h).source);
}

function isEvidenceHit(hit, caseItem) {
  const chunk = hit.chunk || hit;
  const evidence = caseItem.evidence || [];
  if (!evidence.length) return false;
  return evidence.some((e) => e.source === chunk.source
    && String(chunk.content || '').includes(e.snippet));
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return Math.round(sorted[idx] * 100) / 100;
}

function aggregate(rows) {
  if (!rows.length) return { samples: 0 };
  const out = { samples: rows.length };
  for (const k of KS) out[`hitAt${k}`] = mean(rows.map((r) => r[`hitAt${k}`]));
  for (const k of [3, 5]) out[`recallAt${k}`] = mean(rows.map((r) => r[`recallAt${k}`]));
  out.mrrAt5 = mean(rows.map((r) => r.mrrAt5));
  out.avgMs = mean(rows.map((r) => r.latencyMs));
  out.p95Ms = percentile(rows.map((r) => r.latencyMs), 95);
  return out;
}

function splitSummary(rows) {
  return {
    dev: aggregate(rows.filter((r) => r.split === 'dev')),
    heldout: aggregate(rows.filter((r) => r.split === 'heldout'))
  };
}

/**
 * @param {object} deps { RagService, reciprocalRankFusion, Reranker, topK, topN }
 * @param {Array} cases 检索样本
 * @param {Array} failures 失败诊断收集器
 */
async function evaluateRetrieval(deps, cases, failures, mode) {
  const { RagService, reciprocalRankFusion, Reranker, topK, topN } = deps;
  await RagService.init(true);
  const results = {};
  for (const config of CONFIGS) results[config] = { document: [], chunk: [] };

  for (const item of cases) {
    // 逐段计时并按“端到端累计耗时”归属各配置，避免四种方案共用同一个耗时造成误导
    let started = performance.now();
    const bm25Hits = await RagService.bm25.search(item.query, topN);
    const bm25Ms = performance.now() - started;
    started = performance.now();
    const vectorHits = await RagService.vectorStore.search(item.query, topN);
    const vectorMs = performance.now() - started;
    started = performance.now();
    const rrf = reciprocalRankFusion(bm25Hits, vectorHits, { k: 60, topN });
    const rrfMs = performance.now() - started;
    started = performance.now();
    const reranked = await Reranker.rerank(item.query, rrf, topK);
    const rerankMs = performance.now() - started;
    const ms = (v) => Math.round(v * 100) / 100;
    const latency = {
      bm25: ms(bm25Ms),
      vector: ms(vectorMs),
      hybrid: ms(bm25Ms + vectorMs + rrfMs),
      hybrid_rerank: ms(bm25Ms + vectorMs + rrfMs + rerankMs)
    };
    const candidates = {
      bm25: bm25Hits.slice(0, topK),
      vector: vectorHits.slice(0, topK),
      hybrid: rrf.slice(0, topK),
      hybrid_rerank: reranked
    };

    for (const config of CONFIGS) {
      const hits = candidates[config];
      const docSources = chunkSources(hits);
      const chunkRanked = hits.map((h) => (isEvidenceHit(h, item) ? (h.chunk || h).source : '__miss__'));
      const evidenceSources = (item.evidence || []).map((e) => e.source);
      const base = {
        id: item.id, split: item.split, category: item.category, latencyMs: latency[config]
      };
      const values = (ranked, relevant) => {
        const out = {};
        for (const k of KS) out[`hitAt${k}`] = hitAtK(ranked, relevant, k);
        for (const k of [3, 5]) out[`recallAt${k}`] = recallAtK(ranked, relevant, k);
        out.mrrAt5 = reciprocalRank(ranked, relevant, 5);
        return out;
      };
      results[config].document.push({ ...base, ...values(docSources, item.relevant) });
      results[config].chunk.push({ ...base, ...values(chunkRanked, evidenceSources) });
    }

    // 失败归因只看线上实际配置（hybrid_rerank）
    const finalSources = chunkSources(candidates.hybrid_rerank);
    if (!item.relevant.some((s) => finalSources.includes(s))) {
      const preHit = item.relevant.some((s) => chunkSources(rrf).includes(s));
      failures.push({
        dataset: 'retrieval', id: item.id, category: preHit ? 'rerank_failure' : 'retrieval_failure',
        input: item.query,
        expected: { document: item.relevant, evidence: (item.evidence || []).map((e) => e.snippet) },
        actual: { document: finalSources, chunkMatched: candidates.hybrid_rerank.filter((h) => isEvidenceHit(h, item)).length },
        detail: preHit
          ? '相关来源已进入 RRF 融合候选（topN），但被重排挤出 Top-5'
          : '相关来源在 BM25 / 向量双路召回阶段即未出现',
        sources: finalSources.map((s, i) => `${i + 1}.${s}`).join(' ') || '(空)'
      });
    } else if (!candidates.hybrid_rerank.some((h) => isEvidenceHit(h, item))) {
      failures.push({
        dataset: 'retrieval', id: item.id, category: 'chunk_evidence_miss',
        input: item.query,
        expected: { document: item.relevant, evidence: (item.evidence || []).map((e) => e.snippet) },
        actual: { document: finalSources },
        detail: '文档级命中，但 Top-5 分块均未包含标注的答案证据片段（命中文档不等于命中证据）',
        sources: finalSources.map((s, i) => `${i + 1}.${s}`).join(' ')
      });
    }
  }

  const summary = {};
  for (const config of CONFIGS) {
    summary[config] = {
      document: { ...aggregate(results[config].document), bySplit: splitSummary(results[config].document) },
      chunk: { ...aggregate(results[config].chunk), bySplit: splitSummary(results[config].chunk) }
    };
  }

  return {
    title: '检索四方案对比（文档级 / 分块级）',
    mode,
    topK, topN,
    summary,
    details: results
  };
}

module.exports = { evaluateRetrieval, CONFIGS, isEvidenceHit, percentile };
