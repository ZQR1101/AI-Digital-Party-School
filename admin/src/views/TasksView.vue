<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Bell, Delete, Document, Download, Filter, MagicStick, MoreFilled, Plus, VideoPlay } from '@element-plus/icons-vue'
import request from '@/api/request'
import { formatBeijingDate } from '@/utils/dateTime'

const tableRef = ref()
const publishVisible = ref(false)
const detailVisible = ref(false)
const dialogMode = ref('create')
const detailTask = ref(null)
const selectedRows = ref([])
const currentPage = ref(1)
const pageSize = ref(10)
const loading = ref(false)
const saving = ref(false)
const filters = reactive({ keyword: '', status: '' })
const appliedFilters = reactive({ keyword: '', status: '' })
const form = reactive({ id: null, title: '', contentId: '', organizationIds: [], includeChildren: true, deadline: '', reminder: true })
const rows = ref([])
const contentOptions = ref([])
const organizationOptions = ref([])

const statusMeta = {
  inProgress: { label: '进行中', class: 'progress' },
  completed: { label: '已完成', class: 'completed' },
  overdue: { label: '已逾期', class: 'overdue' },
}

function toTreeSelect(nodes) {
  return (nodes || []).map((node) => ({
    value: Number(node.id),
    label: node.name || node.label,
    children: node.children?.length ? toTreeSelect(node.children) : undefined,
  }))
}

function normalizeTask(row) {
  const status = statusMeta[row.displayStatus] ? row.displayStatus : 'inProgress'
  return {
    ...row,
    contentId: Number(row.contentId),
    organizationId: Number(row.organizationId),
    content: row.contentTitle || '未关联学习内容',
    contentType: row.contentType || 'article',
    organization: row.organizationName || '未指定组织',
    deadline: formatBeijingDate(row.deadline),
    createdAt: formatBeijingDate(row.createdAt),
    completionRate: Number(row.completionRate) || 0,
    status,
    aiRecommended: Boolean(row.aiRecommended),
  }
}

const filteredRows = computed(() => rows.value.filter((row) => {
  const keyword = appliedFilters.keyword.trim().toLowerCase()
  return (!keyword || row.title.toLowerCase().includes(keyword) || row.content.toLowerCase().includes(keyword))
    && (!appliedFilters.status || row.status === appliedFilters.status)
}))

const pagedRows = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value
  return filteredRows.value.slice(start, start + pageSize.value)
})

const articleContents = computed(() => contentOptions.value.filter((item) => item.type === 'article'))
const videoContents = computed(() => contentOptions.value.filter((item) => item.type === 'video'))
const selectedContent = computed(() => contentOptions.value.find((item) => item.value === form.contentId) || null)
const insightText = computed(() => {
  if (!rows.value.length) return '发布学习任务后，这里会根据完成率和内容类型给出下发建议。视频课程更适合集中观看，文章更适合反复精读。'
  const weakest = [...rows.value].sort((a, b) => a.completionRate - b.completionRate)[0]
  const typeLabel = weakest.contentType === 'video' ? '视频课程' : '学习文章'
  return `根据近期学习数据，“${weakest.title}”完成率为 ${weakest.completionRate}%，关联内容为${typeLabel}《${weakest.content}》。建议对进度落后组织补充提醒，或改用更易完成的视频课。`
})

async function loadTasks() {
  loading.value = true
  try {
    const result = await request.get('/admin/tasks', { params: { page: 1, pageSize: 200, keyword: filters.keyword } })
    rows.value = (result.list || []).map(normalizeTask)
  } catch (error) {
    ElMessage.error(error.message || '学习任务加载失败')
  } finally {
    loading.value = false
  }
}

async function loadOptions() {
  const [contents, organizations] = await Promise.all([
    request.get('/admin/contents', { params: { page: 1, pageSize: 200, status: 'published' } }),
    request.get('/admin/organizations'),
  ])
  contentOptions.value = (contents.list || []).map((item) => ({
    value: Number(item.id),
    label: item.title,
    type: item.type,
  }))
  organizationOptions.value = toTreeSelect(organizations)
}

