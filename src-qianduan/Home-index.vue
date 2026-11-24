<template>
  <div class="page-shell">
    <section class="greet">
      <div>
        <h2 data-testid="member-home-welcome">{{ greeting }}，{{ userName }}</h2>
        <p>今天也要保持学习</p>
      </div>
      <div class="greet-side">
        <button class="icon-btn" type="button" aria-label="通知" @click="notify('暂无新通知')">
          <Icon name="notifications" />
          <i></i>
        </button>
        <div class="avatar">{{ userName.slice(0, 1) }}</div>
      </div>
    </section>

    <main class="canvas">
      <button class="ai-entry" type="button" @click="router.push('/ai-assistant')">
        <span class="ai-entry-icon"><Icon name="smart_toy" /></span>
        <span class="ai-entry-text">
          <strong>有疑问？问问 AI 助教</strong>
          <em>知识问答 · 学习诊断 · 附资料来源</em>
        </span>
        <Icon name="arrow_forward" />
      </button>

      <section class="hero-card">
        <div class="hero-head">
          <div>
            <span class="chip">今日学习</span>
            <h3>{{ todayItem.title }}</h3>
          </div>
          <Icon name="menu_book" />
        </div>
        <div class="hero-progress">
          <div class="progress-meta">
            <span>学习进度 {{ todayProgress }}%</span>
            <span>{{ todayHint }}</span>
          </div>
          <div class="bar"><i :style="{ width: `${todayProgress}%` }"></i></div>
          <button class="primary" type="button" @click="openToday">继续学习 <Icon name="arrow_forward" /></button>
        </div>
      </section>

      <section class="stats">
        <div>
          <strong class="stat-num">{{ streak }}<span>天</span></strong>
          <em>连续学习</em>
        </div>
        <div>
          <strong class="stat-num">{{ weekHours }}<span>h</span></strong>
          <em>本周学习</em>
        </div>
        <div>
          <strong class="stat-num gold">{{ pendingCount }}<span>项</span></strong>
          <em>待完成</em>
        </div>
      </section>

      <section>
        <div class="section-head">
          <h3>为你推荐</h3>
          <button type="button" @click="router.push('/learn')">查看全部</button>
        </div>
        <div v-if="loading" class="state-box"><i></i><strong>AI 正在分析学习情况</strong><p>正在匹配最适合你的公共学习内容</p></div>
        <div v-else-if="error" class="state-box"><strong>推荐加载失败</strong><p>{{ error }}</p><button type="button" @click="load">重新加载</button></div>
        <div v-else-if="!visibleItems.length" class="state-box"><strong>暂无推荐内容</strong><p>管理员发布公共学习内容后会显示在这里</p></div>
        <div v-else class="recommend-wrap">
          <HScroll @dragging="onRecommendDrag">
            <article v-for="item in visibleItems" :key="item.contentId" @click="start(item)">
              <div :class="['cover', item.contentType]">
                <img v-if="item.coverUrl" :src="item.coverUrl" :alt="item.title" @error="hideImage">
                <span class="kind">{{ item.contentType === 'video' ? '视频' : '专题' }}</span>
              </div>
              <div class="card-foot">
                <div class="card-content">
                  <h4><button class="card-title" type="button" @click.stop="start(item)">{{ item.title }}</button></h4>
                  <p v-if="item.reason" class="rec-reason">{{ item.reason }}</p>
                  <p v-if="item.matchedKnowledgePoints?.length" class="rec-knowledge">{{ item.matchedKnowledgePoints.join('、') }}</p>
                </div>
                <button class="dismiss-rec" type="button" aria-label="不感兴趣" @click.stop="dismiss(item)"><Icon name="bookmark" /></button>
              </div>
            </article>
          </HScroll>
        </div>
      </section>

      <section>
        <div class="section-head">
          <h3>近期任务</h3>
          <button type="button" @click="router.push('/tasks')">查看全部</button>
        </div>
        <div v-if="taskError" class="state-box"><strong>任务加载失败</strong><p>{{ taskError }}</p><button type="button" @click="load">重新加载</button></div>
        <div v-else-if="tasks.length" class="task-list">
          <article v-for="item in tasks.slice(0, 3)" :key="item.taskId" @click="openTask(item)">
            <div>
              <div class="task-title">
                <span :class="['status', item.status]">{{ taskStatusLabel(item.status) }}</span>
                <h4>{{ item.title }}</h4>
              </div>
              <p><Icon name="schedule" /> {{ item.deadline ? `截至: ${String(item.deadline).slice(0, 10)}` : '支部学习任务' }}</p>
            </div>
            <div class="ring">
              <svg viewBox="0 0 36 36">
                <circle cx="18" cy="18" r="16" fill="none" stroke="#e5e2e1" stroke-width="2"></circle>
                <circle cx="18" cy="18" r="16" fill="none" :stroke="item.status === 'completed' ? '#7b5700' : '#b4232c'" stroke-width="2" stroke-linecap="round" :stroke-dasharray="`${taskProgress(item)}, 100`" transform="rotate(-90 18 18)"></circle>
              </svg>
              <b>{{ taskProgress(item) }}%</b>
            </div>
          </article>
        </div>
        <div v-else-if="!loading" class="state-box"><p>暂无下发任务。请在管理后台「学习任务」中发布，并选择李四所在支部或其上级组织。</p></div>
      </section>
    </main>

    <BottomNav active="home" />
    <div v-if="toast" class="app-toast">{{ toast }}</div>
  </div>
