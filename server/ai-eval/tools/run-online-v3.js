/**
 * AI 在线质量评测 V3：小规模真实模型对照实验。
 *
 * 设计约束：
 * - 只复用 V1.1.0 样本与 V2 评测器，不改写标准答案、不改变既有 RAG 策略；
 * - 默认 dev 预设 20 条；heldout 预设 5 条，仅用于配置冻结后的独立复核；
 * - 在线模式必须 LLM / Embedding / Reranker 三者全部配置，任何本地 fallback 都会中止并标记 stopped；
 * - API Key 只从环境变量读取，报告中不写入 Key；成本为保守估算，不是账单。
 *
 * 用法：
 *   node ai-eval/tools/run-online-v3.js --mode=offline --preset=v3-online --out=.../v3-offline-dev.json
 *   node ai-eval/tools/run-online-v3.js --mode=online  --preset=v3-online --out=.../v3-online-dev.json
 *   node ai-eval/tools/run-online-v3.js --mode=online  --preset=v3-heldout --out=.../v3-online-heldout.json
 *   node ai-eval/tools/run-online-v3.js --ids=ret-001,qa-001 --limit=2 --mode=offline
 */
const fs = require('fs');
const path = require('path');
const { performance } = require('node:perf_hooks');

require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

function parseArgs(argv) {
  return Object.fromEntries(argv
    .filter((a) => a.startsWith('--'))
    .map((a) => {
      const idx = a.indexOf('=');
      return idx === -1 ? [a.slice(2), true] : [a.slice(2, idx), a.slice(idx + 1)];
    }));
}

const args = parseArgs(process.argv.slice(2));
const MODE = args.mode === 'offline' ? 'offline' : 'online';

// 离线基线必须在业务模块被 require（dotenv 注入）之前清空 Key，避免误触真实 API。
if (MODE === 'offline') {
  process.env.NODE_ENV = 'test';
  process.env.QDRANT_ENABLED = 'false';
  for (const key of [
    'AI_API_KEY', 'AI_API_URL', 'AI_MODEL', 'DASHSCOPE_API_KEY',
    'EMBEDDING_API_URL', 'EMBEDDING_API_KEY', 'EMBEDDING_MODEL',
    'RERANKER_API_URL', 'RERANKER_API_KEY', 'RERANKER_MODEL'
  ]) process.env[key] = '';
}

const { selectSamples } = require('../lib/select-samples');
const { NA, collect, onlineLimits } = require('../lib/envinfo');
const { createBudget } = require('../lib/budget');
const { mean, rateOf } = require('../lib/metrics');
const { evaluateRetrieval } = require('../lib/retrieval-eval');
const {
  instrumentOnlineCalls, resolveTraceArgument, scoreQaCase,
  evalNLQ, TOP_K, TOP_N
} = require('../run-eval');

const { AIClient } = require('../../src/services/aiClient');
const RagService = require('../../src/services/ragService');
const Reranker = require('../../src/rag/reranker');
const { EmbeddingClient } = require('../../src/rag/vectorStore');
const { reciprocalRankFusion } = require('../../src/rag/fusion');
const { hasTopicEvidence } = require('../../src/rag/evidenceGate');

const REPORT_VERSION = '3.0.0';

function positiveNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function sanitizeUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return '(invalid-url)';
  }
}

function v3Limits(options = {}) {
  // 未配置单价时采用保守估算，不冒充真实账单；可通过环境变量覆盖。
  if (!process.env.AI_EVAL_ONLINE_EMBED_COST_PER_REQ) process.env.AI_EVAL_ONLINE_EMBED_COST_PER_REQ = '0.01';
  if (!process.env.AI_EVAL_ONLINE_RERANK_COST_PER_REQ) process.env.AI_EVAL_ONLINE_RERANK_COST_PER_REQ = '0.01';
  const base = onlineLimits();
  return {
    ...base,
    maxRequests: Math.floor(positiveNumber(
      options.maxRequests || process.env.AI_EVAL_V3_MAX_REQUESTS, 80
    )),
    maxCostCny: positiveNumber(
      options.maxCostCny || process.env.AI_EVAL_V3_MAX_COST_CNY, 2
    ),
    pricePerMillionTokens: positiveNumber(
      process.env.AI_EVAL_V3_PRICE_PER_MTOK || process.env.AI_EVAL_ONLINE_PRICE_PER_MTOK, 8
    )
  };
}

