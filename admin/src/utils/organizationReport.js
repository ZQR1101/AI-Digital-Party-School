import { formatBeijingDateTime } from './dateTime.js'

function escapeMarkup(value) {
  return String(value ?? '').replace(/[<>&"]/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[char])
}

function periodLabel(timeRange) {
  const start = timeRange?.startDate?.slice(0, 10)
  const end = timeRange?.endDate?.slice(0, 10)
  if (!start || !end) return timeRange?.label || ''
  const lastDay = new Date(`${end}T00:00:00Z`)
  lastDay.setUTCDate(lastDay.getUTCDate() - 1)
  return `${start} 至 ${lastDay.toISOString().slice(0, 10)}`
}

export function normalizeOrganizationReport(result) {
  const { query, data, answer, charts = [], sources = [] } = result
  const metric = sources.find(source => source.type === 'metric')
  const scope = query.organization?.name || metric?.scope || '全部组织'
  const formatValue = value => value == null ? '暂无数据' : `${value}${data.unit}`
  const value = data.hasData === false ? '暂无数据' : formatValue(data.value)
  const count = data.denominator != null ? `${data.numerator ?? 0} / ${data.denominator}` : null
  const chart = charts[0]
  const trendRows = (chart?.xAxis || []).map((month, index) => [
    month,
    ...chart.series.map(series => formatValue(series.data[index]))
  ])
  return {
    title: `${data.metricName}统计报表`,
    metric: data.metricName,
    value,
    count,
    sampleLabel: data.metric === 'learning_completion_rate' ? '已完成 / 应完成人次' : '及格 / 提交人次',
    scope,
    period: periodLabel(query.timeRange),
    checkedAt: metric?.calculatedAt ? formatBeijingDateTime(metric.calculatedAt) : '',
    summary: answer,
    chart,
    trendRows,
    headings: chart ? ['月份', ...chart.series.map(series => series.name)] : ['指标', '数值'],
    sources: sources.filter(source => source.type === 'knowledge'),
  }
}

function reportContent(result) {
  const report = normalizeOrganizationReport(result)
  const lines = [
    `组织范围：${report.scope}`,
    `统计周期：${report.period}（北京时间）`,
    `${report.metric}：${report.value}`,
  ]
  if (report.count != null) lines.push(`${report.sampleLabel}：${report.count}`)
  if (report.checkedAt) lines.push(`查询时间：${report.checkedAt}（北京时间）`)
  const rows = report.chart ? report.trendRows : [[report.metric, report.value]]
  const sources = report.sources.map(item => `${item.source} · ${item.name}：${item.excerpt}`)
  return { ...report, lines, rows, sources }
}

export function buildOrganizationExcelXml(result) {
  const report = reportContent(result)
  const cell = value => `<Cell><Data ss:Type="String">${escapeMarkup(value)}</Data></Cell>`
  const row = values => `<Row>${values.map(cell).join('')}</Row>`
  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Worksheet ss:Name="组织数据查询"><Table>
    ${[report.title, ...report.lines, report.summary].filter(Boolean).map(line => row([line])).join('')}
    ${row(report.headings)}
    ${report.rows.map(row).join('')}
    ${report.sources.map(line => row([line])).join('')}
  </Table></Worksheet>
</Workbook>`
}

export function buildOrganizationPrintHtml(result) {
  const report = reportContent(result)
  const headings = report.headings.map(value => `<th scope="col">${escapeMarkup(value)}</th>`).join('')
  const rows = report.rows.map(values => `<tr>${values.map(value => `<td>${escapeMarkup(value)}</td>`).join('')}</tr>`).join('')
  const paragraphs = lines => lines.map(line => `<p>${escapeMarkup(line)}</p>`).join('')
  return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><title>${escapeMarkup(report.title)}</title>
<style>
body { margin: 32px; font: 14px/1.6 "Microsoft YaHei", sans-serif; color: #2b2423; }
h1 { font-size: 22px; color: #b30017; } table { width: 100%; border-collapse: collapse; }
th, td { padding: 8px 10px; border: 1px solid #d8ccca; text-align: left; }
th { background: #f7f3f3; } @media print { body { margin: 12px; } }
</style></head><body><h1>${escapeMarkup(report.title)}</h1>${paragraphs([...report.lines, report.summary].filter(Boolean))}
<table><thead><tr>${headings}</tr></thead><tbody>${rows}</tbody></table>
${report.sources.length ? `<h2>统计口径</h2>${paragraphs(report.sources)}` : ''}</body></html>`
}