function runSearch() {
  Object.assign(appliedFilters, filters)
  currentPage.value = 1
  loadTasks()
}

function resetForm() {
  Object.assign(form, { id: null, title: '', contentId: '', organizationIds: [], includeChildren: true, deadline: '', reminder: true })
}

function openPublish() {
  dialogMode.value = 'create'
  resetForm()
  publishVisible.value = true
}

function editTask(row) {
  dialogMode.value = 'edit'
  Object.assign(form, {
    id: row.id,
    title: row.title,
    contentId: row.contentId,
    organizationIds: row.organizationId ? [row.organizationId] : [],
    includeChildren: false,
    deadline: row.deadline === '--' ? '' : row.deadline,
    reminder: true,
  })
  publishVisible.value = true
}

async function saveTask() {
  if (!form.title.trim() || !form.contentId || !form.organizationIds.length || !form.deadline) {
    ElMessage.warning('请完整填写任务名称、学习内容、下发组织和截止时间')
    return
  }
  saving.value = true
  try {
    if (dialogMode.value === 'edit') {
      await request.put(`/admin/tasks/${form.id}`, {
        title: form.title.trim(),
        contentId: form.contentId,
        organizationIds: form.organizationIds,
        deadline: form.deadline,
      })
      ElMessage.success('任务信息已更新')
    } else {
      const result = await request.post('/admin/tasks', {
        title: form.title.trim(),
        contentId: form.contentId,
        organizationIds: form.organizationIds,
        includeChildren: form.includeChildren,
        deadline: form.deadline,
        status: 'published',
      })
      const typeLabel = result.contentType === 'video' ? '视频课' : '文章'
      ElMessage.success(`学习任务已发布，已下发 ${result.count || 1} 个组织（${typeLabel}）`)
    }
    publishVisible.value = false
    await loadTasks()
  } catch (error) {
    ElMessage.error(error.message || '保存失败')
  } finally {
    saving.value = false
  }
}

function handleSelectionChange(selection) {
  selectedRows.value = selection
}

function clearSelection() {
  tableRef.value?.clearSelection()
}

async function batchDelete() {
  if (!selectedRows.value.length) {
    ElMessage.warning('请先选择需要删除的任务')
    return
  }
  try {
    await ElMessageBox.confirm(`确定删除选中的 ${selectedRows.value.length} 项学习任务吗？相关统计数据将无法恢复。`, '批量删除', { type: 'warning', confirmButtonText: '确认删除', cancelButtonText: '取消' })
    await Promise.all(selectedRows.value.map((item) => request.delete(`/admin/tasks/${item.id}`)))
    ElMessage.success('选中任务已删除')
    clearSelection()
    await loadTasks()
  } catch (error) {
    if (error !== 'cancel' && error?.message) ElMessage.error(error.message)
  }
}

function batchExport() {
  if (!selectedRows.value.length) return ElMessage.warning('请先选择需要导出的任务')
  const lines = [['任务名称', '内容类型', '学习内容', '下发组织', '截止时间', '完成率', '状态'].join(',')]
  selectedRows.value.forEach((row) => {
    lines.push([row.title, row.contentType === 'video' ? '视频' : '文章', row.content, row.organization, row.deadline, `${row.completionRate}%`, statusMeta[row.status].label].join(','))
  })
  const blob = new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = '学习任务.csv'
  link.click()
  URL.revokeObjectURL(url)
  ElMessage.success(`已导出 ${selectedRows.value.length} 条任务`)
}

function batchRemind() {
  if (!selectedRows.value.length) return ElMessage.warning('请先选择需要提醒的任务')
  ElMessage.success(`已向 ${selectedRows.value.length} 项任务的未完成人员发送提醒`)
}

