/**
 * 为批量党员 member001-100 生成差异化学习记录（learning_records）。
 * 每个组织 10 名党员，按角色分配：
 *   标兵 2 人(20%) - 完成本组织全部已发布任务
 *   合格 4 人(40%) - 完成约 70% 任务，其余进行中
 *   落后 3 人(30%) - 完成约 40% 任务，其余进行中或未学习
 *   未开始 1 人(10%) - 不生成任何记录
 * 特性：可重复执行（INSERT IGNORE 幂等，不覆盖已有记录）；
 *       现有记录（李四等）完全保留；使用固定随机种子，结果可复现。
 */
require('dotenv').config();
const mysql = require('mysql2/promise');
const { requiredStudySeconds } = require('./src/services/studyDuration');

// ---- 可复现伪随机 ----
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(arr, rand) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const ROLE_LABELS = { star: '标兵', pass: '合格', lag: '落后', none: '未开始' };

async function main() {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'party_school',
    charset: 'utf8mb4',
    timezone: 'Z',
  });

  // 1. 目标用户（member001-100）
  const [users] = await db.query(
    "SELECT id, username, organizationId FROM users WHERE username LIKE 'member%' ORDER BY username"
  );
  // 2. 已发布任务及其内容类型
  const [tasks] = await db.query(
    `SELECT t.id, t.organizationId, t.deadline, c.type AS contentType,
            c.title, c.summary, c.bodyOrVideoUrl
     FROM learning_tasks t JOIN contents c ON c.id = t.contentId
     WHERE t.status = 'published'
     ORDER BY t.organizationId, t.id`
  );
  // 3. 已有记录集合（幂等：跳过这些）
  const [existing] = await db.query('SELECT userId, taskId FROM learning_records');
  const existingSet = new Set(existing.map(r => `${r.userId}:${r.taskId}`));

  const tasksByOrg = new Map();
  for (const t of tasks) {
    if (!tasksByOrg.has(t.organizationId)) tasksByOrg.set(t.organizationId, []);
    tasksByOrg.get(t.organizationId).push(t);
  }
  const usersByOrg = new Map();
  for (const u of users) {
    if (!usersByOrg.has(u.organizationId)) usersByOrg.set(u.organizationId, []);
    usersByOrg.get(u.organizationId).push(u);
  }

  const rand = mulberry32(20260826);
  const now = new Date();
  const roleCounts = { star: 0, pass: 0, lag: 0, none: 0 };
  let inserted = 0;
  let skippedExisting = 0;
  const orgReports = [];

  for (const [orgId, orgTasks] of tasksByOrg) {
    const orgUsers = usersByOrg.get(orgId) || [];
    const n = orgTasks.length;
    const shuffledTasks = shuffle([...orgTasks], rand);

    // 每个任务分配完成/进行中
    const starDone = shuffledTasks.slice(); // 全部
    const passDoneCount = Math.ceil(n * 0.7);
    const lagDoneCount = Math.max(0, Math.floor(n * 0.4));
    const passDone = shuffledTasks.slice(0, passDoneCount);
    const lagDone = shuffledTasks.slice(0, lagDoneCount);
    const passOngoing = shuffledTasks.slice(passDoneCount);
    const lagOngoing = shuffledTasks.slice(lagDoneCount, lagDoneCount + Math.max(1, Math.floor((n - lagDoneCount) / 2)));

    for (const [idx, u] of orgUsers.entries()) {
      const role = idx < 2 ? 'star' : idx < 6 ? 'pass' : idx < 9 ? 'lag' : 'none';
      roleCounts[role] += 1;
      if (role === 'none') continue; // 未开始：不生成记录

      let doneTasks, ongoingTasks;
      if (role === 'star') { doneTasks = starDone; ongoingTasks = []; }
      else if (role === 'pass') { doneTasks = passDone; ongoingTasks = passOngoing; }
      else { doneTasks = lagDone; ongoingTasks = lagOngoing; }

      const recordRows = [];
      for (const task of doneTasks) {
        const required = task.contentType === 'video' ? 0 : requiredStudySeconds(task);
        const studySeconds = task.contentType === 'video'
          ? Math.round(600 + rand() * 480)          // 视频：10-18 分钟
          : Math.round(required * (1.3 + rand() * 1.7)) + 5; // 文章：达标以上
        const deadline = new Date(task.deadline);
        const latest = new Date(Math.min(deadline.getTime(), now.getTime()));
        const backDays = 1 + rand() * 20;
        const completedAt = new Date(latest.getTime() - backDays * 86400000);
        recordRows.push({ taskId: task.id, studySeconds, status: 'completed', completedAt });
      }
      for (const task of ongoingTasks) {
        const required = task.contentType === 'video' ? 0 : requiredStudySeconds(task);
        const studySeconds = task.contentType === 'video'
          ? Math.round(60 + rand() * 300)           // 视频：看了一部分
          : Math.max(5, Math.round(required * (0.15 + rand() * 0.5))); // 文章：未达标
        recordRows.push({ taskId: task.id, studySeconds, status: 'inProgress', completedAt: null });
      }

      for (const r of recordRows) {
        const key = `${u.id}:${r.taskId}`;
        if (existingSet.has(key)) { skippedExisting += 1; continue; }
        const completedAtSql = r.completedAt
          ? r.completedAt.toISOString().slice(0, 19).replace('T', ' ')
          : null;
        const [res] = await db.query(
          'INSERT IGNORE INTO learning_records (userId, taskId, studySeconds, status, completedAt) VALUES (?, ?, ?, ?, ?)',
          [u.id, r.taskId, r.studySeconds, r.status, completedAtSql]
        );
        if (res.affectedRows > 0) inserted += 1;
        else skippedExisting += 1;
      }
    }

    orgReports.push({ orgId, tasks: n, users: orgUsers.length });
  }

  const [after] = await db.query('SELECT COUNT(*) AS c FROM learning_records');
  const [byStatus] = await db.query('SELECT status, COUNT(*) AS c FROM learning_records GROUP BY status');

  console.log('===== seed-learning-records 运行结果 =====');
  console.log('角色分布:', JSON.stringify(roleCounts));
  console.log('新增记录:', inserted, '| 跳过已有:', skippedExisting);
  console.log('learning_records 总数:', after[0].c);
  console.log('按状态:', JSON.stringify(byStatus));
  console.log('组织任务数:', JSON.stringify(orgReports));
  await db.end();
}

main().catch(e => { console.error('ERR', e.message); process.exit(1); });
