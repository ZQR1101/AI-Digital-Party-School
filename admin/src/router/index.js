import { createRouter, createWebHistory } from 'vue-router'
import AdminLayout from '@/layout/AdminLayout.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', component: () => import('@/views/LoginView.vue'), meta: { public: true } },
    {
      path: '/',
      component: AdminLayout,
      redirect: '/dashboard',
      children: [
        { path: 'dashboard', component: () => import('@/views/DashboardView.vue'), meta: { title: '数据总览' } },
        { path: 'organizations', component: () => import('@/views/OrganizationsView.vue'), meta: { title: '组织架构' } },
        { path: 'users', component: () => import('@/views/UsersView.vue'), meta: { title: '人员管理' } },
        { path: 'contents', component: () => import('@/views/ContentsView.vue'), meta: { title: '学习内容' } },
        { path: 'contents/:id', component: () => import('@/views/ContentDetailView.vue'), meta: { title: '内容详情' } },
        { path: 'tasks', component: () => import('@/views/TasksView.vue'), meta: { title: '学习任务' } },
        { path: 'questions', component: () => import('@/views/QuestionsView.vue'), meta: { title: '题库与试卷' } },
        { path: 'ai-query', component: () => import('@/views/AiQueryView.vue'), meta: { title: 'AI 数据查询' } },
      ],
    },
  ],
})

router.beforeEach((to) => {
  if (!to.meta.public && !localStorage.getItem('adminToken')) return '/login'
  if (to.path === '/login' && localStorage.getItem('adminToken')) return '/dashboard'
})

export default router
