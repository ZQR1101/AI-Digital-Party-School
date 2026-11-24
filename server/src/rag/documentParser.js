const fs = require('fs');
const logger = require('../utils/logger');

const path = require('path');
const crypto = require('crypto');

// PDF / Word 解析为可选依赖：缺失时仅跳过对应文件，不影响 Markdown/TXT 知识库
let PDFParse = null;
let mammoth = null;
try { ({ PDFParse } = require('pdf-parse')); } catch { /* PDF 依赖未安装 */ }
try { mammoth = require('mammoth'); } catch { /* Word 依赖未安装 */ }

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
        // PDF / Word 走异步 loadFromDirectoryAsync，保留此同步接口向下兼容
      } catch (err) {
        logger.warn(`[DocumentParser] 读取文件失败: ${file}`, err.message);
      }
    }

    return chunks;
  }

  /**
   * 从 PDF 中提取纯文本，并复用 Markdown/TXT 的分块与元数据逻辑。
   * 扫描件（无文本层）会抛出明确错误，由调用方记录告警后跳过。
   */
  static async parsePdf(fullPath) {
    if (!PDFParse) throw new Error('缺少 pdf-parse 依赖，无法解析 PDF');
    const parser = new PDFParse({ data: fs.readFileSync(fullPath) });
    let text = '';
    try {
      const result = await parser.getText();
      text = String(result?.text || '');
    } finally {
      await parser.destroy();
    }
    // pdf-parse 会追加 "-- 1 of N --" 页码脚注，不纳入知识库正文
    text = text.split('\n').filter(line => !/^\s*--\s*\d+\s+of\s+\d+\s*--\s*$/.test(line)).join('\n');
    if (!text.trim()) throw new Error('PDF 未提取到文本层（扫描件需先 OCR）');
    return this.parsePlainText(text, path.basename(fullPath));
  }

  /**
   * 从 .docx 中提取纯文本（mammoth 仅支持 OOXML 格式，不支持旧版 .doc）。
   */
  static async parseDocx(fullPath) {
    if (!mammoth) throw new Error('缺少 mammoth 依赖，无法解析 Word 文档');
    const result = await mammoth.extractRawText({ path: fullPath });
    const text = String(result?.value || '');
    if (!text.trim()) throw new Error('Word 文档未提取到文本');
    return this.parsePlainText(text, path.basename(fullPath));
  }

  /**
   * 异步加载目录：在同步文本文件基础上追加 PDF / .docx 知识文档。
   */
  static async loadFromDirectoryAsync(dirPath) {
    const chunks = this.loadFromDirectory(dirPath);
    if (!fs.existsSync(dirPath)) return chunks;

    for (const file of fs.readdirSync(dirPath)) {
      const ext = path.extname(file).toLowerCase();
      if (!['.pdf', '.docx'].includes(ext)) continue;
      const fullPath = path.join(dirPath, file);
      if (!fs.statSync(fullPath).isFile()) continue;

      try {
        if (ext === '.pdf') chunks.push(...await this.parsePdf(fullPath));
        else chunks.push(...await this.parseDocx(fullPath));
      } catch (err) {
        logger.warn(`[DocumentParser] 解析文件失败: ${file}`, err.message);
      }
    }

    return chunks;
  }
}

module.exports = DocumentParser;
