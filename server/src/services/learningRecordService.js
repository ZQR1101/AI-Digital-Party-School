const db = require('../config/db');
const OrganizationService = require('./organizationService');
const {
  requiredStudySeconds, shouldComplete, validateReportedSeconds,
  creditableSeconds, deltaCapSeconds, MIN_COMPLETION_SECONDS,
} = require('./studyDuration');

function recordError(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}

class LearningRecordService {
  /**
   * 提交学习记录（事务 + 行锁）。
   * 真实性校验：
   *  1) 任务必须存在、已发布，且下发给当前用户所属组织或其上级组织；
   *  2) 上报秒数必须为合法有限数；
   *  3) 学习会话由服务端建立（sessionStartedAt），累计计入时长严格受
   *     「服务端会话总经过时间 + 一次性宽限」约束——连续快速请求无法重复领取宽限；
   *  4) 并发心跳用 SELECT ... FOR UPDATE 行锁串行化，防止计时状态互相覆盖。
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

    const requiredSeconds = requiredStudySeconds(task);
    // 数值合法性校验（非法输入抛 400）
    const incoming = validateReportedSeconds({ reported: studySeconds, contentType: task.contentType });
    const cap = deltaCapSeconds({ contentType: task.contentType, requiredSeconds });

    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      // 行锁串行化并发心跳：读-算-写在同一事务内完成
      const [existing] = await conn.query(
        'SELECT id, status, studySeconds, lastActiveAt, sessionStartedAt FROM learning_records WHERE userId = ? AND taskId = ? FOR UPDATE',
        [userId, taskId]
      );
      const row = existing[0] || null;

      const now = Date.now();
      const prev = Number(row?.studySeconds) || 0;
      // 会话基线：优先已有 sessionStartedAt；旧行缺失则回溯到最近心跳（保证连续性）；
      // 全新记录由服务端此刻建立会话
      const sessionStartMs = row?.sessionStartedAt
        ? new Date(row.sessionStartedAt).getTime()
        : (row?.lastActiveAt ? new Date(row.lastActiveAt).getTime() : now);
      const sessionElapsedSeconds = Math.max(0, Math.floor((now - sessionStartMs) / 1000));

      // 客户端计数可能回退（换设备/重开页面），增量取非负；累计值只增不减
      const delta = Math.max(0, incoming - prev);
      const credit = creditableSeconds({
        requestedDelta: delta,
        prevSeconds: prev,
        sessionElapsedSeconds,
        deltaCapSeconds: cap,
      });
      const seconds = prev + credit;

      const videoEnded = task.contentType === 'video' && completed;
      const alreadyDone = row?.status === 'completed';
      // 完成门槛：累计时长需达到 min(required, MIN_COMPLETION_SECONDS) 以上（video 无字数基准时取 MIN）
      const completionFloor = task.contentType === 'video'
        ? MIN_COMPLETION_SECONDS
        : Math.max(requiredSeconds, MIN_COMPLETION_SECONDS);
      const done = alreadyDone
        || (seconds >= completionFloor && shouldComplete({
          ...task,
          studySeconds: seconds,
          requiredSeconds,
          videoEnded,
        }))
        || (Boolean(completed) && task.contentType !== 'video' && seconds >= completionFloor);
      const nowDate = new Date();
      const newStatus = done ? 'completed' : (seconds > 0 ? 'inProgress' : 'pending');
      const completedAt = done ? nowDate : null;
      const sessionStartedAt = new Date(sessionStartMs);

      if (row) {
        await conn.query(
          'UPDATE learning_records SET studySeconds = ?, lastActiveAt = ?, sessionStartedAt = ?, status = ?, completedAt = COALESCE(?, completedAt) WHERE id = ?',
          [seconds, nowDate, sessionStartedAt, newStatus, completedAt, row.id]
        );
      } else {
        await conn.query(
          'INSERT INTO learning_records (userId, taskId, studySeconds, lastActiveAt, sessionStartedAt, status, completedAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [userId, taskId, seconds, nowDate, sessionStartedAt, newStatus, completedAt]
        );
      }
      await conn.commit();

      return {
        studySeconds: seconds,
        creditedSeconds: credit,
        status: newStatus,
        requiredSeconds,
        progress: done ? 100 : Math.min(99, requiredSeconds ? Math.round(seconds / requiredSeconds * 100) : 0),
      };
    } catch (err) {
      await conn.rollback().catch(() => {});
      throw err;
    } finally {
      conn.release();
    }
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
