<template>
  <div class="page-shell">
    <section class="greet">
      <div>
        <h2>{{ greeting }}，{{ userName }}</h2>
        <p>今天也要保持学习</p>
      </div>
      <div class="greet-side">
        <button class="icon-btn" type="button" aria-label="通知">
          <Icon name="notifications" />
          <i></i>
        </button>
        <div class="avatar">{{ userName.slice(0, 1) }}</div>
      </div>
    </section>

    <main class="canvas">
      <section class="bento">
        <div>
          <Icon name="fire" />
          <p>连续学习</p>
          <strong class="stat-num">12<span>天</span></strong>
        </div>
        <div @click="router.push('/achievements')">
          <Icon name="medal" />
          <p>获得证书</p>
          <strong class="stat-num">3<span>本</span></strong>
        </div>
      </section>

      <section>
        <div class="section-head">
          <h3>学习足迹</h3>
          <button type="button" @click="router.push('/record')">查看全部</button>
        </div>
        <div class="log">
          <article v-for="item in footprints" :key="item.id">
            <div :class="['mark', item.kind]"><Icon :name="item.icon" /></div>
            <div>
              <h4>{{ item.title }}</h4>
              <p>{{ item.detail }}</p>
              <div v-if="item.progress" class="bar"><i :style="{ width: `${item.progress}%` }"></i></div>
            </div>
          </article>
        </div>
      </section>

      <section class="menu">
        <button type="button" @click="router.push('/achievements')"><span><Icon name="medal" /> 成就墙</span><Icon name="chevron_right" /></button>
        <button type="button" @click="router.push('/ai-assistant')"><span><Icon name="smart_toy" /> AI 助教</span><Icon name="chevron_right" /></button>
        <button type="button"><span><Icon name="settings" /> 系统设置</span><Icon name="chevron_right" /></button>
        <button type="button"><span><Icon name="help" /> 帮助中心</span><Icon name="chevron_right" /></button>
        <button class="logout" type="button" @click="logout"><span>退出登录</span></button>
      </section>
    </main>

    <BottomNav active="mine" />
  </div>
</template>

<script setup>
import { useRouter } from 'vue-router'
import BottomNav from './components/BottomNav.vue'
import Icon from './components/Icon.vue'

const router = useRouter()
const storedUser = JSON.parse(localStorage.getItem('mobileUser') || '{}')
const userName = storedUser.realName || storedUser.username || localStorage.getItem('username') || '学员'
const hour = new Date().getHours()
const greeting = hour < 12 ? '上午好' : hour < 18 ? '下午好' : '晚上好'
const footprints = [
  { id: 1, kind: 'video', icon: 'play_circle', title: '习近平新时代中国特色社会主义思想专题讲座', detail: '视频课程 · 已完成 85%', progress: 85 },
  { id: 2, kind: 'doc', icon: 'article', title: '关于全面深化改革的若干重大问题的决定', detail: '理论文献 · 昨晚 20:30 阅读' },
  { id: 3, kind: 'exam', icon: 'quiz', title: '第一季度党规党纪知识阶段性测试', detail: '在线考试 · 得分: 95' },
]

function logout() {
  localStorage.removeItem('mobileToken')
  localStorage.removeItem('mobileUser')
  localStorage.removeItem('username')
  router.replace('/login')
}
</script>

<style scoped>
.greet { padding: 32px var(--pad) 16px; display: flex; justify-content: space-between; align-items: center; position: sticky; top: 0; background: var(--bg); z-index: 8; }
.greet h2 { font-size: 30px; line-height: 38px; font-weight: 700; letter-spacing: -0.02em; }
.greet p { margin-top: 4px; color: var(--muted); }
.greet-side { display: flex; align-items: center; gap: 16px; }
.icon-btn { position: relative; color: var(--muted); font-size: 24px; }
.icon-btn i { position: absolute; top: 0; right: 1px; width: 8px; height: 8px; border-radius: 50%; background: var(--primary); }
.avatar { width: 48px; height: 48px; border-radius: 50%; display: grid; place-items: center; background: var(--primary-container); color: #fff; font-weight: 700; box-shadow: var(--whisper); }
.canvas { padding: 8px var(--pad) 32px; max-width: 720px; margin: 0 auto; display: grid; gap: 32px; }
.bento { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.bento div {
  background: var(--surface); border-radius: var(--radius-xl); padding: 16px; min-height: 128px;
  box-shadow: var(--whisper); border: 1px solid var(--surface-highest); display: flex; flex-direction: column;
}
.bento :deep(.app-icon) { font-size: 24px; color: var(--tertiary); margin-bottom: 8px; }
.bento div:last-child :deep(.app-icon) { color: var(--primary); }
.bento p { color: var(--muted); font-size: 13px; }
.bento strong { margin-top: auto; font-size: 22px; }
.bento span { margin-left: 4px; font-size: 15px; font-weight: 400; color: var(--muted); }
.section-head { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 16px; }
.section-head h3 { font-size: 20px; }
.section-head button { color: var(--primary); font-size: 13px; }
.log { background: var(--surface); border-radius: var(--radius-xl); box-shadow: var(--whisper); border: 1px solid var(--surface-highest); }
.log article { display: flex; gap: 16px; padding: 16px; border-top: 1px solid var(--surface-highest); }
.log article:first-child { border-top: 0; }
.mark { width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center; flex: none; }
.mark.video { background: rgba(145, 0, 24, 0.1); color: var(--primary); }
.mark.doc { background: rgba(123, 87, 0, 0.1); color: var(--tertiary); }
.mark.exam { background: rgba(142, 112, 110, 0.18); color: var(--outline); }
.log h4 { font-size: 17px; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; overflow: hidden; }
.log p { margin-top: 4px; color: var(--muted); }
.bar { margin-top: 12px; height: 6px; background: var(--surface-highest); border-radius: 99px; overflow: hidden; }
.bar i { display: block; height: 100%; background: var(--primary); }
.menu { background: var(--surface); border-radius: var(--radius-xl); box-shadow: var(--whisper); border: 1px solid var(--surface-highest); overflow: hidden; }
.menu button { width: 100%; padding: 16px; display: flex; justify-content: space-between; align-items: center; text-align: left; border-top: 1px solid var(--surface-highest); color: var(--muted); }
.menu button:first-child { border-top: 0; }
.menu span { display: flex; align-items: center; gap: 16px; color: var(--ink); font-size: 17px; }
.logout span { color: var(--primary); }
</style>
