const dateTimeFormat = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Shanghai',
})

export function formatAssessmentDate(isoDate) {
  if (!isoDate) return '—'
  const date = new Date(isoDate)
  return Number.isFinite(date.getTime()) ? dateTimeFormat.format(date) : '—'
}