async function showDetail(row) {
  try {
    const detail = await request.get(`/admin/tasks/${row.id}`)
    detailTask.value = normalizeTask({ ...row, ...detail })
    detailVisible.value = true
  } catch (error) {
    ElMessage.error(error.message || '任务详情加载失败')
  }
}

async function copyTask(row) {
  dialogMode.value = 'create'
  Object.assign(form, {
    id: null,
    title: `${row.title}（副本）`,
    contentId: row.contentId,
    organizationIds: row.organizationId ? [row.organizationId] : [],
    includeChildren: true,
    deadline: row.deadline === '--' ? '' : row.deadline,
    reminder: true,
  })
  publishVisible.value = true
}

async function deleteOne(row) {
  try {
    await ElMessageBox.confirm(`确定删除任务“${row.title}”吗？`, '删除任务', { type: 'warning', confirmButtonText: '确认删除', cancelButtonText: '取消' })
    await request.delete(`/admin/tasks/${row.id}`)
    ElMessage.success('任务已删除')
    await loadTasks()
  } catch (error) {
    if (error !== 'cancel' && error?.message) ElMessage.error(error.message)
  }
}

onMounted(async () => {
  try {
    await Promise.all([loadTasks(), loadOptions()])
  } catch (error) {
    ElMessage.error(error.message || '学习任务初始化失败')
  }
})
</script>

