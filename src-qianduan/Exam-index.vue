<template>
  <div class="exam-page">
    <header class="top">
      <button type="button" aria-label="返回" @click="back()"><Icon name="arrow_back" /></button>
      <h1>{{ view === 'sheet' ? '答题卡' : view === 'result' ? '测评成绩' : view === 'explain' ? '解析详情' : '专题测验' }}</h1>
      <div v-if="view === 'question'" class="timer"><Icon name="timer" /> {{ timeLabel }}</div>
      <span v-else></span>
    </header>

    <main v-if="view === 'question'" class="question-view">
      <div class="progress-line">
        <div><span>当前第 {{ currentIndex + 1 }} 题</span><em>共 {{ questions.length }} 题</em></div>
        <div class="bar"><i :style="{ width: `${(currentIndex + 1) / questions.length * 100}%` }"></i></div>
      </div>
      <span class="qtype">{{ currentQuestion.type }}</span>
      <h2>{{ currentQuestion.title }}</h2>
      <div class="options">
        <label v-for="option in currentQuestion.options" :key="option.value" :class="{ selected: selectedAnswers[currentQuestion.id] === option.value }">
          <input v-model="selectedAnswers[currentQuestion.id]" type="radio" :name="`q-${currentQuestion.id}`" :value="option.value">
          <b>{{ option.value }}</b>
          <span>{{ option.text }}</span>
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
          :class="{ done: selectedAnswers[item.id], now: currentIndex === index }"
          type="button"
          @click="jump(index)"
        >{{ index + 1 }}</button>
      </section>
    </main>

    <main v-else-if="view === 'result'" class="result-view">
      <section class="score-card">
        <span>{{ passed ? '优秀' : '需加强' }}</span>
        <div><strong class="stat-num">{{ score }}</strong><em>分</em></div>
        <p>党的理论知识在线测评</p>
      </section>
      <section class="stats">
        <div><Icon name="verified" /><span>正确率</span><b>{{ Math.round(correctCount / questions.length * 100) }}%</b></div>
        <div><Icon name="timer" /><span>用时</span><b>{{ usedLabel }}</b></div>
        <div><Icon name="leaderboard" /><span>答对</span><b>{{ correctCount }}/{{ questions.length }}</b></div>
      </section>
      <section class="knowledge">
        <h3>知识点掌握</h3>
        <div class="know-card">
          <div v-for="item in knowledge" :key="item.name">
            <div><span>{{ item.name }}</span><em>{{ item.score }}%</em></div>
            <div class="bar"><i :style="{ width: `${item.score}%` }"></i></div>
          </div>
        </div>
      </section>
    </main>

    <main v-else class="explain-view">
      <div :class="['banner', isCorrect(currentQuestion) ? 'ok' : 'bad']">
        <Icon :name="isCorrect(currentQuestion) ? 'check_circle' : 'cancel'" />
        <strong>{{ isCorrect(currentQuestion) ? '回答正确' : '回答错误' }}</strong>
        <div>
          <span>您的答案: {{ selectedAnswers[currentQuestion.id] || '未作答' }}</span>
          <b>正确答案: {{ currentQuestion.answer }}</b>
        </div>
      </div>
      <div class="chips"><span>{{ currentQuestion.type }}</span><span class="gold">{{ currentQuestion.category }}</span></div>
      <h2>{{ currentQuestion.title }}</h2>
      <div class="options review">
        <div
          v-for="option in currentQuestion.options"
          :key="option.value"
          :class="{
            correct: option.value === currentQuestion.answer,
            wrong: option.value === selectedAnswers[currentQuestion.id] && option.value !== currentQuestion.answer
          }"
        >
          <b>{{ option.value }}</b>
          <span>{{ option.text }}</span>
        </div>
      </div>
      <section class="analysis">
        <h3>试题解析</h3>
        <p>{{ currentQuestion.explanation }}</p>
      </section>
    </main>

    <footer v-if="view === 'question'" class="bar">
      <button class="ghost" :disabled="currentIndex === 0" type="button" @click="currentIndex--">上一题</button>
      <button class="sheet-btn" type="button" @click="view = 'sheet'">
        <Icon name="grid" />
        <span>答题卡</span>
      </button>
      <button class="solid" type="button" @click="nextOrSubmit">{{ currentIndex < questions.length - 1 ? '下一题' : '交卷' }}</button>
    </footer>
    <footer v-else-if="view === 'sheet'" class="bar sheet-bar">
      <button class="ghost" type="button" @click="view = 'question'">返回作答</button>
      <button class="solid" type="button" @click="submitExam">立即交卷</button>
    </footer>
    <footer v-else-if="view === 'result'" class="bar">
      <button class="ghost" type="button" @click="resetExam">重新练习</button>
      <button class="solid" type="button" @click="openExplain(0)">查看全部解析</button>
    </footer>
    <footer v-else class="bar">
      <button class="ghost" :disabled="currentIndex === 0" type="button" @click="currentIndex--">上一题</button>
      <button class="solid" type="button" @click="currentIndex < questions.length - 1 ? currentIndex++ : (view = 'result')">{{ currentIndex < questions.length - 1 ? '下一题' : '返回成绩' }}</button>
    </footer>
    <div v-if="message" class="app-toast">{{ message }}</div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from './components/Icon.vue'
