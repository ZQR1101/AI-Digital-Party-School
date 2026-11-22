const { z } = require('zod');
const { METRICS, resolveTimeRange } = require('./queryParser');

const ALL_ORGANIZATIONS = /^(?:全校(?:党组织|所有党组织)?|全部(?:党组织|组织)?|所有(?:党组织|组织)|全体(?:党组织|组织))$/;

const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'query_learning_statistics',
      description: '查询党组织学习相关统计数据，包括学习完成率、学习时长、活跃党员人数及月度趋势。用于分析支部学习情况、任务完成度及各月高低走势。',
      parameters: {
        type: 'object',
        properties: {
          metric: {
            type: 'string',
            enum: ['learning_completion_rate', 'total_study_hours', 'active_member_count'],
            description: '统计指标：learning_completion_rate(学习完成率), total_study_hours(学习时长/小时), active_member_count(活跃党员人数)'
          },
          organizationName: {
            type: ['string', 'null'],
            description: '党组织名称，如“学生第一党支部”；查询全校或未指定组织时为 null'
          },
          timeRange: {
            type: 'string',
            description: '统计时间周期，例如“今年”、“去年”、“本月”、“上个月”、“最近3个月”、“最近6个月”、“2026年”、“2026年3月”等，默认“今年”'
          },
          groupBy: {
            type: ['string', 'null'],
            enum: ['month', null],
            description: '时间分组：当需要查看趋势、走势、分析哪几个月较低或较高时传 "month"，单点统计传 null'
          }
        },
        required: ['metric']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'query_exam_statistics',
      description: '查询党组织测评与考试统计数据，包括考试平均分、及格率、参考人次及月度趋势。',
      parameters: {
        type: 'object',
        properties: {
          metric: {
            type: 'string',
            enum: ['average_exam_score', 'exam_pass_rate'],
            description: '统计指标：average_exam_score(考试平均分), exam_pass_rate(考试及格率)'
          },
          organizationName: {
            type: ['string', 'null'],
            description: '党组织名称，如“学生第一党支部”；查询全校或未指定组织时为 null'
          },
          timeRange: {
            type: 'string',
            description: '统计时间周期，例如“今年”、“去年”、“本月”、“上个月”、“最近3个月”等，默认“今年”'
          },
          groupBy: {
            type: ['string', 'null'],
            enum: ['month', null],
            description: '时间分组：当需要趋势或各月走势时传 "month"，否则传 null'
          }
        },
        required: ['metric']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'query_organization_statistics',
      description: '查询党组织基本概况与组织架构统计信息，包括党员人数分布、下属党组织数量等。',
      parameters: {
        type: 'object',
        properties: {
          metric: {
            type: 'string',
            enum: ['organization_overview', 'member_distribution', 'sub_organization_count'],
            description: '统计指标：organization_overview(组织基本概况), member_distribution(党员人数分布), sub_organization_count(下属组织数量)'
          },
          organizationName: {
            type: ['string', 'null'],
            description: '党组织名称，例如“学生第一党支部”；查询全校或根组织时为 null'
          },
          timeRange: {
            type: ['string', 'null'],
            description: '统计时间范围，组织概况统计默认传 null'
          }
        },
        required: ['metric']
      }
    }
  }
];

const textParam = max => z.string().trim().min(1).max(max);

const LearningParamsSchema = z.strictObject({
  metric: z.enum(['learning_completion_rate', 'total_study_hours', 'active_member_count']),
  organizationName: textParam(100).nullable().optional(),
  timeRange: z.union([
    textParam(50),
    z.strictObject({
      label: textParam(50).optional(),
      startDate: textParam(30),
      endDate: textParam(30)
    })
  ]).default('今年'),
  groupBy: z.enum(['month']).nullable().optional()
});

const ExamParamsSchema = z.strictObject({
  metric: z.enum(['average_exam_score', 'exam_pass_rate']),
  organizationName: textParam(100).nullable().optional(),
  timeRange: z.union([
    textParam(50),
    z.strictObject({
      label: textParam(50).optional(),
      startDate: textParam(30),
      endDate: textParam(30)
    })
  ]).default('今年'),
  groupBy: z.enum(['month']).nullable().optional()
});

const OrganizationParamsSchema = z.strictObject({
  metric: z.enum(['organization_overview', 'member_distribution', 'sub_organization_count']).default('organization_overview'),
  organizationName: textParam(100).nullable().optional(),
  timeRange: z.union([
    textParam(50),
    z.strictObject({
      label: textParam(50).optional(),
      startDate: textParam(30),
      endDate: textParam(30)
    })
  ]).nullable().optional()
});

const ToolCallSchema = z.strictObject({
  tool: z.enum(['query_learning_statistics', 'query_exam_statistics', 'query_organization_statistics']),
  parameters: z.record(z.any())
});

