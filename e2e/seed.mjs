// 种子 E2E 专用测试数据（可重复：每次全新卷初始化，幂等插入）
import { query, queryOne } from './helpers/db.mjs';
import { ACCOUNTS, E2E_PREFIX } from './helpers/env.mjs';

export async function seedTestData() {
  // 1) 短文章内容（约 30 汉字 → 前端核算学习时长 6s，服务端下限 5s，测试可在数秒内完成学习）
  const shortBody = '党章是党的总章程，集中体现党的性质和宗旨，是全党必须共同遵守的根本行为规范。';
  const contentResult = await query(
    `INSERT INTO contents (title, type, coverUrl, bodyOrVideoUrl, summary, tags, isPublic, status, createdBy)
     VALUES (?, 'article', NULL, ?, ?, NULL, 0, 'published', 1)`,
    [`${E2E_PREFIX}党章学习短文`, `<p>${shortBody}</p>`, 'E2E 种子短文']
  );
  const contentId = contentResult.insertId;

  // 2) 发布到书记所在支部（org 4）的学习任务
  const taskResult = await query(
    `INSERT INTO learning_tasks (title, contentId, organizationId, status, deadline, createdBy)
     VALUES (?, ?, 4, 'published', DATE_ADD(UTC_TIMESTAMP(), INTERVAL 30 DAY), 1)`,
    [`${E2E_PREFIX}党章学习任务`, contentId]
  );
  const taskId = taskResult.insertId;

  // 3) 单选题试卷 + 测评（下发快照含答案，与 assessmentService 快照字段一致）
  const questionResult = await query(
    `INSERT INTO questions (type, title, options, answer, analysis, category, difficulty, status, createdBy)
     VALUES ('single', ?, ?, 'A', '党章是党的总章程。', '党章', 1, 1, 1)`,
    [
      `${E2E_PREFIX}党的根本行为规范是什么？`,
      JSON.stringify(['A.党章', 'B.入党誓词']),
    ]
  );
  const questionId = questionResult.insertId;

  const paperResult = await query(
    `INSERT INTO papers (title, category, description, duration, totalScore, passScore, status, createdBy)
     VALUES (?, '党章', 'E2E 种子试卷', 30, 100.00, 60.00, 2, 1)`,
    [`${E2E_PREFIX}党章测评试卷`]
  );
  const paperId = paperResult.insertId;
  await query(
    'INSERT INTO paper_questions (paperId, questionId, score) VALUES (?, ?, 100)',
    [paperId, questionId]
  );

  const snapshotQuestions = [{
    id: questionId,
    title: `${E2E_PREFIX}党的根本行为规范是什么？`,
    type: 'single',
    options: [
      { key: 'A', label: '党章' },
      { key: 'B', label: '入党誓词' },
    ],
    category: '党章',
    explanation: '党章是党的总章程。',
    score: 100,
    answer: 'A',
  }];
  const assessmentResult = await query(
    `INSERT INTO assessments (paperId, organizationId, kind, title, deadline, totalScore, passScore, questions, createdBy)
     VALUES (?, 4, 'quiz', ?, NULL, 100.00, 60.00, ?, 1)`,
    [paperId, `${E2E_PREFIX}党章知识测评`, JSON.stringify(snapshotQuestions)]
  );
  const assessmentId = assessmentResult.insertId;

  // 4) 停用场景专用账号（初始启用，用例内自行停用/恢复）
  const existing = await queryOne('SELECT id FROM users WHERE username = ?', [ACCOUNTS.memberDisabled.username]);
  if (!existing) {
    const hash = await queryOne('SELECT password FROM users WHERE id = 3');
    await query(
      `INSERT INTO users (username, password, realName, role, organizationId, status)
       VALUES (?, ?, 'E2E停用员', 'member', 4, 1)`,
      [ACCOUNTS.memberDisabled.username, hash.password]
    );
  }

  return { contentId, taskId, assessmentId, paperId, questionId };
}

export async function seedInfo() {
  const users = await query('SELECT id, username, role, organizationId, status FROM users ORDER BY id');
  const orgs = await query('SELECT id, name, parentId FROM organizations ORDER BY id');
  return { users, orgs };
}
