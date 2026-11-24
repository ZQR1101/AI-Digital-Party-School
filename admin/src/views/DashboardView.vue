<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as echarts from 'echarts'
import {
  ArrowRight,
  CircleCheckFilled,
  Clock,
  Collection,
  MagicStick,
  TrendCharts,
  User,
  WarningFilled,
} from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import request from '@/api/request'
import { formatBeijingDateTime } from '@/utils/dateTime'

const organizationId = ref('')
const timeRange = ref('6m')
const chartRef = ref()
const loading = ref(false)
const reporting = ref(false)
const organizationOptions = ref([{ id: '', name: '全校党组织' }])
const overview = ref({
  totalMembers: 0,
  avgStudyHours: 0,
  passRate: 0,
  totalContents: 0,
  memberChange: 0,
  contentChange: 0,
  completionRate: 0,
  completionSampleSize: 0,
})
const activityTrend = ref([])
const passRates = ref([])
const ranking = ref([])
const insight = ref({ forecastPassRate: 0, warning: '正在加载学习数据。' })
const updatedAtLabel = ref('--')
let trendChart

const timeOptions = [
  { label: '最近 30 天', value: '30d' },
  { label: '最近 3 个月', value: '3m' },
  { label: '最近 6 个月', value: '6m' },
]

const currentUserName = computed(() => {
  try {
    return JSON.parse(localStorage.getItem('adminUser') || '{}').realName || '管理员'
  } catch {
    return '管理员'
  }
})

const greeting = computed(() => {
  const hour = Number(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    hour: 'numeric',
    hourCycle: 'h23',
  }).format(new Date()))
  if (hour < 12) return '上午好'
  if (hour < 18) return '下午好'
  return '晚上好'
})

const timeRangeLabel = computed(() => timeOptions.find(item => item.value === timeRange.value)?.label || '')
const selectedOrganizationName = computed(() => organizationOptions.value.find(item => item.id === organizationId.value)?.name || '全校党组织')

const metrics = computed(() => [
  { label: '学习总人数', value: String(overview.value.totalMembers), change: String(overview.value.memberChange), changePrefix: '近 30 天新增', icon: User },
  { label: '平均学习时长', value: `${overview.value.avgStudyHours}h/人`, change: overview.value.completionSampleSize === 0 ? '暂无数据' : `${overview.value.completionRate}%`, changePrefix: '任务完成率', icon: Clock },
  { label: '综合及格率', value: `${overview.value.passRate}%`, change: `${overview.value.passRate}`, changePrefix: '按各场考核规则计分', icon: CircleCheckFilled },
  { label: '课程资源总数', value: String(overview.value.totalContents), change: String(overview.value.contentChange), changePrefix: '近 30 天新增', icon: Collection },
])

function flattenOrganizations(nodes, result = []) {
  for (const node of nodes || []) {
    result.push({ id: node.id, name: node.name })
    if (node.children?.length) flattenOrganizations(node.children, result)
  }
  return result
}

async function loadOrganizations() {
  const tree = await request.get('/admin/organizations')
  organizationOptions.value = [{ id: '', name: '全校党组织' }, ...flattenOrganizations(Array.isArray(tree) ? tree : [])]
}

async function loadDashboard() {
  loading.value = true
  try {
    const result = await request.get('/admin/statistics', {
      params: {
        organizationId: organizationId.value || undefined,
        range: timeRange.value,
      },
    })
    overview.value = result.overview || overview.value
    activityTrend.value = result.activityTrend || result.trend || []
    passRates.value = result.passRateTrend || []
    ranking.value = result.ranking || result.organizationStats || []
    insight.value = result.insight || insight.value
    updatedAtLabel.value = `数据更新于 ${formatBeijingDateTime(new Date())}`
    await nextTick()
    renderTrendChart()
  } catch (error) {
    ElMessage.error(error.message || '数据总览加载失败')
  } finally {
    loading.value = false
  }
}

