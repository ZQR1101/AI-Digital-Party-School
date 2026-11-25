// AI 质量评测 V1 入口（先建立真实基线，不修改业务 RAG 算法）
//
// 用法：
//   npm run eval:offline                               # CI 门禁，确定性、无外部 API
//   node ai-eval/run-eval.js --mode=offline            # 本地离线全量（不出错即退出 0）
//   AI_EVAL_ONLINE=1 AI_API_URL=... AI_API_KEY=... \
//   EMBEDDING_API_URL=... RERANKER_API_URL=... \
//   npm run eval:online                                # 真实模型（需显式开启，有请求/成本上限）
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

function loadDataset(name) {
  return JSON.parse(fs.readFileSync(path.join(DATASETS_DIR, `${name}.dataset.json`), 'utf8'));
}

function pushFailure(failures, value) {
  failures.push(value);
}

// ---------- 问答质量（真实 RagService 链路） ----------
async function evalQA(cases, failures, mode, usage) {
  const RagService = require('../src/services/ragService');
  const rows = [];
  await RagService.init(true);

  for (const item of cases) {
    const trace = {};
    const result = await RagService.ask(item.question, { trace });
    collectUsage(usage, trace);
    const sources = result.sources || [];
    const sourceMatched = sources.some((s) => s.source === item.expectedSource);
    const coverage = keywordCoverage(result.answer, item.expectedKeywords);
    const citedNumbers = [...String(result.answer).matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
    const validCitations = citedNumbers.filter((n) => n >= 1 && n <= sources.length);
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
      id: item.id, split: item.split, sourceMatched, factCorrect: coverage >= 0.6, coverage,
      citationValid: citedNumbers.length ? invalidCitations.length === 0 : true,
      citationSupport: supportHit, grounded: result.isGrounded, fallback,
      hasAnswer: Boolean(result.answer)
    };
    rows.push(row);

    if (!result.isGrounded) {
      pushFailure(failures, {
        dataset: 'qa', id: item.id, category: 'over_refusal',
        input: truncate(item.question), expected: { source: item.expectedSource, keywords: item.expectedKeywords },
        actual: { isGrounded: false, topScore: sources[0]?.relevanceScore ?? null },
        detail: '知识库可回答的问题被拒答', sources: '(空)'
      });
    } else if (!sourceMatched) {
      pushFailure(failures, {
        dataset: 'qa', id: item.id, category: 'retrieval_failure',
        input: truncate(item.question), expected: { source: item.expectedSource, keywords: item.expectedKeywords },
        actual: { sources: sources.map((s) => s.source) },
        detail: '回答来源中未包含预期文档'
      });
    } else if (!row.factCorrect) {
      pushFailure(failures, {
        dataset: 'qa', id: item.id, category: 'generation_failure',
        input: truncate(item.question), expected: { keywords: item.expectedKeywords },
        actual: { keywordCoverage: coverage, missingKeywords: missingKeywords(result.answer, item.expectedKeywords), fallback },
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

  const dev = rows.filter((r) => r.split === 'dev');
  const heldout = rows.filter((r) => r.split === 'heldout');
  const summaryOf = (subset) => ({
    samples: subset.length,
    factAccuracyRate: rateOf(subset, 'factCorrect'),
    citationNumberValidRate: rateOf(subset, 'citationValid'),
    citationSupportRate: rateOf(subset, 'citationSupport'), // 启发式规则，非客观真值
    fallbackReliabilityRate: rateOf(subset, (r) => r.fallback ? (r.hasAnswer && r.grounded) : true),
    llmJudgeScore: NA // 未开展 LLM Judge，禁止当作 0 或满分
  });
  return {
    title: '问答质量（真实 RagService 链路）',
    summary: { ...summaryOf(rows), avgFactCoverage: mean(rows.map((r) => r.coverage)) },
    bySplit: { dev: summaryOf(dev), heldout: summaryOf(heldout) }
  };
}

// ---------- 拒答 ----------
async function evalRefusal(cases, failures, mode, usage) {
  const RagService = require('../src/services/ragService');
  const rows = [];
  await RagService.init(true);
  for (const item of cases) {
    const trace = {};
    const result = await RagService.ask(item.query, { trace });
    collectUsage(usage, trace);
    const refused = result.isGrounded === false && (result.sources || []).length === 0;
    rows.push({ id: item.id, split: item.split, refused });
    if (!refused) {
      pushFailure(failures, {
        dataset: 'refusal', id: item.id, category: 'unwarranted_answer',
        input: truncate(item.query), expected: { isGrounded: false, sources: [] },
        actual: { isGrounded: result.isGrounded, topScore: result.sources?.[0]?.relevanceScore ?? null },
        detail: '知识库不含该事实，系统仍给出带来源的回答',
        sources: (result.sources || []).map((s) => s.source).join(' ') || '(空)'
      });
    }
  }
  const summaryOf = (subset) => ({
    samples: subset.length,
    refusalRate: rateOf(subset, 'refused'),
    unwarrantedAnswerRate: Math.round((1 - rateOf(subset, 'refused')) * 10000) / 10000
  });
  return {
    title: '无答案拒答', summary: summaryOf(rows),
    bySplit: { dev: summaryOf(rows.filter((r) => r.split === 'dev')), heldout: summaryOf(rows.filter((r) => r.split === 'heldout')) }
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
  return {
    title: '引用编号校验',
    summary: { samples: rows.length, accuracy: rateOf(rows, 'pass') },
    bySplit: {
      dev: { samples: rows.filter((r) => r.split === 'dev').length, accuracy: rateOf(rows.filter((r) => r.split === 'dev'), 'pass') },
      heldout: { samples: rows.filter((r) => r.split === 'heldout').length, accuracy: rateOf(rows.filter((r) => r.split === 'heldout'), 'pass') }
    }
  };
}

// ---------- 自然语言统计查询 ----------
async function evalNLQ(cases, failures, mode, usage, budget) {
  const { parseOrganizationQuery } = require('../src/ai/queryParser');
  const { validateToolCall, normalizeToolParameters, mapParsedQueryToToolCall } = require('../src/ai/queryTools');
  const { AIClient } = require('../src/services/aiClient');
  const rows = [];

  for (const item of cases) {
    let parsed = null;
    let tool = null;
    let intentMode = 'rules';
    const trace = {};
    if (mode === 'online') {
      try {
        budget.check();
        const call = await AIClient.identifyQueryIntent(item.message, trace);
        budget.requests += 1;
        collectUsage(usage, trace);
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
      timeRangeLabel: item.expect.timeRangeLabel ?? null, groupBy: item.expect.groupBy ?? null
    };
    const fields = {
      metric: actual.metric === expect.metric,
      organizationName: actual.organizationName === expect.organizationName,
      timeRange: actual.timeRangeLabel === expect.timeRangeLabel,
      groupBy: actual.groupBy === expect.groupBy
    };
    const toolOk = fields.metric;
    const exact = Object.values(fields).every(Boolean);
    rows.push({ id: item.id, split: item.split, toolOk, exact, fields, intentMode });
    if (!exact) {
      pushFailure(failures, {
        dataset: 'nlq', id: item.id, category: 'tool_error', input: truncate(item.message),
        expected: expect, actual,
        detail: `${intentMode === 'llm' ? 'LLM 意图' : '规则解析'}字段错误：${Object.entries(fields).filter(([, ok]) => !ok).map(([k]) => k).join('、')}`
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
    bySplit: {
      dev: summaryOf(rows.filter((r) => r.split === 'dev')),
      heldout: summaryOf(rows.filter((r) => r.split === 'heldout'))
    }
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
  return {
    title: '工具调用结构校验（接受/拒绝）',
    summary: {
      samples: rows.length, accuracy: rateOf(rows, 'pass'),
      acceptCorrectRate: rateOf(rows.filter((r) => r.expect === 'accept'), 'pass'),
      rejectCorrectRate: rateOf(rows.filter((r) => r.expect === 'reject'), 'pass')
    }
  };
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
      // 子树遍历顺序不是契约，按集合比较（原 oracle 用数组顺序比较会误报）
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
  return {
    title: '角色权限与组织范围隔离',
    summary: { samples: rows.length, permissionCorrectRate: rateOf(rows, 'pass') },
    bySplit: {
      dev: { samples: rows.filter((r) => r.split === 'dev').length, permissionCorrectRate: rateOf(rows.filter((r) => r.split === 'dev'), 'pass') },
      heldout: { samples: rows.filter((r) => r.split === 'heldout').length, permissionCorrectRate: rateOf(rows.filter((r) => r.split === 'heldout'), 'pass') }
    }
  };
}

function collectUsage(usage, trace) {
  for (const key of ['promptTokens', 'completionTokens', 'totalTokens']) {
    usage[key] += Number(trace[key] || 0);
  }
  if (trace.model) usage.models.add(trace.model);
  if (trace.modelDurationMs) usage.durationMs += Number(trace.modelDurationMs);
}

function makeBudget(limits) {
  const budget = { requests: 0, limits };
  budget.check = () => {
    if (budget.requests >= limits.maxRequests) {
      throw new Error(`在线请求数达到上限 ${limits.maxRequests}`);
    }
  };
  return budget;
}

function buildRecommendations(report) {
  const recs = [];
  const refusal = report.suites.refusal?.summary?.refusalRate;
  if (typeof refusal === 'number' && refusal < 0.8) {
    recs.push({ rank: 1, impact: '高', problem: `无依据问题拒答率仅 ${(refusal * 100).toFixed(1)}%`, suggestion: '先调整检索相关性门禁与来源Evidence校验（仅改判定策略，不改知识库事实），避免低分片段被当作依据生成回答。' });
  }
  const doc = report.suites.retrieval?.configurations?.hybrid_rerank?.document;
  const chunk = report.suites.retrieval?.configurations?.hybrid_rerank?.chunk;
  if (doc && chunk && typeof chunk.recallAt5 === 'number' && chunk.recallAt5 < doc.recallAt5 - 0.1) {
    recs.push({ rank: 2, impact: '高', problem: `文档级 Recall@5=${doc.recallAt5} 但分块级=${chunk.recallAt5}`, suggestion: '优化分块边界或证据片段定位策略：当前"命中正确文档"掩盖了答案证据未进入 Top-5 分块的问题。' });
  }
  const citationFailures = report.failures.filter((f) => f.category === 'citation_error').length;
  if (citationFailures) {
    recs.push({ rank: 3, impact: '中', problem: `引用相关失败 ${citationFailures} 条（年份/编号被误当引用编号）`, suggestion: '收紧引用编号正则与语义判定，仅清理确属越界的 [n]，保留正文中的年份/附录编号。' });
  }
  const nlqOrg = report.failures.filter((f) => f.dataset === 'nlq' && f.detail?.includes('organizationName')).length;
  if (nlqOrg && recs.length < 3) {
    recs.push({ rank: recs.length + 1, impact: '中', problem: `自然语言问数组织识别错误 ${nlqOrg} 条`, suggestion: '修正组织名称抽取边界，避免把"月度走势/数量"等统计词并入组织名；保持规则解析与 Function Calling 同构。' });
  }
  if (!recs.length) {
    recs.push({ rank: 1, impact: '低', problem: '基线未发现显著短板', suggestion: '保持门禁阈值，扩大困难样本覆盖后复测。' });
  }
  return recs.slice(0, 3).map((rec, index) => ({ ...rec, rank: index + 1 }));
}

async function runEval({ mode = 'offline', gate = false, outDir } = {}) {
  const failures = [];
  const suites = {};
  const usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, durationMs: 0, models: new Set(), requests: 0 };
  const limits = onlineLimits();
  const budget = makeBudget(limits);

  if (mode === 'offline') {
    process.env.NODE_ENV = 'test';
    process.env.QDRANT_ENABLED = 'false';
    for (const key of OFFLINE_STRIP_KEYS) process.env[key] = '';
  } else if (!process.env.AI_EVAL_ONLINE) {
    throw new Error('在线评测需显式设置 AI_EVAL_ONLINE=1（不使用生产数据，仅静态知识库与隔离 fixture）');
  }

  const { AIClient } = require('../src/services/aiClient');
  const RagService = require('../src/services/ragService');
  const Reranker = require('../src/rag/reranker');
  const { reciprocalRankFusion } = require('../src/rag/fusion');
  const EmbeddingClient = require('../src/rag/vectorStore').EmbeddingClient;

  let backend = RagService.getBackendStatus();
  const aiConfigured = AIClient.isConfigured();
  let onlineStatus = null;
  if (mode === 'online') {
    const missing = [];
    if (!EmbeddingClient.isApiConfigured()) missing.push('Embedding');
    if (!Reranker.isApiConfigured()) missing.push('Reranker');
    if (!aiConfigured) missing.push('LLM');
    if (missing.length) {
      onlineStatus = {
        status: 'not_run',
        reason: `真实模型未完整配置（缺少 ${missing.join('、')}）；本地 fallback 结果不得冒充真实模型评测`,
        usage: NA
      };
    }
  } else if (!aiConfigured) {
    onlineStatus = { status: 'not_run', reason: '离线模式强制关闭外部模型；在线指标标记 N/A', usage: NA };
  }

  // 只有在线模式且真实模型未就绪时才跳过整套评测；离线模式必须照常跑确定性套件。
  const skipForMissingOnline = mode === 'online' && onlineStatus?.status === 'not_run';
  if (!skipForMissingOnline) {
    suites.retrieval = await evaluateRetrieval(
      { RagService, reciprocalRankFusion, Reranker, topK: TOP_K, topN: TOP_N },
      loadDataset('retrieval').cases, failures, mode
    );
    const r = suites.retrieval;
    r.summary = {
      samples: loadDataset('retrieval').cases.length,
      ...r.summary.hybrid_rerank.document,
      documentRecallAt3: r.summary.hybrid_rerank.document.recallAt3,
      chunkRecallAt5: r.summary.hybrid_rerank.chunk.recallAt5,
      configurations: r.summary,
      bySplit: {
        dev: r.summary.hybrid_rerank.document.bySplit.dev,
        heldout: r.summary.hybrid_rerank.document.bySplit.heldout
      }
    };
    suites.qa = await evalQA(loadDataset('qa').cases, failures, mode, usage);
    suites.refusal = await evalRefusal(loadDataset('refusal').cases, failures, mode, usage);
    suites.citation = await evalCitation(loadDataset('citation').cases, failures);
    suites.nlq = await evalNLQ(loadDataset('nlq').cases, failures, mode, usage, budget);
    suites.toolParams = await evalToolParams(loadDataset('tool-params').cases, failures);
    suites.access = await evalAccess(loadDataset('access').cases, failures);
  } else {
    for (const name of ['retrieval', 'qa', 'refusal', 'citation', 'nlq', 'toolParams', 'access']) {
      suites[name] = { title: name, summary: { samples: NA }, status: 'not_run' };
    }
  }

  // 评测完成后再取后端状态：此时分块已加载，报告才能写出真实 chunkCount
  backend = RagService.getBackendStatus();
  const dbTruth = await evaluateDbTruth();
  if (dbTruth.status === 'not_run') dbTruth.summary = { samples: NA };
  suites.dbTruth = dbTruth;

  const totals = {
    samples: Object.values(suites).reduce((s, x) => s + (typeof x.summary?.samples === 'number' ? x.summary.samples : 0), 0),
    failed: failures.length
  };
  totals.passed = totals.samples - totals.failed;
  totals.passRate = totals.samples ? Math.round((totals.passed / totals.samples) * 10000) / 10000 : NA;

  const gateResult = gate && mode === 'offline' ? evaluateGate(suites) : null;
  const legacy = JSON.parse(fs.readFileSync(path.join(__dirname, '../rag-eval-report.json'), 'utf8'));

  const report = {
    reportVersion: '2.0.0',
    datasetVersion: DATASET_VERSION,
    mode,
    status: mode === 'online' ? (onlineStatus?.status || 'completed') : 'completed',
    online: onlineStatus || {
      status: mode === 'online' ? 'completed' : 'not_run',
      limits,
      usage: {
        requests: usage.requests, promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens, totalTokens: usage.totalTokens,
        durationMs: usage.durationMs, models: [...usage.models],
        estimatedCostCny: Math.round((usage.totalTokens / 1e6) * limits.pricePerMillionTokens * 10000) / 10000
      }
    },
    generatedAt: new Date().toISOString(),
    fixedNow: FIXED_NOW.toISOString(),
    environment: collect({
      mode,
      config: {
        topK: TOP_K, topN: TOP_N, backend, aiConfigured,
        datasetSplitRule: 'sha1(id) % 10 < 3 → heldout；其余 dev',
        gateFloors: gate ? FLOORS : NA
      }
    }),
    limitations: [
      `旧 rag-evaluate.js 仅 ${legacy.evalCount} 道题、${legacy.chunkCount} 个分块、文档级 Recall@3=${legacy.summary.hybrid.recallAtK}，只说明"命中正确文档"，不能代表答案证据/分块级检索质量。`,
      '引用支持度为启发式规则判定（可人工复核），不是 LLM Judge 客观真值。',
      'isGrounded=true 仅表示检索门禁通过且有来源，不等价于答案事实正确。'
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

module.exports = { runEval, DATASET_VERSION, FIXED_NOW, TOP_K, TOP_N };

if (require.main === module) {
  const args = Object.fromEntries(process.argv.slice(2)
    .filter((a) => a.startsWith('--'))
    .map((a) => {
      const idx = a.indexOf('=');
      return idx === -1 ? [a.slice(2), true] : [a.slice(2), a.slice(idx + 1)];
    }));
  const mode = args.mode === 'online' ? 'online' : 'offline';
  runEval({ mode, gate: Boolean(args.gate), outDir: args.out ? path.resolve(String(args.out)) : undefined })
    .then(({ report, files }) => {
      console.log(`\n===== AI 质量评测 V1（${mode === 'online' ? '在线真实模型' : '离线确定性'}）=====`);
      console.log(`数据集 ${report.datasetVersion} ｜ Git ${report.environment.gitCommit} ｜ 知识库 ${report.environment.knowledgeBase.files} 文件`);
      console.log(`样本 ${report.totals.samples} ｜ 通过 ${report.totals.passed}（${report.totals.passRate === NA ? NA : `${(report.totals.passRate * 100).toFixed(1)}%`}）｜ 失败 ${report.totals.failed}`);
      if (report.status === 'not_run') console.log(`在线评测：${report.online.reason}`);
      for (const [name, suite] of Object.entries(report.suites)) {
        const brief = Object.entries(suite.summary || {})
          .filter(([k, v]) => typeof v === 'number' && k !== 'samples')
          .map(([k, v]) => `${k}=${v}`).join('  ');
        console.log(`  ${name.padEnd(12)} ${brief || suite.status || ''}`);
      }
      if (report.gate) console.log(report.gate.passed ? 'CI 门禁：✅ 全部达标' : `CI 门禁：❌ ${JSON.stringify(report.gate.breaches)}`);
      console.log(`报告：${files[0]}\n      ${files[1]}`);
      if (report.gate && !report.gate.passed) process.exit(1);
      process.exit(0);
    })
    .catch((err) => {
      console.error('评测失败:', err.stack);
      process.exit(1);
    });
}
