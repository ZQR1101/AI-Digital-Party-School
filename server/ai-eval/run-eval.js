// AI 质量评测 V2 入口（V1.1.0 数据集不变；先校准评测器，再做有证据的优化）
//
// 用法：
//   npm run eval:offline                                # CI 门禁（dev 为依据，确定性无外部 API）
//   node ai-eval/run-eval.js --mode=offline             # 本地离线全量
//   AI_EVAL_ONLINE=1 AI_API_URL=... AI_API_KEY=... \
//   EMBEDDING_API_URL=... EMBEDDING_API_KEY=... \
//   RERANKER_API_URL=... RERANKER_API_KEY=... \
//   npm run eval:online                                 # 真实模型；严格显式开启，有请求/成本上限
//
// 离线模式把外部 Key 置空字符串（dotenv 不覆盖已存在变量，避免模块加载时重新注入），
// 强制本地哈希向量 + 本地关键词重排 + 规则解析 + 确定性兜底答案。
const fs = require('fs');
const path = require('path');

const DATASET_VERSION = require('./datasets/retrieval.dataset.json').version;
const FIXED_NOW = new Date('2026-06-15T02:00:00Z'); // 北京时间 2026-06-15 10:00
const TOP_K = 5;
const TOP_N = 20;
const OFFLINE_STRIP_KEYS = [
  'EMBEDDING_API_URL', 'EMBEDDING_API_KEY', 'RERANKER_API_URL', 'RERANKER_API_KEY',
  'DASHSCOPE_API_KEY', 'AI_API_KEY', 'AI_API_URL', 'AI_MODEL'
];
const DATASETS_DIR = path.join(__dirname, 'datasets');

// 预加载业务模块：db/config 在 require 时会加载 dotenv，必须先加载再清空外部 Key
require('../src/services/ragService');
require('../src/rag/reranker');
require('../src/ai/queryParser');
require('../src/ai/queryTools');
require('../src/services/aiClient');
require('../src/services/organizationAccess');

const { writeReports, truncate } = require('./lib/report');
const { hitAtK, recallAtK, reciprocalRank, keywordCoverage, missingKeywords, rateOf, mean } = require('./lib/metrics');
const { evaluateRetrieval } = require('./lib/retrieval-eval');
const { NA, collect, onlineLimits } = require('./lib/envinfo');
const { evaluateDbTruth } = require('./lib/db-truth');
const { FLOORS, evaluateGate } = require('./lib/gate');
const { createBudget } = require('./lib/budget');

function loadDataset(name) {
  return JSON.parse(fs.readFileSync(path.join(DATASETS_DIR, `${name}.dataset.json`), 'utf8'));
}

function pushFailure(failures, value) {
  failures.push(value);
}

const bySplitSummary = (rows, summaryOf) => ({
  dev: summaryOf(rows.filter((r) => r.split === 'dev')),
  heldout: summaryOf(rows.filter((r) => r.split === 'heldout'))
});

/**
 * AIClient 所有 LLM 方法的签名均为 (input, trace = {})，trace 固定在最后一个参数。
 * 不能简单取「第一个对象」（generateRagAnswer({question, context}, trace) 会取到请求体）。
 */
function resolveTraceArgument(args) {
  if (args.length >= 2) {
    const last = args[args.length - 1];
    if (last && typeof last === 'object' && !Array.isArray(last)) return last;
    const replacement = {};
    args[args.length - 1] = replacement;
    return replacement;
  }
  const trace = {};
  args.push(trace);
  return trace;
}

