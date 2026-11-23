/**
 * 性能压测数据种子脚本（可重复执行）。
 *
 * - 创建/重建独立测试库 party_school_perf（绝不触碰 party_school 生产库）
 * - 表结构来自 sql/init.sql（库名与种子密码哈希动态替换）
 * - 使用确定性伪随机（固定种子）保证每次生成的数据完全一致，压测结果可复现
 *
 * 用法：node perf/seed-perf.js
 */
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const PERF_DB = 'party_school_perf';

// ---------------- 确定性伪随机 ----------------
function makeRng(seed) {
  let state = seed >>> 0;
  return function rng() {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
const rng = makeRng(20260101);
const rand = () => rng();
const randInt = (min, max) => min + Math.floor(rand() * (max - min + 1));
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

// ---------------- 规模配置 ----------------
const SCALE = {
  committees: 4,        // 新增党委（挂在种子根组织下）
  generalBranchPer: 6,  // 每个党委下党总支数
  branchPer: 4,         // 每个党总支下党支部数
  members: 3000,        // 党员总数
  contents: 240,        // 学习内容数
  tasksPerBranch: 3,    // 每个支部任务数
  tasksPerGB: 5,        // 每个党总支任务数
  tasksPerCommittee: 5, // 每个党委任务数
};
const MONTHS_BACK = 6;

function utcDateAgo(days) {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 19).replace('T', ' ');
}

async function chunkInsert(conn, table, columns, rows) {
  const CHUNK = 500;
  const colSql = columns.join(', ');
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const values = slice.map(() => `(${columns.map(() => '?').join(', ')})`).join(', ');
    await conn.query(`INSERT INTO ${table} (${colSql}) VALUES ${values}`, slice.flat());
  }
}

