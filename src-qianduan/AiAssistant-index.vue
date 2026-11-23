<template>
  <div class="page-shell">
    <header class="assistant-head">
      <div class="head-top">
        <div>
          <h1>AI 助教</h1>
          <p>基于党校知识库的智能问答 · 学有所依，问有所据</p>
        </div>
        <div class="bot-avatar"><Icon name="smart_toy" /></div>
      </div>
      <div class="mode-switch">
        <button :class="{ on: mode === 'knowledge' }" type="button" @click="switchMode('knowledge')">
          <Icon name="menu_book" /> 知识问答
        </button>
        <button :class="{ on: mode === 'personal' }" type="button" @click="switchMode('personal')">
          <Icon name="insights" /> 我的学习诊断
        </button>
      </div>
    </header>

    <main class="chat-canvas">
      <!-- 欢迎/引导 -->
      <section v-if="messages.length === 0" class="welcome">
        <div class="welcome-icon"><Icon name="smart_toy" /></div>
        <h2>{{ mode === 'knowledge' ? '党务知识，随时问我' : '看看你的学习短板' }}</h2>
        <p v-if="mode === 'knowledge'">我会从党校知识库中检索资料，并附上来源，让每个答案都有据可查。</p>
        <p v-else>我会结合你的学习画像，找出薄弱知识点，推荐针对性学习材料。</p>
        <div class="quick-questions">
          <button v-for="q in currentQuickQuestions" :key="q" type="button" @click="send(q)">{{ q }}</button>
        </div>
      </section>

      <!-- 对话消息 -->
      <section v-for="msg in messages" :key="msg.id" :class="['msg', msg.role]">
        <div class="msg-avatar">
          <Icon :name="msg.role === 'user' ? 'person' : 'smart_toy'" />
        </div>
        <div class="msg-body">
          <div class="bubble">{{ msg.text }}</div>

          <!-- 来源引用 -->
          <div v-if="msg.sources && msg.sources.length" class="sources">
            <div class="sources-title"><Icon name="link" /> 参考资料来源</div>
            <div v-for="s in msg.sources" :key="s.id" class="source-item">
              <span class="source-badge">[{{ s.id }}]</span>
              <div>
                <strong>{{ s.title }}</strong>
                <p>{{ s.excerpt }}</p>
                <small>《{{ s.source }}》 · 相关度 {{ Math.round((s.relevanceScore || 0) * 100) }}%</small>
              </div>
            </div>
          </div>

          <!-- 学习建议 -->
          <div v-if="msg.suggestions && msg.suggestions.length" class="suggestions">
            <div class="sources-title"><Icon name="lightbulb" /> 学习建议</div>
            <div v-for="(s, i) in msg.suggestions" :key="i" class="suggest-item">
              <strong>{{ s.title }}</strong>
              <p>{{ s.content }}</p>
            </div>
          </div>

          <div v-if="msg.profileSummary" class="profile-chip">
            <Icon name="insights" /> {{ msg.profileSummary.userName }} · 完成率 {{ msg.profileSummary.completionRate }}%
          </div>
        </div>
      </section>

      <!-- 加载中 -->
      <section v-if="loading" class="msg assistant">
        <div class="msg-avatar"><Icon name="smart_toy" /></div>
        <div class="msg-body">
          <div class="bubble typing"><i></i><i></i><i></i></div>
        </div>
      </section>
    </main>

    <!-- 输入区 -->
    <div class="composer">
      <textarea
        v-model="draft"
        :placeholder="mode === 'knowledge' ? '输入党务学习问题…' : '例如：我最近哪些知识点掌握得不好？'"
        rows="1"
        @keydown.enter.exact.prevent="send()"
      ></textarea>
      <button type="button" :disabled="loading || !draft.trim()" @click="send()">
        <Icon name="send" />
      </button>
    </div>

    <BottomNav active="mine" />
  </div>
</template>

<script setup>
import { ref, computed, nextTick } from 'vue'
import BottomNav from './components/BottomNav.vue'
import Icon from './components/Icon.vue'
import { askKnowledge, askPersonalized } from './api/aiAssistant'

const mode = ref('knowledge')
const draft = ref('')
const loading = ref(false)
const messages = ref([])
let seq = 0

const quickQuestions = {
  knowledge: [
    '组织生活会和民主生活会有什么区别？',
    '预备党员有没有党龄？',
    '党费交纳标准是什么？'
  ],
  personal: [
    '我最近哪些知识点掌握得不好？',
    '我应该重点学习什么？'
  ]
}

const currentQuickQuestions = computed(() => quickQuestions[mode.value] || [])

function switchMode(next) {
  if (mode.value === next) return
  mode.value = next
  messages.value = []
  draft.value = ''
}

async function send(preset) {
  const question = (preset || draft.value).trim()
  if (!question || loading.value) return
  draft.value = ''
  messages.value.push({ id: ++seq, role: 'user', text: question })
  loading.value = true
  await scrollBottom()

  try {
    const data = mode.value === 'personal'
      ? await askPersonalized(question)
      : await askKnowledge(question)
    messages.value.push({
      id: ++seq,
      role: 'assistant',
      text: data.answer || '（暂无回答）',
      sources: data.sources || [],
      suggestions: data.suggestions || [],
      profileSummary: data.profileSummary || null
    })
  } catch (err) {
    messages.value.push({
      id: ++seq,
      role: 'assistant',
      text: '服务暂时不可用：' + (err.message || '请稍后重试')
    })
  } finally {
    loading.value = false
    await scrollBottom()
  }
}

