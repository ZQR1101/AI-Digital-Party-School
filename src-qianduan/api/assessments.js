import request from './request'

export async function getMyAssessments() {
  const response = await request.get('/assessments')
  if (response.data.code !== 0) throw new Error(response.data.message || '测评列表加载失败')
  return response.data.data
}

export async function getAssessment(id) {
  const response = await request.get(`/assessments/${id}`)
  if (response.data.code !== 0) throw new Error(response.data.message || '试卷加载失败')
  return response.data.data
}

export async function submitAssessment(id, answers) {
  const response = await request.post(`/assessments/${id}/submit`, { answers })
  if (response.data.code !== 0) throw new Error(response.data.message || '交卷失败')
  return response.data.data
}
