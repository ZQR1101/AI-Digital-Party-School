<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Download, Plus, Search, Upload, UserFilled } from '@element-plus/icons-vue'
import request from '@/api/request'
import { formatBeijingDateTime } from '@/utils/dateTime'

const roleMeta = {
  member: '党员',
  secretary: '支部书记',
  admin: '系统管理员',
}

const dialogVisible = ref(false)
const previewVisible = ref(false)
const dialogMode = ref('create')
const loading = ref(false)
const importing = ref(false)
const importInput = ref(null)
const previewUser = ref(null)
const page = ref(1)
const pageSize = ref(10)
const total = ref(0)
const rows = ref([])
const organizations = ref([])
const stats = reactive({ total: 0, secretary: 0, active: 0, incomplete: 0 })
const filters = reactive({ keyword: '', organizationId: '', role: '' })
const form = reactive({
  id: null,
  realName: '',
  username: '',
  password: '',
  organizationId: '',
  role: 'member',
  phone: '',
  email: '',
})

const currentUserId = computed(() => {
  try {
    return JSON.parse(localStorage.getItem('adminUser') || '{}').id || null
  } catch {
    return null
  }
})

function flattenOrganizations(nodes, level = 0, result = []) {
  for (const node of nodes || []) {
    result.push({
      id: node.id,
      name: `${'　'.repeat(level)}${node.name}`,
      rawName: node.name,
    })
    if (node.children?.length) flattenOrganizations(node.children, level + 1, result)
  }
  return result
}

function normalizeUser(row) {
  const status = Number(row.status)
  return {
    ...row,
    organizationId: row.organizationId == null ? '' : Number(row.organizationId),
    organization: row.organizationName || '待分配组织',
    roleLabel: roleMeta[row.role] || row.role,
    status,
    statusLabel: status === 1 ? '正常' : '已停用',
    phone: row.phone || '—',
    email: row.email || '—',
    createdAtLabel: formatBeijingDateTime(row.createdAt),
  }
}

function resetForm() {
  Object.assign(form, {
    id: null,
    realName: '',
    username: '',
    password: '',
    organizationId: '',
    role: 'member',
    phone: '',
    email: '',
  })
}

async function loadOrganizations() {
  const tree = await request.get('/admin/organizations')
  organizations.value = flattenOrganizations(Array.isArray(tree) ? tree : [])
}

async function loadUsers() {
  loading.value = true
  try {
    const result = await request.get('/admin/users', {
      params: {
        page: page.value,
        pageSize: pageSize.value,
        keyword: filters.keyword || undefined,
        organizationId: filters.organizationId || undefined,
        role: filters.role || undefined,
      },
    })
    rows.value = (result.list || []).map(normalizeUser)
    total.value = Number(result.total || 0)
  } catch (error) {
    ElMessage.error(error.message || '人员列表加载失败')
  } finally {
    loading.value = false
  }
}

async function loadStats() {
  try {
    const [all, secretaries] = await Promise.all([
      request.get('/admin/users', { params: { page: 1, pageSize: 500 } }),
      request.get('/admin/users', { params: { page: 1, pageSize: 1, role: 'secretary' } }),
    ])
    const list = (all.list || []).map(normalizeUser)
    stats.total = Number(all.total || 0)
    stats.secretary = Number(secretaries.total || 0)
    stats.active = list.filter(item => item.status === 1).length
    stats.incomplete = list.filter(item => !item.organizationId || item.phone === '—').length
  } catch {
    // Keep last known metrics if the extra summary request fails.
  }
}

function runSearch() {
  page.value = 1
  loadUsers()
}

function resetFilters() {
  Object.assign(filters, { keyword: '', organizationId: '', role: '' })
  page.value = 1
  loadUsers()
}

function openCreate() {
  dialogMode.value = 'create'
  resetForm()
  dialogVisible.value = true
}

function openEdit(row) {
  dialogMode.value = 'edit'
  Object.assign(form, {
    id: row.id,
    realName: row.realName,
    username: row.username,
    password: '',
    organizationId: row.organizationId || '',
    role: row.role,
    phone: row.phone === '—' ? '' : row.phone,
    email: row.email === '—' ? '' : row.email,
  })
  dialogVisible.value = true
}

function openPreview(row) {
  previewUser.value = row
  previewVisible.value = true
}

