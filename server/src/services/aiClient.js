const output = require('../ai/modelOutput');
const { modelBudget, requestModel } = require('../ai/modelTransport');

class AIClient {
  static isConfigured() {
    return Boolean(process.env.AI_API_KEY && process.env.AI_API_URL);
  }

  static async generateEvaluationNarrative(input, trace = {}) {
    if (!this.isConfigured()) {
      trace.fallbackReason = 'not_configured';
      return null;
    }
    return requestModel({
      budgetMs: modelBudget(15000, 30000),
      payload: {
        model: process.env.AI_MODEL || 'deepseek-chat',
        temperature: 0.2,
        max_tokens: 900,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: '你是学习辅助分析助手。只能依据输入事实写评语。固定评分由系统计算。' },
          {
            role: 'user',
            content: `返回严格JSON。只能使用输入已有的数字，null 表示缺少样本。格式：{"summary":"不超过60字","strengths":["..."],"weaknesses":["..."],"suggestions":[{"title":"...","content":"...","knowledgePoint":null}]}。每个数组最多四项。knowledgePoint 只能填写输入薄弱知识点的 category 原名或 null。输入：${JSON.stringify(input)}`
          }
        ]
      },
      parse: content => output.validateEvaluationNarrative(output.extractJson(content), input)
    }, trace);
  }

  static async rankLearningContents(profile, candidates, trace = {}) {
    if (!candidates.length || !this.isConfigured()) {
      trace.fallbackReason = candidates.length ? 'not_configured' : 'no_candidates';
      return null;
    }
    const safeProfile = {
      recentLearning: (profile.learningHistory || []).slice(0, 10).map(({ title, tags, status }) => ({ title, tags, status })),
      weakKnowledgePoints: (profile.weakCategories || []).slice(0, 8)
    };
    const safeCandidates = candidates.map(({ contentId, title, contentType, summary, tags }) => ({
      contentId: Number(contentId), title, contentType, summary, tags
    }));
    const input = { profile: safeProfile, candidates: safeCandidates };
    const numbers = output.collectNumbers(input);
    return requestModel({
      budgetMs: modelBudget(4000, 4000),
      payload: {
        model: process.env.AI_MODEL || 'deepseek-chat',
        temperature: 0.1,
        max_tokens: 1200,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: '根据学习历史和薄弱知识点为候选公共课程排序。课程ID必须来自候选集。' },
          { role: 'user', content: `只返回严格JSON，最多12项，语义分为0至100。格式：{"recommendations":[{"contentId":1,"semanticScore":80}]}。输入：${JSON.stringify(input)}` }
        ]
      },
      parse: content => output.validateRecommendationRanking(output.extractJson(content), safeCandidates, numbers)
    }, trace);
  }
}

module.exports = { AIClient, ...output };
