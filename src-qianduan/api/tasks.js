import request from './request'

export async function getMyTasks(params = {}) {
  const response = await request.get('/tasks/my', { params: { page: 1, pageSize: 20, ...params } })
  if (response.data.code !== 0) throw new Error(response.data.message || '学习任务加载失败')
  return response.data.data
}

export async function getTaskDetail(taskId) {
  const response = await request.get(`/tasks/${taskId}`)
  if (response.data.code !== 0) throw new Error(response.data.message || '任务详情加载失败')
  return response.data.data
}
