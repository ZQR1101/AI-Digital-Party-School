const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function cleanText(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/!\[.*?\]\(.*?\)/g, '') // remove markdown images
    .replace(/<[^>]+>/g, '') // remove html tags
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function chunkSection(body, meta, options = {}) {
  const chunkSize = options.chunkSize || 450;
  const chunkOverlap = options.chunkOverlap || 80;
  const chunks = [];

  if (body.length <= chunkSize) {
    const id = crypto.createHash('md5').update(`${meta.source}-${meta.title}-${body.slice(0, 40)}`).digest('hex').slice(0, 12);
    return [{
      id,
      ...meta,
      content: body,
      length: body.length
    }];
  }

  // Sliding window with sentence boundaries
  let start = 0;
  let index = 0;
  while (start < body.length) {
    let end = Math.min(start + chunkSize, body.length);
    if (end < body.length) {
      // Find natural boundary: 。！？\n；
      const slice = body.slice(start, end);
      const lastBreak = Math.max(
        slice.lastIndexOf('\n\n'),
        slice.lastIndexOf('\n'),
        slice.lastIndexOf('。'),
        slice.lastIndexOf('！'),
        slice.lastIndexOf('？'),
        slice.lastIndexOf('；')
      );
      if (lastBreak > chunkSize * 0.6) {
        end = start + lastBreak + 1;
      }
    }

    const chunkContent = body.slice(start, end).trim();
    if (chunkContent.length > 20) {
      const id = crypto.createHash('md5').update(`${meta.source}-${meta.title}-${index}-${chunkContent.slice(0, 30)}`).digest('hex').slice(0, 12);
      chunks.push({
        id,
        ...meta,
        chunkIndex: index,
        content: chunkContent,
        length: chunkContent.length
      });
      index += 1;
    }

    if (end >= body.length) break;
    start = Math.max(start + 1, end - chunkOverlap);
  }

  return chunks;
}

class DocumentParser {
  static parseMarkdown(content, source) {
    const cleaned = cleanText(content);
    const sections = cleaned.split(/(?=^##?\s+)/m);
    const allChunks = [];
    let currentDocTitle = path.basename(source, path.extname(source));

    for (const section of sections) {
      const text = section.trim();
      if (!text) continue;
      const lines = text.split('\n');
      const firstLine = lines[0].trim();
      let title = currentDocTitle;
      if (firstLine.startsWith('#')) {
        title = firstLine.replace(/^#+\s*/, '').trim();
        if (firstLine.startsWith('# ') && !firstLine.startsWith('## ')) {
          currentDocTitle = title;
        }
      }

      const body = lines.length > 1 ? lines.slice(1).join('\n').trim() : firstLine;
      if (!body) continue;

      const meta = {
        source,
        title: title || currentDocTitle,
        category: currentDocTitle
      };

      const sectionChunks = chunkSection(text, meta);
      allChunks.push(...sectionChunks);
    }

    return allChunks;
  }

  static parsePlainText(content, source) {
    const cleaned = cleanText(content);
    const title = path.basename(source, path.extname(source));
    return chunkSection(cleaned, { source, title, category: '常规文档' });
  }

  static loadFromDirectory(dirPath) {
    if (!fs.existsSync(dirPath)) return [];
    const files = fs.readdirSync(dirPath);
    const chunks = [];

    for (const file of files) {
      const fullPath = path.join(dirPath, file);
      const stat = fs.statSync(fullPath);
      if (!stat.isFile()) continue;

      const ext = path.extname(file).toLowerCase();
      try {
        if (['.md', '.markdown'].includes(ext)) {
          const content = fs.readFileSync(fullPath, 'utf8');
          chunks.push(...this.parseMarkdown(content, file));
        } else if (['.txt'].includes(ext)) {
          const content = fs.readFileSync(fullPath, 'utf8');
          chunks.push(...this.parsePlainText(content, file));
        }
        // Future extensions (.pdf, .docx) parsed through stream text extractors
      } catch (err) {
        console.warn(`[DocumentParser] 读取文件失败: ${file}`, err.message);
      }
    }

    return chunks;
  }
}

module.exports = DocumentParser;