function buildPayload() {
  if (!form.realName.trim() || (dialogMode.value === 'create' && !form.username.trim())) {
    throw new Error('请填写姓名和登录账号')
  }
  if (!form.organizationId) throw new Error('请选择所属组织')
  const payload = {
    realName: form.realName.trim(),
    role: form.role,
    organizationId: Number(form.organizationId),
    phone: form.phone.trim() || null,
    email: form.email.trim() || null,
  }
  if (dialogMode.value === 'create') {
    payload.username = form.username.trim()
    if (form.password.trim()) payload.password = form.password.trim()
  } else if (form.password.trim()) {
    payload.password = form.password.trim()
  }
  return payload
}

async function saveUser() {
  try {
    const payload = buildPayload()
    if (dialogMode.value === 'edit') {
      await request.put(`/admin/users/${form.id}`, payload)
      ElMessage.success('人员信息已更新')
    } else {
      await request.post('/admin/users', payload)
      ElMessage.success(form.password.trim() ? '人员已新增' : '人员已新增，默认密码为 123456')
    }
    dialogVisible.value = false
    await Promise.all([loadUsers(), loadStats()])
  } catch (error) {
    ElMessage.error(error.message || '人员保存失败')
  }
}

async function toggleStatus(row) {
  if (row.id === currentUserId.value) return ElMessage.warning('不能停用当前登录账号')
  const nextStatus = row.status === 1 ? 0 : 1
  const action = nextStatus === 1 ? '启用' : '停用'
  try {
    await ElMessageBox.confirm(`确定${action}“${row.realName}”吗？`, `${action}人员`, {
      type: 'warning',
      confirmButtonText: `确认${action}`,
      cancelButtonText: '取消',
    })
    await request.put(`/admin/users/${row.id}`, { status: nextStatus })
    ElMessage.success(`人员已${action}`)
    await Promise.all([loadUsers(), loadStats()])
  } catch {
    // User cancelled.
  }
}

