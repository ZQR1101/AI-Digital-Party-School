const fs = require('fs');
const path = require('path');

const KNOWLEDGE_DIR = path.resolve(__dirname, '../../knowledge');

function terms(text) {
  const normalized = String(text || '').toLowerCase().replace(/[^\u4e00-\u9fa5a-z0-9]/g, '');
  const output = new Set();
  for (let size = 2; size <= 4; size += 1) {
    for (let i = 0; i <= normalized.length - size; i += 1) output.add(normalized.slice(i, i + size));
  }
  return output;
}

class RagService {
  static chunks = null;

  static load() {
    if (this.chunks) return this.chunks;
    if (!fs.existsSync(KNOWLEDGE_DIR)) return [];
    const chunks = [];
    for (const file of fs.readdirSync(KNOWLEDGE_DIR).filter(name => name.endsWith('.md'))) {
      const content = fs.readFileSync(path.join(KNOWLEDGE_DIR, file), 'utf8');
      const sections = content.split(/(?=^##?\s+)/m);
      for (const section of sections) {
        const body = section.trim();
        if (!body) continue;
        const firstLine = body.split('\n')[0].replace(/^#+\s*/, '').trim();
        chunks.push({ title: firstLine || file, source: file, content: body.slice(0, 800) });
      }
    }
    this.chunks = chunks;
    return chunks;
  }

  static async search(query, topK = 3) {
    const queryTerms = terms(query);
    return this.load().map(chunk => {
      const haystack = terms(`${chunk.title}${chunk.content}`);
      let overlap = 0;
      for (const term of queryTerms) if (haystack.has(term)) overlap += 1;
      return { ...chunk, score: queryTerms.size ? overlap / queryTerms.size : 0 };
    }).filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(1, Math.min(Number(topK) || 3, 10)));
  }
}

module.exports = RagService;
