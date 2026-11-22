const { performance } = require('node:perf_hooks');
const { setTimeout: delay } = require('node:timers/promises');
const axios = require('axios');

const NETWORK_ERRORS = new Set(['ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'ENETUNREACH', 'EPIPE', 'ERR_NETWORK']);
const TIMEOUT_ERRORS = new Set(['ECONNABORTED', 'ETIMEDOUT', 'ERR_CANCELED']);
const MAX_ATTEMPTS = 2;
const MIN_RETRY_TIME_MS = 100;

function classifyModelError(error) {
  if (error?.type === 'invalid_output') return error.type;
  if (TIMEOUT_ERRORS.has(error?.code)) return 'timeout';
  const status = error?.response?.status;
  if (status === 429) return 'rate_limited';
  if (status === 401 || status === 403) return 'model_auth';
  if (status >= 500 && status <= 599) return 'upstream_unavailable';
  if (status >= 400 && status <= 499) return 'upstream_request';
  return NETWORK_ERRORS.has(error?.code) ? 'network' : 'model_error';
}

function retryDelay(error) {
  const header = error?.response?.headers?.['retry-after'];
  if (!header) return 100;
  if (/^\d+(?:\.\d+)?$/.test(String(header))) return Math.ceil(Number(header) * 1000);
  const timestamp = Date.parse(header);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : 100;
}

function modelBudget(defaultMs, maximumMs) {
  const config = Number(process.env.AI_TIMEOUT_MS);
  return Math.min(Number.isFinite(config) && config > 0 ? Math.floor(config) : defaultMs, maximumMs);
}

function addUsage(trace, usage) {
  const tokenFields = { prompt_tokens: 'promptTokens', completion_tokens: 'completionTokens', total_tokens: 'totalTokens' };
  for (const [field, key] of Object.entries(tokenFields)) {
    const value = usage?.[field];
    if (Number.isSafeInteger(value) && value >= 0 && value <= 0xffffffff) {
      trace[key] = Math.min(0xffffffff, (trace[key] || 0) + value);
    }
  }
}

async function requestModel({ payload, budgetMs, parse }, trace = {}) {
  const started = performance.now();
  trace.model = payload.model;
  try {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const remaining = Math.floor(budgetMs - (performance.now() - started));
      if (remaining <= 0) break;
      const timeout = attempt === 1 && remaining >= 4 * MIN_RETRY_TIME_MS
        ? Math.floor(remaining * 0.75)
        : remaining;
      trace.attempts = attempt;
      try {
        const response = await axios.post(process.env.AI_API_URL, payload, {
          headers: { Authorization: `Bearer ${process.env.AI_API_KEY}`, 'Content-Type': 'application/json' },
          timeout,
          signal: AbortSignal.timeout(timeout),
          maxRedirects: 0,
          maxContentLength: 256 * 1024
        });
        addUsage(trace, response.data?.usage);
        const message = response.data?.choices?.[0]?.message;
        const result = parse(message?.content, message);
        trace.resultMode = 'model';
        return result;
      } catch (error) {
        const type = classifyModelError(error);
        trace.errorType = type;
        const wait = retryDelay(error);
        if (attempt === MAX_ATTEMPTS || !['timeout', 'network', 'rate_limited', 'upstream_unavailable'].includes(type)
          || wait + MIN_RETRY_TIME_MS >= budgetMs - (performance.now() - started)) break;
        await delay(wait);
      }
    }
    trace.errorType ||= 'timeout';
    trace.fallbackReason = trace.errorType;
    return null;
  } finally {
    trace.modelDurationMs = Math.round(performance.now() - started);
  }
}

module.exports = { modelBudget, requestModel };
