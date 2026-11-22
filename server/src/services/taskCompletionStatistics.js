const db = require('../config/db');
const { toUtcSqlDate } = require('../ai/queryParser');
const OrganizationService = require('./organizationService');
const TaskService = require('./taskService');

function completionResult(numerator, denominator) {
  return {
    numerator,
    denominator,
    value: denominator ? Math.round(numerator / denominator * 10000) / 100 : 0
  };
}

function summarizeTaskCompletion(rows, groupBy) {
  const rowsByUser = new Map();
  for (const row of rows) {
    if (!rowsByUser.has(row.userId)) rowsByUser.set(row.userId, []);
    rowsByUser.get(row.userId).push(row);
  }

  const assignments = [...rowsByUser.values()].flatMap(tasks => TaskService.dedupeMemberTasks(tasks));
  const result = completionResult(assignments.filter(item => item.completed).length, assignments.length);
  if (groupBy !== 'month') return result;

  const countsByMonth = new Map();
  for (const item of assignments) {
    const count = countsByMonth.get(item.month) || { completed: 0, assigned: 0 };
    count.assigned += 1;
    count.completed += Number(item.completed);
    countsByMonth.set(item.month, count);
  }
  return {
    ...result,
    trend: [...countsByMonth.keys()].sort().map(month => {
      const count = countsByMonth.get(month);
      return { month, ...completionResult(count.completed, count.assigned) };
    })
  };
}

async function queryTaskCompletion(orgIds, timeRange, groupBy) {
  const [organizations] = await db.query('SELECT id, parentId FROM organizations');
  const scope = orgIds == null ? null : new Set(orgIds.map(Number));
  const pairs = organizations
    .filter(org => scope == null || scope.has(Number(org.id)))
    .flatMap(org => OrganizationService.ancestorIdsFromRows(org.id, organizations).map(ancestorId => [org.id, ancestorId]));
  if (!pairs.length) return summarizeTaskCompletion([], groupBy);

  // The member's own assignment wins when the same task was also assigned by an ancestor.
  const organizationPairs = pairs.map(() => 'SELECT ? AS memberOrgId, ? AS taskOrgId').join(' UNION ALL ');
  const timeWhere = timeRange ? 'AND lt.createdAt >= ? AND lt.createdAt < ?' : '';
  const timeParams = timeRange ? [toUtcSqlDate(timeRange.startDate), toUtcSqlDate(timeRange.endDate)] : [];
  const completedBeforeEnd = timeRange ? 'AND COALESCE(lr.completedAt, lr.updatedAt) < ?' : '';
  const [rows] = await db.query(
    `SELECT u.id AS userId, lt.contentId, lt.title,
            DATE_FORMAT(DATE_ADD(lt.createdAt, INTERVAL 8 HOUR), '%Y-%m') AS month,
            CASE WHEN lr.status = 'completed' ${completedBeforeEnd} THEN 1 ELSE 0 END AS completed
     FROM (${organizationPairs}) os
     JOIN users u ON u.organizationId = os.memberOrgId AND u.role = 'member' AND u.status = 1
     JOIN learning_tasks lt ON lt.organizationId = os.taskOrgId AND lt.status = 'published'
     LEFT JOIN learning_records lr ON lr.taskId = lt.id AND lr.userId = u.id
     WHERE 1 = 1 ${timeWhere}
     ORDER BY u.id, (lt.organizationId = u.organizationId) DESC, lt.id DESC`,
    [...timeParams.slice(1), ...pairs.flat(), ...timeParams]
  );
  return summarizeTaskCompletion(rows, groupBy);
}

module.exports = { queryTaskCompletion, summarizeTaskCompletion };
