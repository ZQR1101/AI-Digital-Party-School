/**
 * Reciprocal Rank Fusion (RRF) 倒数排名融合算法
 * 消除 BM25 词频统计绝对值与向量距离余弦相似度之间的量纲差异，
 * 对双路检索结果进行科学无偏的排序融合。
 */
function reciprocalRankFusion(bm25Results, vectorResults, options = {}) {
  const k = options.k ?? 60;
  const bm25Weight = options.bm25Weight ?? 1.0;
  const vectorWeight = options.vectorWeight ?? 1.0;
  const topN = options.topN ?? 20;

  const scoreMap = new Map(); // chunkId -> { chunk, rrfScore, bm25Rank, vectorRank, bm25Score, vectorScore }

  // 1. Process BM25 rankings
  for (let rank = 0; rank < bm25Results.length; rank++) {
    const item = bm25Results[rank];
    const id = item.chunk.id;
    const rrfContrib = bm25Weight / (k + rank + 1);

    if (!scoreMap.has(id)) {
      scoreMap.set(id, {
        chunk: item.chunk,
        rrfScore: 0,
        bm25Rank: rank + 1,
        vectorRank: null,
        bm25Score: item.bm25Score,
        vectorScore: null
      });
    }
    const entry = scoreMap.get(id);
    entry.rrfScore += rrfContrib;
    entry.bm25Rank = rank + 1;
    entry.bm25Score = item.bm25Score;
  }

  // 2. Process Vector rankings
  for (let rank = 0; rank < vectorResults.length; rank++) {
    const item = vectorResults[rank];
    const id = item.chunk.id;
    const rrfContrib = vectorWeight / (k + rank + 1);

    if (!scoreMap.has(id)) {
      scoreMap.set(id, {
        chunk: item.chunk,
        rrfScore: 0,
        bm25Rank: null,
        vectorRank: rank + 1,
        bm25Score: null,
        vectorScore: item.vectorScore
      });
    }
    const entry = scoreMap.get(id);
    entry.rrfScore += rrfContrib;
    entry.vectorRank = rank + 1;
    entry.vectorScore = item.vectorScore;
  }

  const merged = Array.from(scoreMap.values());
  merged.sort((a, b) => b.rrfScore - a.rrfScore);

  return merged.slice(0, topN);
}

module.exports = { reciprocalRankFusion };
