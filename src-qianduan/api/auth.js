import request from './request'

export async function login(username, password) {
  const response = await request.post('/auth/login', { username, password })
  if (response.data.code !== 0) throw new Error(response.data.message || '登录失败')
  return response.data.data
}
