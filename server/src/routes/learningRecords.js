const express = require('express');
const logger = require('../utils/logger');

const router = express.Router();
const LearningRecordService = require('../services/learningRecordService');
const ResponseHelper = require('../utils/response');
const { authenticate, loadCurrentUser } = require('../middleware/auth');

/**
 * POST /api/learning-records
 * 提交学习时长、完成状态
 */
router.post('/', authenticate, loadCurrentUser, async (req, res) => {
  try {
    const { taskId, studySeconds, completed } = req.body;

    if (!taskId || studySeconds === undefined) {
      return ResponseHelper.badRequest(res, 'taskId 和 studySeconds 为必填项');
    }

    const result = await LearningRecordService.submit(req.user.userId, {
      taskId: Number(taskId),
      studySeconds,
      completed: !!completed
    });

    return ResponseHelper.success(res, result, '学习记录已保存');
  } catch (err) {
    if (err.statusCode === 400) return ResponseHelper.badRequest(res, err.message);
    if (err.statusCode === 403) return ResponseHelper.forbidden(res, err.message);
    if (err.statusCode === 404) return ResponseHelper.notFound(res, err.message);
    logger.error('Submit learning record error:', err);
    return ResponseHelper.error(res);
  }
});

module.exports = router;
