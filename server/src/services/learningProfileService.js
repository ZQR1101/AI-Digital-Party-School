const db = require('../config/db');
const OrganizationService = require('./organizationService');
const TaskService = require('./taskService');

const DAY_MS = 24 * 60 * 60 * 1000;
const REPORT_DAYS = 30;

function normalizeTags(value) {
  const tags = Array.isArray(value) ? value : String(value || '').split(/[,，;；]/);
  return tags.map(tag => String(tag).normalize('NFKC').trim()).filter(Boolean);
}

function beijingDayKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

function reportWindow(now = new Date()) {
  const endDate = beijingDayKey(now);
  const midnight = new Date(`${endDate}T00:00:00+08:00`);
  const start = new Date(midnight.getTime() - (REPORT_DAYS - 1) * DAY_MS);
  const end = new Date(midnight.getTime() + DAY_MS);
  return { start, end, startDate: beijingDayKey(start), endDate, days: REPORT_DAYS };
}

function parseResults(value) {
  try {
    const results = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(results) ? results : [];
  } catch {
    return [];
  }
}

// Each row is an immutable submitted assessment, newest first.
function summarizeAssessmentAttempts(rows) {
  const scores = { quiz: [], exam: [] };
  const knowledge = new Map();
  const recentWrongQuestions = [];
  for (const row of rows) {
    if (scores[row.kind]) scores[row.kind].push(Number(row.score));
    const attemptTopics = new Map();
    for (const item of parseResults(row.results)) {
      const category = normalizeTags([item.category ?? ''])[0];
      if (!category || typeof item.correct !== 'boolean') continue;
      const topicKey = category.toLowerCase();
      const topic = attemptTopics.get(topicKey) || { category, correctCount: 0, attempts: 0 };
      topic.attempts += 1;
      if (item.correct) topic.correctCount += 1;
      else if (recentWrongQuestions.length < 15) {
        recentWrongQuestions.push({ questionId: item.questionId, category, title: item.title, submittedAt: row.submittedAt });
      }
      attemptTopics.set(topicKey, topic);
    }
    for (const [topicKey, topic] of attemptTopics) {
      const attempts = knowledge.get(topicKey) || [];
      if (attempts.length < 2) attempts.push(topic);
      knowledge.set(topicKey, attempts);
    }
  }
  const assessments = Object.fromEntries(Object.entries(scores).map(([kind, values]) => [kind, {
    count: values.length,
    avgScore: values.length ? Math.round(100 * values.reduce((sum, value) => sum + value, 0) / values.length) / 100 : null
  }]));
  const weakCategories = [...knowledge.values()].map(([latest]) => {
    const wrongCount = latest.attempts - latest.correctCount;
    const wrongRate = Math.round(100 * wrongCount / latest.attempts);
    return { category: latest.category, attempts: latest.attempts, totalCount: latest.attempts, wrongCount, wrongRate, masteryScore: 100 - wrongRate };
  }).filter(item => item.wrongCount > 0)
    .sort((a, b) => b.wrongRate - a.wrongRate || b.wrongCount - a.wrongCount || a.category.localeCompare(b.category));
  const knowledgeProgress = [...knowledge.values()].filter(topics => topics.length === 2).map(([latest, previous]) => ({
    category: latest.category,
    latest: { correctCount: latest.correctCount, attempts: latest.attempts },
    previous: { correctCount: previous.correctCount, attempts: previous.attempts }
  }));
  const allScores = [...scores.quiz, ...scores.exam];
  return { assessments, weakCategories, knowledgeProgress, recentWrongQuestions, allScores };
}

