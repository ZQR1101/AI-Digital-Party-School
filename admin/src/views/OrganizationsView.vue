<script setup>
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  Calendar,
  DataAnalysis,
  Delete,
  EditPen,
  MoreFilled,
  OfficeBuilding,
  Plus,
  TrendCharts,
  User,
  UserFilled,
} from '@element-plus/icons-vue'
import request from '@/api/request'
import { formatBeijingDate } from '@/utils/dateTime'

const router = useRouter()
const treeRef = ref()
const activeId = ref(null)
const dialogVisible = ref(false)
const dialogMode = ref('add')
const loading = ref(false)
const treeKeyword = ref('')
const organizationTree = ref([])
const users = ref([])
const activity = ref([0, 0, 0, 0, 0, 0])
const monthLabels = ref(['1月', '2月', '3月', '4月', '5月', '6月'])
const participation = ref(0)

const typeMeta = {
  committee: '党委',
  generalBranch: '党总支',
  branch: '党支部',
  group: '党小组',
}
const nextType = {
  committee: 'generalBranch',
  generalBranch: 'branch',
  branch: 'group',
  group: 'group',
}
const roleMeta = { member: '党员', secretary: '支部书记', admin: '系统管理员' }
const avatarColors = ['#c62026', '#9d6b2f', '#50697f', '#875c77', '#2e8b57']

const orgForm = reactive({ name: '', type: 'branch', leaderUserId: '' })
const emptyOrg = { id: null, label: '未选择组织', type: '', typeLabel: '', parent: '—', leader: '未指定', members: 0, createdAtLabel: '--' }

function flatten(nodes) {
  return (nodes || []).flatMap(item => [item, ...(item.children ? flatten(item.children) : [])])
}

function collectIds(node, result = []) {
  if (!node) return result
  result.push(node.id)
  for (const child of node.children || []) collectIds(child, result)
  return result
}

const orgCount = computed(() => flatten(organizationTree.value).length)
const selectedOrg = computed(() => flatten(organizationTree.value).find(item => item.id === activeId.value) || organizationTree.value[0] || emptyOrg)
const expandedKeys = computed(() => flatten(organizationTree.value).map(item => item.id))
const assignedRate = computed(() => {
  if (!users.value.length) return 0
  return Math.round(users.value.filter(item => item.organizationId).length / users.value.length * 100)
})
const members = computed(() => {
  const ids = new Set(collectIds(selectedOrg.value.id ? selectedOrg.value : null))
  return users.value
    .filter(user => ids.has(Number(user.organizationId)))
    .map((user, index) => ({
      id: user.id,
      name: user.realName,
      initials: (user.realName || '?').slice(-1),
      role: roleMeta[user.role] || user.role,
      phone: user.phone || '—',
      color: avatarColors[index % avatarColors.length],
    }))
})

function filterNode(value, data) {
  if (!value) return true
  return `${data.name}${data.typeLabel || ''}`.includes(value)
}

watch(treeKeyword, (value) => {
  treeRef.value?.filter(value)
})

async function loadUsers() {
  const result = await request.get('/admin/users', { params: { page: 1, pageSize: 500 } })
  users.value = result.list || []
}

async function loadTree(selectId) {
  loading.value = true
  try {
    const tree = await request.get('/admin/organizations')
    organizationTree.value = Array.isArray(tree) ? tree : []
    const ids = flatten(organizationTree.value).map(item => item.id)
    activeId.value = selectId && ids.includes(selectId) ? selectId : (ids[0] || null)
    await nextTick()
    treeRef.value?.setCurrentKey(activeId.value)
    await loadOrgPulse()
  } catch (error) {
    ElMessage.error(error.message || '组织架构加载失败')
  } finally {
    loading.value = false
  }
}

async function loadOrgPulse() {
  if (!activeId.value) {
    activity.value = [0, 0, 0, 0, 0, 0]
    participation.value = 0
    return
  }
  try {
    const result = await request.get('/admin/statistics', {
      params: { organizationId: activeId.value, range: '6m' },
    })
    const trend = result.activityTrend || []
    const memberCount = Number(selectedOrg.value.members || 0)
    monthLabels.value = trend.map(item => item.label)
    activity.value = trend.map(item => (memberCount ? Math.min(100, Math.round((Number(item.value || 0) / memberCount) * 100)) : 0))
    participation.value = Number(result.overview?.completionRate || 0)
  } catch {
    activity.value = [0, 0, 0, 0, 0, 0]
    participation.value = 0
  }
}

