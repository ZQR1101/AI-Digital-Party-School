function repairJson(text) {
  let value = String(text || '').replace(/,\s*([}\]])/g, '$1');
  const stack = [];
  let inString = false;
  let escaped = false;
  for (const char of value) {
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') stack.push('}');
    else if (char === '[') stack.push(']');
    else if ((char === '}' || char === ']') && stack[stack.length - 1] === char) stack.pop();
  }
  if (inString) value += '"';
  while (stack.length) value += stack.pop();
  return value.replace(/,\s*([}\]])/g, '$1');
}

function extractJson(text) {
  const raw = String(text || '').replace(/```json|```/gi, '').trim();
  const start = raw.search(/[{[]/);
  if (start < 0) throw new Error('AI返回内容不是JSON');
  const sliced = raw.slice(start);
  const attempts = [sliced, repairJson(sliced)];
  const block = sliced.match(/\{[\s\S]*\}/);
  if (block) attempts.push(block[0], repairJson(block[0]));
  let lastError = null;
  for (const attempt of attempts) {
    try {
      return JSON.parse(attempt);
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(lastError?.message ? `AI返回内容不是JSON: ${lastError.message}` : 'AI返回内容不是JSON');
}

function containsUnexpectedNumber(value, allowedNumbers) {
  const numbers = JSON.stringify(value).match(/\d+(?:\.\d+)?/g) || [];
  return numbers.some(number => !allowedNumbers.has(String(Number(number))));
}

function collectNumbers(value) {
  return new Set((JSON.stringify(value).match(/\d+(?:\.\d+)?/g) || []).map(number => String(Number(number))));
}

function validateRecommendationRanking(value, candidates, allowedNumbers = new Set()) {
  if (!value || !Array.isArray(value.recommendations)) throw new Error('AI推荐结果缺少recommendations数组');
  const candidateIds = new Set(candidates.map(item => Number(item.contentId)));
  const seen = new Set();
  const valid = [];
  let lastError = null;
  for (const item of value.recommendations) {
    try {
      const contentId = Number(item.contentId);
      const semanticScore = Number(item.semanticScore);
      if (!candidateIds.has(contentId)) throw new Error(`AI返回了候选集之外的内容ID: ${contentId}`);
      if (seen.has(contentId)) continue;
      if (!Number.isFinite(semanticScore) || semanticScore < 0 || semanticScore > 100) {
        throw new Error(`AI推荐语义分无效: ${item.semanticScore}`);
      }
      seen.add(contentId);
      const reason = String(item.reason || '').trim().slice(0, 120) || '结合你的学习情况推荐此内容';
      const matchedEvidence = Array.isArray(item.matchedEvidence)
        ? item.matchedEvidence.map(text => String(text).trim().slice(0, 60)).filter(Boolean).slice(0, 3)
        : [];
      const evidence = containsUnexpectedNumber({ reason, matchedEvidence }, allowedNumbers)
        ? { reason, matchedEvidence: [] }
        : { reason, matchedEvidence };
      if (containsUnexpectedNumber({ reason: evidence.reason }, allowedNumbers)) {
        evidence.reason = '结合你的学习情况推荐此内容';
      }
      valid.push({ contentId, semanticScore, ...evidence });
    } catch (error) {
      lastError = error;
    }
  }
  if (!valid.length) throw lastError || new Error('AI推荐结果缺少recommendations数组');
  return valid;
}

class AIClient {
  static isConfigured() {
    return Boolean(process.env.AI_API_KEY && process.env.AI_API_URL);
  }

  static async generateEvaluationNarrative(payload) {
    if (!this.isConfigured()) return null;
    // 延迟加载，未配置大模型时规则报告不依赖HTTP客户端初始化。
    const axios = require('axios');
    const allowedNumbers = new Set([
      payload.score,
      payload.completionRate,
      payload.totalStudyHours,
      payload.totalExams,
      payload.avgScore,
      payload.maxScore,
      ...Object.values(payload.dimensions || {})
    ].map(value => String(Number(value))));
    const response = await axios.post(
      process.env.AI_API_URL,
      {
        model: process.env.AI_MODEL || 'deepseek-chat',
        temperature: 0.2,
        max_tokens: 700,
        messages: [
          {
            role: 'system',
            content: '你是党员学习辅助分析助手。只能依据输入事实，不得自行打分、添加数字、排名或政治定性。返回严格JSON，不使用Markdown。'
          },
          {
            role: 'user',
            content: `请生成学习辅助报告。固定分数和等级不得修改。返回格式：{"summary":"不超过60字","strengths":["..."],"weaknesses":["..."],"suggestions":[{"title":"...","content":"...","knowledgePoint":"..."}]}。输入：${JSON.stringify(payload)}`
          }
        ]
      },
      {
        headers: { Authorization: `Bearer ${process.env.AI_API_KEY}`, 'Content-Type': 'application/json' },
        timeout: Number(process.env.AI_TIMEOUT_MS || 15000)
      }
    );
    const narrative = extractJson(response.data?.choices?.[0]?.message?.content);
    if (containsUnexpectedNumber(narrative, allowedNumbers)) {
      throw new Error('AI评语包含输入事实之外的数字');
    }
    return narrative;
  }

  static async rankLearningContents(profile, candidates) {
    if (!this.isConfigured() || !candidates.length) return null;
    const axios = require('axios');
    const safeProfile = {
      recentLearning: (profile.learningHistory || []).slice(0, 10).map(item => ({
        title: item.title,
        tags: item.tags,
        status: item.status
      })),
      recentWrongQuestions: (profile.recentWrongQuestions || []).slice(0, 10).map(item => ({
        title: item.title,
        category: item.category,
        analysis: item.analysis
      })),
      weakKnowledgePoints: (profile.weakCategories || []).slice(0, 8)
    };
    const safeCandidates = candidates.map(item => ({
      contentId: item.contentId,
      title: item.title,
      contentType: item.contentType,
      summary: item.summary,
      tags: item.tags
    }));
    const input = { profile: safeProfile, candidates: safeCandidates };
    const response = await axios.post(
      process.env.AI_API_URL,
      {
        model: process.env.AI_MODEL || 'deepseek-chat',
        temperature: 0.1,
        max_tokens: 2200,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: '你是党员学习内容推荐排序引擎。只能从输入候选内容中选择，不得创造内容或事实。结合学习历史、近期错题和薄弱知识点理解语义相关性。返回严格JSON，不使用Markdown。推荐理由不得写输入中不存在的数字、排名或政治定性。'
          },
          {
            role: 'user',
            content: `请对候选公共学习内容进行语义排序。只返回一个JSON对象，不要Markdown。格式：{"recommendations":[{"contentId":1,"semanticScore":80,"matchedEvidence":["学习历史或错题中的原词"],"reason":"不超过40字"}]}。contentId必须来自候选，按相关度降序，最多返回12条。输入：${JSON.stringify(input)}`
          }
        ]
      },
      {
        headers: { Authorization: `Bearer ${process.env.AI_API_KEY}`, 'Content-Type': 'application/json' },
        // 首页推荐是同步等待路径：deepseek 推理模型响应慢，超时过长会拖垮首页加载。
        // 超时后自动降级规则推荐，4s 足够保留"AI 偶尔成功"的能力。
        timeout: Math.min(Number(process.env.AI_TIMEOUT_MS || 8000), 4000)
      }
    );
    const ranking = extractJson(response.data?.choices?.[0]?.message?.content);
    return validateRecommendationRanking(ranking, safeCandidates, collectNumbers(input));
  }
}

module.exports = {
  AIClient,
  extractJson,
  containsUnexpectedNumber,
  collectNumbers,
  validateRecommendationRanking
};
