const db = require('../config/db');

const TYPE_LABELS = {
  committee: '党委',
  generalBranch: '党总支',
  branch: '党支部',
  group: '党小组',
};

function idsEqual(a, b) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Number(a) === Number(b);
}

class OrganizationService {
  static async getTree() {
    const [rows] = await db.query(
      `SELECT o.id, o.name, o.type, o.parentId, o.leaderUserId, o.createdAt,
              u.realName AS leaderName,
              (SELECT COUNT(*) FROM users usr WHERE usr.organizationId = o.id AND usr.status = 1) AS directMembers
       FROM organizations o
       LEFT JOIN users u ON u.id = o.leaderUserId
       ORDER BY o.id`
    );
    return decorateTree(buildTree(rows, null));
  }

  static ancestorIdsFromRows(orgId, rows) {
    const parentById = new Map(
      rows.map((row) => [Number(row.id), row.parentId == null ? null : Number(row.parentId)])
    );
    const ids = [];
    let current = Number(orgId);
    const seen = new Set();
    while (current && !seen.has(current)) {
      seen.add(current);
      ids.push(current);
      current = parentById.has(current) ? parentById.get(current) : null;
    }
    return ids;
  }

  static async getDescendantIds(orgId) {
    const [rows] = await db.query('SELECT id, parentId FROM organizations');
    const ids = [];
    const collect = (parentId) => {
      rows.forEach((row) => {
        if (idsEqual(row.parentId, parentId)) {
          ids.push(Number(row.id));
          collect(row.id);
        }
      });
    };
    collect(orgId);
    ids.push(Number(orgId));
    return [...new Set(ids)];
  }

  static async getAncestorIds(orgId) {
    if (orgId == null || orgId === '') return [];
    const [rows] = await db.query('SELECT id, parentId FROM organizations');
    return this.ancestorIdsFromRows(orgId, rows);
  }

  static async getById(id) {
    const [rows] = await db.query(
      `SELECT o.*, u.realName AS leaderName
       FROM organizations o
       LEFT JOIN users u ON u.id = o.leaderUserId
       WHERE o.id = ?`,
      [id]
    );
    return rows[0] || null;
  }

  static async create(data) {
    const { name, type, parentId, leaderUserId } = data;
    const [result] = await db.query(
      'INSERT INTO organizations (name, type, parentId, leaderUserId) VALUES (?, ?, ?, ?)',
      [name, type, parentId || null, leaderUserId || null]
    );
    return result.insertId;
  }

  static async update(id, data) {
    const { name, type, parentId, leaderUserId } = data;
    await db.query(
      'UPDATE organizations SET name=?, type=?, parentId=?, leaderUserId=? WHERE id=?',
      [name, type, parentId || null, leaderUserId || null, id]
    );
  }

  static async delete(id) {
    const [children] = await db.query('SELECT COUNT(*) as cnt FROM organizations WHERE parentId = ?', [id]);
    if (children[0].cnt > 0) throw new Error('该组织下有子组织，无法删除');
    const [users] = await db.query('SELECT COUNT(*) as cnt FROM users WHERE organizationId = ?', [id]);
    if (users[0].cnt > 0) throw new Error('该组织下有人员，无法删除');
    await db.query('DELETE FROM organizations WHERE id = ?', [id]);
  }
}

function buildTree(list, parentId) {
  const tree = [];
  list.forEach((item) => {
    if (idsEqual(item.parentId, parentId)) {
      const children = buildTree(list, item.id);
      tree.push({
        id: Number(item.id),
        name: item.name,
        type: item.type,
        parentId: item.parentId == null ? null : Number(item.parentId),
        leaderUserId: item.leaderUserId == null ? null : Number(item.leaderUserId),
        leaderName: item.leaderName || null,
        createdAt: item.createdAt,
        directMembers: Number(item.directMembers || 0),
        children,
      });
    }
  });
  return tree;
}

function decorateTree(nodes, parentName = '—') {
  return nodes.map((node) => {
    const children = decorateTree(node.children || [], node.name);
    const childMembers = children.reduce((sum, child) => sum + Number(child.members || 0), 0);
    return {
      ...node,
      label: node.name,
      typeLabel: TYPE_LABELS[node.type] || node.type,
      parent: parentName,
      parentName,
      leader: node.leaderName || '未指定',
      members: Number(node.directMembers || 0) + childMembers,
      children: children.length ? children : undefined,
    };
  });
}

module.exports = OrganizationService;
module.exports.TYPE_LABELS = TYPE_LABELS;
