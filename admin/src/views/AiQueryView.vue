<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import * as echarts from 'echarts'
import {
  ChatDotRound,
  Clock,
  Delete,
  Download,
  Microphone,
  Paperclip,
  Printer,
  Promotion,
  UserFilled,
  WarningFilled,
} from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { downloadComparisonExcel, printComparisonReport } from '@/utils/comparisonReport'

let messageId = 10
let replyTimer
const query = ref('')
const isThinking = ref(false)
const chatBodyRef = ref()
const chartElements = new Map()
const chartInstances = new Map()

const comparisonRows = [
  { dimension: '必修课完成率', academic: '95%', research: '90%', difference: '+5%', positive: true },
  { dimension: '心得体会提交率', academic: '82%', research: '75%', difference: '+7%', positive: true },
  { dimension: '线下活动参与度', academic: '86%', research: '88%', difference: '-2%', positive: false },
]

function initialMessages() {
  return [
    {
      id: 1,
      role: 'user',
      text: '帮我分析一下过去三个月校办公室党支部的学习活跃度趋势。',
    },
    {
      id: 2,
      role: 'assistant',
      kind: 'trend',
      text: '好的，正在为您分析。根据数据显示，校办公室党支部在过去三个月的活跃度呈稳步上升趋势，特别是在 5 月份发布《党的二十大报告全文学习》内容后，日活跃度环比增长了 15%。',
      chart: { labels: ['3 月', '4 月', '5 月'], values: [42, 58, 81] },
    },
    {
      id: 3,
      role: 'user',
      text: '生成一份对比报表，对比教务处党支部和科研处党支部的任务完成率。',
    },
    {
      id: 4,
      role: 'assistant',
      kind: 'comparison',
      title: '党组织任务完成率对比报表',
      text: '已为您生成对比分析：教务处党支部（88%）目前略高于科研处党支部（82%）。以下是详细维度的对比列表：',
      left: { name: '教务处党支部', rate: '88%' },
      right: { name: '科研处党支部', rate: '82%' },
      rows: comparisonRows,
    },
  ]
}

const messages = ref(initialMessages())

const suggestions = [
  { label: '本周学习简报', prompt: '生成本周全校党组织学习简报' },
  { label: '活跃度对比', prompt: '对比校办公室党支部和教务处党支部本月学习活跃度' },
  { label: '异常数据监测', prompt: '检查本周学习任务中的异常数据' },
  { label: '导出报表', prompt: '生成各支部本月任务完成率对比报表' },
]

function setChartElement(element, id) {
  if (element) chartElements.set(id, element)
  else chartElements.delete(id)
}

function renderCharts() {
  messages.value.filter((message) => message.kind === 'trend').forEach((message) => {
    const element = chartElements.get(message.id)
    if (!element) return
    let chart = chartInstances.get(message.id)
    if (!chart) {
      chart = echarts.init(element)
      chartInstances.set(message.id, chart)
    }
    chart.setOption({
      animationDuration: 700,
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        backgroundColor: '#2f3032',
        borderWidth: 0,
        textStyle: { color: '#fff', fontSize: 12 },
        formatter(params) {
          const point = params[0]
          return `${point.axisValue}<br/>活跃指数&nbsp;&nbsp;<b>${point.value}</b>`
        },
      },
      grid: { top: 18, left: 38, right: 18, bottom: 32 },
      xAxis: {
        type: 'category',
        data: message.chart.labels,
        axisTick: { show: false },
        axisLine: { lineStyle: { color: '#e8ebf0' } },
        axisLabel: { color: '#63504d', fontSize: 11, margin: 10 },
      },
      yAxis: {
        type: 'value',
        max: 100,
        axisTick: { show: false },
        axisLine: { show: false },
        axisLabel: { color: '#786562', fontSize: 10 },
        splitLine: { lineStyle: { color: '#f0edef' } },
      },
      series: [{
        type: 'bar',
        barWidth: '46%',
        data: message.chart.values.map((value, index) => ({
          value,
          itemStyle: {
            color: index === message.chart.values.length - 1 ? '#bd2638' : '#dfdde0',
            borderRadius: [3, 3, 0, 0],
          },
        })),
      }],
    }, true)
  })
}

async function scrollToBottom(behavior = 'smooth') {
  await nextTick()
  if (!chatBodyRef.value) return
  chatBodyRef.value.scrollTo({ top: chatBodyRef.value.scrollHeight, behavior })
}