class LearningProfileService {
  static async getProfile(userId, now = new Date()) {
    const [users] = await db.query(
      `SELECT u.id, u.realName, u.organizationId, o.name AS organizationName
       FROM users u LEFT JOIN organizations o ON o.id = u.organizationId
       WHERE u.id = ?`,
      [userId]
    );
    if (!users.length) throw new Error('用户不存在');

    const user = users[0];
    const { start, end, startDate, endDate, days } = reportWindow(now);
    const orgIds = await OrganizationService.getAncestorIds(user.organizationId);
    const [tasks, learningHistory, attemptRows, legacyRows] = await Promise.all([
      this.getPeriodTasks(userId, orgIds, user.organizationId, start, end),
      this.getRecentLearning(userId, start, end),
      this.getAssessmentAttempts(userId, start, end),
      db.query(
        `SELECT COUNT(*) AS count, SUM(score) AS scoreSum, MAX(score) AS maxScore
         FROM exam_records WHERE userId = ? AND submittedAt >= ? AND submittedAt < ?`,
        [userId, start, end]
      ).then(([rows]) => rows[0])
    ]);
    const { assessments, weakCategories, knowledgeProgress, recentWrongQuestions, allScores } = summarizeAssessmentAttempts(attemptRows);
    const completedTasks = tasks.filter(task => task.progress === 'completed').length;
    const totalExams = Number(legacyRows.count) + allScores.length;
    const scoreSum = allScores.reduce((sum, score) => sum + score, Number(legacyRows.scoreSum) || 0);

    return {
      userId: user.id,
      userName: user.realName,
      organizationId: user.organizationId,
      organizationName: user.organizationName,
      period: { startDate, endDate, days },
      totalTasks: tasks.length,
      completedTasks,
      completionRate: tasks.length ? Math.round(completedTasks / tasks.length * 10000) / 100 : null,
      totalStudyHours: Math.round(learningHistory.reduce((sum, item) => sum + item.studySeconds, 0) / 360) / 10,
      activeDays: new Set(learningHistory.map(item => beijingDayKey(new Date(item.lastStudiedAt)))).size,
      totalExams,
      avgScore: totalExams ? Math.round(scoreSum / totalExams * 100) / 100 : null,
      maxScore: totalExams ? Math.max(Number(legacyRows.maxScore) || 0, ...allScores) : null,
      assessments,
      weakCategories,
      knowledgeProgress,
      learningHistory: learningHistory.slice(0, 20),
      recentWrongQuestions
    };
  }

  static async getPeriodTasks(userId, orgIds, directOrgId, start, end) {
    if (!orgIds.length) return [];
    const [rows] = await db.query(
      `SELECT lt.id, lt.contentId, lt.title, lr.status AS progress
       FROM learning_tasks lt
       LEFT JOIN learning_records lr ON lr.taskId = lt.id AND lr.userId = ?
       WHERE lt.status = 'published' AND lt.organizationId IN (?)
         AND lt.createdAt >= ? AND lt.createdAt < ?
       ORDER BY (lt.organizationId = ?) DESC, lt.id DESC`,
      [userId, orgIds, start, end, directOrgId]
    );
    return TaskService.dedupeMemberTasks(rows);
  }

  static async getRecentLearning(userId, start, end) {
    const [rows] = await db.query(
      `SELECT c.id AS contentId, c.title, c.tags, lr.status, lr.studySeconds, lr.updatedAt AS lastStudiedAt
       FROM learning_records lr
       JOIN learning_tasks lt ON lt.id = lr.taskId
       JOIN contents c ON c.id = lt.contentId
       WHERE lr.userId = ? AND lr.studySeconds > 0 AND lr.updatedAt >= ? AND lr.updatedAt < ?
       ORDER BY lr.updatedAt DESC`,
      [userId, start, end]
    );
    return rows.map(row => ({ ...row, tags: normalizeTags(row.tags), studySeconds: Number(row.studySeconds) }));
  }

  static async getAssessmentAttempts(userId, start, end) {
    try {
      const [rows] = await db.query(
        `SELECT ass.kind, aa.score, aa.results, aa.submittedAt
         FROM assessment_attempts aa JOIN assessments ass ON ass.id = aa.assessmentId
         WHERE aa.userId = ? AND aa.submittedAt >= ? AND aa.submittedAt < ?
         ORDER BY aa.submittedAt DESC, aa.id DESC`,
        [userId, start, end]
      );
      return rows;
    } catch (error) {
      if (error.code === 'ER_NO_SUCH_TABLE') return [];
      throw error;
    }
  }

  static async getAssessmentRevision(userId) {
    try {
      const [[row]] = await db.query(
        'SELECT COALESCE(MAX(id), 0) AS revision FROM assessment_attempts WHERE userId = ?',
        [userId]
      );
      return String(row.revision);
    } catch (error) {
      if (error.code === 'ER_NO_SUCH_TABLE') return '0';
      throw error;
    }
  }
}

module.exports = LearningProfileService;
module.exports.normalizeTags = normalizeTags;
module.exports.beijingDayKey = beijingDayKey;
module.exports.reportWindow = reportWindow;
module.exports.summarizeAssessmentAttempts = summarizeAssessmentAttempts;
