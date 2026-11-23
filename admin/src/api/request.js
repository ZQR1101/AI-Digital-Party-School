import axios from 'axios'

const request = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
  timeout: 10000,
})

request.interceptors.request.use((config) => {
  const token = localStorage.getItem('adminToken')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

request.interceptors.response.use(
  (response) => {
    const result = response.data
    if (result?.code !== 0) return Promise.reject(new Error(result?.message || '请求失败'))
    return result.data
  },
  (error) => {
    const status = error.response?.status
    const message = error.response?.data?.message
    // 401 = 未登录/Token 过期；403 且提示停用 = 账号已被停用或删除，均需清除本地登录态。
    // 其余 403 属于权限不足（角色越权），保留在当前页面仅提示错误。
    const sessionInvalid = status === 401 || (status === 403 && /停用|不存在/.test(message || ''))
    if (sessionInvalid) {
      localStorage.removeItem('adminToken')
      localStorage.removeItem('adminUser')
      if (window.location.pathname !== '/login') window.location.assign('/login')
    }
    const finalMessage = message || error.message || '请求失败'
    return Promise.reject(new Error(finalMessage))
  },
)

export default request
