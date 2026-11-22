const express = require('express');
const router = express.Router();
const ReportService = require('../services/reportService');
const { authenticate } = require('../middleware/auth');
const { runAiRequest } = require('../ai/request');

/**
 * GET /api/reports/me
 * 获取 AI 个人学习报告（评分+评语+建议）
 */
router.get('/me', authenticate, (req, res) => runAiRequest(
  req, res, 'learning_evaluation', 'legacy_report',
  ({ actor, trace }) => ReportService.generateReport(actor.userId, trace)
));

module.exports = router;
