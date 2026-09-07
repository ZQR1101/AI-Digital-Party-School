const express = require('express');
const router = express.Router();
const LearningRecordService = require('../services/learningRecordService');
const ResponseHelper = require('../utils/response');
const { authenticate } = require('../middleware/auth');

/**
 * POST /api/learning-records
 * 提交学习时长、完成状态
 */
router.post('/', authenticate, async (req, res) => {
  try {
    const { taskId, studySeconds, completed } = req.body;

    if (!taskId || studySeconds === undefined) {
      return ResponseHelper.badRequest(res, 'taskId 和 studySeconds 为必填项');
    }

    const result = await LearningRecordService.submit(req.user.userId, {
      taskId: Number(taskId),
      studySeconds: Number(studySeconds),
      completed: !!completed
    });

    return ResponseHelper.success(res, result, '学习记录已保存');
  } catch (err) {
    console.error('Submit learning record error:', err);
    return ResponseHelper.error(res);
  }
});

module.exports = router;
