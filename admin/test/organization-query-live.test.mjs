import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildComparisonExcelXml, buildComparisonPrintHtml } from '../src/utils/comparisonReport.js'
import { normalizeOrganizationReport } from '../src/utils/organizationReport.js'

const result = {
  answer: '根据任务记录得出',
  query: {
    organization: { id: 4, name: '组织 A & B' },
    timeRange: { startDate: '2026-08-01 00:00:00', endDate: '2026-11-01 00:00:00' },
  },
  data: { metric: 'learning_completion_rate', metricName: '学习完成率', value: 0, unit: '%', hasData: true, numerator: 0, denominator: 12 },
  charts: [{
    type: 'line',
    title: '组织完成率趋势',
    xAxis: ['2026-08', '2026-09', '2026-10'],
    series: [{ name: '学习完成率', data: [0, null, 42] }],
  }],
  sources: [
    { type: 'metric', scope: '组织 A & B', calculatedAt: '2026-11-01T09:00:00Z' },
    { type: 'knowledge', name: '学习完成率', source: '统计口径.md', excerpt: '应完成人次' },
  ],
}

test('组织问数对话使用后台接口和真实图表数据', () => {
  const source = readFileSync(new URL('../src/views/AiQueryView.vue', import.meta.url), 'utf8')
  assert.match(source, /request.post\('\/ai\/query'/)
  assert.match(source, /data: series.data/)
  assert.doesNotMatch(source, /createAssistantReply|restoreDemo/)
})

test('实时导出保留范围、样本、口径、趋势和缺失月份', () => {
  const report = normalizeOrganizationReport(result)
  assert.equal(report.period, '2026-08-01 至 2026-10-31')
  assert.equal(report.value, '0%')
  assert.equal(report.count, '0 / 12')
  assert.deepEqual(report.trendRows, [['2026-08', '0%'], ['2026-09', '暂无数据'], ['2026-10', '42%']])
  for (const exportText of [buildComparisonExcelXml({ queryResult: result }), buildComparisonPrintHtml({ queryResult: result })]) {
    assert.match(exportText, /组织 A &amp; B/)
    assert.match(exportText, /0 \/ 12/)
    assert.match(exportText, /统计口径.md/)
    assert.match(exportText, /42%/)
    assert.doesNotMatch(exportText, /教务处党支部|科研处党支部/)
  }
})
