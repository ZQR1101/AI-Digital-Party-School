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

// 心跳宽限：前端每 3 秒保存一次，网络抖动/页面切后台后回来仍可正常计入
const HEARTBEAT_GRACE_SECONDS = 30;
// 首次上报宽限：打开页面到首次心跳的正常间隔内允许计入的秒数
const FIRST_REPORT_ALLOWANCE = 60;
// 完成所需的最小服务端累计时长：防止 1 秒即标记完成（哪怕客户端报 completed）
const MIN_COMPLETION_SECONDS = 10;

/**
 * 计算本次可计入的学习秒数（真实性核心）：
 * 客户端上报的绝对值不可信，服务端以两次心跳之间的【真实经过时间】为上限。
 * - 首次上报（无服务端基线）：最多计入 FIRST_REPORT_ALLOWANCE 秒；
 * - 有基线：最多计入 min(经过时间 + 心跳宽限, 单次上限)；
 * - 超出部分静默丢弃（不拒单、不作弊计入）。
 */
function creditableSeconds({ requestedDelta, serverElapsedSeconds, isFirstReport, contentType, requiredSeconds = 0 }) {
  const delta = Math.max(0, Math.floor(Number(requestedDelta) || 0));
  if (delta === 0) return 0;

  const allowance = isFirstReport || !Number.isFinite(Number(serverElapsedSeconds))
    ? FIRST_REPORT_ALLOWANCE
    : Math.floor(Number(serverElapsedSeconds)) + HEARTBEAT_GRACE_SECONDS;

  // 单次计入上限：文章不超过应学时长+60s（至少 120s），视频不超过 30 分钟
  const required = Number(requiredSeconds) > 0 ? Number(requiredSeconds) : 0;
  const deltaCap = contentType === 'video' ? 30 * 60 : Math.max(120, required + 60);
  return Math.min(delta, allowance, deltaCap);
}

module.exports = {
  stripHtml,
  countStudyChars,
  requiredStudySeconds,
  memberProgress,
  shouldComplete,
  validateReportedSeconds,
  creditableSeconds,
  HEARTBEAT_GRACE_SECONDS,
  FIRST_REPORT_ALLOWANCE,
  MIN_COMPLETION_SECONDS,
  CHARS_PER_MINUTE,
};
