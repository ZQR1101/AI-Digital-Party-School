const LOCAL_DEMO = '/uploads/demo-lecture.mp4';
const BLOCKED = /googleapis\.com|gtv-videos-bucket|googleusercontent\.com/i;

function extractVideoSrc(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const fromAttr = text.match(/src=["']([^"']+)["']/i);
  if (fromAttr) return fromAttr[1].trim();
  const fromUrl = text.match(/https?:\/\/[^\s"'<>]+/i);
  if (fromUrl) return fromUrl[0];
  return text;
}

function playableVideoUrl(value) {
  const src = extractVideoSrc(value);
  if (!src || BLOCKED.test(src)) return LOCAL_DEMO;
  return src;
}

function withPlayableVideo(row, typeKey = 'type', urlKey = 'bodyOrVideoUrl') {
  if (!row) return row;
  const kind = row[typeKey] || row.contentType;
  if (kind !== 'video') return row;
  return { ...row, [urlKey]: playableVideoUrl(row[urlKey]) };
}

module.exports = { LOCAL_DEMO, extractVideoSrc, playableVideoUrl, withPlayableVideo };
