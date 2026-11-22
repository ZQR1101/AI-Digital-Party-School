const db = require('../config/db');
const { requireStatisticsRole, resolveOrganizationScope } = require('./organizationAccess');
const { parseOrganizationQuery, toUtcSqlDate } = require('../ai/queryParser');
const RagService = require('./ragService');
const { queryAssessmentStats } = require('./assessmentStatistics');
const { queryTaskCompletion } = require('./taskCompletionStatistics');

function placeholders(values) {
  return values.map(() => '?').join(',');
}

function chartMonths(timeRange) {
  const month = new Date(`${timeRange.startDate.slice(0, 7)}-01T00:00:00Z`);
  const end = new Date(`${timeRange.endDate.slice(0, 10)}T00:00:00Z`);
  const labels = [];
  while (month < end) {
    labels.push(month.toISOString().slice(0, 7));
    month.setUTCMonth(month.getUTCMonth() + 1);
  }
  return labels;
}

class OrganizationQueryService {
  static async query(message, actor) {
    requireStatisticsRole(actor);
    const parsed = parseOrganizationQuery(message);
    const { organization, orgIds } = await resolveOrganizationScope(actor, { name: parsed.organizationName });
    const result = await this.executeMetric(parsed.metric, orgIds, parsed.timeRange, parsed.groupBy);
    const knowledge = await RagService.search(`${parsed.metricDefinition.name} 统计口径`, 2);
    const scopeName = organization ? organization.name : '全部组织';
    const answer = this.buildAnswer(parsed, scopeName, result);
    const months = result.trend?.length ? chartMonths(parsed.timeRange) : [];
    const values = new Map((result.trend || []).map(item => [item.month, item.value]));
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
        hasData: result.hasData ?? (result.denominator !== 0),
        unit: parsed.metricDefinition.unit,
        numerator: result.numerator,
        denominator: result.denominator,
        details: result.details || null
      },
      charts: months.length ? [{
        type: 'line',
        title: `${scopeName}${parsed.timeRange.label}${parsed.metricDefinition.name}趋势`,
        xAxis: months,
        series: [{ name: parsed.metricDefinition.name, data: months.map(month => values.get(month) ?? null) }]
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

  static buildScope(orgIds, alias = 'u') {
    if (orgIds == null) return { sql: '', params: [] };
    if (!orgIds.length) return { sql: ' AND 1 = 0', params: [] };
    return { sql: ` AND ${alias}.organizationId IN (${placeholders(orgIds)})`, params: orgIds };
  }

  static async executeMetric(metric, orgIds, timeRange, groupBy) {
    if (metric === 'learning_completion_rate') {
      return queryTaskCompletion(orgIds, timeRange, groupBy);
    }
    if (metric === 'average_exam_score' || metric === 'exam_pass_rate') {
      return this.queryExamMetric(metric, orgIds, timeRange, groupBy);
    }
    if (metric === 'total_study_hours' || metric === 'active_member_count') {
      return this.queryLearningActivity(metric, orgIds, timeRange, groupBy);
    }
    throw new Error(`不支持的指标：${metric}`);
  }

  static async queryExamMetric(metric, orgIds, timeRange, groupBy) {
    const scope = this.buildScope(orgIds);
    const [totals] = await queryAssessmentStats({ scope, timeRange });
    const exams = Number(totals.examCount);
    const passed = Number(totals.passedCount);
    const isPassRate = metric === 'exam_pass_rate';
    const valueForRow = row => isPassRate
      ? (Number(row.examCount) ? Math.round(Number(row.passedCount) / Number(row.examCount) * 10000) / 100 : 0)
      : Math.round(Number(row.avgScore) * 100) / 100;
    const result = {
      value: valueForRow(totals),
      hasData: exams > 0,
      numerator: isPassRate ? passed : undefined,
      denominator: isPassRate ? exams : undefined,
      details: { examCount: exams }
    };
    if (groupBy === 'month') {
      const trend = await queryAssessmentStats({ scope, timeRange, groupBy });
      result.trend = trend.map(row => ({ month: row.month, value: valueForRow(row) }));
    }
    return result;
  }

  static async queryLearningActivity(metric, orgIds, timeRange, groupBy) {
    const scope = this.buildScope(orgIds);
    const params = [toUtcSqlDate(timeRange.startDate), toUtcSqlDate(timeRange.endDate), ...scope.params];
    const [rows] = await db.query(
      `SELECT COUNT(*) AS recordCount, COALESCE(SUM(lr.studySeconds), 0) AS totalSeconds,
              COUNT(DISTINCT CASE WHEN lr.studySeconds > 0 THEN lr.userId END) AS activeMembers
       FROM learning_records lr JOIN users u ON u.id = lr.userId
       WHERE lr.updatedAt >= ? AND lr.updatedAt < ?${scope.sql}`,
      params
    );
    const value = metric === 'total_study_hours'
      ? Math.round((Number(rows[0].totalSeconds || 0) / 3600) * 100) / 100
      : Number(rows[0].activeMembers || 0);
    const result = { value, hasData: Number(rows[0].recordCount) > 0 };
    if (groupBy === 'month') {
      const [trend] = await db.query(
        `SELECT DATE_FORMAT(DATE_ADD(lr.updatedAt, INTERVAL 8 HOUR), '%Y-%m') AS month,
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
    if (result.hasData === false || result.denominator === 0) {
      return `${parsed.timeRange.label}${scopeName}暂无可用于统计${parsed.metricDefinition.name}的记录。`;
    }
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
