// AI 质量评测报告输出：机器可读 JSON + 人工可审查 Markdown
const fs = require('fs');
const path = require('path');
const { NA } = require('./envinfo');

function truncate(text, max = 120) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function pct(value) {
  return typeof value !== 'number' ? NA : `${(value * 100).toFixed(1)}%`;
}

function num(value) {
  if (typeof value !== 'number') return NA;
  return Number(value.toFixed(4));
}

function metricLine(summary) {
  return Object.entries(summary || {})
    .filter(([k, v]) => k !== 'samples' && ['number', 'string'].includes(typeof v))
    .map(([k, v]) => `${k}=${typeof v === 'number' ? num(v) : v}`)
    .join('，');
}

function retrievalTable(lines, report) {
  const cfg = report.suites.retrieval?.summary?.configurations;
  if (!cfg) return;
  lines.push('| 检索配置 | 粒度 | Hit@1 | Hit@3 | Hit@5 | Recall@3 | Recall@5 | MRR@5 | 平均耗时 | P95 |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const [name, data] of Object.entries(cfg)) {
    for (const granularity of ['document', 'chunk']) {
      const s = data[granularity];
      lines.push(`| ${name} | ${granularity} | ${num(s.hitAt1)} | ${num(s.hitAt3)} | ${num(s.hitAt5)} | ${num(s.recallAt3)} | ${num(s.recallAt5)} | ${num(s.mrrAt5)} | ${num(s.avgMs)}ms | ${num(s.p95Ms)}ms |`);
    }
  }
  lines.push('');
  lines.push('> dev/heldout 分组指标见 JSON 报告 `suites.retrieval.summary.configurations.<方案>.<粒度>.bySplit`；不用保留集反复调参。');
  lines.push('');
}