function invalidToolOutput(message) {
  return Object.assign(new Error(message), { type: 'invalid_output', statusCode: 400 });
}

function validateToolCall(rawCall) {
  const parsed = ToolCallSchema.safeParse(rawCall);
  if (!parsed.success) {
    throw invalidToolOutput(`无效的工具调用结构: ${parsed.error.issues.map(i => i.message).join(';')}`);
  }
  const { tool, parameters } = parsed.data;
  let validatedParams;
  if (tool === 'query_learning_statistics') {
    const res = LearningParamsSchema.safeParse(parameters);
    if (!res.success) throw invalidToolOutput(`query_learning_statistics 参数不合法: ${res.error.issues.map(i => i.message).join(';')}`);
    validatedParams = res.data;
  } else if (tool === 'query_exam_statistics') {
    const res = ExamParamsSchema.safeParse(parameters);
    if (!res.success) throw invalidToolOutput(`query_exam_statistics 参数不合法: ${res.error.issues.map(i => i.message).join(';')}`);
    validatedParams = res.data;
  } else if (tool === 'query_organization_statistics') {
    const res = OrganizationParamsSchema.safeParse(parameters);
    if (!res.success) throw invalidToolOutput(`query_organization_statistics 参数不合法: ${res.error.issues.map(i => i.message).join(';')}`);
    validatedParams = res.data;
  }
  return { tool, parameters: validatedParams };
}

function extractToolCall(content, message) {
  // 1. Check if tool_calls array exists on message (OpenAI standard)
  if (message?.tool_calls && Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
    const call = message.tool_calls[0];
    const toolName = call.function?.name;
    const argsRaw = call.function?.arguments;
    let parameters = {};
    if (typeof argsRaw === 'string') {
      try {
        parameters = JSON.parse(argsRaw);
      } catch {
        throw invalidToolOutput('工具调用参数不是合法的JSON');
      }
    } else if (typeof argsRaw === 'object' && argsRaw !== null) {
      parameters = argsRaw;
    }
    return validateToolCall({ tool: toolName, parameters });
  }

  // 2. Check if content contains structured JSON
  if (typeof content === 'string' && content.trim()) {
    const raw = content.trim();
    const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(raw);
    let json;
    try {
      json = JSON.parse(match ? match[1] : raw);
    } catch {
      throw invalidToolOutput('模型返回不是合法的JSON');
    }
    const tool = json.tool || json.name || json.function;
    const parameters = json.parameters || json.arguments || json.params || json;
    return validateToolCall({ tool, parameters });
  }

  throw invalidToolOutput('模型未返回有效的数据查询工具调用');
}

function normalizeToolParameters(toolCall, now = new Date()) {
  const { tool, parameters } = toolCall;
  const rawOrg = typeof parameters.organizationName === 'string' ? parameters.organizationName.trim() : null;
  const organizationName = !rawOrg || ALL_ORGANIZATIONS.test(rawOrg) ? null : rawOrg;

  let timeRange;
  if (typeof parameters.timeRange === 'object' && parameters.timeRange !== null && parameters.timeRange.startDate) {
    timeRange = {
      label: parameters.timeRange.label || `${parameters.timeRange.startDate.slice(0, 10)}至${parameters.timeRange.endDate.slice(0, 10)}`,
      startDate: parameters.timeRange.startDate,
      endDate: parameters.timeRange.endDate
    };
  } else {
    timeRange = resolveTimeRange(parameters.timeRange || '今年', now);
  }

  const metric = parameters.metric;
  const metricDefinition = METRICS[metric] || { name: metric, unit: '' };

  return {
    tool,
    metric,
    metricDefinition,
    organizationName,
    timeRange,
    groupBy: parameters.groupBy === 'month' ? 'month' : null
  };
}

function toolForMetric(metric) {
  if (['learning_completion_rate', 'total_study_hours', 'active_member_count'].includes(metric)) {
    return 'query_learning_statistics';
  }
  if (['average_exam_score', 'exam_pass_rate'].includes(metric)) {
    return 'query_exam_statistics';
  }
  if (['organization_overview', 'member_distribution', 'sub_organization_count'].includes(metric)) {
    return 'query_organization_statistics';
  }
  return 'query_learning_statistics';
}

function mapParsedQueryToToolCall(parsed) {
  const tool = toolForMetric(parsed.metric);
  return {
    tool,
    parameters: {
      metric: parsed.metric,
      organizationName: parsed.organizationName,
      timeRange: parsed.timeRange?.label || '今年',
      groupBy: parsed.groupBy
    }
  };
}

module.exports = {
  TOOL_DEFINITIONS,
  LearningParamsSchema,
  ExamParamsSchema,
  OrganizationParamsSchema,
  ToolCallSchema,
  validateToolCall,
  extractToolCall,
  normalizeToolParameters,
  toolForMetric,
  mapParsedQueryToToolCall
};
