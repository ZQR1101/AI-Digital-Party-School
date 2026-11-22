const db = require('../config/db');
const { toUtcSqlDate } = require('../ai/queryParser');

const LEGACY_SOURCE = 'SELECT userId, score, submittedAt, (score >= 60) AS passed FROM exam_records';
const ASSESSMENT_SOURCE = 'SELECT userId, score, submittedAt, passed FROM assessment_attempts';
const LOCAL_SUBMITTED_AT = 'DATE_ADD(er.submittedAt, INTERVAL 8 HOUR)';

async function queryAssessmentStats({ scope, timeRange, groupBy }) {
  const groupedFields = {
    month: `DATE_FORMAT(${LOCAL_SUBMITTED_AT}, '%Y-%m') AS month,`,
    quarter: `YEAR(${LOCAL_SUBMITTED_AT}) AS y, QUARTER(${LOCAL_SUBMITTED_AT}) AS q,`
  };
  const groupedBy = { month: 'GROUP BY month ORDER BY month', quarter: 'GROUP BY y, q ORDER BY y, q' };
  const timeWhere = timeRange ? 'AND er.submittedAt >= ? AND er.submittedAt < ?' : '';
  const timeParams = timeRange ? [toUtcSqlDate(timeRange.startDate), toUtcSqlDate(timeRange.endDate)] : [];
  const query = (source) => db.query(
    `SELECT ${groupedFields[groupBy] || ''}
            COUNT(*) AS examCount, COALESCE(AVG(er.score), 0) AS avgScore,
            SUM(CASE WHEN er.passed = 1 THEN 1 ELSE 0 END) AS passedCount
     FROM (${source}) er JOIN users u ON u.id = er.userId
     WHERE er.submittedAt IS NOT NULL ${timeWhere}${scope.sql}
     ${groupedBy[groupBy] || ''}`,
    [...timeParams, ...scope.params]
  );

  try {
    const [rows] = await query(`${LEGACY_SOURCE} UNION ALL ${ASSESSMENT_SOURCE}`);
    return rows;
  } catch (error) {
    if (error.code !== 'ER_NO_SUCH_TABLE' || !error.message.includes('assessment_attempts')) throw error;
    const [rows] = await query(LEGACY_SOURCE);
    return rows;
  }
}

module.exports = { queryAssessmentStats };
