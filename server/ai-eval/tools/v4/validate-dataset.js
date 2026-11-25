/**
 * V4 数据集严格证据校验器。
 *
 * 目的：确保每条样本的“标准答案 / 必备事实点 / 来源 / 证据片段”可被人工与程序核验，
 * 禁止“模型生成即认定为 Ground Truth”。校验规则：
 *   1. 每条 evidence.snippet 必须在对应 source 文件中逐字出现（归一化空白后比较）；
 *   2. evidence.source / relevant 文件必须存在于 V4 知识库；
 *   3. answerable=false 的样本不得要求检索命中证据（无答案题）；
 *   4. answerable=true 的样本必须有 evidence 且覆盖 requiredFacts（词面支撑检查）；
 *   5. requiredFacts 不得为空；标准答案不得为空；
 *   6. 版本辨析类样本必须标注 versionNote 且两个版本的证据来自不同文件/不同片段；
 *   7. 不得出现 API Key 形态的字符串（sk- 前缀）。
 *
 * 用法：node ai-eval/tools/v4/validate-dataset.js [--dir=ai-eval/datasets/v4] [--kb=knowledge-v4]
 * 退出码：0 全部通过；1 存在校验失败。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../..');
const DATASET_DIR = path.resolve(ROOT, arg('dir', 'ai-eval/datasets/v4'));
const KB_DIR = path.resolve(ROOT, arg('kb', 'knowledge-v4'));

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

function normalize(text) {
  return String(text || '').replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n+/g, '\n').trim();
}

const kbCache = new Map();
function kbText(source) {
  if (!kbCache.has(source)) {
    const file = path.join(KB_DIR, source);
    kbCache.set(source, fs.existsSync(file) ? normalize(fs.readFileSync(file, 'utf8')) : null);
  }
  return kbCache.get(source);
}

const STOPWORDS = new Set(['不得', '应当', '一般', '超过', '规定', '可以', '进行', '一个', '有关', '对于', '根据', '之日', '起算', '从', '为']);

// 中文无空格：用 CJK 二元组 + 英文/数字词作为“词面支撑”单位
function keywordTokens(text) {
  const s = normalize(text);
  const tokens = new Set();
  const ascii = s.match(/[a-zA-Z0-9]+/g) || [];
  ascii.filter((t) => t.length >= 2).forEach((t) => tokens.add(t));
  const cjk = s.match(/[\u4e00-\u9fa5]+/g) || [];
  for (const seg of cjk) {
    if (seg.length <= 2) { tokens.add(seg); continue; }
    for (let i = 0; i + 2 <= seg.length; i++) {
      const bg = seg.slice(i, i + 2);
      if (!STOPWORDS.has(bg)) tokens.add(bg);
    }
  }
  return [...tokens];
}

function factSupported(fact, snippets) {
  const joined = normalize(snippets.join(' '));
  const f = normalize(fact);
  if (joined.includes(f)) return true;
  const tokens = keywordTokens(f);
  if (!tokens.length) return false;
  const hits = tokens.filter((t) => joined.includes(t)).length;
  // 人工设计的事实点允许省略修饰语，按二元组词面覆盖率判定（>=0.6）
  return hits / tokens.length >= 0.6;
}

function validateCase(item, errors, needsQa) {
  const id = item.id || '(no-id)';
  if (!item.id) errors.push(`${id}: 缺少 id`);
  if (!item.query || !normalize(item.query)) errors.push(`${id}: 缺少问题`);
  // 仅问答集要求标准答案与必备事实点；检索集/拒答集不涉及生成答案
  if (needsQa) {
    if (!item.answer || !normalize(item.answer)) errors.push(`${id}: 缺少标准答案`);
    if (!Array.isArray(item.requiredFacts) || !item.requiredFacts.length) {
      errors.push(`${id}: requiredFacts 不得为空`);
    }
  }
  if (!['dev', 'heldout'].includes(item.split)) errors.push(`${id}: split 非法 (${item.split})`);
  if (typeof item.answerable !== 'boolean') errors.push(`${id}: 缺少 answerable 布尔标注`);
  const evidence = item.evidence || [];
  if (item.answerable && !evidence.length) errors.push(`${id}: 可回答样本必须有 evidence`);
  if (!item.answerable && evidence.length) errors.push(`${id}: 无答案样本不应提供 evidence`);

  if (!Array.isArray(item.relevant)) errors.push(`${id}: relevant 必须为数组`);
  for (const source of item.relevant || []) {
    if (kbText(source) === null) errors.push(`${id}: relevant 来源文件不存在于知识库: ${source}`);
  }
  for (const [i, ev] of evidence.entries()) {
    if (!ev.source || !ev.snippet) {
      errors.push(`${id}: evidence[${i}] 缺少 source/snippet`);
      continue;
    }
    const text = kbText(ev.source);
    if (text === null) {
      errors.push(`${id}: evidence[${i}] 来源文件不存在: ${ev.source}`);
      continue;
    }
    if (!text.includes(normalize(ev.snippet))) {
      errors.push(`${id}: evidence[${i}] 证据片段未在来源文件中逐字出现: ${ev.source} :: ${normalize(ev.snippet).slice(0, 50)}`);
    }
  }
  if (item.answerable && evidence.length) {
    const snippets = evidence.map((e) => e.snippet);
    for (const fact of item.requiredFacts || []) {
      if (!factSupported(fact, snippets)) {
        errors.push(`${id}: 必备事实点缺少证据词面支撑: ${fact}`);
      }
    }
  }
  if (item.category === '版本辨析') {
    if (!item.versionNote) errors.push(`${id}: 版本辨析样本缺少 versionNote`);
    if (evidence.length < 2 || new Set(evidence.map((e) => e.source)).size < 2) {
      errors.push(`${id}: 版本辨析样本需要来自不同文件的至少 2 条证据`);
    }
  }
  if (JSON.stringify(item).includes('sk-')) errors.push(`${id}: 样本包含疑似 API Key`);
}

function main() {
  if (!fs.existsSync(DATASET_DIR)) {
    console.error(`数据集目录不存在: ${DATASET_DIR}`);
    process.exit(1);
  }
  const files = fs.readdirSync(DATASET_DIR).filter((f) => f.endsWith('.dataset.json')).sort();
  let total = 0;
  const errors = [];
  const summary = [];
  for (const file of files) {
    const data = JSON.parse(fs.readFileSync(path.join(DATASET_DIR, file), 'utf8'));
    const cases = data.cases || [];
    total += cases.length;
    const before = errors.length;
    const needsQa = file.startsWith('qa');
    cases.forEach((c) => validateCase(c, errors, needsQa));
    summary.push(`${file}: ${cases.length} 条, ${errors.length - before} 处问题`);
    if (data.version !== '4.0.0') errors.push(`${file}: 数据集版本应为 4.0.0, 实际 ${data.version}`);
  }
  console.log('=== V4 数据集严格证据校验 ===');
  summary.forEach((s) => console.log(s));
  console.log(`合计 ${total} 条, ${errors.length} 处问题`);
  if (errors.length) {
    console.log('--- 问题明细（前 40 条）---');
    errors.slice(0, 40).forEach((e) => console.log(' -', e));
    process.exit(1);
  }
  console.log('✅ 全部通过');
}

main();