function configSummary(limits) {
  return {
    llm: {
      configured: AIClient.isConfigured(),
      model: process.env.AI_MODEL || 'deepseek-chat',
      endpoint: sanitizeUrl(process.env.AI_API_URL),
      toolMode: AIClient.toolMode(),
      timeoutMs: positiveNumber(process.env.AI_TIMEOUT_MS, 12000),
      transportMaxAttempts: 2
    },
    embedding: {
      configured: EmbeddingClient.isApiConfigured(),
      model: process.env.EMBEDDING_MODEL || 'text-embedding-v4',
      endpoint: sanitizeUrl(process.env.EMBEDDING_API_URL),
      dim: positiveNumber(process.env.EMBEDDING_DIM, 1024),
      batchSize: EmbeddingClient.batchSize,
      actualBackend: EmbeddingClient.getBackendInfo()
    },
    reranker: {
      configured: Reranker.isApiConfigured(),
      model: process.env.RERANKER_MODEL || 'qwen3-rerank',
      endpoint: sanitizeUrl(process.env.RERANKER_API_URL),
      actualBackend: Reranker.getBackendInfo()
    },
    limits,
    pricingNote: '单价未配置时按 LLM ¥8/百万 token、Embedding ¥0.01/请求、Rerank ¥0.01/请求估算；实际账单以服务商为准。',
    dataSafety: {
      productionDatabase: 'not_accessed',
      organizationStatistics: 'tool_selection_and_parameters_only',
      sampleExpansion: 'forbidden',
      answersModified: false,
      ragStrategyChanged: false
    }
  };
}

/**
 * 真实模型守卫：业务客户端内部会捕获 API 错误并降级；V3 必须把任何 fallback 视为实验失败，
 * 否则本地哈希向量 / 关键词重排 / 规则解析会被误报为真实模型结果。
 */
function installRealModelGuards() {
  const originalGenerate = AIClient.generateRagAnswer;
  AIClient.generateRagAnswer = async (...args) => {
    const trace = resolveTraceArgument(args);
    const answer = await originalGenerate(...args);
    if (trace.resultMode !== 'model') {
      const reason = trace.errorType || trace.fallbackReason || 'no_model_output';
      throw new Error(`真实 LLM 调用失败（${reason}），拒绝用本地兜底冒充在线结果`);
    }
    return answer;
  };

  const originalIntent = AIClient.identifyQueryIntent;
  AIClient.identifyQueryIntent = async (...args) => {
    const trace = resolveTraceArgument(args);
    const call = await originalIntent(...args);
    if (!call) {
      const reason = trace.errorType || trace.functionCallingFallback || 'no_tool_call';
      throw new Error(`真实 Function Calling 未产出工具调用（${reason}），拒绝规则回退`);
    }
    if (AIClient.toolMode() === 'function' && trace.toolMode !== 'function') {
      throw new Error('真实 Function Calling 不可用，已退化为提示词 JSON 模式');
    }
    return call;
  };

  const originalEmbed = EmbeddingClient.embedTexts;
  EmbeddingClient.embedTexts = async (...embedArgs) => {
    const vectors = await originalEmbed(...embedArgs);
    const info = EmbeddingClient.getBackendInfo();
    if (info.backend && info.backend !== 'api') {
      throw new Error(`Embedding API 调用失败，实际后端=${info.backend}${info.error ? `：${info.error}` : ''}`);
    }
    return vectors;
  };

  const originalRerank = Reranker.rerank;
  Reranker.rerank = async (...rerankArgs) => {
    const hits = await originalRerank(...rerankArgs);
    const info = Reranker.getBackendInfo();
    if (info.backend && info.backend !== 'api') {
      throw new Error(`Reranker API 调用失败，实际后端=${info.backend}${info.error ? `：${info.error}` : ''}`);
    }
    return hits;
  };
}

