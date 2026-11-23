const express = require('express');
const PaperService = require('../../services/paperService');
const ResponseHelper = require('../../utils/response');
const { authenticate, loadCurrentUser, requireAdmin, requireManager } = require('../../middleware/auth');

const router = express.Router();
router.use(authenticate, loadCurrentUser, requireAdmin);

router.get('/', async (req, res) => {
  try {
    const result = await PaperService.list({
      page: Number(req.query.page || 1),
      pageSize: Number(req.query.pageSize || 10),
      keyword: req.query.keyword,
      category: req.query.category,
      status: req.query.status,
    });
    return ResponseHelper.page(res, result.list, result.total);
  } catch (error) {
    console.error('List papers error:', error);
    return ResponseHelper.error(res);
  }
});

router.get('/:id', async (req, res) => {
  try {
    const paper = await PaperService.getById(req.params.id);
    if (!paper) return ResponseHelper.notFound(res, '试卷不存在');
    return ResponseHelper.success(res, paper);
  } catch (error) {
    return ResponseHelper.error(res);
  }
});

router.post('/', async (req, res) => {
  try {
    const { title, category, description, duration, totalScore, passScore, status, questionIds } = req.body;
    if (!title || !Array.isArray(questionIds) || questionIds.length === 0) {
      return ResponseHelper.badRequest(res, '试卷名称和至少一道题目为必填项');
    }
    if (Number(passScore) > Number(totalScore)) return ResponseHelper.badRequest(res, '及格分不能高于总分');
    const id = await PaperService.create({
      title, category, description, duration, totalScore, passScore, status, questionIds,
      createdBy: req.user.userId,
    });
    return ResponseHelper.success(res, { id }, '试卷创建成功');
  } catch (error) {
    console.error('Create paper error:', error);
    return ResponseHelper.error(res, error.message);
  }
});

router.put('/:id', async (req, res) => {
  try {
    if (req.body.passScore !== undefined && req.body.totalScore !== undefined
      && Number(req.body.passScore) > Number(req.body.totalScore)) {
      return ResponseHelper.badRequest(res, '及格分不能高于总分');
    }
    await PaperService.update(req.params.id, req.body);
    return ResponseHelper.success(res, null, '试卷更新成功');
  } catch (error) {
    console.error('Update paper error:', error);
    if (error.message === '试卷不存在') return ResponseHelper.notFound(res, error.message);
    return ResponseHelper.error(res, error.message);
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const paper = await PaperService.getById(req.params.id);
    if (!paper) return ResponseHelper.notFound(res, '试卷不存在');
    await PaperService.delete(req.params.id);
    return ResponseHelper.success(res, null, '试卷已删除');
  } catch (error) {
    return ResponseHelper.error(res);
  }
});

module.exports = router;
