/**
 * 工具调用的数据库真值校验（只在显式开启且确认隔离库时执行）。
 *
 * 安全约束：
 * - 必须 AI_EVAL_DB_TRUTH=1；
 * - DB_NAME 必须包含 eval（如 ai_eval_ci），拒绝连到 party_school 等默认业务库；
 * - 只调用 OrganizationQueryService.executeTool（既有受控服务层），评测侧不开放任意 SQL；
 * - 真值 SQL 全部为只读 SELECT，且仅在同一隔离库执行；
 * - 任何一条不一致都必须返回 status='failed' 且记录 failedSamples，绝不返回 passed。
 * 未满足时返回 status='not_run'，报告中标记 N/A。
 */
const { NA } = require('./envinfo');

const EXAM_SOURCES = [
  'SELECT userId, score, submittedAt, (score >= 60) AS passed FROM exam_records',
  'SELECT userId, score, submittedAt, passed FROM assessment_attempts'
];

async function examRows(db, params) {
  const query = (source) => db.query(
    `SELECT COUNT(*) AS examCount, COALESCE(AVG(er.score), 0) AS avgScore,
            SUM(CASE WHEN er.passed = 1 THEN 1 ELSE 0 END) AS passedCount
     FROM (${source}) er JOIN users u ON u.id = er.userId
     WHERE er.submittedAt IS NOT NULL AND er.submittedAt >= ? AND er.submittedAt < ?
       AND u.organizationId IN (?)`,
    params
  );
  try {
    const [rows] = await query(EXAM_SOURCES.join(' UNION ALL '));
    return rows[0];
  } catch (error) {
    if (error.code !== 'ER_NO_SUCH_TABLE' || !error.message.includes('assessment_attempts')) throw error;
    const [rows] = await query(EXAM_SOURCES[0]);
    return rows[0];
  }
}

async function evaluateDbTruth() {
  const base = {
    title: '工具调用与数据库真值一致性',
    status: 'not_run',
    summary: { samples: NA, failedSamples: NA },
    reason: ''
  };
  if (process.env.AI_EVAL_DB_TRUTH !== '1') {
    base.reason = '未设置 AI_EVAL_DB_TRUTH=1；本项标记 N/A（不把未运行记作 0 或 100%）';
    return base;
  }
  const dbName = process.env.DB_NAME || '';
  if (!/eval/i.test(dbName)) {
    base.reason = `拒绝在非隔离库执行数据库真值评测（DB_NAME=${dbName || '(未设置)'}，要求名称包含 eval）`;
    return base;
  }

  try {
    const db = require('../../src/config/db');
    const OrganizationQueryService = require('../../src/services/organizationQueryService');
    const { toUtcSqlDate } = require('../../src/ai/queryParser');
    const timeRange = {
      label: '2026年', startDate: '2026-01-01 00:00:00', endDate: '2027-01-01 00:00:00'
    };
    const timeParams = [toUtcSqlDate(timeRange.startDate), toUtcSqlDate(timeRange.endDate)];
    const [orgRows] = await db.query('SELECT id FROM organizations ORDER BY id LIMIT 5');
    if (!orgRows.length) {
      base.reason = '隔离库无组织数据，请先准备隔离库；本项标记 N/A';
      return base;
    }
    const orgIds = orgRows.map((r) => Number(r.id));
    const checks = [];

    const addCheck = (id, metric, tool, truth, result) => {
      const actual = Number(result.value);
      const pass = Number.isFinite(actual) && actual === Number(truth);
      checks.push({ id, metric, tool, expected: Number(truth), actual, pass });
    };

    const orgStats = async (metric) => OrganizationQueryService.executeTool(
      'query_organization_statistics', metric, orgIds, timeRange, null, null
    );

    let [truthRows] = await db.query(
      'SELECT COUNT(*) AS n FROM users WHERE status = 1 AND organizationId IN (?)', [orgIds]
    );
    addCheck('dbtruth-001', 'member_distribution', 'query_organization_statistics', truthRows[0].n, await orgStats('member_distribution'));

    [truthRows] = await db.query('SELECT COUNT(*) AS n FROM organizations WHERE id IN (?)', [orgIds]);
    addCheck('dbtruth-002', 'sub_organization_count', 'query_organization_statistics', truthRows[0].n, await orgStats('sub_organization_count'));

    [truthRows] = await db.query(
      `SELECT COUNT(DISTINCT CASE WHEN studySeconds > 0 THEN userId END) AS n FROM learning_records
       WHERE updatedAt >= ? AND updatedAt < ? AND userId IN (SELECT id FROM users WHERE organizationId IN (?))`,
      [...timeParams, orgIds]
    );
    addCheck('dbtruth-003', 'active_member_count', 'query_learning_statistics', truthRows[0].n,
      await OrganizationQueryService.executeTool('query_learning_statistics', 'active_member_count', orgIds, timeRange, null, null));

    [truthRows] = await db.query(
      `SELECT COALESCE(SUM(lr.studySeconds), 0) AS seconds FROM learning_records lr
       JOIN users u ON u.id = lr.userId
       WHERE lr.updatedAt >= ? AND lr.updatedAt < ? AND u.organizationId IN (?)`,
      [...timeParams, orgIds]
    );
    addCheck('dbtruth-004', 'total_study_hours', 'query_learning_statistics',
      Math.round((Number(truthRows[0].seconds || 0) / 3600) * 100) / 100,
      await OrganizationQueryService.executeTool('query_learning_statistics', 'total_study_hours', orgIds, timeRange, null, null));

    const exam = await examRows(db, [...timeParams, orgIds]);
    addCheck('dbtruth-005', 'average_exam_score', 'query_exam_statistics',
      Math.round(Number(exam.avgScore || 0) * 100) / 100,
      await OrganizationQueryService.executeTool('query_exam_statistics', 'average_exam_score', orgIds, timeRange, null, null));
    addCheck('dbtruth-006', 'exam_pass_rate', 'query_exam_statistics',
      Number(exam.examCount) ? Math.round((Number(exam.passedCount) / Number(exam.examCount)) * 10000) / 100 : 0,
      await OrganizationQueryService.executeTool('query_exam_statistics', 'exam_pass_rate', orgIds, timeRange, null, null));

    const failedSamples = checks.filter((c) => !c.pass).length;
    base.status = failedSamples ? 'failed' : 'passed';
    base.database = { name: dbName, orgIds, timeRange: timeRange.label };
    base.summary = {
      samples: checks.length,
      failedSamples,
      consistencyRate: Math.round(((checks.length - failedSamples) / checks.length) * 10000) / 10000,
      status: base.status
    };
    base.checks = checks;
    if (failedSamples) base.reason = `${failedSamples} 条真值不一致，禁止标记 passed`;
    return base;
  } catch (err) {
    base.reason = `隔离库连接或查询失败：${err.message}`;
    return base;
  }
}

module.exports = { evaluateDbTruth };