/**
 * Reranker 403 等接口异常时，只允许使用 C 方案（BM25 + 真实 Embedding + RRF）上下文。
 * 该路径不调用任何本地重排；为了不篡改生产门禁，改用「主题证据 + 非空召回」的 C 方案判定，
 * 并在报告中显式标注 contextScheme，绝不把它当成线上 D 方案结果。
 */
async function hybridSearchWithoutRerank(query, topK = 4) {
  await RagService.init();
  const [bm25Hits, vectorHits] = await Promise.all([
    RagService.bm25.search(query, TOP_N),
    RagService.vectorStore.search(query, TOP_N)
  ]);
  const rrf = reciprocalRankFusion(bm25Hits, vectorHits, { k: 60, topN: TOP_N });
  return rrf.slice(0, topK).map((hit) => ({
    ...hit,
    relevanceScore: Number(hit.vectorScore) || 0
  }));
}

function answerableWithoutRerank(question, hits) {
  const evidence = hasTopicEvidence(question, hits.map((r) => r.chunk), { topK: 3 });
  return hits.length > 0 && evidence.pass;
}

async function probeReranker(budget) {
  const candidate = { chunk: { id: 'v3-probe', title: 'probe', content: 'reranker availability probe' }, rrfScore: 0.032 };
  try {
    await Reranker.rerank('availability probe', [candidate], 1);
    return { available: true, error: null };
  } catch (err) {
    void budget;
    return { available: false, error: err.message };
  }
}

function meanOf(rows, picker) {
  const values = rows.map(picker).filter((v) => typeof v === 'number' && Number.isFinite(v));
  return values.length ? mean(values) : NA;
}

function qaSummary(rows, key) {
  const scored = rows.filter((r) => r[key]?.metrics);
  if (!scored.length) return { samples: 0, status: 'not_run' };
  return {
    samples: scored.length,
    keywordCoverageRate: meanOf(scored, (r) => r[key].metrics.keywordCoverageRate),
    factPointCoverageRate: rateOf(scored, (r) => r[key].metrics.factPointCovered),
    citationNumberValidRate: rateOf(scored, (r) => r[key].metrics.citationValid),
    citationSupportRate: rateOf(scored, (r) => r[key].metrics.citationSupport),
    overRefusalRate: Math.round((1 - rateOf(scored, (r) => r[key].metrics.grounded)) * 10000) / 10000,
    avgGenerationMs: meanOf(scored, (r) => r[key].generationMs),
    avgEndToEndMs: meanOf(scored, (r) => r[key].endToEndMs)
  };
}

