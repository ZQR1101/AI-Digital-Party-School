const express = require('express');
const logger = require('../utils/logger');

const router = express.Router();
const TaskService = require('../services/taskService');
const ResponseHelper = require('../utils/response');
const { authenticate, loadCurrentUser } = require('../middleware/auth');

/**
 * GET /api/tasks/my
 * 获取当前党员的学习任务列表
 */
router.get('/my', authenticate, loadCurrentUser, async (req, res) => {
  try {
    const { page = 1, pageSize = 10, status } = req.query;
    const result = await TaskService.getUserTasks(req.user.userId, { page: Number(page), pageSize: Number(pageSize), status });
    return ResponseHelper.page(res, result.list, result.total);
  } catch (err) {
    logger.error('Get my tasks error:', err);
    return ResponseHelper.error(res);
  }
});

/**
 * GET /api/tasks/:taskId
 * 获取任务和学习内容详情
 */
router.get('/:taskId', authenticate, loadCurrentUser, async (req, res) => {
  try {
    const task = await TaskService.getByIdForUser(req.params.taskId, req.user.userId);
    if (!task) {
      return ResponseHelper.notFound(res, '任务不存在');
    }
    return ResponseHelper.success(res, task);
  } catch (err) {
    logger.error('Get task detail error:', err);
    return ResponseHelper.error(res);
  }
});

module.exports = router;
