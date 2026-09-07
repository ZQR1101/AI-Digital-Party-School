<script setup>
import { computed, onMounted, ref } from 'vue'
import { ArrowLeft, Document, VideoPlay } from '@element-plus/icons-vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import request from '@/api/request'

const route = useRoute()
const router = useRouter()
const loading = ref(false)
const content = ref(null)

const tags = computed(() => String(content.value?.tags || '')
  .split(/[,，;；]/)
  .map(item => item.trim())
  .filter(Boolean))

const statusLabel = computed(() => ({
  published: '已发布',
  draft: '草稿',
  offlined: '已下架',
}[content.value?.status] || content.value?.status || '未知'))

async function loadDetail() {
  loading.value = true
  try {
    content.value = await request.get(`/admin/contents/${route.params.id}`)
  } catch (error) {
    ElMessage.error(error.message || '内容详情加载失败')
  } finally {
    loading.value = false
  }
}

onMounted(loadDetail)
</script>

<template>
  <section class="detail-page" v-loading="loading">
    <button class="back-button" type="button" @click="router.push('/contents')">
      <el-icon><ArrowLeft /></el-icon><span>返回学习内容</span>
    </button>

    <article v-if="content" class="detail-card">
      <div class="detail-heading">
        <div :class="['type-icon', content.type]">
          <el-icon><component :is="content.type === 'video' ? VideoPlay : Document" /></el-icon>
        </div>
        <div class="heading-copy">
          <div class="meta-row">
            <span>{{ content.type === 'video' ? '视频' : '文章' }}</span>
            <span>{{ statusLabel }}</span>
            <span>{{ Number(content.isPublic) ? '公共内容' : '组织内容' }}</span>
          </div>
          <h1>{{ content.title }}</h1>
          <div v-if="tags.length" class="tags"><span v-for="tag in tags" :key="tag">{{ tag }}</span></div>
        </div>
      </div>

      <img v-if="content.coverUrl" class="cover" :src="content.coverUrl" :alt="`${content.title}封面`" />

      <section v-if="content.summary" class="summary">
        <strong>内容摘要</strong>
        <p>{{ content.summary }}</p>
      </section>

      <section class="content-section">
        <h2>{{ content.type === 'video' ? '视频内容' : '文章正文' }}</h2>
        <video v-if="content.type === 'video'" class="video-player" controls :src="content.bodyOrVideoUrl">当前浏览器不支持视频播放。</video>
        <div v-else class="article-body">{{ content.bodyOrVideoUrl || '暂无正文内容' }}</div>
      </section>
    </article>

    <el-empty v-else-if="!loading" description="未找到该学习内容">
      <el-button type="primary" @click="router.push('/contents')">返回内容列表</el-button>
    </el-empty>
  </section>
</template>

<style scoped>
.detail-page { min-height: 520px; color: #242020; }
.back-button { display: inline-flex; align-items: center; gap: 6px; margin: 0 0 16px; padding: 0; color: #8f191f; border: 0; background: none; cursor: pointer; font-size: 13px; }
.detail-card { overflow: hidden; border: 1px solid #ead0cd; border-radius: 12px; background: #fff; box-shadow: 0 4px 18px rgba(64, 28, 25, .05); }
.detail-heading { display: flex; gap: 16px; padding: 28px 32px; border-bottom: 1px solid #f0e3e1; }
.type-icon { width: 48px; height: 48px; flex: 0 0 48px; display: grid; place-items: center; color: #91650b; border-radius: 10px; background: #fff4d9; font-size: 24px; }
.type-icon.video { color: #b21b27; background: #fae7e8; }
.heading-copy { min-width: 0; }.heading-copy h1 { margin: 8px 0 12px; font-size: 28px; line-height: 1.35; }
.meta-row,.tags { display: flex; flex-wrap: wrap; gap: 8px; }.meta-row span { color: #7d6d69; font-size: 12px; }.meta-row span + span::before { margin-right: 8px; color: #ccb9b6; content: '·'; }
.tags span { padding: 4px 9px; color: #9b1520; border: 1px solid #efc7c7; border-radius: 999px; background: #fff7f7; font-size: 11px; }
.cover { width: min(100% - 64px, 960px); aspect-ratio: 16 / 9; display: block; margin: 28px auto 0; object-fit: cover; border-radius: 10px; background: #f6f3f3; }
.summary,.content-section { margin: 28px 32px; }.summary { padding: 18px 20px; border-left: 3px solid #c62026; background: #fbf5f5; }.summary strong { font-size: 14px; }.summary p { margin: 8px 0 0; color: #625552; font-size: 14px; line-height: 1.8; }
.content-section { padding-top: 24px; border-top: 1px solid #f0e3e1; }.content-section h2 { margin: 0 0 18px; font-size: 18px; }.article-body { min-height: 180px; color: #403735; white-space: pre-wrap; font-size: 15px; line-height: 2; }.video-player { width: 100%; max-height: 640px; border-radius: 10px; background: #211b1b; }
@media (max-width: 760px) { .detail-heading { padding: 22px 18px; }.heading-copy h1 { font-size: 22px; }.cover { width: calc(100% - 36px); }.summary,.content-section { margin: 22px 18px; } }
</style>