function selectOrganization(data) {
  activeId.value = data.id
  loadOrgPulse()
}

function resetForm() {
  orgForm.name = ''
  orgForm.type = nextType[selectedOrg.value.type] || 'branch'
  orgForm.leaderUserId = ''
}

function openDialog(mode) {
  if (mode === 'add' && !selectedOrg.value.id) return ElMessage.warning('请先选择上级组织')
  dialogMode.value = mode
  if (mode === 'edit') {
    orgForm.name = selectedOrg.value.name
    orgForm.type = selectedOrg.value.type
    orgForm.leaderUserId = selectedOrg.value.leaderUserId || ''
  } else {
    resetForm()
  }
  dialogVisible.value = true
}

async function saveOrganization() {
  if (!orgForm.name.trim() || !orgForm.type) return ElMessage.warning('请填写组织名称和类型')
  try {
    if (dialogMode.value === 'edit') {
      await request.put(`/admin/organizations/${selectedOrg.value.id}`, {
        name: orgForm.name.trim(),
        type: orgForm.type,
        parentId: selectedOrg.value.parentId,
        leaderUserId: orgForm.leaderUserId || null,
      })
      ElMessage.success('组织信息已更新')
      dialogVisible.value = false
      await loadTree(selectedOrg.value.id)
    } else {
      const created = await request.post('/admin/organizations', {
        name: orgForm.name.trim(),
        type: orgForm.type,
        parentId: selectedOrg.value.id,
        leaderUserId: orgForm.leaderUserId || null,
      })
      ElMessage.success('下级组织已添加')
      dialogVisible.value = false
      await loadTree(created.id)
    }
  } catch (error) {
    ElMessage.error(error.message || '组织保存失败')
  }
}

async function removeOrganization() {
  if (!selectedOrg.value.id) return
  if (!selectedOrg.value.parentId) return ElMessage.warning('根组织不能删除')
  try {
    await ElMessageBox.confirm(`删除“${selectedOrg.value.label}”后将无法恢复，是否继续？`, '删除组织', {
      type: 'warning',
      confirmButtonText: '确认删除',
      cancelButtonText: '取消',
    })
    await request.delete(`/admin/organizations/${selectedOrg.value.id}`)
    ElMessage.success('组织已删除')
    await loadTree(selectedOrg.value.parentId)
  } catch (error) {
    if (error !== 'cancel' && error?.message) ElMessage.error(error.message)
  }
}

onMounted(async () => {
  try {
    await Promise.all([loadUsers(), loadTree()])
  } catch (error) {
    ElMessage.error(error.message || '组织数据加载失败')
  }
})
</script>

