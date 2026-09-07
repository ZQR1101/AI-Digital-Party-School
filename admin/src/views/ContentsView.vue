<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Document, Plus, Search, UploadFilled, VideoPlay, View } from '@element-plus/icons-vue'
import { useRouter } from 'vue-router'
import request from '@/api/request'
import { clearContentDraft, loadContentDraft, saveContentDraft } from '@/utils/contentDraft'
import { formatBeijingDateTime } from '@/utils/dateTime'

const router = useRouter()

const dialogVisible = ref(false)
const previewVisible = ref(false)
const dialogMode = ref('create')
const currentPage = ref(1)
const pageSize = ref(10)
const previewItem = ref(null)
const loading = ref(false)
const coverUploading = ref(false)
const videoUploading = ref(false)
const draftSavedAt = ref('')
const appliedFilters = reactive({ keyword: '', type: '', category: '', status: '' })
const filters = reactive({ keyword: '', type: '', category: '', status: '' })
const form = reactive({ id: null, title: '', type: 'article', category: '理论学习', tags: [], isPublic: true, summary: '', body: '', videoUrl: '', coverUrl: '', status: 'published' })

const rows = ref([])
const categoryOptions = ['理论学习', '政策解读', '业务培训', '纪律教育']

function parseTags(value) {
  if (Array.isArray(value)) return value.map(String).map(item => item.trim()).filter(Boolean)
  return String(value || '').split(/[,，;；]/).map(item => item.trim()).filter(Boolean)
}

function normalizeRow(row) {
  const allTags = parseTags(row.tags)
  const category = categoryOptions.find(item => allTags.includes(item)) || '理论学习'
  return {
    ...row,
    category,
    tags: allTags.filter(item => item !== category),
    isPublic: Boolean(Number(row.isPublic)),
    status: row.status === 'offlined' ? 'offShelf' : row.status,
    body: row.type === 'article' ? row.bodyOrVideoUrl || '' : '',
    videoUrl: row.type === 'video' ? row.bodyOrVideoUrl || '' : '',
    coverUrl: row.coverUrl || '',
    updatedAtRaw: row.updatedAt,
    updatedAt: formatBeijingDateTime(row.updatedAt),
  }
}

async function loadContents() {
  loading.value = true
  try {
    const result = await request.get('/admin/contents', { params: { page: 1, pageSize: 100 } })
    rows.value = (result.list || []).map(normalizeRow)
  } catch (error) {
    ElMessage.error(error.message || '学习内容加载失败')
  } finally {
    loading.value = false
  }
}

const filteredRows = computed(() => rows.value.filter((row) => {
  const keyword = appliedFilters.keyword.trim().toLowerCase()
  return (!keyword || row.title.toLowerCase().includes(keyword) || row.tags.some((tag) => tag.includes(keyword)))
    && (!appliedFilters.type || row.type === appliedFilters.type)
    && (!appliedFilters.category || row.category === appliedFilters.category)
    && (!appliedFilters.status || row.status === appliedFilters.status)
}))

const pagedRows = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value
  return filteredRows.value.slice(start, start + pageSize.value)
})

const latestUpdatedAt = computed(() => {
  const timestamps = rows.value
    .map(row => new Date(row.updatedAtRaw).getTime())
    .filter(Number.isFinite)
  if (!timestamps.length) return '暂无更新记录'
  return `数据更新于 ${formatBeijingDateTime(Math.max(...timestamps))}`
})

const statusMeta = {
  published: { label: '已发布', color: '#52c41a' },
  draft: { label: '草稿', color: '#e9a41a' },
  offShelf: { label: '已下架', color: '#9b9b9b' },
}

function runSearch() {
  Object.assign(appliedFilters, filters)
  currentPage.value = 1
  ElMessage.success(`已筛选出 ${filteredRows.value.length} 条内容`)
}

function resetFilters() {
  Object.assign(filters, { keyword: '', type: '', category: '', status: '' })
  Object.assign(appliedFilters, filters)
  currentPage.value = 1
}

function resetForm() {
  Object.assign(form, { id: null, title: '', type: 'article', category: '理论学习', tags: [], isPublic: true, summary: '', body: '', videoUrl: '', coverUrl: '', status: 'published' })
}

