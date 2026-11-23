function stripHtml(value) {
  return String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function countStudyChars(text) {
  const plain = stripHtml(text);
  const cjk = (plain.match(/[\u4e00-\u9fff]/g) || []).length;
  const others = plain.replace(/[\u4e00-\u9fff]/g, '').replace(/\s+/g, '');
  return cjk + others.length;
}

const CHARS_PER_MINUTE = 300;
const MIN_SECONDS = 5;
const MAX_SECONDS = 30 * 60;

function requiredStudySeconds(content = {}) {
  if (content.contentType === 'video' || content.type === 'video') return 0;
  const bodyChars = countStudyChars(content.bodyOrVideoUrl);
  const fallbackChars = countStudyChars([content.title, content.summary].filter(Boolean).join('\n'));
  const chars = bodyChars || fallbackChars;
  const seconds = Math.round((chars / CHARS_PER_MINUTE) * 60);
  return Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, seconds || MIN_SECONDS));
}

function memberProgress(status, studySeconds, requiredSeconds) {
  if (status === 'completed') return 100;
  const seconds = Number(studySeconds) || 0;
  if (seconds <= 0) return 0;
  const required = Number(requiredSeconds) || 0;
  if (required > 0) return Math.min(99, Math.round((seconds / required) * 100));
  return Math.min(99, Math.round((seconds / 900) * 100));
}

function shouldComplete({ contentType, type, studySeconds, requiredSeconds, videoEnded, title, summary, bodyOrVideoUrl }) {
  const kind = contentType || type;
  const seconds = Number(studySeconds) || 0;
  if (kind === 'video') return Boolean(videoEnded) && seconds > 0;
  const required = Number(requiredSeconds) > 0
    ? Number(requiredSeconds)
    : requiredStudySeconds({ contentType: kind, type: kind, title, summary, bodyOrVideoUrl });
  return seconds >= required;
}

/**
 * 学习时长上报的数值合法性校验（仅拦明显非法值）。
 * 真实性由 creditableSeconds 按服务端经过时间约束，这里不再按增量/累计拒单，
 * 避免"客户端一次上报秒数略超限"把整个心跳周期的时间全部作废。
 */
function validateReportedSeconds({ reported, contentType }) {
  const value = Number(reported);
  if (!Number.isFinite(value) || value < 0) {
    throw Object.assign(new Error('学习时长参数无效'), { statusCode: 400 });
  }
  const incoming = Math.floor(value);
  // 单次上报的绝对上限（防御异常客户端）：文章 2 小时、视频 4 小时
  const absoluteCap = contentType === 'video' ? 4 * 60 * 60 : 2 * 60 * 60;
  if (incoming > absoluteCap) {
    throw Object.assign(new Error('学习时长超出合理范围'), { statusCode: 400 });
  }
  return incoming;
}

// 一次性会话宽限：服务端建立学习会话时发放一次，之后不再重复领取。
// 累计计入时长恒受「服务端会话总经过时间 + 本宽限」约束，
// 连续快速心跳无法通过重复请求反复领取宽限时间。
const ONE_TIME_ALLOWANCE = 60;
// 完成所需的最小服务端累计时长：防止 1 秒即标记完成（哪怕客户端报 completed）
const MIN_COMPLETION_SECONDS = 10;

/** 单次心跳的计入上限（防止会话中断后长时间挂起、一次性补记大量时长）：文章为应学时长+60s（至少 120s），视频 30 分钟 */
function deltaCapSeconds({ contentType, requiredSeconds = 0 }) {
  if (contentType === 'video') return 30 * 60;
  const required = Number(requiredSeconds) > 0 ? Number(requiredSeconds) : 0;
  return Math.max(120, required + 60);
}

/**
 * 计算本次可计入的学习秒数（真实性核心，累计约束模型）：
 *   累计计入时长 ≤ 服务端会话总经过时间 + 一次性宽限
 * 会话由服务端建立（sessionStartedAt），每次心跳以「已计入累计值 prevSeconds」和
 * 「会话经过时间」共同约束，超出部分静默丢弃。
 * 客户端上报绝对值不可信，仅通过增量（requestedDelta）表达本次想多记多少。
 */
function creditableSeconds({ requestedDelta, prevSeconds = 0, sessionElapsedSeconds, deltaCapSeconds: cap }) {
  const delta = Math.max(0, Math.floor(Number(requestedDelta) || 0));
  if (delta === 0) return 0;

  const prev = Math.max(0, Math.floor(Number(prevSeconds) || 0));
  // 会话经过时间缺失或非法时按 0 处理：仅一次性宽限可用
  const elapsedRaw = Number(sessionElapsedSeconds);
  const elapsed = Number.isFinite(elapsedRaw) && elapsedRaw > 0 ? Math.floor(elapsedRaw) : 0;

  const ceiling = elapsed + ONE_TIME_ALLOWANCE;
  const capValue = Number(cap) > 0 ? Math.floor(Number(cap)) : Infinity;
  const target = Math.min(prev + delta, ceiling, prev + capValue);
  return Math.max(0, target - prev);
}

module.exports = {
  stripHtml,
  countStudyChars,
  requiredStudySeconds,
  memberProgress,
  shouldComplete,
  validateReportedSeconds,
  creditableSeconds,
  deltaCapSeconds,
  ONE_TIME_ALLOWANCE,
  MIN_COMPLETION_SECONDS,
  CHARS_PER_MINUTE,
};
