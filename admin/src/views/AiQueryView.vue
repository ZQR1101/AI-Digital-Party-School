<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import * as echarts from 'echarts'
import {
  ChatDotRound,
  Delete,
  Download,
  Printer,
  Promotion,
  UserFilled,
} from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import request from '@/api/request'
import { downloadComparisonExcel, printComparisonReport } from '@/utils/comparisonReport'
import { normalizeOrganizationReport } from '@/utils/organizationReport'

let messageId = 0
let pending = null
const query = ref('')
const isThinking = ref(false)
const messages = ref([])
const chatBodyRef = ref()
const chartElements = new Map()
const chartInstances = new Map()

const suggestions = [
  { label: '本月任务完成率', prompt: '查询本月学习完成率' },
  { label: '上月考试及格率', prompt: '查询上个月考试及格率' },
  { label: '近三个月活跃趋势', prompt: '查询最近三个月活跃党员人数趋势' },
  { label: '本月学习时长', prompt: '查询本月学习时长' },
]

function setChartElement(element, id) {
  if (element) chartElements.set(id, element)
  else chartElements.delete(id)
}

function renderChart(message) {
  const element = chartElements.get(message.id)
  const chart = message.report?.chart
  if (!element || !chart) return

  const unit = message.queryResult.data.unit
  const instance = echarts.init(element)
  chartInstances.set(message.id, instance)
  instance.setOption({
    color: ['#bd2638'],
    tooltip: {
      trigger: 'axis',
      renderMode: 'richText',
      valueFormatter: value => value == null ? '暂无数据' : String(value) + unit,
    },
    grid: { top: 18, left: 12, right: 18, bottom: 12, containLabel: true },
    xAxis: {
      type: 'category',
      data: chart.xAxis,
      axisTick: { show: false },
      axisLabel: { color: '#63504d', fontSize: 11 },
    },
    yAxis: {
      type: 'value',
      ...(unit === '%' ? { max: 100 } : {}),
      axisLabel: { color: '#786562', formatter: '{value}' + unit },
      splitLine: { lineStyle: { color: '#f0edef' } },
    },
    series: chart.series.map(series => ({
      name: series.name,
      type: chart.type,
      data: series.data,
      connectNulls: false,
    })),
  })
}

async function scrollToBottom() {
  await nextTick()
  chatBodyRef.value?.scrollTo({ top: chatBodyRef.value.scrollHeight, behavior: 'smooth' })
}

async function sendMessage(preset) {
  const text = (typeof preset === 'string' ? preset : query.value).trim()
  if (!text || isThinking.value) return

  const controller = new AbortController()
  pending = controller
  messages.value.push({ id: ++messageId, role: 'user', text })
  query.value = ''
  isThinking.value = true
  await scrollToBottom()

  try {
    const result = await request.post('/ai/query', { message: text }, { signal: controller.signal })
    if (pending !== controller) return
    const message = {
      id: ++messageId,
      role: 'assistant',
      text: result.answer,
      queryResult: result,
      report: normalizeOrganizationReport(result),
    }
    messages.value.push(message)
    await nextTick()
    if (pending === controller) renderChart(message)
  } catch (error) {
    if (pending === controller) messages.value.push({
      id: ++messageId,
      role: 'assistant',
      text: error.message || '查询失败，请稍后重试。',
    })
  } finally {
    if (pending === controller) {
      pending = null
      isThinking.value = false
      await scrollToBottom()
    }
  }
}

function resetConversation() {
  pending?.abort()
  pending = null
  isThinking.value = false
  chartInstances.forEach(chart => chart.dispose())
  chartInstances.clear()
  chartElements.clear()
  messages.value = []
}

function clearConversation() {
  ElMessageBox.confirm('清空当前对话？', '确认清空', {
    confirmButtonText: '清空',
    cancelButtonText: '取消',
    type: 'warning',
  }).then(resetConversation).catch(() => {})
}

function exportReport(message) {
  try {
    const filename = downloadComparisonExcel(message)
    ElMessage.success('已导出 ' + filename)
  } catch (error) {
    ElMessage.error(error.message || 'Excel 导出失败')
  }
}

