<template>
  <div class="page-shell">
    <header class="top">
      <h1>数智党校</h1>
      <button type="button" aria-label="通知"><Icon name="notifications" /></button>
    </header>

    <main class="canvas">
      <h2>我的任务</h2>
      <div class="seg">
        <button :class="{ on: tab === 'open' }" type="button" @click="tab = 'open'">进行中</button>
        <button :class="{ on: tab === 'done' }" type="button" @click="tab = 'done'">已完成</button>
      </div>

      <div v-if="loading" class="state-box"><i></i><strong>正在加载任务</strong></div>
      <div v-else-if="error" class="state-box"><strong>任务加载失败</strong><p>{{ error }}</p><button type="button" @click="load">重新加载</button></div>
      <div v-else-if="!visible.length" class="state-box"><p>{{ tab === 'done' ? '还没有已完成的任务' : '暂无进行中的任务' }}</p></div>
      <div v-else class="list">
        <article v-for="item in visible" :key="item.taskId" :class="{ required: item.status !== 'completed' }">
          <div class="head">
            <div>
              <span class="kind">{{ item.contentType === 'video' ? '视频课' : '必修课' }}</span>
              <h3>{{ item.title }}</h3>
            </div>
            <em v-if="item.status !== 'completed'">{{ remainLabel(item) }}</em>
            <em v-else class="done">已完成</em>
          </div>
          <p>{{ item.contentTitle || item.summary || '支部下发的学习内容，完成后会记入学时。' }}</p>
          <div class="progress">
            <div><span>学习进度</span><b>{{ progress(item) }}%</b></div>
            <div class="bar"><i :style="{ width: `${progress(item)}%` }"></i></div>
          </div>
          <div class="foot">
            <span><Icon name="schedule" /> 截止: {{ item.deadline ? String(item.deadline).slice(0, 10) : '待安排' }}</span>
            <button type="button" @click="router.push(`/task/${item.taskId}`)">{{ item.status === 'completed' ? '再看一遍' : progress(item) ? '继续学习' : '开始学习' }}</button>
          </div>
        </article>
      </div>
    </main>

    <BottomNav active="tasks" />
  </div>
</template>

<script setup>
import { computed, onActivated, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import BottomNav from './components/BottomNav.vue'
import Icon from './components/Icon.vue'
import { getMyTasks } from './api/tasks'
import { applyTaskProgress, onTaskProgress } from './api/taskProgressCache'

defineOptions({ name: 'TaskListPage' })

const router = useRouter()
const loading = ref(true)
const error = ref('')
const tab = ref('open')
const tasks = ref([])
const visible = computed(() => tasks.value.filter(item => tab.value === 'done' ? item.status === 'completed' : item.status !== 'completed'))

function progress(item) {
  if (item.status === 'completed') return 100
  return Math.min(100, Number(item.progress) || 0)
}
function remainLabel(item) {
  if (!item.deadline) return '进行中'
  const days = Math.ceil((new Date(item.deadline) - Date.now()) / 86400000)
  if (Number.isNaN(days)) return '进行中'
  if (days < 0) return '已截止'
  return `剩 ${days || 1} 天`
}

async function load(quiet = false) {
  if (!quiet) loading.value = true
  error.value = ''
  try {
    const data = await getMyTasks({ pageSize: 50 })
    tasks.value = (data?.list || []).map(applyTaskProgress)
  } catch (err) {
    error.value = err.message
  } finally {
    loading.value = false
  }
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
  load(false)
})
onActivated(() => {
  tasks.value = tasks.value.map(applyTaskProgress)
  load(true)
})
onBeforeUnmount(() => stopProgress?.())
</script>

<style scoped>
.top {
  height: 64px; padding: 0 var(--pad); display: flex; justify-content: space-between; align-items: center;
  position: sticky; top: 0; background: var(--bg-paper); z-index: 8;
}
.top h1 { font-size: 22px; color: var(--primary); font-weight: 700; }
.top button { color: var(--muted); font-size: 24px; }
.canvas { padding: 8px var(--pad) 32px; max-width: 720px; margin: 0 auto; }
h2 { font-size: 22px; margin: 8px 0 24px; }
.seg { display: flex; padding: 4px; background: var(--surface-low); border-radius: 999px; border: 1px solid rgba(226, 190, 188, 0.2); margin-bottom: 32px; }
.seg button { flex: 1; height: 36px; border-radius: 999px; color: var(--muted); font-size: 13px; letter-spacing: 0.05em; }
.seg .on { background: var(--surface); color: var(--ink); box-shadow: var(--whisper); }
.list { display: grid; gap: 24px; }
article {
  background: var(--surface); border-radius: var(--radius-xl); padding: 24px; border: 1px solid rgba(226, 190, 188, 0.2);
  position: relative; overflow: hidden;
}
article.required::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: var(--primary); }
.head { display: flex; justify-content: space-between; gap: 12px; }
.kind { display: inline-flex; color: var(--primary); font-size: 11px; letter-spacing: 0.08em; margin-bottom: 6px; }
h3 { font-size: 18px; line-height: 1.4; }
em { font-style: normal; flex: none; height: fit-content; padding: 4px 8px; border-radius: 999px; background: var(--error-container); color: #93000a; font-size: 11px; }
em.done { background: var(--surface-low); color: var(--muted); }
article > p { margin: 12px 0 16px; color: var(--muted); font-size: 15px; line-height: 1.55; }
.progress { display: grid; gap: 6px; }
.progress > div:first-child { display: flex; justify-content: space-between; font-size: 11px; color: var(--muted); }
.progress b { color: var(--primary); }
.bar { height: 4px; background: var(--surface-low); border-radius: 99px; overflow: hidden; }
.bar i { display: block; height: 100%; background: var(--primary); }
.foot { margin-top: 16px; display: flex; justify-content: space-between; align-items: center; }
.foot span { display: flex; align-items: center; gap: 4px; color: var(--muted); font-size: 12px; }
.foot button { padding: 8px 16px; border-radius: 8px; background: var(--primary-container); color: #fff; font-size: 13px; }
</style>
