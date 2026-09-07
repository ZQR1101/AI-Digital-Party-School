<template>
  <div class="page-shell">
    <header class="top">
      <h1>数智党校</h1>
      <button type="button" aria-label="通知" @click="toast = '暂无新通知'"><Icon name="notifications" /></button>
    </header>

    <main class="canvas">
      <label class="search">
        <Icon name="search" />
        <input v-model.trim="keyword" placeholder="搜索课程、讲座或资料..." @input="onSearch">
      </label>

      <div class="chips hide-scroll">
        <button v-for="tab in tabs" :key="tab.value" :class="{ on: activeTab === tab.value }" type="button" @click="activeTab = tab.value">{{ tab.label }}</button>
      </div>

      <article v-if="featured" class="featured" @click="open(featured)">
        <div class="featured-cover">
          <img v-if="featured.coverUrl" :src="featured.coverUrl" :alt="featured.title" @error="hideImage">
          <span>精选</span>
        </div>
        <div class="featured-body">
          <h2>{{ featured.title }}</h2>
          <p>{{ featured.summary || '公共学习内容' }}</p>
          <div class="featured-foot">
            <span><Icon name="schedule" /> {{ featured.type === 'video' ? '视频课程' : '学习文章' }}</span>
            <b>开始学习</b>
          </div>
        </div>
      </article>

      <section>
        <h3>推荐课程</h3>
        <div v-if="loading" class="state-box"><i></i><strong>正在加载课程</strong></div>
        <div v-else-if="error" class="state-box"><strong>课程加载失败</strong><p>{{ error }}</p><button type="button" @click="load">重新加载</button></div>
        <div v-else-if="!list.length" class="state-box"><strong>暂无课程</strong><p>管理员发布公共内容后会显示在这里</p></div>
        <div v-else class="course-list">
          <article v-for="item in list" :key="item.id" @click="open(item)">
            <div :class="['thumb', item.type]">
              <img v-if="item.coverUrl" :src="item.coverUrl" :alt="item.title" @error="hideImage">
            </div>
            <div class="copy">
              <h4>{{ item.title }}</h4>
              <p>{{ item.summary || '公共学习内容' }}</p>
              <div class="meta">
                <span>{{ item.type === 'video' ? '视频' : '文章' }}</span>
                <em><Icon name="group" /> 开始学习</em>
              </div>
            </div>
          </article>
        </div>
      </section>
    </main>

    <BottomNav active="learn" />
    <div v-if="toast" class="app-toast">{{ toast }}</div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import BottomNav from './components/BottomNav.vue'
import Icon from './components/Icon.vue'
import { listPublicContents } from './api/contents'
import { getMyRecommendations } from './api/recommendations'
import { mapRecItems, readRecCache, writeRecCache } from './api/recCache'

defineOptions({ name: 'CatalogPage' })

const router = useRouter()
const loading = ref(true)
const error = ref('')
const keyword = ref('')
const activeTab = ref('all')
const contents = ref([])
const recommended = ref([])
const toast = ref('')
const tabs = [
  { label: '最新课程', value: 'all' },
  { label: '视频课', value: 'video' },
  { label: '学习文章', value: 'article' },
  { label: 'AI 推荐', value: 'ai' },
]

const filtered = computed(() => {
  const word = keyword.value.toLowerCase()
  let rows = contents.value
  if (activeTab.value === 'video' || activeTab.value === 'article') rows = rows.filter(item => item.type === activeTab.value)
  if (activeTab.value === 'ai') rows = recommended.value
  if (word) rows = rows.filter(item => `${item.title}${item.summary || ''}`.toLowerCase().includes(word))
  return rows
})
const featured = computed(() => filtered.value[0] || null)
const list = computed(() => filtered.value.slice(featured.value ? 1 : 0))

function hideImage(event) { event.target.style.display = 'none' }
function open(item) { router.push(`/learn/${item.id || item.contentId}`) }
let timer = 0
function onSearch() {
  window.clearTimeout(timer)
  timer = window.setTimeout(loadCourses, 280)
}

async function loadCourses() {
  const showSpinner = !contents.value.length
  if (showSpinner) loading.value = true
  error.value = ''
  try {
    const publicList = await listPublicContents({ keyword: keyword.value })
    contents.value = publicList?.list || []
    if (!contents.value.length && recommended.value.length) contents.value = recommended.value
  } catch (err) {
    if (!contents.value.length) error.value = err.message
  } finally {
    loading.value = false
  }
}

