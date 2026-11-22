<template>
  <div class="exam-page">
    <header class="top">
      <button type="button" aria-label="返回" :disabled="submitting" @click="back"><Icon name="arrow_back" /></button>
      <h1>{{ heading }}</h1>
      <span></span>
    </header>

    <main v-if="view === 'loading'" class="question-view">
      <div class="state-box" role="status"><i></i>正在加载试卷</div>
    </main>
    <main v-else-if="view === 'unavailable'" class="question-view">
      <div class="state-box" role="alert">
        <strong>{{ message }}</strong>
        <button v-if="canRetry" type="button" @click="load">重新加载</button>
        <button v-else type="button" @click="back">返回测评列表</button>
      </div>
    </main>
    <main v-else-if="view === 'question'" class="question-view">
      <p v-if="assessment.deadline" class="deadline">截止 {{ formatAssessmentDate(assessment.deadline) }}</p>
      <div class="progress-line">
        <div><span>当前第 {{ currentIndex + 1 }} 题</span><em>共 {{ questions.length }} 题</em></div>
        <div class="bar"><i :style="{ width: ((currentIndex + 1) / questions.length * 100) + '%' }"></i></div>
      </div>
      <span class="qtype">{{ questionTypes[currentQuestion.type] || '试题' }} · {{ currentQuestion.score }} 分</span>
      <h2>{{ currentQuestion.title }}</h2>
      <div class="options">
        <label v-for="option in currentQuestion.options" :key="option.key" :class="{ selected: includesAnswer(selectedAnswers[currentQuestion.id], option.key) }">
          <input v-if="currentQuestion.type === 'multiple'" v-model="selectedAnswers[currentQuestion.id]" type="checkbox" :name="'q-' + currentQuestion.id" :value="option.key">
          <input v-else v-model="selectedAnswers[currentQuestion.id]" type="radio" :name="'q-' + currentQuestion.id" :value="option.key">
          <b v-if="currentQuestion.type !== 'judge'">{{ option.key }}</b>
          <span>{{ option.label }}</span>
        </label>
      </div>
    </main>

    <main v-else-if="view === 'sheet'" class="sheet-view">
      <section class="legend">
        <div><i class="done"></i>已答</div>
        <div><i class="now"></i>当前</div>
        <div><i></i>未答</div>
      </section>
      <section class="grid">
        <button
          v-for="(item, index) in questions"
          :key="item.id"
          :class="{ done: isAnswered(item.id), now: currentIndex === index }"
          :disabled="submitting"
          type="button"
          @click="jump(index)"
        >{{ index + 1 }}</button>
      </section>
      <p v-if="unansweredCount" class="sheet-note">还有 {{ unansweredCount }} 题未答，留空交卷会按答错计。</p>
    </main>

    <main v-else-if="view === 'result'" class="result-view">
      <section class="score-card">
        <span>{{ attempt.passed ? '已通过' : '未通过' }}</span>
        <div><strong class="stat-num">{{ attempt.earnedPoints }}</strong><em>/ {{ attempt.totalScore }} 分</em></div>
        <p>{{ assessment.title }}</p>
      </section>
      <section class="stats">
        <div><Icon name="verified" /><span>正确率</span><b>{{ results.length ? Math.round(correctCount / results.length * 100) + '%' : '—' }}</b></div>
        <div><Icon name="leaderboard" /><span>折算成绩</span><b>{{ attempt.score }}/100</b></div>
        <div><Icon name="list" /><span>答对</span><b>{{ correctCount }}/{{ results.length }}</b></div>
      </section>
      <section v-if="knowledge.length" class="knowledge">
        <h3>知识点掌握</h3>
        <div class="know-card">
          <div v-for="item in knowledge" :key="item.name">
            <div><span>{{ item.name }}</span><em>{{ item.score }}%</em></div>
            <div class="bar"><i :style="{ width: item.score + '%' }"></i></div>
          </div>
        </div>
      </section>
      <p v-if="attempt.submittedAt" class="sheet-note">交卷时间 {{ formatAssessmentDate(attempt.submittedAt) }}</p>
    </main>

    <main v-else-if="view === 'explain'" class="explain-view">
      <div :class="['banner', currentResult.correct ? 'ok' : 'bad']">
        <Icon :name="currentResult.correct ? 'check_circle' : 'cancel'" />
        <strong>{{ currentResult.correct ? '回答正确' : '回答错误' }}</strong>
        <div>
          <span>你的答案 {{ answerLabel(currentResult.userAnswer) || '未作答' }}</span>
          <b>正确答案 {{ answerLabel(currentResult.correctAnswer) }}</b>
        </div>
      </div>
      <div class="chips">
        <span>第 {{ currentIndex + 1 }} / {{ results.length }} 题</span>
        <span v-if="currentResult.category" class="gold">{{ currentResult.category }}</span>
      </div>
      <h2>{{ currentResult.title }}</h2>
      <div v-if="reviewQuestion" class="options review">
        <div
          v-for="option in reviewQuestion.options"
          :key="option.key"
          :class="{
            correct: includesAnswer(currentResult.correctAnswer, option.key),
            wrong: includesAnswer(currentResult.userAnswer, option.key) && !includesAnswer(currentResult.correctAnswer, option.key)
          }"
        >
          <b v-if="reviewQuestion.type !== 'judge'">{{ option.key }}</b>
          <span>{{ option.label }}</span>
        </div>
      </div>
      <section v-if="currentResult.explanation" class="analysis">
        <h3>试题解析</h3>
        <p>{{ currentResult.explanation }}</p>
      </section>
    </main>

    <footer v-if="view === 'question'" class="bar">
      <button class="ghost" :disabled="currentIndex === 0" type="button" @click="currentIndex--">上一题</button>
      <button class="sheet-btn" type="button" @click="view = 'sheet'">
        <Icon name="grid" /><span>答题卡</span>
      </button>
      <button class="solid" type="button" @click="nextOrReview">{{ currentIndex < questions.length - 1 ? '下一题' : '检查并交卷' }}</button>
    </footer>
    <footer v-else-if="view === 'sheet'" class="bar sheet-bar">
      <button class="ghost" type="button" :disabled="submitting" @click="jump(currentIndex)">返回作答</button>
      <button class="solid" type="button" :disabled="submitting" @click="submitExam">{{ submitting ? '交卷中…' : unansweredCount ? '留空交卷' : '立即交卷' }}</button>
    </footer>
    <footer v-else-if="view === 'result'" class="bar">
      <button class="ghost" type="button" @click="router.push('/record')">查看学习报告</button>
      <button v-if="results.length" class="solid" type="button" @click="openExplain">查看解析</button>
    </footer>
    <footer v-else-if="view === 'explain'" class="bar">
      <button class="ghost" :disabled="currentIndex === 0" type="button" @click="currentIndex--">上一题</button>
      <button class="solid" type="button" @click="currentIndex < results.length - 1 ? currentIndex++ : (view = 'result')">{{ currentIndex < results.length - 1 ? '下一题' : '返回成绩' }}</button>
    </footer>
    <div v-if="submitError" class="app-toast" role="alert">{{ submitError }}</div>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from './components/Icon.vue'
