const output = require('../ai/modelOutput');
const queryTools = require('../ai/queryTools');
const { modelBudget, requestModel } = require('../ai/modelTransport');

class AIClient {
  static isConfigured() {
    return Boolean(process.env.AI_API_KEY && process.env.AI_API_URL);
  }

  static async identifyQueryIntent(message, trace = {}) {
    if (!this.isConfigured()) {
      trace.fallbackReason = 'not_configured';
      return null;
    }
    return requestModel({
      budgetMs: modelBudget(12000, 25000),
      payload: {
        model: process.env.AI_MODEL || 'deepseek-chat',
        temperature: 0.1,
        max_tokens: 600,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `你是一个党校数据统计意图解析专家。根据用户自然语言输入，识别查询意图并调用对应的数据统计工具。
只能返回严格JSON格式：{"tool":"工具名称","parameters":{...}}。

可用工具及说明：
1. query_learning_statistics: 查询党组织学习相关统计数据（学习任务完成率、累计学习时长、活跃党员人数）及其趋势。
   参数：
   - metric: 'learning_completion_rate' | 'total_study_hours' | 'active_member_count'
   - organizationName: 组织名称字符串，若为全校或未指定组织传 null
   - timeRange: 统计周期字符串（如“今年”、“去年”、“本月”、“上个月”、“最近3个月”、“最近6个月”、“2026年”等），默认“今年”
   - groupBy: 需要月度走势、趋势或分析哪几个月较低/较高时传 "month"，否则传 null

2. query_exam_statistics: 查询测验与考试统计数据（考试平均分、及格率）。
   参数：
   - metric: 'average_exam_score' | 'exam_pass_rate'
   - organizationName: 组织名称字符串或 null
   - timeRange: 统计周期字符串
   - groupBy: "month" 或 null

3. query_organization_statistics: 查询组织架构与党员人数概况。
   参数：
   - metric: 'organization_overview' | 'member_distribution' | 'sub_organization_count'
   - organizationName: 组织名称或 null
   - timeRange: null

规则注意：当用户问及“学习情况”、“完成率怎么样”、“哪几个月完成率较低”时，应选择 query_learning_statistics 工具，metric 为 learning_completion_rate，groupBy 为 "month"。`
          },
          {
            role: 'user',
            content: `用户输入：${String(message || '').trim()}`
          }
        ]
      },
      parse: (content, msg) => queryTools.extractToolCall(content, msg)
    }, trace);
  }

  static async generateGroundedAnalysis({ question, query, result, scopeName, knowledge }, trace = {}) {
    if (!this.isConfigured() || result?.hasData === false) {
      trace.fallbackReason = !this.isConfigured() ? 'not_configured' : 'no_data';
      return null;
    }

    const facts = {
      userQuestion: question,
      scopeName,
      metricName: query.metricName,
      unit: query.unit,
      value: result.value,
      numerator: result.numerator,
      denominator: result.denominator,
      trend: result.trend || [],
      definitions: (knowledge || []).map(k => k.excerpt || k.content).slice(0, 2)
    };

    const uncompleted = (result.denominator != null && result.numerator != null)
      ? result.denominator - result.numerator
      : null;
    const uncompletedRate = result.value != null
      ? Math.round((100 - result.value) * 100) / 100
      : null;

    const allowedNumbers = output.collectNumbers({
      ...facts,
      common: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 100],
      derived: [uncompleted, uncompletedRate].filter(v => v != null)
    });

    return requestModel({
      budgetMs: modelBudget(15000, 30000),
      payload: {
        model: process.env.AI_MODEL || 'deepseek-chat',
        temperature: 0.2,
        max_tokens: 800,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `你是党校数智学习系统的数据分析专家。请根据提供的真实查询数据回答用户问题并进行客观分析。
【核心约束】：
1. 只能依据提供的真实数据进行分析，严禁捏造未在数据中出现的任何数字、月份、人次或百分比。
2. 严禁编造任何未经数据证实的外部原因（如擅自编造假期影响、期末考试复习、系统升级等外部原因），只能就数据本身的走势、高低月份差距、任务样本量进行客观说明。
3. 如果用户询问哪几个月较低或较高，必须如实指出趋势数据中具体较低的月份、数值及与整体的关系。
4. 返回严格JSON格式：{"analysis":"文字说明与分析结果"}`
          },
          {
            role: 'user',
            content: `真实查询数据事实：${JSON.stringify(facts)}`
          }
        ]
      },
      parse: content => {
        const json = output.extractJson(content);
        const analysis = typeof json.analysis === 'string' ? json.analysis.trim() : '';
        if (!analysis) throw output.invalidOutput('AI分析内容为空');
        if (output.containsUnexpectedNumber({ analysis }, allowedNumbers)) {
          throw output.invalidOutput('AI分析包含数据之外的虚构数字');
        }
        return analysis;
      }
    }, trace);
  }

  static async generateRagAnswer({ question, context }, trace = {}) {
    if (!this.isConfigured()) {
      trace.fallbackReason = 'not_configured';
      return null;
    }
    return requestModel({
      budgetMs: modelBudget(15000, 30000),
      payload: {
        model: process.env.AI_MODEL || 'deepseek-chat',
        temperature: 0.2,
        max_tokens: 1200,
        messages: [
          {
            role: 'system',
            content: `你是党校数智学习系统的权威党务助教。请严格依据下方提供的【参考学习资料】回答学员问题。
【核心要求】：
1. 只能依据参考资料提供的事实、条款和制度进行回答，切勿擅自引入外部猜测或编造未在资料中提及的规定。
2. 回答必须条理清晰、层次分明，并在关键结论和论据处自然标注引用资料编号（如[1]、[2]）。
3. 保持政治站位，表述严密、客观、权威。`
          },
          {
            role: 'user',
            content: `【参考学习资料】：\n${context}\n\n【学员提问】：${question}`
          }
        ]
      },
      parse: content => {
        const text = typeof content === 'string' ? content.trim() : '';
        if (!text) throw output.invalidOutput('AI问答生成内容为空');
        return text;
      }
    }, trace);
  }

  static async generatePersonalizedRagAnswer({ question, profile, context }, trace = {}) {
    if (!this.isConfigured()) {
      trace.fallbackReason = 'not_configured';
      return null;
    }
    return requestModel({
      budgetMs: modelBudget(18000, 35000),
      payload: {
        model: process.env.AI_MODEL || 'deepseek-chat',
        temperature: 0.25,
        max_tokens: 1500,
        messages: [
          {
            role: 'system',
            content: `你是党校数智学习系统的个性化导学专家。你需要结合学员的【真实学习画像】以及从党校知识库中检索到的【权威资料】，为学员提供针对性的诊断分析与重点学习建议。
【核心要求】：
1. 诊断必须严格基于画像事实（如薄弱知识点、错题率、完成率），严禁编造未在画像中出现的成绩或薄弱项。
2. 重点学习建议必须结合知识库参考资料的具体内容，说明“为什么薄弱”、“核心概念是什么”、“下一步如何提升”，并标注引用出处（如[1]、[2]）。
3. 态度积极鼓励，建议具体可行、层级分明。`
          },
          {
            role: 'user',
            content: `【学员学习画像数据】：\n${JSON.stringify(profile)}\n\n【检索到的薄弱知识点参考资料】：\n${context}\n\n【学员提问】：${question}`
          }
        ]
      },
      parse: content => {
        const text = typeof content === 'string' ? content.trim() : '';
        if (!text) throw output.invalidOutput('AI个性化导学建议为空');
        return text;
      }
    }, trace);
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
