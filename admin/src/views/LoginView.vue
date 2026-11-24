<script setup>
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import request from '@/api/request'
import {
  DataAnalysis,
  InfoFilled,
  Lock,
  MagicStick,
  OfficeBuilding,
  User,
} from '@element-plus/icons-vue'

const router = useRouter()
const loading = ref(false)
const remember = ref(true)
const form = reactive({ username: 'admin', password: 'admin123' })

async function login() {
  loading.value = true
  try {
    const data = await request.post('/auth/login', form)
    if (!['admin', 'secretary'].includes(data.user?.role)) throw new Error('当前账号没有管理后台权限')
    localStorage.setItem('adminToken', data.token)
    localStorage.setItem('adminUser', JSON.stringify(data.user))
    await router.replace('/dashboard')
  } catch (error) {
    localStorage.removeItem('adminToken')
    ElMessage.error(error.message || '登录失败')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <main class="login-page">
    <span class="login-orb login-orb-one" />
    <span class="login-orb login-orb-two" />

    <section class="login-shell">
      <div class="login-hero">
        <div class="login-brand">
          <span class="login-brand-mark"><el-icon><OfficeBuilding /></el-icon></span>
          <div><strong>数智党校</strong><small>AI 党员学习管理平台</small></div>
        </div>

        <div class="login-hero-content">
          <span class="hero-badge"><i /> 数字赋能 · 智慧党建</span>
          <h1>让党员教育管理<br />更精准、更高效</h1>
          <p>连接组织、内容、任务与学习数据，为党员教育提供全流程数字化支撑。</p>

          <div class="hero-features">
            <div>
              <span><el-icon><OfficeBuilding /></el-icon></span>
              <p><strong>组织一体化</strong><small>多级组织统一管理</small></p>
            </div>
            <div>
              <span><el-icon><DataAnalysis /></el-icon></span>
              <p><strong>过程可视化</strong><small>学习成效实时掌握</small></p>
            </div>
            <div>
              <span><el-icon><MagicStick /></el-icon></span>
              <p><strong>AI 智能分析</strong><small>数据辅助科学决策</small></p>
            </div>
          </div>
        </div>

        <div class="login-hero-footer">
          <span>AI-POWERED PARTY SCHOOL</span>
          <span>安全 · 稳定 · 高效</span>
        </div>
      </div>

      <div class="login-panel">
        <div class="login-panel-inner">
          <div class="login-security"><el-icon><Lock /></el-icon> 安全管理入口</div>
          <div class="login-title">
            <span class="login-logo"><el-icon><OfficeBuilding /></el-icon></span>
            <h2>欢迎登录</h2>
            <p>请输入管理员账号进入数智党校管理工作台</p>
          </div>

          <el-form :model="form" label-position="top" size="large" @submit.prevent="login">
            <el-form-item label="管理员账号">
              <el-input
                v-model="form.username"
                :prefix-icon="User"
                placeholder="请输入账号"
                autocomplete="username"
                data-testid="admin-username"
              />
            </el-form-item>
            <el-form-item label="登录密码">
              <el-input
                v-model="form.password"
                :prefix-icon="Lock"
                type="password"
                show-password
                placeholder="请输入密码"
                autocomplete="current-password"
                data-testid="admin-password"
              />
            </el-form-item>
            <div class="login-options">
              <el-checkbox v-model="remember">记住登录状态</el-checkbox>
              <span>账号由管理员统一分配</span>
            </div>
            <el-button native-type="submit" type="primary" :loading="loading" class="login-button" data-testid="admin-login-submit">
              登录管理后台
            </el-button>
          </el-form>

          <div class="login-demo-tip">
            <el-icon><InfoFilled /></el-icon>
            <span><strong>演示模式</strong> 当前使用 Mock 登录，后续接入 /api/auth/login</span>
          </div>
        </div>
        <p class="login-copyright">© 2026 数智党校 · 党员学习管理系统</p>
      </div>
    </section>
  </main>
</template>