function createAssistantReply(text) {
  if (text.includes('异常') || text.includes('预警')) {
    return {
      id: ++messageId,
      role: 'assistant',
      kind: 'alerts',
      text: '已完成本周学习数据巡检，共发现 3 项值得关注的情况，建议优先处理临近截止且完成率偏低的任务。',
      alerts: [
        { title: '党纪学习教育专题', detail: '机关党委完成率 62%，距截止时间仅剩 3 天', level: '高' },
        { title: '青年党员理论研修', detail: '12 名学员连续 7 天未产生学习记录', level: '中' },
        { title: '二十大精神专题测验', detail: '科研处党支部平均分较上月下降 4.6 分', level: '中' },
      ],
    }
  }

  if (text.includes('简报')) {
    return {
      id: ++messageId,
      role: 'assistant',
      kind: 'brief',
      text: '本周学习简报已生成。全校学习整体保持活跃，任务完成率和人均学习时长均较上周稳步提升。',
      stats: [
        { label: '参与学习', value: '1,124 人', note: '覆盖率 87.4%' },
        { label: '完成任务', value: '3,086 次', note: '环比 +8.2%' },
        { label: '人均时长', value: '4.8 小时', note: '环比 +0.6h' },
      ],
    }
  }

  if (text.includes('报表') || text.includes('对比') || text.includes('完成率')) {
    return {
      id: ++messageId,
      role: 'assistant',
      kind: 'comparison',
      title: '党组织任务完成率对比报表',
      text: '已根据最新任务记录生成组织对比。教务处党支部的综合完成率领先 6 个百分点，科研处党支部在线下活动参与度方面表现更好。',
      left: { name: '教务处党支部', rate: '88%' },
      right: { name: '科研处党支部', rate: '82%' },
      rows: comparisonRows,
    }
  }

  if (text.includes('活跃') || text.includes('趋势')) {
    return {
      id: ++messageId,
      role: 'assistant',
      kind: 'trend',
      text: '分析完成。近三个月整体学习活跃度持续上升，5 月专题课程上线后增长最为明显，建议继续在月中安排集中学习提醒。',
      chart: { labels: ['5 月', '6 月', '7 月'], values: [56, 68, 84] },
    }
  }

  return {
    id: ++messageId,
    role: 'assistant',
    kind: 'text',
    text: `我已理解您的问题：“${text}”。当前演示数据表明，全校学习运行总体平稳，综合任务完成率为 87.6%。接入后台统计接口后，我还可以继续按组织、时间和任务类型生成精确分析。`,
  }
}

async function sendMessage(preset) {
  const text = (typeof preset === 'string' ? preset : query.value).trim()
  if (!text || isThinking.value) return

  messages.value.push({ id: ++messageId, role: 'user', text })
  query.value = ''
  isThinking.value = true
  await scrollToBottom()

  replyTimer = window.setTimeout(async () => {
    messages.value.push(createAssistantReply(text))
    isThinking.value = false
    await nextTick()
    renderCharts()
    scrollToBottom()
  }, 720)
}

function clearConversation() {
  ElMessageBox.confirm('清空后，本次模拟对话记录将无法恢复。', '确认清空对话', {
    confirmButtonText: '确认清空',
    cancelButtonText: '取消',
    type: 'warning',
  }).then(() => {
    window.clearTimeout(replyTimer)
    isThinking.value = false
    chartInstances.forEach((chart) => chart.dispose())
    chartInstances.clear()
    chartElements.clear()
    messages.value = []
    ElMessage.success('对话已清空')
  }).catch(() => {})
}

function restoreDemo() {
  messages.value = initialMessages()
  nextTick(() => {
    renderCharts()
    scrollToBottom('auto')
  })
}

function exportReport(message) {
  try {
    const filename = downloadComparisonExcel(message)
    ElMessage.success(`已导出 ${filename}`)
  } catch (error) {
    ElMessage.error(error.message || 'Excel 导出失败')
  }
}

function printReport(message) {
  try {
    printComparisonReport(message)
  } catch (error) {
    ElMessage.error(error.message || '打印失败，请检查浏览器是否拦截了打印窗口')
  }
}

function handleResize() {
  chartInstances.forEach((chart) => chart.resize())
}

onMounted(async () => {
  await nextTick()
  renderCharts()
  window.addEventListener('resize', handleResize)
})

onBeforeUnmount(() => {
  window.clearTimeout(replyTimer)
  window.removeEventListener('resize', handleResize)
  chartInstances.forEach((chart) => chart.dispose())
  chartInstances.clear()
})
</script>

