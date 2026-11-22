let cacheVersion = 0

export function recCacheKey() {
  const user = JSON.parse(localStorage.getItem('mobileUser') || '{}')
  const id = user.id || user.userId || user.username || 'guest'
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date())
  return `home-rec:${id}:${day}`
}

export function getRecCacheVersion() {
  return cacheVersion
}

export function invalidateRecCache() {
  cacheVersion++
  try { sessionStorage.removeItem(recCacheKey()) } catch { /* session storage unavailable */ }
}

export function readRecCache() {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(recCacheKey()) || 'null')
    return parsed?.recommendations?.length ? parsed : null
  } catch {
    return null
  }
}

export function writeRecCache(payload) {
  try { sessionStorage.setItem(recCacheKey(), JSON.stringify(payload)) } catch { /* ignore quota */ }
}

export function mapRecItems(payload) {
  return (payload?.recommendations || []).map(item => ({
    ...item,
    id: item.contentId,
    type: item.contentType,
  }))
}