function hasDraftContent(value) {
  return Boolean(value?.title?.trim() || value?.summary?.trim() || value?.body?.trim() || value?.videoUrl?.trim() || value?.coverUrl || value?.tags?.length)
}

watch(form, (value) => {
  if (!dialogVisible.value || dialogMode.value !== 'create') return
  if (!hasDraftContent(value)) {
    clearContentDraft(localStorage)
    draftSavedAt.value = ''
    return
  }
  const snapshot = {
    title: value.title,
    type: value.type,
    category: value.category,
    tags: [...value.tags],
    isPublic: value.isPublic,
    summary: value.summary,
    body: value.body,
    videoUrl: value.videoUrl,
    coverUrl: value.coverUrl,
    status: value.status,
  }
  if (saveContentDraft(localStorage, snapshot)) {
    draftSavedAt.value = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }
}, { deep: true, flush: 'sync' })

async function handleCoverChange(uploadFile) {
  const file = uploadFile?.raw
  if (!file) return
  if (!['image/jpeg', 'image/png'].includes(file.type)) {
    ElMessage.warning('封面仅支持 JPG、PNG 格式')
    return
  }
  if (file.size > 5 * 1024 * 1024) {
    ElMessage.warning('封面图片不能超过 5MB')
    return
  }

  const data = new FormData()
  data.append('file', file)
  coverUploading.value = true
  try {
    const result = await request.post('/admin/contents/upload', data)
    form.coverUrl = result.url
    ElMessage.success('封面上传成功')
  } catch (error) {
    ElMessage.error(error.message || '封面上传失败')
  } finally {
    coverUploading.value = false
  }
}

function removeCover() {
  form.coverUrl = ''
  ElMessage.success('封面已移除')
}

async function handleVideoChange(uploadFile) {
  const file = uploadFile?.raw
  if (!file) return
  const allowed = ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime']
  if (!allowed.includes(file.type)) {
    ElMessage.warning('视频仅支持 MP4、WebM、MOV 格式')
    return
  }
  if (file.size > 50 * 1024 * 1024) {
    ElMessage.warning('视频文件不能超过 50MB')
    return
  }
  const data = new FormData()
  data.append('file', file)
  videoUploading.value = true
  try {
    const result = await request.post('/admin/contents/upload', data, { timeout: 120000 })
    form.videoUrl = result.url
    ElMessage.success('视频上传成功')
  } catch (error) {
    ElMessage.error(error.message || '视频上传失败')
  } finally {
    videoUploading.value = false
  }
}

function openCreate() {
  dialogMode.value = 'create'
  resetForm()
  const draft = loadContentDraft(localStorage)
  if (draft && hasDraftContent(draft)) {
    Object.assign(form, draft, { id: null, tags: Array.isArray(draft.tags) ? draft.tags : [] })
    draftSavedAt.value = '已恢复'
    ElMessage.info('已恢复上次未发布的内容')
  } else {
    draftSavedAt.value = ''
  }
  dialogVisible.value = true
}

function editContent(row) {
  dialogMode.value = 'edit'
  Object.assign(form, { ...row, tags: [...row.tags], body: row.body || '', videoUrl: row.videoUrl || '' })
  dialogVisible.value = true
}

function viewContent(row) {
  previewItem.value = row
  previewVisible.value = true
}

function enterDetail() {
  if (!previewItem.value?.id) return
  previewVisible.value = false
  router.push(`/contents/${previewItem.value.id}`)
}

