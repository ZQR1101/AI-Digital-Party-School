const db = require('../config/db');
const OrganizationService = require('./organizationService');
const { parseOrganizationQuery } = require('../ai/queryParser');
const RagService = require('./ragService');

function placeholders(values) {
  return values.map(() => '?').join(',');
}

class OrganizationQueryService {
  static async query(message, actor) {
    const parsed = parseOrganizationQuery(message);
    const organization = await this.resolveOrganization(parsed.organizationName, actor);
    const orgIds = organization ? await OrganizationService.getDescendantIds(organization.id) : null;
    const result = await this.executeMetric(parsed.metric, orgIds, parsed.timeRange, parsed.groupBy);
    const knowledge = await RagService.search(`${parsed.metricDefinition.name} 统计口径`, 2);
    const scopeName = organization ? organization.name : '全部组织';
    const answer = this.buildAnswer(parsed, scopeName, result);
    return {
      scene: 'organization_query',
      answer,
      query: {
        intent: parsed.intent,
        metric: parsed.metric,
        metricName: parsed.metricDefinition.name,
        organization: organization ? { id: organization.id, name: organization.name } : null,
        timeRange: parsed.timeRange,
        groupBy: parsed.groupBy
      },
      data: {
        metric: parsed.metric,
        metricName: parsed.metricDefinition.name,
        value: result.value,
        unit: parsed.metricDefinition.unit,
        numerator: result.numerator,
        denominator: result.denominator,
        details: result.details || null
      },
      charts: result.trend && result.trend.length ? [{
        type: 'line',
        title: `${scopeName}${parsed.timeRange.label}${parsed.metricDefinition.name}趋势`,
        xAxis: result.trend.map(item => item.month),
        series: [{ name: parsed.metricDefinition.name, data: result.trend.map(item => item.value) }]
      }] : [],
      sources: [{
        type: 'metric',
        name: parsed.metricDefinition.name,
        scope: scopeName,
        calculatedAt: new Date().toISOString()
      }, ...knowledge.map(item => ({
        type: 'knowledge',
        name: item.title,
        source: item.source,
        excerpt: item.content
      }))]
    };
  }

  static async resolveOrganization(name, actor) {
    let organization = null;
    if (name) {
      const [rows] = await db.query(
        `SELECT id, name, type, parentId FROM organizations
         WHERE name = ? OR name LIKE ? ORDER BY name = ? DESC, CHAR_LENGTH(name) ASC LIMIT 2`,
        [name, `%${name}%`, name]
      );
      if (!rows.length) throw new Error(`未找到组织：${name}`);
      organization = rows[0];
    } else if (actor.role === 'secretary') {
      organization = await OrganizationService.getById(Number(actor.organizationId));
    }

    if (actor.role === 'secretary' && organization) {
      const allowedIds = await OrganizationService.getDescendantIds(Number(actor.organizationId));
      if (!allowedIds.includes(Number(organization.id))) {
        const error = new Error('无权查询该组织数据');
        error.statusCode = 403;
        throw error;
      }
    }
    return organization;
  }

  static buildScope(orgIds, alias = 'u') {
    if (!orgIds || !orgIds.length) return { sql: '', params: [] };
    return { sql: ` AND ${alias}.organizationId IN (${placeholders(orgIds)})`, params: orgIds };
  }

  static async executeMetric(metric, orgIds, timeRange, groupBy) {
    if (metric === 'learning_completion_rate') {
      return this.queryCompletionRate(orgIds, timeRange, groupBy);
    }
    if (metric === 'average_exam_score' || metric === 'exam_pass_rate') {
      return this.queryExamMetric(metric, orgIds, timeRange, groupBy);
    }
    if (metric === 'total_study_hours' || metric === 'active_member_count') {
      return this.queryLearningActivity(metric, orgIds, timeRange, groupBy);
    }
    throw new Error(`不支持的指标：${metric}`);
  }

  static async queryCompletionRate(orgIds, timeRange, groupBy) {
    const scope = this.buildScope(orgIds);
    const params = [timeRange.startDate, timeRange.endDate, ...scope.params];
    const [rows] = await db.query(
      `SELECT COUNT(lt.id) AS requiredCount,
              SUM(CASE WHEN lr.status = 'completed' THEN 1 ELSE 0 END) AS completedCount
       FROM users u
       JOIN learning_tasks lt ON lt.organizationId = u.organizationId AND lt.status = 'published'
       LEFT JOIN learning_records lr ON lr.taskId = lt.id AND lr.userId = u.id
       WHERE u.role = 'member' AND lt.createdAt >= ? AND lt.createdAt < ?${scope.sql}`,
      params
    );
    const required = Number(rows[0].requiredCount || 0);
    const completed = Number(rows[0].completedCount || 0);
    const result = {
      value: required ? Math.round((completed / required) * 10000) / 100 : 0,
      numerator: completed,
      denominator: required
    };
    if (groupBy === 'month') {
      const [trend] = await db.query(
        `SELECT DATE_FORMAT(lt.createdAt, '%Y-%m') AS month,
                COUNT(lt.id) AS requiredCount,
                SUM(CASE WHEN lr.status = 'completed' THEN 1 ELSE 0 END) AS completedCount
         FROM users u
         JOIN learning_tasks lt ON lt.organizationId = u.organizationId AND lt.status = 'published'
         LEFT JOIN learning_records lr ON lr.taskId = lt.id AND lr.userId = u.id
         WHERE u.role = 'member' AND lt.createdAt >= ? AND lt.createdAt < ?${scope.sql}
         GROUP BY month ORDER BY month`,
        params
      );
      result.trend = trend.map(row => ({
        month: row.month,
        value: Number(row.requiredCount) ? Math.round((Number(row.completedCount) / Number(row.requiredCount)) * 10000) / 100 : 0
      }));
    }
    return result;
  }