function printReport(message) {
  try {
    printComparisonReport(message)
  } catch (error) {
    ElMessage.error(error.message || '打印失败')
  }
}

function handleResize() {
  chartInstances.forEach(chart => chart.resize())
}

onMounted(() => window.addEventListener('resize', handleResize))
onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize)
  resetConversation()
})
</script>

<template>
  <section class="ai-query-view">
    <header class="assistant-header">
      <div class="assistant-identity">
        <span class="assistant-mark"><el-icon><ChatDotRound /></el-icon></span>
        <div>
          <h1>AI 智能助理</h1>
          <p>组织数据查询</p>
        </div>
      </div>
      <div class="header-actions">
        <el-button plain :icon="Delete" :disabled="!messages.length" @click="clearConversation">清空对话</el-button>
      </div>
    </header>

    <main ref="chatBodyRef" class="chat-body" aria-live="polite">
      <template v-for="message in messages" :key="message.id">
        <div v-if="message.role === 'user'" class="message user-message">
          <div class="message-bubble user-bubble">{{ message.text }}</div>
          <span class="user-avatar"><el-icon><UserFilled /></el-icon></span>
        </div>

        <div v-else class="message assistant-message">
          <span class="ai-avatar"><el-icon><ChatDotRound /></el-icon></span>
          <div class="message-bubble assistant-bubble">
            <p class="answer-text">{{ message.text }}</p>

            <div v-if="message.report" class="query-result">
              <p>组织范围：{{ message.report.scope }}</p>
              <p>统计周期：{{ message.report.period }}（北京时间）</p>
              <p>{{ message.report.metric }}：<strong>{{ message.report.value }}</strong></p>
              <p v-if="message.report.count">{{ message.report.sampleLabel }}：{{ message.report.count }}</p>
              <p v-if="message.report.checkedAt">查询时间：{{ message.report.checkedAt }}（北京时间）</p>

              <div v-if="message.report.chart" class="result-card chart-result">
                <div class="result-title">{{ message.report.chart.title }}</div>
                <div
                  :ref="element => setChartElement(element, message.id)"
                  class="activity-chart"
                  role="img"
                  :aria-label="message.report.chart.title"
                ></div>
              </div>

              <details v-if="message.report.sources.length" class="query-sources">
                <summary>查看统计口径</summary>
                <p v-for="source in message.report.sources" :key="source.name">
                  <strong>{{ source.source }} · {{ source.name }}</strong><br>{{ source.excerpt }}
                </p>
              </details>

              <div class="report-actions">
                <el-button plain size="small" :icon="Download" @click="exportReport(message)">导出 Excel</el-button>
                <el-button plain size="small" :icon="Printer" @click="printReport(message)">打印报表</el-button>
              </div>
            </div>
          </div>
        </div>
      </template>

      <div v-if="isThinking" class="message assistant-message thinking-message">
        <span class="ai-avatar"><el-icon><ChatDotRound /></el-icon></span>
        <div class="message-bubble assistant-bubble typing"><i></i><i></i><i></i><span>正在查询数据</span></div>
      </div>

      <div v-if="!messages.length" class="empty-chat">
        <span><el-icon><ChatDotRound /></el-icon></span>
        <h2>查询组织学习数据</h2>
        <p>输入一个指标、统计周期和组织名称，或使用下方的常用查询。</p>
      </div>
    </main>

    <footer class="composer-area">
      <div class="suggestions">
        <button v-for="item in suggestions" :key="item.label" :disabled="isThinking" @click="sendMessage(item.prompt)">
          {{ item.label }}
        </button>
      </div>
      <div class="composer">
        <el-input
          v-model="query"
          type="textarea"
          :autosize="{ minRows: 1, maxRows: 3 }"
          resize="none"
          aria-label="组织数据查询"
          placeholder="例如：学生第一党支部上个月的学习完成率"
          @keydown.enter.exact.prevent="sendMessage()"
        />
        <el-button class="send-button" type="primary" :loading="isThinking" :disabled="!query.trim()" @click="sendMessage()">
          发送<el-icon class="el-icon--right"><Promotion /></el-icon>
        </el-button>
      </div>
    </footer>
  </section>
