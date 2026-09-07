<template>
  <nav class="tab-bar" aria-label="主导航">
    <button
      v-for="item in items"
      :key="item.key"
      :class="{ active: item.key === active }"
      type="button"
      @click="router.push(item.to)"
    >
      <Icon :name="item.icon" :filled="item.key === active" />
      <span>{{ item.label }}</span>
    </button>
  </nav>
</template>

<script setup>
import { useRouter } from 'vue-router'
import Icon from './Icon.vue'

defineProps({
  active: { type: String, required: true },
})

const router = useRouter()
const items = [
  { key: 'home', label: '首页', icon: 'home', to: '/home' },
  { key: 'learn', label: '学习', icon: 'menu_book', to: '/learn' },
  { key: 'tasks', label: '任务', icon: 'assignment', to: '/tasks' },
  { key: 'exam', label: '考试', icon: 'quiz', to: '/exam' },
  { key: 'mine', label: '我的', icon: 'person', to: '/mine' },
]
</script>

<style scoped>
.tab-bar {
  position: fixed;
  z-index: 30;
  left: 0;
  right: 0;
  bottom: 0;
  width: auto;
  max-width: var(--app-width);
  margin: 0 auto;
  transform: none;
  height: calc(var(--nav-h) + env(safe-area-inset-bottom));
  padding: 8px 8px calc(8px + env(safe-area-inset-bottom));
  display: flex;
  justify-content: space-around;
  align-items: flex-start;
  background: var(--surface);
  border-top: 1px solid var(--line);
  box-shadow: var(--whisper);
}

button {
  width: 64px;
  display: flex;
  flex-direction: column;
  align-items: center;
  color: var(--muted);
  font-size: 11px;
  letter-spacing: 0.06em;
  font-weight: 500;
}

button :deep(.app-icon) {
  font-size: 24px;
}

button span {
  margin-top: 4px;
}

button.active {
  color: var(--primary);
  position: relative;
}

button.active::after {
  content: "";
  width: 24px;
  height: 3px;
  margin-top: 4px;
  border-radius: 999px;
  background: var(--primary);
}
</style>
