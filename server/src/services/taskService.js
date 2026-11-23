const db = require('../config/db');
const OrganizationService = require('./organizationService');
const { countStudyChars, memberProgress, requiredStudySeconds } = require('./studyDuration');
const { withPlayableVideo } = require('../utils/playableVideo');

const COMPLETION_SQL = `(SELECT ROUND(IFNULL(
    100 * SUM(CASE WHEN lr.status = 'completed' THEN 1 ELSE 0 END) / NULLIF(COUNT(u.id), 0),
    0
  ))
  FROM users u
  LEFT JOIN learning_records lr ON lr.userId = u.id AND lr.taskId = t.id
  WHERE u.organizationId = t.organizationId AND u.status = 1)`;

function displayStatus(row) {
  const rate = Number(row.completionRate) || 0;
  if (rate >= 100) return 'completed';
  if (row.deadline && new Date(row.deadline).getTime() < Date.now() && rate < 100) return 'overdue';
  return 'inProgress';
}

function dedupeMemberTasks(rows) {
  const selected = new Map();
  for (const row of rows) {
    const key = `${row.contentId}::${row.title}`;
    if (!selected.has(key)) selected.set(key, row);
  }
  return [...selected.values()];
}

class TaskService {
  static async list({ page = 1, pageSize = 10, keyword, organizationId, organizationIds, status }) {
    let sql = `SELECT t.*, c.title as contentTitle, c.type as contentType, c.coverUrl, c.bodyOrVideoUrl,
                      o.name as organizationName, u.realName as creatorName,
                      ${COMPLETION_SQL} as completionRate
               FROM learning_tasks t
               LEFT JOIN contents c ON t.contentId = c.id
               LEFT JOIN organizations o ON t.organizationId = o.id
               LEFT JOIN users u ON t.createdBy = u.id WHERE 1=1`;
    const params = [];
    if (keyword) { sql += ' AND (t.title LIKE ? OR c.title LIKE ?)'; params.push(`%${keyword}%`, `%${keyword}%`); }
    if (organizationId) { sql += ' AND t.organizationId = ?'; params.push(organizationId); }
    const scopedIds = Array.isArray(organizationIds)
      ? [...new Set(organizationIds.map(Number).filter(Boolean))]
      : null;
    if (scopedIds) {
      // 明确三态：null=不限制；非空数组=限定范围；空数组=无任何可见范围，直接返回空
      if (!scopedIds.length) return { total: 0, list: [] };
      sql += ` AND t.organizationId IN (${scopedIds.map(() => '?').join(',')})`;
      params.push(...scopedIds);
    }
    if (status && ['draft', 'published'].includes(status)) {
      sql += ' AND t.status = ?';
      params.push(status);
    }

    const [countRows] = await db.query(`SELECT COUNT(*) as total FROM (${sql}) counted`, params);
    sql += ' ORDER BY t.id DESC LIMIT ? OFFSET ?';
    params.push(Number(pageSize), (page - 1) * pageSize);
    const [rows] = await db.query(sql, params);
    const list = rows.map((row) => ({
      ...row,
      completionRate: Number(row.completionRate) || 0,
      displayStatus: displayStatus(row),
    }));
    return { total: countRows[0].total, list };
  }

  static async getById(id, { withCompletion = true } = {}) {
    const rateSelect = withCompletion
      ? `${COMPLETION_SQL} as completionRate`
      : '0 as completionRate';
    const [rows] = await db.query(
      `SELECT t.*, c.title as contentTitle, c.type as contentType, c.bodyOrVideoUrl, c.coverUrl, c.summary,
              o.name as organizationName, u.realName as creatorName,
              ${rateSelect}
       FROM learning_tasks t
       LEFT JOIN contents c ON t.contentId = c.id
       LEFT JOIN organizations o ON t.organizationId = o.id
       LEFT JOIN users u ON t.createdBy = u.id
       WHERE t.id = ?`, [id]
    );
    if (!rows[0]) return null;
    return withPlayableVideo({
      ...rows[0],
      completionRate: Number(rows[0].completionRate) || 0,
      displayStatus: displayStatus(rows[0]),
    }, 'contentType');
  }

