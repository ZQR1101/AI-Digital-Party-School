import request from './request'

// 知识库问答：RAG 混合检索 + 来源引用
export async function askKnowledge(question) {
  const response = await request.post('/ai/knowledge/ask', { question })
  if (response.data.code !== 0) throw new Error(response.data.message || '问答失败')
  return response.data.data
}

// 个性化学习问答：学习画像 + RAG 联动
export async function askPersonalized(question) {
  const response = await request.post('/ai/knowledge/personalized', { question })
  if (response.data.code !== 0) throw new Error(response.data.message || '个性化问答失败')
  return response.data.data
}

// 知识检索：仅返回命中片段
export async function searchKnowledge(query, topK = 5) {
  const response = await request.get('/ai/knowledge/search', { params: { q: query, topK } })
  if (response.data.code !== 0) throw new Error(response.data.message || '检索失败')
  return response.data.data
}