/** 在线模式下统一包裹外部模型调用：请求数（含重试）、tokens、成本、超预算即停 */
function instrumentOnlineCalls({ AIClient, RagService, Reranker, EmbeddingClient }, budget) {
  const llmMethods = [
    'identifyQueryIntent', 'generateRagAnswer', 'generatePersonalizedRagAnswer', 'generateGroundedAnalysis'
  ];
  for (const name of llmMethods) {
    if (typeof AIClient[name] !== 'function') continue;
    const original = AIClient[name].bind(AIClient);
    AIClient[name] = async (...args) => {
      if (!AIClient.isConfigured()) return original(...args);
      const trace = resolveTraceArgument(args);
      // 首次与重试都由 attemptHook 在 axios.post 前 reserve，避免请求数与报告计数不一致。
      trace.onAttempt = budget.attemptHook('llm', trace);
      try {
        return await original(...args);
      } finally {
        budget.recordUsage(trace);
      }
    };
  }

  const embedOriginal = EmbeddingClient.embedTexts.bind(EmbeddingClient);
  EmbeddingClient.embedTexts = async (texts) => {
    const requests = EmbeddingClient.isApiConfigured() ? Math.ceil(texts.length / EmbeddingClient.batchSize) : 0;
    if (requests) budget.reserve('embedding', requests);
    const vectors = await embedOriginal(texts);
    if (requests) budget.recordExternal('embedding', requests);
    return vectors;
  };

  const rerankOriginal = Reranker.rerank.bind(Reranker);
  Reranker.rerank = async (query, candidates, topK) => {
    if (!Reranker.isApiConfigured()) return rerankOriginal(query, candidates, topK);
    budget.reserve('rerank', 1);
    const result = await rerankOriginal(query, candidates, topK);
    budget.recordExternal('rerank', 1);
    return result;
  };

  // RagService 内部持有的是同一静态类对象；无需替换其实例引用
  void RagService;
}

