const express = require('express');
const router = express.Router();
const ExamRecordService = require('../services/examRecordService');
const ResponseHelper = require('../utils/response');
const { authenticate } = require('../middleware/auth');

/**
 * POST /api/exam-records
 * 提交答案并返回成绩或错题分析
 */
router.post('/', authenticate, async (req, res) => {
  try {
    const { taskId, answers } = req.body;

    if (!taskId || !answers) {
      return ResponseHelper.badRequest(res, 'taskId 和 answers 为必填项');
    }

    const result = await ExamRecordService.submit(req.user.userId, { taskId, answers });
    return ResponseHelper.success(res, result, '提交成功');
  } catch (err) {
    console.error('Submit exam error:', err);
    return ResponseHelper.error(res, err.message);
  }
});

/**
 * GET /api/exam-records/my
 * 获取当前用户的考试记录
 */
router.get('/my', authenticate, async (req, res) => {
  try {
    const { page = 1, pageSize = 10 } = req.query;
    const result = await ExamRecordService.getUserRecords(req.user.userId, {
      page: Number(page), pageSize: Number(pageSize)
    });
    return ResponseHelper.page(res, result.list, result.total);
  } catch (err) {
    console.error('Get exam records error:', err);
    return ResponseHelper.error(res);
  }
});

module.exports = router;
