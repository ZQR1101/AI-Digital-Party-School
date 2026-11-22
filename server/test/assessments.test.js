const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/config/db');
const AssessmentService = require('../src/services/assessmentService');

test.after(() => db.end());
const { gradeAssessment, parseDeadline, snapshotPaper, formatAssignment } = AssessmentService;

const paper = { totalScore: '50.00', passScore: '30.00' };
const questions = [
  { id: 4, type: 'multiple', title: '请选择两项', options: '["A. 甲","B. 乙","C. 丙"]',
    answer: 'A,C', category: ' 学习制度 ', analysis: '两项符合', score: '16.67', status: 1 },
  { id: 7, type: 'judge', title: '请判断', answer: 'false', category: '学习制度', score: '16.67', status: 1 },
  { id: 10, type: 'single', title: '请选择一项', options: ['样例一', '样例二'],
    answer: 'B', category: '组织制度', score: '16.67', status: 1 },
];

test('测评发布固化题目、知识点和计分，三题满分等于试卷设置', () => {
  const rows = structuredClone(questions);
  const snapshot = snapshotPaper(paper, rows);
  rows[0].answer = 'B';
  assert.equal(snapshot.questions[0].answer, 'A,C');
  assert.equal(snapshot.questions[0].category, '学习制度');
  assert.deepEqual(snapshot.questions.map(question => question.score), [16.67, 16.66, 16.67]);
  const attempt = gradeAssessment(snapshot, { 4: ['c', 'A'], 7: false, 10: 'B' });
  assert.equal(attempt.score, 100);
  assert.equal(attempt.earnedPoints, 50);
  assert.equal(attempt.passed, true);
  assert.deepEqual(attempt.results.map(question => question.correct), [true, true, true]);
});

test('交卷按已发布试卷判分，不允许额外题目或无效选项', () => {
  const snapshot = snapshotPaper(paper, questions);
  const attempt = gradeAssessment(snapshot, { 4: 'C,A', 7: 'true' });
  assert.equal(attempt.score, 33.34);
  assert.equal(attempt.passed, false);
  assert.deepEqual(attempt.results.map(({ userAnswer, correct }) => [userAnswer, correct]), [['A,C', true], ['true', false], ['', false]]);
  assert.throws(() => gradeAssessment(snapshot, { 45: 'B' }), /测评之外/);
  assert.throws(() => gradeAssessment(snapshot, { 7: ['true', 'false'] }), /答案选项无效/);
  assert.throws(() => gradeAssessment(snapshot, { 10: { key: 'B' } }), /答案选项无效/);
  assert.throws(() => snapshotPaper(paper, [{ ...questions[0], status: 0 }]), /已停用/);
});

test('未交卷详情隐藏答案和解析，交卷后通过个人记录显示判题证据', () => {
  const snapshot = snapshotPaper(paper, questions);
  const row = { id: 2, questionCount: 3, questions: JSON.stringify(snapshot.questions), attemptId: null };
  const detail = formatAssignment(row, true);
  assert.equal(detail.attempt, null);
  assert.equal(detail.questions[0].answer, undefined);
  assert.equal(detail.questions[0].explanation, undefined);
  const graded = gradeAssessment(snapshot, {});
  const submitted = formatAssignment({ ...row, attemptId: 5, results: JSON.stringify(graded.results) }, true);
  assert.equal(submitted.attempt.results[0].correctAnswer, 'A,C');
  assert.equal(submitted.attempt.results[0].explanation, '两项符合');
});

test('北京时间截止日转换为 UTC，并拒绝过期或不存在的日期', () => {
  const now = new Date('2026-11-22T00:00:00Z');
  assert.equal(parseDeadline('2026-11-23', now).toISOString(), '2026-11-23T15:59:59.000Z');
  assert.equal(parseDeadline('2026-11-23 08:30', now).toISOString(), '2026-11-23T00:30:00.000Z');
  assert.equal(parseDeadline('2026-11-23T08:30:00Z', now).toISOString(), '2026-11-23T08:30:00.000Z');
  assert.throws(() => parseDeadline('2026-11-20', now), /晚于/);
  assert.throws(() => parseDeadline('2026-11-31', now), /截止时间无效/);
});

test('只提交本组织或上级下发的测评，已交卷的请求重试保留原结果', async t => {
  let saved = null;
  const { questions: snapshot } = snapshotPaper(paper, questions);
  const connection = {
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async query(sql, values) {
      if (sql.includes('SELECT role, organizationId')) {
        assert.match(sql, /FOR UPDATE/);
        return [[{ role: 'member', organizationId: 8 }]];
      }
      if (sql.includes('SELECT id, parentId FROM organizations')) {
        return [[{ id: 1, parentId: null }, { id: 3, parentId: 1 }, { id: 8, parentId: 3 }, { id: 9, parentId: 1 }]];
      }
      if (sql.includes('LEFT JOIN assessment_attempts')) {
        assert.match(sql, /a\.organizationId IN \(\?,\?,\?\)/);
        assert.deepEqual(values.slice(0, 4), [12, 8, 3, 1]);
        if (values[4] !== 15) return [[]];
        return [[{ ...paper, id: 15, questions: JSON.stringify(snapshot), ...saved }]];
      }
      if (sql.includes('INSERT INTO assessment_attempts')) {
        assert.equal(saved, null, 'retries must not insert another attempt');
        assert.match(sql, /deadline > UTC_TIMESTAMP\(\)/);
        const [, score, earnedPoints, attemptTotalScore, passed, results] = values;
        saved = { attemptId: 13, score, earnedPoints, attemptTotalScore, passed, results };
        return [{ affectedRows: 1 }];
      }
      assert.fail(`Unexpected query: ${sql}`);
    },
  };
  t.mock.method(db, 'getConnection', async () => connection);
  const first = await AssessmentService.submit(12, 15, { 4: 'A,C', 7: false, 10: 'B' });
  const retry = await AssessmentService.submit(12, 15, { 4: 'B' });
  assert.deepEqual(retry, first);
  assert.equal(first.score, 100);
  await assert.rejects(() => AssessmentService.submit(12, 16, {}), /不存在或未分配/);
});
