const db = require('../config/db');
const OrganizationService = require('./organizationService');

class AssessmentError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function positiveId(value, label) {
  const raw = ['string', 'number'].includes(typeof value) ? String(value) : '';
  const id = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(id) || id < 1) {
    throw new AssessmentError(400, `${label}无效`);
  }
  return id;
}

function parseDeadline(value, now = new Date()) {
  if (value == null || value === '') return null;
  const parts = typeof value === 'string'
    && /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2})(:\d{2})?(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})?)?$/.exec(value);
  if (!parts || Number(parts[1].slice(0, 4)) < 1000) throw new AssessmentError(400, '截止时间格式无效');
  const [, day, hourAndMinute, second, zone] = parts;
  const local = `${day}T${hourAndMinute ? `${hourAndMinute}${second || ':00'}` : '23:59:59'}`;
  const calendar = new Date(`${local}Z`);
  const deadline = new Date(`${local}${zone || '+08:00'}`);
  if (!Number.isFinite(deadline.getTime()) || !Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 19) !== local) {
    throw new AssessmentError(400, '截止时间无效');
  }
  if (deadline <= now) throw new AssessmentError(400, '截止时间必须晚于当前时间');
  return deadline;
}

function jsonArray(value) {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  return Array.isArray(parsed) ? parsed : [];
}

function snapshotOptions(question) {
  if (question.type === 'judge') return [{ key: 'true', label: '正确' }, { key: 'false', label: '错误' }];
  return jsonArray(question.options).map((option, index) => {
    const label = String(option ?? '').trim();
    const prefix = /^([A-Z])[.、．]\s*/i.exec(label);
    return {
      key: prefix ? prefix[1].toUpperCase() : String.fromCharCode(65 + index),
      label: prefix ? label.slice(prefix[0].length) : label,
    };
  });
}

function answerKeys(question, value) {
  if (value == null || value === '') return [];
  if (!Array.isArray(value) && !['string', 'boolean'].includes(typeof value)) return null;
  const answers = Array.isArray(value) ? value : String(value).split(/[,，、]/);
  if (answers.some(answer => !['string', 'boolean'].includes(typeof answer))) return null;
  const keys = [...new Set(answers.map(answer => {
    const choice = String(answer).trim();
    if (question.type !== 'judge') return choice.toUpperCase();
    if (['正确', '对', '√'].includes(choice)) return 'true';
    if (['错误', '错', '×'].includes(choice)) return 'false';
    return choice.toLowerCase();
  }).filter(Boolean))].sort();
  const allowed = new Set(question.options.map(option => option.key));
  if ((question.type !== 'multiple' && keys.length > 1) || keys.some(key => !allowed.has(key))) return null;
  return keys;
}

function snapshotPaper(paper, rows) {
  const totalPoints = Math.round(Number(paper.totalScore) * 100);
  const passPoints = Math.round(Number(paper.passScore) * 100);
  const weights = rows.map(question => Number(question.score));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  if (!rows.length || weights.some(weight => !Number.isFinite(weight) || weight < 0) || !(totalWeight > 0)) {
    throw new AssessmentError(400, '试卷至少需要一道有效计分题目');
  }
  if (!Number.isFinite(totalPoints) || !Number.isFinite(passPoints) || totalPoints <= 0 || passPoints < 0 || passPoints > totalPoints) {
    throw new AssessmentError(400, '试卷总分或及格分无效');
  }

  let weightSoFar = 0;
  let pointsSoFar = 0;
  const ids = new Set();
  const questions = rows.map((row, index) => {
    weightSoFar += weights[index];
    const points = Math.round(weightSoFar / totalWeight * totalPoints);
    const question = {
      id: Number(row.id),
      title: row.title,
      type: row.type,
      options: snapshotOptions(row),
      category: String(row.category || '').trim() || null,
      explanation: row.analysis || null,
      score: (points - pointsSoFar) / 100,
    };
    pointsSoFar = points;
    const answer = answerKeys(question, row.answer);
    if (!['single', 'multiple', 'judge'].includes(row.type) || Number(row.status) !== 1 || ids.has(question.id)
      || question.options.length < 2 || question.options.some(option => !option.label)
      || new Set(question.options.map(option => option.key)).size !== question.options.length || !answer?.length) {
      throw new AssessmentError(400, `题目 ${row.id} 已停用或选项、答案无效，请检查试卷`);
    }
    ids.add(question.id);
    return { ...question, answer: answer.join(',') };
  });
  return { totalScore: totalPoints / 100, passScore: passPoints / 100, questions };
}