async function evalQaComparison(cases, { mode, failures, useReranker = true }) {
  const rows = [];
  await RagService.init();

  for (const item of cases) {
    const started = performance.now();
    const trace = {};
    const hits = useReranker
      ? await RagService.hybridSearch(item.question, { topK: 4 })
      : await hybridSearchWithoutRerank(item.question, 4);
    const retrievalMs = Math.round((performance.now() - started) * 100) / 100;
    const canAnswer = useReranker
      ? RagService.isAnswerable(item.question, hits, trace)
      : answerableWithoutRerank(item.question, hits);
    const sources = hits.map((r, i) => ({
      id: i + 1, title: r.chunk.title, source: r.chunk.source,
      relevanceScore: r.relevanceScore
    }));

    let llm = { status: 'not_run', reason: '离线基线不调用真实 LLM' };
    if (canAnswer) {
      const context = hits.map((r, i) => `[${i + 1}] 《${r.chunk.source}》- ${r.chunk.title}\n${r.chunk.content}`).join('\n\n');

      if (mode === 'online') {
        const llmTrace = {};
        const genStarted = performance.now();
        const answer = await AIClient.generateRagAnswer({ question: item.question, context }, llmTrace);
        const generationMs = Math.round((performance.now() - genStarted) * 100) / 100;
        const cleaned = RagService.sanitizeCitations(answer, hits.length);
        const result = { answer: cleaned.answer, sources, isGrounded: true };
        const metrics = scoreQaCase(item, result, llmTrace, failures, 'qa_llm');
        llm = {
          status: 'completed', metrics, generationMs,
          endToEndMs: Math.round((performance.now() - started) * 100) / 100,
          model: llmTrace.model || null,
          invalidCitations: cleaned.invalidCitations
        };
      }

      const fallbackStarted = performance.now();
      const fallbackAnswer = RagService.buildFallbackAnswer(hits, item.question);
      const deterministicMetrics = scoreQaCase(
        item, { answer: fallbackAnswer, sources, isGrounded: true }, {}, failures, 'qa_deterministic'
      );
      rows.push({
        id: item.id, split: item.split, question: item.question,
        canAnswer, topSource: sources[0]?.source ?? null,
        topScore: sources[0]?.relevanceScore ?? null,
        retrievalMs,
        llm,
        deterministic: {
          status: 'completed', metrics: deterministicMetrics,
          generationMs: Math.round((performance.now() - fallbackStarted) * 100) / 100,
          endToEndMs: Math.round((performance.now() - started) * 100) / 100
        }
      });
      continue;
    }

    // QA 样本均为知识库可回答题；门禁未通过即视为过度拒答，两种生成方式都不应伪造答案。
    const refusalResult = {
      answer: '党校知识库中暂未收录与该问题直接相关的规章制度或学习资料，无法为您准确解答。',
      sources: [], isGrounded: false
    };
    const metrics = scoreQaCase(item, refusalResult, {}, failures, 'qa_llm');
    const deterministicMetrics = scoreQaCase(item, refusalResult, {}, failures, 'qa_deterministic');
    rows.push({
      id: item.id, split: item.split, question: item.question,
      canAnswer: false, topSource: sources[0]?.source ?? null,
      topScore: sources[0]?.relevanceScore ?? null,
      retrievalMs,
      llm: { status: 'completed', metrics, generationMs: 0, endToEndMs: retrievalMs, gate: trace.evidenceGate || null },
      deterministic: { status: 'completed', metrics: deterministicMetrics, generationMs: 0, endToEndMs: retrievalMs }
    });
  }

  return {
    title: 'LLM 问答与确定性兜底对照（同一检索上下文）',
    contextScheme: useReranker ? 'D：BM25 + 真实 Embedding + RRF + 真实 Reranker' : 'C：BM25 + 真实 Embedding + RRF（Reranker 不可用，显式标注）',
    summary: {
      llm: qaSummary(rows, 'llm'),
      deterministicFallback: qaSummary(rows, 'deterministic'),
      humanVerifiedFactAccuracy: NA,
      llmJudgeScore: NA
    },
    limitNote: '事实要点覆盖与引用支持均为启发式，不等价于人工事实准确率。',
    cases: rows
  };
}

/** 与现有 evalRefusal 同口径，但在 Reranker 不可用时改用 C 方案上下文，不走本地重排。 */
async function evalRefusalV3(cases, failures, { useReranker = true } = {}) {
  const rows = [];
  await RagService.init();
  for (const item of cases) {
    const hits = useReranker
      ? await RagService.hybridSearch(item.query, { topK: 4 })
      : await hybridSearchWithoutRerank(item.query, 4);
    const canAnswer = useReranker
      ? RagService.isAnswerable(item.query, hits, {})
      : answerableWithoutRerank(item.query, hits);
    // 拒答样本本应无依据；canAnswer=true 即异常回答风险。
    const refused = !canAnswer;
    const scores = hits.map((h) => Number(h.relevanceScore) || 0);
    rows.push({
      id: item.id, split: item.split, domain: item.domain, refused,
      topScore: scores[0] ?? 0,
      scoreGap: scores.length > 1 ? Math.round((scores[0] - scores[1]) * 100) / 100 : 0,
      gate: useReranker ? null : { topicEvidenceOnly: true },
      sources: refused ? [] : hits.slice(0, 4).map((h) => h.chunk.source)
    });
    if (!refused) {
      failures.push({
        dataset: 'refusal', id: item.id, category: 'unwarranted_answer',
        input: item.query, expected: { isGrounded: false, sources: [] },
        actual: { canAnswer: true, topScore: scores[0] ?? null },
        detail: '知识库不含该事实，系统仍判定为可回答'
      });
    }
  }
  const summaryOf = (subset) => ({
    samples: subset.length,
    refusalRate: rateOf(subset, 'refused'),
    unwarrantedAnswerRate: Math.round((1 - rateOf(subset, 'refused')) * 10000) / 10000,
    avgTopScore: meanOf(subset, (r) => r.topScore),
    avgScoreGap: meanOf(subset, (r) => r.scoreGap)
  });
  return {
    title: '无依据拒答',
    contextScheme: useReranker ? 'D 方案上下文' : 'C 方案上下文（Reranker 不可用）',
    summary: summaryOf(rows),
    bySplit: {
      dev: summaryOf(rows.filter((r) => r.split === 'dev')),
      heldout: summaryOf(rows.filter((r) => r.split === 'heldout'))
    },
    cases: rows
  };
}

