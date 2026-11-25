// 评测指标库：检索排序指标与文本覆盖度计算（确定性，无外部依赖）

/** Top-K 内是否命中任一相关来源 */
function hitAtK(rankedSources, relevantSources, k) {
  const relSet = new Set(relevantSources);
  return rankedSources.slice(0, k).some((s) => relSet.has(s)) ? 1 : 0;
}

/** Top-K 召回的相关来源比例（多相关来源时逐个计入） */
function recallAtK(rankedSources, relevantSources, k) {
  if (!relevantSources.length) return 0;
  const relSet = new Set(relevantSources);
  const found = new Set(rankedSources.slice(0, k).filter((s) => relSet.has(s)));
  return found.size / relevantSources.length;
}

/** Top-K 内首个相关来源的倒数排名（MRR 分子） */
function reciprocalRank(rankedSources, relevantSources, k) {
  const relSet = new Set(relevantSources);
  const top = rankedSources.slice(0, k);
  for (let i = 0; i < top.length; i++) {
    if (relSet.has(top[i])) return 1 / (i + 1);
  }
  return 0;
}

function mean(values) {
  if (!values.length) return 0;
  return Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 10000) / 10000;
}

/** 关键词覆盖率：expectedKeywords 在文本中的命中比例 */
function keywordCoverage(text, keywords) {
  if (!keywords || !keywords.length) return 1;
  const normalized = String(text || '');
  const hit = keywords.filter((kw) => normalized.includes(kw)).length;
  return hit / keywords.length;
}

/** 命中的关键词列表（用于失败诊断） */
function missingKeywords(text, keywords) {
  const normalized = String(text || '');
  return (keywords || []).filter((kw) => !normalized.includes(kw));
}

/** 速率统计：field 为行属性名或谓词函数 */
function rateOf(rows, fieldOrPredicate) {
  if (!rows.length) return 1;
  const passCount = typeof fieldOrPredicate === 'function'
    ? rows.filter(fieldOrPredicate).length
    : rows.filter((r) => r[fieldOrPredicate]).length;
  return Math.round((passCount / rows.length) * 10000) / 10000;
}

module.exports = { hitAtK, recallAtK, reciprocalRank, mean, keywordCoverage, missingKeywords, rateOf };
