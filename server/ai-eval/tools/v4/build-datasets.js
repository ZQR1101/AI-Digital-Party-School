/**
 * V4 数据集构建器（证据锚定）：证据由脚本按“文件+条号”从知识库原文精确抽取，保证逐字存在。
 * 样本定义见 case-defs.js。构建后运行 validate-dataset.js 严格校验。
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../../..');
const KB_DIR = path.resolve(ROOT, 'knowledge-v4');
const OUT_DIR = path.resolve(ROOT, 'ai-eval/datasets/v4');
const VERSION = '4.0.0';

function extractArticle(file, articleNo) {
  const p = path.join(KB_DIR, file);
  if (!fs.existsSync(p)) return null;
  const lines = fs.readFileSync(p, 'utf8').split('\n');
  const startRe = new RegExp(`^第${articleNo}条[\\s　]`);
  let start = -1;
  for (let i = 0; i < lines.length; i++) if (startRe.test(lines[i].trim())) { start = i; break; }
  if (start < 0) return null;
  const end = lines.findIndex((l, i) => i > start && /^第[一二三四五六七八九十百]+条[\s　]/.test(l.trim()));
  return lines.slice(start, end < 0 ? lines.length : end).filter((l) => l.trim()).join('\n').trim();
}

function main() {
  const defs = require('./case-defs');
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const summary = {};
  for (const [name, group] of Object.entries(defs)) {
    const cases = group.cases.map((d) => {
      const evidence = (d.evidence || []).map((e) => {
        const file = e.file || e.source;
        if (e.article) {
          const snippet = extractArticle(file, e.article);
          if (!snippet) throw new Error(`无法抽取条文: ${file} 第${e.article}条 (${d.id})`);
          return { source: file, snippet, article: e.article };
        }
        return { source: file, snippet: e.snippet };
      });
      return {
        id: d.id, split: d.split, category: d.category,
        query: d.query || d.question, question: d.question,
        relevant: d.relevant || [...new Set((d.evidence || []).map((e) => e.file))],
        evidence, requiredFacts: d.requiredFacts || [],         answer: d.answer || '',
        answerable: d.answerable !== false, note: d.note || '',
        ...(d.expectedSource ? { expectedSource: d.expectedSource } : {}),
        ...(d.expectedKeywords ? { expectedKeywords: d.expectedKeywords } : {}),
        ...(d.validCount != null ? { validCount: d.validCount } : {}),
        ...(d.expectInvalid ? { expectInvalid: d.expectInvalid } : {}),
        ...(d.versionNote ? { versionNote: d.versionNote } : {}),
        ...(d.verification ? { verification: d.verification } : {})
      };
    });
    fs.writeFileSync(path.join(OUT_DIR, `${name}.dataset.json`),
      `${JSON.stringify({ version: VERSION, group: name, description: group.description, count: cases.length, cases }, null, 2)}\n`);
    summary[name] = cases.length;
  }
  console.log('V4 数据集:', JSON.stringify(summary), '合计', Object.values(summary).reduce((a, b) => a + b, 0));
}
main();