function renderTrendChart() {
  if (!chartRef.value) return
  if (!trendChart) trendChart = echarts.init(chartRef.value)
  const labels = activityTrend.value.map(item => item.label)
  const values = activityTrend.value.map(item => Number(item.value || 0))

  trendChart.setOption({
    animationDuration: 900,
    color: ['#c62026'],
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#2f3032',
      borderWidth: 0,
      padding: [8, 12],
      textStyle: { color: '#fff', fontSize: 12 },
      formatter(params) {
        const point = params[0]
        return `${point.axisValue}<br/>活跃人数&nbsp;&nbsp;<b>${point.value}</b> 人`
      },
    },
    grid: { left: 46, right: 24, top: 24, bottom: 40 },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: labels,
      axisTick: { show: false },
      axisLine: { lineStyle: { color: '#e4bdba' } },
      axisLabel: { color: '#725b59', fontSize: 12, margin: 14 },
    },
    yAxis: {
      type: 'value',
      min: 0,
      axisLabel: { color: '#8b7472', fontSize: 11 },
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { lineStyle: { color: '#f0dddc', type: 'dashed' } },
    },
    series: [{
      name: '活跃人数',
      type: 'line',
      smooth: 0.42,
      symbol: 'circle',
      symbolSize: 7,
      showSymbol: false,
      data: values,
      lineStyle: { width: 3, color: '#c62026', cap: 'round' },
      itemStyle: { color: '#c62026', borderColor: '#fff', borderWidth: 2 },
      areaStyle: {
        color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
          { offset: 0, color: 'rgba(198, 32, 38, .24)' },
          { offset: 1, color: 'rgba(198, 32, 38, .015)' },
        ]),
      },
    }],
  }, true)
}

async function showReport() {
  reporting.value = true
  const period = { '30d': '最近30天', '3m': '最近3个月', '6m': '最近6个月' }[timeRange.value] || '最近6个月'
  const name = selectedOrganizationName.value
  const reportMetrics = ['学习完成率', '考试及格率']
  try {
    const results = await Promise.allSettled(reportMetrics.map(metric => request.post('/ai/query', {
      message: `查询「${name}」${period}的${metric}趋势`,
    })))
    const paragraphs = results.map((result, index) => result.status === 'fulfilled'
      ? result.value.answer
      : `${reportMetrics[index]}：${result.reason?.message || '查询失败'}`)
    await ElMessageBox.alert(paragraphs.join('\n'), '智能分析报告', { confirmButtonText: '知道了' }).catch(() => {})
  } finally {
    reporting.value = false
  }
}

function handleResize() {
  trendChart?.resize()
}

watch([organizationId, timeRange], () => {
  loadDashboard()
})

onMounted(async () => {
  window.addEventListener('resize', handleResize)
  try {
    await loadOrganizations()
  } catch (error) {
    ElMessage.error(error.message || '组织列表加载失败')
  }
  await loadDashboard()
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize)
  trendChart?.dispose()
  trendChart = undefined
})
</script>