</template>

<style scoped>
.ai-query-view {
  --ai-red: #b30017;
  --ai-brand: #c62026;
  height: calc(100vh - 130px);
  min-height: 650px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid #edcfcd;
  border-radius: 12px;
  color: #1a1c1d;
  background: #f5f7fa;
  box-shadow: 0 5px 20px rgba(65, 38, 36, .08);
}

.assistant-header {
  flex: 0 0 auto;
  min-height: 86px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 14px 22px;
  border-bottom: 1px solid #e9c5c2;
  background: #fff;
}
.assistant-identity { display: flex; align-items: center; gap: 12px; }
.assistant-mark {
  width: 45px;
  height: 45px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  color: var(--ai-brand);
  background: #f8e7e8;
  font-size: 24px;
}
.assistant-identity h1 { margin: 0; font-size: 21px; line-height: 28px; font-weight: 700; }
.assistant-identity p { display: flex; align-items: center; gap: 8px; margin: 3px 0 0; color: #745e5b; font-size: 12px; }
.assistant-identity p i { width: 8px; height: 8px; border-radius: 50%; background: var(--ai-brand); box-shadow: 0 0 0 0 rgba(198,32,38,.5); animation: pulse 2s infinite; }
.header-actions { display: flex; gap: 8px; }
.header-actions :deep(.el-button) { height: 34px; margin: 0; color: #604b48; border-color: #e5b7b4; border-radius: 7px; }
.header-actions :deep(.el-button:hover) { color: var(--ai-brand); border-color: var(--ai-brand); background: #fff7f7; }

.chat-body {
  flex: 1;
  overflow-y: auto;
  padding: 24px 28px 34px;
  background:
    radial-gradient(circle at 95% 5%, rgba(215,164,65,.045), transparent 24%),
    #f5f7fa;
  scrollbar-width: thin;
  scrollbar-color: #d9d7da transparent;
}
.chat-body::-webkit-scrollbar { width: 6px; }
.chat-body::-webkit-scrollbar-thumb { border-radius: 8px; background: #d9d7da; }
.message { display: flex; align-items: flex-start; gap: 14px; width: min(94%, 1040px); margin-bottom: 28px; }
.user-message { justify-content: flex-end; margin-left: auto; }
.assistant-message { margin-right: auto; }
.user-avatar, .ai-avatar { flex: 0 0 auto; width: 36px; height: 36px; display: grid; place-items: center; border-radius: 50%; }
.user-avatar { color: #fff; background: linear-gradient(145deg, #7c5d4f, #b69982); }
.ai-avatar { color: var(--ai-brand); border: 1px solid #e6aaa6; background: #fff; box-shadow: 0 2px 6px rgba(68,30,28,.08); }
.message-bubble { min-width: 0; }
.user-bubble {
  max-width: 760px;
  padding: 15px 22px;
  border-radius: 14px 14px 3px 14px;
  color: #fff;
  background: linear-gradient(120deg, #a90016, #bf071e);
  box-shadow: 0 5px 12px rgba(145,0,18,.12);
  font-size: 14px;
  font-weight: 500;
  line-height: 1.65;
}
.assistant-bubble {
  width: 100%;
  padding: 20px 24px;
  border: 1px solid rgba(198,32,38,.14);
  border-radius: 3px 14px 14px 14px;
  background: linear-gradient(135deg, rgba(198,32,38,.025), rgba(215,164,65,.035)), #fff;
  box-shadow: 0 3px 12px rgba(54,31,29,.06);
}
.answer-text { margin: 0; color: #352b29; font-size: 14px; line-height: 1.85; }

.result-card { margin-top: 17px; padding: 0 16px 12px; border: 1px solid #ebb1ae; border-radius: 9px; background: #fff; }
.result-title { height: 45px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #ebcac8; color: #2f2523; font-size: 13px; font-weight: 600; }
.activity-chart { width: 100%; height: 218px; }

.query-result { margin-top: 15px; }
.query-result > p { margin: 6px 0; color: #63504d; font-size: 12px; }
.query-result > p strong { color: var(--ai-brand); font-size: 15px; }
.query-sources { margin-top: 14px; color: #63504d; font-size: 12px; }
.query-sources summary { cursor: pointer; font-weight: 600; }
.query-sources p { white-space: pre-line; }
.report-actions { display: flex; gap: 8px; margin-top: 13px; }
.report-actions :deep(.el-button) { margin: 0; border-radius: 6px; }
.report-actions :deep(.el-button:first-child) { color: var(--ai-brand); border-color: #db9996; }

.typing { width: max-content; display: flex; align-items: center; gap: 5px; padding: 14px 18px; }
.typing i { width: 6px; height: 6px; border-radius: 50%; background: var(--ai-brand); animation: typing-dot 1.2s infinite ease-in-out; }
.typing i:nth-child(2) { animation-delay: .15s; }
.typing i:nth-child(3) { animation-delay: .3s; }
.typing span { margin-left: 5px; color: #786461; font-size: 11px; }

.empty-chat { height: 100%; min-height: 350px; display: grid; place-content: center; justify-items: center; text-align: center; }
.empty-chat > span { width: 66px; height: 66px; display: grid; place-items: center; border-radius: 20px; color: var(--ai-brand); background: #f7e4e5; font-size: 30px; }
.empty-chat h2 { margin: 18px 0 7px; font-size: 20px; }
.empty-chat p { margin: 0 0 18px; color: #7c6865; font-size: 13px; }

.composer-area { flex: 0 0 auto; padding: 14px 20px 10px; border-top: 1px solid #e9c5c2; background: #fff; box-shadow: 0 -5px 18px rgba(46,26,24,.035); }
.suggestions { display: flex; gap: 8px; margin-bottom: 11px; overflow-x: auto; scrollbar-width: none; }
.suggestions::-webkit-scrollbar { display: none; }
.suggestions button { flex: 0 0 auto; padding: 6px 14px; border: 1px solid #e5bab7; border-radius: 999px; color: #6d5855; background: #faf8f8; cursor: pointer; font: inherit; font-size: 11px; transition: all .2s ease; }
.suggestions button.active, .suggestions button:hover { color: var(--ai-brand); border-color: #dc8d89; background: #fff5f5; }
.composer {
  display: flex;
  align-items: flex-end;
  gap: 6px;
  padding: 7px;
  border: 1px solid #e7e4e7;
  border-radius: 12px;
  background: #faf9fb;
  box-shadow: 0 4px 14px rgba(47,30,29,.08);
  transition: border-color .2s ease, box-shadow .2s ease;
}
.composer:focus-within { border-color: var(--ai-brand); box-shadow: 0 0 0 3px rgba(198,32,38,.08), 0 4px 14px rgba(47,30,29,.08); }
.composer :deep(.el-textarea) { flex: 1; }
.composer :deep(.el-textarea__inner) { min-height: 38px !important; padding: 9px 6px; border: 0; box-shadow: none; color: #312827; background: transparent; font-size: 13px; line-height: 20px; }
.composer :deep(.el-textarea__inner::placeholder) { color: #97929c; }
.send-button { flex: 0 0 auto; height: 40px; padding: 0 18px; border-radius: 8px; font-weight: 700; }

@keyframes pulse {
  0% { box-shadow: 0 0 0 0 rgba(198,32,38,.45); }
  70% { box-shadow: 0 0 0 7px rgba(198,32,38,0); }
  100% { box-shadow: 0 0 0 0 rgba(198,32,38,0); }
}
@keyframes typing-dot {
  0%, 60%, 100% { transform: translateY(0); opacity: .45; }
  30% { transform: translateY(-4px); opacity: 1; }
}

@media (max-width: 1280px) {
  .message { width: 98%; }
  .chat-body { padding-left: 20px; padding-right: 20px; }
}
</style>
