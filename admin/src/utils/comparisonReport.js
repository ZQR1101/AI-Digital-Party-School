import { formatBeijingDateTime } from './dateTime.js'
import { buildOrganizationExcelXml, buildOrganizationPrintHtml } from './organizationReport.js'

export const DEFAULT_COMPARISON = {
  title: '党组织任务完成率对比报表',
  left: { name: '教务处党支部', rate: '88%' },
  right: { name: '科研处党支部', rate: '82%' },
  rows: [
    { dimension: '必修课完成率', academic: '95%', research: '90%', difference: '+5%' },
    { dimension: '心得体会提交率', academic: '82%', research: '75%', difference: '+7%' },
    { dimension: '线下活动参与度', academic: '86%', research: '88%', difference: '-2%' },
  ],
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export function normalizeComparisonReport(message) {
  return {
    title: message?.title || DEFAULT_COMPARISON.title,
    generatedAt: formatBeijingDateTime(new Date()),
    left: {
      name: message?.left?.name || DEFAULT_COMPARISON.left.name,
      rate: message?.left?.rate || DEFAULT_COMPARISON.left.rate,
    },
    right: {
      name: message?.right?.name || DEFAULT_COMPARISON.right.name,
      rate: message?.right?.rate || DEFAULT_COMPARISON.right.rate,
    },
    rows: (message?.rows?.length ? message.rows : DEFAULT_COMPARISON.rows).map((row) => ({
      dimension: row.dimension,
      academic: row.academic,
      research: row.research,
      difference: row.difference,
      positive: row.positive !== false && !String(row.difference || '').startsWith('-'),
    })),
    summary: message?.text || '',
  }
}

export function buildComparisonExcelXml(message) {
  if (message?.queryResult) return buildOrganizationExcelXml(message.queryResult)
  const report = normalizeComparisonReport(message)
  const cell = (value, style) => `<Cell${style ? ` ss:StyleID="${style}"` : ''}><Data ss:Type="String">${escapeXml(value)}</Data></Cell>`
  const body = report.rows.map((row) => `
        <Row>
          ${cell(row.dimension)}
          ${cell(row.academic, 'accent')}
          ${cell(row.research)}
          ${cell(row.difference, row.positive ? 'up' : 'down')}
        </Row>`).join('')

  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Styles>
    <Style ss:ID="title"><Font ss:Bold="1" ss:Size="16" ss:Color="#C62026"/></Style>
    <Style ss:ID="meta"><Font ss:Size="10" ss:Color="#666666"/></Style>
    <Style ss:ID="header"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#C62026" ss:Pattern="Solid"/></Style>
    <Style ss:ID="accent"><Font ss:Bold="1" ss:Color="#C62026"/></Style>
    <Style ss:ID="up"><Font ss:Bold="1" ss:Color="#2B8B59"/></Style>
    <Style ss:ID="down"><Font ss:Bold="1" ss:Color="#C62026"/></Style>
  </Styles>
  <Worksheet ss:Name="对比报表">
    <Table>
      <Column ss:Width="140"/>
      <Column ss:Width="120"/>
      <Column ss:Width="120"/>
      <Column ss:Width="80"/>
      <Row><Cell ss:StyleID="title" ss:MergeAcross="3"><Data ss:Type="String">${escapeXml(`数智党校 · ${report.title}`)}</Data></Cell></Row>
      <Row><Cell ss:StyleID="meta" ss:MergeAcross="3"><Data ss:Type="String">${escapeXml(`生成时间：${report.generatedAt}（北京时间）`)}</Data></Cell></Row>
      <Row><Cell ss:StyleID="meta" ss:MergeAcross="3"><Data ss:Type="String">${escapeXml(`综合完成率：${report.left.name} ${report.left.rate}  /  ${report.right.name} ${report.right.rate}`)}</Data></Cell></Row>
      <Row></Row>
      <Row>
        ${cell('考核维度', 'header')}
        ${cell(report.left.name, 'header')}
        ${cell(report.right.name, 'header')}
        ${cell('差异', 'header')}
      </Row>${body}
      <Row></Row>
      <Row><Cell ss:StyleID="meta" ss:MergeAcross="3"><Data ss:Type="String">说明：本报表可由 AI 数据查询生成，敏感决策请以系统实际数据核对为准。</Data></Cell></Row>
    </Table>
  </Worksheet>
</Workbook>`
}

export function buildComparisonPrintHtml(message) {
  if (message?.queryResult) return buildOrganizationPrintHtml(message.queryResult)
  const report = normalizeComparisonReport(message)
  const rows = report.rows.map((row) => `
        <tr>
          <td>${escapeHtml(row.dimension)}</td>
          <td class="accent">${escapeHtml(row.academic)}</td>
          <td>${escapeHtml(row.research)}</td>
          <td class="${row.positive ? 'up' : 'down'}">${escapeHtml(row.difference)}</td>
        </tr>`).join('')

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(report.title)}</title>
  <style>
    body { margin: 0; padding: 32px; color: #2b2423; font-family: "Microsoft YaHei", "PingFang SC", sans-serif; }
    h1 { margin: 0 0 8px; color: #c62026; font-size: 22px; }
    .meta { margin: 0 0 18px; color: #7a6865; font-size: 13px; }
    .summary { margin: 0 0 16px; padding: 12px 14px; background: #f7f3f3; border-radius: 8px; font-size: 13px; line-height: 1.7; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { padding: 10px 12px; border: 1px solid #ead0cd; text-align: left; }
    th { color: #fff; background: #c62026; }
    td.accent { color: #c62026; font-weight: 700; }
    td.up { color: #2b8b59; font-weight: 600; }
    td.down { color: #c62026; font-weight: 600; }
    .note { margin-top: 18px; color: #93817e; font-size: 12px; }
    @media print { body { padding: 12px; } }
  </style>
</head>
<body>
  <h1>数智党校 · ${escapeHtml(report.title)}</h1>
  <p class="meta">生成时间：${escapeHtml(report.generatedAt)}（北京时间）　综合完成率：${escapeHtml(report.left.name)} ${escapeHtml(report.left.rate)}　/　${escapeHtml(report.right.name)} ${escapeHtml(report.right.rate)}</p>
  ${report.summary ? `<p class="summary">${escapeHtml(report.summary)}</p>` : ''}
  <table>
    <thead>
      <tr>
        <th>考核维度</th>
        <th>${escapeHtml(report.left.name)}</th>
        <th>${escapeHtml(report.right.name)}</th>
        <th>差异</th>
      </tr>
    </thead>
    <tbody>${rows}
    </tbody>
  </table>
  <p class="note">AI 生成内容仅供参考，敏感决策请以系统实际数据核对为准。</p>
</body>
</html>`
}

export function downloadComparisonExcel(message) {
  const xml = buildComparisonExcelXml(message)
  const blob = new Blob([`\uFEFF${xml}`], { type: 'application/vnd.ms-excel;charset=utf-8' })
  const stamp = formatBeijingDateTime(new Date()).replace(/[: ]/g, '')
  const link = document.createElement('a')
  const url = URL.createObjectURL(blob)
  link.href = url
  link.download = `${message?.queryResult ? '组织数据查询报表' : '党组织对比报表'}-${stamp}.xls`
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  return link.download
}

export function printComparisonReport(message) {
  const html = buildComparisonPrintHtml(message)
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;'
  document.body.appendChild(frame)
  const win = frame.contentWindow
  const doc = win.document
  doc.open()
  doc.write(html)
  doc.close()

  const cleanup = () => {
    window.setTimeout(() => frame.remove(), 300)
  }
  win.addEventListener('afterprint', cleanup)
  const trigger = () => {
    win.focus()
    win.print()
  }
  if (frame.contentDocument.readyState === 'complete') window.setTimeout(trigger, 50)
  else frame.onload = () => window.setTimeout(trigger, 50)
  window.setTimeout(cleanup, 60_000)
}
