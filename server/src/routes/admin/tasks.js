const express = require('express');
const router = express.Router();
const TaskService = require('../../services/taskService');
const ContentService = require('../../services/contentService');
const OrganizationService = require('../../services/organizationService');
const ResponseHelper = require('../../utils/response');
const { authenticate, loadCurrentUser, requireAdmin, requireManager } = require('../../middleware/auth');

router.use(authenticate, loadCurrentUser, requireManager);

function normalizeDeadline(value) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return `${value} 23:59:59`;
  return value;
}

async function resolveOrganizationIds({ organizationId, organizationIds, includeChildren }) {
  let orgIds = Array.isArray(organizationIds) && organizationIds.length
    ? organizationIds.map(Number)
    : [Number(organizationId)];
  orgIds = [...new Set(orgIds.filter(Boolean))];
  if (!orgIds.length) return [];
  if (!includeChildren) return orgIds;

  const expanded = new Set();
  for (const id of orgIds) {
    const descendants = await OrganizationService.getDescendantIds(id);
    descendants.forEach((item) => expanded.add(Number(item)));
  }
  return [...expanded];
}

/**
 * GET /api/admin/tasks
 * 分页查询任务列表
 */
router.get('/', async (req, res) => {
  try {
    const { page = 1, pageSize = 10, keyword, organizationId, status } = req.query;
    const result = await TaskService.list({
      page: Number(page), pageSize: Number(pageSize), keyword, organizationId, status
    });
    return ResponseHelper.page(res, result.list, result.total);
  } catch (err) {
    console.error('List tasks error:', err);
    return ResponseHelper.error(res);
  }
});

/**
 * GET /api/admin/tasks/:id
 */
router.get('/:id', async (req, res) => {
  try {
    const task = await TaskService.getById(req.params.id);
    if (!task) return ResponseHelper.notFound(res, '任务不存在');
    return ResponseHelper.success(res, task);
  } catch (err) {
    return ResponseHelper.error(res);
  }
});

/**
 * POST /api/admin/tasks
 * 向指定组织发布学习任务，支持文章和视频内容
 */
router.post('/', async (req, res) => {
  try {
    const { title, contentId, organizationId, organizationIds, includeChildren, deadline, description, status } = req.body;
    if (!title || !contentId) {
      return ResponseHelper.badRequest(res, '标题和学习内容为必填项');
    }
    const content = await ContentService.getById(contentId);
    if (!content) return ResponseHelper.badRequest(res, '学习内容不存在');
    if (content.status !== 'published') return ResponseHelper.badRequest(res, '请选择已发布的学习内容');
    if (!['article', 'video'].includes(content.type)) {
      return ResponseHelper.badRequest(res, '学习任务仅支持文章或视频内容');
    }

    const orgIds = await resolveOrganizationIds({ organizationId, organizationIds, includeChildren });
    if (!orgIds.length) return ResponseHelper.badRequest(res, '请选择下发组织');

    const ids = [];
    for (const orgId of orgIds) {
      ids.push(await TaskService.create({
        title,
        contentId,
        organizationId: orgId,
        deadline: normalizeDeadline(deadline),
        description,
        status: status || 'published',
        createdBy: req.user.userId,
      }));
    }
    return ResponseHelper.success(res, { ids, count: ids.length, contentType: content.type }, `已向 ${ids.length} 个组织发布任务`);
  } catch (err) {
    console.error('Create task error:', err);
    return ResponseHelper.error(res);
  }
});

/**
 * PUT /api/admin/tasks/:id
 * 修改已发布任务
 */
router.put('/:id', async (req, res) => {
  try {
    const task = await TaskService.getById(req.params.id);
    if (!task) return ResponseHelper.notFound(res, '任务不存在');
    const payload = { ...req.body };
    if (payload.contentId) {
      const content = await ContentService.getById(payload.contentId);
      if (!content) return ResponseHelper.badRequest(res, '学习内容不存在');
      if (!['article', 'video'].includes(content.type)) {
        return ResponseHelper.badRequest(res, '学习任务仅支持文章或视频内容');
      }
    }
    if (Array.isArray(payload.organizationIds) && payload.organizationIds.length) {
      payload.organizationId = Number(payload.organizationIds[0]);
    }
    if (payload.deadline) payload.deadline = normalizeDeadline(payload.deadline);
    await TaskService.update(req.params.id, payload);
    return ResponseHelper.success(res, null, '更新成功');
  } catch (err) {
    console.error('Update task error:', err);
    return ResponseHelper.error(res);
  }
});

/**
 * DELETE /api/admin/tasks/:id
 * 撤销或删除任务
 */
router.delete('/:id', async (req, res) => {
  try {
    const task = await TaskService.getById(req.params.id);
    if (!task) return ResponseHelper.notFound(res, '任务不存在');
    await TaskService.delete(req.params.id);
    return ResponseHelper.success(res, null, '删除成功');
  } catch (err) {
    return ResponseHelper.error(res);
  }
});

module.exports = router;
