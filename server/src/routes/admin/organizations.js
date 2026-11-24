const express = require('express');
const logger = require('../../utils/logger');

const router = express.Router();
const OrganizationService = require('../../services/organizationService');
const ResponseHelper = require('../../utils/response');
const { authenticate, loadCurrentUser, requireAdmin, requireManager } = require('../../middleware/auth');

// 所有接口都需要认证 + 管理员权限
router.use(authenticate, loadCurrentUser, requireAdmin);

/**
 * GET /api/admin/organizations
 * 获取组织树列表
 */
router.get('/', async (req, res) => {
  try {
    const tree = await OrganizationService.getTree();
    return ResponseHelper.success(res, tree);
  } catch (err) {
    logger.error('Get organizations error:', err);
    return ResponseHelper.error(res);
  }
});

/**
 * POST /api/admin/organizations
 * 新增组织节点
 */
router.post('/', async (req, res) => {
  try {
    const { name, type, parentId, leaderUserId } = req.body;
    if (!name || !type) {
      return ResponseHelper.badRequest(res, '组织名称和类型为必填项');
    }
    const validTypes = ['committee', 'generalBranch', 'branch', 'group'];
    if (!validTypes.includes(type)) {
      return ResponseHelper.badRequest(res, `类型必须为: ${validTypes.join(', ')}`);
    }
    const id = await OrganizationService.create({ name, type, parentId, leaderUserId });
    return ResponseHelper.success(res, { id }, '创建成功');
  } catch (err) {
    logger.error('Create organization error:', err);
    return ResponseHelper.error(res);
  }
});

/**
 * PUT /api/admin/organizations/:id
 * 编辑组织信息
 */
router.put('/:id', async (req, res) => {
  try {
    const org = await OrganizationService.getById(req.params.id);
    if (!org) return ResponseHelper.notFound(res, '组织不存在');

    await OrganizationService.update(req.params.id, req.body);
    return ResponseHelper.success(res, null, '更新成功');
  } catch (err) {
    logger.error('Update organization error:', err);
    return ResponseHelper.error(res);
  }
});

/**
 * DELETE /api/admin/organizations/:id
 * 删除组织节点（需校验无下级组织和人员）
 */
router.delete('/:id', async (req, res) => {
  try {
    const org = await OrganizationService.getById(req.params.id);
    if (!org) return ResponseHelper.notFound(res, '组织不存在');

    await OrganizationService.delete(req.params.id);
    return ResponseHelper.success(res, null, '删除成功');
  } catch (err) {
    logger.error('Delete organization error:', err);
    return ResponseHelper.error(res, err.message);
  }
});

module.exports = router;
