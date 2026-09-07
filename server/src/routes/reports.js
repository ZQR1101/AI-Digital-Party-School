const express = require('express');
const router = express.Router();
const ReportService = require('../services/reportService');
const ResponseHelper = require('../utils/response');
const { authenticate } = require('../middleware/auth');

/**
 * GET /api/reports/me
 * 获取 AI 个人学习报告（评分+评语+建议）
 */
router.get('/me', authenticate, async (req, res) => {
  try {
    const report = await ReportService.generateReport(req.user.userId);
    return ResponseHelper.success(res, report);
  } catch (err) {
    console.error('Generate report error:', err);
    return ResponseHelper.error(res, err.message);
  }
});

module.exports = router;