async function scrollBottom() {
  await nextTick()
  const canvas = document.querySelector('.chat-canvas')
  if (canvas) canvas.scrollTop = canvas.scrollHeight
}
</script>

<style scoped>
.page-shell { min-height: 100vh; background: var(--bg); padding-bottom: calc(var(--nav-h) + 24px); }
.assistant-head { padding: 28px var(--pad) 0; position: sticky; top: 0; background: var(--bg); z-index: 8; }
.head-top { display: flex; justify-content: space-between; align-items: center; }
.head-top h1 { font-size: 30px; font-weight: 700; letter-spacing: -0.02em; }
.head-top p { margin-top: 4px; color: var(--muted); font-size: 14px; }
.bot-avatar { width: 48px; height: 48px; border-radius: 16px; display: grid; place-items: center; background: var(--primary); color: #fff; font-size: 26px; box-shadow: var(--whisper); }
.mode-switch { margin-top: 20px; display: flex; gap: 8px; background: var(--surface); padding: 5px; border-radius: 999px; border: 1px solid var(--surface-highest); }
.mode-switch button { flex: 1; padding: 10px; border-radius: 999px; display: flex; align-items: center; justify-content: center; gap: 6px; color: var(--muted); font-size: 15px; }
.mode-switch button.on { background: var(--primary); color: #fff; font-weight: 600; }
.mode-switch :deep(.app-icon) { font-size: 18px; }

.chat-canvas { padding: 20px var(--pad); max-width: 720px; margin: 0 auto; display: grid; gap: 20px; align-content: start; }
.welcome { text-align: center; padding: 32px 16px; }
.welcome-icon { width: 64px; height: 64px; margin: 0 auto 16px; border-radius: 20px; display: grid; place-items: center; background: var(--primary-container); font-size: 34px; }
.welcome h2 { font-size: 22px; }
.welcome p { margin-top: 8px; color: var(--muted); font-size: 14px; line-height: 1.6; }
.quick-questions { margin-top: 24px; display: grid; gap: 10px; }
.quick-questions button { padding: 12px 16px; background: var(--surface); border: 1px solid var(--surface-highest); border-radius: 14px; text-align: left; font-size: 14px; color: var(--ink); }
.quick-questions button:hover { border-color: var(--primary); }

.msg { display: flex; gap: 12px; align-items: flex-start; }
.msg.user { flex-direction: row-reverse; }
.msg-avatar { width: 36px; height: 36px; border-radius: 12px; flex: none; display: grid; place-items: center; background: var(--surface-highest); font-size: 20px; }
.msg.assistant .msg-avatar { background: var(--primary); color: #fff; }
.msg-body { max-width: 78%; }
.bubble { padding: 12px 16px; border-radius: 16px 16px 16px 4px; background: var(--surface); border: 1px solid var(--surface-highest); line-height: 1.7; font-size: 15px; white-space: pre-wrap; }
.msg.user .bubble { background: var(--primary); color: #fff; border: 0; border-radius: 16px 16px 4px 16px; }
.typing { display: flex; gap: 5px; }
.typing i { width: 7px; height: 7px; border-radius: 50%; background: var(--muted); animation: blink 1.2s infinite; }
.typing i:nth-child(2) { animation-delay: .2s; }
.typing i:nth-child(3) { animation-delay: .4s; }
@keyframes blink { 0%, 60%, 100% { opacity: .3; } 30% { opacity: 1; } }

.sources, .suggestions { margin-top: 12px; background: var(--surface); border: 1px solid var(--surface-highest); border-radius: 14px; padding: 12px; }
.sources-title { display: flex; align-items: center; gap: 6px; color: var(--primary); font-size: 13px; font-weight: 600; margin-bottom: 10px; }
.source-item { display: flex; gap: 8px; padding: 8px 0; border-top: 1px solid var(--surface-highest); }
.source-badge { color: var(--primary); font-weight: 700; flex: none; }
.source-item strong { font-size: 14px; }
.source-item p { margin: 4px 0; font-size: 13px; color: var(--muted); line-height: 1.5; }
.source-item small { color: var(--tertiary); font-size: 11px; }
.suggest-item { padding: 8px 0; border-top: 1px solid var(--surface-highest); }
.suggest-item strong { font-size: 14px; }
.suggest-item p { margin-top: 4px; font-size: 13px; color: var(--muted); }
.profile-chip { margin-top: 10px; display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 999px; background: var(--primary-container); font-size: 12px; }

.composer { position: fixed; z-index: 20; bottom: calc(var(--nav-h) + env(safe-area-inset-bottom)); left: 0; right: 0; max-width: var(--app-width); margin: 0 auto; padding: 10px var(--pad); display: flex; gap: 10px; background: var(--bg); }
.composer textarea { flex: 1; resize: none; padding: 12px 16px; border-radius: 20px; border: 1px solid var(--surface-highest); background: var(--surface); font-size: 15px; line-height: 1.4; max-height: 96px; }
.composer button { width: 44px; height: 44px; flex: none; border-radius: 50%; background: var(--primary); color: #fff; display: grid; place-items: center; font-size: 22px; }
.composer button:disabled { opacity: .4; }
</style>
