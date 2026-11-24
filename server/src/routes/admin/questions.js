const express = require('express');
const logger = require('../../utils/logger');

const router = express.Router();
const QuestionService = require('../../services/questionService');
const ResponseHelper = require('../../utils/response');
const { authenticate, loadCurrentUser, requireAdmin, requireManager } = require('../../middleware/auth');

router.use(authenticate, loadCurrentUser, requireAdmin);

/**
 * GET /api/admin/questions
 * 分页查询题库
 */
router.get('/', async (req, res) => {
  try {
    const { page = 1, pageSize = 10, keyword, type, category, difficulty } = req.query;
    const result = await QuestionService.list({
      page: Number(page), pageSize: Number(pageSize), keyword, type, category, difficulty
    });
    return ResponseHelper.page(res, result.list, result.total);
  } catch (err) {
    logger.error('List questions error:', err);
    return ResponseHelper.error(res);
  }
});

/**
 * GET /api/admin/questions/:id
 */
router.get('/:id', async (req, res) => {
  try {
    const question = await QuestionService.getById(req.params.id);
    if (!question) return ResponseHelper.notFound(res, '题目不存在');
    return ResponseHelper.success(res, question);
  } catch (err) {
    return ResponseHelper.error(res);
  }
});

/**
 * POST /api/admin/questions
 * 新增题目
 */
router.post('/', async (req, res) => {
  try {
    const { type, title, options, answer, analysis, category, difficulty } = req.body;
    if (!type || !title || answer === undefined) {
      return ResponseHelper.badRequest(res, '题型、题目内容和答案为必填项');
    }
    if (!['single', 'multiple', 'judge'].includes(type)) {
      return ResponseHelper.badRequest(res, '题型必须为 single/multiple/judge');
    }
    const id = await QuestionService.create({
      type, title, options, answer, analysis, category, difficulty,
      createdBy: req.user.userId
    });
    return ResponseHelper.success(res, { id }, '创建成功');
  } catch (err) {
    logger.error('Create question error:', err);
    return ResponseHelper.error(res);
  }
});

/**
 * PUT /api/admin/questions/:id
 * 编辑题目
 */
router.put('/:id', async (req, res) => {
  try {
    const question = await QuestionService.getById(req.params.id);
    if (!question) return ResponseHelper.notFound(res, '题目不存在');
    await QuestionService.update(req.params.id, req.body);
    return ResponseHelper.success(res, null, '更新成功');
  } catch (err) {
    return ResponseHelper.error(res);
  }
});

/**
 * DELETE /api/admin/questions/:id
 * 删除题目
 */
router.delete('/:id', async (req, res) => {
  try {
    const question = await QuestionService.getById(req.params.id);
    if (!question) return ResponseHelper.notFound(res, '题目不存在');
    await QuestionService.delete(req.params.id);
    return ResponseHelper.success(res, null, '删除成功');
  } catch (err) {
    return ResponseHelper.error(res);
  }
});

module.exports = router;
