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
 * 学习时长上报的服务端校验。
 * 客户端上报的秒数不可信，这里限制单次增量与累计上限，避免"一次请求刷满时长"。
 * 返回规范化后的秒数；非法输入直接抛出（携带 statusCode 便于路由返回 400）。
 */
function validateReportedSeconds({ reported, previous = 0, requiredSeconds = 0, contentType }) {
  const value = Number(reported);
  if (!Number.isFinite(value) || value < 0) {
    throw Object.assign(new Error('学习时长参数无效'), { statusCode: 400 });
  }
  const prev = Number.isFinite(Number(previous)) && Number(previous) > 0 ? Number(previous) : 0;
  const incoming = Math.floor(value);

  // 绝对上限：单次上报不得超过 2 小时；视频按更长宽限（防止长讲座误判）
  const absoluteCap = contentType === 'video' ? 4 * 60 * 60 : 2 * 60 * 60;
  if (incoming > absoluteCap) {
    throw Object.assign(new Error('学习时长超出合理范围'), { statusCode: 400 });
  }

  // 累计不得超过应学时长的一定倍数。
  // 文章按应学时长的 3 倍封顶（至少 5 分钟宽限），防止一次请求刷满；
  // 视频没有字数基准，给到绝对上限。
  const required = Number(requiredSeconds) > 0 ? Number(requiredSeconds) : 0;
  const cumulativeCap = contentType === 'video'
    ? absoluteCap
    : Math.max(300, required * 3);
  if (incoming > cumulativeCap) {
    throw Object.assign(new Error('学习时长超出合理范围'), { statusCode: 400 });
  }

  // 单次增量上限：文章不得超过应学时长 + 60 秒宽限；视频不超过 30 分钟。
  // 首次上报同样受限——前端每 3 秒增量保存一次，正常学习不会出现首次即暴增；
  // 否则攻击者可在无历史记录时一次请求把时长刷到接近完成阈值。
  const deltaCap = contentType === 'video' ? 30 * 60 : Math.max(120, required + 60);
  const delta = incoming - prev;
  if (delta > deltaCap) {
    throw Object.assign(new Error('学习时长增量异常'), { statusCode: 400 });
  }

  // 取历史最大值，禁止客户端回退已记录时长
  return Math.max(prev, incoming);
}

module.exports = {
  stripHtml,
  countStudyChars,
  requiredStudySeconds,
  memberProgress,
  shouldComplete,
  validateReportedSeconds,
  CHARS_PER_MINUTE,
};
