const db = require('../config/db');
const organizationAccess = require('./organizationAccess');
const { parseOrganizationQuery, toUtcSqlDate, METRICS } = require('../ai/queryParser');
const RagService = require('./ragService');
const { queryAssessmentStats } = require('./assessmentStatistics');
const { queryTaskCompletion } = require('./taskCompletionStatistics');
const { AIClient } = require('./aiClient');
const {
  validateToolCall,
  normalizeToolParameters,
  mapParsedQueryToToolCall,
  toolForMetric
} = require('../ai/queryTools');

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
  static async query(message, actor, trace = {}) {
    // 1. Role permission check
    organizationAccess.requireStatisticsRole(actor);

    // 2. LLM Intent Understanding & Tool Selection (with graceful fallback)
    let toolCall = null;
    try {
      toolCall = await AIClient.identifyQueryIntent(message, trace);
    } catch (err) {
      trace.intentError = err.message;
    }

    let parsed = null;
    if (toolCall) {
      try {
        const validated = validateToolCall(toolCall);
        parsed = normalizeToolParameters(validated);
        trace.toolCalled = validated.tool;
        trace.intentMode = 'llm';
      } catch (validationErr) {
        trace.validationError = validationErr.message;
      }
    }

    if (!parsed) {
      const ruleParsed = parseOrganizationQuery(message);
      const mappedCall = mapParsedQueryToToolCall(ruleParsed);
      const validated = validateToolCall(mappedCall);
      parsed = normalizeToolParameters(validated);
      trace.toolCalled = validated.tool;
      trace.intentMode = 'rules';
    }

    // 3. User Permission & Organization Scope Validation
    const { organization, orgIds } = await organizationAccess.resolveOrganizationScope(actor, { name: parsed.organizationName });

    // 4. Tool Execution via Fixed Service Layer (No arbitrary SQL execution allowed)
    const result = await this.executeTool(
      parsed.tool,
      parsed.metric,
      orgIds,
      parsed.timeRange,
      parsed.groupBy,
      organization
    );

    // 5. RAG Knowledge Search for metric definition
    const knowledge = await RagService.search(`${parsed.metricDefinition.name} 统计口径`, 2);
    const scopeName = organization ? organization.name : '全部组织';

    // 6. LLM Grounded Analysis & Explanation (strictly fact-based, no hallucination)
    let analysis = null;
    try {
      analysis = await AIClient.generateGroundedAnalysis({
        question: message,
        query: {
          metricName: parsed.metricDefinition.name,
          unit: parsed.metricDefinition.unit
        },
        result,
        scopeName,
        knowledge
      }, trace);
      if (analysis) trace.analysisMode = 'llm';
    } catch (err) {
      trace.analysisError = err.message;
    }

    const answer = analysis || this.buildDataGroundedAnswer(parsed, scopeName, result, message);
    if (!analysis) trace.analysisMode = 'deterministic';

    // 7. Construct ECharts chart data
    const months = result.trend?.length ? chartMonths(parsed.timeRange) : [];
    const values = new Map((result.trend || []).map(item => [item.month, item.value]));

    let charts = [];
    if (months.length) {
      charts = [{
        type: 'line',
        title: `${scopeName}${parsed.timeRange.label}${parsed.metricDefinition.name}趋势`,
        xAxis: months,
        series: [{ name: parsed.metricDefinition.name, data: months.map(month => values.get(month) ?? null) }]
      }];
    } else if (result.details?.organizations?.length && parsed.metric === 'member_distribution') {
      const topOrgs = result.details.organizations.slice(0, 10);
      charts = [{
        type: 'bar',
        title: `${scopeName}党员人数分布`,
        xAxis: topOrgs.map(o => o.name),
        series: [{ name: '党员人数', data: topOrgs.map(o => o.directMembers) }]
      }];
    }

    return {
      scene: 'organization_query',
      answer,
      query: {
        intent: 'metric_query',
        tool: parsed.tool,
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
        trend: result.trend || null,
        details: result.details || null
      },
      charts,
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

  static async executeTool(tool, metric, orgIds, timeRange, groupBy, organization) {
    if (tool === 'query_learning_statistics') {
      if (metric === 'learning_completion_rate') {
        return queryTaskCompletion(orgIds, timeRange, groupBy);
      }
      if (metric === 'total_study_hours' || metric === 'active_member_count') {
        return this.queryLearningActivity(metric, orgIds, timeRange, groupBy);
      }
    }
    if (tool === 'query_exam_statistics') {
      return this.queryExamMetric(metric, orgIds, timeRange, groupBy);
    }
    if (tool === 'query_organization_statistics') {
      return this.queryOrganizationInfo(metric, orgIds, organization);
    }
    return this.executeMetric(metric, orgIds, timeRange, groupBy);
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
    if (['member_distribution', 'organization_overview', 'sub_organization_count'].includes(metric)) {
      return this.queryOrganizationInfo(metric, orgIds);
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

  static async queryOrganizationInfo(metric, orgIds, organization) {
    const scope = orgIds == null ? '' : orgIds.length ? 'WHERE o.id IN (?)' : 'WHERE 1 = 0';
    const params = orgIds?.length ? [orgIds] : [];
    const [orgRows] = await db.query(
      `SELECT o.id, o.name, o.type, o.parentId, o.leaderUserId, u.realName AS leaderName,
              (SELECT COUNT(*) FROM users usr WHERE usr.organizationId = o.id AND usr.status = 1) AS directMembers
       FROM organizations o
       LEFT JOIN users u ON u.id = o.leaderUserId
       ${scope}
       ORDER BY o.id`,
      params
    );

    const totalMembers = orgRows.reduce((sum, row) => sum + Number(row.directMembers || 0), 0);
    const subCount = organization ? Math.max(0, orgRows.length - 1) : orgRows.length;
    let value = totalMembers;
    if (metric === 'sub_organization_count') value = subCount;

    return {
      value,
      hasData: orgRows.length > 0,
      details: {
        organizationName: organization?.name || '全部组织',
        leaderName: organization?.leaderName || orgRows[0]?.leaderName || '未指定',
        totalMembers,
        subOrganizationCount: subCount,
        organizations: orgRows.map(r => ({ id: r.id, name: r.name, directMembers: Number(r.directMembers || 0) }))
      }
    };
  }

  static buildAnswer(parsed, scopeName, result, userQuestion = '') {
    return this.buildDataGroundedAnswer(parsed, scopeName, result, userQuestion);
  }

  static buildDataGroundedAnswer(parsed, scopeName, result, userQuestion = '') {
    const unit = parsed.metricDefinition.unit || '';
    if (result.hasData === false || result.denominator === 0) {
      return `${parsed.timeRange.label}${scopeName}暂无可用于统计${parsed.metricDefinition.name}的记录。`;
    }
    let answer = `${parsed.timeRange.label}${scopeName}${parsed.metricDefinition.name}为${result.value}${unit}。`;
    if (result.denominator !== undefined) {
      answer += `统计口径为${result.numerator || 0}/${result.denominator || 0}。`;
    }
    if (result.trend && result.trend.length > 0) {
      const validPoints = result.trend.filter(item => item.value != null);
      if (validPoints.length > 1) {
        const sorted = [...validPoints].sort((a, b) => a.value - b.value);
        const lowest = sorted[0];
        const highest = sorted[sorted.length - 1];

        // Specific analysis when asked about lower/higher months or trends
        if (/低|哪几个月|哪些月|月份|趋势|走势|分析/.test(userQuestion)) {
          const avg = result.value;
          const lowMonths = sorted.filter(item => item.value <= avg);
          if (lowMonths.length > 0 && lowMonths.length < sorted.length) {
            answer += `月度趋势分析显示，${lowMonths.map(m => `${m.month}（${m.value}${unit}）`).join('、')}相对较低；最高月份为${highest.month}（${highest.value}${unit}）。`;
          } else {
            answer += `其中${lowest.month}最低，为${lowest.value}${unit}；最高为${highest.month}（${highest.value}${unit}）。`;
          }
        } else {
          answer += `其中${lowest.month}最低，为${lowest.value}${unit}。`;
        }
      }
    }
    return answer;
  }
}

module.exports = OrganizationQueryService;
