const OrganizationService = require('./organizationService');

/**
 * 组织数据范围授权：
 * - admin：不限制（返回 null）
 * - 其他管理角色（如支部书记）：仅可操作本组织及其下级组织的数据
 */
async function getScopedOrgIds(actor) {
  if (!actor || !actor.userId) {
    throw Object.assign(new Error('未登录'), { statusCode: 401 });
  }
  if (actor.role === 'admin') return null;
  if (actor.organizationId == null || actor.organizationId === '') {
    throw Object.assign(new Error('当前账号未归属任何组织，无法执行管理操作'), { statusCode: 403 });
  }
  return OrganizationService.getDescendantIds(actor.organizationId);
}

/**
 * 校验目标组织全部落在 actor 的数据范围内，越权直接抛 403。
 * @param {number[]|null} scopeIds null 表示 admin 不限制
 * @param {Array<number|string>} targetIds 待操作的组织 ID 列表
 */
function assertInScope(scopeIds, targetIds, message = '无权操作所选组织的数据') {
  if (scopeIds == null) return;
  const list = (Array.isArray(targetIds) ? targetIds : [targetIds]).filter((v) => v != null && v !== '');
  if (!list.length) return;
  const allowed = new Set(scopeIds.map(Number));
  const illegal = list.filter((id) => !allowed.has(Number(id)));
  if (illegal.length) {
    throw Object.assign(new Error(message), { statusCode: 403, organizationIds: illegal });
  }
}

module.exports = {
  getScopedOrgIds,
  assertInScope,
};
