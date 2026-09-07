const db = require('../config/db');

function normalizeQuestionIds(questionIds) {
  return [...new Set((questionIds || []).map(Number).filter(Number.isInteger).filter(id => id > 0))];
}

async function replaceQuestions(connection, paperId, questionIds, totalScore) {
  const ids = normalizeQuestionIds(questionIds);
  await connection.query('DELETE FROM paper_questions WHERE paperId = ?', [paperId]);
  if (!ids.length) return;

  const [enabled] = await connection.query(
    `SELECT id FROM questions WHERE status = 1 AND id IN (${ids.map(() => '?').join(',')})`,
    ids
  );
  if (enabled.length !== ids.length) throw new Error('试卷包含不存在或已停用的题目');

  const score = Number((Number(totalScore) / ids.length).toFixed(2));
  const placeholders = ids.map(() => '(?, ?, ?, ?)').join(',');
  const values = ids.flatMap((questionId, index) => [paperId, questionId, score, index + 1]);
  await connection.query(
    `INSERT INTO paper_questions (paperId, questionId, score, sort) VALUES ${placeholders}`,
    values
  );
}

class PaperService {
  static async list({ page = 1, pageSize = 10, keyword, category, status }) {
    let where = 'WHERE p.status <> 0';
    const params = [];
    if (keyword) { where += ' AND p.title LIKE ?'; params.push(`%${keyword}%`); }
    if (category) { where += ' AND p.category = ?'; params.push(category); }
    if (status !== undefined && status !== '') { where += ' AND p.status = ?'; params.push(Number(status)); }

    const [countRows] = await db.query(`SELECT COUNT(*) AS total FROM papers p ${where}`, params);
    const listParams = [...params, Number(pageSize), (Number(page) - 1) * Number(pageSize)];
    const [rows] = await db.query(
      `SELECT p.*, u.realName AS creatorName,
              (SELECT COUNT(*) FROM paper_questions pq WHERE pq.paperId = p.id) AS questionCount
       FROM papers p
       LEFT JOIN users u ON u.id = p.createdBy
       ${where}
       ORDER BY p.id DESC LIMIT ? OFFSET ?`,
      listParams
    );
    return { total: countRows[0].total, list: rows };
  }

  static async getById(id) {
    const [rows] = await db.query(
      `SELECT p.*, u.realName AS creatorName
       FROM papers p LEFT JOIN users u ON u.id = p.createdBy
       WHERE p.id = ? AND p.status <> 0`,
      [id]
    );
    if (!rows[0]) return null;
    const [questions] = await db.query(
      `SELECT q.*, pq.score, pq.sort
       FROM paper_questions pq
       JOIN questions q ON q.id = pq.questionId
       WHERE pq.paperId = ? ORDER BY pq.sort, pq.id`,
      [id]
    );
    return { ...rows[0], questions };
  }

  static async create(data) {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [result] = await connection.query(
        `INSERT INTO papers (title, category, description, duration, totalScore, passScore, status, createdBy)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [data.title, data.category || null, data.description || null, Number(data.duration) || 60,
          Number(data.totalScore) || 100, Number(data.passScore) || 60, Number(data.status) || 1, data.createdBy || null]
      );
      await replaceQuestions(connection, result.insertId, data.questionIds, data.totalScore || 100);
      await connection.commit();
      return result.insertId;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  static async update(id, data) {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [existingRows] = await connection.query('SELECT * FROM papers WHERE id = ? AND status <> 0', [id]);
      if (!existingRows[0]) throw new Error('试卷不存在');

      const fields = ['title', 'category', 'description', 'duration', 'totalScore', 'passScore', 'status'];
      const sets = [];
      const params = [];
      for (const field of fields) {
        if (data[field] !== undefined) { sets.push(`${field} = ?`); params.push(data[field]); }
      }
      if (sets.length) {
        params.push(id);
        await connection.query(`UPDATE papers SET ${sets.join(', ')} WHERE id = ?`, params);
      }
      if (Array.isArray(data.questionIds)) {
        await replaceQuestions(connection, id, data.questionIds, data.totalScore ?? existingRows[0].totalScore);
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  static async delete(id) {
    await db.query('UPDATE papers SET status = 0 WHERE id = ?', [id]);
  }
}

module.exports = PaperService;
module.exports.normalizeQuestionIds = normalizeQuestionIds;