async function saveContent() {
  if (!form.title.trim() || !form.category || !form.summary.trim()) {
    ElMessage.warning('请填写标题、分类和内容摘要')
    return
  }
  if (form.type === 'article' && !form.body.trim()) {
    ElMessage.warning('请填写文章正文')
    return
  }
  if (form.type === 'video' && !form.videoUrl.trim()) {
    ElMessage.warning('请上传视频文件或填写视频地址')
    return
  }

  const payload = {
    title: form.title.trim(),
    type: form.type,
    summary: form.summary.trim(),
    tags: [form.category, ...form.tags].filter(Boolean).join(','),
    isPublic: form.isPublic,
    status: form.status === 'offShelf' ? 'offlined' : form.status,
    bodyOrVideoUrl: form.type === 'article' ? form.body.trim() : form.videoUrl.trim(),
    coverUrl: form.coverUrl || null,
  }
  try {
    if (dialogMode.value === 'edit') {
      await request.put(`/admin/contents/${form.id}`, payload)
      ElMessage.success('学习内容已更新')
    } else {
      await request.post('/admin/contents', payload)
      ElMessage.success(form.status === 'draft' ? '草稿已保存' : '内容已发布')
    }
    dialogVisible.value = false
    if (dialogMode.value === 'create') {
      clearContentDraft(localStorage)
      draftSavedAt.value = ''
    }
    await loadContents()
  } catch (error) {
    ElMessage.error(error.message || '保存失败')
  }
}

async function changeAvailability(row) {
  if (row.status === 'published') {
    try {
      await ElMessageBox.confirm(`确定下架“${row.title}”吗？`, '下架确认', { type: 'warning', confirmButtonText: '确认下架', cancelButtonText: '取消' })
      await request.put(`/admin/contents/${row.id}`, { status: 'offlined' })
      ElMessage.success('内容已下架')
    } catch {
      // User cancelled.
    }
  } else {
    await request.put(`/admin/contents/${row.id}`, { status: 'published' })
    ElMessage.success('内容已重新发布')
  }
  await loadContents()
}

async function deleteContent(row) {
  try {
    await ElMessageBox.confirm(`删除“${row.title}”后无法恢复，是否继续？`, '删除内容', { type: 'warning', confirmButtonText: '确认删除', cancelButtonText: '取消' })
    await request.delete(`/admin/contents/${row.id}`)
    ElMessage.success('内容已删除')
    await loadContents()
  } catch {
    // User cancelled.
  }
}

onMounted(loadContents)
</script>

