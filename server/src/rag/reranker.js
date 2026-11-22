const axios = require('axios');
const { tokenize } = require('./bm25');

class Reranker {
  static isApiConfigured() {
    return Boolean(process.env.RERANKER_API_URL);
  }

  static async rerank(query, candidates, topK = 5) {
    if (!candidates.length) return [];

    if (this.isApiConfigured()) {
      try {
        const response = await axios.post(
          process.env.RERANKER_API_URL,
          {
            model: process.env.RERANKER_MODEL || 'BAAI/bge-reranker-large',
            query,
            documents: candidates.map(c => `${c.chunk.title}\n${c.chunk.content}`)
          },
          {
            headers: process.env.AI_API_KEY ? { Authorization: `Bearer ${process.env.AI_API_KEY}` } : {},
            timeout: 5000
          }
        );

        if (response.data?.results && Array.isArray(response.data.results)) {
          const scored = response.data.results.map(r => ({
            chunk: candidates[r.index].chunk,
            relevanceScore: Math.max(0, Math.min(1, Number(r.relevance_score || 0))),
            rrfScore: candidates[r.index].rrfScore
          }));
          scored.sort((a, b) => b.relevanceScore - a.relevanceScore);
          return scored.slice(0, topK);
        }
      } catch (err) {
        console.warn('[Reranker] API 重排调用失败，使用内置精准重排引擎:', err.message);
      }
    }

    return this.localRerank(query, candidates, topK);
  }

  static localRerank(query, candidates, topK = 5) {
    const qTokens = tokenize(query);
    const qRaw = String(query).toLowerCase().replace(/[^\u4e00-\u9fa5a-z0-9]/g, '');

    const scored = candidates.map(item => {
      const chunk = item.chunk;
      const titleLower = String(chunk.title || '').toLowerCase();
      const contentLower = String(chunk.content || '').toLowerCase();
      const combined = `${titleLower}\n${contentLower}`;

      let score = 0;

      // 1. Title match bonus (up to 0.35)
      if (titleLower.includes(qRaw) || qRaw.includes(titleLower)) {
        score += 0.35;
      } else {
        let titleOverlap = 0;
        for (const t of qTokens) {
          if (titleLower.includes(t)) titleOverlap += 1;
        }
        score += Math.min(0.25, (titleOverlap / Math.max(1, qTokens.length)) * 0.35);
      }

      // 2. Exact phrase match in content (up to 0.30)
      if (contentLower.includes(qRaw)) {
        score += 0.30;
      } else {
        // N-gram coverage in content
        let tokenMatches = 0;
        for (const t of qTokens) {
          if (contentLower.includes(t)) tokenMatches += 1;
        }
        const coverage = tokenMatches / Math.max(1, qTokens.length);
        score += coverage * 0.25;
      }

      // 3. RRF Rank bonus (up to 0.25)
      const rrfNorm = Math.min(0.25, item.rrfScore * 5);
      score += rrfNorm;

      // 4. Vector similarity contribution (up to 0.10)
      if (item.vectorScore != null) {
        score += Math.max(0, item.vectorScore) * 0.10;
      }

      const calibrated = Math.min(0.98, Math.max(0.05, Math.round(score * 100) / 100));
      return {
        chunk,
        relevanceScore: calibrated,
        rrfScore: item.rrfScore,
        bm25Score: item.bm25Score,
        vectorScore: item.vectorScore
      };
    });

    scored.sort((a, b) => b.relevanceScore - a.relevanceScore);
    return scored.slice(0, topK);
  }
}

module.exports = Reranker;
