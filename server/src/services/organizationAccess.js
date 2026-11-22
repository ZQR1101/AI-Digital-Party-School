const db = require('../config/db');

function accessError(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}

function numericId(value) {
  if (!['number', 'string'].includes(typeof value) || !/^[1-9]\d*$/.test(String(value))) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

async function loadActiveActor(principal) {
  const userId = numericId(principal?.userId);
  if (!userId) throw accessError(401, '登录状态无效，请重新登录');
  const [[row]] = await db.query(
    'SELECT id AS userId, role, organizationId FROM users WHERE id = ? AND status = 1',
    [userId]
  );
  if (!row) throw accessError(403, '账号不存在或已停用');
  return row;
}

function requireStatisticsRole(actor) {
  if (!['admin', 'secretary'].includes(actor?.role)) {
    throw accessError(403, '组织数据查询仅对管理员和支部书记开放');
  }
}

function subtree(root, byId, children) {
  const lineage = new Set();
  for (let cursor = root; cursor; cursor = cursor.parentId == null ? null : byId.get(Number(cursor.parentId))) {
    if (lineage.has(cursor.id) || (cursor.parentId != null && !byId.has(Number(cursor.parentId)))) {
      throw accessError(403, '组织层级异常，无法确认数据范围');
    }
    lineage.add(cursor.id);
  }
  const ids = [];
  const pending = [Number(root.id)];
  while (pending.length) {
    const id = pending.pop();
    ids.push(id);
    pending.push(...(children.get(id) || []));
  }
  return ids;
}

function selectOrganizationScope(actor, selector, rows) {
  requireStatisticsRole(actor);
  const { id, name } = selector;
  const targetId = id == null ? null : numericId(id);
  if (id != null && targetId == null) throw accessError(400, '组织编号无效');

  const byId = new Map(rows.map(row => [Number(row.id), row]));
  const children = new Map();
  for (const row of rows) {
    if (row.parentId == null) continue;
    const parentId = Number(row.parentId);
    if (!children.has(parentId)) children.set(parentId, []);
    children.get(parentId).push(Number(row.id));
  }

  let home = null;
  let allowed = null;
  if (actor.role === 'secretary') {
    home = byId.get(numericId(actor.organizationId));
    if (!home) throw accessError(403, '当前账号未分配有效的查询组织');
    allowed = new Set(subtree(home, byId, children));
  }
  if (targetId == null && !name) return { organization: home, orgIds: allowed ? [...allowed] : null };

  const normalizedName = String(name || '').toLowerCase();
  const choices = rows.filter(row => (!allowed || allowed.has(Number(row.id)))
    && (targetId != null ? Number(row.id) === targetId : row.name.toLowerCase().includes(normalizedName)));
  const exact = choices.filter(row => row.name.toLowerCase() === normalizedName);
  const matches = exact.length ? exact : choices;
  if (!matches.length) {
    throw allowed
      ? accessError(403, '未找到可查询的组织，请提供权限范围内的完整组织名称')
      : accessError(400, '未找到该组织，请核对组织名称或编号');
  }
  if (matches.length > 1) throw accessError(400, '组织名称匹配到多个结果，请提供完整名称');
  const organization = matches[0];
  const orgIds = subtree(organization, byId, children);
  if (allowed && orgIds.some(orgId => !allowed.has(orgId))) {
    throw accessError(403, '组织层级超出可查询范围');
  }
  return { organization, orgIds };
}

async function resolveOrganizationScope(actor, selector = {}) {
  requireStatisticsRole(actor);
  if (actor.role === 'admin' && selector.id == null && !selector.name) {
    return { organization: null, orgIds: null };
  }
  const [rows] = await db.query('SELECT id, name, parentId FROM organizations');
  return selectOrganizationScope(actor, selector, rows);
}

module.exports = { loadActiveActor, requireStatisticsRole, resolveOrganizationScope, selectOrganizationScope, accessError };
