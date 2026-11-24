const express = require('express');
const logger = require('../../utils/logger');

const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const ContentService = require('../../services/contentService');
const ResponseHelper = require('../../utils/response');
const { contentFileFilter, safeFileName, assertFileSignature } = require('../../utils/uploadSecurity');
const { authenticate, loadCurrentUser, requireAdmin, requireManager } = require('../../middleware/auth');

// 文件上传：类型白名单 + 随机文件名 + 独立存储目录（与静态资源隔离）
const uploadDir = path.join(__dirname, '../../../uploads/content');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, safeFileName(file.originalname))
});
const upload = multer({
  storage,
  fileFilter: contentFileFilter,
  limits: { fileSize: 50 * 1024 * 1024, files: 1 }
});

// 认证统一挂载；列表查询对管理员与支部书记开放（书记仅见已发布内容，用于任务下发），
// 内容的增删改仍需管理员（逐路由校验）
router.use(authenticate, loadCurrentUser);

/**
 * GET /api/admin/contents
 * 分页查询内容列表：admin 全量；secretary 强制仅返回已发布内容
 */
router.get('/', requireManager, async (req, res) => {
  try {
    const { page = 1, pageSize = 10, keyword, type, status, category } = req.query;
    const effectiveStatus = req.user.role === 'admin' ? status : 'published';
    const result = await ContentService.list({
      page: Number(page), pageSize: Number(pageSize), keyword, type, status: effectiveStatus, category
    });
    return ResponseHelper.page(res, result.list, result.total);
  } catch (err) {
    logger.error('List contents error:', err);
    return ResponseHelper.error(res);
  }
});

/**
 * GET /api/admin/contents/:id
 */
router.get('/:id', requireAdmin, async (req, res) => {
  try {
    const content = await ContentService.getById(req.params.id);
    if (!content) return ResponseHelper.notFound(res, '内容不存在');
    return ResponseHelper.success(res, content);
  } catch (err) {
    return ResponseHelper.error(res);
  }
});

/**
 * POST /api/admin/contents
 * 新增或发布文章、视频内容
 */
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { title, type, coverUrl, bodyOrVideoUrl, summary, tags, isPublic, status } = req.body;
    if (!title || !type) {
      return ResponseHelper.badRequest(res, '标题和类型为必填项');
    }
    if (!['article', 'video'].includes(type)) {
      return ResponseHelper.badRequest(res, '类型必须为 article 或 video');
    }
    const id = await ContentService.create({
      title, type, coverUrl, bodyOrVideoUrl, summary, tags, isPublic,
      status: status || 'published',
      createdBy: req.user.userId
    });
    return ResponseHelper.success(res, { id }, '创建成功');
  } catch (err) {
    logger.error('Create content error:', err);
    return ResponseHelper.error(res);
  }
});

/**
 * PUT /api/admin/contents/:id
 * 编辑已发布的内容
 */
router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const content = await ContentService.getById(req.params.id);
    if (!content) return ResponseHelper.notFound(res, '内容不存在');
    await ContentService.update(req.params.id, req.body);
    return ResponseHelper.success(res, null, '更新成功');
  } catch (err) {
    logger.error('Update content error:', err);
    return ResponseHelper.error(res);
  }
});

/**
 * DELETE /api/admin/contents/:id
 * 下架或删除内容
 */
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const content = await ContentService.getById(req.params.id);
    if (!content) return ResponseHelper.notFound(res, '内容不存在');
    await ContentService.delete(req.params.id);
    return ResponseHelper.success(res, null, '删除成功');
  } catch (err) {
    return ResponseHelper.error(res);
  }
});

/**
 * POST /api/admin/contents/upload
 * 上传封面图或视频文件
 */
router.post('/upload', requireAdmin, (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) return ResponseHelper.badRequest(res, err.message || '文件上传失败');
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) return ResponseHelper.badRequest(res, '请选择文件');
    // 魔数校验：MIME/扩展名可被伪造，落盘后用文件头二进制签名做最终裁决
    try {
      const fd = fs.openSync(req.file.path, 'r');
      const head = Buffer.alloc(16);
      const read = fs.readSync(fd, head, 0, 16, 0);
      fs.closeSync(fd);
      assertFileSignature(head.subarray(0, read), req.file.originalname);
    } catch (sigErr) {
      fs.unlink(req.file.path, () => {});
      const statusCode = sigErr && sigErr.statusCode ? sigErr.statusCode : 400;
      return ResponseHelper.error(res, sigErr.message || '文件内容校验失败', statusCode, statusCode);
    }
    const url = `/uploads/content/${req.file.filename}`;
    return ResponseHelper.success(res, { url, filename: req.file.filename });
  } catch (err) {
    return ResponseHelper.error(res);
  }
});

module.exports = router;
