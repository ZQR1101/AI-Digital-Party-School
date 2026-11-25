/**
 * 评测集 v1.1.0 构建脚本（可重复执行，幂等）。
 *
 * 职责：
 * 1. 扩充检索样本到 40 条、NLQ 样本到 25 条（全部事实均可回溯到 knowledge/ 原文）；
 * 2. 为每条样本补 split（dev / heldout）与 category，按 ID 哈希确定，避免人工挑样偏差；
 * 3. 为检索/问答样本补 evidence：从标注来源文档中按查询词重叠挑出**原文逐字片段**，
 *    作为分块级评测的稳定标注映射（文档解析会产生滑动窗口，chunk.id 不适合做长期标注）；
 * 4. 不覆盖人工已写的 evidence，不删除任何历史样本（含已知低分样本）。
 *
 * 用法：node ai-eval/tools/build-datasets-v11.js
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'datasets');
const KB = path.resolve(ROOT, '../knowledge');
const VERSION = '1.1.0';
const UPDATED_AT = '2026-11-25';

const NEW_RETRIEVAL = [
  { id: 'ret-025', query: '为什么党员的党龄不能从递交入党申请那天开始算', relevant: ['党员组织关系与党籍管理.md'], category: '同义改写' },
  { id: 'ret-026', query: '连续多久不参加组织生活会被当成自行脱党', relevant: ['党员组织关系与党籍管理.md'], category: '精确事实' },
  { id: 'ret-027', query: '毕业去外地工作组织关系要转吗 预备期会不会重新计算', relevant: ['党员组织关系与党籍管理.md'], category: '跨段落' },
  { id: 'ret-028', query: '领导班子开的批评会和普通党员支部开的会是一回事吗', relevant: ['党组织生活制度规范.md'], category: '易混淆制度' },
  { id: 'ret-029', query: '支部党员大会 支委会 党小组会 党课各多久开一次', relevant: ['党组织生活制度规范.md'], category: '精确事实' },
  { id: 'ret-030', query: '六项纪律里禁止违规收礼和公款吃喝的是哪一类', relevant: ['党规党纪与纪律处分要点.md'], category: '相似概念' },
  { id: 'ret-031', query: '警告和严重警告算不算两种处分 一共有几种党纪处分', relevant: ['党规党纪与纪律处分要点.md'], category: '易混淆制度' },
  { id: 'ret-032', query: '税后月收入两千元的党员每月党费交多少比例', relevant: ['党费收缴使用与管理规定.md'], category: '精确事实' },
  { id: 'ret-033', query: '学生党员每个月交党费的具体金额是多少', relevant: ['党费收缴使用与管理规定.md'], category: '精确事实' },
  { id: 'ret-034', query: '支部选举要过半赞成 接收预备党员是不是也要过半', relevant: ['党的基层组织建设与换届选举.md', '党员教育管理与发展工作细则.md'], category: '多文档' },
  { id: 'ret-035', query: '支部委员会一届任期是多少年', relevant: ['党的基层组织建设与换届选举.md'], category: '精确事实' },
  { id: 'ret-036', query: '入党积极分子培养时间和预备党员预备期分别是多久', relevant: ['党员教育管理与发展工作细则.md'], category: '跨段落' },
  { id: 'ret-037', query: '党的七大把什么确立为党的指导思想 发生在哪一年', relevant: ['党史学习教育要点.md'], category: '精确事实' },
  { id: 'ret-038', query: '完成率和及格率的统计口径分别怎么定义', relevant: ['指标统计口径.md'], category: '多文档' },
  { id: 'ret-039', query: '知识库能不能直接给出实时的学习完成率数值', relevant: ['指标统计口径.md'], category: '相似概念' },
  { id: 'ret-040', query: '八项规定里精简会议和精简文件简报分别要求什么', relevant: ['中央八项规定精神与作风建设.md'], category: '易混淆制度' }
];

const NEW_NLQ = [
  { id: 'nlq-021', message: '查询全校最近6个月学习时长趋势', expect: { metric: 'total_study_hours', organizationName: null, timeRangeLabel: '最近6个月（含本月）', groupBy: 'month' }, category: '月度趋势' },
  { id: 'nlq-022', message: '机关党委本月考试及格率是多少', expect: { metric: 'exam_pass_rate', organizationName: '机关党委', timeRangeLabel: '2026年6月', groupBy: null }, category: '组织识别' },
  { id: 'nlq-023', message: '学生第一党支部上个月学习完成率', expect: { metric: 'learning_completion_rate', organizationName: '学生第一党支部', timeRangeLabel: '2026年5月', groupBy: null }, category: '时间范围' },
  { id: 'nlq-024', message: '请问学生第二党支部2025年的活跃党员人数', expect: { metric: 'active_member_count', organizationName: '学生第二党支部', timeRangeLabel: '2025年', groupBy: null }, category: '指标选择' },
  { id: 'nlq-025', message: '软件工程系党总支党员人数分布', expect: { metric: 'member_distribution', organizationName: '软件工程系党总支', timeRangeLabel: '2026年', groupBy: null }, category: '组织识别' }
];

function read(name) {
  return JSON.parse(fs.readFileSync(path.join(DIR, `${name}.dataset.json`), 'utf8'));
}
function write(name, data) {
  data.version = VERSION;
  data.updatedAt = UPDATED_AT;
  fs.writeFileSync(path.join(DIR, `${name}.dataset.json`), `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}
function splitFor(id) {
  const byte = crypto.createHash('sha1').update(id).digest()[0];
  return byte % 10 < 3 ? 'heldout' : 'dev';
}

const docs = {};
for (const file of fs.readdirSync(KB).filter((f) => f.endsWith('.md'))) {
  docs[file] = fs.readFileSync(path.join(KB, file), 'utf8');
}

function tokens(text) {
  const raw = String(text || '').toLowerCase();
  const latin = raw.match(/[a-z0-9]+/g) || [];
  const cjk = raw.replace(/[^\u4e00-\u9fa5]/g, '');
  const grams = [];
  for (let i = 0; i + 1 < cjk.length; i++) grams.push(cjk.slice(i, i + 2));
  return [...latin, ...grams];
}

/** 从来源文档挑出与问题最相关的逐字句子，作为 chunk 级标注（不改写、不生成） */
function evidenceFor(sources, query, keywords = [], keywordsOnly = false) {
  const wanted = keywordsOnly
    ? keywords.map((k) => String(k).toLowerCase())
    : tokens(query).concat(keywords.map((k) => String(k).toLowerCase()));
  const evidence = [];
  for (const source of sources) {
    const text = docs[source];
    if (!text) continue;
    const sentences = text.split(/(?<=[。！？；\n])/).map((s) => s.trim()).filter((s) => s.length >= 12 && !s.startsWith('#'));
    const scored = sentences.map((s) => {
      const lower = String(s).toLowerCase();
      // 关键词模式按“命中的不同要点数”计分；提问词模式按词元重叠计分
      const score = keywordsOnly
        ? keywords.reduce((n, k) => n + (lower.includes(String(k).toLowerCase()) ? 1 : 0), 0)
        : wanted.reduce((n, t) => n + (lower.includes(String(t)) ? 1 : 0), 0);
      return { s, score };
    }).sort((a, b) => b.score - a.score || b.s.length - a.s.length);
    if (scored.length && scored[0].score > 0) {
      evidence.push({ source, snippet: scored[0].s.slice(0, 220) });
    }
  }
  return evidence;
}