<template>
  <div class="dashboard-view" v-loading="loading">
    <section class="dashboard-toolbar">
      <div>
        <h1>数据总览</h1>
        <p>汇聚组织学习数据，实时掌握党员教育成效</p>
      </div>
      <div class="global-filters" aria-label="数据筛选">
        <div class="filter-field">
          <span>组织范围</span>
          <el-select v-model="organizationId" aria-label="组织范围" :teleported="false">
            <el-option v-for="item in organizationOptions" :key="item.id || 'all'" :label="item.name" :value="item.id" />
          </el-select>
        </div>
        <i></i>
        <div class="filter-field">
          <span>时间范围</span>
          <el-select v-model="timeRange" aria-label="时间范围" :teleported="false">
            <el-option v-for="item in timeOptions" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
        </div>
      </div>
    </section>

    <section class="welcome-banner">
      <div class="welcome-copy">
        <span>智慧学习 · 数据赋能</span>
        <h2 data-testid="stat-welcome">{{ greeting }}，{{ currentUserName }}</h2>
        <p>当前查看「{{ selectedOrganizationName }}」的真实学习数据</p>
      </div>
      <div class="welcome-orbit orbit-one"></div>
      <div class="welcome-orbit orbit-two"></div>
      <div class="spark spark-large">✦</div>
      <div class="spark spark-small">✦</div>
    </section>

    <section class="metric-grid">
      <article v-for="item in metrics" :key="item.label" class="metric-card">
        <div class="metric-card-top">
          <span class="metric-icon"><el-icon><component :is="item.icon" /></el-icon></span>
          <span class="metric-change"><el-icon><TrendCharts /></el-icon>{{ item.change }}</span>
        </div>
        <p>{{ item.label }}</p>
        <strong>{{ item.value }}</strong>
        <small>{{ item.changePrefix }}</small>
      </article>
    </section>

    <section class="analysis-grid">
      <article class="panel trend-panel">
        <header class="panel-heading">
          <div><i></i><h3>学习活跃度趋势</h3><span>（{{ timeRangeLabel }}）</span></div>
          <div class="legend"><b></b>活跃人数</div>
        </header>
        <div ref="chartRef" class="trend-chart" role="img" aria-label="学习活跃度趋势折线图"></div>
      </article>

      <article class="panel forecast-panel">
        <header class="panel-heading">
          <div><i></i><h3>AI 趋势预测</h3></div>
        </header>
        <div class="insight-card">
          <div class="insight-title"><el-icon><MagicStick /></el-icon><strong>综合及格率预测</strong></div>
          <p>按最近两个季度变化推算，下阶段综合及格率约为 <b>{{ insight.forecastPassRate }}%</b>。</p>
        </div>
        <div class="insight-card warning">
          <div class="insight-title"><el-icon><WarningFilled /></el-icon><strong>学习预警提示</strong></div>
          <p>{{ insight.warning }}</p>
        </div>
        <el-button class="report-button" plain :loading="reporting" @click="showReport">
          查看完整分析报告<el-icon class="el-icon--right"><ArrowRight /></el-icon>
        </el-button>
      </article>
    </section>

    <section class="bottom-grid">
      <article class="panel pass-panel">
        <header class="panel-heading">
          <div><i></i><h3>及格率趋势分析</h3></div>
        </header>
        <div class="pass-list">
          <div v-for="item in passRates" :key="item.label" class="pass-row">
            <span>{{ item.label }}</span>
            <div class="pass-track">
              <div class="pass-value" :style="{ width: `${Math.min(item.value, 100)}%` }"></div>
              <b>{{ item.value }}%</b>
            </div>
          </div>
        </div>
      </article>

      <article class="panel ranking-panel">
        <header class="panel-heading">
          <div><i></i><h3>各支部测验平均分</h3></div>
          <span class="panel-note">{{ updatedAtLabel }}</span>
        </header>
        <div class="ranking-head"><span>排名</span><span>支部名称</span><span>平均分</span></div>
        <div v-if="!ranking.length" class="empty-hint">暂无测验成绩</div>
        <div v-for="(item, index) in ranking" :key="item.organizationId || item.name" class="ranking-row">
          <span :class="['rank-badge', { podium: index < 3 }]">{{ index + 1 }}</span>
          <strong>{{ item.name || item.organizationName }}</strong>
          <b :class="{ champion: index === 0 }">{{ item.score }}</b>
        </div>
      </article>
    </section>
  </div>
</template>

<style scoped>
.dashboard-view {
  --dashboard-red: #c62026;
  --dashboard-dark-red: #8f171c;
  --dashboard-gold: #d7a441;
  color: #1a1c1d;
}

.dashboard-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 18px;
}

.dashboard-toolbar h1 {
  margin: 0;
  font-size: 24px;
  line-height: 32px;
  font-weight: 700;
  letter-spacing: .02em;
}

.dashboard-toolbar p {
  margin: 4px 0 0;
  color: #8a7471;
  font-size: 12px;
}

.global-filters {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 8px 10px;
  border: 1px solid #f0e3e2;
  border-radius: 10px;
  background: #fff;
  box-shadow: 0 4px 16px rgba(75, 33, 31, .08);
}

.global-filters > i {
  width: 1px;
  height: 24px;
  background: #e4bdba;
}

.filter-field {
  display: flex;
  align-items: center;
  gap: 2px;
  color: #745e5b;
  font-size: 12px;
  white-space: nowrap;
}

