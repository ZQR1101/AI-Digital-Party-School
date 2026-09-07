<template>
  <div class="page-shell no-tab">
    <header class="top">
      <button type="button" aria-label="返回" @click="router.back()"><Icon name="arrow_back" /></button>
      <h1>学习档案</h1>
      <span></span>
    </header>
    <main class="canvas">
      <section class="summary">
        <div><strong class="stat-num">{{ archive.totalHours }}</strong><span>累计学时</span></div>
        <div><strong class="stat-num">{{ archive.completedTasks }}</strong><span>完成任务</span></div>
        <div><strong class="stat-num">{{ archive.averageScore }}</strong><span>平均成绩</span></div>
      </section>
      <section class="card">
        <div class="section-head"><h2>年度学习进度</h2><span>{{ archive.completedHours }}/{{ archive.targetHours }} 学时</span></div>
        <div class="bar"><i :style="{ width: `${completionRate}%` }"></i></div>
        <div class="progress-meta"><span>已完成 {{ completionRate }}%</span><span>还需 {{ archive.targetHours - archive.completedHours }} 学时</span></div>
      </section>
      <section class="card">
        <div class="section-head"><h2>学习明细</h2><span>共 {{ filteredRecords.length }} 条</span></div>
        <div class="tabs">
          <button v-for="tab in tabs" :key="tab.value" :class="{ active: activeTab === tab.value }" type="button" @click="activeTab = tab.value">{{ tab.label }}</button>
        </div>
        <div v-if="filteredRecords.length" class="record-list">
          <article v-for="item in filteredRecords" :key="item.id">
            <div :class="['mark', item.type]"><Icon :name="item.type === 'course' ? 'menu_book' : item.type === 'task' ? 'assignment' : 'quiz'" /></div>
            <div>
              <div class="title"><h3>{{ item.title }}</h3><span>{{ item.status }}</span></div>
              <p>{{ item.date }} · {{ item.detail }}</p>
            </div>
          </article>
        </div>
        <div v-else class="empty">暂无相关学习记录</div>
      </section>
    </main>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import Icon from './components/Icon.vue'

const router = useRouter()
const activeTab = ref('all')
const tabs = [
  { label: '全部', value: 'all' },
  { label: '课程', value: 'course' },
  { label: '任务', value: 'task' },
  { label: '测评', value: 'exam' },
]
const archive = ref({ totalHours: 32.5, completedHours: 32, targetHours: 48, completedTasks: 12, averageScore: 92 })
const records = ref([
  { id: 1, type: 'exam', title: '新时代党的理论知识测评', date: '2026-08-06', detail: '成绩 95 分', status: '优秀' },
  { id: 2, type: 'task', title: '二十大精神专题学习', date: '2026-08-03', detail: '学习 60 分钟', status: '已完成' },
  { id: 3, type: 'course', title: '党员纪律教育学习资料', date: '2026-07-29', detail: '学习 45 分钟', status: '已学完' },
  { id: 4, type: 'exam', title: '党史知识专题测评', date: '2026-07-25', detail: '成绩 88 分', status: '合格' },
  { id: 5, type: 'course', title: '红色精神传承专题课程', date: '2026-07-21', detail: '学习 80 分钟', status: '已学完' },
  { id: 6, type: 'task', title: '基层党建实务学习', date: '2026-07-18', detail: '学习 40 分钟', status: '已完成' },
])
const completionRate = computed(() => Math.round(archive.value.completedHours / archive.value.targetHours * 100))
const filteredRecords = computed(() => activeTab.value === 'all' ? records.value : records.value.filter(item => item.type === activeTab.value))
</script>

<style scoped>
.top {
  height: 64px; padding: 0 var(--pad); display: grid; grid-template-columns: 40px 1fr 40px; align-items: center;
  position: sticky; top: 0; background: var(--bg); z-index: 8;
}
.top h1 { text-align: center; font-size: 18px; color: var(--primary); }
.top button { font-size: 22px; color: var(--primary); }
.canvas { max-width: 720px; margin: auto; padding: 16px var(--pad) 32px; display: grid; gap: 16px; }
.summary, .card {
  background: var(--surface); border-radius: var(--radius-xl); padding: 18px; box-shadow: var(--whisper);
  border: 1px solid rgba(226, 190, 188, 0.25);
}
.summary { display: grid; grid-template-columns: repeat(3, 1fr); text-align: center; }
.summary strong { display: block; font-size: 24px; color: var(--primary); margin-bottom: 6px; }
.summary span { font-size: 12px; color: var(--muted); }
.section-head { display: flex; justify-content: space-between; align-items: center; }
.section-head h2 { font-size: 16px; }
.section-head > span { font-size: 12px; color: var(--muted); }
.bar { height: 8px; background: var(--surface-low); border-radius: 8px; margin: 18px 0 8px; overflow: hidden; }
.bar i { display: block; height: 100%; background: var(--primary-container); }
.progress-meta { display: flex; justify-content: space-between; color: var(--muted); font-size: 12px; }
.tabs { display: grid; grid-template-columns: repeat(4, 1fr); border-bottom: 1px solid #eee; margin-top: 12px; }
.tabs button { height: 40px; color: var(--muted); position: relative; }
.tabs .active { color: var(--primary); font-weight: 600; }
.tabs .active::after { content: ""; position: absolute; bottom: -1px; left: 25%; width: 50%; height: 2px; background: var(--primary); }
.record-list article { display: flex; align-items: center; gap: 12px; padding: 15px 0; border-bottom: 1px solid #f0edeb; }
.record-list article:last-child { border: 0; }
.mark { width: 38px; height: 38px; border-radius: 10px; display: grid; place-items: center; flex: none; }
.mark.course { background: #edf4f0; color: #347253; }
.mark.task { background: #f8eee5; color: #95602e; }
.mark.exam { background: #f7e8e9; color: #aa1b24; }
.title { display: flex; align-items: flex-start; gap: 8px; }
.title h3 { font-size: 14px; line-height: 1.45; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.title span { font-size: 11px; padding: 3px 7px; border-radius: 999px; background: #eaf5ee; color: #33734c; white-space: nowrap; }
p { font-size: 12px; color: var(--muted); margin-top: 6px; }
.empty { text-align: center; color: #999; padding: 44px 0 32px; }
</style>