async function main() {
  if (!process.env.DB_PASSWORD) throw new Error('缺少 DB_PASSWORD，请在 server/.env 配置');
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    multipleStatements: true,
    charset: 'utf8mb4',
  });

  console.log(`重建独立测试库 ${PERF_DB} ...`);
  await conn.query(`DROP DATABASE IF EXISTS ${PERF_DB}`);
  await conn.query(`CREATE DATABASE ${PERF_DB} DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);

  // 表结构：复用 sql/init.sql，仅替换库名与种子密码哈希
  let schema = fs.readFileSync(path.join(__dirname, '..', 'sql', 'init.sql'), 'utf8');
  schema = schema.split('party_school').join(PERF_DB);
  const seedHash = await bcrypt.hash('perf-seed-password-2026', 10);
  schema = schema.split('__SEED_PASSWORD_HASH__').join(seedHash);
  await conn.query(schema);

  await conn.query(`USE ${PERF_DB}`);
  const perfConn = conn; // 后续都走 USE 之后的连接

  // ---------------- 组织树 ----------------
  // 种子组织 1-10 已存在。新增：党委 11+，党总支，党支部
  const orgRows = [];
  let nextOrgId = 11;
  const committeeIds = [];
  for (let i = 0; i < SCALE.committees; i += 1) {
    committeeIds.push(nextOrgId);
    orgRows.push([nextOrgId, `压测党委${i + 1}`, 'committee', 1, utcDateAgo(randInt(400, 700))]);
    nextOrgId += 1;
  }
  const generalBranchIds = [];
  for (const cId of committeeIds) {
    for (let i = 0; i < SCALE.generalBranchPer; i += 1) {
      generalBranchIds.push(nextOrgId);
      orgRows.push([nextOrgId, `党总支${nextOrgId}`, 'generalBranch', cId, utcDateAgo(randInt(200, 400))]);
      nextOrgId += 1;
    }
  }
  const branchIds = [];
  for (const gId of generalBranchIds) {
    for (let i = 0; i < SCALE.branchPer; i += 1) {
      branchIds.push(nextOrgId);
      orgRows.push([nextOrgId, `党支部${nextOrgId}`, 'branch', gId, utcDateAgo(randInt(60, 200))]);
      nextOrgId += 1;
    }
  }
  await chunkInsert(perfConn, 'organizations',
    ['id', 'name', 'type', 'parentId', 'createdAt'], orgRows);
  const allBranchIds = branchIds.concat([4, 7, 10]); // 含种子支部
  console.log(`组织：${orgRows.length + 10} 个（支部 ${allBranchIds.length}）`);

  // ---------------- 用户 ----------------
  // 每个新支部 1 名书记 + 党员均摊到各支部；种子用户 1-4 已存在
  const userRows = [];
  let nextUserId = 5;
  const secretaryByBranch = {};
  for (const bId of branchIds.concat(generalBranchIds)) {
    secretaryByBranch[bId] = nextUserId;
    userRows.push([nextUserId, `perf_sec_${bId}`, seedHash, `书记${bId}`, 'secretary', bId, 1, utcDateAgo(randInt(100, 400))]);
    nextUserId += 1;
  }
  const memberIds = [];
  const memberBranch = {};
  for (let i = 0; i < SCALE.members; i += 1) {
    const bId = pick(allBranchIds);
    memberIds.push(nextUserId);
    memberBranch[nextUserId] = bId;
    userRows.push([nextUserId, `perf_mem_${i}`, seedHash, `党员${i}`, 'member', bId, 1, utcDateAgo(randInt(10, 360))]);
    nextUserId += 1;
  }
  await chunkInsert(perfConn, 'users',
    ['id', 'username', 'password', 'realName', 'role', 'organizationId', 'status', 'createdAt'], userRows);
  console.log(`用户：${userRows.length + 4} 个（党员 ${memberIds.length}）`);

  // ---------------- 学习内容 ----------------
  // init.sql 已占用 id 1-4，压测内容从 100 号起编
  const CONTENT_ID_START = 100;
  const contentRows = [];
  for (let i = 0; i < SCALE.contents; i += 1) {
    const id = CONTENT_ID_START + i;
    const isVideo = i % 4 === 0;
    contentRows.push([
      id, `压测内容${id}`, isVideo ? 'video' : 'article',
      null,
      isVideo ? `/uploads/content/perf-${id}.mp4` : `<p>${'压测正文内容。'.repeat(50)}</p>`,
      isVideo ? 300 + randInt(0, 600) : null,
      `压测内容${id}摘要`, null, 1, 'published', 1, utcDateAgo(randInt(30, 170)),
    ]);
  }
  await chunkInsert(perfConn, 'contents',
    ['id', 'title', 'type', 'coverUrl', 'bodyOrVideoUrl', 'durationSeconds', 'summary', 'tags', 'isPublic', 'status', 'createdBy', 'createdAt'],
    contentRows);
  console.log(`内容：${contentRows.length} 条（全部已发布）`);

  // ---------------- 学习任务 ----------------
  // 任务归属三级组织；createdAt 分散在近 6 个月（影响完成率时间窗口径）
  const taskRows = [];
  const tasksByOrg = {};
  let nextTaskId = 1;
  const addTasks = (orgIds, count) => {
    for (const orgId of orgIds) {
      tasksByOrg[orgId] = [];
      for (let i = 0; i < count; i += 1) {
        const published = rand() > 0.1;
        taskRows.push([
          nextTaskId, `压测任务${nextTaskId}`, randInt(CONTENT_ID_START, CONTENT_ID_START + SCALE.contents - 1), orgId,
          utcDateAgo(randInt(5, 30)), null,
          published ? 'published' : 'draft', 1, utcDateAgo(randInt(1, MONTHS_BACK * 30)),
        ]);
        if (published) tasksByOrg[orgId].push(nextTaskId);
        nextTaskId += 1;
      }
    }
  };
  addTasks(committeeIds, SCALE.tasksPerCommittee);
  addTasks(generalBranchIds, SCALE.tasksPerGB);
  addTasks(allBranchIds, SCALE.tasksPerBranch);
  await chunkInsert(perfConn, 'learning_tasks',
    ['id', 'title', 'contentId', 'organizationId', 'deadline', 'description', 'status', 'createdBy', 'createdAt'],
    taskRows);
  const publishedTasks = taskRows.filter(r => r[6] === 'published').length;
  console.log(`任务：${taskRows.length} 个（已发布 ${publishedTasks}）`);

  // 组织祖先映射（用于生成"上级任务"的学习记录）
  const parentById = new Map(orgRows.map(r => [r[0], r[3]]));
  parentById.set(1, null); parentById.set(4, 3); parentById.set(5, 4); parentById.set(6, 4);
  parentById.set(7, 3); parentById.set(8, 2); parentById.set(9, 1); parentById.set(10, 9);
  parentById.set(2, 1); parentById.set(3, 2);
  function ancestorsOf(orgId) {
    const ids = [];
    let cur = orgId;
    while (cur != null) {
      ids.push(cur);
      cur = parentById.get(cur);
    }
    return ids;
  }

  // ---------------- 学习记录 ----------------
  // 本级任务 80% 有记录（60% 完成），上级任务 40% 有记录（50% 完成）
  const recordRows = [];
  for (const userId of memberIds) {
    const ownOrg = memberBranch[userId];
    const chain = ancestorsOf(ownOrg);
    chain.forEach((orgId, depth) => {
      const tasks = tasksByOrg[orgId] || [];
      const probability = depth === 0 ? 0.8 : 0.4;
      const completeProbability = depth === 0 ? 0.6 : 0.5;
      for (const taskId of tasks) {
        if (rand() > probability) continue;
        const completed = rand() < completeProbability;
        const seconds = completed ? randInt(300, 3000) : randInt(10, 280);
        const createdDaysAgo = randInt(1, MONTHS_BACK * 30 - 1);
        recordRows.push([
          userId, taskId, seconds,
          utcDateAgo(createdDaysAgo),                       // lastActiveAt
          utcDateAgo(createdDaysAgo),                       // sessionStartedAt
          0,                                                // sessionBaseSeconds
          completed ? 'completed' : 'inProgress',
          completed ? utcDateAgo(createdDaysAgo) : null,    // completedAt
          utcDateAgo(createdDaysAgo),                       // createdAt
        ]);
      }
    });
  }
  await chunkInsert(perfConn, 'learning_records',
    ['userId', 'taskId', 'studySeconds', 'lastActiveAt', 'sessionStartedAt', 'sessionBaseSeconds', 'status', 'completedAt', 'createdAt'],
    recordRows);
  console.log(`学习记录：${recordRows.length} 条`);

  // ---------------- 考试记录（legacy exam_records）----------------
  const examRows = [];
  for (const userId of memberIds) {
    const exams = randInt(1, 3);
    for (let i = 0; i < exams; i += 1) {
      const score = randInt(40, 100);
      examRows.push([
        userId, pick(taskRows.filter(r => r[6] === 'published'))[0],
        score, 100, null,
        utcDateAgo(randInt(10, 360)), utcDateAgo(randInt(10, 360)),
      ]);
    }
  }
  await chunkInsert(perfConn, 'exam_records',
    ['userId', 'taskId', 'score', 'totalScore', 'answers', 'submittedAt', 'createdAt'],
    examRows);
  console.log(`考试记录：${examRows.length} 条`);

  // ---------------- 试卷 / 测评 / 交卷记录 ----------------
  const paperRows = [];
  for (let i = 1; i <= 20; i += 1) {
    paperRows.push([i, `压测试卷${i}`, null, null, 60, 100, 60, 2, 1, utcDateAgo(300)]);
  }
  await chunkInsert(perfConn, 'papers',
    ['id', 'title', 'category', 'description', 'duration', 'totalScore', 'passScore', 'status', 'createdBy', 'createdAt'],
    paperRows);

  const assessmentRows = [];
  const assessmentsByOrg = {};
  let assessmentId = 1;
  for (const gId of generalBranchIds) {
    assessmentsByOrg[gId] = [];
    for (let i = 0; i < 2; i += 1) {
      assessmentRows.push([
        assessmentId, randInt(1, 20), gId, i === 0 ? 'quiz' : 'exam',
        `压测测评${assessmentId}`, utcDateAgo(randInt(5, 20)), 100, 60,
        JSON.stringify([]), 1, utcDateAgo(randInt(30, 160)),
      ]);
      assessmentsByOrg[gId].push(assessmentId);
      assessmentId += 1;
    }
  }
  await chunkInsert(perfConn, 'assessments',
    ['id', 'paperId', 'organizationId', 'kind', 'title', 'deadline', 'totalScore', 'passScore', 'questions', 'createdBy', 'createdAt'],
    assessmentRows);

  const attemptRows = [];
  for (const userId of memberIds) {
    const ownOrg = memberBranch[userId];
    const gbId = parentById.get(ownOrg);
    const ids = assessmentsByOrg[gbId] || [];
    for (const aId of ids) {
      if (rand() > 0.6) continue;
      const score = randInt(35, 100);
      const daysAgo = randInt(10, 300);
      attemptRows.push([
        aId, userId, score, score, 100,
        score >= 60 ? 1 : 0, JSON.stringify([]), utcDateAgo(daysAgo),
      ]);
    }
  }
  await chunkInsert(perfConn, 'assessment_attempts',
    ['assessmentId', 'userId', 'score', 'earnedPoints', 'totalScore', 'passed', 'results', 'submittedAt'],
    attemptRows);
  console.log(`测评交卷：${attemptRows.length} 条`);

  // ---------------- 完成校验 ----------------
  const [counts] = await perfConn.query(`SELECT
    (SELECT COUNT(*) FROM organizations) orgs,
    (SELECT COUNT(*) FROM users) users,
    (SELECT COUNT(*) FROM learning_tasks) tasks,
    (SELECT COUNT(*) FROM learning_records) records,
    (SELECT COUNT(*) FROM exam_records) exams`);
  console.log('\n库内数据校验:', counts[0]);
  await conn.end();
  console.log(`\n种子完成。压测请使用 DB_NAME=${PERF_DB}。`);
}

main().catch((err) => {
  console.error('种子失败:', err);
  process.exit(1);
});