function gradeAssessment(assessment, answers) {
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
    throw new AssessmentError(400, '请按题号提交答案');
  }
  const ids = new Set(assessment.questions.map(question => String(question.id)));
  if (Object.keys(answers).some(id => !ids.has(id))) throw new AssessmentError(400, '答案包含测评之外的题目');

  let earnedCents = 0;
  const results = assessment.questions.map(question => {
    const keys = answerKeys(question, answers[question.id]);
    if (!keys) throw new AssessmentError(400, `题目 ${question.id} 的答案选项无效`);
    const userAnswer = keys.join(',');
    const correct = userAnswer === question.answer;
    const earnedPoints = correct ? question.score : 0;
    earnedCents += Math.round(earnedPoints * 100);
    return {
      questionId: question.id,
      category: question.category,
      title: question.title,
      correct,
      userAnswer,
      correctAnswer: question.answer,
      explanation: question.explanation,
      earnedPoints,
      totalPoints: question.score,
    };
  });
  const totalScore = Number(assessment.totalScore);
  const earnedPoints = earnedCents / 100;
  return {
    score: Math.round((earnedPoints / totalScore) * 10000) / 100,
    earnedPoints,
    totalScore,
    passed: earnedCents >= Math.round(Number(assessment.passScore) * 100),
    results,
  };
}

function publicQuestion({ id, type, title, options, score }) {
  return { id, type, title, options, score };
}

function formatAttempt(row, withResults = false) {
  if (!row.attemptId) return null;
  const attempt = {
    id: row.attemptId,
    score: Number(row.score),
    earnedPoints: Number(row.earnedPoints),
    totalScore: Number(row.attemptTotalScore),
    passed: Boolean(Number(row.passed)),
    submittedAt: row.submittedAt,
  };
  if (withResults) attempt.results = jsonArray(row.results);
  return attempt;
}

function formatAssignment(row, withQuestions = false) {
  const assignment = {
    id: row.id,
    title: row.title,
    kind: row.kind,
    deadline: row.deadline,
    closed: Boolean(Number(row.closed)),
    questionCount: Number(row.questionCount),
    totalScore: Number(row.totalScore),
    attempt: formatAttempt(row, withQuestions),
  };
  if (withQuestions) assignment.questions = jsonArray(row.questions).map(publicQuestion);
  return assignment;
}