<template>
  <section class="ai-query-view">
    <header class="assistant-header">
      <div class="assistant-identity">
        <span class="assistant-mark"><el-icon><ChatDotRound /></el-icon></span>
        <div>
          <h1>AI 智能助理</h1>
          <p><i></i>在线 · 随时为您分析数据</p>
        </div>
      </div>
      <div class="header-actions">
        <el-button plain :icon="Clock" @click="ElMessage.info('历史记录将在接口接入后开放')">历史记录</el-button>
        <el-button plain :icon="Delete" @click="clearConversation">清空对话</el-button>
      </div>
    </header>

    <main ref="chatBodyRef" class="chat-body">
      <div v-if="messages.length" class="chat-date">今天 09:41</div>

      <template v-for="message in messages" :key="message.id">
        <div v-if="message.role === 'user'" class="message user-message">
          <div class="message-bubble user-bubble">{{ message.text }}</div>
          <span class="user-avatar"><el-icon><UserFilled /></el-icon></span>
        </div>

        <div v-else class="message assistant-message">
          <span class="ai-avatar"><el-icon><ChatDotRound /></el-icon></span>
          <div class="message-bubble assistant-bubble">
            <p class="answer-text">{{ message.text }}</p>

            <div v-if="message.kind === 'trend'" class="result-card chart-result">
              <div class="result-title"><span>学习活跃度趋势（近 3 个月）</span><span class="mini-chart-icon">⌁</span></div>
              <div :ref="(element) => setChartElement(element, message.id)" class="activity-chart"></div>
            </div>

            <div v-else-if="message.kind === 'comparison'" class="comparison-result">
              <div class="comparison-summary">
                <span><b>{{ message.left?.rate || '88%' }}</b> {{ message.left?.name || '教务处党支部' }}</span>
                <i></i>
                <span><b>{{ message.right?.rate || '82%' }}</b> {{ message.right?.name || '科研处党支部' }}</span>
              </div>
              <div class="data-table-wrap">
                <table>
                  <thead><tr><th>考核维度</th><th>{{ message.left?.name || '教务处党支部' }}</th><th>{{ message.right?.name || '科研处党支部' }}</th><th>差异</th></tr></thead>
                  <tbody>
                    <tr v-for="row in message.rows" :key="row.dimension">
                      <td>{{ row.dimension }}</td>
                      <td class="emphasis">{{ row.academic }}</td>
                      <td>{{ row.research }}</td>
                      <td :class="row.positive ? 'positive' : 'negative'">{{ row.difference }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div class="report-actions">
                <el-button plain size="small" :icon="Download" @click="exportReport(message)">导出 Excel</el-button>
                <el-button plain size="small" :icon="Printer" @click="printReport(message)">打印报表</el-button>
              </div>
            </div>

            <div v-else-if="message.kind === 'brief'" class="brief-result">
              <article v-for="item in message.stats" :key="item.label">
                <span>{{ item.label }}</span><strong>{{ item.value }}</strong><small>{{ item.note }}</small>
              </article>
            </div>

            <div v-else-if="message.kind === 'alerts'" class="alert-result">
              <article v-for="item in message.alerts" :key="item.title">
                <el-icon><WarningFilled /></el-icon>
                <div><strong>{{ item.title }}</strong><p>{{ item.detail }}</p></div>
                <span :class="item.level === '高' ? 'high' : 'medium'">{{ item.level }}风险</span>
              </article>
            </div>
          </div>
        </div>
      </template>

      <div v-if="isThinking" class="message assistant-message thinking-message">
        <span class="ai-avatar"><el-icon><ChatDotRound /></el-icon></span>
        <div class="message-bubble assistant-bubble typing"><i></i><i></i><i></i><span>正在分析数据</span></div>
      </div>

      <div v-if="!messages.length" class="empty-chat">
        <span><el-icon><ChatDotRound /></el-icon></span>
        <h2>开始一次数据对话</h2>
        <p>您可以询问学习活跃度、任务完成率、组织对比或异常数据。</p>
        <el-button type="primary" @click="restoreDemo">恢复演示对话</el-button>
      </div>
    </main>

    <footer class="composer-area">
      <div class="suggestions">
        <button v-for="(item, index) in suggestions" :key="item.label" :class="{ active: index === 0 }" @click="sendMessage(item.prompt)">
          {{ item.label }}
        </button>
      </div>
      <div class="composer">
        <button class="icon-button" title="添加附件" @click="ElMessage.info('附件分析将在文件接口接入后开放')"><el-icon><Paperclip /></el-icon></button>
        <el-input
          v-model="query"
          type="textarea"
          :autosize="{ minRows: 1, maxRows: 3 }"
          resize="none"
          placeholder="输入您想查询的内容，如：‘统计本周新增党员数量’或‘生成月度学习简报’"
          @keydown.enter.exact.prevent="sendMessage()"
        />
        <button class="icon-button" title="语音输入" @click="ElMessage.info('语音输入将在设备权限接入后开放')"><el-icon><Microphone /></el-icon></button>
        <el-button class="send-button" type="primary" :loading="isThinking" :disabled="!query.trim()" @click="sendMessage()">
          发送<el-icon class="el-icon--right"><Promotion /></el-icon>
        </el-button>
      </div>
      <p class="ai-disclaimer">AI 生成的内容仅供参考，敏感决策请以实际系统数据核对为准。</p>
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
.chat-date { width: max-content; margin: 0 auto 38px; padding: 5px 17px; border-radius: 999px; color: #685451; background: #eceaec; font-size: 11px; }
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
.mini-chart-icon { color: #5c403d; font-size: 20px; transform: rotate(-15deg); }
.activity-chart { width: 100%; height: 218px; }

.comparison-result { margin-top: 16px; }
.comparison-summary {
  display: flex;
  align-items: center;
  gap: 14px;
  width: max-content;
  margin-bottom: 12px;
  padding: 7px 12px;
  border-radius: 7px;
  color: #715c59;
  background: #f7f3f3;
  font-size: 11px;
}
.comparison-summary span { display: inline-flex; align-items: baseline; gap: 5px; }
.comparison-summary b { color: var(--ai-brand); font-size: 15px; }
.comparison-summary i { width: 1px; height: 18px; background: #ddc8c6; }
.data-table-wrap { overflow-x: auto; border: 1px solid #e8e5e8; border-radius: 8px; }
.data-table-wrap table { width: 100%; min-width: 560px; border-collapse: collapse; text-align: left; font-size: 12px; }
.data-table-wrap th { padding: 10px 14px; color: #6e5a57; background: #fafafa; font-weight: 600; }
.data-table-wrap td { padding: 11px 14px; border-top: 1px solid #ece9ec; color: #413634; }
.data-table-wrap tr:hover td { background: rgba(198,32,38,.025); }
.data-table-wrap td.emphasis { color: var(--ai-brand); font-weight: 700; }
.data-table-wrap td.positive { color: #2b8b59; font-weight: 600; }
.data-table-wrap td.negative { color: var(--ai-brand); font-weight: 600; }
.report-actions { display: flex; gap: 8px; margin-top: 13px; }
.report-actions :deep(.el-button) { margin: 0; border-radius: 6px; }
.report-actions :deep(.el-button:first-child) { color: var(--ai-brand); border-color: #db9996; }

.brief-result { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-top: 16px; }
.brief-result article { padding: 14px; border: 1px solid #ebd3d1; border-radius: 8px; background: #fff; }
.brief-result span, .brief-result strong, .brief-result small { display: block; }
.brief-result span { color: #806c69; font-size: 11px; }
.brief-result strong { margin: 5px 0 3px; font-size: 18px; }
.brief-result small { color: #ae2f2f; font-size: 10px; }

.alert-result { display: grid; gap: 9px; margin-top: 16px; }
.alert-result article { display: grid; grid-template-columns: 24px minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 12px 13px; border: 1px solid #ead8d1; border-radius: 8px; background: #fffaf7; }
.alert-result .el-icon { color: #d98c16; font-size: 19px; }
.alert-result strong { font-size: 12px; }
.alert-result p { margin: 3px 0 0; color: #7a6865; font-size: 11px; }
.alert-result article > span { padding: 3px 7px; border-radius: 999px; font-size: 10px; }
.alert-result article > span.high { color: #a00014; background: #f9e4e5; }
.alert-result article > span.medium { color: #9a6711; background: #fff0ce; }

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
.icon-button { flex: 0 0 auto; width: 38px; height: 38px; display: grid; place-items: center; border: 0; border-radius: 8px; color: #6d5552; background: transparent; cursor: pointer; font-size: 19px; transition: all .2s ease; }
.icon-button:hover { color: var(--ai-brand); background: #f8e9e9; }
.send-button { flex: 0 0 auto; height: 40px; padding: 0 18px; border-radius: 8px; font-weight: 700; }
.ai-disclaimer { margin: 7px 0 0; color: #a19a9d; text-align: center; font-size: 9px; }

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
  .brief-result { grid-template-columns: 1fr; }
}
</style>