<template>
  <section class="contents-page">
    <div class="page-intro">
      <div>
        <div class="breadcrumb"><span>首页</span><b>/</b><strong>学习内容</strong></div>
        <h1>学习内容</h1>
        <p>统一维护文章、视频与公共学习资源</p>
      </div>
      <el-button type="primary" :icon="Plus" @click="openCreate">发布内容</el-button>
    </div>

    <article class="filter-card surface-card">
      <div class="filter-grid">
        <label>
          <span>关键词搜索</span>
          <el-input v-model="filters.keyword" :prefix-icon="Search" placeholder="请输入标题或关键词" clearable @keyup.enter="runSearch" />
        </label>
        <label>
          <span>内容类型</span>
          <el-select v-model="filters.type" placeholder="全部" clearable><el-option label="文章" value="article" /><el-option label="视频" value="video" /></el-select>
        </label>
        <label>
          <span>分类</span>
          <el-select v-model="filters.category" placeholder="全部" clearable>
            <el-option label="理论学习" value="理论学习" /><el-option label="党史教育" value="党史教育" /><el-option label="政策解读" value="政策解读" />
            <el-option label="业务培训" value="业务培训" /><el-option label="纪律教育" value="纪律教育" />
          </el-select>
        </label>
        <label>
          <span>发布状态</span>
          <el-select v-model="filters.status" placeholder="全部" clearable><el-option label="已发布" value="published" /><el-option label="草稿" value="draft" /><el-option label="已下架" value="offShelf" /></el-select>
        </label>
      </div>
      <div class="filter-actions"><el-button @click="resetFilters">重置</el-button><el-button type="primary" @click="runSearch">查询</el-button></div>
    </article>

    <article class="table-card surface-card">
      <div class="table-caption">
        <div><strong>内容资源库</strong><span>当前共 {{ filteredRows.length }} 条学习内容</span></div>
        <span class="update-hint">{{ latestUpdatedAt }}</span>
      </div>
      <el-table v-loading="loading" :data="pagedRows" class="content-table">
        <el-table-column label="标题" min-width="290">
          <template #default="{ row }">
            <button class="title-cell" @click="viewContent(row)">
              <span :class="['type-icon', row.type]"><el-icon><component :is="row.type === 'article' ? Document : VideoPlay" /></el-icon></span>
              <span><strong>{{ row.title }}</strong><small>{{ row.tags.join(' · ') || '暂无标签' }}</small></span>
            </button>
          </template>
        </el-table-column>
        <el-table-column label="类型" width="92"><template #default="{ row }"><span class="plain-type">{{ row.type === 'article' ? '文章' : '视频' }}</span></template></el-table-column>
        <el-table-column label="分类" width="116"><template #default="{ row }"><span class="category-chip">{{ row.category }}</span></template></el-table-column>
        <el-table-column label="公共内容" width="96"><template #default="{ row }"><strong :class="['public-mark', { muted: !row.isPublic }]">{{ row.isPublic ? '是' : '否' }}</strong></template></el-table-column>
        <el-table-column label="发布状态" width="108">
          <template #default="{ row }"><span class="status-label"><i :style="{ backgroundColor: statusMeta[row.status].color }"></i>{{ statusMeta[row.status].label }}</span></template>
        </el-table-column>
        <el-table-column prop="updatedAt" label="更新时间" width="170" />
        <el-table-column label="操作" width="182" align="right" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="viewContent(row)">查看</el-button>
            <el-button link type="primary" @click="editContent(row)">编辑</el-button>
            <el-button v-if="row.status !== 'draft'" link :type="row.status === 'published' ? 'danger' : 'primary'" @click="changeAvailability(row)">{{ row.status === 'published' ? '下架' : '发布' }}</el-button>
            <el-button v-else link type="danger" @click="deleteContent(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
      <div class="pagination-row">
        <span>共 {{ filteredRows.length }} 条数据</span>
        <el-pagination v-model:current-page="currentPage" v-model:page-size="pageSize" background layout="prev, pager, next, sizes" :page-sizes="[10, 20, 50]" :total="filteredRows.length" />
      </div>
    </article>

    <el-dialog v-model="dialogVisible" :title="dialogMode === 'create' ? '发布学习内容' : '编辑学习内容'" width="680px" destroy-on-close>
      <div v-if="dialogMode === 'create'" class="draft-status">
        <span>{{ draftSavedAt ? `内容已自动暂存 · ${draftSavedAt}` : '输入内容后将自动暂存，误退出也不会丢失' }}</span>
      </div>
      <el-form :model="form" label-position="top" class="content-form">
        <el-form-item label="内容标题" required><el-input v-model="form.title" maxlength="80" show-word-limit placeholder="请输入学习内容标题" /></el-form-item>
        <div class="form-grid">
          <el-form-item label="内容类型" required><el-radio-group v-model="form.type"><el-radio-button value="article">文章</el-radio-button><el-radio-button value="video">视频</el-radio-button></el-radio-group></el-form-item>
          <el-form-item label="内容分类" required>
            <el-select v-model="form.category" style="width: 100%"><el-option label="理论学习" value="理论学习" /><el-option label="党史教育" value="党史教育" /><el-option label="政策解读" value="政策解读" /><el-option label="业务培训" value="业务培训" /><el-option label="纪律教育" value="纪律教育" /></el-select>
          </el-form-item>
        </div>
        <el-form-item label="内容标签"><el-select v-model="form.tags" multiple filterable allow-create default-first-option placeholder="输入标签后回车" style="width: 100%" /></el-form-item>
        <el-form-item label="内容摘要" required><el-input v-model="form.summary" type="textarea" :rows="2" maxlength="140" show-word-limit placeholder="简要介绍学习内容" /></el-form-item>
        <el-form-item v-if="form.type === 'article'" label="文章正文" required><el-input v-model="form.body" type="textarea" :rows="6" placeholder="请输入文章正文（演示版使用纯文本编辑器）" /></el-form-item>
        <el-form-item v-else label="视频内容" required>
          <div class="video-upload-area">
            <video v-if="form.videoUrl" class="video-preview" controls :src="form.videoUrl">当前浏览器不支持视频播放。</video>
            <el-upload action="#" accept="video/mp4,video/webm,video/ogg,video/quicktime" :auto-upload="false" :show-file-list="false" :disabled="videoUploading" @change="handleVideoChange">
              <el-button :loading="videoUploading">{{ form.videoUrl ? '更换视频文件' : '上传视频文件' }}</el-button>
            </el-upload>
            <el-input v-model="form.videoUrl" placeholder="也可直接填写视频播放地址，如 https://.../lesson.mp4" />
            <small>支持 MP4 / WebM / MOV，最大 50MB；发布任务时可选中该视频下发给党员。</small>
          </div>
        </el-form-item>
        <el-form-item label="内容封面">
          <div class="cover-upload-area">
            <div v-if="form.coverUrl" class="cover-preview">
              <img :src="form.coverUrl" alt="内容封面预览" />
              <div class="cover-preview-actions">
                <el-upload action="#" accept="image/jpeg,image/png" :auto-upload="false" :show-file-list="false" :disabled="coverUploading" @change="handleCoverChange">
                  <el-button :loading="coverUploading">更换封面</el-button>
                </el-upload>
                <el-button type="danger" plain :disabled="coverUploading" @click="removeCover">移除</el-button>
              </div>
            </div>
            <el-upload v-else action="#" accept="image/jpeg,image/png" :auto-upload="false" :show-file-list="false" :disabled="coverUploading" @change="handleCoverChange">
              <div class="upload-trigger">
                <el-icon v-if="!coverUploading"><UploadFilled /></el-icon>
                <span>{{ coverUploading ? '封面上传中…' : '点击上传封面' }}</span>
                <small>建议尺寸 16:9，支持 JPG、PNG，最大 5MB</small>
              </div>
            </el-upload>
          </div>
        </el-form-item>
        <div class="form-options">
          <div><strong>设为公共内容</strong><span>所有组织均可查看和使用</span></div><el-switch v-model="form.isPublic" />
        </div>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button @click="form.status = 'draft'; saveContent()">保存草稿</el-button>
        <el-button type="primary" @click="form.status = 'published'; saveContent()">{{ dialogMode === 'create' ? '确认发布' : '保存修改' }}</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="previewVisible" title="内容预览" width="620px">
      <div v-if="previewItem" class="preview-panel">
        <div class="preview-meta"><span class="category-chip">{{ previewItem.category }}</span><span>{{ previewItem.type === 'article' ? '文章' : '视频课程' }}</span><span>{{ previewItem.updatedAt }}</span></div>
        <h2>{{ previewItem.title }}</h2><p class="preview-summary">{{ previewItem.summary }}</p>
        <div v-if="previewItem.type === 'article'" class="preview-body">{{ previewItem.body }}</div>
        <video v-else class="preview-video" controls :src="previewItem.videoUrl || previewItem.bodyOrVideoUrl">当前浏览器不支持视频播放。</video>
      </div>
      <template #footer><el-button @click="previewVisible = false">关闭</el-button><el-button type="primary" :icon="View" @click="enterDetail">进入详情</el-button></template>
    </el-dialog>
  </section>
