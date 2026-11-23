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

// 视频应看时长按真实视频时长核算；时长未知时采用保守回退值，
// 避免客户端仅凭 completed 布尔值 + 少量计入秒数就伪造完成。
const VIDEO_FALLBACK_REQUIRED_SECONDS = 60;
const VIDEO_REQUIRED_RATIO = 0.9;

function videoRequiredSeconds(content = {}) {
  const duration = Math.floor(Number(content.durationSeconds));
  if (!Number.isFinite(duration) || duration <= 0) return VIDEO_FALLBACK_REQUIRED_SECONDS;
  return Math.max(10, Math.ceil(duration * VIDEO_REQUIRED_RATIO));
}

// 会话闲置超时：超过该时长没有有效心跳即视为离开，
// 重新提交时服务端建立新会话（保留已获合法累计时长，离线墙钟时间不计入上限）
const SESSION_IDLE_TIMEOUT_SECONDS = 5 * 60;

function memberProgress(status, studySeconds, requiredSeconds) {
  if (status === 'completed') return 100;
  const seconds = Number(studySeconds) || 0;
  if (seconds <= 0) return 0;
  const required = Number(requiredSeconds) || 0;
  if (required > 0) return Math.min(99, Math.round((seconds / required) * 100));
  return Math.min(99, Math.round((seconds / 900) * 100));
}

function shouldComplete({ contentType, type, studySeconds, requiredSeconds, videoEnded, title, summary, bodyOrVideoUrl, durationSeconds }) {
  const kind = contentType || type;
  const seconds = Number(studySeconds) || 0;
  if (kind === 'video') {
    // 视频完成 = 播放结束（客户端事件） + 计入时长达到应看时长（按视频时长核算），
    // 二者缺一不可：completed 布尔值单独不能完成，计入秒数单独也不能
    const required = Number(requiredSeconds) > 0
      ? Number(requiredSeconds)
      : videoRequiredSeconds({ durationSeconds });
    return Boolean(videoEnded) && seconds >= required;
  }
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
 * 计算本次可计入的学习秒数（真实性核心，按会话记账的累计约束模型）：
 *   本会话内累计计入 ≤ 本会话服务端经过时间 + 一次性宽限
 * - sessionBaseSeconds：本会话开始时的合法累计基线（会话建立/重建时快照），
 *   跨会话的合法累计自然叠加，不会因会话重建被清零或卡死；
 * - 每个会话的宽限只发放一次，会话内连续快速请求只能计入真实经过的秒数；
 * - 超出部分静默丢弃。会话由服务端建立，闲置超时后重建（见 SESSION_IDLE_TIMEOUT_SECONDS）。
 */
function creditableSeconds({ requestedDelta, prevSeconds = 0, sessionBaseSeconds = 0, sessionElapsedSeconds, deltaCapSeconds: cap }) {
  const delta = Math.max(0, Math.floor(Number(requestedDelta) || 0));
  if (delta === 0) return 0;

  const prev = Math.max(0, Math.floor(Number(prevSeconds) || 0));
  const base = Math.max(0, Math.floor(Number(sessionBaseSeconds) || 0));
  // 会话经过时间缺失或非法时按 0 处理：仅一次性宽限可用
  const elapsedRaw = Number(sessionElapsedSeconds);
  const elapsed = Number.isFinite(elapsedRaw) && elapsedRaw > 0 ? Math.floor(elapsedRaw) : 0;

  // 本会话的计入上限：会话基线 + 会话经过时间 + 一次性宽限
  const ceiling = base + elapsed + ONE_TIME_ALLOWANCE;
  const capValue = Number(cap) > 0 ? Math.floor(Number(cap)) : Infinity;
  const target = Math.min(prev + delta, ceiling, prev + capValue);
  return Math.max(0, target - prev);
}

module.exports = {
  stripHtml,
  countStudyChars,
  requiredStudySeconds,
  videoRequiredSeconds,
  memberProgress,
  shouldComplete,
  validateReportedSeconds,
  creditableSeconds,
  deltaCapSeconds,
  ONE_TIME_ALLOWANCE,
  MIN_COMPLETION_SECONDS,
  SESSION_IDLE_TIMEOUT_SECONDS,
  VIDEO_FALLBACK_REQUIRED_SECONDS,
  CHARS_PER_MINUTE,
};