// ---- 检索集 ----
const retrieval = read('retrieval');
const existingIds = new Set(retrieval.cases.map((c) => c.id));
for (const item of NEW_RETRIEVAL) {
  if (!existingIds.has(item.id)) retrieval.cases.push(item);
}
for (const item of retrieval.cases) {
  item.split = item.split || splitFor(item.id);
  item.category = item.category || '同义改写';
  if (!item.evidence || !item.evidence.length) {
    item.evidence = evidenceFor(item.relevant, item.query);
  }
}
write('retrieval', retrieval);

// ---- NLQ 集 ----
const nlq = read('nlq');
const nlqIds = new Set(nlq.cases.map((c) => c.id));
for (const item of NEW_NLQ) if (!nlqIds.has(item.id)) nlq.cases.push(item);
for (const item of nlq.cases) {
  item.split = item.split || splitFor(item.id);
  item.category = item.category || '参数解析';
}
write('nlq', nlq);

// ---- 问答 / 拒答 / 引用 / 工具参数 / 权限：只补 split 与问答 evidence ----
const qa = read('qa');
for (const item of qa.cases) {
  item.split = item.split || splitFor(item.id);
  // 问答证据按标准答案要点定位（而非提问词），避免挑到同一文档的无关段落
  item.evidence = evidenceFor([item.expectedSource], item.question, item.expectedKeywords, true);
}
write('qa', qa);

for (const name of ['refusal', 'citation', 'tool-params', 'access']) {
  const data = read(name);
  for (const item of data.cases) item.split = item.split || splitFor(item.id);
  write(name, data);
}

console.log('评测集构建完成：', Object.fromEntries(
  ['retrieval', 'qa', 'refusal', 'citation', 'nlq', 'tool-params', 'access']
    .map((name) => [name, read(name).cases.length])
));
