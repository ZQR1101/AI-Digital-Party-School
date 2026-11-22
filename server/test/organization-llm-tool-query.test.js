const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const db = require('../src/config/db');
const OrganizationQueryService = require('../src/services/organizationQueryService');
const { AIClient } = require('../src/services/aiClient');
const {
  validateToolCall,
  extractToolCall,
  normalizeToolParameters,
  TOOL_DEFINITIONS
} = require('../src/ai/queryTools');
const {
  requireStatisticsRole,
  selectOrganizationScope,
  resolveOrganizationScope
} = require('../src/services/organizationAccess');
const organizationAccess = require('../src/services/organizationAccess');

function configureModel(t, timeout = '800') {
  const config = {
    AI_API_URL: 'http://127.0.0.1:1',
    AI_API_KEY: 'test-token',
    AI_MODEL: 'test-model',
    AI_TIMEOUT_MS: timeout
  };
  const original = Object.fromEntries(Object.keys(config).map(key => [key, process.env[key]]));
  Object.assign(process.env, config);
  t.after(() => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

test.after(() => db.end().catch(() => {}));

test('Zod 严格校验三个工具的结构化参数，拒绝未知工具与非法参数', () => {
  // 1. query_learning_statistics 合法校验
  const validLearning = validateToolCall({
    tool: 'query_learning_statistics',
    parameters: {
      metric: 'learning_completion_rate',
      organizationName: '学生第一党支部',
      timeRange: '今年',
      groupBy: 'month'
    }
  });
  assert.equal(validLearning.tool, 'query_learning_statistics');
  assert.equal(validLearning.parameters.metric, 'learning_completion_rate');
  assert.equal(validLearning.parameters.groupBy, 'month');

  // 2. query_exam_statistics 合法校验
  const validExam = validateToolCall({
    tool: 'query_exam_statistics',
    parameters: {
      metric: 'average_exam_score',
      organizationName: '学生第一党支部',
      timeRange: '最近3个月',
      groupBy: 'month'
    }
  });
  assert.equal(validExam.tool, 'query_exam_statistics');
  assert.equal(validExam.parameters.metric, 'average_exam_score');

  // 3. query_organization_statistics 合法校验
  const validOrg = validateToolCall({
    tool: 'query_organization_statistics',
    parameters: {
      metric: 'member_distribution',
      organizationName: null
    }
  });
  assert.equal(validOrg.tool, 'query_organization_statistics');
  assert.equal(validOrg.parameters.metric, 'member_distribution');

  // 4. 拒绝未授权/任意SQL工具
  assert.throws(() => validateToolCall({
    tool: 'execute_arbitrary_sql',
    parameters: { sql: 'SELECT * FROM users' }
  }), /不支持的数据查询工具|无效的工具调用结构/);

  // 5. 拒绝非法指标
  assert.throws(() => validateToolCall({
    tool: 'query_learning_statistics',
    parameters: { metric: 'delete_records' }
  }), /参数不合法/);
});

test('支持提取 OpenAI tool_calls 与 JSON 两种模型返回格式', () => {
  // 1. OpenAI tool_calls 格式
  const messageWithToolCall = {
    tool_calls: [{
      function: {
        name: 'query_learning_statistics',
        arguments: JSON.stringify({
          metric: 'learning_completion_rate',
          organizationName: '第一党支部',
          timeRange: '今年',
          groupBy: 'month'
        })
      }
    }]
  };
  const fromToolCalls = extractToolCall(null, messageWithToolCall);
  assert.equal(fromToolCalls.tool, 'query_learning_statistics');
  assert.equal(fromToolCalls.parameters.metric, 'learning_completion_rate');

  // 2. Markdown 代码块中的 JSON 格式
  const markdownContent = '```json\n{"tool":"query_exam_statistics","parameters":{"metric":"exam_pass_rate","timeRange":"本月"}}\n```';
  const fromMarkdown = extractToolCall(markdownContent, null);
  assert.equal(fromMarkdown.tool, 'query_exam_statistics');
  assert.equal(fromMarkdown.parameters.metric, 'exam_pass_rate');
});

test('参数规范化将自然语言周期转换为标准时间边界与口径', () => {
  const normalized = normalizeToolParameters({
    tool: 'query_learning_statistics',
    parameters: {
      metric: 'learning_completion_rate',
      organizationName: '学生第一党支部',
      timeRange: '今年',
      groupBy: 'month'
    }
  }, new Date('2026-11-20T00:00:00Z'));

  assert.equal(normalized.metric, 'learning_completion_rate');
  assert.equal(normalized.organizationName, '学生第一党支部');
  assert.equal(normalized.timeRange.label, '2026年');
  assert.equal(normalized.timeRange.startDate, '2026-01-01 00:00:00');
  assert.equal(normalized.timeRange.endDate, '2027-01-01 00:00:00');
  assert.equal(normalized.groupBy, 'month');
});

test('权限与组织范围校验：支部书记被限制在权限范围内，普通党员被拒绝', () => {
  const rows = [
    { id: 1, name: '党委', parentId: null },
    { id: 2, name: '第一党总支', parentId: 1 },
    { id: 3, name: '学生第一党支部', parentId: 2 },
    { id: 4, name: '学生第二党支部', parentId: 2 }
  ];

  // 普通党员角色直接拒绝
  assert.throws(() => requireStatisticsRole({ role: 'member', organizationId: 3 }), /仅对管理员和支部书记开放/);

  // 支部书记查询自身支部：成功
  const secretary = { role: 'secretary', organizationId: 3 };
  const scope = selectOrganizationScope(secretary, { name: '学生第一党支部' }, rows);
  assert.equal(scope.organization.id, 3);
  assert.deepEqual(scope.orgIds, [3]);

  // 支部书记越权查询其他支部：拒绝 403
  assert.throws(
    () => selectOrganizationScope(secretary, { name: '学生第二党支部' }, rows),
    /未找到可查询的组织，请提供权限范围内的完整组织名称/
  );

  // 管理员查询全部组织：orgIds 为 null 表示全校
  const admin = { role: 'admin' };
  const adminScope = selectOrganizationScope(admin, {}, rows);
  assert.equal(adminScope.organization, null);
  assert.equal(adminScope.orgIds, null);
});

test('完整流程：管理员输入复杂自然语言，AI识别意图、调用工具、查库并生成低月份分析和ECharts图表', async t => {
  configureModel(t);

  // 模拟 LLM 第一次返回 Tool Calling：识别为 query_learning_statistics，按月分组
  // 模拟 LLM 第二次返回基于事实的分析：指出2月、3月较低
  const mockTrendData = [
    { month: '2026-01', value: 92.5, numerator: 925, denominator: 1000 },
    { month: '2026-02', value: 60.0, numerator: 600, denominator: 1000 },
    { month: '2026-03', value: 65.0, numerator: 650, denominator: 1000 },
    { month: '2026-04', value: 88.0, numerator: 880, denominator: 1000 }
  ];

  let requestCount = 0;
  t.mock.method(axios, 'post', async (_, payload) => {
    requestCount++;
    if (requestCount === 1) {
      // 意图理解与 Tool Calling
      return {
        data: {
          choices: [{
            message: {
              content: JSON.stringify({
                tool: 'query_learning_statistics',
                parameters: {
                  metric: 'learning_completion_rate',
                  organizationName: '学生第一党支部',
                  timeRange: '今年',
                  groupBy: 'month'
                }
              })
            }
          }],
          usage: { total_tokens: 150 }
        }
      };
    } else {
      // 事实分析解释（数字完全取自 mockTrendData 事实）
      return {
        data: {
          choices: [{
            message: {
              content: JSON.stringify({
                analysis: '学生第一党支部2026年整体学习完成率为76.38%。月度分析显示，2026-02（60.0%）和2026-03（65.0%）完成率相对较低；最高月份为2026-01（92.5%）。'
              })
            }
          }],
          usage: { total_tokens: 220 }
        }
      };
    }
  });

  // Mock 固定数据库服务层返回真实的 MySQL 统计结果
  t.mock.method(OrganizationQueryService, 'executeTool', async (tool, metric, orgIds, timeRange, groupBy) => {
    assert.equal(tool, 'query_learning_statistics');
    assert.equal(metric, 'learning_completion_rate');
    assert.equal(groupBy, 'month');
    return {
      value: 76.38,
      hasData: true,
      numerator: 3055,
      denominator: 4000,
      trend: mockTrendData
    };
  });

  // Mock 组织范围解析，避免测试依赖外部真实数据库连接
  t.mock.method(organizationAccess, 'resolveOrganizationScope', async () => ({
    organization: { id: 3, name: '学生第一党支部' },
    orgIds: [3]
  }));

  const actor = { role: 'admin' };
  const trace = {};
  const userMessage = '帮我分析第一党支部今年的学习情况，看看哪几个月完成率比较低。';
  const response = await OrganizationQueryService.query(userMessage, actor, trace);

  // 1. 验证工具调用被正确记录
  assert.equal(trace.toolCalled, 'query_learning_statistics');
  assert.equal(trace.intentMode, 'llm');
  assert.equal(trace.analysisMode, 'llm');

  // 2. 验证返回的数据结构
  assert.equal(response.scene, 'organization_query');
  assert.equal(response.query.tool, 'query_learning_statistics');
  assert.equal(response.query.metric, 'learning_completion_rate');
  assert.equal(response.data.value, 76.38);

  // 3. 验证 AI 分析文本包含了较低月份分析
  assert.match(response.answer, /2026-02.*60/);
  assert.match(response.answer, /2026-03.*65/);

  // 4. 验证生成的 ECharts 图表结构
  assert.equal(response.charts.length, 1);
  const chart = response.charts[0];
  assert.equal(chart.type, 'line');
  assert.deepEqual(chart.xAxis.slice(0, 4), ['2026-01', '2026-02', '2026-03', '2026-04']);
  assert.equal(chart.series[0].name, '学习完成率');
  assert.equal(chart.series[0].data[0], 92.5);
  assert.equal(chart.series[0].data[1], 60.0);
});

test('防模型幻觉验证：当模型分析编造未经数据证实的虚假数字时，触发安全回退为确定性事实说明', async t => {
  configureModel(t);

  const mockTrendData = [
    { month: '2026-01', value: 90.0, numerator: 90, denominator: 100 },
    { month: '2026-02', value: 50.0, numerator: 50, denominator: 100 }
  ];

  let requestCount = 0;
  t.mock.method(axios, 'post', async () => {
    requestCount++;
    if (requestCount === 1) {
      return {
        data: {
          choices: [{
            message: {
              content: JSON.stringify({
                tool: 'query_learning_statistics',
                parameters: { metric: 'learning_completion_rate', timeRange: '今年', groupBy: 'month' }
              })
            }
          }]
        }
      };
    } else {
      // 故意编造一个数据中根本不存在的数字 9999 和虚假排名 42
      return {
        data: {
          choices: [{
            message: {
              content: JSON.stringify({
                analysis: '虚构数字：有9999人未完成，排名第42位。'
              })
            }
          }]
        }
      };
    }
  });

  t.mock.method(OrganizationQueryService, 'executeTool', async () => ({
    value: 70.0,
    hasData: true,
    numerator: 140,
    denominator: 200,
    trend: mockTrendData
  }));

  const trace = {};
  const response = await OrganizationQueryService.query('分析今年的完成率走势', { role: 'admin' }, trace);

  // 验证防幻觉拦截生效，分析模式回退为 deterministic
  assert.equal(trace.analysisMode, 'deterministic');
  assert.ok(!response.answer.includes('9999'));
  assert.match(response.answer, /2026-02.*50/);
});

test('降级韧性：当 AI 服务未配置或发生超时时，自动回退到规则解析与确定性分析，不影响业务可用性', async t => {
  // 不配置 AI API KEY
  const originalKey = process.env.AI_API_KEY;
  delete process.env.AI_API_KEY;
  t.after(() => { process.env.AI_API_KEY = originalKey; });

  t.mock.method(OrganizationQueryService, 'executeTool', async () => ({
    value: 85.0,
    hasData: true,
    numerator: 85,
    denominator: 100,
    trend: [
      { month: '2026-01', value: 95.0 },
      { month: '2026-02', value: 75.0 }
    ]
  }));

  t.mock.method(organizationAccess, 'resolveOrganizationScope', async () => ({
    organization: { id: 3, name: '学生第一党支部' },
    orgIds: [3]
  }));

  const trace = {};
  const response = await OrganizationQueryService.query('学生第一党支部今年学习完成率趋势', { role: 'admin' }, trace);

  assert.equal(trace.intentMode, 'rules');
  assert.equal(trace.analysisMode, 'deterministic');
  assert.equal(response.data.metric, 'learning_completion_rate');
  assert.equal(response.data.value, 85);
  assert.match(response.answer, /学生第一党支部.*85%/);
  assert.equal(response.charts.length, 1);
});
