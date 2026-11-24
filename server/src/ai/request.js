const { randomUUID } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const AIAuditService = require('../services/aiAuditService');
const logger = require('../utils/logger');

const { loadActiveActor } = require('../services/organizationAccess');
const ResponseHelper = require('../utils/response');

async function runAiRequest(req, res, scene, operation, execute) {
  const requestId = 'AI-' + randomUUID();
  const started = performance.now();
  const trace = {};
  res.setHeader('X-Request-Id', requestId);
  let actor;
  let result;
  let failure;
  try {
    actor = await loadActiveActor(req.user);
    result = await execute({ actor, trace, requestId });
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
    actor, scene, operation, requestId,
    parsedIntent: scene === 'organization_query' ? result?.query || result?.data?.query : null,
    success: !failure, errorType, durationMs: Math.round(performance.now() - started),
    mode: trace.resultMode, trace
  });

  if (!failure) return ResponseHelper.success(res, result);
  if (isClientError) return ResponseHelper.error(res, failure.message, status, status);
  logger.error('[AI] 请求失败:', requestId, failure.code || 'internal_error');
  return ResponseHelper.error(res, 'AI服务暂时不可用，请稍后重试');
}

module.exports = { runAiRequest };
