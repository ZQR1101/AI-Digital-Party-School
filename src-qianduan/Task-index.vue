<template>
  <div class="page-shell no-tab learn-page">
    <header class="top">
      <button type="button" aria-label="返回" @click="goBack"><Icon name="arrow_back" /></button>
      <span></span>
    </header>

    <main v-if="loading" class="canvas"><div class="state-box"><i></i><strong>正在打开学习任务</strong></div></main>
    <main v-else-if="error" class="canvas">
      <div class="state-box"><strong>任务加载失败</strong><p>{{ error }}</p><button type="button" @click="load">重新加载</button></div>
    </main>
    <main v-else-if="task" class="detail">
      <section class="media">
        <img v-if="task.coverUrl && task.contentType !== 'video'" :src="task.coverUrl" :alt="task.contentTitle || task.title">
        <video
          v-if="task.contentType === 'video'"
          ref="player"
          class="player"
          controls
          playsinline
          preload="metadata"
          :src="videoSrc"
          @error="onVideoError"
          @timeupdate="onTimeUpdate"
          @ended="onEnded"
        >当前浏览器不支持视频播放。</video>
        <p v-if="videoError" class="media-error">{{ videoError }}</p>
      </section>
      <section class="intro">
        <h1>{{ task.title }}</h1>
        <div class="meta">
          <span><Icon name="schedule" /> {{ task.contentType === 'video' ? '视频课程' : '学习文章' }}</span>
          <span v-if="task.deadline">截止 {{ deadlineLabel }}</span>
        </div>
        <p v-if="task.contentTitle">学习内容：{{ task.contentTitle }}</p>
        <p v-if="task.summary">{{ task.summary }}</p>
        <div class="progress">
          <div><span>学习进度</span><b>{{ displayProgress }}%</b></div>
          <div class="bar"><i :style="{ width: `${barWidth}%` }"></i></div>
          <small>{{ timeHint }}</small>
        </div>
        <p class="auto-hint">{{ completed ? (task.contentType === 'video' ? '视频已看完，学习记录已保存' : '已达到规定学习时长') : (task.contentType === 'video' ? '请完整观看视频，播放结束后自动完成。' : '请认真阅读正文，系统会按字数核算学习时长，读满后自动完成。') }}</p>
      </section>
      <section class="body-wrap">
        <h2>{{ task.contentType === 'video' ? '课程内容' : '介绍' }}</h2>
        <div v-if="task.contentType !== 'video' && isHtml" class="body" v-html="task.bodyOrVideoUrl"></div>
        <pre v-else-if="task.contentType !== 'video'" class="body plain">{{ task.bodyOrVideoUrl || '暂无正文' }}</pre>
        <p v-else class="hint">观看进度会自动记录。视频播放完成后系统会记为已学完。</p>
      </section>
    </main>
    <div v-if="toast" class="app-toast">{{ toast }}</div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from './components/Icon.vue'
import { getTaskDetail } from './api/tasks'
import { submitLearningRecord } from './api/learningRecords'
import { writeTaskProgress } from './api/taskProgressCache'

