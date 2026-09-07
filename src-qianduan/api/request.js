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
    if (error.response?.status === 401) {
      localStorage.removeItem('mobileToken')
      localStorage.removeItem('mobileUser')
      if (!window.location.hash.includes('/login')) window.location.hash = '#/login'
    }
    const message = error.response?.data?.message
      || (error.code === 'ECONNABORTED' ? '请求超时，请稍后重试'
        : (error.code === 'ERR_NETWORK' || error.message === 'Network Error'
          ? '无法连接服务器，请确认后端已启动'
          : '网络异常，请稍后重试'))
    return Promise.reject(new Error(message))
  }
)

export default request
