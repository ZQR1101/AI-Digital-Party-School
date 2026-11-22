<template>
  <div class="page-shell no-tab">
    <header class="top">
      <button type="button" aria-label="返回" @click="router.back()"><Icon name="arrow_back" /></button>
      <h1>学习档案</h1>
      <span></span>
    </header>

    <main class="canvas">
      <div v-if="reportLoading" class="state-box" role="status"><i></i>正在汇总学习报告</div>
      <div v-else-if="reportError" class="state-box" role="alert">
        <strong>学习报告加载失败</strong><p>{{ reportError }}</p><button type="button" @click="loadReport">重新加载</button>
      </div>
      <template v-else-if="report">
        <section class="card">
          <div class="section-head"><h2>个人学习报告</h2><span>{{ periodLabel }}</span></div>
          <div class="score-summary">
            <div v-if="report.score != null" class="grade">
              <strong class="stat-num">{{ report.score }}</strong><span>综合分 · {{ report.level }}</span>
            </div>
            <p v-else class="no-score">暂无足够的学习数据生成综合评分。</p>
            <p>{{ report.narrative?.summary || report.aiComment?.comment }}</p>
          </div>
          <div class="stats">
            <div><strong>{{ facts.totalStudyHours ?? '—' }}</strong><span>学习时长（小时）</span></div>
            <div><strong>{{ facts.activeDays ?? '—' }}</strong><span>活跃天数</span></div>
            <div><strong>{{ facts.completionRate == null ? '—' : facts.completionRate + '%' }}</strong><span>任务完成率</span></div>
          </div>
          <div v-if="report.assessments" class="stats assessment-stats">
            <div><strong>{{ assessmentStat('quiz') }}</strong><span>测验平均分（{{ report.assessments.quiz?.count ?? 0 }} 次）</span></div>
            <div><strong>{{ assessmentStat('exam') }}</strong><span>考试平均分（{{ report.assessments.exam?.count ?? 0 }} 次）</span></div>
          </div>
          <dl v-if="dimensions.length" class="dimensions">
            <div v-for="item in dimensions" :key="item.key">
              <dt>{{ item.label }}</dt>
              <dd>{{ item.score }}</dd>
            </div>
          </dl>
        </section>

        <section v-if="weakPoints.length || progress.length" class="card">
          <div class="section-head"><h2>知识点诊断</h2></div>
          <ul v-if="weakPoints.length" class="evidence-list">
            <li v-for="item in weakPoints" :key="item.category">
              <strong>{{ item.category }}</strong>
              <span v-if="item.attempts">答错 {{ item.wrongCount }} / {{ item.attempts }} 题</span>
            </li>
          </ul>
          <div v-if="progress.length" class="comparison">
            <h3>同类题表现对比</h3>
            <ul class="evidence-list">
              <li v-for="item in progress" :key="item.category">
                <strong>{{ item.category }}</strong>
                <span>上次 {{ item.previous.correctCount }}/{{ item.previous.attempts }} 题正确 · 最近 {{ item.latest.correctCount }}/{{ item.latest.attempts }} 题正确</span>
              </li>
            </ul>
          </div>
        </section>

        <section v-if="suggestions.length || recommendations.length" class="card">
          <div class="section-head"><h2>改进建议</h2></div>
          <ul v-if="suggestions.length" class="suggestions">
            <li v-for="(item, index) in suggestions" :key="index">
              <strong v-if="item.title">{{ item.title }}</strong>
              <p>{{ item.content }}</p>
            </li>
          </ul>
          <ul v-if="recommendations.length" class="course-list">
            <li v-for="item in recommendations" :key="item.contentId">
              <RouterLink :to="{ name: 'learn', params: { id: item.contentId } }">
                <span><strong>{{ item.title }}</strong><small v-if="item.reason">{{ item.reason }}</small></span>
                <Icon name="chevron_right" />
              </RouterLink>
            </li>
          </ul>
        </section>
        <p v-if="report.disclaimer" class="disclaimer">{{ report.disclaimer }}</p>
      </template>

      <section class="card">
        <div class="section-head">
          <h2>测评记录</h2><RouterLink to="/exam">前往测评</RouterLink>
        </div>
        <p v-if="historyLoading" class="history-state" role="status">正在加载成绩</p>
        <div v-else-if="historyError" class="history-state" role="alert">
          <p>{{ historyError }}</p><button type="button" @click="loadHistory">重新加载</button>
        </div>
        <ul v-else-if="history.length" class="course-list">
          <li v-for="item in history" :key="item.id">
            <RouterLink :to="{ name: 'exam-take', query: { id: item.id } }">
              <span>
                <strong>{{ item.title }}</strong>
                <small>{{ formatAssessmentDate(item.attempt.submittedAt) }} · {{ item.attempt.earnedPoints }}/{{ item.attempt.totalScore }} 分</small>
              </span>
              <Icon name="chevron_right" />
            </RouterLink>
          </li>
        </ul>
        <p v-else class="history-state">暂无已交卷的测评记录。</p>
      </section>
    </main>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import Icon from './components/Icon.vue'
import { getMyAssessments } from './api/assessments'
import { getMyLearningReport } from './api/report'
import { formatAssessmentDate } from './utils/assessmentDate'