</template>

<style scoped>
.contents-page { color: #1f2023; }
.page-intro { display: flex; align-items: flex-end; justify-content: space-between; margin-bottom: 20px; }.page-intro h1 { margin: 7px 0 4px; font-size: 24px; line-height: 32px; }.page-intro p { margin: 0; color: #8b7775; font-size: 13px; }
.breadcrumb { display: flex; gap: 8px; color: #877976; font-size: 12px; }.breadcrumb b { color: #c9b8b6; }.breadcrumb strong { color: #a00014; font-weight: 600; }
.surface-card { border: 1px solid #ead0cd; border-radius: 10px; background: #fff; box-shadow: 0 3px 14px rgba(64, 28, 25, .045); }
.filter-card { margin-bottom: 20px; padding: 20px; }.filter-grid { display: grid; grid-template-columns: 1.2fr repeat(3, 1fr); gap: 18px; }.filter-grid label > span { display: block; margin-bottom: 7px; color: #5d4c49; font-size: 12px; font-weight: 600; }.filter-grid :deep(.el-select) { width: 100%; }.filter-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 17px; padding-top: 16px; border-top: 1px solid #f0e4e2; }
.table-card { overflow: hidden; }.table-caption { min-height: 62px; display: flex; align-items: center; justify-content: space-between; padding: 13px 20px; border-bottom: 1px solid #ead0cd; }.table-caption strong,.table-caption span { display: block; }.table-caption strong { font-size: 15px; }.table-caption div span,.update-hint { margin-top: 3px; color: #93817e; font-size: 10px; }.update-hint { margin: 0; }
.content-table :deep(th.el-table__cell) { height: 46px; color: #675754; background: #faf9f9; font-size: 12px; }.content-table :deep(td.el-table__cell) { height: 62px; }.content-table :deep(.el-table__row:hover > td.el-table__cell) { background: #fff8f8; }
.title-cell { width: 100%; display: flex; align-items: center; gap: 10px; padding: 0; color: inherit; border: 0; background: none; text-align: left; cursor: pointer; }.title-cell > span:last-child { min-width: 0; }.title-cell strong,.title-cell small { display: block; }.title-cell strong { overflow: hidden; color: #292323; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }.title-cell:hover strong { color: #a00014; }.title-cell small { margin-top: 4px; color: #9a8a87; font-size: 10px; }
.type-icon { width: 30px; height: 30px; flex: 0 0 30px; display: grid; place-items: center; color: #91650b; border-radius: 7px; background: #fff4d9; }.type-icon.video { color: #b21b27; background: #fae7e8; }.plain-type { color: #615350; font-size: 12px; }.category-chip { display: inline-flex; padding: 3px 8px; color: #9b1520; border: 1px solid #efc7c7; border-radius: 5px; background: #fde4e4; font-size: 11px; }.public-mark { color: #b10019; font-size: 12px; }.public-mark.muted { color: #8a807e; font-weight: 400; }.status-label { display: inline-flex; align-items: center; gap: 6px; color: #443a38; font-size: 12px; }.status-label i { width: 7px; height: 7px; border-radius: 50%; }
.pagination-row { min-height: 66px; display: flex; align-items: center; justify-content: space-between; padding: 0 20px; border-top: 1px solid #ead0cd; }.pagination-row > span { color: #766865; font-size: 12px; }
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }.upload-trigger { width: 210px; display: grid; place-items: center; padding: 18px; color: #9d1721; border: 1px dashed #ddadaa; border-radius: 8px; background: #fff9f9; }.upload-trigger .el-icon { font-size: 25px; }.upload-trigger span,.upload-trigger small { margin-top: 6px; }.upload-trigger span { font-size: 12px; font-weight: 600; }.upload-trigger small { color: #9a8a87; font-size: 10px; }.form-options { display: flex; align-items: center; justify-content: space-between; padding: 13px 15px; border-radius: 8px; background: #f7f5f5; }.form-options strong,.form-options span { display: block; }.form-options strong { font-size: 13px; }.form-options span { margin-top: 3px; color: #938481; font-size: 10px; }
.cover-upload-area { width: 100%; }.cover-preview { width: min(100%, 420px); }.cover-preview img { width: 100%; aspect-ratio: 16 / 9; display: block; object-fit: cover; border: 1px solid #ead0cd; border-radius: 8px; background: #f7f5f5; }.cover-preview-actions { display: flex; gap: 8px; margin-top: 10px; }
.draft-status { display: flex; justify-content: flex-end; margin: -8px 0 12px; color: #8f7774; font-size: 11px; }
.preview-meta { display: flex; align-items: center; gap: 12px; color: #8e7e7b; font-size: 11px; }.preview-panel h2 { margin: 18px 0 10px; font-size: 22px; }.preview-summary { padding: 12px 14px; color: #6f5f5c; border-left: 3px solid #c62026; background: #fbf5f5; font-size: 13px; line-height: 1.7; }.preview-body { min-height: 130px; color: #453d3b; font-size: 14px; line-height: 1.9; }
.preview-video, .video-preview { width: 100%; max-height: 360px; border-radius: 9px; background: #211b1b; }
.video-upload-area { display: grid; gap: 10px; }
.video-upload-area small { color: #93817e; font-size: 12px; }
@media (max-width: 1250px) { .filter-grid { grid-template-columns: 1.35fr 1fr; } }
</style>
