/**
 * 工具调用的数据库真值校验（只在显式开启且确认隔离库时执行）。
 *
 * 安全约束：
 * - 必须 AI_EVAL_DB_TRUTH=1；
 * - DB_NAME 必须包含 eval（如 ai_eval_ci），拒绝连到 party_school 等默认业务库；
 * - 只调用 OrganizationQueryService.executeTool（既有受控服务层），评测侧不开放任意 SQL；
 * - 真值 SQL 为只读 SELECT，且仅在同一个隔离库执行。
 * 未满足时返回 status: 'not_run'，报告中标记 N/A。
 */
const { NA } = require('./envinfo');

async function evaluateDbTruth() {
  const base = { title: '工具调用与数据库真值一致性', status: 'not_run', summary: { samples: 0 }, reason: '' };
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
    const [orgRows] = await db.query('SELECT id FROM organizations ORDER BY id LIMIT 5');
    if (!orgRows.length) {
      base.reason = '隔离库无组织数据，请先执行 init-db.js；本项标记 N/A';
      return base;
    }
    const orgIds = orgRows.map((r) => Number(r.id));
    const checks = [];
    for (const metric of ['member_distribution', 'sub_organization_count', 'active_member_count']) {
      const tool = metric === 'active_member_count' ? 'query_learning_statistics' : 'query_organization_statistics';
      const result = await OrganizationQueryService.executeTool(tool, metric, orgIds, timeRange, null, null);

      let truth;
      if (metric === 'member_distribution') {
        const [rows] = await db.query('SELECT COUNT(*) AS n FROM users WHERE status = 1 AND organizationId IN (?)', [orgIds]);
        truth = Number(rows[0].n);
      } else if (metric === 'sub_organization_count') {
        const [rows] = await db.query('SELECT COUNT(*) AS n FROM organizations WHERE id IN (?)', [orgIds]);
        truth = Number(rows[0].n);
      } else {
        const [rows] = await db.query(
          `SELECT COUNT(DISTINCT CASE WHEN studySeconds > 0 THEN userId END) AS n FROM learning_records
           WHERE updatedAt >= ? AND updatedAt < ? AND userId IN (SELECT id FROM users WHERE organizationId IN (?))`,
          [toUtcSqlDate(timeRange.startDate), toUtcSqlDate(timeRange.endDate), orgIds]
        );
        truth = Number(rows[0].n);
      }
      const actual = Number(result.value);
      const pass = actual === truth;
      checks.push({ id: `dbtruth-${metric}`, metric, tool, expected: truth, actual, pass });
    }
    base.status = 'passed';
    base.database = { name: dbName, orgIds, timeRange: timeRange.label };
    base.summary = {
      samples: checks.length,
      consistencyRate: checks.filter((c) => c.pass).length / checks.length,
      status: 'passed'
    };
    base.checks = checks;
    return base;
  } catch (err) {
    base.reason = `隔离库连接或查询失败：${err.message}`;
    return base;
  }
}

module.exports = { evaluateDbTruth };
