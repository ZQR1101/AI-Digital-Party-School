/**
 * V4 报告生成器：汇总 offline.json / online.json，回答规定的 5 个问题。
 * 严格区分检索质量 / 生成质量 / 权限安全；自动启发式与人工复核分开；成本标明估算口径。
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../../..');
const DIR = path.resolve(ROOT, 'ai-eval/reports/v4');
const read = (f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
const off = read('offline.json');
const on = read('online.json');
const kbManifest = read('kb-manifest.json');
const fetchEvidence = read('fetch-evidence.json');
const review = read('human-review-batch.json');
const DATASETS = ['retrieval', 'qa', 'refusal', 'citation'];
const counts = Object.fromEntries(DATASETS.map((n) => [n, JSON.parse(fs.readFileSync(path.resolve(ROOT, `ai-eval/datasets/v4/${n}.dataset.json`), 'utf8')).cases.length]));
const totalCount = Object.values(counts).reduce((a, b) => a + b, 0);
const retrievalCases = JSON.parse(fs.readFileSync(path.resolve(ROOT, 'ai-eval/datasets/v4/retrieval.dataset.json'), 'utf8')).cases;
const multiCount = retrievalCases.filter((c) => (c.evidence || []).length > 1).length;
const rv = review.summary;

const NA = 'N/A';
const pct = (v) => typeof v === 'number' && Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : NA;
const num = (v, d = 2) => typeof v === 'number' && Number.isFinite(v) ? v.toFixed(d) : NA;

function schemeRows(report) {
  const s = report.suites.retrieval.summary;
  const real = report.mode === 'online';
  return [
    ['A · BM25', s.bm25],
    [real ? 'B · 真实 Embedding' : 'B · 本地哈希向量', s.vector],
    [real ? 'C · BM25+真实Embedding+RRF' : 'C · BM25+本地向量+RRF', s.hybrid],
    [real ? 'D · C+真实Reranker' : 'D · C+本地关键词重排', s.hybrid_rerank]
  ].map(([name, v]) => ({
    name, samples: v.chunk.samples,
    hit1: v.chunk.hitAt1, recall5: v.chunk.recallAt5, mrr5: v.chunk.mrrAt5,
    docRecall5: v.document.recallAt5, avgMs: v.chunk.avgMs, p95Ms: v.chunk.p95Ms
  }));
}

function catRecall(report, cfg, category) {
  const rows = report.suites.retrieval.details[cfg].chunk.filter((r) => r.category === category);
  if (!rows.length) return NA;
  return rows.reduce((a, b) => a + b.recallAt5, 0) / rows.length;
}

const offRows = schemeRows(off);
const onRows = schemeRows(on);
const lines = [];
lines.push('# AI 质量评测 V4 · 扩展知识库与高难度评测集');
lines.push('');
lines.push(`- 生成时间：${new Date().toISOString()} ｜ Git Commit：${off.gitCommit}`);
lines.push(`- 知识库：V4 独立库 ${off.knowledgeBase.files} 份文档（SHA256 ${off.knowledgeBase.sha256.slice(0, 16)}…），V1.1.0 基线与历史报告均未改动`);
lines.push(`- 数据集：v4.0.0 共 ${totalCount} 条（${counts.retrieval} 检索 / ${counts.qa} 问答 / ${counts.refusal} 拒答 / ${counts.citation} 引用真实性），dev/heldout 独立划分；标准答案与证据经脚本逐字校验`);
lines.push(`- 运行方式：离线全量（外部 Key 置空，向量为本地哈希、重排为本地关键词，**不代表真实模型**）+ 在线分层抽样 12 条（显式开关、严格预算、真实 Embedding/Reranker/LLM，真实模型守卫拦截任何降级）`);
lines.push(`- 在线模型：Embedding=BAAI/bge-m3（硅基流动）、Reranker=BAAI/bge-reranker-v2-m3（硅基流动）、LLM=deepseek-v4-flash。原百炼 Embedding 因账号免费额度耗尽（AllocationQuota.FreeTierOnly）不可用，在线实验改用硅基流动同规格模型，未以本地哈希冒充；该切换不影响离线结论。`);
lines.push(`- 检索参数：知识库为章节级文档（按条款/段落切分索引）；BM25 与向量各召回 topN=20，RRF k=60，评测取 Top-5；在线 Embedding 1024 维，Reranker 对融合候选重排后取 Top-5；生成模型 deepseek-v4-flash（服务默认温度）。`);
lines.push(`- 严格区分：离线指标用于方案结构与数据质量诊断；只有在线指标可用于评价真实模型收益，二者不混算、不互相替代。`);
lines.push('');

lines.push('## 1. 知识库扩展与来源核验');
lines.push('');
lines.push(`- 保留原有 10 份 Markdown 作为历史基础语料（V4-LEGACY-*，来源元数据标注为“待补”）。`);
lines.push(`- 从公开权威来源抓取并结构化摘编 ${kbManifest.docs.filter((d) => d.key !== 'legacy').length} 份党内法规章节文档：党章（2022）、纪律处分条例（2023）、支部工作条例（试行）、党员教育管理工作条例、发展党员工作细则（2026 修订）。`);
lines.push(`- 每份文档记录：来源 URL、发布单位、发布日期、获取日期、适用范围、版本、有效性状态、来源域名、来源页 SHA256；正文为原文条款，不改写。`);
const okFetched = fetchEvidence.filter((f) => f.httpStatus === 200 && f.text).length;
const failedFetch = fetchEvidence.filter((f) => !(f.httpStatus === 200 && f.text));
const covSaturated = review.cases.filter((c) => c.auto.factCoverage === 1).length;
lines.push(`- 抓取证据：${okFetched}/${fetchEvidence.length} 份源页面抓取成功并保存 HTTP 状态/字节数/SHA256 到 fetch-evidence.json${failedFetch.length ? `；抓取失败：${failedFetch.map((f) => `${f.name}（${f.error || 'HTTP ' + f.httpStatus}）`).join('、')}，未纳入知识库` : '，无抓取失败'}。`);
lines.push(`- 版本处理：同时收录 2026 年修订版（现行有效）与 2014 年版《发展党员工作细则》（标注“历史版本·已失效”，来源中国政府网），并在元数据中写明版本与有效性，避免混用。`);
lines.push(`- 合规：仅保存来源链接、元数据与必要条款文本，未批量转载整页 HTML；无个人敏感信息与生产业务数据。`);
lines.push('');

lines.push('## 2. 数据集与SHA256');
lines.push('');
lines.push('| 数据集 | 条数 | SHA256 |');
lines.push('| --- | ---: | --- |');
for (const [name, hash] of Object.entries(off.datasetSha256)) {
  lines.push(`| ${name} | ${counts[name]} | ${hash.slice(0, 24)}… |`);
}
lines.push('');
lines.push(`证据全部由脚本按“文件名+条文号”从知识库原文精确抽取，validate-dataset.js 校验逐字匹配；${totalCount} 条全部通过，未修改标准答案、未删除低分样本。`);
lines.push('');

lines.push('## 3. 四方案检索对比（分块级 Hit@1 / Recall@5 / MRR@5）');
lines.push('');
lines.push(`离线全量（${counts.retrieval} 条检索样本）：`);
lines.push('');
lines.push('| 方案 | 样本 | Hit@1 | Recall@5 | MRR@5 | 文档级 Recall@5 | 平均(ms) | P95(ms) |');
lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
for (const r of offRows) lines.push(`| ${r.name} | ${r.samples} | ${pct(r.hit1)} | ${pct(r.recall5)} | ${num(r.mrr5, 4)} | ${pct(r.docRecall5)} | ${num(r.avgMs)} | ${num(r.p95Ms)} |`);
lines.push('');
lines.push(`多证据完整覆盖率（${multiCount} 条多来源样本，Top-5 覆盖全部必需来源）：${Object.entries(off.suites.retrieval.evidenceCompleteness).map(([k, v]) => `${k}=${pct(v.rate)}`).join('；')}`);
lines.push('');
lines.push('在线分层抽样（12 条，真实 Embedding=BAAI/bge-m3 + Reranker=BAAI/bge-reranker-v2-m3）：');
lines.push('');
lines.push('| 方案 | 样本 | Hit@1 | Recall@5 | MRR@5 | 平均(ms) | P95(ms) |');
lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: |');
for (const r of onRows) lines.push(`| ${r.name} | ${r.samples} | ${pct(r.hit1)} | ${pct(r.recall5)} | ${num(r.mrr5, 4)} | ${num(r.avgMs)} | ${num(r.p95Ms)} |`);
lines.push('');
lines.push('按类别分块 Recall@5（离线）：');
lines.push('');
lines.push('| 类别 | 样本 | BM25 | 向量（离线为本地哈希） | RRF | +重排（离线为本地关键词） |');
lines.push('| --- | ---: | ---: | ---: | ---: | ---: |');
for (const cat of ['同义改写', '相近概念', '跨文档检索', '多跳推理', '多条件', '版本辨析']) {
  const n = off.suites.retrieval.details.bm25.chunk.filter((r) => r.category === cat).length;
  lines.push(`| ${cat} | ${n} | ${pct(catRecall(off, 'bm25', cat))} | ${pct(catRecall(off, 'vector', cat))} | ${pct(catRecall(off, 'hybrid', cat))} | ${pct(catRecall(off, 'hybrid_rerank', cat))} |`);
}
lines.push('');

lines.push('## 4. 生成质量、拒答与引用（检索 / 生成 / 权限分开）');
lines.push('');
lines.push(`- 问答（离线确定性）：事实要点覆盖率 ${pct(off.suites.qa.deterministic.factPointCoverageRate)}，来源匹配率 ${pct(off.suites.qa.deterministic.sourceMatchedRate)}，过度拒答率 ${pct(off.suites.qa.deterministic.overRefusalRate)}。`);
lines.push(`- 问答（在线抽样 12 条）：LLM 生成 ${on.suites.qa.deterministic.byMode.llm} 条、确定性兜底 ${on.suites.qa.deterministic.byMode.fallback} 条；其“事实要点覆盖率 ${pct(on.suites.qa.deterministic.factPointCoverageRate)}”来自兜底摘录，不能代表 LLM 质量。LLM 生成质量以 4.1 的 ${rv.llmGenerated} 条专项批次为准（抽样批次中恰好有问答样本被证据门禁拦下）。`);
lines.push(`- 无答案正确拒答率：离线 ${pct(off.suites.refusal.noAnswerCorrectRefusalRate)}，在线 ${pct(on.suites.refusal.noAnswerCorrectRefusalRate)}；离线结果显著偏低，表明确定性链路在扩展库中把无答案问题错误匹配到相似条文（见失败案例）。`);
lines.push(`- 引用真实性（越界引用识别）：离线 ${pct(off.suites.citation.validRate)}，在线 ${pct(on.suites.citation.validRate)}。`);
lines.push(`- 人工复核工作表：离线 ${off.humanReviewSheet.count} 条 + 在线 LLM ${rv.requested} 条两套工作表（见 4.1），均 **pending_human_review**；自动启发式评分与人工复核分开记录，未冒充人工结论。`);
lines.push(`- 权限安全：本轮未访问生产数据库；组织统计不涉及 SQL；权限正确性由现有离线门禁与回归测试覆盖，不并入本实验指标。`);
lines.push('');
lines.push('### 4.1 LLM 问答人工复核批次');
lines.push('');
lines.push(`- 样本：全部 ${rv.requested} 条问答样本，真实 LLM 生成 ${rv.llmGenerated} 条、确定性兜底 ${rv.deterministicFallback} 条（${rv.deterministicFallbackIds.join(', ')}）；完成 ${rv.completed}/${rv.requested}，失败 ${rv.failed}。`);
lines.push(`- 自动启发式（仅参考）：事实要点覆盖均值 ${pct(rv.autoMeanFactCoverage)}（仅 LLM ${pct(rv.llmOnlyMeanFactCoverage)}），来源匹配率 ${pct(rv.autoSourceMatchedRate)}，平均答案长度 ${rv.meanAnswerChars} 字；疑似原文整段摘录 ${rv.extractiveDumpCount} 条。`);
lines.push(`- 启发式饱和与误判：35 条中 34 条自动覆盖为 100%，但其中 3 条实为无关条文整段摘录；反之 v4-q-011 的 LLM 答案事实正确（"影响期=原未执行影响期+新处分影响期"），却因措辞改写被判 0 覆盖。**说明自动事实覆盖不能替代人工判定。**`);
lines.push(`- 人工字段（factCorrect / complete / citationSupported / errorType / reviewer）在 ai-eval/reports/v4/human-review-batch.json 中全部为 null，待人工逐条填写；Markdown 工作表：ai-eval/reports/v4/human-review-batch.md。`);
lines.push('');

lines.push('## 5. 请求数、延迟与估算成本');
lines.push('');
const u = on.budget.usage;
const ru = review.budget.usage;
lines.push(`- 在线检索/问答（12 条）：${u.requests} 请求（LLM ${u.byKind.llm} / Embedding ${u.byKind.embedding} / Rerank ${u.byKind.rerank}），总 token ${u.totalTokens}（prompt ${u.promptTokens} + completion ${u.completionTokens}），模型 ${u.models.join(', ')}。`);
lines.push(`- LLM 复核批次（${rv.requested} 条问答）：${ru.requests} 请求（LLM ${ru.byKind.llm} / Embedding ${ru.byKind.embedding} / Rerank ${ru.byKind.rerank}），总 token ${ru.totalTokens}，模型 ${ru.models.join(', ')}。`);
lines.push(`- 估算成本：在线 ${num(u.estimatedCostCny, 4)} + 复核 ${num(ru.estimatedCostCny, 4)} = ¥${num(u.estimatedCostCny + ru.estimatedCostCny, 4)}。**注意**：本轮未配置 Embedding / Rerank 单价（unitPrice 中为 0），该数字仅含 LLM token 估算，是成本下界；实际账单以服务商为准。`);
lines.push(`- 延迟：离线 BM25 平均 ${num(offRows[0].avgMs)}ms / P95 ${num(offRows[0].p95Ms)}ms；在线真实 Embedding 平均 ${num(onRows[1].avgMs)}ms / P95 ${num(onRows[1].p95Ms)}ms；在线 Reranker 平均 ${num(onRows[3].avgMs)}ms / P95 ${num(onRows[3].p95Ms)}ms。`);
lines.push('');

lines.push('## 6. 规定问题回答');
lines.push('');
lines.push(`**Q1 知识库扩大后 BM25 是否下降？** 没有下降。离线全量 BM25 分块 Recall@5 ${pct(offRows[0].recall5)}，高于 RRF（${pct(offRows[2].recall5)}）与向量方案（${pct(offRows[1].recall5)}，离线为本地哈希）。原因是权威法规条文含大量条文号、数字与专有名词，词面精确匹配占优。需注意：无答案正确拒答率仅 ${pct(off.suites.refusal.noAnswerCorrectRefusalRate)}，扩大语料使相似条文更易被误匹配，这是另一维度的退化。`);
lines.push(`**Q2 真实 Embedding 对同义改写、多跳是否提升？** 离线（本地哈希向量）未见提升：同义改写 Recall@5 由 BM25 ${pct(catRecall(off, 'bm25', '同义改写'))} 降至向量 ${pct(catRecall(off, 'vector', '同义改写'))}，多跳由 ${pct(catRecall(off, 'bm25', '多跳推理'))} 降至 ${pct(catRecall(off, 'vector', '多跳推理'))}。在线小样本（真实 Embedding）中同义改写 Recall@5 ${pct(catRecall(on, 'vector', '同义改写'))} 高于 BM25 ${pct(catRecall(on, 'bm25', '同义改写'))}，但样本仅 2 条，不足以证明稳定收益；且真实 Embedding 平均延迟约 ${num(onRows[1].avgMs)}ms，远高于 BM25。**结论：暂无可信证据支持真实 Embedding 在这两类问题上优于 BM25。**`);
lines.push(`**Q3 Reranker 是否改善证据排序，还是引入排序损失？** 离线几乎无改善（MRR@5 ${num(offRows[2].mrr5, 4)}→${num(offRows[3].mrr5, 4)}），在线小样本 MRR@5 由 ${num(onRows[2].mrr5, 4)} 升至 ${num(onRows[3].mrr5, 4)}，但 P95 延迟由 ${num(onRows[2].p95Ms)}ms 增至 ${num(onRows[3].p95Ms)}ms。综合判断：未观察到稳定的重排收益，且延迟代价显著。`);
lines.push(`**Q4 真实 LLM 是否比确定性摘录更准确、更完整？** 在线复核批次中 ${rv.llmGenerated} 条由真实 LLM 生成、${rv.deterministicFallback} 条走确定性兜底。自动事实要点覆盖：LLM ${pct(rv.llmOnlyMeanFactCoverage)}，离线确定性摘录 ${pct(off.suites.qa.deterministic.factPointCoverageRate)}；但该启发式会饱和（${covSaturated}/${rv.requested} 条为 100%，其中 ${rv.extractiveDumpCount} 条实为整段摘录），也误判过正确改写（v4-q-011 判 0），**不能作为质量结论**。可确认的是：LLM 答案更接近自然表述、能合并多来源并给出引用；确定性兜底在证据门禁未通过时会输出整段无关条文（v4-q-035 即摘到错误法规）。是否更准确、更完整，须待 ${rv.requested} 条人工复核完成后判定。`);
lines.push(`**Q5 哪种方案在质量/延迟/成本间最值得部署？** 当前证据下 **BM25（方案 A）** 最稳妥：离线质量最高、延迟最低、无外部 API 成本。真实 Embedding 与 Reranker 未带来稳定质量提升，却引入 200~700ms 级延迟与持续调用成本，不建议默认启用；如需改善拒答，应优先改证据门禁策略（本轮按要求不做算法重构）。`);
lines.push('');

lines.push('## 7. 失败案例与错误归因');
lines.push('');
const allFail = [...off.failures.map((f) => ({ ...f, batch: 'offline' })), ...on.failures.map((f) => ({ ...f, batch: 'online' }))];
for (const f of allFail.slice(0, 12)) lines.push(`- [${f.batch}/${f.category}] ${f.id}：${f.detail}${f.actual?.error ? `（${f.actual.error}）` : ''}`);
lines.push(`- [review/deterministic_fallback] ${rv.deterministicFallbackIds.join('、')}：证据门禁未通过时走确定性兜底，输出为检索到的整段条文摘录，其中 v4-q-035 摘到的是《发展党员工作细则》而非《支部工作条例》，与问题不匹配。这是当前确定性链路的真实缺陷（离线拒答率 16.7% 同源）。`);
lines.push('- 版本辨析 0/2：v4-r-019 为设计缺陷样本（两版年龄条件相同、证据仅锚定现行版，已保留不删）；v4-r-049 是补入 2014 历史版后新增的真实对照样本，失败类型为“文档级命中、证据分块未进 Top-5”——两版第十三条措辞高度相似，近似条文互相挤占候选位。四方案均未解决，说明分块级检索对近重复版本缺乏区分力，这是后续需要专门处理的问题（本轮不做算法重构）。');
lines.push('- 在线评测中出现 1 次 Embedding API 超时（8s），被真实模型守卫拦截并标记 not_run，未用本地哈希向量冒充；离线不受影响。百炼 Embedding 免费额度耗尽已改用硅基流动 bge-m3，若后续再出现额度/超时问题，应按 not_run 记录，不得回退冒充。');
lines.push('');

lines.push('## 8. 结论边界');
lines.push('');
lines.push(`本轮为数据建设与可信评测，未修改 RAG 策略、未改标准答案、未删除低分样本、未访问生产数据库、未泄漏 API Key。验收标准是得到可指导技术选型的可信实验结果，而非漂亮准确率。下一步应先完成 ${rv.requested} 条 LLM 答案人工复核（工作表已生成），再据失败归因决定是否进入算法优化轮次。`);
lines.push('');

const mdPath = path.join(DIR, 'v4-evaluation.md');
const jsonPath = path.join(DIR, 'v4-evaluation.json');
fs.writeFileSync(mdPath, lines.join('\n'));
fs.writeFileSync(jsonPath, `${JSON.stringify({
  version: '4.0.0', generatedAt: new Date().toISOString(), gitCommit: off.gitCommit,
  knowledgeBase: off.knowledgeBase, datasetSha256: off.datasetSha256,
  datasetCount: totalCount, datasetCounts: counts, kbDocCount: kbManifest.docCount,
  schemes: { offline: offRows, online: onRows },
  categoryRecall: Object.fromEntries(['同义改写', '相近概念', '跨文档检索', '多跳推理', '多条件', '版本辨析'].map((c) => [c, { bm25: catRecall(off, 'bm25', c), embedding: catRecall(off, 'vector', c), rrf: catRecall(off, 'hybrid', c), rerank: catRecall(off, 'hybrid_rerank', c) }])),
  evidenceCompleteness: off.suites.retrieval.evidenceCompleteness,
  qa: { offline: off.suites.qa.deterministic, online: on.suites.qa.deterministic, llmStatus: on.suites.qa.llm.status },
  refusal: { offline: off.suites.refusal.noAnswerCorrectRefusalRate, online: on.suites.refusal.noAnswerCorrectRefusalRate },
  citation: { offline: off.suites.citation.validRate, online: on.suites.citation.validRate },
  humanReview: { status: 'pending_human_review', offlineSheetCount: off.humanReviewSheet.count, llmBatch: rv, sheet: 'ai-eval/reports/v4/human-review-batch.json' },
  usage: { online: on.budget.usage, review: review.budget.usage },
  failures: allFail,
  answers: {
    q1: 'BM25 未下降，离线全量 Recall@5 最高；但无答案拒答率偏低是扩大语料的退化',
    q2: '真实 Embedding 对同义改写/多跳未见稳定提升，离线反而下降，在线小样本不足以证明收益',
    q3: 'Reranker 离线几乎无 MRR 改善，在线小样本 MRR 略升但 P95 延迟显著增加',
    q4: `LLM 生成 ${rv.llmGenerated} 条、兜底 ${rv.deterministicFallback} 条；自动覆盖饱和且误判，不能作为质量结论，须待 ${rv.requested} 条人工复核`,
    q5: '当前 BM25 最值得部署；真实 Embedding/Reranker 不建议默认启用'
  }
}, null, 2)}\n`);
console.log(`V4 报告已生成：${mdPath}\n              ${jsonPath}`);
