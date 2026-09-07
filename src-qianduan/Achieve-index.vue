<template>
  <div class="page-shell no-tab">
    <header class="top">
      <button type="button" aria-label="返回" @click="router.back()"><Icon name="arrow_back" /></button>
      <h1>成就墙</h1>
      <button type="button" aria-label="我的" @click="router.push('/mine')"><Icon name="person" /></button>
    </header>
    <main class="canvas">
      <section class="summary">
        <div class="avatar">{{ userName.slice(0, 1) }}</div>
        <div>
          <h2>{{ userName }}</h2>
          <div class="tags"><span>荣誉学员</span><em>Lv.12</em></div>
        </div>
      </section>
      <section>
        <h3>成就勋章</h3>
        <div class="medals">
          <div v-for="item in medals" :key="item.name" :class="{ locked: item.locked }">
            <div class="badge"><Icon :name="item.icon" /></div>
            <span>{{ item.name }}</span>
          </div>
        </div>
      </section>
      <section>
        <h3>荣誉里程碑</h3>
        <div class="timeline">
          <article v-for="item in milestones" :key="item.title">
            <h4>{{ item.title }}</h4>
            <p>{{ item.detail }}</p>
          </article>
        </div>
      </section>
    </main>
  </div>
</template>

<script setup>
import { useRouter } from 'vue-router'
import Icon from './components/Icon.vue'

const router = useRouter()
const storedUser = JSON.parse(localStorage.getItem('mobileUser') || '{}')
const userName = storedUser.realName || storedUser.username || '学员'
const medals = [
  { name: '连续七日', icon: 'fire' },
  { name: '测评优秀', icon: 'medal' },
  { name: '理论先锋', icon: 'menu_book' },
  { name: '月度学霸', icon: 'trophy', locked: true },
  { name: '学习小组', icon: 'group', locked: true },
  { name: '先锋示范', icon: 'flag', locked: true },
]
const milestones = [
  { title: '完成首门专题课程', detail: '开启数智党校学习档案' },
  { title: '理论知识测评合格', detail: '成绩计入个人成长记录' },
  { title: '连续学习 7 天', detail: '保持节奏，下一项是月度学霸' },
]
</script>

<style scoped>
.top {
  height: 64px; padding: 0 var(--pad); display: grid; grid-template-columns: 40px 1fr 40px; align-items: center;
  position: sticky; top: 0; background: var(--bg); z-index: 8;
}
.top h1 { text-align: center; font-size: 22px; color: var(--primary); }
.top button { color: var(--primary); font-size: 24px; }
.canvas { padding: 24px var(--pad) 40px; max-width: 720px; margin: 0 auto; display: grid; gap: 32px; }
.summary {
  background: var(--surface); border-radius: var(--radius-xl); padding: 24px; display: flex; align-items: center; gap: 16px;
  box-shadow: var(--whisper); border: 1px solid var(--line);
}
.avatar { width: 64px; height: 64px; border-radius: 50%; display: grid; place-items: center; background: var(--primary-container); color: #fff; font-size: 24px; font-weight: 700; }
.tags { display: flex; align-items: center; gap: 8px; margin-top: 6px; }
.tags span { padding: 2px 8px; border-radius: 999px; background: var(--gold-soft); color: #5e4200; font-size: 12px; }
.tags em { font-style: normal; color: var(--muted); }
h3 { font-size: 20px; margin-bottom: 16px; }
.medals { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
.medals > div { text-align: center; background: var(--surface); border-radius: 8px; padding: 12px 8px; box-shadow: var(--whisper); border: 1px solid var(--line); }
.badge { width: 64px; height: 64px; margin: 0 auto 8px; border-radius: 50%; display: grid; place-items: center; background: rgba(145, 0, 24, 0.1); color: var(--primary); font-size: 32px; }
.medals span { font-size: 12px; }
.locked { background: transparent; box-shadow: none; }
.locked .badge { background: transparent; border: 1px dashed var(--line); color: var(--line); }
.locked span { color: var(--muted); opacity: 0.7; }
.timeline { position: relative; padding-left: 24px; border-left: 1px solid var(--line); margin-left: 8px; display: grid; gap: 24px; }
.timeline article {
  background: var(--surface); border-radius: var(--radius-xl); padding: 16px; box-shadow: var(--whisper);
  border: 1px solid var(--line); margin-left: 16px; position: relative;
}
.timeline article::before {
  content: ""; position: absolute; left: -33px; top: 18px; width: 10px; height: 10px; border-radius: 50%;
  background: var(--primary); border: 2px solid #fff;
}
.timeline p { margin-top: 6px; color: var(--muted); font-size: 14px; }
</style>