async function transaction(work) {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function activeUser(connection, userId, lock = false) {
  const [users] = await connection.query(
    `SELECT role, organizationId FROM users WHERE id = ? AND status = 1${lock ? ' FOR UPDATE' : ''}`,
    [userId]
  );
  if (!users.length) throw new AssessmentError(403, '用户不可用');
  return users[0];
}

async function ancestorIds(connection, organizationId) {
  if (!organizationId) return [];
  const [organizations] = await connection.query('SELECT id, parentId FROM organizations');
  return OrganizationService.ancestorIdsFromRows(organizationId, organizations);
}

async function memberAssignments(connection, userId, organizationIds, id = null) {
  const scope = organizationIds.length ? `a.organizationId IN (${organizationIds.map(() => '?').join(',')})` : 'FALSE';
  const [rows] = await connection.query(
    `SELECT a.id, a.title, a.kind, a.deadline, a.totalScore,
            (a.deadline IS NOT NULL AND a.deadline <= UTC_TIMESTAMP()) AS closed,
            JSON_LENGTH(a.questions) AS questionCount,
            aa.id AS attemptId, aa.score, aa.earnedPoints, aa.totalScore AS attemptTotalScore, aa.passed, aa.submittedAt
            ${id ? ', a.passScore, a.questions, aa.results' : ''}
     FROM assessments a
     LEFT JOIN assessment_attempts aa ON a.id = aa.assessmentId AND aa.userId = ?
     WHERE (${scope} OR aa.id IS NOT NULL) ${id ? 'AND a.id = ?' : ''}
     ORDER BY a.createdAt DESC, a.id DESC`,
    [userId, ...organizationIds, ...(id ? [id] : [])]
  );
  return rows;
}

async function getMemberOrganizationIds(connection, userId, lock = false) {
  const user = await activeUser(connection, userId, lock);
  if (user.role !== 'member') throw new AssessmentError(403, '只有学员可以参加测评');
  return ancestorIds(connection, user.organizationId);
}

class AssessmentService {
  static async publish(actor, input) {
    const paperId = positiveId(input.paperId, '试卷');
    const organizationId = positiveId(input.organizationId, '组织');
    const { kind } = input;
    if (!['quiz', 'exam'].includes(kind)) throw new AssessmentError(400, '请选择测验或考试');
    const deadline = parseDeadline(input.deadline);

    return transaction(async connection => {
      const publisher = await activeUser(connection, actor.userId, true);
      if (!['admin', 'secretary'].includes(publisher.role)) throw new AssessmentError(403, '无权限下发测评');

      const [organizations] = await connection.query('SELECT id FROM organizations WHERE id = ?', [organizationId]);
      if (!organizations.length) throw new AssessmentError(404, '下发组织不存在');
      if (publisher.role === 'secretary' && !(await ancestorIds(connection, organizationId)).includes(Number(publisher.organizationId))) {
        throw new AssessmentError(403, '下发组织超出管理范围');
      }

      const [papers] = await connection.query(
        'SELECT title, totalScore, passScore FROM papers WHERE id = ? AND status = 2 FOR UPDATE',
        [paperId]
      );
      if (!papers.length) throw new AssessmentError(400, '请选择已发布的试卷');
      const [questions] = await connection.query(
        `SELECT q.id, q.type, q.title, q.options, q.answer, q.analysis, q.category, q.status, pq.score
         FROM paper_questions pq JOIN questions q ON q.id = pq.questionId
         WHERE pq.paperId = ? ORDER BY pq.sort, pq.id FOR UPDATE`,
        [paperId]
      );
      const paper = papers[0];
      const snapshot = snapshotPaper(paper, questions);
      const [result] = await connection.query(
        `INSERT INTO assessments (paperId, organizationId, kind, title, deadline, totalScore, passScore, questions, createdBy, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())`,
        [paperId, organizationId, kind, paper.title, deadline, snapshot.totalScore, snapshot.passScore,
          JSON.stringify(snapshot.questions), actor.userId]
      );
      return {
        id: result.insertId, paperId, organizationId, kind, title: paper.title, deadline,
        closed: false, questionCount: questions.length, totalScore: snapshot.totalScore, attempt: null,
      };
    });
  }

  static async list(userId) {
    const organizations = await getMemberOrganizationIds(db, userId);
    const rows = await memberAssignments(db, userId, organizations);
    return { list: rows.map(row => formatAssignment(row)) };
  }

  static async detail(userId, rawId) {
    const id = positiveId(rawId, '测评');
    const organizations = await getMemberOrganizationIds(db, userId);
    const [row] = await memberAssignments(db, userId, organizations, id);
    if (!row) throw new AssessmentError(404, '测评不存在或未分配给你');
    return formatAssignment(row, true);
  }

  static async submit(userId, rawId, answers) {
    const id = positiveId(rawId, '测评');
    return transaction(async connection => {
      // Lock the learner row to serialize submissions and preserve the first accepted answers.
      const organizations = await getMemberOrganizationIds(connection, userId, true);
      const [row] = await memberAssignments(connection, userId, organizations, id);
      if (!row) throw new AssessmentError(404, '测评不存在或未分配给你');
      if (row.attemptId) return formatAttempt(row, true);
      if (row.closed) throw new AssessmentError(409, '测评已截止');

      const graded = gradeAssessment({ ...row, questions: jsonArray(row.questions) }, answers);
      const [insert] = await connection.query(
        `INSERT INTO assessment_attempts (assessmentId, userId, score, earnedPoints, totalScore, passed, results, submittedAt)
         SELECT id, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP() FROM assessments
         WHERE id = ? AND (deadline IS NULL OR deadline > UTC_TIMESTAMP())`,
        [userId, graded.score, graded.earnedPoints, graded.totalScore, graded.passed ? 1 : 0, JSON.stringify(graded.results), id]
      );
      if (!insert.affectedRows) throw new AssessmentError(409, '测评已截止');
      const [submitted] = await memberAssignments(connection, userId, organizations, id);
      return formatAttempt(submitted, true);
    });
  }
}

module.exports = AssessmentService;
module.exports.AssessmentError = AssessmentError;
module.exports.gradeAssessment = gradeAssessment;
module.exports.parseDeadline = parseDeadline;
module.exports.snapshotPaper = snapshotPaper;
module.exports.formatAssignment = formatAssignment;
