<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Search, View } from '@element-plus/icons-vue'
import request from '@/api/request'
import { formatBeijingDateTime } from '@/utils/dateTime'

const typeMeta = {
  single: { label: '单选题', options: true },
  multiple: { label: '多选题', options: true },
  judge: { label: '判断题', options: false },
}
const difficultyMeta = { 1: '简单', 2: '中等', 3: '困难' }
const categories = ['理论学习', '党史知识', '纪律教育', '时政要闻', '业务培训']
const optionLetters = ['A', 'B', 'C', 'D']

const activeTab = ref('questions')
const loadingQuestions = ref(false)
const loadingPapers = ref(false)
const questionDialog = ref(false)
const questionPreviewVisible = ref(false)
const paperDialog = ref(false)
const paperPreviewVisible = ref(false)
const assessmentDialog = ref(false)
const assessmentSaving = ref(false)
const assessmentOrganizations = ref([])
const assessmentPaper = ref(null)
const assessmentForm = reactive({ organizationId: null, kind: 'quiz', deadline: '' })
const questionMode = ref('create')
const paperMode = ref('create')
const paperStep = ref(1)
const questionPreview = ref(null)
const paperPreview = ref(null)
const questions = ref([])
const papers = ref([])
const availableQuestions = ref([])
const selectedQuestionIds = ref([])
const paperQuestionKeyword = ref('')
const questionPage = ref(1)
const questionPageSize = ref(10)
const questionTotal = ref(0)
const paperPage = ref(1)
const paperPageSize = ref(10)
const paperTotal = ref(0)

const filters = reactive({ type: '', category: '', difficulty: '', keyword: '' })
const questionForm = reactive({ id: null, title: '', type: 'single', category: '理论学习', difficulty: 1, options: ['', '', '', ''], answer: '', answers: [], analysis: '' })
const paperForm = reactive({ id: null, title: '', category: '理论学习', description: '', totalScore: 100, passScore: 60, duration: 60, status: 1 })

function parseOptions(value) {
  if (Array.isArray(value)) return value
  try { return JSON.parse(value || '[]') } catch { return [] }
}

function stripOptionPrefix(value) {
  return String(value || '').replace(/^[A-D][.、．]\s*/, '')
}

function normalizeQuestion(row) {
  return {
    ...row,
    options: parseOptions(row.options),
    difficulty: Number(row.difficulty),
    typeLabel: typeMeta[row.type]?.label || row.type,
    difficultyLabel: difficultyMeta[Number(row.difficulty)] || '未知',
    updatedAtLabel: formatBeijingDateTime(row.updatedAt),
  }
}

function normalizePaper(row) {
  return {
    ...row,
    status: Number(row.status),
    totalScore: Number(row.totalScore),
    passScore: Number(row.passScore),
    questionCount: Number(row.questionCount || 0),
    updatedAtLabel: formatBeijingDateTime(row.updatedAt),
  }
}

async function loadQuestions() {
  loadingQuestions.value = true
  try {
    const result = await request.get('/admin/questions', {
      params: {
        page: questionPage.value,
        pageSize: questionPageSize.value,
        keyword: filters.keyword || undefined,
        type: filters.type || undefined,
        category: filters.category || undefined,
        difficulty: filters.difficulty || undefined,
      },
    })
    questions.value = (result.list || []).map(normalizeQuestion)
    questionTotal.value = Number(result.total || 0)
  } catch (error) {
    ElMessage.error(error.message || '题库加载失败')
  } finally {
    loadingQuestions.value = false
  }
}

async function loadPapers() {
  loadingPapers.value = true
  try {
    const result = await request.get('/admin/papers', { params: { page: paperPage.value, pageSize: paperPageSize.value } })
    papers.value = (result.list || []).map(normalizePaper)
    paperTotal.value = Number(result.total || 0)
  } catch (error) {
    ElMessage.error(error.message || '试卷加载失败')
  } finally {
    loadingPapers.value = false
  }
}

function resetFilters() {
  Object.assign(filters, { type: '', category: '', difficulty: '', keyword: '' })
  questionPage.value = 1
  loadQuestions()
}

