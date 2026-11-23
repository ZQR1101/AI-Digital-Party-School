const axios = require('axios');
const { tokenize } = require('./bm25');

/**
 * Reranker —— 真实语义重排客户端（默认面向阿里云百炼 DashScope 的 OpenAI 兼容 rerank 接口）。
 *
 * 配置：
 *   RERANKER_API_URL   rerank 端点；未配置则使用本地关键词重排。
 *                      百炼示例：https://dashscope.aliyuncs.com/compatible-api/v1/reranks
 *   RERANKER_API_KEY   该服务专用 Key；缺省依次回退 DASHSCOPE_API_KEY、EMBEDDING_API_KEY、AI_API_KEY。
 *   RERANKER_MODEL     模型名，默认 qwen3-rerank（百炼 Qwen3 重排系列）。
 *   RERANKER_TIMEOUT_MS 请求超时，默认 8000ms。
 *
 * 说明：百炼兼容端点为 /compatible-api/v1/reranks（复数），响应 results[].{index, relevance_score}，
 *       与 SiliconFlow 的 /v1/rerank 结构一致，故解析逻辑通用。
 * 调用失败时降级为本地精准关键词重排，并通过 lastBackend 暴露实际后端。
 */
class Reranker {
  static isApiConfigured() {
    // URL 与 Key 必须同时具备才算接入真实重排服务，避免无 Key 时空转请求
    return Boolean(process.env.RERANKER_API_URL && this.apiKey);
  }

  static get apiKey() {
    return process.env.RERANKER_API_KEY
      || process.env.DASHSCOPE_API_KEY
      || process.env.EMBEDDING_API_KEY
      || process.env.AI_API_KEY
      || '';
  }

  static get timeoutMs() {
    return Number(process.env.RERANKER_TIMEOUT_MS || 8000);
  }

  static getBackendInfo() {
    return {
      configured: this.isApiConfigured(),
      model: process.env.RERANKER_MODEL || 'qwen3-rerank',
      ...(this.lastBackend || {})
    };
  }

  static async rerank(query, candidates, topK = 5) {
    if (!candidates.length) return [];

    if (this.isApiConfigured()) {
      const headers = {};
      if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
      try {
        const response = await axios.post(
          process.env.RERANKER_API_URL,
          {
            model: process.env.RERANKER_MODEL || 'qwen3-rerank',
            query,
            documents: candidates.map(c => `${c.chunk.title}\n${c.chunk.content}`),
            top_n: Math.min(topK, candidates.length)
          },
          { headers, timeout: this.timeoutMs, proxy: false }
        );

        const results = response.data?.results;
        if (Array.isArray(results)) {
          const scored = results.map(r => {
            const idx = Number(r.index);
            const candidate = candidates[idx];
            if (!candidate) return null;
            return {
              chunk: candidate.chunk,
              relevanceScore: Math.max(0, Math.min(1, Number(r.relevance_score ?? r.score ?? 0))),
              rrfScore: candidate.rrfScore,
              bm25Score: candidate.bm25Score,
              vectorScore: candidate.vectorScore,
              model: 'reranker-api'
            };
          }).filter(Boolean);
          scored.sort((a, b) => b.relevanceScore - a.relevanceScore);
          this.lastBackend = { backend: 'api', semantic: true, scored: scored.length };
          return scored.slice(0, topK);
        }
      } catch (err) {
        console.warn('[Reranker] API 重排调用失败，降级为本地精准重排:', err.message);
        this.lastBackend = { backend: 'local-keyword', semantic: false, error: err.message };
      }
    }

    const result = this.localRerank(query, candidates, topK);
    if (!this.lastBackend || this.lastBackend.backend !== 'local-keyword') {
      this.lastBackend = { backend: 'local-keyword', semantic: false };
    }
    return result;
  }

  static localRerank(query, candidates, topK = 5) {
    const qTokens = tokenize(query);
    const qRaw = String(query).toLowerCase().replace(/[^\u4e00-\u9fa5a-z0-9]/g, '');

    const scored = candidates.map(item => {
      const chunk = item.chunk;
      const titleLower = String(chunk.title || '').toLowerCase();
      const contentLower = String(chunk.content || '').toLowerCase();

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
        vectorScore: item.vectorScore,
        model: 'local-keyword'
      };
    });

    scored.sort((a, b) => b.relevanceScore - a.relevanceScore);
    return scored.slice(0, topK);
  }
}

module.exports = Reranker;