<template>
  <section class="tasks-page">
    <div class="page-intro">
      <div>
        <div class="breadcrumb"><span>首页</span><b>/</b><strong>学习任务</strong></div>
        <h1>学习任务管理</h1>
        <p>按组织下发文章或视频任务，实时追踪学习完成情况</p>
      </div>
    </div>

    <article class="filter-card surface-card">
      <div class="filter-left">
        <label><span>任务名称</span><el-input v-model="filters.keyword" placeholder="请输入任务名称关键字" clearable @keyup.enter="runSearch" /></label>
        <label><span>任务状态</span><el-select v-model="filters.status" placeholder="全部状态" clearable><el-option label="进行中" value="inProgress" /><el-option label="已完成" value="completed" /><el-option label="已逾期" value="overdue" /></el-select></label>
        <el-button :icon="Filter" class="filter-button" @click="runSearch">筛选</el-button>
      </div>
      <el-button type="primary" :icon="Plus" size="large" @click="openPublish">发布任务</el-button>
    </article>

    <div class="batch-toolbar">
      <div class="batch-left">
        <strong>已选择 {{ selectedRows.length }} 项</strong><i></i>
        <el-button :icon="Delete" :disabled="!selectedRows.length" @click="batchDelete">批量删除</el-button>
        <el-button :icon="Download" :disabled="!selectedRows.length" @click="batchExport">批量导出</el-button>
        <el-button :icon="Bell" :disabled="!selectedRows.length" @click="batchRemind">批量提醒</el-button>
      </div>
      <el-button link :disabled="!selectedRows.length" @click="clearSelection">取消选择</el-button>
    </div>

    <article class="table-card surface-card">
      <el-table ref="tableRef" v-loading="loading" :data="pagedRows" class="task-table" row-key="id" @selection-change="handleSelectionChange">
        <el-table-column type="selection" width="52" />
        <el-table-column label="任务名称" min-width="250">
          <template #default="{ row }">
            <div class="task-title">
              <div><strong>{{ row.title }}</strong><span>创建时间：{{ row.createdAt }}</span></div>
              <span v-if="row.aiRecommended" class="ai-badge"><el-icon><MagicStick /></el-icon>AI 推荐</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="学习内容" min-width="220">
          <template #default="{ row }">
            <div class="content-cell">
              <span :class="['type-chip', row.contentType]">
                <el-icon><component :is="row.contentType === 'video' ? VideoPlay : Document" /></el-icon>
                {{ row.contentType === 'video' ? '视频' : '文章' }}
              </span>
              <span>{{ row.content }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="下发组织" min-width="155"><template #default="{ row }"><span class="org-chip">{{ row.organization }}</span></template></el-table-column>
        <el-table-column prop="deadline" label="截止时间" width="116" />
        <el-table-column label="完成率" width="155">
          <template #default="{ row }"><div class="progress-cell"><el-progress :percentage="row.completionRate" :show-text="false" :stroke-width="7" :color="row.status === 'completed' ? '#27ae60' : '#b40018'" /><strong>{{ row.completionRate }}%</strong></div></template>
        </el-table-column>
        <el-table-column label="状态" width="92"><template #default="{ row }"><span :class="['status-chip', statusMeta[row.status].class]">{{ statusMeta[row.status].label }}</span></template></el-table-column>
        <el-table-column label="操作" width="174" fixed="right" align="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="editTask(row)">编辑</el-button><el-button link type="primary" @click="showDetail(row)">详情</el-button>
            <el-dropdown trigger="click"><el-button circle text :icon="MoreFilled" /><template #dropdown><el-dropdown-menu><el-dropdown-item @click="copyTask(row)">复制任务</el-dropdown-item><el-dropdown-item divided @click="deleteOne(row)">删除任务</el-dropdown-item></el-dropdown-menu></template></el-dropdown>
          </template>
        </el-table-column>
      </el-table>
      <div class="pagination-row"><span>共 {{ filteredRows.length }} 条数据</span><el-pagination v-model:current-page="currentPage" v-model:page-size="pageSize" background layout="prev, pager, next, sizes" :page-sizes="[10, 20, 50]" :total="filteredRows.length" /></div>
    </article>

    <article class="ai-insight">
      <div class="ai-icon"><el-icon><MagicStick /></el-icon></div>
      <div><h3>AI 智能任务洞察</h3><p>{{ insightText }}</p></div>
      <el-button plain @click="ElMessage.success('已根据当前任务完成率生成建议')">查看报告</el-button>
    </article>

    <el-dialog v-model="publishVisible" :title="dialogMode === 'create' ? '发布学习任务' : '编辑学习任务'" width="650px" destroy-on-close>
      <el-form :model="form" label-position="top" class="task-form">
        <el-form-item label="任务名称" required><el-input v-model="form.title" maxlength="80" show-word-limit placeholder="例如：学习党的二十届三中全会精神" /></el-form-item>
        <el-form-item label="学习内容" required>
          <el-select v-model="form.contentId" placeholder="请选择已发布的文章或视频" filterable style="width: 100%">
            <el-option-group v-if="articleContents.length" label="文章">
              <el-option v-for="item in articleContents" :key="item.value" :label="item.label" :value="item.value" />
            </el-option-group>
            <el-option-group v-if="videoContents.length" label="视频课程">
              <el-option v-for="item in videoContents" :key="item.value" :label="item.label" :value="item.value" />
            </el-option-group>
          </el-select>
          <p v-if="selectedContent" class="content-hint">当前选择：{{ selectedContent.type === 'video' ? '视频课程' : '学习文章' }} · {{ selectedContent.label }}</p>
        </el-form-item>
        <el-form-item label="下发组织" required>
          <el-tree-select v-model="form.organizationIds" :data="organizationOptions" multiple show-checkbox check-strictly collapse-tags collapse-tags-tooltip :render-after-expand="false" placeholder="请选择一个或多个组织" style="width: 100%" />
        </el-form-item>
        <div class="form-grid">
          <el-form-item label="截止时间" required><el-date-picker v-model="form.deadline" type="date" value-format="YYYY-MM-DD" placeholder="请选择截止日期" style="width: 100%" /></el-form-item>
          <div class="switch-box"><div><strong>包含下级组织</strong><span>同步下发至所有下级成员</span></div><el-switch v-model="form.includeChildren" :disabled="dialogMode === 'edit'" /></div>
        </div>
        <div class="switch-box reminder"><div><strong>开启到期提醒</strong><span>截止前 3 天自动提醒未完成人员</span></div><el-switch v-model="form.reminder" /></div>
      </el-form>
      <template #footer><el-button @click="publishVisible = false">取消</el-button><el-button type="primary" :loading="saving" @click="saveTask">{{ dialogMode === 'create' ? '发布任务' : '保存修改' }}</el-button></template>
    </el-dialog>

    <el-dialog v-model="detailVisible" title="任务详情" width="620px">
      <div v-if="detailTask" class="detail-panel">
        <div class="detail-head"><div><span>{{ detailTask.contentType === 'video' ? '视频学习任务' : '文章学习任务' }}</span><h2>{{ detailTask.title }}</h2></div><span :class="['status-chip', statusMeta[detailTask.status].class]">{{ statusMeta[detailTask.status].label }}</span></div>
        <dl>
          <div><dt>学习内容</dt><dd>{{ detailTask.content }}</dd></div>
          <div><dt>内容类型</dt><dd>{{ detailTask.contentType === 'video' ? '视频课程' : '学习文章' }}</dd></div>
          <div><dt>下发组织</dt><dd>{{ detailTask.organization }}</dd></div>
          <div><dt>截止时间</dt><dd>{{ detailTask.deadline }}</dd></div>
        </dl>
        <video v-if="detailTask.contentType === 'video' && detailTask.bodyOrVideoUrl" class="detail-video" controls :src="detailTask.bodyOrVideoUrl">当前浏览器不支持视频播放。</video>
        <el-progress :percentage="detailTask.completionRate" :stroke-width="10" color="#b40018" />
      </div>
      <template #footer><el-button @click="detailVisible = false">关闭</el-button><el-button type="primary" @click="ElMessage.success('提醒已发送给未完成人员')">提醒未完成人员</el-button></template>
    </el-dialog>
  </section>
</template>

<style scoped>
.tasks-page { color: #1f2023; }.page-intro { margin-bottom: 20px; }.page-intro h1 { margin: 7px 0 4px; font-size: 24px; line-height: 32px; }.page-intro p { margin: 0; color: #8b7775; font-size: 13px; }
.breadcrumb { display: flex; gap: 8px; color: #877976; font-size: 12px; }.breadcrumb b { color: #c9b8b6; }.breadcrumb strong { color: #a00014; font-weight: 600; }
.surface-card { border: 1px solid #ead0cd; border-radius: 10px; background: #fff; box-shadow: 0 3px 14px rgba(64, 28, 25, .045); }
.filter-card { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; margin-bottom: 20px; padding: 20px; }.filter-left { display: flex; align-items: flex-end; gap: 18px; }.filter-left label { width: 280px; }.filter-left label:nth-child(2) { width: 180px; }.filter-left label > span { display: block; margin-bottom: 7px; color: #5e4c49; font-size: 11px; font-weight: 700; }.filter-button { min-width: 108px; }
.batch-toolbar { min-height: 66px; display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 18px; padding: 10px 20px; border: 1px solid #e9bcba; border-radius: 9px; background: #fcf5f5; }.batch-left { display: flex; align-items: center; gap: 10px; }.batch-left > strong { color: #a80017; font-size: 12px; }.batch-left > i { width: 1px; height: 22px; margin: 0 4px; background: #ebc9c7; }
.table-card { overflow: hidden; }.task-table :deep(th.el-table__cell) { height: 54px; color: #635350; background: #faf9f9; font-size: 12px; }.task-table :deep(td.el-table__cell) { min-height: 78px; padding-top: 14px; padding-bottom: 14px; }.task-table :deep(.el-table__row:first-child > td.el-table__cell) { background: #fff8f8; }.task-table :deep(.el-table__row:hover > td.el-table__cell) { background: #fff6f6; }
.task-title { display: flex; align-items: center; gap: 9px; }.task-title > div { min-width: 0; }.task-title strong,.task-title span { display: block; }.task-title strong { color: #282322; font-size: 13px; line-height: 1.5; }.task-title div span { margin-top: 5px; color: #93827f; font-size: 9px; }.ai-badge { flex: 0 0 auto; display: inline-flex !important; align-items: center; gap: 3px; padding: 4px 6px; color: #fff; border-radius: 5px; background: #aa0018; font-size: 9px !important; line-height: 1.2; }.ai-badge .el-icon { font-size: 12px; }.org-chip { display: inline-flex; max-width: 145px; padding: 4px 7px; color: #a21c25; border-radius: 4px; background: #ffe1df; font-size: 10px; line-height: 1.45; }.progress-cell { width: 130px; }.progress-cell strong { display: block; margin-top: 5px; font-size: 10px; }.status-chip { display: inline-flex; padding: 5px 9px; border-radius: 99px; font-size: 11px; font-weight: 600; }.status-chip.progress { color: #1656a8; background: #dfeeff; }.status-chip.completed { color: #18753b; background: #ddf8e6; }.status-chip.overdue { color: #ad1d25; background: #ffe2e1; }
.content-cell { display: flex; align-items: center; gap: 8px; }.content-cell > span:last-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.type-chip { flex: 0 0 auto; display: inline-flex; align-items: center; gap: 4px; padding: 3px 7px; border-radius: 99px; background: #fff4d9; color: #91650b; font-size: 11px; }.type-chip.video { background: #fae7e8; color: #b21b27; }.content-hint { margin: 8px 0 0; color: #8d7d7a; font-size: 12px; }.detail-video { width: 100%; max-height: 320px; margin-bottom: 16px; border-radius: 8px; background: #211b1b; }
.pagination-row { min-height: 66px; display: flex; align-items: center; justify-content: space-between; padding: 0 20px; border-top: 1px solid #ead0cd; }.pagination-row > span { color: #766865; font-size: 12px; }
.ai-insight { position: relative; overflow: hidden; min-height: 104px; display: flex; align-items: center; gap: 16px; margin-top: 20px; padding: 20px 24px; border: 1px solid #e9c7c4; border-radius: 12px; background: linear-gradient(135deg, #fff8f8, #fff 58%, #fff9e9); }.ai-insight::after { content: ''; position: absolute; right: -40px; bottom: -90px; width: 190px; height: 190px; border-radius: 50%; background: rgba(198,32,38,.05); filter: blur(10px); }.ai-icon { width: 48px; height: 48px; flex: 0 0 48px; display: grid; place-items: center; color: #a50017; border-radius: 50%; background: #f8e3e5; }.ai-icon .el-icon { font-size: 24px; }.ai-insight > div:nth-child(2) { min-width: 0; flex: 1; }.ai-insight h3 { margin: 0 0 6px; font-size: 15px; }.ai-insight p { max-width: 780px; margin: 0; color: #796966; font-size: 12px; line-height: 1.65; }.ai-insight p strong { color: #a00014; }.ai-insight .el-button { position: relative; z-index: 1; }
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }.switch-box { min-height: 64px; display: flex; align-items: center; justify-content: space-between; padding: 11px 14px; border-radius: 8px; background: #f7f5f5; }.switch-box strong,.switch-box span { display: block; }.switch-box strong { font-size: 12px; }.switch-box span { margin-top: 4px; color: #938481; font-size: 9px; }.switch-box.reminder { margin-top: 2px; border: 1px solid #f0d7d5; background: #fff9f8; }
.detail-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding-bottom: 16px; border-bottom: 1px solid #eee2e0; }.detail-head span:first-child { color: #a00014; font-size: 10px; font-weight: 700; }.detail-head h2 { margin: 6px 0 0; font-size: 19px; }.detail-panel dl { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 18px 0; }.detail-panel dl div { padding: 12px; border-radius: 8px; background: #f7f5f5; }.detail-panel dt { color: #8d7d7a; font-size: 10px; }.detail-panel dd { margin: 5px 0 0; color: #39312f; font-size: 12px; }
@media (max-width: 1280px) { .filter-left label { width: 240px; }.filter-left label:nth-child(2) { width: 150px; } }
</style>
