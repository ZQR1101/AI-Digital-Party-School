import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildComparisonExcelXml, buildComparisonPrintHtml } from '../src/utils/comparisonReport.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

test('对比报表导出和打印不再使用演示提示', () => {
  const source = readFileSync(join(root, 'src/views/AiQueryView.vue'), 'utf8')
  assert.doesNotMatch(source, /对比报表已加入下载队列（演示）/, '导出 Excel 仍是演示提示')
  assert.doesNotMatch(source, /已打开报表打印预览（演示）/, '打印报表仍是演示提示')
  assert.match(source, /downloadComparisonExcel\(message\)/, '导出未生成本地表')
  assert.match(source, /printComparisonReport\(message\)/, '打印未打开报表页')
})

test('对比报表 Excel 包含考核维度和两个支部数据', () => {
  const xml = buildComparisonExcelXml({
    title: '党组织任务完成率对比报表',
    left: { name: '教务处党支部', rate: '88%' },
    right: { name: '科研处党支部', rate: '82%' },
    rows: [{ dimension: '必修课完成率', academic: '95%', research: '90%', difference: '+5%', positive: true }],
  })
  assert.match(xml, /Excel\.Sheet/, '导出文件不是 Excel 工作簿')
  assert.match(xml, /考核维度/, 'Excel 缺少表头')
  assert.match(xml, /教务处党支部/, 'Excel 缺少教务处数据')
  assert.match(xml, /科研处党支部/, 'Excel 缺少科研处数据')
  assert.match(xml, /必修课完成率/, 'Excel 缺少考核行')
})

test('对比报表打印页包含完整表格', () => {
  const html = buildComparisonPrintHtml({
    text: '教务处党支部综合完成率领先 6 个百分点。',
    rows: [{ dimension: '线下活动参与度', academic: '86%', research: '88%', difference: '-2%', positive: false }],
  })
  assert.match(html, /<table>/, '打印页没有表格')
  assert.match(html, /window\.print|@media print/, '打印页没有打印样式')
  assert.match(html, /线下活动参与度/, '打印页缺少对比数据')
  assert.match(html, /88%/, '打印页缺少综合完成率')
})