function runQuestionSearch() {
  questionPage.value = 1
  loadQuestions()
}

function resetQuestionForm() {
  Object.assign(questionForm, { id: null, title: '', type: 'single', category: '理论学习', difficulty: 1, options: ['', '', '', ''], answer: '', answers: [], analysis: '' })
}

function openCreateQuestion() {
  questionMode.value = 'create'
  resetQuestionForm()
  questionDialog.value = true
}

function openEditQuestion(row) {
  questionMode.value = 'edit'
  Object.assign(questionForm, {
    id: row.id,
    title: row.title,
    type: row.type,
    category: row.category || '理论学习',
    difficulty: Number(row.difficulty),
    options: [...parseOptions(row.options).map(stripOptionPrefix), '', '', '', ''].slice(0, 4),
    answer: row.type === 'multiple' ? '' : String(row.answer),
    answers: row.type === 'multiple' ? String(row.answer).split(',').filter(Boolean) : [],
    analysis: row.analysis || '',
  })
  questionDialog.value = true
}

function openQuestionPreview(row) {
  questionPreview.value = row
  questionPreviewVisible.value = true
}

function buildQuestionPayload() {
  const needsOptions = typeMeta[questionForm.type].options
  const filledOptions = questionForm.options.map(item => item.trim()).filter(Boolean)
  if (!questionForm.title.trim()) throw new Error('请输入题目内容')
  if (needsOptions && filledOptions.length < 2) throw new Error('选择题至少填写两个选项')
  const answer = questionForm.type === 'multiple'
    ? [...questionForm.answers].sort().join(',')
    : questionForm.answer
  if (!answer) throw new Error('请选择或填写正确答案')
  return {
    title: questionForm.title.trim(),
    type: questionForm.type,
    category: questionForm.category,
    difficulty: Number(questionForm.difficulty),
    options: needsOptions ? filledOptions.map((item, index) => `${optionLetters[index]}. ${item}`) : [],
    answer,
    analysis: questionForm.analysis.trim(),
  }
}

async function saveQuestion() {
  try {
    const payload = buildQuestionPayload()
    if (questionMode.value === 'edit') {
      await request.put(`/admin/questions/${questionForm.id}`, payload)
      ElMessage.success('题目已更新')
    } else {
      await request.post('/admin/questions', payload)
      ElMessage.success('题目已新增')
    }
    questionDialog.value = false
    await loadQuestions()
  } catch (error) {
    ElMessage.error(error.message || '题目保存失败')
  }
}

async function deleteQuestion(row) {
  try {
    await ElMessageBox.confirm(`确定删除“${row.title}”吗？`, '删除题目', { type: 'warning', confirmButtonText: '确认删除', cancelButtonText: '取消' })
    await request.delete(`/admin/questions/${row.id}`)
    ElMessage.success('题目已删除')
    await loadQuestions()
  } catch {
    // User cancelled.
  }
}

function resetPaperForm() {
  Object.assign(paperForm, { id: null, title: '', category: '理论学习', description: '', totalScore: 100, passScore: 60, duration: 60, status: 1 })
  selectedQuestionIds.value = []
  paperQuestionKeyword.value = ''
  paperStep.value = 1
}

async function loadAvailableQuestions() {
  const result = await request.get('/admin/questions', { params: { page: 1, pageSize: 500 } })
  availableQuestions.value = (result.list || []).map(normalizeQuestion)
}

async function openCreatePaper() {
  paperMode.value = 'create'
  resetPaperForm()
  try {
    await loadAvailableQuestions()
    paperDialog.value = true
  } catch (error) {
    ElMessage.error(error.message || '可选题目加载失败')
  }
}

async function openEditPaper(row) {
  try {
    paperMode.value = 'edit'
    resetPaperForm()
    const [detail] = await Promise.all([
      request.get(`/admin/papers/${row.id}`),
      loadAvailableQuestions(),
    ])
    Object.assign(paperForm, {
      id: detail.id,
      title: detail.title,
      category: detail.category || '理论学习',
      description: detail.description || '',
      totalScore: Number(detail.totalScore),
      passScore: Number(detail.passScore),
      duration: Number(detail.duration),
      status: Number(detail.status),
    })
    selectedQuestionIds.value = (detail.questions || []).map(item => Number(item.id))
    paperDialog.value = true
  } catch (error) {
    ElMessage.error(error.message || '试卷加载失败')
  }
}

