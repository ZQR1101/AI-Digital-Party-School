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

module.exports = {
  stripHtml,
  countStudyChars,
  requiredStudySeconds,
  memberProgress,
  shouldComplete,
  CHARS_PER_MINUTE,
};