  static async getByIdForUser(id, userId) {
    const task = await this.getById(id, { withCompletion: false });
    if (!task) return null;

    // 组织授权：仅允许查看下发给本人所属组织或其上级组织、且已发布的任务。
    // 与 getUserTasks 的可见范围保持一致，防止通过直接猜 taskId 越权读取。
    if (task.status !== 'published') return null;
    const [users] = await db.query('SELECT organizationId FROM users WHERE id = ?', [userId]);
    const userOrgId = users[0]?.organizationId;
    if (!userOrgId) return null;
    const permitted = await OrganizationService.getAncestorIds(userOrgId);
    if (!permitted.map(Number).includes(Number(task.organizationId))) return null;

    const [records] = await db.query(
      'SELECT studySeconds, status FROM learning_records WHERE userId = ? AND taskId = ?',
      [userId, id]
    );
    const record = records[0] || { studySeconds: 0, status: 'pending' };
    const requiredSeconds = requiredStudySeconds(task);
    return withPlayableVideo({
      ...task,
      studySeconds: Number(record.studySeconds) || 0,
      myStatus: record.status || 'pending',
      wordCount: countStudyChars(task.bodyOrVideoUrl)
        || countStudyChars([task.title, task.summary].filter(Boolean).join('\n')),
      requiredSeconds,
      progress: memberProgress(record.status, record.studySeconds, requiredSeconds),
    }, 'contentType');
  }

  /** 获取当前党员的任务列表，包含本级及上级组织下发的任务 */
  static async getUserTasks(userId, { page = 1, pageSize = 10, status }) {
    const [users] = await db.query('SELECT organizationId FROM users WHERE id = ?', [userId]);
    const userOrgId = users[0]?.organizationId;
    if (!userOrgId) return { total: 0, list: [] };

    const orgIds = await OrganizationService.getAncestorIds(userOrgId);
    if (!orgIds.length) return { total: 0, list: [] };
    const placeholders = orgIds.map(() => '?').join(',');

    let sql = `SELECT lt.id as taskId, lt.title, lt.deadline, lt.organizationId,
                      lr.studySeconds, lr.status as progress, lr.completedAt,
                      c.id as contentId, c.title as contentTitle, c.type as contentType, c.coverUrl,
                      c.summary, c.bodyOrVideoUrl
               FROM learning_tasks lt
               JOIN contents c ON lt.contentId = c.id
               LEFT JOIN learning_records lr ON lr.taskId = lt.id AND lr.userId = ?
               WHERE lt.status = 'published' AND lt.organizationId IN (${placeholders})`;
    const params = [userId, ...orgIds];

    if (status === 'unfinished') { sql += " AND (lr.status IS NULL OR lr.status != 'completed')"; }
    else if (status === 'finished') { sql += " AND lr.status = 'completed'"; }

    sql += ' ORDER BY (lt.organizationId = ?) DESC, lt.id DESC';
    params.push(userOrgId);

    const [rows] = await db.query(sql, params);
    const unique = dedupeMemberTasks(rows);
    const start = (Number(page) - 1) * Number(pageSize);
    const list = unique.slice(start, start + Number(pageSize)).map(r => {
      const requiredSeconds = requiredStudySeconds({
        contentType: r.contentType,
        title: r.contentTitle || r.title,
        summary: r.summary,
        bodyOrVideoUrl: r.bodyOrVideoUrl,
      });
      return {
        taskId: r.taskId,
        title: r.title,
        contentId: r.contentId,
        contentTitle: r.contentTitle,
        contentType: r.contentType,
        coverUrl: r.coverUrl,
        deadline: r.deadline,
        requiredSeconds,
        progress: memberProgress(r.progress, r.studySeconds, requiredSeconds),
        status: r.progress === 'completed' ? 'completed' : (Number(r.studySeconds) > 0 ? 'inProgress' : 'pending')
      };
    });

    return { total: unique.length, list };
  }

  static async create(data) {
    const { title, contentId, organizationId, deadline, description, status, createdBy } = data;
    const [result] = await db.query(
      'INSERT INTO learning_tasks (title, contentId, organizationId, deadline, description, status, createdBy) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [title, contentId, organizationId, deadline || null, description || null, status || 'draft', createdBy || null]
    );
    return result.insertId;
  }

  static async update(id, data) {
    const { title, contentId, organizationId, deadline, description, status } = data;
    const sets = [], params = [];
    if (title !== undefined) { sets.push('title=?'); params.push(title); }
    if (contentId !== undefined) { sets.push('contentId=?'); params.push(contentId); }
    if (organizationId !== undefined) { sets.push('organizationId=?'); params.push(organizationId); }
    if (deadline !== undefined) { sets.push('deadline=?'); params.push(deadline); }
    if (description !== undefined) { sets.push('description=?'); params.push(description); }
    if (status !== undefined) { sets.push('status=?'); params.push(status); }
    if (sets.length === 0) return;
    params.push(id);
    await db.query(`UPDATE learning_tasks SET ${sets.join(',')} WHERE id=?`, params);
  }

  static async delete(id) {
    await db.query('DELETE FROM learning_tasks WHERE id = ?', [id]);
  }
}

TaskService.memberProgress = memberProgress;
TaskService.dedupeMemberTasks = dedupeMemberTasks;

module.exports = TaskService;
