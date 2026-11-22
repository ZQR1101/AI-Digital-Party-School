const db = require('../config/db');
const OrganizationService = require('./organizationService');
const { dashboardTimeRange, resolveTimeRange } = require('../ai/queryParser');
const { queryTaskCompletion } = require('./taskCompletionStatistics');
const { queryAssessmentStats } = require('./assessmentStatistics');

function placeholders(values) {
  return values.map(() => '?').join(',');
}

function toSqlDate(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function startOfUtcDay(date) {
  const value = new Date(date);
  value.setUTCHours(0, 0, 0, 0);
  return value;
}

function getRangeBounds(range) {
  const end = new Date();
  const start = startOfUtcDay(end);
  if (range === '30d') {
    start.setUTCDate(start.getUTCDate() - 29);
  } else if (range === '3m') {
    start.setUTCMonth(start.getUTCMonth() - 2, 1);
  } else {
    start.setUTCMonth(start.getUTCMonth() - 5, 1);
  }
  return { start, end, previousStart: offsetRangeStart(start, end) };
}

function offsetRangeStart(start, end) {
  const previousStart = new Date(start.getTime() - (end.getTime() - start.getTime()));
  return previousStart;
}

class StatisticsService {
  static buildUserScope(orgIds) {
    if (!orgIds) return { sql: '', params: [] };
    if (!orgIds.length) return { sql: ' AND 1 = 0', params: [] };
    return { sql: ` AND u.organizationId IN (${placeholders(orgIds)})`, params: orgIds };
  }

  static async getDashboard({ orgIds, range = '6m' }) {
    const bounds = getRangeBounds(range);
    const completionRange = resolveTimeRange(dashboardTimeRange(range));
    const [overview, activityTrend, passRateTrend, ranking] = await Promise.all([
      this.getOverview(orgIds, completionRange),
      this.getActivityTrend(orgIds, range, bounds),
      this.getPassRateTrend(orgIds),
      this.getBranchRanking(orgIds, completionRange),
    ]);
    const insight = this.buildInsight(overview, passRateTrend);
    return {
      overview,
      trend: activityTrend,
      activityTrend,
      passRateTrend,
      ranking,
      organizationStats: ranking,
      insight,
    };
  }

  static async getOverview(orgIds, completionRange) {
    const scope = this.buildUserScope(orgIds);
    const taskScope = orgIds == null ? '' : orgIds.length ? ' AND organizationId IN (?)' : ' AND 1 = 0';
    const taskParams = orgIds?.length ? [orgIds] : [];
    const [[userCount]] = await db.query(
      `SELECT COUNT(*) AS total FROM users u WHERE u.status = 1 AND u.role = 'member'${scope.sql}`,
      scope.params
    );
    const [[taskCount]] = await db.query(
      `SELECT COUNT(*) AS total FROM learning_tasks WHERE status = 'published'${taskScope}`,
      taskParams
    );
    const contentScope = orgIds == null ? '' : `AND (c.isPublic = 1 OR EXISTS (
      SELECT 1 FROM learning_tasks WHERE contentId = c.id AND status = 'published'${taskScope}
    ))`;
    const [[contentCount]] = await db.query(
      `SELECT COUNT(*) AS total FROM contents c WHERE c.status = 'published' ${contentScope}`,
      taskParams
    );
    const [[totalStudy]] = await db.query(
      `SELECT COALESCE(SUM(lr.studySeconds), 0) AS totalSeconds
       FROM learning_records lr
       JOIN users u ON lr.userId = u.id
       WHERE 1=1${scope.sql}`,
      scope.params
    );
    const completion = await queryTaskCompletion(orgIds, completionRange);
    const [examStats] = await queryAssessmentStats({ scope });
    const [[newMembers]] = await db.query(
      `SELECT COUNT(*) AS total FROM users u
       WHERE u.createdAt >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY) AND u.role = 'member'${scope.sql}`,
      scope.params
    );
    const [[newContents]] = await db.query(
      `SELECT COUNT(*) AS total FROM contents c
       WHERE c.status = 'published' AND c.createdAt >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY) ${contentScope}`,
      taskParams
    );

    const totalMembers = Number(userCount.total || 0);
    const totalSeconds = Number(totalStudy.totalSeconds || 0);
    const examCount = Number(examStats.examCount);
    const passedCount = Number(examStats.passedCount);
    const avgStudyHours = totalMembers
      ? Math.round((totalSeconds / 3600 / totalMembers) * 10) / 10
      : 0;

    return {
      totalMembers,
      totalTasks: Number(taskCount.total || 0),
      totalContents: Number(contentCount.total || 0),
      totalStudyHours: Math.round((totalSeconds / 3600) * 100) / 100,
      avgStudyHours,
      completionRate: completion.value,
      completionSampleSize: completion.denominator,
      avgScore: Math.round(Number(examStats.avgScore) * 100) / 100,
      passRate: examCount ? Math.round((passedCount / examCount) * 1000) / 10 : 0,
      memberChange: Number(newMembers.total || 0),
      contentChange: Number(newContents.total || 0),
    };
  }

  static async getByOrganization(parentOrgId) {
    const sql = parentOrgId
      ? 'SELECT id, name FROM organizations WHERE parentId = ?'
      : 'SELECT id, name FROM organizations WHERE parentId IS NULL';
    const params = parentOrgId ? [Number(parentOrgId)] : [];
    const [orgs] = await db.query(sql, params);
    const stats = [];
    for (const org of orgs) {
      const orgIds = await OrganizationService.getDescendantIds(org.id);
      const overview = await this.getOverview(orgIds);
      stats.push({ organizationId: org.id, organizationName: org.name, ...overview });
    }
    return stats;
  }

  static async getTrend() {
    const [rows] = await db.query(
      `SELECT DATE_FORMAT(completedAt, '%Y-%m') as month,
              COUNT(*) as completedCount
       FROM learning_records WHERE status = 'completed' AND completedAt IS NOT NULL
       GROUP BY month ORDER BY month DESC LIMIT 12`
    );
    return rows.reverse();
  }

  static async getActivityTrend(orgIds, range, bounds) {
    const scope = this.buildUserScope(orgIds);
    const groupExpr = range === '30d' ? '%Y-%m-%d' : '%Y-%m';
    const [rows] = await db.query(
      `SELECT DATE_FORMAT(lr.updatedAt, '${groupExpr}') AS bucket,
              COUNT(DISTINCT CASE WHEN lr.studySeconds > 0 THEN lr.userId END) AS activeUsers
       FROM learning_records lr
       JOIN users u ON u.id = lr.userId
       WHERE lr.updatedAt >= ? AND lr.updatedAt < ?${scope.sql}
       GROUP BY bucket ORDER BY bucket`,
      [toSqlDate(bounds.start), toSqlDate(bounds.end), ...scope.params]
    );
    const lookup = Object.fromEntries(rows.map((row) => [row.bucket, Number(row.activeUsers || 0)]));
    return fillTrendPoints(range, bounds, lookup);
  }

  static async getPassRateTrend(orgIds) {
    const scope = this.buildUserScope(orgIds);
    const rows = await queryAssessmentStats({ scope, groupBy: 'quarter' });
    const lookup = Object.fromEntries(rows.map((row) => [
      `${row.y}-${row.q}`,
      Number(row.examCount) ? Math.round((Number(row.passedCount) / Number(row.examCount)) * 1000) / 10 : 0,
    ]));
    return lastQuarters(4).map((item) => ({
      label: item.label,
      value: lookup[item.key] || 0,
    }));
  }

  static async getBranchRanking(orgIds, completionRange) {
    let sql = `SELECT id, name FROM organizations WHERE type = 'branch'`;
    const params = [];
    if (orgIds && !orgIds.length) return [];
    if (orgIds) {
      sql += ` AND id IN (${placeholders(orgIds)})`;
      params.push(...orgIds);
    }
    sql += ' ORDER BY id';
    const [orgs] = await db.query(sql, params);
    const allowed = orgIds ? new Set(orgIds) : null;
    const ranking = [];
    for (const org of orgs) {
      const descendants = await OrganizationService.getDescendantIds(org.id);
      const descendantIds = allowed ? descendants.filter(id => allowed.has(id)) : descendants;
      const overview = await this.getOverview(descendantIds, completionRange);
      ranking.push({
        organizationId: org.id,
        name: org.name,
        score: overview.avgScore,
        passRate: overview.passRate,
        completionRate: overview.completionRate,
      });
    }
    return ranking.sort((a, b) => b.score - a.score).slice(0, 8);
  }

  static buildInsight(overview, passRateTrend) {
    const last = Number(passRateTrend[passRateTrend.length - 1]?.value || overview.passRate || 0);
    const prev = Number(passRateTrend[passRateTrend.length - 2]?.value || last);
    const forecast = Math.min(100, Math.max(0, Math.round((last + (last - prev)) * 10) / 10));
    let warning = '当前学习秩序总体平稳，可持续跟踪各支部完成情况和测验成绩差异。';
    if (overview.totalMembers === 0) {
      warning = '当前范围内还没有党员账号，请先在人员管理中补充组织成员。';
    } else if (overview.completionSampleSize > 0 && overview.completionRate < 80) {
      warning = `当前学习完成率为 ${overview.completionRate}%，建议关注尚未完成任务的党员并及时提醒。`;
    } else if (overview.passRate > 0 && overview.passRate < 80) {
      warning = `当前考试及格率为 ${overview.passRate}%，建议围绕错题和薄弱知识点安排补学。`;
    }
    return {
      forecastPassRate: forecast,
      warning,
    };
  }
}

function fillTrendPoints(range, bounds, lookup) {
  const points = [];
  if (range === '30d') {
    const cursor = new Date(bounds.start);
    while (cursor <= bounds.end) {
      const key = cursor.toISOString().slice(0, 10);
      points.push({ label: `${String(cursor.getUTCMonth() + 1).padStart(2, '0')}-${String(cursor.getUTCDate()).padStart(2, '0')}`, value: lookup[key] || 0 });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return points;
  }
  const months = range === '3m' ? 3 : 6;
  const cursor = new Date(Date.UTC(bounds.end.getUTCFullYear(), bounds.end.getUTCMonth() - (months - 1), 1));
  for (let index = 0; index < months; index += 1) {
    const key = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`;
    points.push({ label: `${cursor.getUTCMonth() + 1} 月`, value: lookup[key] || 0 });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return points;
}

function lastQuarters(count) {
  const now = new Date();
  const items = [];
  let year = now.getUTCFullYear();
  let quarter = Math.floor(now.getUTCMonth() / 3) + 1;
  const names = ['一', '二', '三', '四'];
  for (let index = 0; index < count; index += 1) {
    items.unshift({
      key: `${year}-${quarter}`,
      label: `${year} 第${names[quarter - 1]}季度`,
    });
    quarter -= 1;
    if (quarter === 0) {
      quarter = 4;
      year -= 1;
    }
  }
  return items;
}

module.exports = StatisticsService;
