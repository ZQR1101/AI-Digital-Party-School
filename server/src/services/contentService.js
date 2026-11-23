const db = require('../config/db');
const { withPlayableVideo } = require('../utils/playableVideo');
const { sanitizeHtml } = require('../utils/sanitizeHtml');

class ContentService {
  static async list({ page = 1, pageSize = 10, keyword, type, status, category }) {
    let sql = `SELECT c.*, u.realName as creatorName FROM contents c LEFT JOIN users u ON c.createdBy = u.id WHERE 1=1`;
    const params = [];
    if (keyword) { sql += ' AND (c.title LIKE ? OR c.summary LIKE ?)'; params.push(`%${keyword}%`, `%${keyword}%`); }
    if (type) { sql += ' AND c.type = ?'; params.push(type); }
    // 前端将 offlined 展示为 offShelf，这里兼容两种取值
    if (status) {
      const normalized = status === 'offShelf' ? 'offlined' : status;
      sql += ' AND c.status = ?';
      params.push(normalized);
    }
    // category 存于 tags 字段（逗号分隔）
    if (category) { sql += ' AND c.tags LIKE ?'; params.push(`%${category}%`); }

    const [countRows] = await db.query(`SELECT COUNT(*) as total FROM (${sql}) t`, params);
    sql += ' ORDER BY c.id DESC LIMIT ? OFFSET ?';
    params.push(Number(pageSize), (page - 1) * pageSize);
    const [rows] = await db.query(sql, params);
    return { total: countRows[0].total, list: rows.map((row) => withPlayableVideo(row)) };
  }

  static async getById(id) {
    const [rows] = await db.query(
      'SELECT c.*, u.realName as creatorName FROM contents c LEFT JOIN users u ON c.createdBy = u.id WHERE c.id = ?', [id]
    );
    return withPlayableVideo(rows[0] || null);
  }

  static async getPublicById(id) {
    const [rows] = await db.query(
      `SELECT id, title, type, coverUrl, bodyOrVideoUrl, summary, tags, createdAt
       FROM contents
       WHERE id = ? AND isPublic = 1 AND status = 'published'`,
      [id]
    );
    return withPlayableVideo(rows[0] || null);
  }

  static async listPublic({ page = 1, pageSize = 20, keyword, type }) {
    let sql = `SELECT id, title, type, coverUrl, summary, tags, createdAt
               FROM contents
               WHERE isPublic = 1 AND status = 'published'`;
    const params = [];
    if (keyword) {
      sql += ' AND (title LIKE ? OR summary LIKE ? OR tags LIKE ?)';
      params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
    }
    if (type) {
      sql += ' AND type = ?';
      params.push(type);
    }
    const [countRows] = await db.query(`SELECT COUNT(*) as total FROM (${sql}) t`, params);
    sql += ' ORDER BY id DESC LIMIT ? OFFSET ?';
    params.push(Number(pageSize), (Number(page) - 1) * Number(pageSize));
    const [rows] = await db.query(sql, params);
    return { total: countRows[0].total, list: rows };
  }

  /**
   * 正文安全清洗：article 正文以 v-html 渲染，入库前必须做白名单清洗防存储型 XSS。
   * video 类型存的是 URL，不走 HTML 清洗。
   */
  static safeBody(type, body) {
    if (body === undefined || body === null) return body;
    if (String(type) === 'video') return body;
    return sanitizeHtml(body);
  }

  static async create(data) {
    const { title, type, coverUrl, bodyOrVideoUrl, summary, tags, isPublic, status, createdBy } = data;
    const [result] = await db.query(
      'INSERT INTO contents (title, type, coverUrl, bodyOrVideoUrl, summary, tags, isPublic, status, createdBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [title, type, coverUrl || null, this.safeBody(type, bodyOrVideoUrl), summary || null, tags || null, isPublic ? 1 : 0, status || 'draft', createdBy || null]
    );
    return result.insertId;
  }

  static async update(id, data) {
    const { title, type, coverUrl, bodyOrVideoUrl, summary, tags, isPublic, status } = data;
    const sets = [], params = [];
    // 更新时如未指定类型，取现有类型决定是否清洗正文
    let effectiveType = type;
    if (bodyOrVideoUrl !== undefined && effectiveType === undefined) {
      const [rows] = await db.query('SELECT type FROM contents WHERE id=?', [id]);
      effectiveType = rows[0] ? rows[0].type : undefined;
    }
    if (title !== undefined) { sets.push('title=?'); params.push(title); }
    if (type !== undefined) { sets.push('type=?'); params.push(type); }
    if (coverUrl !== undefined) { sets.push('coverUrl=?'); params.push(coverUrl); }
    if (bodyOrVideoUrl !== undefined) { sets.push('bodyOrVideoUrl=?'); params.push(this.safeBody(effectiveType, bodyOrVideoUrl)); }
    if (summary !== undefined) { sets.push('summary=?'); params.push(summary); }
    if (tags !== undefined) { sets.push('tags=?'); params.push(tags); }
    if (isPublic !== undefined) { sets.push('isPublic=?'); params.push(isPublic ? 1 : 0); }
    if (status !== undefined) { sets.push('status=?'); params.push(status); }
    if (sets.length === 0) return;
    params.push(id);
    await db.query(`UPDATE contents SET ${sets.join(',')} WHERE id=?`, params);
  }

  static async delete(id) {
    await db.query('DELETE FROM contents WHERE id = ?', [id]);
  }
}

module.exports = ContentService;