import { getAssessment, submitAssessment } from './api/assessments'
import { invalidateRecCache } from './api/recCache'
import { formatAssessmentDate } from './utils/assessmentDate'

const router = useRouter()
const route = useRoute()
const questionTypes = { single: '单选题', multiple: '多选题', judge: '判断题' }
const view = ref('loading')
const assessment = ref(null)
const attempt = ref(null)
const selectedAnswers = ref({})
const currentIndex = ref(0)
const submitting = ref(false)
const message = ref('')
const canRetry = ref(false)
const submitError = ref('')
const questions = computed(() => assessment.value?.questions ?? [])
const results = computed(() => attempt.value?.results ?? [])
const heading = computed(() => ({
  sheet: '答题卡', result: '测评成绩', explain: '解析详情',
})[view.value] || assessment.value?.title || '学习测评')
const currentQuestion = computed(() => questions.value[currentIndex.value])
const currentResult = computed(() => results.value[currentIndex.value])
const reviewQuestion = computed(() => questions.value.find(item => item.id === currentResult.value?.questionId))
const unansweredCount = computed(() => questions.value.filter(item => !isAnswered(item.id)).length)
const correctCount = computed(() => results.value.filter(item => item.correct).length)
const knowledge = computed(() => {
  const groups = new Map()
  for (const item of results.value) {
    if (!item.category) continue
    const group = groups.get(item.category) ?? { total: 0, right: 0 }
    group.total += 1
    if (item.correct) group.right += 1
    groups.set(item.category, group)
  }
  return Array.from(groups, ([name, item]) => ({ name, score: Math.round(item.right / item.total * 100) }))
})

function answerParts(answer) {
  if (Array.isArray(answer)) return answer
  return String(answer ?? '').split(',').map(value => value.trim()).filter(Boolean)
}

function includesAnswer(answer, key) { return answerParts(answer).includes(key) }
function isAnswered(id) { return answerParts(selectedAnswers.value[id]).length > 0 }

function answerLabel(answer) {
  return answerParts(answer).map(key => {
    if (reviewQuestion.value?.type !== 'judge') return key
    return reviewQuestion.value.options.find(option => option.key === key)?.label ?? key
  }).join('、')
}

function jump(index) {
  currentIndex.value = index
  submitError.value = ''
  view.value = 'question'
}

