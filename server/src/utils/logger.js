/**
 * JSON 结构化日志工具。
 *
 * - 单行 JSON 输出到 stdout/stderr，便于容器环境采集（Docker / pm2 / Loki 等）
 * - 字段：timestamp、level、message、requestId（由请求上下文中间件注入）、其余自定义 meta
 * - 敏感字段（password/token/secret/authorization 等）自动脱敏
 * - 级别过滤：LOG_LEVEL 环境变量（debug < info < warn < error，默认 info）
 * - Error 对象序列化为 { name, message, stack }
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

const SENSITIVE_KEY_RE = /(password|passwd|secret|token|authorization|apikey|api_key|cookie)/i;
const MASK = '***';

// 文本级脱敏：Error message/stack 里按 key 脱敏无效，按模式抓取 token=xxx / Bearer xxx 等
const SENSITIVE_TEXT_RE = /\b(password|passwd|secret|(?:api[_-]?key|access[_-]?key|refresh[_-]?token|access[_-]?token|id[_-]?token|session[_-]?id|token|code)|authorization)\s*[:=]\s*["']?([A-Za-z0-9._~+/=@%&-]{6,})["']?/gi;
const BEARER_RE = /\bBearer\s+([A-Za-z0-9._~+/=@%&-]{10,})/gi;

/** 对自由文本（错误消息/堆栈）做模式级脱敏，避免 token=xxx、Bearer xxx 原样落盘 */
function scrubText(text) {
  if (typeof text !== 'string' || !text) return text;
  return text
    .replace(BEARER_RE, 'Bearer ***')
    .replace(SENSITIVE_TEXT_RE, (m, key) => `${key}=***`);
}

let minLevel = LEVELS[String(process.env.LOG_LEVEL || 'info').toLowerCase()] || LEVELS.info;
// 可注入的输出通道，测试时替换为收集器
let sink = null;

function setSink(fn) {
  sink = fn;
}

function setLevel(level) {
  const v = LEVELS[String(level || '').toLowerCase()];
  if (v) minLevel = v;
}

/** 递归脱敏：命中敏感键名的字符串值替换为 *** */
function redact(value, depth = 0) {
  if (depth > 6) return '[深度截断]';
  if (value === null || value === undefined) return value;
  if (value instanceof Error) return serializeError(value);
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE_KEY_RE.test(k) && typeof v !== 'object' ? MASK : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

function serializeError(err) {
  if (!(err instanceof Error)) return err;
  return {
    name: err.name,
    message: scrubText(err.message),
    stack: scrubText(err.stack),
    ...(err.code ? { code: err.code } : {}),
  };
}

/** 压平参数列表：第一个字符串作 message，Error 单独序列化，对象并入 meta */
function buildPayload(args) {
  const payload = { meta: {} };
  const extra = [];
  for (const arg of args) {
    if (arg instanceof Error) {
      payload.error = serializeError(arg);
    } else if (typeof arg === 'string' && payload.message === undefined) {
      payload.message = arg;
    } else if (arg !== undefined && arg !== null) {
      extra.push(arg);
    }
  }
  if (extra.length === 1) payload.meta = extra[0];
  else if (extra.length) payload.meta = { values: extra };
  return payload;
}

function write(level, ...args) {
  if ((LEVELS[level] || LEVELS.info) < minLevel) return;
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message: undefined,
    ...buildPayload(args),
  };
  if (entry.meta && !Object.keys(entry.meta).length) delete entry.meta;
  if (sink) {
    sink(redact(entry));
    return;
  }
  const line = JSON.stringify(redact(entry));
  if (level === 'error' || level === 'warn') process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
}

module.exports = {
  debug: (...args) => write('debug', ...args),
  info: (...args) => write('info', ...args),
  warn: (...args) => write('warn', ...args),
  error: (...args) => write('error', ...args),
  setSink,
  setLevel,
  redact,
  serializeError,
  scrubText,
  MASK,
};
