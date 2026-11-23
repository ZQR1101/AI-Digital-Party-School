import axios from 'axios'

const request = axios.create({
  baseURL: '/api',
  // 后端AI接口(如推荐排序)最坏等待8s+处理时间，16s曾导致首页推荐超时加载失败
  timeout: 25000
})

request.interceptors.request.use((config) => {
  const token = localStorage.getItem('mobileToken')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

request.interceptors.response.use(
  response => response,
  (error) => {
    const status = error.response?.status
    const message = error.response?.data?.message
    // 401 = 未登录/Token 过期；403 且提示停用 = 账号已被停用或删除，均需清除本地登录态
    const sessionInvalid = status === 401 || (status === 403 && /停用|不存在/.test(message || ''))
    if (sessionInvalid) {
      localStorage.removeItem('mobileToken')
      localStorage.removeItem('mobileUser')
      if (!window.location.hash.includes('/login')) window.location.hash = '#/login'
    }
    const finalMessage = message
      || (error.code === 'ECONNABORTED' ? '请求超时，请稍后重试'
        : (error.code === 'ERR_NETWORK' || error.message === 'Network Error'
          ? '无法连接服务器，请确认后端已启动'
          : '网络异常，请稍后重试'))
    return Promise.reject(new Error(finalMessage))
  }
)

export default request