</template>

<script setup>
import { computed, onActivated, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import BottomNav from './components/BottomNav.vue'
import Icon from './components/Icon.vue'
import HScroll from './components/HScroll.vue'
import { getMyRecommendations, sendRecommendationFeedback } from './api/recommendations'
import { getMyTasks } from './api/tasks'
import { getHomeSummary } from './api/report'
import { getRecCacheVersion, readRecCache, writeRecCache } from './api/recCache'
import { applyTaskProgress, onTaskProgress } from './api/taskProgressCache'

defineOptions({ name: 'HomePage' })

const router = useRouter()
const loading = ref(true)
const error = ref('')
const taskError = ref('')
const data = ref(null)
const tasks = ref([])
const pool = ref([])
const dismissed = ref(new Set())
const toast = ref('')
const recommendDragging = ref(false)
const storedUser = JSON.parse(localStorage.getItem('mobileUser') || '{}')
const userName = storedUser.realName || storedUser.username || '学员'
const hour = new Date().getHours()
const greeting = hour < 12 ? '上午好' : hour < 18 ? '下午好' : '晚上好'
const streak = ref(0)
const weekHours = ref('0.0')
const pendingCount = computed(() => tasks.value.filter(item => item.status !== 'completed').length)
const visibleItems = computed(() => pool.value.filter(item => !dismissed.value.has(item.contentId)).slice(0, 6))
let recommendationVersion = getRecCacheVersion()
const todayItem = computed(() => {
  const task = tasks.value.find(item => item.status !== 'completed') || tasks.value[0]
  if (task) return { title: task.title, kind: 'task', id: task.taskId, status: task.status }
  const rec = visibleItems.value[0]
  if (rec) return { title: rec.title, kind: 'content', id: rec.contentId, status: 'assigned' }
  return { title: '深入学习贯彻党的二十大精神', kind: 'none' }
})
const todayProgress = computed(() => {
  if (todayItem.value.kind !== 'task') return Number(visibleItems.value[0]?.progress) || 0
  return taskProgress(tasks.value.find(item => item.taskId === todayItem.value.id))
})
const todayHint = computed(() => todayProgress.value >= 100 ? '已完成本次学习' : '继续完成今日安排')

function notify(message) {
  toast.value = message
  window.setTimeout(() => { toast.value = '' }, 1800)
}
function hideImage(event) { event.target.style.display = 'none' }
function taskStatusLabel(status) {
  if (status === 'completed') return '已完成'
  if (status === 'inProgress') return '进行中'
  return '进行中'
}
function taskProgress(item) {
  if (!item) return 0
  if (item.status === 'completed') return 100
  return Math.min(100, Number(item.progress) || 0)
}

async function loadRecommendations(showSpinner) {
  const version = getRecCacheVersion()
  recommendationVersion = version
  if (showSpinner) {
    loading.value = true
    error.value = ''
  }
  try {
    const recommendation = await getMyRecommendations(12)
    if (version !== getRecCacheVersion()) return
    data.value = recommendation
    pool.value = recommendation?.recommendations || []
    writeRecCache(recommendation)
    dismissed.value = new Set()
  } catch (err) {
    if (version === getRecCacheVersion() && !pool.value.length) error.value = err.message
  } finally {
    if (version === getRecCacheVersion()) loading.value = false
  }
}

async function loadTasks() {
  taskError.value = ''
  try {
    const assigned = await getMyTasks({ pageSize: 50 })
    tasks.value = (assigned?.list || []).map(applyTaskProgress)
  } catch (err) {
    taskError.value = err.message
    tasks.value = []
  }
}

async function loadSummary() {
  try {
    const summary = await getHomeSummary()
    streak.value = summary.streak || 0
    weekHours.value = Number(summary.weekHours || 0).toFixed(1)
  } catch (err) {
    // 统计失败不阻断首页主流程，保持 0 而不是伪造数据
    streak.value = 0
    weekHours.value = '0.0'
  }
}

async function load() {
  const cached = readRecCache()
  if (cached) {
    data.value = cached
    pool.value = cached.recommendations || []
    loading.value = false
    await Promise.all([loadRecommendations(false), loadTasks(), loadSummary()])
    return
  }
  await Promise.all([loadRecommendations(true), loadTasks(), loadSummary()])
}

function patchTask(detail) {
  if (!detail?.taskId) return
  tasks.value = tasks.value.map((item) => (
    String(item.taskId) === String(detail.taskId)
      ? applyTaskProgress({ ...item, progress: detail.progress, status: detail.status })
      : item
  ))
}

let stopProgress = null
onMounted(() => {
  stopProgress = onTaskProgress(patchTask)
  load()
})
onActivated(() => {
  tasks.value = tasks.value.map(applyTaskProgress)
  if (recommendationVersion !== getRecCacheVersion()) {
    pool.value = []
    loadRecommendations(true)
  }
  if (loading.value) return
  loadTasks()
  loadSummary()
})
onBeforeUnmount(() => stopProgress?.())

function openTask(item) { router.push(`/task/${item.taskId}`) }
function openToday() {
  if (todayItem.value.kind === 'task') router.push(`/task/${todayItem.value.id}`)
  else if (todayItem.value.kind === 'content') router.push(`/learn/${todayItem.value.id}`)
  else router.push('/learn')
}

async function dismiss(item) {
  dismissed.value = new Set([...dismissed.value, item.contentId])
  try {
    await sendRecommendationFeedback(item.contentId, 'dismiss')
    notify('已减少此类内容推荐')
  } catch (err) {
    dismissed.value = new Set([...dismissed.value].filter(id => id !== item.contentId))
    notify(err.message)
  }
}

async function start(item) {
  if (recommendDragging.value) return
  try { await sendRecommendationFeedback(item.contentId, 'start') } catch { /* 反馈失败不影响进入学习页 */ }
  await router.push(`/learn/${item.contentId}`)
}

function onRecommendDrag(active) {
  recommendDragging.value = active
}
</script>

<style scoped>
.greet {
  padding: 32px var(--pad) 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  min-width: 0;
}
.greet h2 { font-size: 30px; line-height: 38px; letter-spacing: -0.02em; font-weight: 700; }
.greet p { margin-top: 4px; color: var(--muted); font-size: 15px; }
.greet-side { display: flex; align-items: center; gap: 16px; flex: none; }
.icon-btn { position: relative; color: var(--muted); font-size: 24px; }
.icon-btn i { position: absolute; top: 0; right: 1px; width: 8px; height: 8px; border-radius: 50%; background: var(--primary); }
.avatar {
  width: 48px; height: 48px; border-radius: 50%; display: grid; place-items: center;
  background: var(--primary-container); color: #fff; font-weight: 700; border: 2px solid #fff;
  box-shadow: var(--whisper);
}
.canvas {
  width: 100%;
  max-width: 100%;
  min-width: 0;
  margin: 0;
  padding: 0 var(--pad) 32px;
  display: grid;
  gap: 32px;
}
.canvas > * { min-width: 0; max-width: 100%; }
.ai-entry {
  display: flex; align-items: center; gap: 14px; width: 100%; padding: 14px 18px;
  background: linear-gradient(120deg, var(--primary), #a3122a); color: #fff;
  border-radius: var(--radius-xl); text-align: left; box-shadow: var(--whisper);
}
.ai-entry-icon { width: 42px; height: 42px; flex: none; border-radius: 13px; display: grid; place-items: center; background: rgba(255,255,255,.18); font-size: 24px; }
.ai-entry-text { flex: 1; display: grid; gap: 3px; }
.ai-entry-text strong { font-size: 16px; }
.ai-entry-text em { font-size: 12px; opacity: .85; font-style: normal; }
.hero-card {
  background: var(--surface); border-radius: var(--radius-xl); padding: 24px;
  box-shadow: var(--whisper); border: 1px solid rgba(226, 190, 188, 0.2); position: relative; overflow: hidden;
}
.hero-card::after {
  content: ""; position: absolute; right: -48px; top: -48px; width: 160px; height: 160px;
  background: #ffb3af; opacity: 0.18; border-radius: 50%; filter: blur(18px);
}
.hero-head, .hero-progress { position: relative; z-index: 1; }
.hero-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; color: var(--primary); font-size: 28px; }
.hero-head h3 { margin-top: 8px; font-size: 20px; line-height: 28px; color: var(--ink); max-width: 100%; }
.chip { display: inline-block; padding: 4px 8px; border-radius: 4px; background: rgba(255, 179, 175, 0.28); color: var(--primary); font-size: 11px; letter-spacing: 0.08em; }
.progress-meta { display: flex; justify-content: space-between; color: var(--muted); font-size: 13px; margin-bottom: 8px; }
.bar { height: 6px; background: var(--surface-highest); border-radius: 99px; overflow: hidden; margin-bottom: 16px; }
.bar i { display: block; height: 100%; background: var(--primary-container); border-radius: 99px; }
.primary {
  width: 100%; height: 48px; border-radius: var(--radius-xl); background: var(--primary); color: #fff;
  font-weight: 600; display: flex; justify-content: center; align-items: center; gap: 8px;
  box-shadow: 0 8px 20px rgba(180, 35, 44, 0.2);
}
.stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.stats div {
  background: var(--surface); padding: 16px; border-radius: var(--radius-xl); box-shadow: var(--whisper);
  border: 1px solid rgba(226, 190, 188, 0.3);
}
.stats strong { display: block; font-size: 30px; line-height: 1.1; color: var(--primary); margin-bottom: 6px; }
.stats strong span { margin-left: 4px; font-size: 13px; font-weight: 400; color: var(--muted); }
.stats .gold { color: var(--tertiary); }
.stats em { font-style: normal; font-size: 11px; letter-spacing: 0.08em; color: var(--muted); }
.section-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.section-head h3 { font-size: 20px; }
.section-head button { color: var(--primary); font-size: 13px; letter-spacing: 0.05em; }
.recommend-wrap { width: 100%; min-width: 0; }
.recommend-wrap :deep(article) {
  background: var(--surface); border-radius: var(--radius-xl);
  overflow: hidden; box-shadow: var(--whisper); border: 1px solid rgba(226, 190, 188, 0.3);
}
.cover { position: relative; height: 128px; overflow: hidden; background: linear-gradient(150deg, #7b1c24, #c75b52); }
.cover.article { background: linear-gradient(150deg, #5d4100, #c9a46a); }
.cover img {
  width: 100%; height: 100%; object-fit: cover;
  animation: cover-shift 9s ease-in-out infinite alternate;
}
@keyframes cover-shift {
  from { transform: scale(1) translate3d(0, 0, 0); }
  to { transform: scale(1.08) translate3d(-2%, 1%, 0); }
}
.kind { position: absolute; top: 8px; left: 8px; padding: 3px 8px; border-radius: 4px; background: rgba(145, 0, 24, 0.9); color: #fff; font-size: 11px; }
.cover.article .kind { background: rgba(93, 65, 0, 0.9); }
.card-foot { padding: 10px; display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
.card-content { flex: 1; min-width: 0; }
.card-foot h4 { font-size: 15px; line-height: 1.45; }
.card-title { text-align: left; color: inherit; font-weight: inherit; }
.card-foot .dismiss-rec { flex: none; color: var(--muted); font-size: 20px; }
.rec-reason, .rec-knowledge { font-size: 12px; margin-top: 4px; line-height: 1.5; overflow-wrap: anywhere; }
.rec-reason { color: var(--muted); }
.rec-knowledge { color: var(--primary); }
.task-list { display: grid; gap: 8px; }
.task-list article {
  background: var(--surface); padding: 16px; border-radius: var(--radius-xl); box-shadow: var(--whisper);
  border: 1px solid rgba(226, 190, 188, 0.2); display: flex; align-items: center; gap: 16px;
}
.task-title { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.task-title h4 { font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.status { padding: 2px 8px; border-radius: 4px; background: rgba(255, 107, 105, 0.12); color: var(--secondary); font-size: 10px; letter-spacing: 0.06em; flex: none; }
.status.completed { background: rgba(123, 87, 0, 0.1); color: var(--tertiary); }
.task-list p { display: flex; align-items: center; gap: 4px; color: var(--muted); font-size: 12px; }
.task-list p :deep(.app-icon) { font-size: 14px; }
.ring { position: relative; width: 40px; height: 40px; flex: none; }
.ring svg { width: 100%; height: 100%; }
.ring b { position: absolute; inset: 0; display: grid; place-items: center; font-size: 10px; }
</style>