.filter-field > span { padding-left: 8px; }
.filter-field :deep(.el-select) { width: 168px; }
.filter-field :deep(.el-select__wrapper) {
  min-height: 30px;
  padding-left: 7px;
  border-radius: 6px;
  box-shadow: none;
  background: transparent;
}
.filter-field :deep(.el-select__selected-item) { color: #2f2322; font-weight: 600; font-size: 12px; }
.filter-field :deep(.el-select__wrapper:hover),
.filter-field :deep(.el-select__wrapper.is-focused) { box-shadow: 0 0 0 1px var(--dashboard-red) inset; }

.welcome-banner {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  height: 168px;
  display: flex;
  align-items: center;
  padding: 0 38px;
  border: 1px solid rgba(198, 32, 38, .18);
  border-radius: 12px;
  color: #fff;
  background:
    radial-gradient(circle at 79% 28%, rgba(255,255,255,.19), transparent 18%),
    linear-gradient(105deg, #8f171c 0%, #b51720 45%, #c62026 70%, #d18365 125%);
  box-shadow: 0 8px 24px rgba(104, 16, 20, .14);
}

.welcome-copy { position: relative; z-index: 2; }
.welcome-copy > span {
  display: inline-flex;
  padding: 4px 10px;
  border: 1px solid rgba(255,255,255,.25);
  border-radius: 999px;
  color: rgba(255,255,255,.82);
  background: rgba(255,255,255,.09);
  font-size: 11px;
}
.welcome-copy h2 { margin: 12px 0 5px; font-size: 30px; line-height: 40px; letter-spacing: .04em; }
.welcome-copy p { margin: 0; color: rgba(255,255,255,.8); font-size: 15px; }
.welcome-orbit { position: absolute; z-index: 0; border: 1px solid rgba(255,255,255,.14); border-radius: 50%; }
.orbit-one { width: 330px; height: 330px; right: -44px; top: -192px; box-shadow: 0 0 0 54px rgba(255,255,255,.035), 0 0 0 108px rgba(255,255,255,.02); }
.orbit-two { width: 150px; height: 150px; right: 215px; bottom: -112px; }
.spark { position: absolute; z-index: 1; color: rgba(255,255,255,.52); transform: rotate(12deg); }
.spark-large { right: 155px; top: 22px; font-size: 74px; }
.spark-small { right: 82px; bottom: 18px; font-size: 36px; opacity: .7; }

.metric-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 18px;
  margin: 20px 0;
}

.metric-card {
  display: block;
  min-width: 0;
  min-height: 176px;
  padding: 20px 22px 18px;
  border: 1px solid #efc0bd;
  border-radius: 10px;
  background: #fff;
  box-shadow: 0 4px 14px rgba(63, 32, 30, .07);
  transition: transform .25s ease, box-shadow .25s ease, border-color .25s ease;
}

.metric-card:hover { transform: translateY(-4px); border-color: #dc8581; box-shadow: 0 12px 25px rgba(89, 22, 25, .12); }
.metric-card-top { display: flex; align-items: flex-start; justify-content: space-between; }
.metric-icon {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: 9px;
  color: var(--dashboard-red);
  background: #f8e8e9;
  font-size: 22px;
}
.metric-change { display: inline-flex; align-items: center; gap: 3px; color: #202325; font-size: 12px; font-weight: 700; }
.metric-change .el-icon { font-size: 14px; }
.metric-card:nth-child(4) .metric-change { color: var(--dashboard-red); }
.metric-card p { margin: 19px 0 6px; color: #695754; font-size: 13px; }
.metric-card strong { display: block; font-size: 28px; line-height: 36px; font-weight: 500; letter-spacing: -.03em; }
.metric-card small { display: block; height: 0; overflow: hidden; color: #9a8582; font-size: 11px; opacity: 0; transition: height .2s ease, opacity .2s ease; }
.metric-card:hover small { height: 18px; margin-top: 4px; opacity: 1; }

.analysis-grid, .bottom-grid { display: grid; gap: 20px; }
.analysis-grid { grid-template-columns: minmax(0, 2.05fr) minmax(310px, .95fr); margin-bottom: 20px; }
.bottom-grid { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
.panel {
  overflow: hidden;
  border: 1px solid #efc0bd;
  border-radius: 10px;
  background: #fff;
  box-shadow: 0 4px 16px rgba(65, 38, 36, .07);
}
.panel-heading {
  min-height: 64px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 0 24px;
}
.panel-heading > div:first-child { display: flex; align-items: center; min-width: 0; }
.panel-heading i { flex: 0 0 auto; width: 4px; height: 22px; margin-right: 10px; border-radius: 4px; background: var(--dashboard-red); }
.panel-heading h3 { margin: 0; font-size: 17px; line-height: 24px; font-weight: 600; }
.panel-heading h3 + span { margin-left: 4px; color: #725d5a; font-size: 12px; }
.legend { color: #725d5a; font-size: 12px; }
.legend b { display: inline-block; width: 10px; height: 10px; margin-right: 6px; border-radius: 50%; background: var(--dashboard-red); }
.trend-chart { height: 344px; margin: 0 14px 12px 0; }

.forecast-panel { display: flex; flex-direction: column; padding-bottom: 22px; }
.insight-card {
  margin: 0 22px 14px;
  padding: 18px;
  border: 1px solid #ead1cf;
  border-radius: 9px;
  background: linear-gradient(135deg, rgba(198,32,38,.055), rgba(215,164,65,.045));
}
.insight-card.warning { margin-top: 2px; }
.insight-title { display: flex; align-items: center; gap: 9px; color: #1d2022; font-size: 14px; }
.insight-title .el-icon { color: var(--dashboard-red); font-size: 21px; }
.insight-card.warning .insight-title .el-icon { color: #d79416; }
.insight-card p { margin: 12px 0 0; color: #665552; font-size: 13px; line-height: 1.75; }
.insight-card p b { color: var(--dashboard-red); }
.report-button { width: calc(100% - 44px); height: 40px; margin: auto 22px 0; color: var(--dashboard-red); border-color: #efb4b1; border-radius: 8px; font-weight: 600; }
.report-button:hover { color: #fff; border-color: var(--dashboard-red); background: var(--dashboard-red); }

.pass-panel { min-height: 358px; }
.pass-list { padding: 22px 28px 32px; }
.pass-row { display: grid; grid-template-columns: 112px minmax(0, 1fr); align-items: center; gap: 18px; margin-bottom: 22px; }
.pass-row:last-child { margin-bottom: 0; }
.pass-row > span { color: #6d5855; font-size: 13px; }
.pass-track { position: relative; overflow: hidden; height: 28px; border-radius: 2px; background: #f0eff0; }
.pass-value { height: 100%; min-width: 0; background: linear-gradient(90deg, #bd151e, #d1262e); transition: width .8s ease; }
.pass-track b { position: absolute; right: 7px; top: 50%; transform: translateY(-50%); color: #1d1e20; font-size: 11px; }

.ranking-panel { min-height: 358px; }
.panel-note { color: #9a8582; font-size: 11px; }
.ranking-head, .ranking-row { display: grid; grid-template-columns: 100px minmax(0, 1fr) 90px; align-items: center; }
.ranking-head { height: 38px; padding: 0 26px; color: #796461; background: #f7f5f6; font-size: 12px; }
.ranking-head span:last-child { text-align: right; }
.ranking-row { min-height: 56px; padding: 0 26px; border-top: 1px solid #efd0ce; transition: background .2s ease; }
.ranking-row:hover { background: rgba(198,32,38,.035); }
.rank-badge { width: 24px; height: 24px; display: grid; place-items: center; color: #705c59; font-size: 12px; font-weight: 700; }
.rank-badge.podium { border-radius: 50%; color: #fff; background: #e7bebe; }
.ranking-row:nth-of-type(2) .rank-badge { background: var(--dashboard-gold); }
.ranking-row strong { font-size: 13px; font-weight: 600; }
.ranking-row > b { text-align: right; font-size: 17px; font-weight: 500; }
.ranking-row > b.champion { color: var(--dashboard-red); }
.empty-hint { padding: 28px 26px; color: #9a8582; font-size: 13px; }

@media (max-width: 1320px) {
  .analysis-grid { grid-template-columns: minmax(0, 1.65fr) minmax(300px, .85fr); }
}
</style>
