const db = require('../config/db');
const { requiredStudySeconds, shouldComplete } = require('./studyDuration');

class LearningRecordService {
  static async submit(userId, { taskId, studySeconds, completed }) {
    const [tasks] = await db.query(
      `SELECT c.type AS contentType, c.title, c.summary, c.bodyOrVideoUrl
       FROM learning_tasks t
       JOIN contents c ON t.contentId = c.id
       WHERE t.id = ?`,
      [taskId]
    );
    if (!tasks[0]) throw new Error('学习任务不存在');

    const [existing] = await db.query(
      'SELECT id, status, studySeconds FROM learning_records WHERE userId = ? AND taskId = ?',
      [userId, taskId]
    );

    const prev = Number(existing[0]?.studySeconds) || 0;
    const incoming = Math.max(0, Number(studySeconds) || 0);
    const videoEnded = tasks[0].contentType === 'video' && completed;
    const seconds = Math.max(prev, incoming);
    const requiredSeconds = requiredStudySeconds(tasks[0]);
    const alreadyDone = existing[0]?.status === 'completed';
    const done = alreadyDone || shouldComplete({
      ...tasks[0],
      studySeconds: seconds,
      requiredSeconds,
      videoEnded,
    }) || (Boolean(completed) && tasks[0].contentType !== 'video' && seconds >= requiredSeconds);
    const newStatus = done ? 'completed' : (seconds > 0 ? 'inProgress' : 'pending');
    const completedAt = done ? new Date() : null;

    if (existing.length > 0) {
      await db.query(
        'UPDATE learning_records SET studySeconds = ?, status = ?, completedAt = COALESCE(?, completedAt) WHERE id = ?',
        [seconds, newStatus, completedAt, existing[0].id]
      );
    } else {
      await db.query(
        'INSERT INTO learning_records (userId, taskId, studySeconds, status, completedAt) VALUES (?, ?, ?, ?, ?)',
        [userId, taskId, seconds, newStatus, completedAt]
      );
    }
    return { studySeconds: seconds, status: newStatus, requiredSeconds, progress: done ? 100 : Math.min(99, requiredSeconds ? Math.round(seconds / requiredSeconds * 100) : 0) };
  }

  static async getCompletionStats(organizationId) {
    let whereClause = '';
    const params = [];
    if (organizationId) {
      whereClause = 'WHERE u.organizationId = ?';
      params.push(organizationId);
    }
    const [rows] = await db.query(
      `SELECT COUNT(DISTINCT u.id) as totalUsers,
              COUNT(DISTINCT CASE WHEN lr.status = 'completed' THEN u.id END) as completedUsers
       FROM users u
       LEFT JOIN learning_tasks lt ON lt.organizationId = u.organizationId
       LEFT JOIN learning_records lr ON lr.userId = u.id AND lr.taskId = lt.id
       ${whereClause}`,
      params
    );
    return rows[0];
  }
}

module.exports = LearningRecordService;