function emptySuite(name) {
  return { title: name, summary: { samples: NA }, status: 'not_run' };
}

async function runV3({ mode = 'online', preset = 'v3-online', ids, categories, split, limit, maxRequests, maxCostCny } = {}) {
  const selection = selectSamples({ preset: preset || undefined, ids, categories, split, limit });
  const limits = v3Limits({ maxRequests, maxCostCny });
  const budget = createBudget(limits);
  const config = configSummary(limits);
  const failures = [];
  const suites = {
    retrieval: emptySuite('四方案检索质量（A/B/C/D）'),
    qa: emptySuite('问答生成质量'),
    refusal: emptySuite('无依据拒答'),
    nlq: emptySuite('自然语言统计查询工具调用')
  };

  const missing = [];
  if (mode === 'online') {
    if (!config.llm.configured) missing.push('LLM');
    if (!config.embedding.configured) missing.push('Embedding');
    if (!config.reranker.configured) missing.push('Reranker');
  }

  let status = 'completed';
  let stopReason = null;
  let rerankerDegraded = null;
  if (mode === 'online' && missing.length) {
    status = 'not_run';
    stopReason = `真实模型未完整配置（缺少 ${missing.join('、')}）；不得用本地 fallback 冒充在线结果`;
  } else {
    try {
      if (mode === 'online') {
        if (process.env.AI_EVAL_ONLINE !== '1') {
          throw new Error('在线评测需显式设置 AI_EVAL_ONLINE=1');
        }
        instrumentOnlineCalls({ AIClient, RagService, Reranker, EmbeddingClient }, budget);
        installRealModelGuards();
      }

      let rerankerAvailable = true;
      let rerankerError = null;
      if (mode === 'online') {
        const probe = await probeReranker(budget);
        rerankerAvailable = probe.available;
        rerankerError = probe.error;
        if (!rerankerAvailable) {
          rerankerDegraded = rerankerError;
          failures.push({
            dataset: 'runtime', id: NA, category: 'rerank_api_error',
            input: 'Reranker availability probe', expected: '真实 Reranker 可用',
            actual: { error: rerankerError },
            detail: 'Reranker 接口异常；D 方案标记 not_run，后续问答/拒答使用 C 方案上下文，不使用本地重排冒充真实模型'
          });
        }
      }

      const enabledConfigs = rerankerAvailable ? undefined : ['bm25', 'vector', 'hybrid'];
      suites.retrieval = await evaluateRetrieval(
        { RagService, reciprocalRankFusion, Reranker, topK: TOP_K, topN: TOP_N },
        selection.cases.filter((c) => c.dataset === 'retrieval'), failures, mode,
        enabledConfigs ? { configs: enabledConfigs } : {}
      );
      suites.retrieval.summary = {
        A_bm25: suites.retrieval.summary.bm25,
        B_embedding: suites.retrieval.summary.vector,
        C_bm25_embedding_rrf: suites.retrieval.summary.hybrid,
        D_bm25_embedding_rrf_reranker: suites.retrieval.summary.hybrid_rerank
          || { status: 'not_run', reason: rerankerError || 'Reranker 未配置', samples: NA },
        topK: TOP_K, topN: TOP_N,
        backend: RagService.getBackendStatus(),
        disabledConfigs: suites.retrieval.disabledConfigs || []
      };

      suites.qa = await evalQaComparison(selection.cases.filter((c) => c.dataset === 'qa'), {
        mode, failures, useReranker: rerankerAvailable
      });
      suites.refusal = await evalRefusalV3(
        selection.cases.filter((c) => c.dataset === 'refusal'), failures, { useReranker: rerankerAvailable }
      );
      suites.nlq = await evalNLQ(
        selection.cases.filter((c) => c.dataset === 'nlq'), failures,
        mode === 'online' ? budget : null,
        { requireLlm: mode === 'online' }
      );
      if (mode === 'online') {
        suites.nlq.executionScope = '仅解析工具选择与参数，不执行任何组织统计查询，不访问业务数据库';
      }
    } catch (err) {
      status = 'stopped';
      stopReason = err.message;
      failures.push({
        dataset: 'runtime', id: NA, category: mode === 'online' ? 'online_api_error' : 'offline_error',
        input: NA, expected: '评测正常完成', actual: { error: stopReason },
        detail: '评测中止；已完成的分组保留，未完成分组不填充估算值'
      });
    }
  }

  const usage = budget.summary();
  if (usage.stopped && status !== 'not_run') {
    status = 'stopped';
    stopReason ||= usage.stopReason;
  }
  config.embedding.actualBackend = EmbeddingClient.getBackendInfo();
  config.reranker.actualBackend = Reranker.getBackendInfo();

  const report = {
    reportVersion: REPORT_VERSION,
    datasetVersion: selection.meta.datasetVersion,
    mode,
    status,
    degraded: Boolean(rerankerDegraded),
    stopReason,
    generatedAt: new Date().toISOString(),
    selection: selection.meta,
    online: mode === 'online'
      ? { status, reason: stopReason, usage, note: '成本为估算值，实际账单以服务商为准。' }
      : { status: 'not_run', reason: '离线基线强制关闭外部模型，在线指标不参与本次结果。', usage },
    environment: collect({ mode, config }),
    limitations: [
      '在线样本量很小（dev 20 条，heldout 5 条），只做配置层对照，不足以证明全量质量提升。',
      'Recall@5 / MRR@5 使用标注来源与逐字证据片段；事实要点覆盖与引用支持是启发式指标。',
      '拒答判定依赖检索门禁；LLM 只在门禁通过时生成，拒答本身不消耗 LLM token。',
      '成本按保守单价估算，Token 事后计费与服务商账单可能存在差异。',
      '组织统计仅做工具选择与参数解析，未执行 SQL，也未访问生产或隔离业务库。',
      ...(rerankerDegraded
        ? [`Reranker 接口异常（${rerankerDegraded}）：D 方案为 not_run；问答/拒答使用 C 方案上下文，并仅保留主题证据门禁，不代表线上 D 链路。`]
        : [])
    ],
    suites,
    failures,
    usage
  };
  return report;
}

