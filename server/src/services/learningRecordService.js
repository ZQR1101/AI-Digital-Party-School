const db = require('../config/db');
const OrganizationService = require('./organizationService');
const {
  requiredStudySeconds, videoRequiredSeconds, shouldComplete, validateReportedSeconds,
  creditableSeconds, deltaCapSeconds, MIN_COMPLETION_SECONDS, SESSION_IDLE_TIMEOUT_SECONDS,
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
      `SELECT t.organizationId, t.status AS taskStatus, c.type AS contentType, c.durationSeconds, c.title, c.summary, c.bodyOrVideoUrl
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

    // 应学/应看时长：文章按字数核算，视频按真实视频时长核算（未知时长走保守回退）
    const requiredSeconds = task.contentType === 'video'
      ? videoRequiredSeconds(task)
      : requiredStudySeconds(task);
    // 数值合法性校验（非法输入抛 400）
    const incoming = validateReportedSeconds({ reported: studySeconds, contentType: task.contentType });
    const cap = deltaCapSeconds({ contentType: task.contentType, requiredSeconds });

    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      // 行锁串行化并发心跳：读-算-写在同一事务内完成
      const [existing] = await conn.query(
        'SELECT id, status, studySeconds, lastActiveAt, sessionStartedAt, sessionBaseSeconds FROM learning_records WHERE userId = ? AND taskId = ? FOR UPDATE',
        [userId, taskId]
      );
      const row = existing[0] || null;

      const now = Date.now();
      const prev = Number(row?.studySeconds) || 0;
      // 会话闲置超时：超过 SESSION_IDLE_TIMEOUT_SECONDS 无有效心跳即视为离开，
      // 重新提交时建立新会话（保留已获合法累计时长，离线墙钟时间不计入新上限）
      const lastActiveMs = row?.lastActiveAt ? new Date(row.lastActiveAt).getTime() : null;
      const idleSeconds = lastActiveMs ? Math.floor((now - lastActiveMs) / 1000) : Infinity;
      const sessionExpired = idleSeconds > SESSION_IDLE_TIMEOUT_SECONDS;
      // 会话判定：
      //  - 有效会话（未超时且有 sessionStartedAt）：沿用原基线与开始时间；
      //  - 旧行缺失会话列：回溯到最近心跳重建（基线取当前累计，保证连续性）；
      //  - 全新记录/超时：此刻建立新会话，基线快照为当前合法累计。
      const hasLiveSession = Boolean(row) && !sessionExpired && row.sessionStartedAt != null;
      const sessionStartMs = hasLiveSession
        ? new Date(row.sessionStartedAt).getTime()
        : (!row || sessionExpired ? now : (lastActiveMs ?? now));
      const sessionBaseSeconds = hasLiveSession
        ? Math.max(0, Math.floor(Number(row.sessionBaseSeconds) || 0))
        : prev;
      const sessionElapsedSeconds = Math.max(0, Math.floor((now - sessionStartMs) / 1000));

      // 客户端计数可能回退（换设备/重开页面），增量取非负；累计值只增不减
      const delta = Math.max(0, incoming - prev);
      const credit = creditableSeconds({
        requestedDelta: delta,
        prevSeconds: prev,
        sessionBaseSeconds,
        sessionElapsedSeconds,
        deltaCapSeconds: cap,
      });
      const seconds = prev + credit;

      const videoEnded = task.contentType === 'video' && completed;
      const alreadyDone = row?.status === 'completed';
      // 完成门槛：文章按应学时长、视频按应看时长（真实视频时长核算），且均不低于最小服务端累计时长
      const completionFloor = Math.max(requiredSeconds, MIN_COMPLETION_SECONDS);
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
          'UPDATE learning_records SET studySeconds = ?, lastActiveAt = ?, sessionStartedAt = ?, sessionBaseSeconds = ?, status = ?, completedAt = COALESCE(?, completedAt) WHERE id = ?',
          [seconds, nowDate, sessionStartedAt, sessionBaseSeconds, newStatus, completedAt, row.id]
        );
      } else {
        await conn.query(
          'INSERT INTO learning_records (userId, taskId, studySeconds, lastActiveAt, sessionStartedAt, sessionBaseSeconds, status, completedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [userId, taskId, seconds, nowDate, sessionStartedAt, sessionBaseSeconds, newStatus, completedAt]
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
