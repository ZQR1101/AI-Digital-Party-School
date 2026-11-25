/**
 * 汇总 V3 的离线/在线、dev/heldout 四份 JSON，生成 online-comparison-v3.json/md。
 * heldout 报告缺失时明确标记 not_run，不把离线结果当作在线复核。
 */
const fs = require('fs');
const path = require('path');

const REPORT_DIR = path.resolve(__dirname, '..', 'reports');
const NA = 'N/A';

function readJson(name, required = true) {
  const file = path.join(REPORT_DIR, name);
  if (!fs.existsSync(file)) {
    if (required) throw new Error(`缺少报告：${file}`);
    return null;
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function pct(value) {
  return typeof value === 'number' && Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : NA;
}

function num(value, digits = 2) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : NA;
}

function int(value) {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : NA;
}

function delta(a, b) {
  if (typeof a !== 'number' || typeof b !== 'number') return NA;
  return `${(a - b) >= 0 ? '+' : ''}${(a - b).toFixed(4)}`;
}

function retrievalRows(report) {
  const summary = report?.suites?.retrieval?.summary || {};
  return [
    ['A · BM25 关键词', summary.A_bm25],
    ['B · 真实 Embedding 向量', summary.B_embedding],
    ['C · BM25 + Embedding + RRF', summary.C_bm25_embedding_rrf],
    ['D · C + 真实 Reranker', summary.D_bm25_embedding_rrf_reranker]
  ].map(([name, value]) => ({
    name,
    chunkRecallAt5: value?.chunk?.recallAt5 ?? NA,
    chunkMrRAt5: value?.chunk?.mrrAt5 ?? NA,
    documentRecallAt5: value?.document?.recallAt5 ?? NA,
    avgMs: value?.chunk?.avgMs ?? NA,
    p95Ms: value?.chunk?.p95Ms ?? NA,
    samples: value?.chunk?.samples ?? NA
  }));
}

function qaRow(report, key) {
  const value = report?.suites?.qa?.summary?.[key] || {};
  return {
    samples: value.samples ?? 0,
    factPointCoverageRate: value.factPointCoverageRate ?? NA,
    citationNumberValidRate: value.citationNumberValidRate ?? NA,
    citationSupportRate: value.citationSupportRate ?? NA,
    overRefusalRate: value.overRefusalRate ?? NA,
    avgGenerationMs: value.avgGenerationMs ?? NA,
    status: value.status || 'completed'
  };
}

function suiteSummary(report, name) {
  return report?.suites?.[name]?.summary || {};
}

function addUsage(a, b) {
  if (!a) return b;
  if (!b) return a;
  return {
    requests: (a.requests || 0) + (b.requests || 0),
    byKind: {
      llm: (a.byKind?.llm || 0) + (b.byKind?.llm || 0),
      embedding: (a.byKind?.embedding || 0) + (b.byKind?.embedding || 0),
      rerank: (a.byKind?.rerank || 0) + (b.byKind?.rerank || 0)
    },
    promptTokens: (a.promptTokens || 0) + (b.promptTokens || 0),
    completionTokens: (a.completionTokens || 0) + (b.completionTokens || 0),
    totalTokens: (a.totalTokens || 0) + (b.totalTokens || 0),
    durationMs: (a.durationMs || 0) + (b.durationMs || 0),
    estimatedCostCny: Math.round(((a.estimatedCostCny || 0) + (b.estimatedCostCny || 0)) * 10000) / 10000,
    models: [...new Set([...(a.models || []), ...(b.models || [])])]
  };
}

function buildConclusion(onlineDev, onlineHeldout) {
  if (onlineDev?.status !== 'completed') {
    return {
      verdict: 'not_run',
      embedding: '无法判断：在线 dev 实验未完成。',
      reranker: '无法判断：在线 dev 实验未完成。',
      text: '在线实验未正常完成（not_run/stopped），不得据离线或本地 fallback 结果推断真实模型收益。'
    };
  }
  const schemes = onlineDev.suites.retrieval.summary;
  const a = schemes.A_bm25?.chunk || {};
  const b = schemes.B_embedding?.chunk || {};
  const c = schemes.C_bm25_embedding_rrf?.chunk || {};
  const dSummary = schemes.D_bm25_embedding_rrf_reranker || {};
  const d = dSummary.chunk || {};
  const recallGain = (b.recallAt5 ?? 0) - (a.recallAt5 ?? 0);
  const mrrGain = (b.mrrAt5 ?? 0) - (a.mrrAt5 ?? 0);
  const embeddingLatency = Math.max(0, (b.avgMs ?? 0) - (a.avgMs ?? 0));
  const rerankNotRun = dSummary.status === 'not_run' || onlineDev.degraded;
  const embeddingWorth = recallGain >= 0.05 && mrrGain >= 0 && embeddingLatency <= 250;
  const heldoutNote = onlineHeldout?.status === 'completed'
    ? 'heldout 独立复核已完成，结论仍受小样本限制。'
    : 'heldout 未完成，本结论仅为 dev 小样本观察。';
  const rerankerText = rerankNotRun
    ? 'D 方案 not_run：Reranker 接口返回 403（当前配置未带百炼兼容端点所需的 WorkspaceId），无法评价真实重排收益；修复端点前应继续禁用，禁止用本地关键词重排冒充。'
    : `真实 Reranker 在融合后相对 C 的 chunk Recall@5 变化 ${delta(d.recallAt5, c.recallAt5)}，平均额外耗时 ${num(Math.max(0, (d.avgMs ?? 0) - (c.avgMs ?? 0)))} ms。`;
  const verdict = rerankNotRun
    ? 'partial_d_not_run'
    : (embeddingWorth && (d.recallAt5 ?? 0) >= (c.recallAt5 ?? 0) ? 'candidate_for_canary' : 'not_default_yet');
  return {
    verdict,
    embedding: `真实 Embedding 相对 BM25：chunk Recall@5 ${pct(b.recallAt5)} vs ${pct(a.recallAt5)}（${delta(recallGain, 0)}），MRR@5 ${num(b.mrrAt5, 4)} vs ${num(a.mrrAt5, 4)}（${delta(mrrGain, 0)}），平均耗时 +${num(embeddingLatency)} ms。${embeddingWorth ? '有小范围灰度价值。' : '未观察到足以抵消延迟的质量增益。'}`,
    reranker: rerankerText,
    text: `${verdict === 'candidate_for_canary' ? '可考虑小范围灰度，但样本仅 20 条，不足以直接全量默认启用。' : '当前样本下不建议默认启用真实 Embedding；Reranker 需在接口修复后重测 D 方案再决定。'} ${heldoutNote}`
  };
}

function markdown(json) {
  const lines = [];
  const cfg = json.config || {};
  const dev = json.comparison.dev || {};
  const heldout = json.comparison.heldout || {};
  const onlineDev = json.runs.onlineDev;

  lines.push('# AI 在线质量评测 V3 · 小规模真实模型对照');
  lines.push('');
  lines.push(`- 报告版本：${json.reportVersion} ｜ 生成时间：${json.generatedAt}`);
  const degraded = Boolean(json.runs?.onlineDev?.degraded);
  lines.push(`- 数据集：${json.datasetVersion} ｜ 在线状态：**${json.status}**${degraded ? '（部分方案 not_run：D / 真实 Reranker）' : ''}${json.stopReason ? ` ｜ 原因：${json.stopReason}` : ''}`);
  lines.push('');

  lines.push('## 1. 模型与真实后端配置');
  lines.push('');
  lines.push('| 组件 | 配置状态 | 模型 | 端点 | 实际后端 |');
  lines.push('| --- | --- | --- | --- | --- |');
  lines.push(`| LLM | ${cfg.llm?.configured ? '已配置' : '未配置'} | ${cfg.llm?.model || NA} | ${cfg.llm?.endpoint || NA} | ${onlineDev?.status === 'completed' ? 'api（模型输出）' : NA} |`);
  lines.push(`| Embedding | ${cfg.embedding?.configured ? '已配置' : '未配置'} | ${cfg.embedding?.model || NA} | ${cfg.embedding?.endpoint || NA} | ${cfg.embedding?.actualBackend?.backend || NA} |`);
  lines.push(`| Reranker | ${cfg.reranker?.configured ? '已配置' : '未配置'} | ${cfg.reranker?.model || NA} | ${cfg.reranker?.endpoint || NA} | ${cfg.reranker?.actualBackend?.backend || NA} |`);
  lines.push('');
  lines.push(`请求上限：${int(cfg.limits?.maxRequests)}；成本上限：¥${num(cfg.limits?.maxCostCny)}；LLM 估算单价：¥${num(cfg.limits?.pricePerMillionTokens)}/百万 token。`);
  lines.push(`API Key 仅从环境变量读取，未写入仓库或报告。${cfg.pricingNote || ''}`);
  lines.push('');

  lines.push('## 2. 样本 ID 与数量');
  lines.push('');
  for (const [batch, data] of [['dev', json.selection.dev], ['heldout（配置冻结后复核）', json.selection.heldout]]) {
    if (!data) continue;
    lines.push(`- **${batch}**：共 ${data.count} 条（${data.datasetVersion}）`);
    for (const [name, ids] of Object.entries(data.idsByDataset || {})) {
      lines.push(`  - ${name}（${ids.length}）：${ids.join(', ')}`);
    }
  }
  lines.push('');

  lines.push('## 3. 四种检索方案质量对比（分块级 Recall@5 / MRR@5）');
  lines.push('');
  lines.push('在线 dev：');
  lines.push('');
  lines.push('| 方案 | 样本 | Recall@5 | MRR@5 | 文档级 Recall@5 | 平均耗时(ms) | P95(ms) |');
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const row of dev.onlineRetrieval || []) {
    lines.push(`| ${row.name} | ${int(row.samples)} | ${pct(row.chunkRecallAt5)} | ${num(row.chunkMrRAt5, 4)} | ${pct(row.documentRecallAt5)} | ${num(row.avgMs)} | ${num(row.p95Ms)} |`);
  }
  lines.push('');
  lines.push('离线同 ID 基线：');
  lines.push('');
  lines.push('| 方案 | 样本 | Recall@5 | MRR@5 | 平均耗时(ms) |');
  lines.push('| --- | ---: | ---: | ---: | ---: |');
  for (const row of dev.offlineRetrieval || []) {
    lines.push(`| ${row.name} | ${int(row.samples)} | ${pct(row.chunkRecallAt5)} | ${num(row.chunkMrRAt5, 4)} | ${num(row.avgMs)} |`);
  }
  if (heldout.onlineRetrieval?.length) {
    lines.push('');
    lines.push('heldout 独立复核：');
    lines.push('');
    lines.push('| 方案 | 样本 | Recall@5 | MRR@5 | 平均耗时(ms) |');
    lines.push('| --- | ---: | ---: | ---: | ---: |');
    for (const row of heldout.onlineRetrieval) {
      lines.push(`| ${row.name} | ${int(row.samples)} | ${pct(row.chunkRecallAt5)} | ${num(row.chunkMrRAt5, 4)} | ${num(row.avgMs)} |`);
    }
  }
  lines.push('');

  lines.push('## 4. 问答、拒答与工具调用');
  lines.push('');
  lines.push('| 分组 | 模式 | 样本 | 要点覆盖 | 引用编号合法 | 引用支持 | 过度拒答 | 平均生成耗时(ms) |');
  lines.push('| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const [batch, data] of [['dev', dev], ['heldout', heldout]]) {
    for (const [label, row] of [
      ['离线确定性', data.offlineQa], ['在线 LLM', data.onlineLlmQa], ['在线确定性对照', data.onlineDeterministicQa]
    ].filter(([, r]) => r && r.status !== 'not_run' && r.samples > 0)) {
      lines.push(`| ${batch} | ${label} | ${int(row.samples)} | ${pct(row.factPointCoverageRate)} | ${pct(row.citationNumberValidRate)} | ${pct(row.citationSupportRate)} | ${pct(row.overRefusalRate)} | ${num(row.avgGenerationMs)} |`);
    }
  }
  lines.push('');
  for (const [batch, data] of [['dev', dev], ['heldout', heldout]]) {
    const off = data.offlineRefusal || {};
    const on = data.onlineRefusal || {};
    lines.push(`- ${batch} 拒答：离线 ${pct(off.refusalRate)} / 在线 ${pct(on.refusalRate)}；无依据回答率离线 ${pct(off.unwarrantedAnswerRate)} / 在线 ${pct(on.unwarrantedAnswerRate)}。`);
    const offN = data.offlineNlq || {};
    const onN = data.onlineNlq || {};
    lines.push(`- ${batch} 工具：离线精确匹配 ${pct(offN.exactMatchRate)}（${JSON.stringify(offN.intentModeSplit || {})}）/ 在线精确匹配 ${pct(onN.exactMatchRate)}（${JSON.stringify(onN.intentModeSplit || {})}）；在线工具选择准确率 ${pct(onN.toolSelectionAccuracy)}。`);
  }
  lines.push('');
  lines.push('检索质量、生成质量与权限安全分开统计：组织统计仅解析工具选择与参数，未执行 SQL；权限安全由现有离线门禁与回归测试覆盖，不并入本实验的“AI 准确率”。');
  lines.push('');

  lines.push('## 5. Token、请求数与预估成本');
  lines.push('');
  lines.push('| 范围 | 请求数 | LLM | Embedding | Rerank | Prompt tokens | Completion tokens | 估算成本(¥) |');
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const [label, usage] of [['dev', json.budget.dev], ['heldout', json.budget.heldout], ['合计', json.budget.total]]) {
    if (!usage) continue;
    lines.push(`| ${label} | ${int(usage.requests)} | ${int(usage.byKind?.llm)} | ${int(usage.byKind?.embedding)} | ${int(usage.byKind?.rerank)} | ${int(usage.promptTokens)} | ${int(usage.completionTokens)} | ${num(usage.estimatedCostCny, 4)} |`);
  }
  lines.push('');
  lines.push('成本按保守单价估算，Token 事后计费可能导致账单差异；未配置单价时按说明中的上限参数估算。');
  lines.push('');

  lines.push('## 6. 失败案例与错误归因');
  lines.push('');
  if (!json.failures.length) lines.push('- 无失败案例。');
  for (const f of json.failures.slice(0, 12)) {
    lines.push(`- [${f.dataset}/${f.category}] ${f.id}：${f.detail}${f.actual?.error ? `（${f.actual.error}）` : ''}`);
  }
  if (json.failures.length > 12) lines.push(`- 其余 ${json.failures.length - 12} 条见 JSON 报告。`);
  lines.push('');

  lines.push('## 7. 结论');
  lines.push('');
  lines.push(`- **总体判断**：${json.conclusion.verdict}`);
  lines.push(`- **Embedding**：${json.conclusion.embedding}`);
  lines.push(`- **Reranker**：${json.conclusion.reranker}`);
  lines.push(`- ${json.conclusion.text}`);
  lines.push('');
  lines.push('本实验不修改标准答案、不改变既有 RAG 策略，也未访问生产数据库。');
  lines.push('');
  return lines.join('\n');
}

