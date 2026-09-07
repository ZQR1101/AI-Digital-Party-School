<script setup>
import { ref, watch } from 'vue'
import {
  Bell,
  DataAnalysis,
  Document,
  Files,
  MagicStick,
  Menu as MenuIcon,
  OfficeBuilding,
  Search,
  Setting,
  SwitchButton,
  Tickets,
  User,
} from '@element-plus/icons-vue'
import { useRoute, useRouter } from 'vue-router'

const route = useRoute()
const router = useRouter()
const sidebarOpen = ref(false)
const searchKeyword = ref('')

const menus = [
  { path: '/dashboard', label: '数据总览', icon: DataAnalysis },
  { path: '/organizations', label: '组织架构', icon: OfficeBuilding },
  { path: '/users', label: '人员管理', icon: User },
  { path: '/contents', label: '学习内容', icon: Document },
  { path: '/tasks', label: '学习任务', icon: Tickets },
  { path: '/questions', label: '题库与试卷', icon: Files },
  { path: '/ai-query', label: 'AI 数据查询', icon: MagicStick },
]

watch(
  () => route.path,
  () => {
    sidebarOpen.value = false
  },
)

function logout() {
  localStorage.removeItem('adminToken')
  router.replace('/login')
}
</script>

<template>
  <el-container class="admin-shell">
    <button
      v-if="sidebarOpen"
      class="sidebar-mask"
      aria-label="关闭导航菜单"
      @click="sidebarOpen = false"
    />

    <el-aside class="sidebar" :class="{ 'is-open': sidebarOpen }" width="232px">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true">
          <el-icon><OfficeBuilding /></el-icon>
        </span>
        <div class="brand-copy">
          <strong>数智党校</strong>
          <small>管理工作台</small>
        </div>
      </div>

      <div class="nav-caption">工作台</div>
      <el-menu :default-active="route.path" router class="nav-menu">
        <el-menu-item v-for="item in menus" :key="item.path" :index="item.path">
          <el-icon><component :is="item.icon" /></el-icon>
          <span>{{ item.label }}</span>
        </el-menu-item>
      </el-menu>

      <div class="sidebar-account">
        <span class="sidebar-avatar">管</span>
        <div>
          <strong>系统管理员</strong>
          <small>超级管理员</small>
        </div>
        <el-button text circle :icon="Setting" aria-label="系统设置" />
      </div>
    </el-aside>

    <el-container class="shell-main">
      <el-header class="topbar">
        <div class="topbar-leading">
          <el-button
            class="mobile-nav-trigger"
            text
            circle
            :icon="MenuIcon"
            aria-label="打开导航菜单"
            @click="sidebarOpen = true"
          />
          <div class="topbar-context">
            <small>管理后台</small>
            <strong>{{ route.meta.title }}</strong>
          </div>
          <el-input
            v-model="searchKeyword"
            class="global-search"
            :prefix-icon="Search"
            clearable
            placeholder="搜索功能、人员或学习内容…"
          />
        </div>

        <div class="account">
          <el-badge is-dot class="notice-badge">
            <el-button text circle :icon="Bell" aria-label="消息通知" />
          </el-badge>
          <span class="topbar-divider" />
          <span class="account-avatar">管</span>
          <div class="account-copy">
            <strong>系统管理员</strong>
            <small>admin</small>
          </div>
          <el-button class="logout-button" text :icon="SwitchButton" @click="logout">
            <span>退出</span>
          </el-button>
        </div>
      </el-header>

      <el-main class="page-wrap">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>