function openExplain() {
  currentIndex.value = 0
  view.value = 'explain'
}

function back() {
  submitError.value = ''
  if (view.value === 'sheet') view.value = 'question'
  else if (view.value === 'explain') view.value = 'result'
  else router.push('/exam')
}

function nextOrReview() {
  if (currentIndex.value < questions.value.length - 1) currentIndex.value++
  else view.value = 'sheet'
}

async function submitExam() {
  if (submitting.value) return
  submitting.value = true
  submitError.value = ''
  const id = assessment.value.id
  try {
    const result = await submitAssessment(id, selectedAnswers.value)
    invalidateRecCache()
    if (String(route.query.id) !== String(id)) return
    attempt.value = result
    view.value = 'result'
    window.scrollTo(0, 0)
  } catch (err) {
    if (String(route.query.id) === String(id)) submitError.value = err.message
  } finally {
    submitting.value = false
  }
}

async function load() {
  const id = route.query.id
  assessment.value = null
  attempt.value = null
  currentIndex.value = 0
  selectedAnswers.value = {}
  canRetry.value = false
  message.value = ''
  submitError.value = ''
  if (typeof id !== 'string' || !/^\d+$/.test(id)) {
    message.value = '请从测评列表选择试卷'
    view.value = 'unavailable'
    return
  }
  view.value = 'loading'
  try {
    const result = await getAssessment(id)
    if (route.query.id !== id) return
    assessment.value = result
    attempt.value = result.attempt
    if (attempt.value) view.value = 'result'
    else if (result.closed || !questions.value.length) {
      message.value = result.closed ? '该测评已截止' : '此试卷暂无题目'
      view.value = 'unavailable'
    } else {
      selectedAnswers.value = Object.fromEntries(questions.value
        .filter(item => item.type === 'multiple').map(item => [item.id, []]))
      view.value = 'question'
    }
  } catch (err) {
    if (route.query.id !== id) return
    message.value = err.message
    canRetry.value = true
    view.value = 'unavailable'
  }
}

watch(() => route.query.id, load, { immediate: true })
</script>