function downloadCsv(filename, lines) {
  const blob = new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

function downloadTemplate() {
  downloadCsv('人员导入模板.csv', [
    '用户名,姓名,角色,组织ID,手机号,邮箱',
    'zhaoliu,赵六,党员,4,13800000000,zhaoliu@example.com',
  ])
  ElMessage.success('已下载导入模板，角色可填写党员/支部书记/系统管理员')
}

async function exportUsers() {
  try {
    const result = await request.get('/admin/users', {
      params: {
        page: 1,
        pageSize: 1000,
        keyword: filters.keyword || undefined,
        organizationId: filters.organizationId || undefined,
        role: filters.role || undefined,
      },
    })
    const list = (result.list || []).map(normalizeUser)
    if (!list.length) return ElMessage.warning('当前筛选条件下没有可导出的人员')
    downloadCsv('人员名单.csv', [
      '姓名,用户名,所属组织,角色,手机号,邮箱,状态,创建时间',
      ...list.map(item => [item.realName, item.username, item.organization, item.roleLabel, item.phone, item.email, item.statusLabel, item.createdAtLabel].join(',')),
    ])
    ElMessage.success(`已导出 ${list.length} 条人员名单`)
  } catch (error) {
    ElMessage.error(error.message || '人员导出失败')
  }
}

async function onImportFile(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  const data = new FormData()
  data.append('file', file)
  importing.value = true
  try {
    const result = await request.post('/admin/users/import', data)
    ElMessage.success(result?.message || `导入完成：成功 ${result.success} 条，失败 ${result.fail} 条`)
    if (result?.errors?.length) ElMessage.warning(result.errors.slice(0, 3).join('；'))
    page.value = 1
    await Promise.all([loadUsers(), loadStats()])
  } catch (error) {
    ElMessage.error(error.message || '人员导入失败')
  } finally {
    importing.value = false
  }
}

onMounted(() => Promise.all([loadOrganizations(), loadUsers(), loadStats()]))
</script>

<template>
  <div class="users-page">
    <div class="page-heading users-heading">
      <div>
        <div class="breadcrumb">首页 <span>›</span> 人员管理</div>
        <h3>人员管理</h3>
        <p>管理党员信息、所属组织与系统角色</p>
      </div>
      <div class="heading-actions">
        <el-button :icon="Download" @click="downloadTemplate">导入模板</el-button>
        <el-button :icon="Download" @click="exportUsers">导出名单</el-button>
        <el-button :icon="Upload" :loading="importing" @click="importInput?.click()">批量导入</el-button>
        <el-button type="primary" :icon="Plus" @click="openCreate">新增人员</el-button>
        <input ref="importInput" type="file" accept=".xlsx,.xls,.csv" hidden @change="onImportFile">
      </div>
    </div>

    <section class="user-metrics">
      <article><span class="metric-icon"><el-icon><UserFilled /></el-icon></span><div><small>人员总数</small><strong>{{ stats.total }}</strong><em>当前系统账号</em></div></article>
      <article><span class="metric-icon"><el-icon><UserFilled /></el-icon></span><div><small>支部书记</small><strong>{{ stats.secretary }}</strong><em>覆盖已建组织</em></div></article>
      <article><span class="metric-icon"><el-icon><UserFilled /></el-icon></span><div><small>启用账号</small><strong>{{ stats.active }}</strong><em>可正常登录</em></div></article>
      <article><span class="metric-icon muted"><el-icon><UserFilled /></el-icon></span><div><small>待完善资料</small><strong>{{ stats.incomplete }}</strong><em :class="{ warn: stats.incomplete }">缺组织或手机号</em></div></article>
    </section>

    <el-card shadow="never" class="filter-card">
      <div class="filter-grid">
        <label><span>姓名或账号</span><el-input v-model="filters.keyword" :prefix-icon="Search" placeholder="输入姓名或账号" clearable @keyup.enter="runSearch" /></label>
        <label>
          <span>所属组织</span>
          <el-select v-model="filters.organizationId" placeholder="全部组织" clearable>
            <el-option v-for="item in organizations" :key="item.id" :label="item.name" :value="item.id" />
          </el-select>
        </label>
        <label>
          <span>系统角色</span>
          <el-select v-model="filters.role" placeholder="全部角色" clearable>
            <el-option v-for="(label, value) in roleMeta" :key="value" :label="label" :value="value" />
          </el-select>
        </label>
        <div class="filter-actions"><el-button @click="resetFilters">重置</el-button><el-button type="primary" @click="runSearch">查询</el-button></div>
      </div>
    </el-card>

    <el-card shadow="never" class="table-card">
      <el-table v-loading="loading" :data="rows">
        <el-table-column label="人员信息" min-width="190">
          <template #default="{ row }">
            <div class="person-cell">
              <el-avatar :size="38">{{ (row.realName || '?').slice(-1) }}</el-avatar>
              <div><strong>{{ row.realName }}</strong><small>{{ row.username }}</small></div>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="organization" label="所属组织" min-width="190" />
        <el-table-column label="角色" width="120"><template #default="{ row }"><el-tag effect="plain">{{ row.roleLabel }}</el-tag></template></el-table-column>
        <el-table-column prop="phone" label="联系方式" width="140" />
        <el-table-column label="状态" width="100"><template #default="{ row }"><span :class="['status-dot', row.status === 1 ? 'active' : 'disabled']">{{ row.statusLabel }}</span></template></el-table-column>
        <el-table-column prop="createdAtLabel" label="创建时间" width="170" />
        <el-table-column label="操作" width="170" align="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openPreview(row)">查看</el-button>
            <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
            <el-button link :type="row.status === 1 ? 'danger' : 'success'" @click="toggleStatus(row)">{{ row.status === 1 ? '停用' : '启用' }}</el-button>
          </template>
        </el-table-column>
      </el-table>
      <div class="pagination-row">
        <span>共 {{ total }} 条记录</span>
        <el-pagination v-model:current-page="page" v-model:page-size="pageSize" background layout="prev,pager,next,sizes" :page-sizes="[10,20,50]" :total="total" @change="loadUsers" />
      </div>
    </el-card>

    <el-dialog v-model="dialogVisible" :title="dialogMode === 'create' ? '新增人员' : '编辑人员'" width="560px">
      <el-form :model="form" label-width="88px">
        <el-form-item label="姓名" required><el-input v-model="form.realName" placeholder="请输入真实姓名" /></el-form-item>
        <el-form-item label="登录账号" required><el-input v-model="form.username" :disabled="dialogMode === 'edit'" placeholder="请输入登录账号" /></el-form-item>
        <el-form-item :label="dialogMode === 'create' ? '登录密码' : '重置密码'">
          <el-input v-model="form.password" type="password" show-password :placeholder="dialogMode === 'create' ? '默认 123456' : '不填写则保持原密码'" />
        </el-form-item>
        <el-form-item label="所属组织" required>
          <el-select v-model="form.organizationId" placeholder="请选择组织" style="width:100%">
            <el-option v-for="item in organizations" :key="item.id" :label="item.name" :value="item.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="系统角色">
          <el-select v-model="form.role" style="width:100%">
            <el-option v-for="(label, value) in roleMeta" :key="value" :label="label" :value="value" />
          </el-select>
        </el-form-item>
        <el-form-item label="手机号"><el-input v-model="form.phone" placeholder="请输入手机号" /></el-form-item>
        <el-form-item label="邮箱"><el-input v-model="form.email" placeholder="选填" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="saveUser">{{ dialogMode === 'create' ? '确认添加' : '保存修改' }}</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="previewVisible" title="人员详情" width="520px">
      <div v-if="previewUser" class="user-preview">
        <div class="preview-meta">
          <el-tag>{{ previewUser.roleLabel }}</el-tag>
          <span :class="['status-dot', previewUser.status === 1 ? 'active' : 'disabled']">{{ previewUser.statusLabel }}</span>
        </div>
        <h3>{{ previewUser.realName }}</h3>
        <p><strong>登录账号：</strong>{{ previewUser.username }}</p>
        <p><strong>所属组织：</strong>{{ previewUser.organization }}</p>
        <p><strong>手机号：</strong>{{ previewUser.phone }}</p>
        <p><strong>邮箱：</strong>{{ previewUser.email }}</p>
        <p><strong>创建时间：</strong>{{ previewUser.createdAtLabel }}</p>
      </div>
      <template #footer>
        <el-button @click="previewVisible = false">关闭</el-button>
        <el-button type="primary" @click="previewVisible = false; openEdit(previewUser)">编辑人员</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.users-page{display:flex;flex-direction:column;gap:20px}.users-heading{margin-bottom:0}.breadcrumb{margin-bottom:10px;color:#847675;font-size:12px}.breadcrumb span{margin:0 8px;color:#bb1620}.heading-actions{display:flex;gap:8px;flex-wrap:wrap}.user-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px}.user-metrics article{display:flex;align-items:center;gap:14px;padding:20px;background:#fff;border:1px solid #efd1cf;border-radius:10px;box-shadow:0 4px 14px rgba(57,20,20,.04)}.metric-icon{display:grid;place-items:center;width:44px;height:44px;border-radius:10px;color:#b60018;background:#fce8e8;font-size:21px}.metric-icon.muted{color:#7d625f;background:#f1eeee}.user-metrics small,.user-metrics strong,.user-metrics em{display:block}.user-metrics small{color:#766d6c}.user-metrics strong{margin:4px 0;font:600 25px/1.1 'Hanken Grotesk',sans-serif}.user-metrics em{color:#36845a;font-size:12px;font-style:normal}.user-metrics em.warn{color:#b56a00}.filter-card,.table-card{border-color:#efd1cf}.filter-grid{display:grid;grid-template-columns:1.2fr 1fr 1fr auto;gap:16px;align-items:end}.filter-grid label>span{display:block;margin-bottom:8px;color:#4e3634;font-size:13px;font-weight:600}.filter-actions{display:flex;gap:8px}.person-cell{display:flex;align-items:center;gap:10px}.person-cell .el-avatar{color:#a00014;background:#fbe6e5}.person-cell strong,.person-cell small{display:block}.person-cell small{margin-top:3px;color:#938887;font-size:12px}.status-dot{display:inline-flex;align-items:center;gap:6px}.status-dot::before{content:'';width:7px;height:7px;border-radius:50%;background:currentColor}.status-dot.active{color:#268653}.status-dot.disabled{color:#999}.pagination-row{display:flex;align-items:center;justify-content:space-between;padding:18px 4px 2px;color:#766d6c;font-size:13px}.user-preview h3{margin:12px 0 16px;font-size:22px}.user-preview p{margin:8px 0;color:#4e3634}.preview-meta{display:flex;align-items:center;gap:12px}@media(max-width:1200px){.user-metrics{grid-template-columns:repeat(2,1fr)}.filter-grid{grid-template-columns:1fr 1fr}.filter-actions{justify-content:flex-end}}
</style>
