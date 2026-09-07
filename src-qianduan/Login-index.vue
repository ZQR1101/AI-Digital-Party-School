<template>
  <main class="login-page">
    <section class="brand">
      <p>AI 赋能 · 智慧学习</p>
      <h1>数智党校</h1>
      <span>党员移动学习平台</span>
    </section>
    <section class="card">
      <div>
        <h2>党员登录</h2>
        <p>登录后获取专属学习内容推荐</p>
      </div>
      <form @submit.prevent="submit">
        <label>
          <span>用户名</span>
          <input v-model.trim="form.username" autocomplete="username" placeholder="请输入用户名">
        </label>
        <label>
          <span>密码</span>
          <input v-model="form.password" type="password" autocomplete="current-password" placeholder="请输入密码">
        </label>
        <button :disabled="loading">{{ loading ? '正在登录…' : '登录学习平台' }}</button>
      </form>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <p class="demo-tip">初始化演示党员：lisi / admin123</p>
    </section>
  </main>
</template>

<script setup>
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { login } from './api/auth'

const router = useRouter()
const loading = ref(false)
const error = ref('')
const form = reactive({ username: 'lisi', password: 'admin123' })

async function submit() {
  if (!form.username || !form.password) { error.value = '请输入用户名和密码'; return }
  loading.value = true
  error.value = ''
  try {
    const data = await login(form.username, form.password)
    localStorage.setItem('mobileToken', data.token)
    localStorage.setItem('mobileUser', JSON.stringify(data.user))
    localStorage.setItem('username', data.user.realName || data.user.username)
    await router.replace('/home')
  } catch (err) {
    error.value = err.message
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.login-page { min-height: 100vh; background: var(--bg); padding: 48px 20px 32px; }
.brand { text-align: left; padding: 24px 8px 32px; }
.brand p { font-size: 12px; letter-spacing: 0.18em; color: var(--muted); }
.brand h1 { margin: 10px 0 6px; font-size: 34px; letter-spacing: -0.02em; color: var(--primary); font-weight: 700; }
.brand span { color: var(--muted); font-size: 15px; }
.card {
  max-width: 440px; margin: 0 auto; padding: 26px 22px; background: var(--surface);
  border-radius: var(--radius-xl); box-shadow: var(--whisper); border: 1px solid rgba(226, 190, 188, 0.3);
}
.card h2 { font-size: 22px; }
.card > div > p { margin-top: 6px; color: var(--muted); font-size: 14px; }
form { display: grid; gap: 16px; margin-top: 24px; }
label { display: grid; gap: 7px; }
label span { font-size: 13px; color: var(--muted); }
input {
  width: 100%; height: 48px; padding: 0 14px; border: 1px solid var(--line); border-radius: 8px; outline: 0; background: var(--bg-paper);
}
input:focus { border-color: var(--primary-container); border-bottom-width: 2px; }
button { height: 48px; margin-top: 4px; border-radius: 8px; background: var(--primary-container); color: #fff; font-size: 16px; font-weight: 600; }
button:disabled { opacity: 0.55; }
.error { margin-top: 13px; color: var(--primary); font-size: 13px; }
.demo-tip { margin-top: 18px; color: var(--outline); text-align: center; font-size: 12px; }
</style>
