/**
 * V4 评测器：在新知识库（knowledge-v4）与 V4 数据集上做四方案对照。
 * 复用现有 RAG / 评测库（evaluateRetrieval / budget / envinfo），不新建平行架构。
 *
 * 用法：
 *   KNOWLEDGE_DIR=knowledge-v4 node ai-eval/tools/v4/run-v4.js --mode=offline --out=ai-eval/reports/v4/offline.json
 *   KNOWLEDGE_DIR=knowledge-v4 AI_EVAL_ONLINE=1 node ai-eval/tools/v4/run-v4.js --mode=online --sample=12 --max-requests=60 --max-cost=2 --out=ai-eval/reports/v4/online.json
 *
 * 离线强制清空外部 Key；在线必须显式开关+严格预算；真实模型失败标 not_run，不用本地降级冒充。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '../../..');
const DATA_DIR = path.resolve(ROOT, 'ai-eval/datasets/v4');
const OUT_DIR = path.resolve(ROOT, 'ai-eval/reports/v4');
// 兜底：V4 工具默认必须运行在扩展库上，避免漏传 KNOWLEDGE_DIR 时静默评测生产库
if (!process.env.KNOWLEDGE_DIR) process.env.KNOWLEDGE_DIR = path.resolve(ROOT, 'knowledge-v4');
const KB_DIR = path.resolve(ROOT, process.env.KNOWLEDGE_DIR);
const NA = 'N/A';

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}
function mode() { return arg('mode', 'offline'); }
function isOnline() { return mode() === 'online' || mode() === 'review'; }

// 离线模式在 require 业务模块前清空外部 Key（dotenv 不会覆盖已存在的空串）
if (!isOnline()) {
  for (const k of ['EMBEDDING_API_URL', 'EMBEDDING_API_KEY', 'RERANKER_API_URL', 'RERANKER_API_KEY',
    'DASHSCOPE_API_KEY', 'AI_API_KEY', 'AI_API_URL', 'AI_MODEL', 'SILICONFLOW_API_KEY']) process.env[k] = '';
}

const DATASETS = ['retrieval', 'qa', 'refusal', 'citation'];
function load(name) {
  const p = path.join(DATA_DIR, `${name}.dataset.json`);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function knowledgeFingerprint() {
  const files = fs.readdirSync(KB_DIR).filter((f) => f.endsWith('.md')).sort();
  const h = crypto.createHash('sha256');
  for (const f of files) { h.update(f); h.update(fs.readFileSync(path.join(KB_DIR, f))); }
  return { dir: process.env.KNOWLEDGE_DIR || 'knowledge', files: files.length, sha256: h.digest('hex') };
}
function mean(vals) { const a = vals.filter((v) => typeof v === 'number' && Number.isFinite(v)); return a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10000) / 10000 : NA; }
function rate(rows, key) { return mean(rows.map((r) => (r[key] ? 1 : 0))); }

// 数据集指纹（V4 要求记录 SHA256）
function datasetFingerprints() {
  const out = {};
  for (const name of DATASETS) out[name] = sha256(path.join(DATA_DIR, `${name}.dataset.json`));
  return out;
}

async function runRetrieval(cases, failures, online) {
  const { evaluateRetrieval } = require('../../lib/retrieval-eval');
  const RagService = require('../../../src/services/ragService');
  const { reciprocalRankFusion } = require('../../../src/rag/fusion');
  const Reranker = require('../../../src/rag/reranker');
  const topK = 5, topN = 20;
  const result = await evaluateRetrieval(
    { RagService, reciprocalRankFusion, Reranker, topK, topN }, cases, failures, mode()
  );
  // 多证据完整覆盖率：Top-5 是否覆盖该样本全部“必需来源”（逐来源判断，非文档级命中率）
  const completeness = {};
  const multi = cases.filter((c) => (c.evidence || []).length > 1);
  if (online && multi.length) {
    // 在线模式避免为覆盖指标重复调用外部 API（严格预算）；该指标仅在离线全量计算。
    for (const cfg of result.enabledConfigs) completeness[cfg] = { status: 'not_run_online', samples: multi.length, rate: NA };
  } else if (multi.length) {
    const { reciprocalRankFusion } = require('../../../src/rag/fusion');
    for (const cfg of result.enabledConfigs) {
      let coveredCount = 0;
      for (const c of multi) {
        const requiredSources = [...new Set(c.evidence.map((e) => e.source))];
        let sources = [];
        if (cfg === 'bm25') sources = (await RagService.bm25.search(c.query, topK)).map((h) => (h.chunk || h).source);
        else if (cfg === 'vector') sources = (await RagService.vectorStore.search(c.query, topK)).map((h) => (h.chunk || h).source);
        else {
          const [b, v] = await Promise.all([
            RagService.bm25.search(c.query, topN), RagService.vectorStore.search(c.query, topN)
          ]);
          const rrf = reciprocalRankFusion(b, v, { k: 60, topN });
          if (cfg === 'hybrid') sources = rrf.slice(0, topK).map((h) => (h.chunk || h).source);
          else sources = (await Reranker.rerank(c.query, rrf, topK)).map((h) => (h.chunk || h).source);
        }
        if (requiredSources.every((s) => sources.includes(s))) coveredCount += 1;
      }
      completeness[cfg] = { samples: multi.length, covered: coveredCount, rate: Math.round((coveredCount / multi.length) * 10000) / 10000 };
    }
  }
  result.evidenceCompleteness = completeness;
  return result;
}

function bigrams(text) {
  const s = String(text).replace(/[\s，。；：、（）()""''《》%]/g, '');
  const out = [];
  for (let i = 0; i + 1 < s.length; i++) out.push(s.slice(i, i + 2));
  return out;
}
function factCoverage(answer, facts) {
  const a = String(answer);
  if (!facts.length) return NA;
  const covered = facts.filter((f) => {
    if (a.includes(f)) return true;
    const bg = bigrams(f);
    if (!bg.length) return false;
    return bg.filter((g) => a.includes(g)).length / bg.length >= 0.6;
  }).length;
  return Math.round((covered / facts.length) * 10000) / 10000;
}

/**
 * 独立的 LLM 人工复核批次：真实 LLM 逐条回答 30 条 QA，产出待人工标注的工作表。
 * 自动启发式分数单独记录，人工字段一律留空（null），不得预填。
 */
