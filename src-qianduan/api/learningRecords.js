import request from './request'

export async function submitLearningRecord({ taskId, studySeconds, completed }) {
  const response = await request.post('/learning-records', { taskId, studySeconds, completed })
  if (response.data.code !== 0) throw new Error(response.data.message || '学习记录保存失败')
  return response.data.data
}
