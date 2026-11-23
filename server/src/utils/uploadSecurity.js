const path = require('path');
const crypto = require('crypto');

/**
 * 文件上传安全工具：基于扩展名 + MIME 双重白名单，拒绝可执行/脚本类型。
 * 存储文件名一律重新生成为随机名，绝不采用客户端提供的文件名。
 */

// 允许的内容文件类型：图片与视频
const CONTENT_TYPES = new Map([
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.mp4', 'video/mp4'],
  ['.webm', 'video/webm'],
  ['.ogg', 'video/ogg'],
]);

// 允许的表格导入类型
const SHEET_TYPES = new Map([
  ['.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ['.xls', 'application/vnd.ms-excel'],
  ['.csv', 'text/csv'],
]);

function allowedMimes(map) {
  return new Set(map.values());
}

/**
 * 生成 multer fileFilter。
 * @param {Map} typeMap 扩展名 -> MIME 白名单
 */
function makeFileFilter(typeMap) {
  const mimes = allowedMimes(typeMap);
  return (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const mime = String(file.mimetype || '').toLowerCase();
    if (!typeMap.has(ext) || !mimes.has(mime)) {
      return cb(new Error(`不允许的文件类型：${ext || mime}`));
    }
    cb(null, true);
  };
}

/** 生成安全的随机存储文件名（保留白名单内的扩展名） */
function safeFileName(originalName) {
  const ext = path.extname(originalName).toLowerCase();
  return `${Date.now()}-${crypto.randomBytes(12).toString('hex')}${ext}`;
}

// 扩展名 -> 魔数（文件头签名）校验器。MIME 与扩展名均可被客户端伪造，
// 必须以文件二进制内容做最终裁决，防止改名上传脚本/木马。
const SIGNATURE_CHECKS = new Map([
  ['.jpg', (b) => b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF],
  ['.jpeg', (b) => b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF],
  ['.png', (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47],
  ['.gif', (b) => b.slice(0, 4).toString('latin1') === 'GIF8'],
  ['.webp', (b) => b.slice(0, 4).toString('latin1') === 'RIFF' && b.slice(8, 12).toString('latin1') === 'WEBP'],
  ['.mp4', (b) => b.slice(4, 8).toString('latin1') === 'ftyp'],
  ['.webm', (b) => b[0] === 0x1A && b[1] === 0x45 && b[2] === 0xDF && b[3] === 0xA3],
  ['.ogg', (b) => b.slice(0, 4).toString('latin1') === 'OggS'],
  ['.xlsx', (b) => b[0] === 0x50 && b[1] === 0x4B && (b[2] === 0x03 || b[2] === 0x05 || b[2] === 0x07)],
  ['.xls', (b) => b[0] === 0xD0 && b[1] === 0xCF && b[2] === 0x11 && b[3] === 0xE0],
  ['.csv', (b) => {
    // CSV 无可靠魔数：校验前 1KB 可按文本解码且不含 NUL 字节（二进制可执行文件特征）
    const head = b.subarray(0, 1024);
    if (head.includes(0)) return false;
    try { head.toString('utf8'); return true; } catch { return false; }
  }],
]);

const SIGNATURE_HEADER_BYTES = 16;

/**
 * 校验文件内容与声明的扩展名一致（基于文件头魔数）。
 * @param {Buffer|Uint8Array} buffer 文件内容（至少前 16 字节）
 * @param {string} originalName 客户端文件名（仅用于取扩展名）
 * @returns {boolean}
 */
function matchesFileSignature(buffer, originalName) {
  const ext = path.extname(originalName || '').toLowerCase();
  const checker = SIGNATURE_CHECKS.get(ext);
  if (!checker) return false;
  const head = buffer.subarray(0, Math.max(SIGNATURE_HEADER_BYTES, 12));
  if (!head || head.length < 4) return false;
  try {
    return Boolean(checker(head));
  } catch {
    return false;
  }
}

/**
 * 校验失败直接抛 400，供路由层直接透传给客户端。
 */
function assertFileSignature(buffer, originalName) {
  if (!matchesFileSignature(buffer, originalName)) {
    const ext = path.extname(originalName || '').toLowerCase();
    throw Object.assign(new Error(`文件内容与声明的类型 ${ext || '未知'} 不符，已拒绝保存`), { statusCode: 400 });
  }
}

const contentFileFilter = makeFileFilter(CONTENT_TYPES);
const sheetFileFilter = makeFileFilter(SHEET_TYPES);

module.exports = {
  CONTENT_TYPES,
  SHEET_TYPES,
  contentFileFilter,
  sheetFileFilter,
  makeFileFilter,
  safeFileName,
  matchesFileSignature,
  assertFileSignature,
};