function main() {
  const offlineDev = readJson('v3-offline-dev.json');
  const onlineDev = readJson('v3-online-dev.json', false);
  const offlineHeldout = readJson('v3-offline-heldout.json', false);
  const onlineHeldout = readJson('v3-online-heldout.json', false);

  const notRun = (reason) => ({ status: 'not_run', reason });
  const comparison = (offline, online) => ({
    offlineRetrieval: retrievalRows(offline),
    onlineRetrieval: online?.status === 'completed' ? retrievalRows(online) : [],
    offlineQa: qaRow(offline, 'deterministicFallback'),
    onlineLlmQa: online?.status === 'completed' ? qaRow(online, 'llm') : notRun(online?.stopReason || '在线报告缺失'),
    onlineDeterministicQa: online?.status === 'completed' ? qaRow(online, 'deterministicFallback') : notRun('在线报告缺失'),
    offlineRefusal: offline ? suiteSummary(offline, 'refusal') : {},
    onlineRefusal: online?.status === 'completed' ? suiteSummary(online, 'refusal') : {},
    offlineNlq: offline ? suiteSummary(offline, 'nlq') : {},
    onlineNlq: online?.status === 'completed' ? suiteSummary(online, 'nlq') : {}
  });

  const failures = [
    ...(onlineDev?.failures || []).map((f) => ({ batch: 'dev', ...f })),
    ...(onlineHeldout?.failures || []).map((f) => ({ batch: 'heldout', ...f }))
  ];
  const status = onlineDev?.status || 'not_run';
  const config = onlineDev?.environment?.config || offlineDev?.environment?.config || {};
  const json = {
    reportVersion: '3.0.0',
    title: 'AI 在线质量评测 V3 对照实验',
    generatedAt: new Date().toISOString(),
    datasetVersion: offlineDev?.datasetVersion || NA,
    status,
    stopReason: onlineDev?.stopReason || null,
    config,
    selection: {
      dev: offlineDev?.selection || null,
      heldout: offlineHeldout?.selection || null
    },
    runs: {
      offlineDev: { status: offlineDev?.status || 'not_run' },
      onlineDev: {
        status: onlineDev?.status || 'not_run',
        degraded: Boolean(onlineDev?.degraded),
        stopReason: onlineDev?.stopReason || null
      },
      offlineHeldout: { status: offlineHeldout?.status || 'not_run' },
      onlineHeldout: { status: onlineHeldout?.status || 'not_run', stopReason: onlineHeldout?.stopReason || null }
    },
    comparison: {
      dev: comparison(offlineDev, onlineDev),
      heldout: offlineHeldout ? comparison(offlineHeldout, onlineHeldout) : null
    },
    budget: {
      dev: onlineDev?.usage || null,
      heldout: onlineHeldout?.usage || null,
      total: addUsage(onlineDev?.usage, onlineHeldout?.usage)
    },
    failures,
    limitations: onlineDev?.limitations || [],
    conclusion: buildConclusion(onlineDev, onlineHeldout)
  };

  const jsonPath = path.join(REPORT_DIR, 'online-comparison-v3.json');
  const mdPath = path.join(REPORT_DIR, 'online-comparison-v3.md');
  fs.writeFileSync(jsonPath, `${JSON.stringify(json, null, 2)}\n`);
  fs.writeFileSync(mdPath, markdown(json));
  console.log(`已生成：${jsonPath}\n        ${mdPath}`);
  console.log(`在线状态：${status}；结论：${json.conclusion.verdict}`);
}

main();
