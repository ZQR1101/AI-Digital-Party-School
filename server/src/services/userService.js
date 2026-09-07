const bcrypt = require('bcryptjs');
const db = require('../config/db');

class UserService {
  static async list({ page = 1, pageSize = 10, keyword, organizationId, role }) {
    let sql = `SELECT u.id, u.username, u.realName, u.role, u.organizationId, u.phone, u.email, u.status, u.createdAt, o.name as organizationName FROM users u LEFT JOIN organizations o ON u.organizationId = o.id WHERE 1=1`;
    const params = [];

    if (keyword) { sql += ' AND (u.realName LIKE ? OR u.username LIKE ?)'; params.push(`%${keyword}%`, `%${keyword}%`); }
    if (organizationId) { sql += ' AND u.organizationId = ?'; params.push(organizationId); }
    if (role) { sql += ' AND u.role = ?'; params.push(role); }

    const [countRows] = await db.query(`SELECT COUNT(*) as total FROM (${sql}) t`, params);
    const total = countRows[0].total;

    sql += ' ORDER BY u.id DESC LIMIT ? OFFSET ?';
    params.push(Number(pageSize), (page - 1) * pageSize);
    const [rows] = await db.query(sql, params);

    return { total, list: rows };
  }

  static async getById(id) {
    const [rows] = await db.query(
      'SELECT u.id, u.username, u.realName, u.role, u.organizationId, u.phone, u.email, u.status, u.createdAt, u.updatedAt, o.name as organizationName FROM users u LEFT JOIN organizations o ON u.organizationId = o.id WHERE u.id = ?',
      [id]
    );
    return rows[0] || null;
  }

  static async create(data) {
    const { username, password, realName, role, organizationId, phone, email } = data;
    const hashedPassword = await bcrypt.hash(password || '123456', 10);
    const [result] = await db.query(
      'INSERT INTO users (username, password, realName, role, organizationId, phone, email) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [username, hashedPassword, realName, role || 'member', organizationId || null, phone || null, email || null]
    );
    return result.insertId;
  }

  static async update(id, data) {
    const { realName, role, organizationId, phone, email, status } = data;
    const sets = [];
    const params = [];
    if (realName !== undefined) { sets.push('realName=?'); params.push(realName); }
    if (role !== undefined) { sets.push('role=?'); params.push(role); }
    if (organizationId !== undefined) { sets.push('organizationId=?'); params.push(organizationId); }
    if (phone !== undefined) { sets.push('phone=?'); params.push(phone); }
    if (email !== undefined) { sets.push('email=?'); params.push(email); }
    if (status !== undefined) { sets.push('status=?'); params.push(status); }
    if (data.password) {
      const hashed = await bcrypt.hash(data.password, 10);
      sets.push('password=?'); params.push(hashed);
    }
    if (sets.length === 0) return;
    params.push(id);
    await db.query(`UPDATE users SET ${sets.join(',')} WHERE id=?`, params);
  }

  static async delete(id) {
    await db.query('DELETE FROM users WHERE id = ?', [id]);
  }

  /** 批量导入 */
  static async batchImport(users) {
    const results = { success: 0, fail: 0, errors: [] };
    for (const u of users) {
      try {
        if (!u.username || !u.realName) { results.fail++; results.errors.push(`缺少必填字段: ${JSON.stringify(u)}`); continue; }
        await this.create({
          username: u.username, password: u.password || '123456',
          realName: u.realName, role: u.role || 'member',
          organizationId: u.organizationId || null, phone: u.phone, email: u.email
        });
        results.success++;
      } catch (e) {
        results.fail++;
        results.errors.push(`${u.username || '未知'}: ${e.message}`);
      }
    }
    return results;
  }
}

module.exports = UserService;
