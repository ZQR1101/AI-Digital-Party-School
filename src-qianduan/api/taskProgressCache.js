const KEY = 'task-progress-cache'
const EVENT = 'task-progress-updated'
const memory = {}

function readAll() {
  try {
    return { ...JSON.parse(localStorage.getItem(KEY) || '{}'), ...memory }
  } catch {
    return { ...memory }
  }
}

export function writeTaskProgress(taskId, { progress, status, studySeconds }) {
  const id = String(taskId || '')
  if (!id) return
  const all = readAll()
  const nextProgress = Math.max(0, Math.min(100, Number(progress) || 0))
  const prev = all[id] || {}
  const next = {
    progress: Math.max(Number(prev.progress) || 0, nextProgress),
    status: status === 'completed' || prev.status === 'completed' || nextProgress >= 100
      ? 'completed'
      : (status || prev.status || 'inProgress'),
    studySeconds: Math.max(Number(prev.studySeconds) || 0, Number(studySeconds) || 0),
    ts: Date.now(),
  }
  memory[id] = next
  all[id] = next
  try { localStorage.setItem(KEY, JSON.stringify(all)) } catch { /* ignore quota */ }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { taskId: id, ...next } }))
}

export function applyTaskProgress(item) {
  if (!item) return item
  const cached = readAll()[String(item.taskId)]
  if (!cached) return item
  const apiProgress = item.status === 'completed' ? 100 : (Number(item.progress) || 0)
  const progress = Math.max(apiProgress, Number(cached.progress) || 0)
  const status = item.status === 'completed' || cached.status === 'completed' || progress >= 100
    ? 'completed'
    : (progress > 0 ? 'inProgress' : item.status)
  return { ...item, progress, status }
}

export function onTaskProgress(handler) {
  const listener = (event) => handler(event.detail)
  window.addEventListener(EVENT, listener)
  return () => window.removeEventListener(EVENT, listener)
}