function writeJson(report, outPath) {
  const target = path.resolve(outPath || path.join(__dirname, '..', 'reports', `v3-${report.mode}-${report.selection.preset || 'custom'}.json`));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`);
  return target;
}

module.exports = { runV3, v3Limits, installRealModelGuards, configSummary, qaSummary };

if (require.main === module) {
  runV3({
    mode: MODE,
    preset: args.preset === true ? undefined : args.preset,
    ids: args.ids === true ? undefined : args.ids,
    categories: args.categories === true ? undefined : args.categories,
    split: args.split === true ? undefined : args.split,
    limit: args.limit === true ? undefined : Number(args.limit),
    maxRequests: args['max-requests'] === true ? undefined : Number(args['max-requests']),
    maxCostCny: args['max-cost'] === true ? undefined : Number(args['max-cost'])
  }).then((report) => {
    const file = writeJson(report, args.out === true ? undefined : args.out);
    console.log(`V3 ${report.mode}：${report.status}，样本 ${report.selection.count}，请求 ${report.usage.requests}，估算 ¥${report.usage.estimatedCostCny}`);
    console.log(`报告：${file}`);
    if (report.stopReason) console.log(`原因：${report.stopReason}`);
    process.exit(report.status === 'stopped' ? 2 : 0);
  }).catch((err) => {
    console.error('V3 评测失败:', err.stack);
    process.exit(1);
  });
}
