import request from './request'

export async function getMyLearningReport() {
  const response = await request.get('/ai/report/me')
  if (response.data.code !== 0) throw new Error(response.data.message || '学习报告加载失败')
  return response.data.data
}

export async function getHomeSummary() {
  const response = await request.get('/reports/summary')
  if (response.data.code !== 0) throw new Error(response.data.message || '学习统计加载失败')
  return response.data.data
}