const route = useRoute()
const router = useRouter()
const loading = ref(true)
const error = ref('')
const task = ref(null)
const completed = ref(false)
const toast = ref('')
const player = ref(null)
const videoError = ref('')
const studySeconds = ref(0)
const loadedSeconds = ref(0)
const readyAt = ref(0)
const tick = ref(0)
const saving = ref(false)
const isHtml = computed(() => /<\/?[a-z][\s\S]*>/i.test(task.value?.bodyOrVideoUrl || ''))
const videoSrc = computed(() => {
  const text = String(task.value?.bodyOrVideoUrl || '').trim()
  const fromAttr = text.match(/src=["']([^"']+)["']/i)
  const raw = fromAttr?.[1] || (text.match(/https?:\/\/[^\s"'<>]+/i) || [text])[0]
  if (!raw || /googleapis\.com|gtv-videos-bucket|googleusercontent\.com/i.test(raw)) return '/uploads/demo-lecture.mp4'
  return raw
})
const deadlineLabel = computed(() => {
  const value = task.value?.deadline
  return value ? String(value).slice(0, 10) : ''
})
function formatClock(total) {
  const seconds = Math.max(0, Number(total) || 0)
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

const sessionSeconds = computed(() => {
  tick.value
  if (!readyAt.value) return 0
  return Math.max(0, Math.floor((Date.now() - readyAt.value) / 1000))
})
const wordCount = computed(() => {
  const stored = Number(task.value?.wordCount) || 0
  if (stored > 0) return stored
  const text = `${task.value?.title || ''}${task.value?.summary || ''}${String(task.value?.bodyOrVideoUrl || '').replace(/<[^>]+>/g, '')}`
  return (text.match(/[\u4e00-\u9fff]/g) || []).length
})
const requiredSeconds = computed(() => {
  if (task.value?.contentType === 'video') return 0
  return Math.max(5, Math.round((wordCount.value / 300) * 60) || 5)
})
const elapsedSeconds = computed(() => {
  if (task.value?.contentType === 'video') return Math.max(studySeconds.value, 0)
  return loadedSeconds.value + sessionSeconds.value
})
const timeHint = computed(() => {
  if (task.value?.contentType === 'video') return completed.value ? '视频已看完' : '进度随播放位置更新'
  return `已学 ${formatClock(elapsedSeconds.value)} / 应学 ${formatClock(requiredSeconds.value)}`
})
const displayProgress = computed(() => {
  if (completed.value) return 100
  const duration = Number(player.value?.duration)
  if (task.value?.contentType === 'video' && duration > 0) {
    return Math.min(99, Math.floor(((player.value.currentTime || 0) / duration) * 100))
  }
  const seconds = elapsedSeconds.value
  const need = requiredSeconds.value
  if (seconds <= 0 || need <= 0) return 0
  return Math.min(99, Math.floor((seconds / need) * 100))
})
const barWidth = computed(() => {
  if (completed.value) return 100
  if (displayProgress.value > 0) return displayProgress.value
  const need = requiredSeconds.value
  if (!need) return 0
  return Math.min(12, (elapsedSeconds.value / need) * 100)
})

let clock = 0
let saver = 0

function notify(message) {
  toast.value = message
  window.setTimeout(() => { toast.value = '' }, 1800)
}
function onVideoError() {
  videoError.value = '视频无法加载，请确认后端已启动。'
}
function onTimeUpdate() {
  const current = Math.floor(player.value?.currentTime || 0)
  if (current > studySeconds.value) studySeconds.value = current
}
async function onEnded() { await complete(true) }

function currentStudySeconds() {
  if (task.value?.contentType === 'video') return Math.max(studySeconds.value, 0)
  return loadedSeconds.value + sessionSeconds.value
}

function taskKey() {
  return task.value?.id || route.params.id
}

function syncLocalProgress() {
  if (!task.value) return
  writeTaskProgress(taskKey(), {
    progress: completed.value ? 100 : displayProgress.value,
    status: completed.value ? 'completed' : (currentStudySeconds() > 0 ? 'inProgress' : 'pending'),
    studySeconds: currentStudySeconds(),
  })
}

let persistAgain = false
let persistAgainDone = false
async function persist(done = false) {
  if (!task.value) return false
  syncLocalProgress()
  if (saving.value) {
    persistAgain = true
    persistAgainDone = persistAgainDone || done
    return false
  }
  const seconds = currentStudySeconds()
  if (!done && seconds <= 0) return false
  const reached = task.value.contentType === 'video'
    ? done || completed.value
    : completed.value || seconds >= requiredSeconds.value
  saving.value = true
  try {
    const saved = await submitLearningRecord({
      taskId: Number(taskKey()),
      studySeconds: Math.max(seconds, reached ? requiredSeconds.value : seconds),
      completed: reached,
    })
    writeTaskProgress(taskKey(), {
      progress: saved?.progress ?? (reached ? 100 : displayProgress.value),
      status: saved?.status || (reached ? 'completed' : 'inProgress'),
      studySeconds: saved?.studySeconds ?? seconds,
    })
    if (saved?.status === 'completed') completed.value = true
    return true
  } catch (err) {
    if (done) notify(err.message)
    return false
  } finally {
    saving.value = false
    if (persistAgain) {
      const againDone = persistAgainDone
      persistAgain = false
      persistAgainDone = false
      await persist(againDone)
    }
  }
}

async function goBack() {
  syncLocalProgress()
  await persist(completed.value)
  router.back()
}

async function load() {
  loading.value = true
  error.value = ''
  readyAt.value = 0
  try {
    task.value = await getTaskDetail(route.params.id)
    videoError.value = ''
    loadedSeconds.value = Number(task.value.studySeconds) || 0
    studySeconds.value = loadedSeconds.value
    const alreadyDone = task.value.myStatus === 'completed'
      || (task.value.contentType !== 'video' && loadedSeconds.value >= requiredSeconds.value)
    completed.value = alreadyDone
    readyAt.value = alreadyDone ? 0 : Date.now()
  } catch (err) {
    error.value = err.message
  } finally {
    loading.value = false
  }
}

async function complete(fromVideo = false) {
  if (!task.value || completed.value) return
  if (fromVideo) {
    const duration = Math.floor(player.value?.duration || 0)
    studySeconds.value = Math.max(studySeconds.value, duration, 1)
    completed.value = true
    notify('视频已看完，学习记录已保存')
  }
  await persist(fromVideo)
}

onMounted(async () => {
  await load()
  clock = window.setInterval(() => { tick.value += 1 }, 250)
  saver = window.setInterval(() => { persist(false) }, 3000)
})
watch([elapsedSeconds, displayProgress, completed], () => {
  syncLocalProgress()
})
watch(elapsedSeconds, (seconds) => {
  if (!task.value || task.value.contentType === 'video' || completed.value) return
  if (seconds < requiredSeconds.value) return
  completed.value = true
  notify('已达到规定学习时长')
  persist(true)
})
watch(() => route.params.id, async () => {
  window.clearInterval(clock)
  window.clearInterval(saver)
  await load()
  clock = window.setInterval(() => { tick.value += 1 }, 250)
  saver = window.setInterval(() => { persist(false) }, 3000)
})
onBeforeUnmount(() => {
  window.clearInterval(clock)
  window.clearInterval(saver)
  persist(false)
})
</script>

<style scoped>
.learn-page { background: var(--bg-paper); }
.top {
  position: sticky; top: 0; z-index: 10; height: 64px; padding: 0 var(--pad);
  display: flex; justify-content: space-between; align-items: center; background: rgba(252, 249, 248, 0.86); backdrop-filter: blur(10px);
}
.top button { width: 40px; height: 40px; border-radius: 50%; background: rgba(255, 255, 255, 0.7); display: grid; place-items: center; font-size: 22px; }
.canvas { padding: 16px var(--pad); }
.media { position: relative; aspect-ratio: 16 / 9; background: #2a2423; overflow: hidden; }
.media img, .player { width: 100%; height: 100%; object-fit: cover; display: block; }
.media-error { position: absolute; left: 12px; right: 12px; bottom: 12px; margin: 0; color: #ffcbc8; font-size: 12px; }
.intro { margin: -18px 0 0; padding: 16px var(--pad) 24px; background: var(--surface); border-radius: 16px 16px 0 0; position: relative; box-shadow: var(--whisper); }
h1 { font-size: 22px; line-height: 1.35; }
.meta { display: flex; gap: 16px; margin: 8px 0 16px; color: var(--muted); font-size: 12px; }
.meta span { display: flex; align-items: center; gap: 4px; }
.intro p { color: var(--muted); line-height: 1.6; margin-top: 6px; }
.auto-hint { margin-top: 12px !important; font-size: 12px; }
.progress { display: grid; gap: 8px; margin-top: 16px; }
.progress > div:first-child { display: flex; justify-content: space-between; font-size: 13px; color: var(--muted); }
.progress b { color: var(--primary); }
.bar { height: 6px; background: var(--surface-low); border-radius: 99px; overflow: hidden; }
.bar i { display: block; height: 100%; background: var(--primary-container); border-radius: 99px; }
.progress small { color: var(--muted); font-size: 12px; }
.body-wrap { padding: 24px var(--pad) 40px; }
.body-wrap h2 { font-size: 20px; margin-bottom: 16px; padding-bottom: 8px; border-bottom: 2px solid var(--primary-container); display: inline-block; }
.body { margin-top: 8px; line-height: 1.8; font-size: 16px; color: #3c3532; }
.body.plain { white-space: pre-wrap; font-family: inherit; }
.hint { color: var(--muted); }
.app-toast { bottom: 28px; }
</style>