<style scoped>
.exam-page { min-height: 100vh; background: var(--bg-paper); color: var(--ink); padding-bottom: 96px; display: flex; flex-direction: column; }
.top {
  height: 64px; padding: 0 var(--pad); display: grid; grid-template-columns: 40px 1fr 40px; align-items: center; gap: 8px;
  position: sticky; top: 0; z-index: 10; background: var(--bg-paper); border-bottom: 1px solid var(--line);
}
.top h1 { font-size: 16px; text-align: center; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ink); }
.top button { font-size: 22px; width: 40px; height: 40px; border-radius: 50%; }
.question-view, .sheet-view, .result-view, .explain-view { padding: 24px var(--pad); max-width: 720px; margin: 0 auto; width: 100%; }
.progress-line { display: grid; gap: 8px; margin-bottom: 24px; }
.progress-line > div:first-child { display: flex; justify-content: space-between; font-size: 13px; }
.progress-line span { color: var(--primary); }
.progress-line em { font-style: normal; color: var(--muted); }
.bar { height: 4px; background: var(--surface-highest); border-radius: 99px; overflow: hidden; }
.bar i { display: block; height: 100%; background: var(--primary); }
.qtype { display: inline-block; padding: 4px 12px; background: var(--surface-high); border: 1px solid rgba(226, 190, 188, 0.5); border-radius: 4px; font-size: 12px; letter-spacing: 0.12em; color: var(--muted); }
h2 { margin: 16px 0 24px; font-size: 22px; line-height: 1.55; }
.options { display: grid; gap: 16px; }
.options label, .options.review > div {
  position: relative; display: flex; align-items: flex-start; gap: 16px; padding: 16px;
  background: var(--surface); border: 1px solid var(--line); border-radius: 8px;
}
.options input { position: absolute; opacity: 0; }
.options b {
  width: 32px; height: 32px; flex: none; display: grid; place-items: center; border: 1px solid var(--line); border-radius: 4px; color: var(--muted); font-size: 13px;
}
.options span { padding-top: 4px; font-size: 17px; line-height: 1.5; }
.options .selected { border-color: var(--primary); background: rgba(145, 0, 24, 0.05); }
.options .selected b { background: var(--primary); color: #fff; border-color: var(--primary); }
.options .selected span { color: var(--primary); font-weight: 700; }
.legend { display: flex; justify-content: space-between; background: var(--surface); padding: 16px; border-radius: 8px; box-shadow: var(--whisper); margin-bottom: 24px; border: 1px solid var(--surface-highest); }
.legend div { display: flex; align-items: center; gap: 6px; color: var(--muted); font-size: 13px; }
.legend i { width: 20px; height: 20px; border-radius: 50%; background: var(--surface-high); border: 1px solid var(--line); }
.legend .done { background: var(--primary-container); border-color: var(--primary-container); }
.legend .now { background: #fff; border: 2px solid var(--primary-container); }
.grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; background: var(--surface); padding: 16px; border-radius: 8px; box-shadow: var(--whisper); }
.grid button { width: min(48px, 100%); aspect-ratio: 1; margin: auto; border-radius: 50%; background: var(--surface-high); border: 1px solid var(--line); color: var(--muted); }
.grid .done { background: var(--primary-container); color: #fff; border-color: var(--primary-container); }
.grid .now { background: #fff; color: var(--primary-container); border: 2px solid var(--primary-container); font-weight: 700; }
.score-card {
  background: var(--surface); border-radius: var(--radius-xl); padding: 32px 16px; text-align: center; box-shadow: var(--whisper);
  border: 1px solid var(--surface-dim, #dcd9d9); position: relative; overflow: hidden;
}
.score-card span { display: inline-block; padding: 4px 12px; border-radius: 999px; background: var(--primary-soft); color: #410005; font-size: 13px; }
.score-card div { display: flex; justify-content: center; align-items: baseline; gap: 4px; margin: 12px 0; }
.score-card strong { font-size: 64px; line-height: 1; color: var(--primary-container); }
.score-card em { font-style: normal; font-size: 20px; color: var(--muted); }
.score-card p { color: var(--muted); }
.stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 24px; }
.stats div { background: var(--surface); border-radius: var(--radius-xl); padding: 16px 8px; text-align: center; box-shadow: var(--whisper); }
.stats :deep(.app-icon) { color: var(--outline); font-size: 20px; }
.stats span { display: block; color: var(--muted); font-size: 12px; margin: 4px 0; }
.stats b { font-size: 18px; }
.knowledge { margin-top: 32px; }
.knowledge h3 { font-size: 20px; margin-bottom: 16px; }
.know-card { background: var(--surface); border-radius: var(--radius-xl); padding: 16px; display: grid; gap: 16px; box-shadow: var(--whisper); }
.know-card > div > div:first-child { display: flex; justify-content: space-between; margin-bottom: 6px; }
.know-card em { font-style: normal; color: var(--primary-container); font-size: 13px; }
.banner { display: flex; align-items: center; gap: 8px; padding: 10px; border-radius: 4px; margin-bottom: 24px; }
.banner.bad { background: var(--error-container); color: var(--error); }
.banner.ok { background: #edf6ef; color: #2f6b45; }
.banner div { margin-left: auto; text-align: right; font-size: 12px; }
.banner b { display: block; color: var(--tertiary-container); }
.chips { display: flex; gap: 8px; margin-bottom: 16px; }
.chips span { padding: 4px 8px; border-radius: 4px; background: var(--primary-container); color: #ffcbc8; font-size: 12px; }
.chips .gold { background: var(--tertiary-container); color: #ffd07d; }
.options.review .correct { border: 2px solid var(--tertiary); }
.options.review .correct b { background: var(--tertiary-container); color: #ffd07d; border-color: var(--tertiary-container); }
.options.review .wrong { border-color: var(--error); background: var(--error-container); }
.options.review .wrong b { background: var(--error); color: #fff; border-color: var(--error); }
.analysis { margin-top: 24px; background: var(--surface); border-radius: var(--radius-xl); padding: 16px; border: 1px solid var(--line); box-shadow: var(--whisper); }
.analysis h3 { margin-bottom: 8px; }
.analysis p { color: var(--muted); line-height: 1.7; }
.bar.sheet-bar, footer.bar {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 20; background: rgba(252, 249, 248, 0.92);
  height: auto; border-radius: 0; overflow: visible;
  backdrop-filter: blur(10px); border-top: 1px solid var(--line); padding: 12px var(--pad) calc(12px + env(safe-area-inset-bottom));
  display: flex; justify-content: space-between; align-items: center; gap: 12px;
}
.ghost, .solid { height: 42px; padding: 0 22px; border-radius: 999px; font-size: 13px; letter-spacing: 0.05em; }
.ghost { border: 1px solid var(--outline); }
.solid { background: var(--primary); color: #fff; }
.ghost:disabled { opacity: 0.4; }
.sheet-btn { display: grid; place-items: center; gap: 2px; color: var(--muted); font-size: 11px; letter-spacing: 0.12em; }
.sheet-btn :deep(.app-icon) { font-size: 24px; }
.app-toast { bottom: 96px; white-space: normal; }
.deadline, .sheet-note { color: var(--muted); font-size: 13px; margin: 12px 0 16px; }
.options label:focus-within { outline: 2px solid var(--primary); outline-offset: 2px; }
.solid:disabled { opacity: 0.55; cursor: wait; }
</style>
