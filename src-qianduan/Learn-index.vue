<template>
  <div class="page-shell no-tab learn-page">
    <header class="top">
      <button type="button" aria-label="返回" @click="router.back()"><Icon name="arrow_back" /></button>
      <span></span>
    </header>

    <main v-if="loading" class="canvas"><div class="state-box"><i></i><strong>正在打开学习内容</strong></div></main>
    <main v-else-if="error" class="canvas">
      <div class="state-box"><strong>内容加载失败</strong><p>{{ error }}</p><button type="button" @click="load">重新加载</button></div>
    </main>
    <main v-else-if="content" class="detail">
      <section class="media">
        <img v-if="content.coverUrl && content.type !== 'video'" :src="content.coverUrl" :alt="content.title">
        <video v-if="content.type === 'video'" class="player" controls playsinline preload="metadata" :src="videoSrc">当前浏览器不支持视频播放。</video>
        <button v-else-if="content.type === 'video'" class="play" type="button" aria-label="播放课程"><Icon name="play_circle" /></button>
      </section>
      <section class="intro">
        <h1>{{ content.title }}</h1>
        <div class="meta">
          <span><Icon name="schedule" /> {{ content.type === 'video' ? '视频课程' : '学习文章' }}</span>
          <span>公共内容</span>
        </div>
        <p v-if="content.summary">{{ content.summary }}</p>
        <div v-if="tags.length" class="tags"><span v-for="tag in tags" :key="tag">{{ tag }}</span></div>
        <button class="cta" :disabled="completed" type="button" @click="complete">{{ completed ? '已完成本次学习' : '继续学习' }}</button>
      </section>
      <section class="body-wrap">
        <h2>介绍</h2>
        <div v-if="content.type !== 'video' && isHtml" class="body" v-html="content.bodyOrVideoUrl"></div>
        <pre v-else-if="content.type !== 'video'" class="body plain">{{ content.bodyOrVideoUrl || '暂无正文' }}</pre>
        <p v-else class="hint">观看视频后可标记完成，学习记录会同步到个人档案。</p>
      </section>
    </main>
    <div v-if="toast" class="app-toast">{{ toast }}</div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from './components/Icon.vue'
import { getPublicContent } from './api/contents'
import { sendRecommendationFeedback } from './api/recommendations'

const route = useRoute()
const router = useRouter()
const loading = ref(true)
const error = ref('')
const content = ref(null)
const completed = ref(false)
const toast = ref('')
const tags = computed(() => String(content.value?.tags || '').split(/[,，;；]/).map(item => item.trim()).filter(Boolean))
const isHtml = computed(() => /<\/?[a-z][\s\S]*>/i.test(content.value?.bodyOrVideoUrl || ''))
const videoSrc = computed(() => {
  const text = String(content.value?.bodyOrVideoUrl || '').trim()
  const fromAttr = text.match(/src=["']([^"']+)["']/i)
  const raw = fromAttr?.[1] || (text.match(/https?:\/\/[^\s"'<>]+/i) || [text])[0]
  if (!raw || /googleapis\.com|gtv-videos-bucket|googleusercontent\.com/i.test(raw)) return '/uploads/demo-lecture.mp4'
  return raw
})

function notify(message) {
  toast.value = message
  window.setTimeout(() => { toast.value = '' }, 1800)
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    content.value = await getPublicContent(route.params.id)
    try { await sendRecommendationFeedback(content.value.id, 'view') } catch { /* 反馈表缺失时仍允许阅读内容 */ }
  } catch (err) {
    error.value = err.message
  } finally {
    loading.value = false
  }
}

async function complete() {
  try {
    await sendRecommendationFeedback(content.value.id, 'complete')
    completed.value = true
    notify('已记录学习完成')
  } catch (err) {
    notify(err.message)
  }
}

onMounted(load)
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
.media img, .player { width: 100%; height: 100%; object-fit: cover; }
.play { position: absolute; inset: 0; margin: auto; width: 64px; height: 64px; border-radius: 50%; background: rgba(180, 35, 44, 0.9); color: #ffcbc8; font-size: 32px; display: grid; place-items: center; }
.intro { margin: -18px 0 0; padding: 16px var(--pad) 24px; background: var(--surface); border-radius: 16px 16px 0 0; position: relative; box-shadow: var(--whisper); }
h1 { font-size: 22px; line-height: 1.35; }
.meta { display: flex; gap: 16px; margin: 8px 0 16px; color: var(--muted); font-size: 12px; }
.meta span { display: flex; align-items: center; gap: 4px; }
.intro > p { color: var(--muted); line-height: 1.6; }
.tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
.tags span { font-size: 11px; padding: 4px 8px; background: rgba(145, 0, 24, 0.06); color: var(--primary); border-radius: 4px; }
.cta { width: 100%; height: 46px; margin-top: 18px; border-radius: 8px; background: var(--primary-container); color: #fff; font-weight: 600; }
.cta:disabled { opacity: 0.55; }
.body-wrap { padding: 24px var(--pad) 40px; }
.body-wrap h2 { font-size: 20px; margin-bottom: 16px; padding-bottom: 8px; border-bottom: 2px solid var(--primary-container); display: inline-block; }
.body { margin-top: 8px; line-height: 1.8; font-size: 16px; color: #3c3532; }
.body.plain { white-space: pre-wrap; font-family: inherit; }
.hint { color: var(--muted); }
.app-toast { bottom: 28px; }
</style>
