const OrganizationService = require('./organizationService');

/**
 * 组织数据范围授权。三种语义必须严格区分：
 * - null        ：admin，不限制组织
 * - 非空数组    ：限定为这些组织（本组织及下级）
 * - 空数组      ：账号组织已失效/无任何可见范围，调用方必须视为"无权查看任何数据"，
 *                 绝不能当作"不限制"处理
 */
async function getScopedOrgIds(actor) {
  if (!actor || !actor.userId) {
    throw Object.assign(new Error('未登录'), { statusCode: 401 });
  }
  if (actor.role === 'admin') return null;
  if (actor.organizationId == null || actor.organizationId === '') {
    throw Object.assign(new Error('当前账号未归属任何组织，无法执行管理操作'), { statusCode: 403 });
  }
  const scope = await OrganizationService.getDescendantIds(actor.organizationId);
  // 组织已被删除或 ID 失效时，getDescendantIds 返回空数组：无任何可见范围
  if (!scope.length) {
    throw Object.assign(new Error('当前账号所属组织已失效，无法执行管理操作'), { statusCode: 403 });
  }
  return scope;
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