<template>
  <section class="organization-page" v-loading="loading">
    <div class="page-intro">
      <div>
        <div class="breadcrumb"><span>首页</span><b>/</b><strong>组织架构</strong></div>
        <h1>组织架构管理</h1>
        <p>维护党委、党总支、党支部与党小组的层级关系</p>
      </div>
      <el-button plain :icon="Plus" @click="openDialog('add')">新建组织</el-button>
    </div>

    <div class="organization-layout">
      <aside class="tree-card surface-card">
        <header class="card-header">
          <div>
            <h2>组织树</h2>
            <span>共 {{ orgCount }} 个组织节点</span>
          </div>
          <el-button circle text :icon="Plus" aria-label="添加组织" @click="openDialog('add')" />
        </header>
        <div class="tree-search">
          <el-input v-model="treeKeyword" placeholder="搜索组织名称" clearable />
        </div>
        <el-tree
          ref="treeRef"
          :data="organizationTree"
          node-key="id"
          :current-node-key="activeId"
          :default-expanded-keys="expandedKeys"
          :expand-on-click-node="false"
          :filter-node-method="filterNode"
          highlight-current
          @node-click="selectOrganization"
        >
          <template #default="{ data }">
            <div class="tree-node">
              <el-icon><OfficeBuilding /></el-icon>
              <span>{{ data.label }}</span>
              <small>{{ data.typeLabel }}</small>
            </div>
          </template>
        </el-tree>
        <div class="tree-summary">
          <el-icon><DataAnalysis /></el-icon>
          <div><strong>组织覆盖率 {{ assignedRate }}%</strong><span>{{ assignedRate === 100 ? '所有人员均已归属组织' : '仍有人员未分配组织' }}</span></div>
        </div>
      </aside>

      <div class="organization-detail">
        <article class="detail-card surface-card">
          <div class="detail-top">
            <div class="org-identity">
              <div class="org-icon"><el-icon><UserFilled /></el-icon></div>
              <div>
                <div class="org-title-row">
                  <h2>{{ selectedOrg.label }}</h2>
                  <span class="type-chip">{{ selectedOrg.typeLabel }}</span>
                </div>
                <p>所属组织：{{ selectedOrg.parent }}</p>
              </div>
            </div>
            <div class="detail-actions">
              <el-button :icon="EditPen" :disabled="!selectedOrg.id" @click="openDialog('edit')">编辑</el-button>
              <el-button :icon="Delete" :disabled="!selectedOrg.id" @click="removeOrganization">删除</el-button>
              <el-button type="primary" :icon="Plus" :disabled="!selectedOrg.id" @click="openDialog('add')">添加下级</el-button>
            </div>
          </div>

          <div class="org-metrics">
            <div class="metric-box">
              <el-icon><User /></el-icon>
              <span>负责人</span>
              <strong>{{ selectedOrg.leader }}</strong>
            </div>
            <div class="metric-box">
              <el-icon><UserFilled /></el-icon>
              <span>成员数量</span>
              <strong>{{ selectedOrg.members }} <small>人</small></strong>
            </div>
            <div class="metric-box">
              <el-icon><Calendar /></el-icon>
              <span>创建时间</span>
              <strong>{{ selectedOrg.createdAt ? formatBeijingDate(selectedOrg.createdAt) : '--' }}</strong>
            </div>
          </div>
        </article>

        <div class="statistics-grid">
          <article class="chart-card surface-card activity-card">
            <header>
              <div class="section-title"><el-icon><TrendCharts /></el-icon><h3>每月活跃度</h3></div>
              <span class="ai-chip">✦ 真实学习记录</span>
            </header>
            <div class="bar-chart">
              <div v-for="(value, index) in activity" :key="monthLabels[index] || index" class="bar-item">
                <div class="bar-value">{{ value }}%</div>
                <div class="bar-track"><i :style="{ height: `${value}%` }"></i></div>
                <span>{{ monthLabels[index] }}</span>
              </div>
            </div>
          </article>

          <article class="chart-card surface-card participation-card">
            <header>
              <div class="section-title gold"><el-icon><DataAnalysis /></el-icon><h3>成员参与率</h3></div>
              <span>任务完成率</span>
            </header>
            <div class="participation-body">
              <div class="participation-ring" :style="{ '--progress': `${participation * 3.6}deg` }">
                <div><strong>{{ participation }}%</strong><span>已完成</span></div>
              </div>
              <div class="legend">
                <span><i class="completed"></i>已完成任务</span>
                <span><i></i>未参与成员</span>
                <small>{{ members.length }} 名人员归属当前组织及下级</small>
              </div>
            </div>
          </article>
        </div>

        <article class="members-card surface-card">
          <header class="card-header">
            <div><h2>组织成员名单</h2><span>当前组织及下级的人员与系统角色</span></div>
            <el-button link type="primary" @click="router.push('/users')">查看全部</el-button>
          </header>
          <el-table :data="members" class="members-table">
            <el-table-column label="姓名" min-width="190">
              <template #default="{ row }">
                <div class="member-name"><el-avatar :size="34" :style="{ backgroundColor: row.color }">{{ row.initials }}</el-avatar><strong>{{ row.name }}</strong></div>
              </template>
            </el-table-column>
            <el-table-column label="系统角色" min-width="160">
              <template #default="{ row }"><span :class="['role-chip', { primary: row.role === '支部书记' }]">{{ row.role }}</span></template>
            </el-table-column>
            <el-table-column prop="phone" label="联系方式" min-width="160" />
            <el-table-column label="操作" width="90" align="right">
              <template #default>
                <el-button circle text :icon="MoreFilled" @click="router.push('/users')" />
              </template>
            </el-table-column>
          </el-table>
        </article>
      </div>
    </div>

    <el-dialog v-model="dialogVisible" :title="dialogMode === 'edit' ? '编辑组织信息' : '添加下级组织'" width="520px" destroy-on-close>
      <el-form :model="orgForm" label-position="top" class="organization-form">
        <el-form-item label="组织名称" required><el-input v-model="orgForm.name" placeholder="请输入组织全称" /></el-form-item>
        <div class="form-row">
          <el-form-item label="组织类型" required>
            <el-select v-model="orgForm.type" style="width: 100%">
              <el-option v-for="(label, value) in typeMeta" :key="value" :label="label" :value="value" />
            </el-select>
          </el-form-item>
          <el-form-item label="负责人">
            <el-select v-model="orgForm.leaderUserId" placeholder="请选择负责人" clearable style="width: 100%">
              <el-option v-for="item in users" :key="item.id" :label="item.realName" :value="item.id" />
            </el-select>
          </el-form-item>
        </div>
        <div v-if="dialogMode === 'add'" class="parent-hint">将添加至「{{ selectedOrg.label }}」下级</div>
      </el-form>
      <template #footer><el-button @click="dialogVisible = false">取消</el-button><el-button type="primary" @click="saveOrganization">确认保存</el-button></template>
    </el-dialog>
  </section>
