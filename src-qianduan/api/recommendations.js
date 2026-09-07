import request from './request'

export async function getMyRecommendations(limit = 6) {
  const response = await request.get('/ai/recommendations/me', { params: { limit } })
  if (response.data.code !== 0) throw new Error(response.data.message || '获取推荐失败')
  return response.data.data
}

export async function sendRecommendationFeedback(contentId, action) {
  const response = await request.post(`/ai/recommendations/${contentId}/feedback`, { action })
  if (response.data.code !== 0) throw new Error(response.data.message || '操作失败')
  return response.data.data
}
