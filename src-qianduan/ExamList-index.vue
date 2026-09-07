<template>
  <div class="page-shell">
    <main class="canvas">
      <div class="chips hide-scroll">
        <button v-for="item in filters" :key="item.value" :class="{ on: filter === item.value }" type="button" @click="filter = item.value">{{ item.label }}</button>
      </div>
      <div class="list">
        <article v-for="item in visible" :key="item.id" :class="item.status">
          <div class="head">
            <h2>{{ item.title }}</h2>
            <span>{{ statusText[item.status] }}</span>
          </div>
          <p v-if="item.duration"><Icon name="timer" /> 考试时长: {{ item.duration }}分钟</p>
          <p v-if="item.questionCount"><Icon name="list" /> 题目数量: {{ item.detail }}</p>
          <p v-if="item.deadline" class="warn"><Icon name="event" /> 截止时间: {{ item.deadline }}</p>
          <p v-if="item.openAt"><Icon name="calendar" /> 开放时间: {{ item.openAt }}</p>
          <p v-if="item.score != null"><Icon name="check" /> 得分: {{ item.score }}/100</p>
          <p v-if="item.submittedAt"><Icon name="calendar" /> 交卷时间: {{ item.submittedAt }}</p>
          <button :disabled="!item.take" type="button" @click="open(item)">{{ item.action }}</button>
        </article>
      </div>
    </main>
    <BottomNav active="exam" />
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import BottomNav from './components/BottomNav.vue'
import Icon from './components/Icon.vue'
import { EXAMS } from './data/exams'

const router = useRouter()
const filter = ref('all')
const filters = [
  { label: '全部考试', value: 'all' },
  { label: '未开始 (1)', value: 'pending' },
  { label: '进行中 (1)', value: 'ongoing' },
  { label: '已结束', value: 'ended' },
]
const statusText = { ongoing: '进行中', pending: '未开始', ended: '已结束' }
const visible = computed(() => filter.value === 'all' ? EXAMS : EXAMS.filter(item => item.status === filter.value))

function open(item) {
  if (!item.take) return
  router.push({ path: '/exam/take', query: item.review ? { review: '1' } : {} })
}
</script>

<style scoped>
.canvas { padding: 16px var(--pad) 32px; max-width: 720px; margin: 0 auto; }
.chips { display: flex; gap: 12px; overflow-x: auto; margin-bottom: 24px; min-width: 0; max-width: 100%; }
.chips button {
  flex: none; padding: 8px 16px; border-radius: 999px; background: var(--surface); color: var(--muted);
  border: 1px solid var(--line); font-size: 13px; box-shadow: var(--whisper);
}
.chips .on { background: var(--primary-container); color: #ffcbc8; border-color: var(--primary-container); }
.list { display: grid; gap: 16px; }
article {
  background: var(--surface); border-radius: var(--radius-xl); padding: 16px; box-shadow: var(--whisper);
  position: relative; overflow: hidden; border: 1px solid transparent;
}
article.ongoing::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: var(--primary-container); }
article.ended { opacity: 0.82; border-color: var(--line); }
.head { display: flex; justify-content: space-between; gap: 8px; margin-bottom: 12px; padding-left: 8px; }
article:not(.ongoing) .head { padding-left: 0; }
h2 { font-size: 18px; line-height: 1.4; }
.head span { flex: none; padding: 4px 8px; border-radius: 4px; background: #ffdea8; color: #5e4200; font-size: 11px; }
article.pending .head span, article.ended .head span { background: var(--surface-highest); color: var(--muted); }
p { display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: 15px; margin: 6px 0; padding-left: 8px; }
article:not(.ongoing) p { padding-left: 0; }
.warn { color: var(--error); }
button {
  width: 100%; height: 40px; margin-top: 16px; border-radius: 8px; background: var(--primary-container);
  color: #fff; font-size: 13px; letter-spacing: 0.05em;
}
article.pending button, article.ended button {
  background: transparent; color: var(--primary); border: 1px solid var(--line);
}
article.pending button { opacity: 0.5; color: var(--primary); }
article.ended button { color: var(--muted); }
button:disabled { cursor: not-allowed; }
</style>