function buildMarkdown(report) {
  const lines = [];
  lines.push(`# AI 质量评测报告 V2（${report.mode === 'online' ? '在线真实模型' : '离线确定性'}）`);
  lines.push('');
  lines.push(`- 报告版本：${report.reportVersion} ｜ 数据集版本：${report.datasetVersion} ｜ 状态：${report.status}`);
  lines.push(`- 生成时间：${report.generatedAt} ｜ Git Commit：\`${report.environment.gitCommit}\``);
  lines.push(`- 运行环境：Node ${report.environment.node} / ${report.environment.platform} ｜ CI：${report.environment.ci ? '是' : '否'}`);
  lines.push(`- 知识库版本：${report.environment.knowledgeBase.files} 个 Markdown ｜ SHA256 \`${report.environment.knowledgeBase.sha256}\``);
  lines.push(`- 固定时钟：${report.fixedNow} ｜ 样本划分规则：${report.environment.config.datasetSplitRule}`);
  lines.push(`- 样本总数：${report.totals.samples}，通过：${report.totals.passed}（${pct(report.totals.passRate)}），失败：${report.totals.failed}`);
  if (report.gate) {
    lines.push(`- CI 门禁（依据：${report.gate.basis}；${report.gate.heldoutUsage}）：${report.gate.passed ? '✅ 通过' : `❌ 未通过（${report.gate.breaches.map((b) => `${b.suite}.${b.metric} 实际 ${b.actual ?? NA} < 阈值 ${b.floor}`).join('；')}）`}`);
  }
  lines.push('');

  lines.push('## 评测边界与局限');
  lines.push('');
  for (const item of report.limitations || []) lines.push(`- ${item}`);
  lines.push('');

  lines.push('## 运行配置与后端');
  lines.push('');
  lines.push(`- Embedding：${JSON.stringify(report.environment.config.backend.embedding)}`);
  lines.push(`- Reranker：${JSON.stringify(report.environment.config.backend.reranker)}`);
  lines.push(`- 分块数：${report.environment.config.backend.chunkCount} ｜ 向量维度：${report.environment.config.backend.vectorDim}`);
  lines.push(`- LLM 生成：${report.environment.config.aiConfigured ? '已配置' : '未配置（离线走确定性兜底）'}`);
  lines.push(`- 检索参数：topK=${report.environment.config.topK} ｜ topN=${report.environment.config.topN}`);
  if (report.mode === 'online') {
    const o = report.online;
    lines.push(`- 在线状态：${o.status}${o.reason ? `（${o.reason}）` : ''}`);
    if (o.usage && o.usage !== NA) {
      lines.push(`- 预算：请求上限 ${o.limits.maxRequests}，成本上限 ¥${o.limits.maxCostCny}，超时 ${o.limits.timeoutMs}ms，业务层重试上限 ${o.limits.transportMaxAttempts}`);
      lines.push(`- 调用量：${o.usage.requests} 次（LLM ${o.usage.byKind.llm} 含重试 / Embedding ${o.usage.byKind.embedding} 批次 / Reranker ${o.usage.byKind.rerank}）｜ Tokens：${o.usage.totalTokens}（prompt ${o.usage.promptTokens} / completion ${o.usage.completionTokens}）｜ 估算成本 ¥${o.usage.estimatedCostCny}`);
      lines.push(`- 超预算停止：${o.usage.stopped ? `是（${o.usage.stopReason}）` : '否'} ｜ 实际模型：${o.usage.models.join('、') || NA}`);
      if (o.note) lines.push(`- 计量说明：${o.note}`);
    }
  }
  lines.push('');

  lines.push('## 检索四方案对比（文档级 / 分块级）');
  lines.push('');
  if (!report.suites.retrieval?.summary?.configurations) {
    lines.push(`未运行：${NA}`);
  } else {
    retrievalTable(lines, report);
  }

  lines.push('## 分项指标');
  lines.push('');
  lines.push('| 分项 | 样本数 | 关键指标 |');
  lines.push('|---|---|---|');
  for (const [name, suite] of Object.entries(report.suites)) {
    if (name === 'retrieval') continue;
    lines.push(`| ${suite.title || name} | ${suite.summary?.samples ?? NA} | ${suite.summary ? metricLine(suite.summary) : NA} |`);
  }
  lines.push('');
  lines.push('> 所有未运行项以 N/A 标记，不以 0 或 100% 代替；关键词覆盖率/要点覆盖率/证据支持度均为启发式辅助判定，LLM Judge 与人工事实核验未运行（N/A）。');
  lines.push('');
  lines.push('### dev / heldout 独立指标');
  lines.push('');
  lines.push('| 分项 | 划分 | 样本数 | 关键指标 |');
  lines.push('|---|---|---|---|');
  for (const [name, suite] of Object.entries(report.suites)) {
    for (const split of ['dev', 'heldout']) {
      const s = suite.bySplit?.[split];
      if (!s) continue;
      lines.push(`| ${suite.title || name} | ${split} | ${s.samples ?? NA} | ${metricLine(s)} |`);
    }
  }
  lines.push('');
  lines.push('> dev 为调参依据；heldout 仅最终独立报告，严禁反复用于阈值调整。');
  lines.push('');

  lines.push('## 最值得优化的三个问题');
  lines.push('');
  for (const rec of report.recommendations || []) {
    lines.push(`${rec.rank}. **[影响：${rec.impact}]** ${rec.problem} → ${rec.suggestion}`);
  }
  lines.push('');

  lines.push(`## 失败案例（${report.failures.length} 条；输入已脱敏，不含密钥/真实用户数据）`);
  lines.push('');
  if (!report.failures.length) {
    lines.push('无失败样本。');
  } else {
    for (const f of report.failures) {
      lines.push(`### [${f.category}] ${f.dataset} / ${f.id}`);
      lines.push('');
      if (f.input !== undefined) lines.push(`- 输入：\`${typeof f.input === 'string' ? truncate(f.input) : JSON.stringify(f.input)}\``);
      if (f.expected !== undefined) lines.push(`- 期望：\`${JSON.stringify(f.expected)}\``);
      if (f.actual !== undefined) lines.push(`- 实际：\`${JSON.stringify(f.actual)}\``);
      if (f.detail) lines.push(`- 诊断：${f.detail}`);
      if (f.sources) lines.push(`- 命中来源：${f.sources}`);
      lines.push('');
    }
  }
  return lines.join('\n');
}

/**
 * 写出：run-<时间戳>.json/.md（历史归档）+ latest.json/.md（最新基线）
 */
function writeReports(outDir, report) {
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date(report.generatedAt).toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const targets = [
    path.join(outDir, `run-${stamp}.json`),
    path.join(outDir, `run-${stamp}.md`),
    path.join(outDir, 'latest.json'),
    path.join(outDir, 'latest.md')
  ];
  const json = JSON.stringify(report, null, 2);
  const md = buildMarkdown(report);
  for (const target of targets) fs.writeFileSync(target, target.endsWith('.json') ? json : md, 'utf8');
  return targets;
}

module.exports = { writeReports, buildMarkdown, truncate, pct };
