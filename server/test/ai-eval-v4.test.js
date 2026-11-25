/**
 * V4 数据与评测产物完整性守护。
 * 不调用任何外部 API：只校验数据集证据锚定、划分、复核表未预填与报告结构。
 * 运行：node --test test/ai-eval-v4.test.js
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.resolve(ROOT, 'ai-eval/datasets/v4');
const KB = path.resolve(ROOT, 'knowledge-v4');
const REPORTS = path.resolve(ROOT, 'ai-eval/reports/v4');
const NAMES = ['retrieval', 'qa', 'refusal', 'citation'];
const load = (n) => JSON.parse(fs.readFileSync(path.join(DATA, `${n}.dataset.json`), 'utf8'));

test('V4 数据集通过严格证据校验脚本', () => {
  const out = execFileSync(process.execPath, [path.join(ROOT, 'ai-eval/tools/v4/validate-dataset.js')], { encoding: 'utf8' });
  assert.match(out, /全部通过/);
});

test('V4 数据集规模与划分符合约定', () => {
  const all = NAMES.flatMap((n) => load(n).cases);
  assert.strictEqual(all.length, 105, 'V4 样本总数应为 105');
  const counts = Object.fromEntries(NAMES.map((n) => [n, load(n).cases.length]));
  assert.deepStrictEqual(counts, { retrieval: 49, qa: 36, refusal: 12, citation: 8 });
  // id 全局唯一
  const ids = all.map((c) => c.id);
  assert.strictEqual(new Set(ids).size, ids.length, '存在重复样本 id');
  // 每个数据集都必须同时具备 dev / heldout，保留集不参与调参
  for (const n of NAMES) {
    const splits = new Set(load(n).cases.map((c) => c.split));
    assert.ok(splits.has('dev') && splits.has('heldout'), `${n} 缺少 dev 或 heldout 划分`);
  }
});

test('V4 证据必须逐字存在于知识库源文件', () => {
  // 拒答样本可无证据（无答案即其定义）；检索/问答/引用必须有证据且逐字命中
  const all = ['retrieval', 'qa', 'citation'].flatMap((n) => load(n).cases);
  const cache = new Map();
  for (const c of all) {
    assert.ok(Array.isArray(c.evidence) && c.evidence.length, `${c.id} 缺少证据`);
    for (const e of c.evidence) {
      assert.ok(e.source && fs.existsSync(path.join(KB, e.source)), `${c.id} 证据来源不存在: ${e.source}`);
      assert.ok(typeof e.snippet === 'string' && e.snippet.trim().length >= 8, `${c.id} 证据片段过短`);
      if (!cache.has(e.source)) cache.set(e.source, fs.readFileSync(path.join(KB, e.source), 'utf8'));
      const text = cache.get(e.source).replace(/\s+/g, '');
      assert.ok(text.includes(e.snippet.replace(/\s+/g, '')), `${c.id} 证据未逐字命中: ${e.snippet.slice(0, 40)}`);
    }
  }
  // 拒答样本如自带证据，同样必须逐字命中
  for (const c of load('refusal').cases.filter((x) => Array.isArray(x.evidence) && x.evidence.length)) {
    for (const e of c.evidence) {
      const text = fs.readFileSync(path.join(KB, e.source), 'utf8').replace(/\s+/g, '');
      assert.ok(text.includes(e.snippet.replace(/\s+/g, '')), `${c.id} 证据未逐字命中`);
    }
  }
});

test('V4 问答样本必须有标准答案与必备事实点', () => {
  for (const c of load('qa').cases) {
    assert.ok(c.answer && c.answer.length >= 8, `${c.id} 缺少标准答案`);
    assert.ok(Array.isArray(c.requiredFacts) && c.requiredFacts.length >= 1, `${c.id} 缺少必备事实点`);
    assert.ok(c.expectedSource, `${c.id} 缺少期望来源`);
  }
  for (const c of load('refusal').cases.filter((x) => x.answerable === false)) {
    assert.ok(c.note && c.note.length >= 6, `${c.id} 无答案样本缺少判定说明`);
  }
});

test('LLM 复核表存在且人工字段未被预填', () => {
  const file = path.join(REPORTS, 'human-review-batch.json');
  assert.ok(fs.existsSync(file), '缺少 human-review-batch.json');
  const r = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.strictEqual(r.status, 'completed');
  assert.ok(r.summary.requested >= 30, `复核样本应不少于 30，实际 ${r.summary.requested}`);
  assert.ok(r.summary.llmGenerated >= 30, `真实 LLM 生成样本应不少于 30，实际 ${r.summary.llmGenerated}`);
  assert.strictEqual(r.summary.failed, 0);
  for (const c of r.cases) {
    for (const k of ['factCorrect', 'complete', 'citationSupported', 'errorType', 'reviewer', 'reviewedAt']) {
      assert.strictEqual(c.human[k], null, `${c.id} 人工字段 ${k} 不应被预填`);
    }
  }
  // 前端/后端模型必须是真实 API，不允许本地降级冒充
  if (r.backend?.embedding) assert.strictEqual(r.backend.embedding.backend, 'api');
});

test('V4 报告回答五个规定问题且未泄漏 Key', () => {
  const md = fs.readFileSync(path.join(REPORTS, 'v4-evaluation.md'), 'utf8');
  for (const q of ['Q1', 'Q2', 'Q3', 'Q4', 'Q5']) assert.ok(md.includes(`**${q} `), `报告缺少 ${q}`);
  const json = JSON.parse(fs.readFileSync(path.join(REPORTS, 'v4-evaluation.json'), 'utf8'));
  assert.strictEqual(json.datasetCount, 105);
  assert.ok(json.usage.online && json.usage.review, '报告缺少两阶段用量');
  const files = ['v4-evaluation.md', 'v4-evaluation.json', 'human-review-batch.json', 'offline.json', 'online.json'];
  for (const f of files) {
    const t = fs.readFileSync(path.join(REPORTS, f), 'utf8');
    assert.ok(!/sk-[A-Za-z0-9]{16,}/.test(t), `${f} 疑似包含 API Key`);
  }
});