</template>

<style scoped>
.organization-page { color: #1f2023; }
.page-intro { display: flex; align-items: flex-end; justify-content: space-between; margin-bottom: 20px; }
.page-intro h1 { margin: 7px 0 4px; font-size: 24px; line-height: 32px; letter-spacing: -.4px; }
.page-intro p { margin: 0; color: #8b7775; font-size: 13px; }
.breadcrumb { display: flex; gap: 8px; color: #877976; font-size: 12px; }
.breadcrumb b { color: #c9b8b6; }.breadcrumb strong { color: #a00014; font-weight: 600; }
.organization-layout { display: grid; grid-template-columns: minmax(260px, 300px) minmax(650px, 1fr); gap: 22px; align-items: start; }
.surface-card { overflow: hidden; border: 1px solid #ead0cd; border-radius: 10px; background: #fff; box-shadow: 0 3px 14px rgba(64, 28, 25, .045); }
.tree-card { position: sticky; top: 18px; min-height: 690px; }
.card-header { min-height: 72px; display: flex; align-items: center; justify-content: space-between; padding: 15px 20px; border-bottom: 1px solid #ead0cd; }
.card-header h2 { margin: 0; font-size: 16px; }.card-header span { display: block; margin-top: 4px; color: #8f817f; font-size: 11px; }
.tree-search { padding: 14px 15px 8px; }
.tree-card :deep(.el-tree) { padding: 8px 10px 18px; background: transparent; color: #322b2a; --el-tree-node-hover-bg-color: #f9f3f3; }
.tree-card :deep(.el-tree-node__content) { height: 40px; padding-right: 8px; border-radius: 8px; }
.tree-card :deep(.el-tree-node.is-current > .el-tree-node__content) { color: #ad0016; background: #f8e7e8; box-shadow: inset -3px 0 #b40018; }
.tree-node { min-width: 0; flex: 1; display: flex; align-items: center; gap: 7px; font-size: 13px; }
.tree-node > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.tree-node small { margin-left: auto; color: #aa9693; font-size: 10px; }
.tree-summary { margin: 10px 14px 16px; display: flex; align-items: center; gap: 10px; padding: 13px; color: #9a1420; border: 1px solid #f0d4d5; border-radius: 8px; background: linear-gradient(135deg, #fff8f8, #fbf6ed); }
.tree-summary .el-icon { font-size: 22px; }.tree-summary strong,.tree-summary span { display: block; }.tree-summary strong { font-size: 12px; }.tree-summary span { margin-top: 3px; color: #8e7f7c; font-size: 10px; }
.organization-detail { min-width: 0; display: grid; gap: 20px; }
.detail-card { padding: 24px; }.detail-top { display: flex; justify-content: space-between; gap: 18px; }.org-identity { display: flex; align-items: center; gap: 15px; min-width: 0; }
.org-icon { width: 58px; height: 58px; flex: 0 0 58px; display: grid; place-items: center; color: #b40018; border-radius: 50%; background: #f9e6e8; }.org-icon .el-icon { font-size: 29px; }
.org-title-row { display: flex; align-items: center; gap: 9px; }.org-title-row h2 { margin: 0; font-size: 20px; }.org-identity p { margin: 5px 0 0; color: #786765; font-size: 12px; }
.type-chip { padding: 3px 8px; color: #9d1620; border-radius: 5px; background: #f9dfe0; font-size: 11px; font-weight: 600; }
.detail-actions { display: flex; align-items: center; gap: 8px; }
.org-metrics { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-top: 22px; }.metric-box { position: relative; padding: 16px 17px 15px 42px; border-radius: 9px; background: #f6f4f5; }.metric-box > .el-icon { position: absolute; top: 18px; left: 17px; color: #6c4541; }.metric-box span,.metric-box strong { display: block; }.metric-box span { color: #796a68; font-size: 11px; }.metric-box strong { margin-top: 8px; font-size: 17px; }.metric-box small { color: #887b79; font-size: 11px; font-weight: 400; }
.statistics-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }.chart-card { min-height: 278px; padding: 21px; }.chart-card > header { display: flex; justify-content: space-between; align-items: center; }.chart-card header > span { color: #8a7976; font-size: 11px; }
.section-title { display: flex; align-items: center; gap: 9px; color: #a50016; }.section-title.gold { color: #745100; }.section-title h3 { margin: 0; color: #282322; font-size: 15px; }.section-title .el-icon { font-size: 19px; }
.ai-chip { padding: 5px 8px; color: #a90019 !important; border-radius: 5px; background: #f8e2e3; }.activity-card { background: linear-gradient(145deg, #fff, #fff9f8 68%, #fff9ed); }
.bar-chart { height: 185px; display: flex; align-items: flex-end; gap: 12px; padding-top: 26px; }.bar-item { height: 100%; flex: 1; display: flex; flex-direction: column; align-items: center; }.bar-value { min-height: 19px; color: #a30015; font-size: 10px; opacity: 0; transition: opacity .2s; }.bar-item:hover .bar-value { opacity: 1; }.bar-track { width: 100%; flex: 1; display: flex; align-items: flex-end; }.bar-track i { width: 100%; min-height: 3px; border-radius: 4px 4px 0 0; background: linear-gradient(180deg, #e9a9ad, #f3d2d3); transition: height .35s, background .2s; }.bar-item:hover i { background: linear-gradient(180deg, #c62026, #9d1420); }.bar-item > span { margin-top: 9px; color: #786a67; font-size: 10px; }
.participation-body { height: 200px; display: flex; align-items: center; justify-content: center; gap: 38px; }.participation-ring { position: relative; width: 138px; height: 138px; display: grid; place-items: center; border-radius: 50%; background: conic-gradient(#765100 var(--progress), #eeecec 0); }.participation-ring::before { content: ''; position: absolute; width: 103px; height: 103px; border-radius: 50%; background: #fff; }.participation-ring > div { position: relative; z-index: 1; text-align: center; }.participation-ring strong,.participation-ring span { display: block; }.participation-ring strong { font-size: 24px; }.participation-ring span { margin-top: 2px; color: #817674; font-size: 10px; }.legend { display: grid; gap: 11px; color: #716461; font-size: 11px; }.legend > span { display: flex; align-items: center; gap: 8px; }.legend i { width: 11px; height: 11px; border-radius: 2px; background: #e7e5e5; }.legend i.completed { background: #765100; }.legend small { margin-top: 7px; color: #2e8b57; }
.members-card :deep(.el-table th.el-table__cell) { color: #665653; background: #f6f4f5; }.members-card :deep(.el-table__row:hover > td.el-table__cell) { background: #fff8f8; }.member-name { display: flex; align-items: center; gap: 10px; }.member-name strong { font-size: 13px; }.role-chip { padding: 4px 10px; color: #625654; border-radius: 99px; background: #efedef; font-size: 11px; }.role-chip.primary { color: #a50016; background: #fae4e6; }
.form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }.parent-hint { padding: 11px 13px; color: #8e1a23; border: 1px solid #f0d4d5; border-radius: 8px; background: #fff7f7; font-size: 12px; }
@media (max-width: 1320px) { .organization-layout { grid-template-columns: 260px minmax(620px, 1fr); }.detail-top { flex-direction: column; }.detail-actions { justify-content: flex-end; } }
</style>
