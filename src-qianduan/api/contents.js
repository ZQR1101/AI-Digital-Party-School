import request from './request'

export async function listPublicContents(params = {}) {
  const response = await request.get('/contents', { params: { page: 1, pageSize: 30, ...params } })
  if (response.data.code !== 0) throw new Error(response.data.message || '课程列表加载失败')
  return response.data.data
}

export async function getPublicContent(id) {
  const response = await request.get(`/contents/${id}`)
  if (response.data.code !== 0) throw new Error(response.data.message || '学习内容加载失败')
  return response.data.data
}
