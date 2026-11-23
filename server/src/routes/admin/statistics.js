const express = require('express');
const router = express.Router();
const StatisticsService = require('../../services/statisticsService');
const ResponseHelper = require('../../utils/response');
const { authenticate, loadCurrentUser } = require('../../middleware/auth');
const { loadActiveActor, resolveOrganizationScope } = require('../../services/organizationAccess');

router.use(authenticate, loadCurrentUser);

/**
 * GET /api/admin/statistics
 * 查看学习时长、完成率、平均分等统计数据
 */
router.get('/', async (req, res) => {
  try {
    const { organizationId, range = '6m' } = req.query;
    const actor = await loadActiveActor(req.user);
    const { orgIds } = await resolveOrganizationScope(actor, { id: organizationId === '' ? null : organizationId });
    const dashboard = await StatisticsService.getDashboard({
      orgIds,
      range,
    });
    return ResponseHelper.success(res, dashboard);
  } catch (err) {
    if ([400, 401, 403].includes(err.statusCode)) {
      return ResponseHelper.error(res, err.message, err.statusCode, err.statusCode);
    }
    console.error('Statistics query failed:', err.code || 'internal_error');
    return ResponseHelper.error(res);
  }
});

module.exports = router;