const router = useRouter()
const report = ref(null)
const history = ref([])
const reportLoading = ref(true)
const historyLoading = ref(true)
const reportError = ref('')
const historyError = ref('')
const dimensionLabels = {
  completion: '任务完成',
  activity: '学习活跃度',
  quiz: '测验表现',
  exam: '考试表现',
  improvement: '知识掌握',
}
const facts = computed(() => report.value?.facts ?? {})
const periodLabel = computed(() => {
  const period = report.value?.period
  if (!period || typeof period !== 'object') return '当前阶段'
  if (period.startDate && period.endDate) return period.startDate + ' 至 ' + period.endDate
  return period.days ? '近 ' + period.days + ' 天' : '当前阶段'
})
const dimensions = computed(() => Object.entries(report.value?.dimensions ?? {})
  .filter(([key, score]) => dimensionLabels[key] && score != null)
  .map(([key, score]) => ({ key, label: dimensionLabels[key], score })))
const weakPoints = computed(() => (report.value?.weakKnowledgePoints ?? facts.value.weakKnowledgePoints ?? [])
  .map(item => typeof item === 'string' ? { category: item } : item))
const progress = computed(() => (report.value?.knowledgeProgress ?? [])
  .filter(item => item.previous?.attempts && item.latest?.attempts))
const suggestions = computed(() => report.value?.narrative?.suggestions
  ?? (report.value?.aiComment?.suggestion ? [{ content: report.value.aiComment.suggestion }] : []))
const recommendations = computed(() => (report.value?.recommendations ?? []).filter(item => item.contentId))

function assessmentStat(kind) {
  const stat = report.value?.assessments?.[kind]
  return stat?.count && stat.avgScore != null ? stat.avgScore : '—'
}

async function loadReport() {
  reportLoading.value = true
  reportError.value = ''
  try {
    report.value = await getMyLearningReport()
  } catch (err) {
    reportError.value = err.message
  } finally {
    reportLoading.value = false
  }
}

async function loadHistory() {
  historyLoading.value = true
  historyError.value = ''
  try {
    const result = await getMyAssessments()
    history.value = result.list.filter(item => item.attempt)
      .sort((left, right) => Date.parse(right.attempt.submittedAt) - Date.parse(left.attempt.submittedAt))
  } catch (err) {
    historyError.value = err.message
  } finally {
    historyLoading.value = false
  }
}

onMounted(() => {
  loadReport()
  loadHistory()
})
</script>

<style scoped>
.top {
  height: 64px; padding: 0 var(--pad); display: grid; grid-template-columns: 40px 1fr 40px; align-items: center;
  position: sticky; top: 0; background: var(--bg); z-index: 8;
}
.top h1 { text-align: center; font-size: 18px; color: var(--primary); }
.top button { font-size: 22px; color: var(--primary); }
.canvas { max-width: 720px; margin: auto; padding: 16px var(--pad) 32px; display: grid; gap: 16px; }
.card {
  background: var(--surface); border-radius: var(--radius-xl); padding: 18px; box-shadow: var(--whisper);
  border: 1px solid rgba(226, 190, 188, 0.25);
}
.section-head { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
.section-head h2 { font-size: 16px; }
.section-head > span { font-size: 12px; color: var(--muted); }
.section-head a, .history-state button { color: var(--primary); font-size: 13px; }
.score-summary { margin: 14px 0; display: grid; gap: 8px; }
.score-summary strong { color: var(--primary); font-size: 36px; line-height: 1.1; }
.grade { display: flex; align-items: baseline; gap: 8px; font-size: 13px; color: var(--primary); }
.score-summary p, .suggestions p { color: var(--muted); font-size: 14px; line-height: 1.6; overflow-wrap: anywhere; }
.score-summary .no-score { color: var(--ink); }
.stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.stats > div { display: grid; gap: 4px; padding: 9px; background: var(--surface-low); border-radius: 8px; text-align: center; }
.stats strong { color: var(--primary); font-size: 18px; }
.stats span { color: var(--muted); font-size: 12px; }
.assessment-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); margin-top: 8px; }
.dimensions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 16px; margin: 12px 0 0; font-size: 13px; }
.dimensions div { display: flex; justify-content: space-between; gap: 8px; }
.dimensions dd { margin: 0; color: var(--primary); font-weight: 700; }
.evidence-list, .suggestions, .course-list { list-style: none; padding: 0; margin: 8px 0 0; }
.evidence-list li, .suggestions li, .course-list li { padding: 10px 0; border-bottom: 1px solid var(--line); }
.evidence-list li:last-child, .suggestions li:last-child, .course-list li:last-child { border: 0; padding-bottom: 0; }
.evidence-list li { display: grid; gap: 4px; }
.evidence-list strong, .suggestions strong, .course-list strong { font-size: 14px; overflow-wrap: anywhere; }
.evidence-list span, .course-list small, .disclaimer { color: var(--muted); font-size: 12px; line-height: 1.5; }
.comparison { margin-top: 16px; }
.comparison h3 { font-size: 14px; }
.course-list a { display: flex; justify-content: space-between; align-items: center; gap: 8px; color: var(--primary); }
.course-list small { display: block; margin-top: 2px; overflow-wrap: anywhere; }
.history-state { color: var(--muted); font-size: 13px; padding: 12px 0 0; }
.history-state button { margin-top: 6px; }
</style>
