/**
 * 富文本 HTML 白名单清洗器（零依赖）。
 * 学习内容正文以 v-html 渲染，入库前必须清洗，防止存储型 XSS：
 * - 彻底移除 script/style/iframe/object/embed 等危险标签及其内容
 * - 仅保留白名单标签，其余标签剥壳保留文本
 * - 移除所有 on* 事件属性；href/src 仅允许 http(s)、mailto、相对路径与 data:image
 */

const ALLOWED_TAGS = new Set([
  'p', 'br', 'hr', 'span', 'div', 'strong', 'b', 'em', 'i', 'u', 's', 'sub', 'sup',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'blockquote', 'pre', 'code',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption',
  'a', 'img', 'video', 'source', 'figure', 'figcaption',
]);

const TAG_ATTR_ALLOWLIST = new Map([
  ['a', new Set(['href', 'title', 'target'])],
  ['img', new Set(['src', 'alt', 'width', 'height'])],
  ['video', new Set(['src', 'controls', 'width', 'height', 'poster'])],
  ['source', new Set(['src', 'type'])],
  ['td', new Set(['colspan', 'rowspan'])],
  ['th', new Set(['colspan', 'rowspan'])],
]);

const DANGEROUS_URL_RE = /^\s*(javascript|vbscript|data\s*:\s*text\/html|jscript|livescript)\s*:/i;
const SAFE_DATA_URL_RE = /^\s*data\s*:\s*image\//i;

function isSafeUrl(value) {
  const url = String(value || '').trim();
  if (!url) return true; // 空属性交给默认行为
  if (DANGEROUS_URL_RE.test(url)) return false;
  if (/^data\s*:/i.test(url) && !SAFE_DATA_URL_RE.test(url)) return false;
  return true;
}

/** 清洗单个标签，返回重写后的标签文本；非法属性直接丢弃 */
function sanitizeTag(tagMatch) {
  const isClosing = /^<\//.test(tagMatch);
  const nameMatch = tagMatch.match(/^<\/?\s*([a-zA-Z][a-zA-Z0-9-]*)/);
  if (!nameMatch) return '';
  const tag = nameMatch[1].toLowerCase();
  if (isClosing) return `</${tag}>`;
  if (!ALLOWED_TAGS.has(tag)) return '';

  const attrAllowlist = TAG_ATTR_ALLOWLIST.get(tag) || new Set();
  // 提取属性：name = "value" | name = 'value' | name=value | name
  const attrRe = /([a-zA-Z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))|([a-zA-Z-]+)(?=[\s/>])/g;
  let m;
  const kept = [];
  while ((m = attrRe.exec(tagMatch)) !== null) {
    const rawName = (m[1] || m[5] || '').toLowerCase();
    const value = m[2] ?? m[3] ?? m[4] ?? '';
    if (rawName.startsWith('on')) continue; // 一律移除事件属性
    if (rawName === 'style') continue; // 防 CSS 注入钓鱼
    if (!attrAllowlist.has(rawName)) continue;
    if ((rawName === 'href' || rawName === 'src' || rawName === 'poster') && !isSafeUrl(value)) continue;
    const escaped = value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    kept.push(`${rawName}="${escaped}"`);
  }
  const selfClose = /\/\s*>$/.test(tagMatch) ? ' /' : '';
  return kept.length ? `<${tag} ${kept.join(' ')}${selfClose}>` : `<${tag}${selfClose}>`;
}

function sanitizeHtml(input) {
  let html = String(input || '');

  // 1. 注释与危险标签整体移除（含内容）；未闭合的危险标签移到文档末尾
  html = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|iframe|object|embed|noscript|template|svg|math|form|textarea|select|button|input|link|meta|base|frame|frameset|applet)[\s\S]*?<\/\s*\1\s*>/gi, ' ')
    .replace(/<(script|style|iframe|object|embed|noscript|template|svg|math|form|textarea|select|button|input|link|meta|base|frame|frameset|applet)\b[^>]*>[\s\S]*/gi, ' ')
    .replace(/<(script|style|iframe|object|embed|noscript|template|svg|math|form|textarea|select|button|input|link|meta|base|frame|frameset|applet)\b[^>]*\/?>/gi, ' ');

  // 2. 逐标签重写：白名单外剥壳保留文本；白名单内清洗属性
  html = html.replace(/<\/?[a-zA-Z][^>]*>/g, (tag) => sanitizeTag(tag));

  // 3. 清理控制字符与多余空行
  html = html.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  return html.trim();
}

module.exports = { sanitizeHtml, isSafeUrl };