async function runReview({ RagService, datasets, report, budget }) {
  const rows = [];
  let stopped = false;
  for (const c of datasets.qa.cases) {
    if (budget && budget.summary().stopped) { stopped = true; break; }
    const trace = {};
    try {
      const r = await RagService.ask(c.question, { trace });
      const answer = String(r.answer || '');
      rows.push({
        id: c.id, split: c.split, category: c.category,
        question: c.question, goldAnswer: c.answer, requiredFacts: c.requiredFacts,
        modelAnswer: answer,
        mode: trace.resultMode || 'unknown',
        grounded: r.isGrounded !== false,
        sources: (r.sources || []).map((s) => ({ source: s.source, title: s.title || '', snippet: String(s.snippet || '').slice(0, 300) })),
        auto: {
          factCoverage: factCoverage(answer, c.requiredFacts || []),
          keywordCoverage: (() => { const kw = c.expectedKeywords || []; return kw.length ? Math.round((kw.filter((k) => answer.includes(k)).length / kw.length) * 10000) / 10000 : NA; })(),
          sourceMatched: (r.sources || []).some((s) => s.source === c.expectedSource),
          answerChars: answer.length,
          extractiveDump: /## 条文原文|根据党校知识库资料/.test(answer)
        },
        human: { factCorrect: null, complete: null, citationSupported: null, errorType: null, reviewer: null, reviewedAt: null, note: null }
      });
    } catch (err) {
      rows.push({
        id: c.id, split: c.split, category: c.category, question: c.question,
        goldAnswer: c.answer, requiredFacts: c.requiredFacts,
        modelAnswer: null, mode: 'error', grounded: null, sources: [],
        auto: { factCoverage: NA, keywordCoverage: NA, sourceMatched: false, answerChars: 0, extractiveDump: false },
        human: { factCorrect: null, complete: null, citationSupported: null, errorType: null, reviewer: null, reviewedAt: null, note: null },
        error: err.message
      });
    }
  }

  const ok = rows.filter((r) => r.modelAnswer !== null);
  const llmOnly = ok.filter((r) => r.mode === 'model');
  const meanCoverage = (list) => (list.length ? Math.round((list.reduce((s, r) => s + r.auto.factCoverage, 0) / list.length) * 10000) / 10000 : NA);
  const out = {
    version: '4.0.0', phase: 'llm_human_review_batch', generatedAt: new Date().toISOString(),
    gitCommit: require('../../lib/envinfo').gitSha(),
    knowledgeBase: report.knowledgeBase, datasetSha256: report.datasetSha256,
    backend: report.backend, budget: { limits: report.budget ? report.budget.limits : null, usage: budget ? budget.summary() : null },
    summary: {
      requested: datasets.qa.cases.length, completed: ok.length, failed: rows.length - ok.length,
      llmGenerated: llmOnly.length,
      deterministicFallback: ok.length - llmOnly.length,
      deterministicFallbackIds: ok.filter((r) => r.mode !== 'model').map((r) => r.id),
      autoMeanFactCoverage: meanCoverage(ok),
      llmOnlyMeanFactCoverage: meanCoverage(llmOnly),
      autoSourceMatchedRate: ok.length ? Math.round((ok.filter((r) => r.auto.sourceMatched).length / ok.length) * 10000) / 10000 : NA,
      extractiveDumpCount: ok.filter((r) => r.auto.extractiveDump).length,
      meanAnswerChars: ok.length ? Math.round(ok.reduce((s, r) => s + r.auto.answerChars, 0) / ok.length) : NA
    },
    status: stopped ? 'stopped' : 'completed',
    stopReason: stopped ? (budget.summary().stopReason || 'budget_stop') : null,
    note: 'human 字段全部为 null，必须由人工逐条填写；auto 为启发式分数，二者分开统计。',
    cases: rows
  };

  const jsonPath = path.resolve(OUT_DIR, 'human-review-batch.json');
  fs.writeFileSync(jsonPath, JSON.stringify(out, null, 2));

  const md = ['# V4 LLM 问答人工复核工作表', '',
    `- 生成时间：${out.generatedAt} ｜ 模型：${process.env.AI_MODEL || '(未配置)'}`,
    `- 样本：${out.summary.completed}/${out.summary.requested} 条（LLM 生成 ${out.summary.llmGenerated} 条，确定性兜底 ${out.summary.deterministicFallback} 条：${out.summary.deterministicFallbackIds.join(', ') || '无'}）`,
    `- 自动启发式（仅供参考，不等同人工结论）：事实要点覆盖均值 ${out.summary.autoMeanFactCoverage}（仅 LLM ${out.summary.llmOnlyMeanFactCoverage}），来源匹配率 ${out.summary.autoSourceMatchedRate}，疑似原文整段摘录 ${out.summary.extractiveDumpCount} 条，平均答案长度 ${out.summary.meanAnswerChars} 字`,
    `- 状态：**pending_human_review**。请逐条填写 事实正确性 / 完整性 / 引用支持 / 错误类型，填写后在 JSON 中把 human.* 置为 true/false 并记录复核人。`,
    '', '| # | 问题 | 标准答案 | 模型答案 | 自动事实覆盖 | 摘录标记 | 人工:事实正确 | 人工:完整 | 人工:引用支持 | 错误类型 |', '| --- | --- | --- | --- | ---: | --- | --- | --- | --- | --- |'];
  rows.forEach((r, i) => {
    const clean = (s) => String(s == null ? '' : s).replace(/\|/g, '｜').replace(/\n/g, ' ').slice(0, 220);
    md.push(`| ${i + 1} | ${clean(r.question)} | ${clean(r.goldAnswer)} | ${clean(r.modelAnswer || r.error)} | ${r.auto.factCoverage} | ${r.auto.extractiveDump ? '整段摘录' : ''} |  |  |  |  |`);
  });
  fs.writeFileSync(path.resolve(OUT_DIR, 'human-review-batch.md'), md.join('\n'));

  console.log(`LLM 复核批次完成：${out.summary.completed}/${out.summary.requested}，LLM ${out.summary.llmGenerated} / 兜底 ${out.summary.deterministicFallback} -> ${jsonPath}`);
  if (out.budget.usage) console.log(`预算：请求 ${out.budget.usage.requests}，估算 ¥${out.budget.usage.estimatedCostCny}`);
  return out;
}