// ---------- 问答质量（真实 RagService 链路） ----------
async function evalQA(cases, failures) {
  const RagService = require('../src/services/ragService');
  const rows = [];
  await RagService.init(true);

  for (const item of cases) {
    const trace = {};
    const result = await RagService.ask(item.question, { trace });
    const sources = result.sources || [];
    const sourceMatched = sources.some((s) => s.source === item.expectedSource);
    const keywordCoverageRate = keywordCoverage(result.answer, item.expectedKeywords);
    const citedNumbers = [...String(result.answer).matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
    const invalidCitations = citedNumbers.filter((n) => n < 1 || n > sources.length);
    // 引用支持度（启发式、可人工复核）：被引用来源的证据片段出现在答案中，
    // 或该来源证据片段覆盖至少一半标准答案要点。不是 LLM Judge，也不等价于事实正确。
    const evidence = item.evidence || [];
    const supportHit = evidence.some((e) => {
      if (!sources.some((s) => s.source === e.source)) return false;
      return String(result.answer).includes(e.snippet)
        || keywordCoverage(e.snippet, item.expectedKeywords) >= 0.5;
    });
    const fallback = !trace.resultMode;
    const row = {
      id: item.id, split: item.split, sourceMatched,
      // 仅为「标准答案要点覆盖率」的启发式判定，不冒充人工验证的事实准确率
      factPointCovered: keywordCoverageRate >= 0.6,
      keywordCoverageRate,
      citationValid: citedNumbers.length ? invalidCitations.length === 0 : true,
      citationSupport: supportHit, grounded: result.isGrounded, fallback,
      hasAnswer: Boolean(result.answer)
    };
    rows.push(row);

    if (!result.isGrounded) {
      pushFailure(failures, {
        dataset: 'qa', id: item.id, category: 'over_refusal',
        input: truncate(item.question), expected: { source: item.expectedSource, keywords: item.expectedKeywords },
        actual: { isGrounded: false, topScore: sources[0]?.relevanceScore ?? null, gate: trace.evidenceGate || null },
        detail: '知识库可回答的问题被拒答', sources: '(空)'
      });
    } else if (!sourceMatched) {
      pushFailure(failures, {
        dataset: 'qa', id: item.id, category: 'retrieval_failure',
        input: truncate(item.question), expected: { source: item.expectedSource, keywords: item.expectedKeywords },
        actual: { sources: sources.map((s) => s.source) },
        detail: '回答来源中未包含预期文档'
      });
    } else if (!row.factPointCovered) {
      pushFailure(failures, {
        dataset: 'qa', id: item.id, category: 'generation_failure',
        input: truncate(item.question), expected: { keywords: item.expectedKeywords },
        actual: {
          keywordCoverageRate, missingKeywords: missingKeywords(result.answer, item.expectedKeywords), fallback
        },
        detail: fallback ? '确定性兜底摘录未覆盖标准答案要点' : '模型答案未覆盖标准答案要点',
        sources: sources.map((s) => `${s.id}.${s.source}`).join(' ')
      });
    }
    if (invalidCitations.length) {
      pushFailure(failures, {
        dataset: 'qa', id: item.id, category: 'citation_error',
        input: truncate(item.question), expected: { validRange: [1, sources.length] },
        actual: { citedNumbers, invalidCitations }, detail: '答案引用编号越界'
      });
    }
    if (result.isGrounded && sourceMatched && !supportHit) {
      pushFailure(failures, {
        dataset: 'qa', id: item.id, category: 'citation_error',
        input: truncate(item.question), expected: { evidence: evidence.map((e) => e.snippet) },
        actual: { answer: truncate(result.answer, 160) },
        detail: '来源文件命中，但答案内容未体现该来源的证据片段（引用对应性辅助判定）'
      });
    }
  }

  const summaryOf = (subset) => ({
    samples: subset.length,
    keywordCoverageRate: mean(subset.map((r) => r.keywordCoverageRate)), // 关键词覆盖率（非事实正确率）
    factPointCoverageRate: rateOf(subset, 'factPointCovered'),           // 启发式要点覆盖，非人工验证
    humanVerifiedFactAccuracy: NA,
    citationNumberValidRate: rateOf(subset, 'citationValid'),
    citationSupportRate: rateOf(subset, 'citationSupport'),             // 启发式证据支持度
    // 全部 QA 样本均为知识库可回答的问题，isGrounded=false 即正常问答误拒
    overRefusalRate: Math.round((1 - rateOf(subset, 'grounded')) * 10000) / 10000,
    fallbackReliabilityRate: rateOf(subset, (r) => r.fallback ? (r.hasAnswer && r.grounded) : true),
    llmJudgeScore: NA
  });
  return {
    title: '问答质量（真实 RagService 链路；启发式判定）',
    summary: summaryOf(rows),
    bySplit: bySplitSummary(rows, summaryOf)
  };
}

// ---------- 拒答 ----------
async function evalRefusal(cases, failures) {
  const RagService = require('../src/services/ragService');
  const rows = [];
  await RagService.init(true);
  for (const item of cases) {
    const trace = {};
    const result = await RagService.ask(item.query, { trace });
    const sources = result.sources || [];
    const refused = result.isGrounded === false && sources.length === 0;
    const scores = sources.map((s) => Number(s.relevanceScore) || 0);
    rows.push({
      id: item.id, split: item.split, domain: item.domain, refused,
      topScore: scores[0] ?? 0,
      scoreGap: scores.length > 1 ? Math.round((scores[0] - scores[1]) * 100) / 100 : 0,
      gate: trace.evidenceGate || null,
      sources: sources.map((s) => s.source)
    });
    if (!refused) {
      pushFailure(failures, {
        dataset: 'refusal', id: item.id, category: 'unwarranted_answer',
        input: truncate(item.query), expected: { isGrounded: false, sources: [] },
        actual: {
          isGrounded: result.isGrounded, topScore: scores[0] ?? null,
          scoreGap: rows[rows.length - 1].scoreGap, gate: trace.evidenceGate || null
        },
        detail: '知识库不含该事实，系统仍给出带来源的回答',
        sources: sources.map((s) => s.source).join(' ') || '(空)'
      });
    }
  }
  const summaryOf = (subset) => ({
    samples: subset.length,
    refusalRate: rateOf(subset, 'refused'),
    unwarrantedAnswerRate: Math.round((1 - rateOf(subset, 'refused')) * 10000) / 10000,
    avgTopScore: mean(subset.map((r) => r.topScore)),
    avgScoreGap: mean(subset.map((r) => r.scoreGap))
  });
  return {
    title: '无答案拒答', summary: summaryOf(rows),
    bySplit: bySplitSummary(rows, summaryOf),
    cases: rows
  };
}

// ---------- 引用编号清洗 ----------
async function evalCitation(cases, failures) {
  const RagService = require('../src/services/ragService');
  const rows = [];
  for (const item of cases) {
    const { answer, invalidCitations } = RagService.sanitizeCitations(item.answer, item.validCount);
    const keptOk = (item.expectAnswerContains || []).every((frag) => answer.includes(frag))
      && (item.expectAnswerNotContains || []).every((frag) => !answer.includes(frag));
    const invalidOk = JSON.stringify([...invalidCitations].sort((a, b) => a - b))
      === JSON.stringify([...(item.expectInvalid || [])].sort((a, b) => a - b));
    const pass = keptOk && invalidOk;
    rows.push({ id: item.id, split: item.split, pass });
    if (!pass) {
      pushFailure(failures, {
        dataset: 'citation', id: item.id, category: 'citation_error',
        input: truncate(item.answer),
        expected: { invalid: item.expectInvalid, contains: item.expectAnswerContains },
        actual: { invalid: invalidCitations, answer: truncate(answer, 200) },
        detail: '引用编号清洗结果与预期不符'
      });
    }
  }
  const summaryOf = (subset) => ({ samples: subset.length, accuracy: rateOf(subset, 'pass') });
  return {
    title: '引用编号校验', summary: summaryOf(rows), bySplit: bySplitSummary(rows, summaryOf)
  };
}

// ---------- 自然语言统计查询 ----------
async function evalNLQ(cases, failures, budget) {
  const { parseOrganizationQuery } = require('../src/ai/queryParser');
  const { validateToolCall, normalizeToolParameters, mapParsedQueryToToolCall, toolForMetric } = require('../src/ai/queryTools');
  const { AIClient } = require('../src/services/aiClient');
  const rows = [];

  for (const item of cases) {
    let parsed = null;
    let tool = null;
    let intentMode = 'rules';
    const trace = {};
    if (budget && AIClient.isConfigured()) {
      try {
        const call = await AIClient.identifyQueryIntent(item.message, trace);
        if (call) {
          parsed = normalizeToolParameters(validateToolCall(call), FIXED_NOW);
          tool = call.tool;
          intentMode = 'llm';
        }
      } catch (err) {
        pushFailure(failures, {
          dataset: 'nlq', id: item.id, category: 'tool_error', input: truncate(item.message),
          expected: '在线工具调用', actual: { error: truncate(err.message, 100) }, detail: '在线调用受预算或模型限制中断'
        });
      }
    }
    if (!parsed) {
      try {
        const ruleParsed = parseOrganizationQuery(item.message, FIXED_NOW);
        const mapped = mapParsedQueryToToolCall(ruleParsed);
        const validated = validateToolCall(mapped);
        parsed = normalizeToolParameters(validated, FIXED_NOW);
        tool = validated.tool;
      } catch (err) {
        pushFailure(failures, {
          dataset: 'nlq', id: item.id, category: 'tool_error', input: truncate(item.message),
          expected: item.expect, actual: null, detail: `规则解析异常：${err.message}`
        });
        continue;
      }
    }

    const actual = {
      metric: parsed.metric, organizationName: parsed.organizationName ?? null,
      timeRangeLabel: parsed.timeRange?.label ?? null, groupBy: parsed.groupBy ?? null, tool
    };
    const expect = {
      metric: item.expect.metric, organizationName: item.expect.organizationName ?? null,
      timeRangeLabel: item.expect.timeRangeLabel ?? null, groupBy: item.expect.groupBy ?? null,
      tool: item.expect.tool || toolForMetric(item.expect.metric)
    };
    const fields = {
      metric: actual.metric === expect.metric,
      organizationName: actual.organizationName === expect.organizationName,
      timeRange: actual.timeRangeLabel === expect.timeRangeLabel,
      groupBy: actual.groupBy === expect.groupBy
    };
    // 独立比对实际工具名称，不再用 metricAccuracy 代替 toolSelectionAccuracy
    const toolOk = actual.tool === expect.tool;
    const exact = toolOk && Object.values(fields).every(Boolean);
    rows.push({ id: item.id, split: item.split, toolOk, exact, fields, intentMode, actualTool: actual.tool, expectedTool: expect.tool });
    if (!exact) {
      pushFailure(failures, {
        dataset: 'nlq', id: item.id, category: 'tool_error', input: truncate(item.message),
        expected: expect, actual,
        detail: `${intentMode === 'llm' ? 'LLM 意图' : '规则解析'}字段错误：${[
          ...(toolOk ? [] : ['tool']),
          ...Object.entries(fields).filter(([, ok]) => !ok).map(([k]) => k)
        ].join('、')}`
      });
    }
  }

  const summaryOf = (subset) => ({
    samples: subset.length,
    toolSelectionAccuracy: rateOf(subset, 'toolOk'),
    metricAccuracy: rateOf(subset, (r) => r.fields.metric),
    organizationAccuracy: rateOf(subset, (r) => r.fields.organizationName),
    timeRangeAccuracy: rateOf(subset, (r) => r.fields.timeRange),
    groupByAccuracy: rateOf(subset, (r) => r.fields.groupBy),
    exactMatchRate: rateOf(subset, 'exact')
  });
  return {
    title: '自然语言统计查询（工具选择 / 参数准确率）',
    summary: {
      ...summaryOf(rows),
      intentModeSplit: rows.reduce((acc, r) => { acc[r.intentMode] = (acc[r.intentMode] || 0) + 1; return acc; }, {})
    },
    bySplit: bySplitSummary(rows, summaryOf)
  };
}

// ---------- 工具调用结构校验 ----------
async function evalToolParams(cases, failures) {
  const { validateToolCall, normalizeToolParameters, extractToolCall } = require('../src/ai/queryTools');
  const rows = [];
  for (const item of cases) {
    let pass = false;
    let actual = null;
    try {
      let call;
      if (item.input.message) call = extractToolCall(null, item.input.message);
      else if (item.input.content) call = extractToolCall(item.input.content, null);
      else call = validateToolCall(item.input);
      const normalized = normalizeToolParameters(call, FIXED_NOW);
      actual = {
        tool: normalized.tool, metric: normalized.metric,
        organizationName: normalized.organizationName ?? null,
        timeRangeLabel: normalized.timeRange?.label ?? null, groupBy: normalized.groupBy ?? null
      };
      if (item.expect === 'accept') {
        pass = Object.entries(item.expectNormalized || {}).every(([k, v]) => actual[k] === v);
        if (!pass) {
          pushFailure(failures, {
            dataset: 'toolParams', id: item.id, category: 'tool_error', input: truncate(JSON.stringify(item.input)),
            expected: item.expectNormalized, actual, detail: '合法调用被接受但归一化结果不符'
          });
        }
      } else {
        pushFailure(failures, {
          dataset: 'toolParams', id: item.id, category: 'permission_error', input: truncate(JSON.stringify(item.input)),
          expected: 'reject', actual, detail: '非法工具参数未被拒绝（可能形成越权/任意参数通道）'
        });
      }
    } catch (err) {
      if (item.expect === 'reject') pass = true;
      else {
        pushFailure(failures, {
          dataset: 'toolParams', id: item.id, category: 'tool_error', input: truncate(JSON.stringify(item.input)),
          expected: 'accept', actual: null, detail: `合法调用被错误拒绝：${err.message}`
        });
      }
    }
    rows.push({ id: item.id, split: item.split, pass, expect: item.expect });
  }
  const summaryOf = (subset) => ({
    samples: subset.length, accuracy: rateOf(subset, 'pass'),
    acceptCorrectRate: rateOf(subset.filter((r) => r.expect === 'accept'), 'pass'),
    rejectCorrectRate: rateOf(subset.filter((r) => r.expect === 'reject'), 'pass')
  });
  return { title: '工具调用结构校验（接受/拒绝）', summary: summaryOf(rows), bySplit: bySplitSummary(rows, summaryOf) };
}

// ---------- 权限隔离 ----------
async function evalAccess(cases, failures) {
  const { selectOrganizationScope } = require('../src/services/organizationAccess');
  const fixture = loadDataset('access').organizationFixture;
  const rows = [];
  const sameIds = (a, b) => JSON.stringify([...(a || [])].sort((x, y) => x - y))
    === JSON.stringify([...(b || [])].sort((x, y) => x - y));

  for (const item of cases) {
    let status = 200;
    let message = '';
    let organizationName = null;
    let orgIds = null;
    try {
      const resolved = selectOrganizationScope(item.actor, item.selector || {}, fixture);
      organizationName = resolved.organization ? resolved.organization.name : null;
      orgIds = resolved.orgIds;
    } catch (err) {
      status = err.statusCode || 500;
      message = err.message;
    }
    let pass = status === item.expect.status;
    if (pass && item.expect.status === 200) {
      pass = organizationName === item.expect.organizationName && sameIds(orgIds, item.expect.orgIds);
    } else if (pass && item.expect.messageContains) {
      pass = message.includes(item.expect.messageContains);
    }
    rows.push({ id: item.id, split: item.split, pass });
    if (!pass) {
      pushFailure(failures, {
        dataset: 'access', id: item.id, category: 'permission_error',
        input: truncate(JSON.stringify({ actor: item.actor, selector: item.selector })),
        expected: item.expect, actual: { status, message: truncate(message, 80), organizationName, orgIds },
        detail: '权限判定结果与预期不符'
      });
    }
  }
  const summaryOf = (subset) => ({ samples: subset.length, permissionCorrectRate: rateOf(subset, 'pass') });
  return {
    title: '角色权限与组织范围隔离',
    summary: summaryOf(rows), bySplit: bySplitSummary(rows, summaryOf)
  };
}

function buildRecommendations(report) {
  const recs = [];
  const refusal = report.suites.refusal?.summary?.refusalRate;
  if (typeof refusal === 'number' && refusal < 0.9) {
    recs.push({
      rank: 1, impact: '高',
      problem: `无依据问题拒答率 ${(refusal * 100).toFixed(1)}%（目标 ≥90%）`,
      suggestion: '在保持原阈值的前提下引入主题证据匹配（证据片段中必须出现问题的核心主题），避免通用词重叠触发误回答；仅在 dev 上调整，heldout 独立复核。'
    });
  }
  const doc = report.suites.retrieval?.summary?.configurations?.hybrid_rerank?.document;
  const chunk = report.suites.retrieval?.summary?.configurations?.hybrid_rerank?.chunk;
  if (doc && chunk && typeof chunk.recallAt5 === 'number' && chunk.recallAt5 < doc.recallAt5 - 0.1) {
    recs.push({
      rank: 2, impact: '高',
      problem: `文档级 Recall@5=${doc.recallAt5} 但分块级=${chunk.recallAt5}`,
      suggestion: '优化分块边界或证据片段定位策略：当前"命中正确文档"掩盖了答案证据未进入 Top-5 分块的问题。'
    });
  }
  const citationFailures = report.failures.filter((f) => f.category === 'citation_error').length;
  if (citationFailures) {
    recs.push({
      rank: 3, impact: '中',
      problem: `引用相关失败 ${citationFailures} 条（年份/编号被误当引用编号）`,
      suggestion: '收紧引用编号正则与语义判定，仅清理确属越界的 [n]，保留正文中的年份/附录编号。'
    });
  }
  const nlqOrg = report.failures.filter((f) => f.dataset === 'nlq' && f.detail?.includes('organizationName')).length;
  if (nlqOrg && recs.length < 3) {
    recs.push({
      rank: recs.length + 1, impact: '中',
      problem: `自然语言问数组织识别错误 ${nlqOrg} 条`,
      suggestion: '修正组织名称抽取边界，避免把"月度走势/数量"等统计词并入组织名；保持规则解析与 Function Calling 同构。'
    });
  }
  if (!recs.length) {
    recs.push({ rank: 1, impact: '低', problem: '基线未发现显著短板', suggestion: '保持门禁阈值，扩大困难样本覆盖后复测。' });
  }
  return recs.slice(0, 3).map((rec, index) => ({ ...rec, rank: index + 1 }));
}

async function runEval({ mode = 'offline', gate = false, outDir } = {}) {
  const failures = [];
  const suites = {};

  if (mode === 'offline') {
    process.env.NODE_ENV = 'test';
    process.env.QDRANT_ENABLED = 'false';
    for (const key of OFFLINE_STRIP_KEYS) process.env[key] = '';
  } else if (process.env.AI_EVAL_ONLINE !== '1') {
    throw new Error('在线评测需严格显式设置 AI_EVAL_ONLINE=1（不使用生产数据，仅静态知识库与隔离 fixture）');
  }

  const limits = onlineLimits();
  const budget = createBudget(limits);
  const { AIClient } = require('../src/services/aiClient');
  const RagService = require('../src/services/ragService');
  const Reranker = require('../src/rag/reranker');
  const { reciprocalRankFusion } = require('../src/rag/fusion');
  const EmbeddingClient = require('../src/rag/vectorStore').EmbeddingClient;

  const missing = [];
  if (mode === 'online') {
    if (!EmbeddingClient.isApiConfigured()) missing.push('Embedding');
    if (!Reranker.isApiConfigured()) missing.push('Reranker');
    if (!AIClient.isConfigured()) missing.push('LLM');
    instrumentOnlineCalls({ AIClient, RagService, Reranker, EmbeddingClient }, budget);
  }

  let onlineStatus = null;
  if (mode === 'online' && missing.length) {
    onlineStatus = {
      status: 'not_run',
      reason: `真实模型未完整配置（缺少 ${missing.join('、')}）；本地 fallback 结果不得冒充真实模型评测`,
      limits, usage: NA
    };
  } else if (mode === 'offline') {
    onlineStatus = { status: 'not_run', reason: '离线模式强制关闭外部模型；在线指标标记 N/A', usage: NA };
  }

  const skipForMissingOnline = mode === 'online' && onlineStatus?.status === 'not_run';
  if (!skipForMissingOnline) {
    suites.retrieval = await evaluateRetrieval(
      { RagService, reciprocalRankFusion, Reranker, topK: TOP_K, topN: TOP_N },
      loadDataset('retrieval').cases, failures, mode
    );
    const r = suites.retrieval;
    const configurations = r.summary;
    r.summary = {
      samples: loadDataset('retrieval').cases.length,
      ...r.summary.hybrid_rerank.document,
      documentRecallAt3: r.summary.hybrid_rerank.document.recallAt3,
      chunkRecallAt5: r.summary.hybrid_rerank.chunk.recallAt5,
      configurations,
      bySplit: {
        dev: r.summary.hybrid_rerank.document.bySplit.dev,
        heldout: r.summary.hybrid_rerank.document.bySplit.heldout
      }
    };
    suites.qa = await evalQA(loadDataset('qa').cases, failures);
    suites.refusal = await evalRefusal(loadDataset('refusal').cases, failures);
    suites.citation = await evalCitation(loadDataset('citation').cases, failures);
    suites.nlq = await evalNLQ(loadDataset('nlq').cases, failures, mode === 'online' ? budget : null);
    suites.toolParams = await evalToolParams(loadDataset('tool-params').cases, failures);
    suites.access = await evalAccess(loadDataset('access').cases, failures);
  } else {
    for (const name of ['retrieval', 'qa', 'refusal', 'citation', 'nlq', 'toolParams', 'access']) {
      suites[name] = { title: name, summary: { samples: NA }, status: 'not_run' };
    }
  }

  const backend = RagService.getBackendStatus();
  const dbTruth = await evaluateDbTruth();
  if (dbTruth.status === 'not_run') dbTruth.summary = { samples: NA, failedSamples: NA };
  suites.dbTruth = dbTruth;

  const totals = {
    samples: Object.values(suites).reduce((s, x) => s + (typeof x.summary?.samples === 'number' ? x.summary.samples : 0), 0),
    failed: failures.length
  };
  totals.passed = totals.samples - totals.failed;
  totals.passRate = totals.samples ? Math.round((totals.passed / totals.samples) * 10000) / 10000 : NA;

  const gateResult = gate && mode === 'offline' ? evaluateGate(suites) : null;
  const legacy = JSON.parse(fs.readFileSync(path.join(__dirname, '../rag-eval-report.json'), 'utf8'));
  const usage = budget.summary();

  const report = {
    reportVersion: '2.1.0',
    datasetVersion: DATASET_VERSION,
    mode,
    status: mode === 'online' ? (onlineStatus?.status || (usage.stopped ? 'stopped' : 'completed')) : 'completed',
    online: onlineStatus || {
      status: usage.stopped ? 'stopped' : 'completed',
      limits,
      usage,
      note: 'Embedding/Reranker 单价未配置时按 0 估算，实际账单以服务端为准。'
    },
    generatedAt: new Date().toISOString(),
    fixedNow: FIXED_NOW.toISOString(),
    environment: collect({
      mode,
      config: {
        topK: TOP_K, topN: TOP_N, backend, aiConfigured: AIClient.isConfigured(),
        datasetSplitRule: 'sha1(id) % 10 < 3 → heldout；其余 dev',
        gateBasis: gate ? 'dev（heldout 仅最终独立报告）' : NA,
        gateFloors: gate ? FLOORS : NA
      }
    }),
    limitations: [
      `旧 rag-evaluate.js 仅 ${legacy.evalCount} 道题、${legacy.chunkCount} 个分块、文档级 Recall@3=${legacy.summary.hybrid.recallAtK}，只说明"命中正确文档"，不能代表答案证据/分块级检索质量。`,
      'keywordCoverageRate 为关键词覆盖率；factPointCoverageRate 为启发式要点覆盖（人工验证事实准确率标记 N/A）；citationSupportRate 为启发式证据支持度（LLM Judge 标记 N/A）。',
      'isGrounded=true 仅表示检索门禁通过且有来源，不等价于答案事实正确。',
      'CI 门禁只用 dev；heldout 仅用于最终独立报告，不参与阈值调整。'
    ],
    totals,
    suites,
    gate: gateResult,
    failures,
    recommendations: buildRecommendations({ suites, failures })
  };

  const files = writeReports(outDir || path.join(__dirname, 'reports'), report);
  return { report, files };
}

module.exports = { runEval, instrumentOnlineCalls, resolveTraceArgument, DATASET_VERSION, FIXED_NOW, TOP_K, TOP_N };

if (require.main === module) {
  const args = Object.fromEntries(process.argv.slice(2)
    .filter((a) => a.startsWith('--'))
    .map((a) => {
      const idx = a.indexOf('=');
      return idx === -1 ? [a.slice(2), true] : [a.slice(2, idx), a.slice(idx + 1)];
    }));
  const mode = args.mode === 'online' ? 'online' : 'offline';
  runEval({ mode, gate: Boolean(args.gate), outDir: args.out ? path.resolve(String(args.out)) : undefined })
    .then(({ report, files }) => {
      console.log(`\n===== AI 质量评测 V2（${mode === 'online' ? '在线真实模型' : '离线确定性'}）=====`);
      console.log(`数据集 ${report.datasetVersion} ｜ Git ${report.environment.gitCommit} ｜ 知识库 ${report.environment.knowledgeBase.files} 文件`);
      console.log(`样本 ${report.totals.samples} ｜ 通过 ${report.totals.passed}（${report.totals.passRate === NA ? NA : `${(report.totals.passRate * 100).toFixed(1)}%`}）｜ 失败 ${report.totals.failed}`);
      if (report.status === 'not_run') console.log(`在线评测：${report.online.reason}`);
      for (const [name, suite] of Object.entries(report.suites)) {
        const brief = Object.entries(suite.summary || {})
          .filter(([k, v]) => typeof v === 'number' && k !== 'samples')
          .map(([k, v]) => `${k}=${v}`).join('  ');
        console.log(`  ${name.padEnd(12)} ${brief || suite.status || ''}`);
      }
      if (report.gate) console.log(report.gate.passed ? 'CI 门禁（dev）：✅ 全部达标' : `CI 门禁（dev）：❌ ${JSON.stringify(report.gate.breaches)}`);
      console.log(`报告：${files[0]}\n      ${files[1]}`);
      if (report.gate && !report.gate.passed) process.exit(1);
      process.exit(0);
    })
    .catch((err) => {
      console.error('评测失败:', err.stack);
      process.exit(1);
    });
}
