import { createRouter, createWebHashHistory } from 'vue-router'
import HomePage from '../Home-index.vue'
import LoginPage from '../Login-index.vue'
import ExamListPage from '../ExamList-index.vue'
import ExamPage from '../Exam-index.vue'
import RecordPage from '../Record-index.vue'
import LearnPage from '../Learn-index.vue'
import TaskPage from '../Task-index.vue'
import CatalogPage from '../Catalog-index.vue'
import TaskListPage from '../TaskList-index.vue'
import MinePage from '../Mine-index.vue'
import AchievePage from '../Achieve-index.vue'
import AiAssistantPage from '../AiAssistant-index.vue'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/home' },
    { path: '/login', name: 'login', component: LoginPage, meta: { public: true } },
    { path: '/home', name: 'home', component: HomePage },
    { path: '/learn', name: 'catalog', component: CatalogPage },
    { path: '/learn/:id', name: 'learn', component: LearnPage },
    { path: '/tasks', name: 'tasks', component: TaskListPage },
    { path: '/task/:id', name: 'task', component: TaskPage },
    { path: '/exam', name: 'exam', component: ExamListPage },
    { path: '/exam/take', name: 'exam-take', component: ExamPage },
    { path: '/mine', name: 'mine', component: MinePage },
    { path: '/record', name: 'record', component: RecordPage },
    { path: '/achievements', name: 'achievements', component: AchievePage },
    { path: '/ai-assistant', name: 'ai-assistant', component: AiAssistantPage },
    { path: '/:pathMatch(.*)*', redirect: '/home' },
  ],
})

router.beforeEach((to) => {
  const token = localStorage.getItem('mobileToken')
  if (!to.meta.public && !token) return '/login'
  if (to.path === '/login' && token) return '/home'
})

export default router
