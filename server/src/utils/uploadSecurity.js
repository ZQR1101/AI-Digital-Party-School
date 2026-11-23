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

const contentFileFilter = makeFileFilter(CONTENT_TYPES);
const sheetFileFilter = makeFileFilter(SHEET_TYPES);

module.exports = {
  CONTENT_TYPES,
  SHEET_TYPES,
  contentFileFilter,
  sheetFileFilter,
  makeFileFilter,
  safeFileName,
};