  static async queryExamMetric(metric, orgIds, timeRange, groupBy) {
    const scope = this.buildScope(orgIds);
    const params = [timeRange.startDate, timeRange.endDate, ...scope.params];
    const [rows] = await db.query(
      `SELECT COUNT(*) AS examCount, COALESCE(AVG(er.score), 0) AS avgScore,
              SUM(CASE WHEN er.score >= 60 THEN 1 ELSE 0 END) AS passedCount
       FROM exam_records er JOIN users u ON u.id = er.userId
       WHERE er.submittedAt >= ? AND er.submittedAt < ?${scope.sql}`,
      params
    );
    const exams = Number(rows[0].examCount || 0);
    const passed = Number(rows[0].passedCount || 0);
    const value = metric === 'average_exam_score'
      ? Math.round(Number(rows[0].avgScore || 0) * 100) / 100
      : exams ? Math.round((passed / exams) * 10000) / 100 : 0;
    const result = {
      value,
      numerator: metric === 'exam_pass_rate' ? passed : undefined,
      denominator: metric === 'exam_pass_rate' ? exams : undefined,
      details: { examCount: exams }
    };
    if (groupBy === 'month') {
      const [trend] = await db.query(
        `SELECT DATE_FORMAT(er.submittedAt, '%Y-%m') AS month,
                COUNT(*) AS examCount, AVG(er.score) AS avgScore,
                SUM(CASE WHEN er.score >= 60 THEN 1 ELSE 0 END) AS passedCount
         FROM exam_records er JOIN users u ON u.id = er.userId
         WHERE er.submittedAt >= ? AND er.submittedAt < ?${scope.sql}
         GROUP BY month ORDER BY month`,
        params
      );
      result.trend = trend.map(row => ({
        month: row.month,
        value: metric === 'average_exam_score'
          ? Math.round(Number(row.avgScore || 0) * 100) / 100
          : Number(row.examCount) ? Math.round((Number(row.passedCount) / Number(row.examCount)) * 10000) / 100 : 0
      }));
    }
    return result;
  }

  static async queryLearningActivity(metric, orgIds, timeRange, groupBy) {
    const scope = this.buildScope(orgIds);
    const params = [timeRange.startDate, timeRange.endDate, ...scope.params];
    const [rows] = await db.query(
      `SELECT COALESCE(SUM(lr.studySeconds), 0) AS totalSeconds,
              COUNT(DISTINCT CASE WHEN lr.studySeconds > 0 THEN lr.userId END) AS activeMembers
       FROM learning_records lr JOIN users u ON u.id = lr.userId
       WHERE lr.updatedAt >= ? AND lr.updatedAt < ?${scope.sql}`,
      params
    );
    const value = metric === 'total_study_hours'
      ? Math.round((Number(rows[0].totalSeconds || 0) / 3600) * 100) / 100
      : Number(rows[0].activeMembers || 0);
    const result = { value };
    if (groupBy === 'month') {
      const [trend] = await db.query(
        `SELECT DATE_FORMAT(lr.updatedAt, '%Y-%m') AS month,
                SUM(lr.studySeconds) AS totalSeconds,
                COUNT(DISTINCT CASE WHEN lr.studySeconds > 0 THEN lr.userId END) AS activeMembers
         FROM learning_records lr JOIN users u ON u.id = lr.userId
         WHERE lr.updatedAt >= ? AND lr.updatedAt < ?${scope.sql}
         GROUP BY month ORDER BY month`,
        params
      );
      result.trend = trend.map(row => ({
        month: row.month,
        value: metric === 'total_study_hours'
          ? Math.round((Number(row.totalSeconds || 0) / 3600) * 100) / 100
          : Number(row.activeMembers || 0)
      }));
    }
    return result;
  }

  static buildAnswer(parsed, scopeName, result) {
    const unit = parsed.metricDefinition.unit;
    let answer = `${parsed.timeRange.label}${scopeName}${parsed.metricDefinition.name}为${result.value}${unit}。`;
    if (result.denominator !== undefined) {
      answer += `统计口径为${result.numerator || 0}/${result.denominator || 0}。`;
    }
    if (result.trend && result.trend.length > 1) {
      const lowest = result.trend.reduce((a, b) => a.value <= b.value ? a : b);
      answer += `其中${lowest.month}最低，为${lowest.value}${unit}。`;
    }
    return answer;
  }
}

module.exports = OrganizationQueryService;
