const express = require('express');
const router = express.Router();
const ContentService = require('../services/contentService');
const ResponseHelper = require('../utils/response');
const { authenticate, loadCurrentUser } = require('../middleware/auth');

router.use(authenticate, loadCurrentUser);

/**
 * GET /api/contents
 * 党员浏览已发布的公共学习内容
 */
router.get('/', async (req, res) => {
  try {
    const data = await ContentService.listPublic(req.query);
    return ResponseHelper.success(res, data);
  } catch (err) {
    console.error('List public contents error:', err);
    return ResponseHelper.error(res);
  }
});

/**
 * GET /api/contents/:id
 * 党员查看已发布的公共学习内容
 */
router.get('/:id', async (req, res) => {
  try {
    const content = await ContentService.getPublicById(req.params.id);
    if (!content) return ResponseHelper.notFound(res, '公共学习内容不存在或已下架');
    return ResponseHelper.success(res, content);
  } catch (err) {
    console.error('Get public content error:', err);
    return ResponseHelper.error(res);
  }
});

module.exports = router;
