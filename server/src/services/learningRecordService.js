const db = require('../config/db');
const OrganizationService = require('./organizationService');
const { requiredStudySeconds, shouldComplete, validateReportedSeconds } = require('./studyDuration');

function recordError(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}

class LearningRecordService {
  /**
   * 提交学习记录。
   * 真实性校验：
   *  1) 任务必须存在、已发布，且下发给当前用户所属组织或其上级组织；
   *  2) 上报秒数必须为合法有限数，且单次增量/累计值受服务端上限约束。
   */
  static async submit(userId, { taskId, studySeconds, completed }) {
    if (!Number.isInteger(taskId) || taskId <= 0) throw recordError(400, '任务编号无效');

    const [tasks] = await db.query(
      `SELECT t.organizationId, t.status AS taskStatus, c.type AS contentType, c.title, c.summary, c.bodyOrVideoUrl
       FROM learning_tasks t
       JOIN contents c ON t.contentId = c.id
       WHERE t.id = ?`,
      [taskId]
    );
    const task = tasks[0];
    if (!task) throw recordError(404, '学习任务不存在');
    if (task.taskStatus !== 'published') throw recordError(403, '该任务尚未发布或已关闭');

    // 任务归属校验：用户组织必须在任务下发组织的子树内（任务下发给本级或上级）
    const [users] = await db.query('SELECT organizationId FROM users WHERE id = ?', [userId]);
    const userOrgId = users[0]?.organizationId;
    if (!userOrgId) throw recordError(403, '当前账号未分配组织，无法提交学习记录');
    const allowedOrgs = await OrganizationService.getDescendantIds(task.organizationId);
    if (!allowedOrgs.map(Number).includes(Number(userOrgId))) {
      throw recordError(403, '该任务未下发给当前用户所在组织');
    }

    const [existing] = await db.query(
      'SELECT id, status, studySeconds FROM learning_records WHERE userId = ? AND taskId = ?',
      [userId, taskId]
    );

    const prev = Number(existing[0]?.studySeconds) || 0;
    const requiredSeconds = requiredStudySeconds(task);
    // 服务端校验并规范化上报秒数（非法输入抛 400）
    const seconds = validateReportedSeconds({
      reported: studySeconds,
      previous: prev,
      requiredSeconds,
      contentType: task.contentType,
    });

    const videoEnded = task.contentType === 'video' && completed;
    const alreadyDone = existing[0]?.status === 'completed';
    const done = alreadyDone || shouldComplete({
      ...task,
      studySeconds: seconds,
      requiredSeconds,
      videoEnded,
    }) || (Boolean(completed) && task.contentType !== 'video' && seconds >= requiredSeconds);
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
