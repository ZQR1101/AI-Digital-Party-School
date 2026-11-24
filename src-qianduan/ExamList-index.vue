<template>
  <div class="page-shell">
    <main class="canvas">
      <div class="page-head">
        <h1>学习测评</h1>
        <RouterLink to="/record">学习报告</RouterLink>
      </div>
      <div v-if="loading" class="state-box" role="status"><i></i>正在加载测评</div>
      <div v-else-if="error" class="state-box" role="alert">
        <strong>测评加载失败</strong><p>{{ error }}</p><button type="button" @click="load">重新加载</button>
      </div>
      <template v-else>
        <div v-if="assessments.length" class="chips hide-scroll" aria-label="筛选测评">
          <button v-for="item in filters" :key="item.value" :class="{ on: filter === item.value }" :aria-pressed="filter === item.value" type="button" @click="filter = item.value">{{ item.label }}</button>
        </div>
        <div v-if="visible.length" class="list">
          <article v-for="item in visible" :key="item.id" :class="status(item)" :data-testid="`exam-card-${item.id}`">
            <div class="head">
              <h2>{{ item.title }}</h2>
              <span>{{ statusText[status(item)] }}</span>
            </div>
            <p><Icon name="list" /> {{ item.kind === 'exam' ? '考试' : '测验' }} · {{ item.questionCount }} 题 · 满分 {{ item.totalScore }} 分</p>
            <p v-if="item.deadline"><Icon name="event" /> 截止 {{ formatAssessmentDate(item.deadline) }}</p>
            <p v-if="item.attempt"><Icon name="check" /> 得分 {{ item.attempt.earnedPoints }}/{{ item.attempt.totalScore }} · {{ item.attempt.passed ? '通过' : '未通过' }}</p>
            <p v-if="item.attempt?.submittedAt"><Icon name="calendar" /> 交卷 {{ formatAssessmentDate(item.attempt.submittedAt) }}</p>
            <button :disabled="status(item) === 'closed'" type="button" data-testid="exam-start" @click="open(item)">{{ actionText[status(item)] }}</button>
          </article>
        </div>
        <div v-else class="state-box"><p>{{ assessments.length ? '当前筛选下暂无测评' : '暂无分配给你的测评' }}</p></div>
      </template>
    </main>
    <BottomNav active="exam" />
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import BottomNav from './components/BottomNav.vue'
import Icon from './components/Icon.vue'
import { getMyAssessments } from './api/assessments'
import { formatAssessmentDate } from './utils/assessmentDate'

const router = useRouter()
const filter = ref('all')
const assessments = ref([])
const loading = ref(true)
const error = ref('')
const filters = [
  { label: '全部测评', value: 'all' },
  { label: '待作答', value: 'ongoing' },
  { label: '已交卷', value: 'submitted' },
  { label: '已截止', value: 'closed' },
]
const statusText = { ongoing: '待作答', submitted: '已交卷', closed: '已截止' }
const actionText = { ongoing: '开始作答', submitted: '查看成绩与解析', closed: '已截止' }
const visible = computed(() => filter.value === 'all'
  ? assessments.value
  : assessments.value.filter(item => status(item) === filter.value))

function status(item) {
  if (item.attempt) return 'submitted'
  return item.closed ? 'closed' : 'ongoing'
}

function open(item) {
  router.push({ name: 'exam-take', query: { id: item.id } })
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const result = await getMyAssessments()
    assessments.value = result.list
  } catch (err) {
    error.value = err.message
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.canvas { padding: 16px var(--pad) 32px; max-width: 720px; margin: 0 auto; }
.page-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.page-head h1 { font-size: 22px; }
.page-head a { color: var(--primary); font-size: 14px; }
.chips { display: flex; gap: 12px; overflow-x: auto; margin-bottom: 24px; min-width: 0; max-width: 100%; }
.chips button {
  flex: none; padding: 8px 16px; border-radius: 999px; background: var(--surface); color: var(--muted);
  border: 1px solid var(--line); font-size: 13px; box-shadow: var(--whisper);
}
.chips .on { background: var(--primary-container); color: #ffcbc8; border-color: var(--primary-container); }
.list { display: grid; gap: 16px; }
article {
  background: var(--surface); border-radius: var(--radius-xl); padding: 16px; box-shadow: var(--whisper);
  position: relative; overflow: hidden; border: 1px solid transparent;
}
article.ongoing::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: var(--primary-container); }
article.closed { opacity: 0.82; border-color: var(--line); }
.head { display: flex; justify-content: space-between; gap: 8px; margin-bottom: 12px; padding-left: 8px; }
article:not(.ongoing) .head { padding-left: 0; }
h2 { font-size: 18px; line-height: 1.4; }
.head span { flex: none; padding: 4px 8px; border-radius: 4px; background: #ffdea8; color: #5e4200; font-size: 11px; }
article.submitted .head span, article.closed .head span { background: var(--surface-highest); color: var(--muted); }
p { display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: 15px; margin: 6px 0; padding-left: 8px; }
article:not(.ongoing) p { padding-left: 0; }
article button {
  width: 100%; height: 40px; margin-top: 16px; border-radius: 8px; background: var(--primary-container);
  color: #fff; font-size: 13px; letter-spacing: 0.05em;
}
article.submitted button, article.closed button {
  background: transparent; color: var(--primary); border: 1px solid var(--line);
}
article.closed button { color: var(--muted); }
button:disabled { cursor: not-allowed; }
</style>