function goSelectQuestions() {
  if (!paperForm.title.trim()) return ElMessage.warning('请输入试卷名称')
  if (paperForm.passScore > paperForm.totalScore) return ElMessage.warning('及格分不能高于总分')
  paperStep.value = 2
}

function toggleQuestion(id, checked) {
  if (checked) selectedQuestionIds.value = [...new Set([...selectedQuestionIds.value, id])]
  else selectedQuestionIds.value = selectedQuestionIds.value.filter(item => item !== id)
}

const filteredAvailableQuestions = computed(() => {
  const keyword = paperQuestionKeyword.value.trim()
  return availableQuestions.value.filter(row => !keyword || row.title.includes(keyword) || row.category?.includes(keyword))
})

async function savePaper() {
  if (!selectedQuestionIds.value.length) return ElMessage.warning('请至少选择一道题目')
  const payload = {
    title: paperForm.title.trim(),
    category: paperForm.category,
    description: paperForm.description.trim(),
    totalScore: Number(paperForm.totalScore),
    passScore: Number(paperForm.passScore),
    duration: Number(paperForm.duration),
    status: Number(paperForm.status),
    questionIds: selectedQuestionIds.value,
  }
  try {
    if (paperMode.value === 'edit') {
      await request.put(`/admin/papers/${paperForm.id}`, payload)
      ElMessage.success('试卷已更新')
    } else {
      await request.post('/admin/papers', payload)
      ElMessage.success('试卷已创建')
    }
    paperDialog.value = false
    await loadPapers()
  } catch (error) {
    ElMessage.error(error.message || '试卷保存失败')
  }
}

async function previewPaper(row) {
  try {
    paperPreview.value = await request.get(`/admin/papers/${row.id}`)
    paperPreview.value.questions = (paperPreview.value.questions || []).map(normalizeQuestion)
    paperPreviewVisible.value = true
  } catch (error) {
    ElMessage.error(error.message || '试卷预览加载失败')
  }
}

async function publishPaper(row) {
  try {
    await request.put(`/admin/papers/${row.id}`, { status: 2 })
    ElMessage.success('试卷已发布')
    await loadPapers()
  } catch (error) {
    ElMessage.error(error.message || '试卷发布失败')
  }
}

async function openAssessment(row) {
  try {
    assessmentOrganizations.value = await request.get('/admin/organizations')
    assessmentPaper.value = row
    Object.assign(assessmentForm, { organizationId: null, kind: 'quiz', deadline: '' })
    assessmentDialog.value = true
  } catch (error) {
    ElMessage.error(error.message || '组织架构加载失败')
  }
}

async function publishAssessment() {
  if (!assessmentForm.organizationId) {
    ElMessage.warning('请选择下发组织')
    return
  }
  assessmentSaving.value = true
  try {
    await request.post('/admin/assessments', {
      paperId: assessmentPaper.value.id,
      organizationId: assessmentForm.organizationId,
      kind: assessmentForm.kind,
      deadline: assessmentForm.deadline || null,
    })
    ElMessage.success('测评已下发，学员可在测评列表中查看')
    assessmentDialog.value = false
  } catch (error) {
    ElMessage.error(error.message || '测评下发失败')
  } finally {
    assessmentSaving.value = false
  }
}

async function deletePaper(row) {
  try {
    await ElMessageBox.confirm(`确定删除试卷“${row.title}”吗？`, '删除试卷', { type: 'warning', confirmButtonText: '确认删除', cancelButtonText: '取消' })
    await request.delete(`/admin/papers/${row.id}`)
    ElMessage.success('试卷已删除')
    await loadPapers()
  } catch {
    // User cancelled.
  }
}

const publishedPaperCount = computed(() => papers.value.filter(row => row.status === 2).length)
const draftPaperCount = computed(() => papers.value.filter(row => row.status === 1).length)

