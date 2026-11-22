/**
 * 为全部学员生成"近期学习数据"，驱动学习画像、薄弱知识点、个性化推荐与 RAG 联动。
 *
 * 覆盖 105 名用户（含 admin / 书记 / 普通党员），生成：
 *   1) 窗口内学习任务（近 30 天创建，来自已发布内容）；
 *   2) learning_records 学习记录（差异化完成度，近 30 天更新，画像可统计）；
 *   3) assessments 测评 + assessment_attempts 作答记录（results 带 category/correct，
 *      直接驱动 weakCategories 薄弱知识点与 recentWrongQuestions）。
 *
 * 特性：
 *   - 可重复执行：全部使用 INSERT IGNORE + 固定唯一键，不覆盖已有数据；
 *   - 差异化画像：按用户 id 稳定分配"标兵/合格/薄弱/未开始"四档，
 *     并为薄弱学员制造集中在少数分类的错题，形成有辨识度的学习画像；
 *   - 固定随机种子，结果可复现；所有时间落在最近 30 天窗口内。
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

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

function beijingDayKey(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(date);
}

function shuffle(arr, rand) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function sqlDate(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

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
  const q = async (sql, params) => (await db.query(sql, params))[0];

  // 画像窗口：北京时间最近 30 天
  const todayKey = beijingDayKey(new Date());
  const midnight = new Date(`${todayKey}T00:00:00+08:00`);
  const windowStart = new Date(midnight.getTime() - 29 * 86400000);
  const nowMs = Date.now();

  const users = await q('SELECT id, username, role, organizationId FROM users ORDER BY id');
  const contents = await q("SELECT id, title, type, summary FROM contents WHERE status = 'published' ORDER BY id");
  const papers = await q('SELECT id, title, totalScore, passScore FROM papers WHERE status = 2 ORDER BY id');
  if (!users.length || !contents.length || !papers.length) {
    throw new Error('需要用户、已发布内容、已发布试卷的基础数据，请先执行 init-db.sql 与 seed-batch-data.js');
  }

  // 组织 -> 祖先组织集合（本组织及上级任务均可见）
  const orgs = await q('SELECT id, parentId FROM organizations');
  const parentOf = new Map(orgs.map(o => [o.id, o.parentId]));
  const ancestorIds = (orgId) => {
    const ids = [];
    let cur = orgId;
    const guard = new Set();
    while (cur != null && !guard.has(cur)) {
      ids.push(cur);
      guard.add(cur);
      cur = parentOf.get(cur);
    }
    return ids;
  };

  const rand = mulberry32(20261122);
  const stats = { tasksCreated: 0, recordsInserted: 0, recordsSkipped: 0,
    assessmentsCreated: 0, attemptsInserted: 0, attemptsSkipped: 0,
    archetypes: { star: 0, pass: 0, weak: 0, none: 0 } };

  // ============ 1. 每个组织补建窗口内近期任务 ============
  // 任务标题带固定前缀，重复执行时按 (title, organizationId) 判定是否已建
  const orgIds = [...new Set(users.map(u => u.organizationId))];
  const tasksByOrg = new Map(); // orgId -> [{id, contentId, type}]
  for (const orgId of orgIds) {
    const existing = await q(
      "SELECT id, contentId FROM learning_tasks WHERE organizationId = ? AND title LIKE '近期专题:%'",
      [orgId]
    );
    if (!existing.length) {
      // 每个组织建 3 个近期任务，均匀取用已发布内容
      const picked = shuffle([...contents], rand).slice(0, Math.min(3, contents.length));
      for (const c of picked) {
        const createdAt = new Date(windowStart.getTime() + 2 * 86400000 + rand() * 3 * 86400000);
        const deadline = new Date(Math.min(nowMs + 5 * 86400000, createdAt.getTime() + 12 * 86400000));
        const title = `近期专题:${c.title}`;
        const [res] = await db.query(
          `INSERT IGNORE INTO learning_tasks
           (title, contentId, organizationId, deadline, description, status, createdBy, createdAt)
           VALUES (?, ?, ?, ?, ?, 'published', 1, ?)`,
          [title, c.id, orgId, sqlDate(deadline), c.summary || c.title, sqlDate(createdAt)]
        );
        if (res.affectedRows) stats.tasksCreated += 1;
      }
    }
    const rows = await q(
      "SELECT id, contentId FROM learning_tasks WHERE organizationId = ? AND title LIKE '近期专题:%' ORDER BY id",
      [orgId]
    );
    tasksByOrg.set(orgId, rows);
  }

  // ============ 2. 为每个人生成学习记录 + 测评记录 ============
  // 已有测评按 (paper, org) 复用，避免重复创建
  const assessmentByPaperOrg = new Map();
  const keyOf = (paperId, orgId) => `${paperId}:${orgId}`;
  const existingAssessments = await q('SELECT id, paperId, organizationId, questions, totalScore, passScore FROM assessments');
  for (const a of existingAssessments) assessmentByPaperOrg.set(keyOf(a.paperId, a.organizationId), a);

  for (const u of users) {
    // 稳定画像分档：按 id 取模，约 20% 标兵 / 40% 合格 / 30% 薄弱 / 10% 未开始
    const bucket = u.id % 10;
    const archetype = bucket < 2 ? 'star' : bucket < 6 ? 'pass' : bucket < 9 ? 'weak' : 'none';
    stats.archetypes[archetype] += 1;

    // 可见任务 = 本组织及祖先组织的近期任务
    const visibleOrgs = ancestorIds(u.organizationId);
    const visibleTasks = [];
    for (const oid of visibleOrgs) {
      for (const t of (tasksByOrg.get(oid) || [])) visibleTasks.push({ ...t, orgId: oid });
    }

    // ---- 学习记录 ----
    const shuffled = shuffle([...visibleTasks], rand);
    let doneCount = 0;
    if (archetype === 'star') doneCount = shuffled.length;
    else if (archetype === 'pass') doneCount = Math.ceil(shuffled.length * 0.7);
    else if (archetype === 'weak') doneCount = Math.max(1, Math.floor(shuffled.length * 0.35));

    for (let i = 0; i < shuffled.length; i++) {
      const task = shuffled[i];
      const done = i < doneCount;
      const daysAgo = 1 + Math.floor(rand() * 25);
      const studiedAt = new Date(nowMs - daysAgo * 86400000);
      const studySeconds = done
        ? Math.round(1800 + rand() * 2700)   // 完成：30-75 分钟
        : Math.round(180 + rand() * 900);    // 进行中：3-18 分钟
      const [res] = await db.query(
        `INSERT IGNORE INTO learning_records
         (userId, taskId, studySeconds, status, completedAt, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [u.id, task.id, studySeconds, done ? 'completed' : 'inProgress',
         done ? sqlDate(studiedAt) : null, sqlDate(studiedAt), sqlDate(studiedAt)]
      );
      if (res.affectedRows) stats.recordsInserted += 1;
      else stats.recordsSkipped += 1;
    }

    // ---- 测评记录（未开始档也生成，保证每人都有学习数据画像）----
    // 每个用户依次做 1-2 份试卷，薄弱学员制造集中在 1-2 个分类的错题
    const paperCount = archetype === 'star' ? 2 : 1;
    const userPapers = shuffle([...papers], rand).slice(0, Math.min(paperCount, papers.length));
    for (const paper of userPapers) {
      let assessment = assessmentByPaperOrg.get(keyOf(paper.id, u.organizationId));
      if (!assessment) {
        // 构造测评（questions 快照从试卷题目生成）
        const paperQuestions = await q(
          `SELECT q.id, q.type, q.title, q.options, q.answer, q.analysis, q.category, pq.score
           FROM paper_questions pq JOIN questions q ON q.id = pq.questionId
           WHERE pq.paperId = ? ORDER BY pq.sort, pq.id`,
          [paper.id]
        );
        const snapshot = paperQuestions.map(row => ({
          id: row.id,
          title: row.title,
          type: row.type,
          options: typeof row.options === 'string' ? JSON.parse(row.options) : row.options,
          category: row.category || null,
          explanation: row.analysis || null,
          score: Number(row.score) || 0,
        }));
        const deadline = new Date(nowMs + 7 * 86400000);
        const [res] = await db.query(
          `INSERT IGNORE INTO assessments
           (paperId, organizationId, kind, title, deadline, totalScore, passScore, questions, createdBy, createdAt)
           VALUES (?, ?, 'quiz', ?, ?, ?, ?, ?, 1, ?)`,
          [paper.id, u.organizationId, paper.title, sqlDate(deadline),
           Number(paper.totalScore) || 100, Number(paper.passScore) || 60,
           JSON.stringify(snapshot), sqlDate(new Date(windowStart.getTime() + 86400000))]
        );
        stats.assessmentsCreated += res.affectedRows;
        assessment = await q(
          'SELECT id, paperId, organizationId, questions, totalScore, passScore FROM assessments WHERE paperId=? AND organizationId=? ORDER BY id LIMIT 1',
          [paper.id, u.organizationId]
        ).then(rows => rows[0]);
        assessmentByPaperOrg.set(keyOf(paper.id, u.organizationId), assessment);
      }

      // 已有的 (assessment,user) 跳过，保证幂等
      const questions = typeof assessment.questions === 'string'
        ? JSON.parse(assessment.questions) : assessment.questions;
      if (!questions || !questions.length) continue;

      // 薄弱分类：从本题库中挑 1-2 个分类作为该用户的集中错题领域
      const categories = [...new Set(questions.map(x => x.category).filter(Boolean))];
      const weakCats = shuffle([...categories], rand).slice(0, archetype === 'weak' ? 1 : 2);

      // 正确率：标兵~90%，合格~75%，薄弱~45%，未开始~60%
      const correctRate = archetype === 'star' ? 0.9 : archetype === 'pass' ? 0.75
        : archetype === 'weak' ? 0.45 : 0.6;

      let earnedCents = 0;
      const results = questions.map(question => {
        const inWeakCat = weakCats.includes(question.category);
        const prob = inWeakCat ? Math.max(0.05, correctRate - 0.35) : correctRate;
        const correct = rand() < prob;
        const points = Math.round((Number(question.score) || 0) * 100);
        if (correct) earnedCents += points;
        return {
          questionId: question.id,
          category: question.category,
          title: question.title,
          correct,
          userAnswer: correct ? (question.answer || 'A') : 'X',
          correctAnswer: question.answer || 'A',
          earnedPoints: correct ? points / 100 : 0,
          totalPoints: (Number(question.score) || 0),
        };
      });
      const totalScore = Number(assessment.totalScore) || 100;
      const earnedPoints = earnedCents / 100;
      const score = Math.round((earnedPoints / totalScore) * 10000) / 100;
      const passed = earnedCents >= Math.round((Number(assessment.passScore) || 60) * 100);
      const submittedAt = new Date(nowMs - (1 + Math.floor(rand() * 20)) * 86400000);

      const [res] = await db.query(
        `INSERT IGNORE INTO assessment_attempts
         (assessmentId, userId, score, earnedPoints, totalScore, passed, results, submittedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [assessment.id, u.id, score, earnedPoints, totalScore, passed ? 1 : 0,
         JSON.stringify(results), sqlDate(submittedAt)]
      );
      if (res.affectedRows) stats.attemptsInserted += 1;
      else stats.attemptsSkipped += 1;
    }
  }

  // ============ 3. 汇总 ============
  const [recordTotal] = await q('SELECT COUNT(*) c FROM learning_records');
  const [recordUsers] = await q('SELECT COUNT(DISTINCT userId) c FROM learning_records');
  const [attemptTotal] = await q('SELECT COUNT(*) c FROM assessment_attempts');
  const [attemptUsers] = await q('SELECT COUNT(DISTINCT userId) c FROM assessment_attempts');
  const [assessmentTotal] = await q('SELECT COUNT(*) c FROM assessments');

  console.log('===== seed-personal-learning-data 运行结果 =====');
  console.log('画像分档分布:', JSON.stringify(stats.archetypes));
  console.log('新建近期任务:', stats.tasksCreated);
  console.log('学习记录: 新增', stats.recordsInserted, '| 跳过已有', stats.recordsSkipped);
  console.log('测评场次: 新建', stats.assessmentsCreated, '| 当前总数', assessmentTotal.c);
  console.log('测评记录: 新增', stats.attemptsInserted, '| 跳过已有', stats.attemptsSkipped);
  console.log('学习记录总数:', recordTotal.c, '| 覆盖用户:', recordUsers.c);
  console.log('测评记录总数:', attemptTotal.c, '| 覆盖用户:', attemptUsers.c);
  await db.end();
}

main().catch(e => { console.error('ERR', e.message); process.exit(1); });