async function loadRecs() {
  const cached = readRecCache()
  if (cached) recommended.value = mapRecItems(cached)
  try {
    const rec = await getMyRecommendations(12)
    if (rec?.recommendations?.length) {
      writeRecCache(rec)
      recommended.value = mapRecItems(rec)
      if (!contents.value.length) contents.value = recommended.value
    }
  } catch {
    /* 推荐失败不影响课程列表 */
  }
}

function load() {
  loadCourses()
  loadRecs()
}

onMounted(load)
</script>

<style scoped>
.top {
  height: 64px; padding: 0 var(--pad); display: flex; justify-content: space-between; align-items: center;
  position: sticky; top: 0; background: var(--bg-paper); z-index: 8;
}
.top h1 { font-size: 22px; color: var(--primary); font-weight: 700; }
.top button { color: var(--primary); font-size: 24px; }
.canvas { padding: 8px var(--pad) 32px; display: grid; gap: 24px; width: 100%; max-width: 100%; min-width: 0; overflow-x: hidden; }
.search {
  display: flex; align-items: center; gap: 8px; background: var(--surface); border-radius: 999px;
  padding: 12px 16px; box-shadow: var(--whisper); border: 1px solid rgba(226, 190, 188, 0.3); color: var(--outline);
}
.search input { flex: 1; border: 0; outline: 0; background: transparent; color: var(--ink); font-size: 15px; }
.chips { display: flex; gap: 12px; overflow-x: auto; min-width: 0; max-width: 100%; }
.chips button {
  flex: none; padding: 8px 16px; border-radius: 999px; border: 1px solid var(--line); color: var(--muted);
  font-size: 13px; letter-spacing: 0.05em;
}
.chips .on { background: var(--primary-container); color: #fff; border-color: var(--primary-container); }
.featured { background: var(--surface); border-radius: var(--radius-xl); overflow: hidden; border: 1px solid rgba(226, 190, 188, 0.3); }
.featured-cover { position: relative; height: 192px; background: linear-gradient(160deg, #6d151c, #c45b4f); }
.featured-cover img { width: 100%; height: 100%; object-fit: cover; }
.featured-cover span { position: absolute; top: 16px; left: 16px; padding: 4px 8px; border-radius: 4px; background: rgba(123, 87, 0, 0.9); color: #ffd07d; font-size: 11px; letter-spacing: 0.08em; }
.featured-body { padding: 16px; }
.featured-body h2 { font-size: 20px; line-height: 1.4; }
.featured-body p { margin-top: 8px; color: var(--muted); font-size: 15px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.featured-foot { margin-top: 12px; display: flex; justify-content: space-between; color: var(--outline); font-size: 12px; }
.featured-foot span { display: flex; align-items: center; gap: 4px; }
.featured-foot b { color: var(--primary-container); font-weight: 500; }
h3 { font-size: 20px; padding-left: 10px; border-left: 4px solid var(--primary-container); margin-bottom: 16px; }
.course-list { display: grid; gap: 16px; min-width: 0; }
.course-list article {
  display: flex; gap: 12px; align-items: flex-start; width: 100%; max-width: 100%; min-width: 0;
  background: var(--surface); padding: 14px; border-radius: var(--radius-xl);
  border: 1px solid rgba(226, 190, 188, 0.3); box-sizing: border-box;
}
.thumb { width: 88px; height: 88px; border-radius: 8px; flex: none; overflow: hidden; background: linear-gradient(150deg, #7b1c24, #d7a441); }
.thumb.article { background: linear-gradient(150deg, #5d4100, #e2bebc); }
.thumb img { width: 100%; height: 100%; object-fit: cover; }
.copy { flex: 1; min-width: 0; overflow: hidden; }
.course-list h4 { font-size: 16px; line-height: 1.35; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; word-break: break-word; }
.course-list p { margin-top: 6px; color: var(--muted); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.meta { margin-top: 10px; display: flex; justify-content: space-between; align-items: center; gap: 8px; min-width: 0; }
.meta span { font-size: 11px; padding: 2px 8px; border-radius: 999px; background: var(--surface-high); color: var(--muted); flex: none; }
.meta em { font-style: normal; display: flex; align-items: center; gap: 4px; color: var(--outline); font-size: 12px; min-width: 0; overflow: hidden; }
</style>