onMounted(() => Promise.all([loadQuestions(), loadPapers()]))
</script>

<template>
  <div class="question-page">
    <div class="page-heading question-heading">
      <div><div class="breadcrumb">首页 <span>›</span> 教务管理</div><h3>题库与试卷</h3><p>统一维护考试题目并完成真实试卷编排</p></div>
      <div class="heading-actions">
        <el-button v-if="activeTab === 'questions'" type="primary" :icon="Plus" @click="openCreateQuestion">新增题目</el-button>
        <el-button v-else type="primary" :icon="Plus" @click="openCreatePaper">新增试卷</el-button>
      </div>
    </div>

    <el-card shadow="never" class="content-card">
      <el-tabs v-model="activeTab" class="module-tabs">
        <el-tab-pane label="题库管理" name="questions">
          <div class="filter-row">
            <el-select v-model="filters.type" placeholder="全部题型" clearable><el-option v-for="(meta, key) in typeMeta" :key="key" :label="meta.label" :value="key" /></el-select>
            <el-select v-model="filters.category" placeholder="全部知识点" clearable><el-option v-for="item in categories" :key="item" :label="item" :value="item" /></el-select>
            <el-select v-model="filters.difficulty" placeholder="全部难度" clearable><el-option v-for="(label, key) in difficultyMeta" :key="key" :label="label" :value="Number(key)" /></el-select>
            <el-input v-model="filters.keyword" :prefix-icon="Search" placeholder="输入关键词搜索" clearable @keyup.enter="runQuestionSearch" />
            <el-button @click="resetFilters">重置</el-button><el-button type="primary" @click="runQuestionSearch">查询</el-button>
          </div>
          <el-table v-loading="loadingQuestions" :data="questions">
            <el-table-column prop="title" label="题目内容" min-width="330" show-overflow-tooltip />
            <el-table-column label="题型" width="100"><template #default="{ row }"><el-tag effect="plain">{{ row.typeLabel }}</el-tag></template></el-table-column>
            <el-table-column prop="category" label="知识点" width="120" />
            <el-table-column label="难度" width="100"><template #default="{ row }"><span :class="['difficulty', row.difficultyLabel]">{{ row.difficultyLabel }}</span></template></el-table-column>
            <el-table-column prop="usage" label="使用次数" width="100" />
            <el-table-column prop="updatedAtLabel" label="更新时间" width="170" />
            <el-table-column label="操作" width="170" align="right"><template #default="{ row }"><el-button link type="primary" @click="openQuestionPreview(row)">查看</el-button><el-button link type="primary" @click="openEditQuestion(row)">编辑</el-button><el-button link type="danger" @click="deleteQuestion(row)">删除</el-button></template></el-table-column>
          </el-table>
          <div class="pagination-row"><span>共 {{ questionTotal }} 道题目</span><el-pagination v-model:current-page="questionPage" v-model:page-size="questionPageSize" background layout="prev,pager,next,sizes" :page-sizes="[10,20,50]" :total="questionTotal" @change="loadQuestions" /></div>
        </el-tab-pane>

        <el-tab-pane label="试卷管理" name="papers">
          <div class="paper-summary"><div><small>试卷总数</small><strong>{{ paperTotal }}</strong></div><div><small>当前页草稿</small><strong>{{ draftPaperCount }}</strong></div><div><small>当前页已发布</small><strong>{{ publishedPaperCount }}</strong></div><div class="ai-tip"><b>组卷状态</b><span>当前题库共有 {{ questionTotal }} 道可用题目，可按知识点与难度持续补充。</span></div></div>
          <el-table v-loading="loadingPapers" :data="papers">
            <el-table-column prop="title" label="试卷名称" min-width="280" /><el-table-column prop="category" label="分类" width="120" /><el-table-column prop="questionCount" label="题目数" width="90" />
            <el-table-column prop="totalScore" label="总分" width="80" /><el-table-column prop="passScore" label="及格分" width="90" /><el-table-column prop="duration" label="时长（分钟）" width="120" /><el-table-column prop="creatorName" label="创建人" width="110" /><el-table-column prop="updatedAtLabel" label="更新时间" width="170" />
            <el-table-column label="状态" width="90"><template #default="{ row }"><el-tag :type="row.status === 2 ? 'success' : 'warning'">{{ row.status === 2 ? '已发布' : '草稿' }}</el-tag></template></el-table-column>
            <el-table-column label="操作" width="240" align="right">
              <template #default="{ row }">
                <el-button link type="primary" @click="previewPaper(row)">预览</el-button>
                <el-button link type="primary" @click="openEditPaper(row)">编辑</el-button>
                <el-button v-if="row.status !== 2" link type="success" @click="publishPaper(row)">发布</el-button>
                <el-button v-else link type="success" @click="openAssessment(row)">下发测评</el-button>
                <el-button link type="danger" @click="deletePaper(row)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
          <div class="pagination-row"><span>共 {{ paperTotal }} 份试卷</span><el-pagination v-model:current-page="paperPage" v-model:page-size="paperPageSize" background layout="prev,pager,next,sizes" :page-sizes="[10,20,50]" :total="paperTotal" @change="loadPapers" /></div>
        </el-tab-pane>
      </el-tabs>
    </el-card>

    <el-dialog v-model="questionDialog" :title="questionMode === 'create' ? '新增题目' : '编辑题目'" width="680px">
      <el-form :model="questionForm" label-position="top">
        <el-form-item label="题目内容" required><el-input v-model="questionForm.title" type="textarea" :rows="3" placeholder="请输入题目内容" /></el-form-item>
        <div class="form-grid"><el-form-item label="题型" required><el-select v-model="questionForm.type" style="width:100%"><el-option v-for="(meta, key) in typeMeta" :key="key" :label="meta.label" :value="key" /></el-select></el-form-item><el-form-item label="知识点" required><el-select v-model="questionForm.category" style="width:100%"><el-option v-for="item in categories" :key="item" :label="item" :value="item" /></el-select></el-form-item></div>
        <el-form-item v-if="typeMeta[questionForm.type].options" label="题目选项" required><div class="option-list"><el-input v-for="(option, index) in questionForm.options" :key="index" v-model="questionForm.options[index]" :placeholder="`${optionLetters[index]} 选项内容`"><template #prepend>{{ optionLetters[index] }}</template></el-input></div></el-form-item>
        <el-form-item label="正确答案" required>
          <el-checkbox-group v-if="questionForm.type === 'multiple'" v-model="questionForm.answers"><el-checkbox v-for="letter in optionLetters" :key="letter" :value="letter">{{ letter }}</el-checkbox></el-checkbox-group>
          <el-radio-group v-else-if="questionForm.type === 'judge'" v-model="questionForm.answer"><el-radio value="true">正确</el-radio><el-radio value="false">错误</el-radio></el-radio-group>
          <el-select v-else v-model="questionForm.answer" placeholder="请选择正确答案" style="width:180px"><el-option v-for="letter in optionLetters" :key="letter" :label="letter" :value="letter" /></el-select>
        </el-form-item>
        <el-form-item label="答案解析"><el-input v-model="questionForm.analysis" type="textarea" :rows="3" placeholder="请输入答案解析" /></el-form-item>
        <el-form-item label="难度"><el-radio-group v-model="questionForm.difficulty"><el-radio v-for="(label, key) in difficultyMeta" :key="key" :value="Number(key)">{{ label }}</el-radio></el-radio-group></el-form-item>
      </el-form>
      <template #footer><el-button @click="questionDialog = false">取消</el-button><el-button type="primary" @click="saveQuestion">保存题目</el-button></template>
    </el-dialog>

    <el-dialog v-model="questionPreviewVisible" title="题目详情" width="620px">
      <div v-if="questionPreview" class="question-preview"><div class="preview-meta"><el-tag>{{ questionPreview.typeLabel }}</el-tag><span>{{ questionPreview.category }}</span><span>{{ questionPreview.difficultyLabel }}</span></div><h3>{{ questionPreview.title }}</h3><ol v-if="questionPreview.options.length"><li v-for="option in questionPreview.options" :key="option">{{ option }}</li></ol><p><strong>正确答案：</strong>{{ questionPreview.answer }}</p><div class="analysis"><strong>答案解析</strong><p>{{ questionPreview.analysis || '暂无解析' }}</p></div></div>
      <template #footer><el-button @click="questionPreviewVisible = false">关闭</el-button><el-button type="primary" @click="questionPreviewVisible = false; openEditQuestion(questionPreview)">编辑题目</el-button></template>
    </el-dialog>

    <el-dialog v-model="paperDialog" :title="paperMode === 'create' ? '新增试卷' : '编辑试卷'" width="760px">
      <el-steps :active="paperStep - 1" simple class="paper-steps"><el-step title="试卷信息" /><el-step title="选择题目" /></el-steps>
      <el-form v-if="paperStep === 1" :model="paperForm" label-position="top" class="paper-form"><el-form-item label="试卷名称" required><el-input v-model="paperForm.title" placeholder="请输入试卷名称" /></el-form-item><div class="form-grid"><el-form-item label="试卷分类"><el-select v-model="paperForm.category" style="width:100%"><el-option v-for="item in categories" :key="item" :label="item" :value="item" /></el-select></el-form-item><el-form-item label="考试时长"><el-input-number v-model="paperForm.duration" :min="10" :max="300" /><span class="unit">分钟</span></el-form-item></div><el-form-item label="试卷说明"><el-input v-model="paperForm.description" type="textarea" :rows="3" /></el-form-item><div class="form-grid"><el-form-item label="总分"><el-input-number v-model="paperForm.totalScore" :min="1" :max="1000" /></el-form-item><el-form-item label="及格分"><el-input-number v-model="paperForm.passScore" :min="1" :max="paperForm.totalScore" /></el-form-item></div></el-form>
      <div v-else><div class="selection-toolbar"><el-input v-model="paperQuestionKeyword" :prefix-icon="Search" placeholder="搜索题目或知识点" clearable /><strong>已选择 {{ selectedQuestionIds.length }} 道题</strong></div><el-table :data="filteredAvailableQuestions" height="360"><el-table-column label="选择" width="70"><template #default="{ row }"><el-checkbox :model-value="selectedQuestionIds.includes(row.id)" @change="checked => toggleQuestion(row.id, checked)" /></template></el-table-column><el-table-column prop="title" label="题目" min-width="350" show-overflow-tooltip /><el-table-column prop="typeLabel" label="题型" width="90" /><el-table-column prop="category" label="知识点" width="110" /><el-table-column prop="difficultyLabel" label="难度" width="80" /></el-table></div>
      <template #footer><el-button @click="paperDialog = false">取消</el-button><el-button v-if="paperStep === 2" @click="paperStep = 1">上一步</el-button><el-button v-if="paperStep === 1" type="primary" @click="goSelectQuestions">下一步：选择题目</el-button><el-button v-else type="primary" @click="savePaper">{{ paperMode === 'create' ? '创建试卷' : '保存修改' }}</el-button></template>
    </el-dialog>

    <el-dialog v-model="paperPreviewVisible" title="试卷预览" width="760px">
      <div v-if="paperPreview" class="paper-preview"><div class="preview-meta"><el-tag>{{ paperPreview.category || '未分类' }}</el-tag><span>{{ paperPreview.duration }} 分钟</span><span>总分 {{ Number(paperPreview.totalScore) }}</span><span>及格 {{ Number(paperPreview.passScore) }}</span></div><h2>{{ paperPreview.title }}</h2><p class="paper-description">{{ paperPreview.description || '暂无试卷说明' }}</p><div v-for="(question, index) in paperPreview.questions" :key="question.id" class="paper-question"><strong>{{ index + 1 }}. {{ question.title }}</strong><ul v-if="question.options.length"><li v-for="option in question.options" :key="option">{{ option }}</li></ul><small>{{ question.score }} 分 · {{ question.typeLabel }}</small></div></div>
      <template #footer><el-button @click="paperPreviewVisible = false">关闭</el-button><el-button type="primary" :icon="View" @click="paperPreviewVisible = false; openEditPaper(paperPreview)">编辑试卷</el-button></template>
    </el-dialog>

    <el-dialog v-model="assessmentDialog" title="下发测评" width="480px" :close-on-click-modal="!assessmentSaving">
      <el-form label-position="top">
        <el-form-item label="试卷"><b>{{ assessmentPaper?.title }}</b></el-form-item>
        <el-form-item label="下发组织（包含下级组织）" required>
          <el-tree-select
            v-model="assessmentForm.organizationId"
            :data="assessmentOrganizations"
            node-key="id"
            :props="{ label: 'name' }"
            check-strictly
            filterable
            placeholder="请选择组织"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="测评类型">
          <el-radio-group v-model="assessmentForm.kind">
            <el-radio value="quiz">阶段测验</el-radio>
            <el-radio value="exam">正式考试</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="截止日期（可选）">
          <el-date-picker v-model="assessmentForm.deadline" type="date" value-format="YYYY-MM-DD" placeholder="不限日期" style="width: 100%" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button :disabled="assessmentSaving" @click="assessmentDialog = false">取消</el-button>
        <el-button type="primary" :loading="assessmentSaving" @click="publishAssessment">确认下发</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.question-page{display:flex;flex-direction:column;gap:20px}.question-heading{margin-bottom:0}.breadcrumb{margin-bottom:10px;color:#847675;font-size:12px}.breadcrumb span{margin:0 8px;color:#bb1620}.heading-actions{display:flex;gap:8px}.content-card{border-color:#efd1cf}.module-tabs :deep(.el-tabs__header){margin-bottom:20px}.module-tabs :deep(.el-tabs__item){height:46px;font-size:15px;font-weight:600}.filter-row{display:grid;grid-template-columns:repeat(3,1fr) 1.2fr auto auto;gap:12px;margin-bottom:20px;padding:18px;background:#faf8f8;border:1px solid #f0d7d5;border-radius:8px}.difficulty{display:inline-flex;align-items:center;gap:6px}.difficulty::before{content:'';width:7px;height:7px;border-radius:50%;background:currentColor}.difficulty.简单{color:#15975b}.difficulty.中等{color:#d47c00}.difficulty.困难{color:#d21f2b}.pagination-row{display:flex;align-items:center;justify-content:space-between;padding:18px 4px 2px;color:#766d6c;font-size:13px}.paper-summary{display:grid;grid-template-columns:repeat(3,150px) 1fr;gap:14px;margin-bottom:20px}.paper-summary>div{padding:18px;border:1px solid #efd1cf;border-radius:8px;background:#fff}.paper-summary small,.paper-summary strong{display:block}.paper-summary small{color:#796c6b}.paper-summary strong{margin-top:6px;font-size:25px}.paper-summary .ai-tip{display:flex;flex-direction:column;justify-content:center;background:linear-gradient(135deg,#fff8f4,#fff)}.ai-tip b{color:#a00014}.ai-tip span{margin-top:6px;color:#766d6c;font-size:12px;line-height:1.6}.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.option-list{width:100%;display:grid;gap:10px}.preview-meta{display:flex;align-items:center;gap:12px;color:#7c6e6b;font-size:12px}.question-preview h3{margin:18px 0;font-size:18px;line-height:1.7}.question-preview ol{display:grid;gap:8px;padding-left:24px}.analysis,.paper-description{padding:14px 16px;border-left:3px solid #bd1a24;background:#fbf5f5}.analysis p{margin:7px 0 0;line-height:1.7}.paper-steps{margin-bottom:22px}.unit{margin-left:8px;color:#7d7372}.selection-toolbar{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:14px}.selection-toolbar .el-input{max-width:420px}.selection-toolbar strong{color:#a00014;white-space:nowrap}.paper-preview h2{margin:18px 0 10px}.paper-description{color:#675957;line-height:1.7}.paper-question{padding:18px 2px;border-bottom:1px solid #eee2e0}.paper-question>strong{line-height:1.7}.paper-question ul{display:grid;gap:6px;margin:12px 0}.paper-question small{color:#927d79}@media(max-width:1250px){.filter-row{grid-template-columns:repeat(2,1fr)}.paper-summary{grid-template-columns:repeat(3,1fr)}.paper-summary .ai-tip{grid-column:1/-1}}
</style>
