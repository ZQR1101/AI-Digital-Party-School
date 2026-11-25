/**
 * AI 评测 V3 样本选择器。
 *
 * 目标：复用 V1.1.0 的 122 条固定样本，但允许显式按 ID / 类别 / 数量筛选 10~20 条，
 * 不允许为了在线实验自动扩大样本量，也不修改任何标准答案。
 */
const fs = require('fs');
const path = require('path');

const DATASETS_DIR = path.join(__dirname, '..', 'datasets');
const DATASET_NAMES = ['retrieval', 'qa', 'refusal', 'nlq'];
const DEFAULT_MAX_LIMIT = 20;

// 全部来自 dev；覆盖同义改写、相似概念、多文档/跨段落证据定位、事实问答、拒答与真实工具意图。
// heldout 单独成组，只在 dev 配置冻结后做一次独立复核，不参与任何调参。
const PRESETS = {
  'v3-online': {
    retrieval: ['ret-001', 'ret-006', 'ret-018', 'ret-023', 'ret-030', 'ret-034', 'ret-036', 'ret-039'],
    qa: ['qa-001', 'qa-002', 'qa-005', 'qa-007', 'qa-008'],
    refusal: ['ref-001', 'ref-005', 'ref-006', 'ref-009'],
    nlq: ['nlq-003', 'nlq-004', 'nlq-012']
  },
  'v3-heldout': {
    retrieval: ['ret-002', 'ret-028'],
    qa: ['qa-004'],
    refusal: ['ref-007'],
    nlq: ['nlq-001']
  }
};

function parseList(value) {
  if (!value) return [];
  const arr = Array.isArray(value) ? value : String(value).split(',');
  return arr.map((x) => String(x).trim()).filter(Boolean);
}

function loadDataset(name) {
  return JSON.parse(fs.readFileSync(path.join(DATASETS_DIR, `${name}.dataset.json`), 'utf8'));
}

function categoryOf(item) {
  return item.category || item.domain || null;
}

/**
 * @param {object} options
 * @param {string} [options.preset] v3-online / v3-heldout
 * @param {string|string[]} [options.ids] 显式样本 ID（不给 preset 时使用）
 * @param {string|string[]} [options.categories] 类别/领域筛选
 * @param {'dev'|'heldout'} [options.split] 数据划分筛选
 * @param {number} [options.limit] 总量上限，默认不超过 20
 */
function selectSamples({ preset, ids, categories, split, limit, maxLimit = DEFAULT_MAX_LIMIT } = {}) {
  if (preset && !PRESETS[preset]) throw new Error(`未知评测预设：${preset}`);
  if (preset && (ids || categories || split)) {
    throw new Error('preset 与 ids/categories/split 不可同时使用，避免组合出隐式扩样');
  }
  const wantedIds = parseList(ids);
  const wantedCategories = parseList(categories);
  const max = Math.max(1, Math.min(maxLimit, Number(limit) || maxLimit));
  if (Number(limit) > maxLimit) throw new Error(`样本数量上限为 ${maxLimit}，拒绝自动扩大评测规模`);
  if (split && !['dev', 'heldout'].includes(split)) throw new Error('split 仅支持 dev 或 heldout');

  const selected = [];
  for (const name of DATASET_NAMES) {
    const cases = loadDataset(name).cases;
    let subset;
    if (preset) {
      const orderedIds = PRESETS[preset][name] || [];
      const byId = new Map(cases.map((c) => [c.id, c]));
      const missing = orderedIds.filter((id) => !byId.has(id));
      if (missing.length) throw new Error(`预设 ${preset} 引用了不存在的 ${name} 样本：${missing.join(',')}`);
      subset = orderedIds.map((id) => ({ ...byId.get(id), dataset: name }));
    } else {
      subset = cases
        .filter((c) => (!wantedIds.length || wantedIds.includes(c.id)))
        .filter((c) => (!wantedCategories.length || wantedCategories.includes(categoryOf(c))))
        .filter((c) => (!split || c.split === split))
        .map((c) => ({ ...c, dataset: name }));
    }
    selected.push(...subset);
  }

  if (wantedIds.length) {
    const found = new Set(selected.map((c) => c.id));
    const missing = wantedIds.filter((id) => !found.has(id));
    if (missing.length) throw new Error(`未找到样本 ID：${missing.join(',')}`);
    // 保持调用方给出的 ID 顺序，便于离线与在线逐条对照。
    const rank = new Map(wantedIds.map((id, i) => [id, i]));
    selected.sort((a, b) => rank.get(a.id) - rank.get(b.id));
  }

  const truncated = selected.length > max;
  const cases = selected.slice(0, max);
  const idsByDataset = {};
  for (const c of cases) (idsByDataset[c.dataset] ||= []).push(c.id);
  const splitCounts = cases.reduce((acc, c) => { acc[c.split] = (acc[c.split] || 0) + 1; return acc; }, {});
  const categoryCounts = cases.reduce((acc, c) => {
    const key = categoryOf(c) || c.dataset;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  return {
    cases,
    meta: {
      preset: preset || null,
      requestedIds: wantedIds,
      requestedCategories: wantedCategories,
      requestedSplit: split || null,
      limit: max,
      count: cases.length,
      truncated,
      idsByDataset,
      splitCounts,
      categoryCounts,
      datasetVersion: loadDataset('retrieval').version
    }
  };
}

module.exports = { selectSamples, PRESETS, DATASET_NAMES, categoryOf };
