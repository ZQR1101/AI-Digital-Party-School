const axios = require('axios');
const { tokenize } = require('./bm25');

const DEFAULT_VECTOR_DIM = 1024;

function hashTokenToDim(token, maxDim = DEFAULT_VECTOR_DIM) {
  let hash = 2166136261;
  for (let i = 0; i < token.length; i++) {
    hash ^= token.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return Math.abs(hash >>> 0) % maxDim;
}

function normalizeVector(vec) {
  let norm = 0;
  for (let i = 0; i < vec.length; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm);
  if (norm === 0) return vec;
  for (let i = 0; i < vec.length; i++) vec[i] /= norm;
  return vec;
}

function cosineSimilarity(vecA, vecB) {
  const len = Math.min(vecA.length, vecB.length);
  let dot = 0;
  for (let i = 0; i < len; i++) dot += vecA[i] * vecB[i];
  return dot;
}

function isTestRuntime() {
  return process.env.NODE_ENV === 'test'
    || Boolean(process.env.NODE_TEST_CONTEXT)
    || Boolean(process.env.JEST_WORKER_ID);
}

/**
 * Qdrant HTTP 请求封装。
 * - proxy:false  避免环境中的 HTTP_PROXY 把 127.0.0.1 请求转发到不存在的代理
 * - Connection: close 阻止 keep-alive socket 残留在事件循环中
 * - AbortController 作为 axios timeout 的硬兜底，保证不可达时一定中断
 */
async function qdrantRequest(method, url, data, timeoutMs = 600) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await axios({
      method,
      url,
      data,
      timeout: timeoutMs,
      signal: controller.signal,
      proxy: false,
      headers: { Connection: 'close' },
      validateStatus: status => status >= 200 && status < 300
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * EmbeddingClient —— 真实语义向量客户端（OpenAI / SiliconFlow 兼容）。
 *
 * 配置优先级：
 *   EMBEDDING_API_URL  OpenAI 兼容的 embeddings 端点；未配置则判定为“未接入真实模型”。
 *   EMBEDDING_API_KEY  该服务专用 Key；缺省回退到 AI_API_KEY。
 *   EMBEDDING_MODEL    模型名，默认 BAAI/bge-m3。
 *   EMBEDDING_DIM      向量维度，默认 1024（BGE-M3）；真实返回维度会自动覆盖。
 *   EMBEDDING_BATCH    单次请求文本数，默认 32。
 *   EMBEDDING_TIMEOUT_MS 请求超时，默认 8000ms。
 *
 * 未配置或调用失败时降级为本地哈希特征向量（关键词级，非语义），
 * 并通过 lastBackendsnapshot 暴露当前实际使用的后端，便于评测与排障。
 */
class EmbeddingClient {
  static _envSnapshot() {
    return {
      configured: Boolean(process.env.EMBEDDING_API_URL),
      model: process.env.EMBEDDING_MODEL || 'BAAI/bge-m3',
      dim: Number(process.env.EMBEDDING_DIM || DEFAULT_VECTOR_DIM)
    };
  }

  static getBackendInfo() {
    return { ...(this.lastBackend || this._envSnapshot()) };
  }

  static isApiConfigured() {
    return Boolean(process.env.EMBEDDING_API_URL);
  }

  static get apiKey() {
    return process.env.EMBEDDING_API_KEY || process.env.AI_API_KEY || '';
  }

  static get timeoutMs() {
    return Number(process.env.EMBEDDING_TIMEOUT_MS || 8000);
  }

  static get batchSize() {
    return Math.max(1, Number(process.env.EMBEDDING_BATCH || 32));
  }

  static async embedTexts(texts) {
    if (!texts.length) return [];
    if (!this.isApiConfigured()) {
      this.lastBackend = { ...this._envSnapshot(), backend: 'local-hash', semantic: false };
      return texts.map(t => this.localEmbed(t));
    }

    const headers = {};
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;

    try {
      const allVectors = [];
      const batch = this.batchSize;
      for (let i = 0; i < texts.length; i += batch) {
        const slice = texts.slice(i, i + batch);
        const response = await axios.post(
          process.env.EMBEDDING_API_URL,
          {
            model: process.env.EMBEDDING_MODEL || 'BAAI/bge-m3',
            input: slice,
            encoding_format: 'float'
          },
          { headers, timeout: this.timeoutMs, proxy: false }
        );
        const rows = response.data?.data;
        if (!Array.isArray(rows) || rows.length !== slice.length) {
          throw new Error('embeddings 响应 data 数组长度与输入不一致');
        }
        // 响应可能按 index 乱序，需按 index 还原
        const indexed = rows.map((item, pos) => ({
          index: Number.isInteger(item.index) ? item.index : pos,
          embedding: item.embedding
        })).sort((a, b) => a.index - b.index);
        for (const item of indexed) {
          if (!Array.isArray(item.embedding) || !item.embedding.length) {
            throw new Error('embeddings 响应包含空向量');
          }
          allVectors.push(normalizeVector(Float32Array.from(item.embedding)));
        }
      }
      const dim = allVectors[0]?.length || DEFAULT_VECTOR_DIM;
      this.lastBackend = {
        ...this._envSnapshot(), dim, backend: 'api', semantic: true
      };
      return allVectors;
    } catch (err) {
      console.warn('[EmbeddingClient] API 调用失败，降级为本地哈希特征向量:', err.message);
      this.lastBackend = { ...this._envSnapshot(), backend: 'local-hash', semantic: false, error: err.message };
      return texts.map(t => this.localEmbed(t));
    }
  }

  static localEmbed(text) {
    const vec = new Float32Array(DEFAULT_VECTOR_DIM);
    const tokens = tokenize(text);
    if (!tokens.length) return vec;

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      const dim = hashTokenToDim(token);
      const sign = (hashTokenToDim(token + '_sign') % 2 === 0) ? 1 : -1;
      const weight = Math.min(3, Math.max(1, token.length));
      vec[dim] += sign * weight;
    }

    return normalizeVector(vec);
  }
}

class VectorStore {
  constructor(options = {}) {
    this.collectionName = options.collectionName || 'party_school_knowledge';
    this.qdrantUrl = options.qdrantUrl || process.env.QDRANT_URL || 'http://127.0.0.1:6333';
    this.qdrantAvailable = null;
    this.qdrantCheckInFlight = null; // 合并并发探测，避免重复建连
    this.inMemoryPoints = []; // [{ id, vector, chunk }]
    this.vectorDim = DEFAULT_VECTOR_DIM;
  }

  /**
   * Qdrant 必须显式启用：配置 QDRANT_URL 或 QDRANT_ENABLED=true。
   * 测试进程一律禁用，保证测试不依赖外部服务、不产生网络等待。
   */
  isQdrantEnabled() {
    if (process.env.QDRANT_ENABLED === 'false') return false;
    if (process.env.QDRANT_ENABLED === 'true') return true;
    if (isTestRuntime()) return false;
    return Boolean(process.env.QDRANT_URL);
  }

  async checkQdrant() {
    if (this.qdrantAvailable !== null) return this.qdrantAvailable;

    if (!this.isQdrantEnabled()) {
      this.qdrantAvailable = false;
      return false;
    }

    // 并发调用共享同一个探测 Promise（Promise.all 双路召回时只会探测一次）
    if (this.qdrantCheckInFlight) return this.qdrantCheckInFlight;

    this.qdrantCheckInFlight = (async () => {
      try {
        const res = await qdrantRequest('get', `${this.qdrantUrl}/collections`, null, 600);
        this.qdrantAvailable = res.status === 200;
      } catch {
        this.qdrantAvailable = false;
      } finally {
        this.qdrantCheckInFlight = null;
      }
      return this.qdrantAvailable;
    })();

    return this.qdrantCheckInFlight;
  }

  async index(chunks) {
    this.inMemoryPoints = [];
    if (!chunks.length) return;

    const texts = chunks.map(c => `${c.title}\n${c.content}`);
    const vectors = await EmbeddingClient.embedTexts(texts);
    this.vectorDim = vectors[0]?.length || DEFAULT_VECTOR_DIM;

    for (let i = 0; i < chunks.length; i++) {
      this.inMemoryPoints.push({
        id: chunks[i].id,
        vector: vectors[i],
        chunk: chunks[i]
      });
    }

    // 未启用 Qdrant 或连接失败时直接结束，内存向量索引已可用
    if (!(await this.checkQdrant())) return;

    try {
      await qdrantRequest('put', `${this.qdrantUrl}/collections/${this.collectionName}`, {
        vectors: { size: this.vectorDim, distance: 'Cosine' }
      }, 1500).catch(() => {});

      const points = this.inMemoryPoints.map((p, idx) => ({
        id: idx + 1,
        vector: Array.from(p.vector),
        payload: p.chunk
      }));

      await qdrantRequest('put', `${this.qdrantUrl}/collections/${this.collectionName}/points?wait=true`, {
        points
      }, 2000);
    } catch (err) {
      console.warn('[VectorStore] Qdrant 写入跳过，使用内置内存向量索引:', err.message);
      this.qdrantAvailable = false;
    }
  }

  async search(query, topK = 10) {
    if (!this.inMemoryPoints.length || !query) return [];

    const [queryVec] = await EmbeddingClient.embedTexts([query]);

    if (await this.checkQdrant()) {
      try {
        const qRes = await qdrantRequest('post', `${this.qdrantUrl}/collections/${this.collectionName}/points/search`, {
          vector: Array.from(queryVec),
          limit: topK,
          with_payload: true
        }, 1000);

        if (qRes.data?.result && Array.isArray(qRes.data.result)) {
          return qRes.data.result.map(hit => ({
            chunk: hit.payload,
            vectorScore: hit.score
          }));
        }
      } catch (err) {
        console.warn('[VectorStore] Qdrant 检索失败，降级为内存向量检索:', err.message);
        this.qdrantAvailable = false;
      }
    }

    // In-memory cosine search fallback
    const scored = this.inMemoryPoints.map(item => ({
      chunk: item.chunk,
      vectorScore: cosineSimilarity(queryVec, item.vector)
    }));

    scored.sort((a, b) => b.vectorScore - a.vectorScore);
    return scored.slice(0, topK);
  }

  /** 重置状态，便于测试隔离 */
  reset() {
    this.inMemoryPoints = [];
    this.qdrantAvailable = null;
    this.qdrantCheckInFlight = null;
  }
}

module.exports = { VectorStore, EmbeddingClient, cosineSimilarity, normalizeVector, DEFAULT_VECTOR_DIM };
