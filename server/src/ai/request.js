const { randomUUID } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const AIAuditService = require('../services/aiAuditService');
const logger = require('../utils/logger');

const { loadActiveActor } = require('../services/organizationAccess');
const ResponseHelper = require('../utils/response');

async function runAiRequest(req, res, scene, operation, execute) {
  // 全链路追踪：复用 requestContext 注入的全局 requestId（与 HTTP 访问日志可关联）；
  // AI 独立执行编号另用 aiRunId，绝不覆盖响应头 X-Request-ID。
  const httpRequestId = typeof req.requestId === 'string' && req.requestId ? req.requestId : null;
  const aiRunId = 'AI-' + randomUUID();
  if (!httpRequestId) res.setHeader('X-Request-Id', aiRunId); // 兜底：未经 requestContext 的直接调用
  const started = performance.now();
  const trace = { aiRunId };
  let actor;
  let result;
  let failure;
  try {
    actor = await loadActiveActor(req.user);
    result = await execute({ actor, trace, requestId: aiRunId });
  } catch (error) {
    failure = error;
  }

  const status = failure?.statusCode;
  const isClientError = Number.isInteger(status) && status >= 400 && status < 500;
  const errorType = failure
    ? { 400: 'invalid_request', 401: 'unauthorized', 403: 'forbidden', 404: 'not_found' }[status]
      || (isClientError ? 'request_error' : 'internal_error')
    : trace.errorType;
  await AIAuditService.record({
    actor, scene, operation,
    // 审计表的 requestId 字段存全局链路 ID（无则回退 aiRunId），保证与访问日志同 ID 可查
    requestId: httpRequestId || aiRunId,
    parsedIntent: scene === 'organization_query' ? result?.query || result?.data?.query : null,
    success: !failure, errorType, durationMs: Math.round(performance.now() - started),
    mode: trace.resultMode, trace
  });

  if (!failure) return ResponseHelper.success(res, result);
  if (isClientError) return ResponseHelper.error(res, failure.message, status, status);
  logger.error('[AI] 请求失败:', { requestId: httpRequestId || aiRunId, aiRunId, error: failure });
  return ResponseHelper.error(res, 'AI服务暂时不可用，请稍后重试');
}

module.exports = { runAiRequest };