import { QUESTIONS } from './data/exams'

const router = useRouter()
const route = useRoute()
const questions = ref(QUESTIONS)
const selectedAnswers = ref({})
const currentIndex = ref(0)
const view = ref('question')
const submitting = ref(false)
const message = ref('')
const score = ref(0)
const remain = ref(60 * 60)
const used = ref(0)
const currentQuestion = computed(() => questions.value[currentIndex.value])
const totalScore = computed(() => questions.value.reduce((sum, item) => sum + item.score, 0))
const answeredCount = computed(() => Object.keys(selectedAnswers.value).length)
const correctCount = computed(() => questions.value.filter(isCorrect).length)
const passed = computed(() => score.value >= totalScore.value * 0.6)
const timeLabel = computed(() => formatTime(remain.value))
const usedLabel = computed(() => formatTime(used.value))
const knowledge = computed(() => {
  const groups = {}
  for (const item of questions.value) {
    if (!groups[item.category]) groups[item.category] = { total: 0, right: 0 }
    groups[item.category].total += 1
    if (isCorrect(item)) groups[item.category].right += 1
  }
  return Object.entries(groups).map(([name, item]) => ({ name, score: Math.round(item.right / item.total * 100) }))
})

let timer = 0
function formatTime(seconds) {
  const value = Math.max(0, seconds)
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`
}
function notify(text) {
  message.value = text
  window.setTimeout(() => { message.value = '' }, 1800)
}
function isCorrect(question) { return selectedAnswers.value[question.id] === question.answer }
function jump(index) { currentIndex.value = index; view.value = 'question' }
function openExplain(index) { currentIndex.value = index; view.value = 'explain' }
function back() {
  if (view.value === 'sheet') view.value = 'question'
  else if (view.value === 'explain') view.value = 'result'
  else router.push('/exam')
}
function nextOrSubmit() {
  if (currentIndex.value < questions.value.length - 1) {
    if (!selectedAnswers.value[currentQuestion.value.id]) notify('请先选择本题答案')
    else currentIndex.value++
    return
  }
  submitExam()
}
function submitExam(force = false) {
  const firstUnanswered = questions.value.findIndex(item => !selectedAnswers.value[item.id])
  if (!force && firstUnanswered !== -1) {
    currentIndex.value = firstUnanswered
    view.value = 'question'
    notify(`还有 ${questions.value.length - answeredCount.value} 题未作答`)
    return
  }
  submitting.value = true
  score.value = questions.value.reduce((sum, item) => sum + (isCorrect(item) ? item.score : 0), 0)
  used.value = 60 * 60 - remain.value
  view.value = 'result'
  submitting.value = false
  window.scrollTo({ top: 0, behavior: 'smooth' })
}
function resetExam() {
  selectedAnswers.value = {}
  currentIndex.value = 0
  score.value = 0
  remain.value = 60 * 60
  used.value = 0
  view.value = 'question'
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

onMounted(() => {
  if (route.query.review === '1') {
    selectedAnswers.value = Object.fromEntries(questions.value.map(item => [item.id, item.answer]))
    score.value = totalScore.value
    used.value = 25 * 60 + 14
    view.value = 'result'
    return
  }
  timer = window.setInterval(() => {
    if (view.value !== 'question' && view.value !== 'sheet') return
    if (remain.value <= 0) {
      window.clearInterval(timer)
      submitExam(true)
      return
    }
    remain.value -= 1
  }, 1000)
})
onBeforeUnmount(() => window.clearInterval(timer))
</script>

<style scoped>
.exam-page { min-height: 100vh; background: var(--bg-paper); color: var(--ink); padding-bottom: 96px; display: flex; flex-direction: column; }
.top {
  height: 64px; padding: 0 var(--pad); display: grid; grid-template-columns: 40px 1fr auto; align-items: center; gap: 8px;
  position: sticky; top: 0; z-index: 10; background: var(--bg-paper); border-bottom: 1px solid var(--line);
}
.top h1 { font-size: 16px; text-align: center; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ink); }
.top button { font-size: 22px; width: 40px; height: 40px; border-radius: 50%; }
.timer { display: flex; align-items: center; gap: 4px; padding: 6px 12px; border-radius: 999px; background: rgba(255, 218, 214, 0.7); color: var(--secondary); font-size: 13px; letter-spacing: 0.06em; }
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
.grid button { width: 48px; height: 48px; margin: auto; border-radius: 50%; background: var(--surface-high); border: 1px solid var(--line); color: var(--muted); }
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
  backdrop-filter: blur(10px); border-top: 1px solid var(--line); padding: 12px var(--pad) calc(12px + env(safe-area-inset-bottom));
  display: flex; justify-content: space-between; align-items: center; gap: 12px;
}
.ghost, .solid { height: 42px; padding: 0 22px; border-radius: 999px; font-size: 13px; letter-spacing: 0.05em; }
.ghost { border: 1px solid var(--outline); }
.solid { background: var(--primary); color: #fff; }
.ghost:disabled { opacity: 0.4; }
.sheet-btn { display: grid; place-items: center; gap: 2px; color: var(--muted); font-size: 11px; letter-spacing: 0.12em; }
.sheet-btn :deep(.app-icon) { font-size: 24px; }
.app-toast { bottom: 96px; }
</style>
