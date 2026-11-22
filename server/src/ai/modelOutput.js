const { z } = require('zod');

const text = max => z.string().trim().min(1).max(max);
const recommendationSchema = z.strictObject({
  recommendations: z.array(z.strictObject({
    contentId: z.int().positive(),
    semanticScore: z.number().min(0).max(100),
    reason: text(120).optional(),
    matchedEvidence: z.array(text(60)).max(3).optional()
  })).min(1).max(12)
});

const narrativeSchema = z.strictObject({
  summary: text(120),
  strengths: z.array(text(100)).max(4),
  weaknesses: z.array(text(100)).max(4),
  suggestions: z.array(z.strictObject({
    title: text(60),
    content: text(160),
    knowledgePoint: text(100).nullable()
  })).min(1).max(4)
});

function invalidOutput(message) {
  return Object.assign(new Error(message), { type: 'invalid_output' });
}

function extractJson(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(raw);
  try {
    return JSON.parse(match ? match[1] : raw);
  } catch {
    throw invalidOutput('AI返回内容不是完整的JSON');
  }
}

function collectNumbers(value) {
  return new Set(((JSON.stringify(value) || '').match(/\d+(?:\.\d+)?/g) || []).map(number => String(Number(number))));
}

function containsUnexpectedNumber(value, allowedNumbers) {
  return [...collectNumbers(value)].some(number => !allowedNumbers.has(number));
}

function validateRecommendationRanking(value, candidates, allowedNumbers = new Set()) {
  const parsed = recommendationSchema.safeParse(value);
  if (!parsed.success) {
    const invalidScore = parsed.error.issues.some(issue => issue.path.at(-1) === 'semanticScore');
    throw invalidOutput(invalidScore ? 'AI推荐语义分无效' : 'AI推荐结果格式无效');
  }
  const candidateIds = new Set(candidates.map(item => item.contentId));
  const seen = new Set();
  return parsed.data.recommendations.map(item => {
    if (!candidateIds.has(item.contentId)) throw invalidOutput('AI返回了候选集之外的内容ID');
    if (seen.has(item.contentId)) throw invalidOutput('AI推荐返回了重复的内容ID');
    seen.add(item.contentId);
    const reason = item.reason || '结合你的学习情况推荐此内容';
    const matchedEvidence = item.matchedEvidence || [];
    const verified = !containsUnexpectedNumber({ reason, matchedEvidence }, allowedNumbers);
    return {
      contentId: item.contentId,
      semanticScore: item.semanticScore,
      reason: verified ? reason : '结合你的学习情况推荐此内容',
      matchedEvidence: verified ? matchedEvidence : []
    };
  });
}

function validateEvaluationNarrative(value, payload) {
  const parsed = narrativeSchema.safeParse(value);
  if (!parsed.success) throw invalidOutput('AI评语格式无效');
  const topics = new Set((payload.weakKnowledgePoints || []).map(item => item.category));
  if (parsed.data.suggestions.some(item => item.knowledgePoint !== null && !topics.has(item.knowledgePoint))) {
    throw invalidOutput('AI评语引用了未知知识点');
  }
  if (containsUnexpectedNumber(parsed.data, collectNumbers(payload))) {
    throw invalidOutput('AI评语包含输入事实之外的数字');
  }
  return parsed.data;
}

module.exports = {
  extractJson,
  containsUnexpectedNumber,
  collectNumbers,
  validateEvaluationNarrative,
  validateRecommendationRanking
};
