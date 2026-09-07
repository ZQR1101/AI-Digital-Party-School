const express = require('express');
const router = express.Router();
const StatisticsService = require('../../services/statisticsService');
const ResponseHelper = require('../../utils/response');
const { authenticate, requireAdmin } = require('../../middleware/auth');

router.use(authenticate, requireAdmin);

/**
 * GET /api/admin/statistics
 * 查看学习时长、完成率、平均分等统计数据
 */
router.get('/', async (req, res) => {
  try {
    const { organizationId, range = '6m' } = req.query;
    const dashboard = await StatisticsService.getDashboard({
      organizationId: organizationId || null,
      range,
    });
    return ResponseHelper.success(res, dashboard);
  } catch (err) {
    console.error('Statistics error:', err);
    return ResponseHelper.error(res);
  }
});

module.exports = router;
