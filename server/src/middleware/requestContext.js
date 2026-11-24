/**
 * 请求链路追踪中间件。
 *
 * - 优先复用上游的 X-Request-ID（校验格式：1-64 位 [A-Za-z0-9._-]，防止日志注入）
 * - 否则生成 UUID v4
 * - 回写响应头 X-Request-ID，供前端/网关关联排查
 * - res.on('finish') 输出 JSON 访问日志（method/path/status/耗时/requestId/userId）
 *   并上报基础指标
 */

const crypto = require('crypto');
const logger = require('../utils/logger');
const metrics = require('../utils/metrics');

const REQUEST_ID_HEADER = 'x-request-id';
const REQUEST_ID_RE = /^[A-Za-z0-9._-]{1,64}$/;

function pickRequestId(req) {
  const incoming = req.headers[REQUEST_ID_HEADER];
  if (typeof incoming === 'string' && REQUEST_ID_RE.test(incoming)) return incoming;
  return crypto.randomUUID();
}

function requestContext(req, res, next) {
  const requestId = pickRequestId(req);
  const startedAt = process.hrtime.bigint();
  // 只记路径、丢弃查询参数：URL 中可能带 token/code 等敏感信息，不落日志
  const pathOnly = String(req.originalUrl || req.url || '').split('?')[0];

  req.requestId = requestId;
  res.setHeader('X-Request-ID', requestId);
  metrics.activeRequests.count += 1;

  res.on('finish', () => {
    metrics.activeRequests.count -= 1;
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const statusCode = res.statusCode;
    metrics.observeRequest({
      path: pathOnly,
      method: req.method,
      statusCode,
      durationMs,
    });

    const level = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';
    logger[level]('access', {
      requestId,
      method: req.method,
      path: pathOnly,
      statusCode,
      durationMs: Number(durationMs.toFixed(2)),
      userId: req.user?.userId ?? null,
      userAgent: req.headers['user-agent'] || null,
    });
  });

  next();
}

module.exports = { requestContext, pickRequestId, REQUEST_ID_RE, REQUEST_ID_HEADER };
