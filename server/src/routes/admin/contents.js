const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const ContentService = require('../../services/contentService');
const ResponseHelper = require('../../utils/response');
const { authenticate, requireAdmin } = require('../../middleware/auth');

// 配置文件上传
const uploadDir = path.join(__dirname, '../../../uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname);
    cb(null, uniqueName);
  }
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

router.use(authenticate, requireAdmin);

/**
 * GET /api/admin/contents
 * 分页查询内容列表
 */
router.get('/', async (req, res) => {
  try {
    const { page = 1, pageSize = 10, keyword, type, status } = req.query;
    const result = await ContentService.list({
      page: Number(page), pageSize: Number(pageSize), keyword, type, status
    });
    return ResponseHelper.page(res, result.list, result.total);
  } catch (err) {
    console.error('List contents error:', err);
    return ResponseHelper.error(res);
  }
});

/**
 * GET /api/admin/contents/:id
 */
router.get('/:id', async (req, res) => {
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
router.post('/', async (req, res) => {
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
    console.error('Create content error:', err);
    return ResponseHelper.error(res);
  }
});

/**
 * PUT /api/admin/contents/:id
 * 编辑已发布的内容
 */
router.put('/:id', async (req, res) => {
  try {
    const content = await ContentService.getById(req.params.id);
    if (!content) return ResponseHelper.notFound(res, '内容不存在');
    await ContentService.update(req.params.id, req.body);
    return ResponseHelper.success(res, null, '更新成功');
  } catch (err) {
    console.error('Update content error:', err);
    return ResponseHelper.error(res);
  }
});

/**
 * DELETE /api/admin/contents/:id
 * 下架或删除内容
 */
router.delete('/:id', async (req, res) => {
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
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return ResponseHelper.badRequest(res, '请选择文件');
    const url = `/uploads/${req.file.filename}`;
    return ResponseHelper.success(res, { url, filename: req.file.filename });
  } catch (err) {
    return ResponseHelper.error(res);
  }
});

module.exports = router;
