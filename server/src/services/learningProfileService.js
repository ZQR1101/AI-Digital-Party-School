const db = require('../config/db');
const ExamRecordService = require('./examRecordService');

function normalizeTags(value) {
  if (Array.isArray(value)) return value.map(String).map(item => item.trim()).filter(Boolean);
  return String(value || '').split(/[,，;；]/).map(item => item.trim()).filter(Boolean);
}

function parseAnswers(value) {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(String(value || '{}')); } catch { return {}; }
}

class LearningProfileService {
  static async getProfile(userId) {
    const [users] = await db.query(
      `SELECT u.id, u.realName, u.organizationId, o.name AS organizationName
       FROM users u LEFT JOIN organizations o ON o.id = u.organizationId
       WHERE u.id = ?`,
      [userId]
    );
    if (!users.length) throw new Error('用户不存在');

    const [studyRows] = await db.query(
      `SELECT COUNT(lt.id) AS totalTasks,
              SUM(CASE WHEN lr.status = 'completed' THEN 1 ELSE 0 END) AS completedTasks,
              COALESCE(SUM(lr.studySeconds), 0) AS totalStudySeconds,
              COUNT(DISTINCT CASE WHEN lr.studySeconds > 0 THEN DATE(lr.updatedAt) END) AS activeDays
       FROM users u
       LEFT JOIN learning_tasks lt ON lt.organizationId = u.organizationId AND lt.status = 'published'
       LEFT JOIN learning_records lr ON lr.taskId = lt.id AND lr.userId = u.id
       WHERE u.id = ?`,
      [userId]
    );

    const [examRows] = await db.query(
      `SELECT COUNT(*) AS totalExams, COALESCE(AVG(score), 0) AS avgScore,
              COALESCE(MAX(score), 0) AS maxScore
       FROM exam_records WHERE userId = ?`,
      [userId]
    );

    const [weakCategories, learningHistory, recentWrongQuestions] = await Promise.all([
      this.getWeakCategories(userId),
      this.getRecentLearning(userId),
      this.getRecentWrongQuestions(userId)
    ]);
    const totalTasks = Number(studyRows[0].totalTasks || 0);
    const completedTasks = Number(studyRows[0].completedTasks || 0);
    return {
      userId: users[0].id,
      userName: users[0].realName,
      organizationId: users[0].organizationId,
      organizationName: users[0].organizationName,
      totalTasks,
      completedTasks,
      completionRate: totalTasks ? Math.round((completedTasks / totalTasks) * 10000) / 100 : 0,
      totalStudyHours: Math.round((Number(studyRows[0].totalStudySeconds || 0) / 3600) * 10) / 10,
      activeDays: Number(studyRows[0].activeDays || 0),
      totalExams: Number(examRows[0].totalExams || 0),
      avgScore: Math.round(Number(examRows[0].avgScore || 0) * 100) / 100,
      maxScore: Number(examRows[0].maxScore || 0),
      weakCategories,
      learningHistory,
      recentWrongQuestions
    };
  }

  static async getWeakCategories(userId) {
    const [rows] = await db.query(
      `SELECT er.id AS examRecordId, er.answers, q.id AS questionId, q.type,
              q.answer AS correctAnswer, q.category
       FROM exam_records er
       JOIN learning_tasks lt ON lt.id = er.taskId
       JOIN paper_questions pq ON pq.paperId = lt.contentId
       JOIN questions q ON q.id = pq.questionId
       WHERE er.userId = ? AND q.status = 1`,
      [userId]
    );
    const buckets = new Map();
    for (const row of rows) {
      const answers = parseAnswers(row.answers);
      const userAnswer = answers && typeof answers === 'object' ? answers[row.questionId] : undefined;
      const correct = ExamRecordService.checkAnswer(row.type, userAnswer ?? '', row.correctAnswer);
      const category = row.category || '未分类知识点';
      const item = buckets.get(category) || { category, totalCount: 0, wrongCount: 0 };
      item.totalCount += 1;
      if (!correct) item.wrongCount += 1;
      buckets.set(category, item);
    }
    return [...buckets.values()]
      .filter(item => item.wrongCount > 0)
      .map(item => ({
        ...item,
        masteryScore: Math.round(((item.totalCount - item.wrongCount) / item.totalCount) * 100)
      }))
      .sort((a, b) => b.wrongCount - a.wrongCount || a.masteryScore - b.masteryScore);
  }

  static async getRecentLearning(userId) {
    const [rows] = await db.query(
      `SELECT c.id AS contentId, c.title, c.tags, lr.status, lr.studySeconds,
              lr.updatedAt AS lastStudiedAt
       FROM learning_records lr
       JOIN learning_tasks lt ON lt.id = lr.taskId
       JOIN contents c ON c.id = lt.contentId
       WHERE lr.userId = ? AND lr.studySeconds > 0
       ORDER BY lr.updatedAt DESC
       LIMIT 20`,
      [userId]
    );
    return rows.map(row => ({
      contentId: row.contentId,
      title: row.title,
      tags: normalizeTags(row.tags),
      status: row.status,
      studySeconds: Number(row.studySeconds || 0),
      lastStudiedAt: row.lastStudiedAt
    }));
  }

  static async getRecentWrongQuestions(userId) {
    const [rows] = await db.query(
      `SELECT er.answers, er.submittedAt, q.id AS questionId, q.type, q.title,
              q.answer AS correctAnswer, q.analysis, q.category
       FROM exam_records er
       JOIN learning_tasks lt ON lt.id = er.taskId
       JOIN paper_questions pq ON pq.paperId = lt.contentId
       JOIN questions q ON q.id = pq.questionId
       WHERE er.userId = ? AND q.status = 1
       ORDER BY er.submittedAt DESC, pq.sort ASC
       LIMIT 40`,
      [userId]
    );
    return rows.filter(row => {
      const answers = parseAnswers(row.answers);
      return !ExamRecordService.checkAnswer(row.type, answers[row.questionId] ?? '', row.correctAnswer);
    }).slice(0, 15).map(row => ({
      questionId: row.questionId,
      title: row.title,
      category: row.category || '未分类知识点',
      analysis: row.analysis || '',
      submittedAt: row.submittedAt
    }));
  }
}

module.exports = LearningProfileService;
module.exports.normalizeTags = normalizeTags;
