const db = require('../config/db');

class QuestionService {
  static async list({ page = 1, pageSize = 10, keyword, type, category, difficulty }) {
    let sql = `SELECT q.*, u.realName as creatorName,
      (SELECT COUNT(*) FROM paper_questions pq WHERE pq.questionId = q.id) as usageCount
      FROM questions q LEFT JOIN users u ON q.createdBy = u.id WHERE q.status = 1`;
    const params = [];
    if (keyword) { sql += ' AND q.title LIKE ?'; params.push(`%${keyword}%`); }
    if (type) { sql += ' AND q.type = ?'; params.push(type); }
    if (category) { sql += ' AND q.category = ?'; params.push(category); }
    if (difficulty) { sql += ' AND q.difficulty = ?'; params.push(Number(difficulty)); }

    const [countRows] = await db.query(`SELECT COUNT(*) as total FROM (${sql}) t`, params);
    sql += ' ORDER BY q.id DESC LIMIT ? OFFSET ?';
    params.push(Number(pageSize), (page - 1) * pageSize);
    const [rows] = await db.query(sql, params);
    return {
      total: countRows[0].total,
      list: rows.map((row) => {
        const { usageCount, ...rest } = row;
        return { ...rest, usage: Number(usageCount || 0) };
      }),
    };
  }

  static async getById(id) {
    const [rows] = await db.query('SELECT * FROM questions WHERE id = ?', [id]);
    return rows[0] || null;
  }

  static async create(data) {
    const { type, title, options, answer, analysis, category, difficulty, createdBy } = data;
    const [result] = await db.query(
      'INSERT INTO questions (type, title, options, answer, analysis, category, difficulty, createdBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [type, title, JSON.stringify(options || []), answer, analysis || null, category || null, difficulty || 1, createdBy || null]
    );
    return result.insertId;
  }

  static async update(id, data) {
    const { type, title, options, answer, analysis, category, difficulty, status } = data;
    const sets = [], params = [];
    if (type !== undefined) { sets.push('type=?'); params.push(type); }
    if (title !== undefined) { sets.push('title=?'); params.push(title); }
    if (options !== undefined) { sets.push('options=?'); params.push(JSON.stringify(options)); }
    if (answer !== undefined) { sets.push('answer=?'); params.push(answer); }
    if (analysis !== undefined) { sets.push('analysis=?'); params.push(analysis); }
    if (category !== undefined) { sets.push('category=?'); params.push(category); }
    if (difficulty !== undefined) { sets.push('difficulty=?'); params.push(difficulty); }
    if (status !== undefined) { sets.push('status=?'); params.push(status); }
    if (sets.length === 0) return;
    params.push(id);
    await db.query(`UPDATE questions SET ${sets.join(',')} WHERE id=?`, params);
  }

  static async delete(id) {
    await db.query('UPDATE questions SET status = 0 WHERE id = ?', [id]);
  }
}

module.exports = QuestionService;