function main() {
  const online = isOnline();
  if (online && process.env.AI_EVAL_ONLINE !== '1') {
    console.error('在线评测需显式设置 AI_EVAL_ONLINE=1'); process.exit(2);
  }
  // 数据集
  const datasets = Object.fromEntries(DATASETS.map((n) => [n, load(n)]));
  // 代表性在线抽样：按类别分层，总量不超过 --sample（默认12）
  let selection = { note: '离线全量', count: Object.values(datasets).reduce((a, d) => a + d.cases.length, 0) };
  if (online && mode() === 'review') {
    // 复核批次：使用全部 30 条问答样本，不做在线抽样
    selection = { note: 'LLM 人工复核批次（全部问答样本）', count: datasets.qa.cases.length, ids: datasets.qa.cases.map((c) => c.id) };
  } else if (online) {
    const cap = Math.min(20, Math.max(1, Number(arg('sample', '12'))));
    const all = DATASETS.flatMap((n) => datasets[n].cases.map((c) => ({ ...c, dataset: n })));
    const byCat = {};
    all.forEach((c) => { (byCat[c.category] = byCat[c.category] || []).push(c); });
    const picked = [];
    // 先保证每个数据集至少 1 条（问答/拒答/引用必须参与在线对照）
    for (const name of DATASETS) {
      const first = all.find((c) => c.dataset === name);
      if (first && picked.length < cap) { picked.push(first); byCat[first.category] = byCat[first.category].filter((c) => c.id !== first.id); }
    }
    // QA/拒答再多抽，保证生成质量对照有足量样本
    for (const name of ['qa', 'refusal']) {
      const more = all.filter((c) => c.dataset === name && !picked.some((p) => p.id === c.id)).slice(0, 2);
      more.forEach((c) => { if (picked.length < cap) { picked.push(c); byCat[c.category] = byCat[c.category].filter((x) => x.id !== c.id); } });
    }
    // 剩余按类别轮转补足
    const cats = Object.keys(byCat).filter((c) => byCat[c].length);
    for (let i = 0; picked.length < cap && cats.length; i++) {
      const cat = cats[i % cats.length];
      if (byCat[cat] && byCat[cat].length) picked.push(byCat[cat].shift());
      if (cats.every((c) => !byCat[c] || !byCat[c].length)) break;
    }
    for (const name of DATASETS) datasets[name] = { ...datasets[name], cases: picked.filter((c) => c.dataset === name) };
    selection = { note: '在线分层抽样（每类至少1条，总量上限20）', count: picked.length, ids: picked.map((c) => c.id) };
  }

  const failures = [];
  const report = {
    version: '4.0.0', mode: mode(), generatedAt: new Date().toISOString(),
    gitCommit: require('../../lib/envinfo').gitSha(),
    knowledgeBase: knowledgeFingerprint(),
    datasetSha256: datasetFingerprints(),
    selection,
    backend: null, suites: {}, failures,
    limitations: [
      'V4 为独立知识库（knowledge-v4）与独立数据集 v4.0.0，不与 V1.1.0 基线混算。',
      '事实要点覆盖、引用支持为启发式指标，人工复核另行记录，不等同人工事实准确率。',
      '在线仅代表性小样本，成本为估算值；真实模型失败标 not_run，不用本地降级冒充。'
    ]
  };

  let budget = null;

  (async () => {
    const RagService = require('../../../src/services/ragService');
    const { EmbeddingClient } = require('../../../src/rag/vectorStore');
    const Reranker = require('../../../src/rag/reranker');
    const { AIClient } = require('../../../src/services/aiClient');
    if (online) {
      const { createBudget } = require('../../lib/budget');
      const { onlineLimits } = require('../../lib/envinfo');
      const limits = { ...onlineLimits(), maxRequests: Number(arg('max-requests', '60')), maxCostCny: Number(arg('max-cost', '2')) };
      budget = createBudget(limits);
      report.budget = { limits, usage: null };
      // 复用 V3 已验证的计量钩子与真实模型守卫，禁止本地降级冒充真实结果
      const { instrumentOnlineCalls } = require('../../run-eval');
      const { installRealModelGuards } = require('../run-online-v3');
      instrumentOnlineCalls({ AIClient, RagService, Reranker, EmbeddingClient }, budget);
      installRealModelGuards();
    }
    await RagService.init(true);
    report.backend = {
      rag: RagService.getBackendStatus ? RagService.getBackendStatus() : null,
      embedding: EmbeddingClient.getBackendInfo(),
      reranker: Reranker.getBackendInfo()
    };
    if (mode() === 'review') {
      await runReview({ RagService, datasets, report, budget });
      return;
    }
    report.suites.retrieval = await runRetrieval(datasets.retrieval.cases, failures, online);

    // R4 问题4：LLM 问答 vs 确定性摘录（此处先记录确定性基线；在线 LLM 在 online 模式另跑）
    const qaRows = [];
    for (const c of datasets.qa.cases) {
      const trace = {};
      try {
        const result = await RagService.ask(c.question, { trace });
        const sources = result.sources || [];
        const answer = String(result.answer || '');
        const kw = c.expectedKeywords || [];
        const hit = kw.filter((k) => answer.includes(k)).length / Math.max(1, kw.length);
        qaRows.push({ id: c.id, split: c.split, grounded: result.isGrounded, sourceMatched: sources.some((s) => s.source === c.expectedSource), keywordCoverage: hit, mode: trace.resultMode || 'deterministic' });
      } catch (err) {
        qaRows.push({ id: c.id, split: c.split, status: 'not_run', error: err.message, mode: 'error' });
        failures.push({ dataset: 'qa', id: c.id, category: 'online_api_error', detail: '真实模型失败，拒绝用本地降级冒充', actual: { error: err.message } });
      }
    }
    const qaOk = qaRows.filter((r) => r.status !== 'not_run');
    report.suites.qa = { samples: qaRows.length, executed: qaOk.length,
      deterministic: {
        factPointCoverageRate: mean(qaOk.map((r) => r.keywordCoverage)),
        sourceMatchedRate: rate(qaOk, 'sourceMatched'), overRefusalRate: mean(qaOk.map((r) => (r.grounded ? 0 : 1))),
        byMode: { llm: qaOk.filter((r) => r.mode === 'model').length, fallback: qaOk.filter((r) => r.mode !== 'model').length }
      }, rows: qaRows,
      llm: { status: online && qaOk.some((r) => r.mode === 'model') ? 'completed' : 'not_run', note: '在线模式由真实 LLM 生成；离线为确定性摘录。人工复核表另行记录。' } };

    // 拒答
    const rfRows = [];
    for (const c of datasets.refusal.cases) {
      try {
        const r = await RagService.ask(c.query, {});
        rfRows.push({ id: c.id, split: c.split, answerable: c.answerable, refused: !r.isGrounded });
      } catch (err) {
        rfRows.push({ id: c.id, split: c.split, answerable: c.answerable, refused: null, status: 'not_run', error: err.message });
        failures.push({ dataset: 'refusal', id: c.id, category: 'online_api_error', detail: '真实模型失败，拒绝用本地降级冒充', actual: { error: err.message } });
      }
    }
    const noAns = rfRows.filter((r) => !r.answerable && r.refused !== null);
    report.suites.refusal = { samples: rfRows.length,
      noAnswerCorrectRefusalRate: noAns.length ? mean(noAns.map((r) => (r.refused ? 1 : 0))) : NA,
      rows: rfRows };

    // 引用真实性（确定性校验：引用编号范围）
    const citRows = [];
    for (const c of datasets.citation.cases) {
      const nums = [...String(c.answer).matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
      const invalid = nums.filter((n) => n < 1 || n > c.validCount);
      citRows.push({ id: c.id, split: c.split, valid: invalid.length === 0, invalid, expectInvalid: c.expectInvalid });
    }
    report.suites.citation = { samples: citRows.length, validRate: rate(citRows, 'valid'), rows: citRows };

    // 人工复核工作表：至少30条代表性问答（确定性+证据已备好，待人工判定）
    const reviewCases = [...datasets.qa.cases,
      ...datasets.retrieval.cases.filter((c) => c.evidence && c.evidence.length > 1),
      ...datasets.refusal.cases, ...datasets.citation.cases]
      .slice(0, 40).map((c) => ({
        id: c.id, category: c.category, split: c.split,
        question: c.question || c.query,
        standardAnswer: c.answer || NA,
        requiredFacts: c.requiredFacts || NA,
        evidence: c.evidence || [],
        humanFields: { factCorrect: '', complete: '', citationSupported: '', errorType: '', reviewer: '', reviewedAt: '' }
      }));
    report.humanReviewSheet = { status: 'pending_human_review', count: reviewCases.length, note: '以下字段须由人工逐条填写；自动启发式评分与本表分开记录', cases: reviewCases };
    if (budget) {
      const usage = budget.summary();
      report.budget.usage = usage;
      if (usage.stopped) { report.status = 'stopped'; report.stopReason = usage.stopReason; }
      else report.status = 'completed';
    } else report.status = 'completed';

    const outPath = path.resolve(ROOT, arg('out', 'ai-eval/reports/v4/offline.json'));
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`V4 ${mode()} 完成：${selection.count} 条样本 -> ${outPath}`);
    if (report.failures.length) console.log(`失败/诊断 ${report.failures.length} 条`);
  })().catch((err) => {
    report.status = 'stopped';
    report.stopReason = err.message;
    failures.push({ dataset: 'runtime', id: NA, category: 'online_api_error', detail: '评测中止，已完成分组保留，未完成不填充估算值', actual: { error: err.message } });
    if (budget) report.budget.usage = budget.summary();
    const outPath = path.resolve(ROOT, arg('out', 'ai-eval/reports/v4/offline.json'));
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
    console.error(`V4 评测中止（已写部分报告）: ${err.message} -> ${outPath}`);
  });
}

main();
