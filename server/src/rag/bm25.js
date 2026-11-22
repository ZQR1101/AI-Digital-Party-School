const STOPWORDS = new Set([
  '的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一', '一个',
  '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好',
  '自己', '这', '那', '与', '及', '其', '于', '对', '把', '向', '从', '由', '被',
  '等', '更', '已', '被', '按', '么', '吗', '呢', '吧', '请问', '请', '帮我', '一下'
]);

function tokenize(text) {
  if (!text) return [];
  const normalized = String(text).toLowerCase();
  const tokens = [];

  // Match English words and numbers
  const words = normalized.match(/[a-z0-9_-]+/g) || [];
  for (const w of words) {
    if (w.length > 1 && !STOPWORDS.has(w)) tokens.push(w);
  }

  // Chinese character sequence
  const cjk = normalized.replace(/[^\u4e00-\u9fa5]/g, '');
  if (!cjk) return tokens;

  // Unigrams & Bigrams & Trigrams
  for (let i = 0; i < cjk.length; i++) {
    const uni = cjk[i];
    if (!STOPWORDS.has(uni)) tokens.push(uni);

    if (i + 1 < cjk.length) {
      const bi = cjk.slice(i, i + 2);
      if (!STOPWORDS.has(bi)) tokens.push(bi);
    }
    if (i + 2 < cjk.length) {
      tokens.push(cjk.slice(i, i + 3));
    }
  }

  return tokens;
}

class BM25Retriever {
  constructor(options = {}) {
    this.k1 = options.k1 ?? 1.5;
    this.b = options.b ?? 0.75;
    this.documents = [];
    this.docCount = 0;
    this.avgDocLength = 0;
    this.docLengths = [];
    this.termFrequencies = []; // map of term -> count per doc
    this.df = new Map(); // term -> document frequency
    this.idf = new Map();
  }

  index(documents) {
    this.documents = documents;
    this.docCount = documents.length;
    this.docLengths = new Array(this.docCount);
    this.termFrequencies = new Array(this.docCount);
    this.df = new Map();
    this.idf = new Map();

    if (this.docCount === 0) {
      this.avgDocLength = 0;
      return;
    }

    let totalLength = 0;
    for (let i = 0; i < this.docCount; i++) {
      const doc = documents[i];
      const text = `${doc.title || ''} ${doc.title || ''} ${doc.content || ''}`; // Title weight x2
      const tokens = tokenize(text);
      this.docLengths[i] = tokens.length;
      totalLength += tokens.length;

      const tfMap = new Map();
      const seenTerms = new Set();
      for (const token of tokens) {
        tfMap.set(token, (tfMap.get(token) || 0) + 1);
        seenTerms.add(token);
      }
      this.termFrequencies[i] = tfMap;

      for (const term of seenTerms) {
        this.df.set(term, (this.df.get(term) || 0) + 1);
      }
    }

    this.avgDocLength = totalLength / this.docCount;

    // Compute IDF
    for (const [term, freq] of this.df.entries()) {
      // Lucene-style Robertson-Spärck Jones IDF formula
      const idfValue = Math.log(1 + (this.docCount - freq + 0.5) / (freq + 0.5));
      this.idf.set(term, Math.max(idfValue, 0.05));
    }
  }

  search(query, topK = 10) {
    if (!this.docCount || !query) return [];

    const queryTokens = tokenize(query);
    if (!queryTokens.length) return [];

    const scores = new Float32Array(this.docCount);

    for (const token of queryTokens) {
      const idfValue = this.idf.get(token);
      if (!idfValue) continue;

      for (let i = 0; i < this.docCount; i++) {
        const tf = this.termFrequencies[i].get(token) || 0;
        if (tf === 0) continue;

        const docLen = this.docLengths[i];
        const denom = tf + this.k1 * (1 - this.b + this.b * (docLen / this.avgDocLength));
        scores[i] += idfValue * ((tf * (this.k1 + 1)) / denom);
      }
    }

    const results = [];
    for (let i = 0; i < this.docCount; i++) {
      if (scores[i] > 0) {
        results.push({
          chunk: this.documents[i],
          bm25Score: scores[i],
          index: i
        });
      }
    }

    results.sort((a, b) => b.bm25Score - a.bm25Score);
    return results.slice(0, topK);
  }
}

module.exports = { BM25Retriever, tokenize };
