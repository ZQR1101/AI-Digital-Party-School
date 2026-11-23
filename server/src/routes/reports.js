const express = require('express');
const router = express.Router();
const ReportService = require('../services/reportService');
const HomeSummaryService = require('../services/homeSummaryService');
const ResponseHelper = require('../utils/response');
const { authenticate, loadCurrentUser } = require('../middleware/auth');
const { runAiRequest } = require('../ai/request');

/**
 * GET /api/reports/me
 * 获取 AI 个人学习报告（评分+评语+建议）
 */
router.get('/me', authenticate, loadCurrentUser, (req, res) => runAiRequest(
  req, res, 'learning_evaluation', 'legacy_report',
  ({ actor, trace }) => ReportService.generateReport(actor.userId, trace)
));

/**
 * GET /api/reports/summary
 * 首页轻量统计（连续天数 / 本周时长 / 待完成任务），不调用大模型。
 */
router.get('/summary', authenticate, loadCurrentUser, async (req, res) => {
  try {
    const summary = await HomeSummaryService.getSummary(req.user.userId);
    return ResponseHelper.success(res, summary);
  } catch (err) {
    console.error('Get home summary error:', err);
    return ResponseHelper.error(res);
  }
});

module.exports = router;
