// 原生 Function Calling 架构测试
// 验证 identifyQueryIntent 默认走 tools/tool_choice，并能解析 tool_calls；
// 原生失败时自动回退到提示词 JSON 模式。
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const { AIClient } = require('../src/services/aiClient');

function setupEnv(t, mode) {
  const config = {
    AI_API_URL: 'http://127.0.0.1:9/v1/chat/completions',
    AI_API_KEY: 'test-key',
    AI_MODEL: 'test-model',
    AI_TIMEOUT_MS: '800',
    AI_TOOL_MODE: mode
  };
  const original = Object.fromEntries(Object.keys(config).map(k => [k, process.env[k]]));
  Object.assign(process.env, config);
  t.after(() => {
    for (const [k, v] of Object.entries(original)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
}

function toolCallResponse(name, args) {
  return {
    data: {
      choices: [{
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [{
            id: 'call_1',
            type: 'function',
            function: { name, arguments: JSON.stringify(args) }
          }]
        }
      }],
      usage: { prompt_tokens: 10, completion_tokens: 5 }
    }
  };
}

test('原生 Function Calling：请求携带 tools/tool_choice，解析 tool_calls 响应', async (t) => {
  setupEnv(t, 'function');
  let captured;
  const originalPost = axios.post;
  axios.post = async (url, payload) => {
    captured = payload;
    return toolCallResponse('query_learning_statistics', {
      metric: 'learning_completion_rate',
      organizationName: null,
      timeRange: '今年',
      groupBy: 'month'
    });
  };
  t.after(() => { axios.post = originalPost; });

  const trace = {};
  const result = await AIClient.identifyQueryIntent('今年学习完成率趋势如何', trace);

  assert.ok(Array.isArray(captured.tools), '请求体应包含 tools 数组');
  assert.equal(captured.tool_choice, 'auto', 'tool_choice 应为 auto');
  assert.equal(captured.response_format, undefined, '原生模式不应带 response_format');
  assert.equal(result.tool, 'query_learning_statistics');
  assert.equal(result.parameters.metric, 'learning_completion_rate');
  assert.equal(result.parameters.groupBy, 'month');
  assert.equal(trace.toolMode, 'function');
});

test('提示词回退模式：携带 response_format，解析 JSON content', async (t) => {
  setupEnv(t, 'prompt');
  let captured;
  const originalPost = axios.post;
  axios.post = async (url, payload) => {
    captured = payload;
    return {
      data: {
        choices: [{
          message: {
            role: 'assistant',
            content: JSON.stringify({
              tool: 'query_exam_statistics',
              parameters: { metric: 'exam_pass_rate', organizationName: null, timeRange: '本月' }
            })
          }
        }]
      }
    };
  };
  t.after(() => { axios.post = originalPost; });

  const trace = {};
  const result = await AIClient.identifyQueryIntent('本月考试及格率', trace);

  assert.equal(captured.response_format.type, 'json_object');
  assert.equal(captured.tools, undefined, '提示词模式不应带 tools');
  assert.equal(result.tool, 'query_exam_statistics');
  assert.equal(trace.toolMode, 'prompt');
});

test('extractToolCall 可直接解析标准 OpenAI tool_calls 结构', () => {
  const { extractToolCall } = require('../src/ai/queryTools');
  const message = {
    tool_calls: [{
      function: {
        name: 'query_organization_statistics',
        arguments: '{"metric":"member_distribution","organizationName":null}'
      }
    }]
  };
  const result = extractToolCall(null, message);
  assert.equal(result.tool, 'query_organization_statistics');
  assert.equal(result.parameters.metric, 'member_distribution');
});
