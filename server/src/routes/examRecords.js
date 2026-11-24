const express = require('express');
const logger = require('../utils/logger');

const router = express.Router();
const ExamRecordService = require('../services/examRecordService');
const AssessmentService = require('../services/assessmentService');
const ResponseHelper = require('../utils/response');
const { authenticate, loadCurrentUser, authorize } = require('../middleware/auth');
const assessmentErrors = require('./assessmentErrors');

/**
 * POST /api/exam-records
 * 使用已下发的测评 ID 提交答案并返回成绩和错题分析
 */
router.post('/', authenticate, loadCurrentUser, authorize('member'), async (req, res, next) => {
  try {
    const { assessmentId, answers } = req.body || {};
    if (!assessmentId) {
      return ResponseHelper.badRequest(res, '请提交已下发的测评 ID（assessmentId）');
    }
    const result = await AssessmentService.submit(req.user.userId, assessmentId, answers);
    return ResponseHelper.success(res, result, '提交成功');
  } catch (error) {
    return next(error);
  }
});

/**
 * GET /api/exam-records/my
 * 获取当前用户的考试记录
 */
router.get('/my', authenticate, loadCurrentUser, async (req, res) => {
  try {
    const { page = 1, pageSize = 10 } = req.query;
    const result = await ExamRecordService.getUserRecords(req.user.userId, {
      page: Number(page), pageSize: Number(pageSize)
    });
    return ResponseHelper.page(res, result.list, result.total);
  } catch (err) {
    logger.error('Get exam records error:', err);
    return ResponseHelper.error(res);
  }
});

router.use(assessmentErrors);
module.exports = router;
