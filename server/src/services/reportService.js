const LearningProfileService = require('./learningProfileService');
const RecommendationService = require('./recommendationService');
const { calculateEvaluation } = require('../ai/scoring');
const { AIClient } = require('./aiClient');

class ReportService {
  static async generateReport(userId, trace = {}) {
    const profile = await LearningProfileService.getProfile(userId);
    const evaluation = calculateEvaluation(profile);
    const facts = {
      completionRate: profile.completionRate,
      completedTasks: profile.completedTasks,
      totalTasks: profile.totalTasks,
      totalStudyHours: profile.totalStudyHours,
      activeDays: profile.activeDays,
      totalExams: profile.totalExams,
      avgScore: profile.avgScore,
      maxScore: profile.maxScore,
      weakKnowledgePoints: profile.weakCategories.map(item => item.category)
    };
    const aiInput = {
      score: evaluation.score,
      level: evaluation.level,
      dimensions: evaluation.dimensions,
      completionRate: facts.completionRate,
      totalStudyHours: facts.totalStudyHours,
      activeDays: facts.activeDays,
      assessments: profile.assessments,
      weakKnowledgePoints: profile.weakCategories
    };

    const status = evaluation.score == null ? 'insufficient_data' : 'ready';
    if (status === 'insufficient_data') trace.fallbackReason = 'insufficient_data';
    const [recommendations, modelNarrative] = await Promise.all([
      RecommendationService.getReportRecommendations(profile),
      status === 'ready' ? AIClient.generateEvaluationNarrative(aiInput, trace) : null
    ]);
    const generatedBy = modelNarrative ? 'llm' : 'rules';
    trace.resultMode = modelNarrative ? 'model' : 'rules';
    const narrative = modelNarrative || this.generateFallbackNarrative(profile, evaluation);

    return {
      scene: 'learning_evaluation',
      generatedAt: new Date().toISOString(),
      status,
      period: profile.period,
      assessments: profile.assessments,
      weakKnowledgePoints: profile.weakCategories,
      knowledgeProgress: profile.knowledgeProgress,
      recommendations,
      user: {
        id: profile.userId,
        name: profile.userName,
        organizationId: profile.organizationId,
        organizationName: profile.organizationName
      },
      score: evaluation.score,
      level: evaluation.level,
      ruleVersion: evaluation.ruleVersion,
      dimensions: evaluation.dimensions,
      weights: evaluation.weights,
      facts,
      narrative,
      aiComment: {
        score: evaluation.score,
        comment: narrative.summary,
        suggestion: narrative.suggestions.map(item => item.content).join('；')
      },
      generatedBy,
      disclaimer: '本报告由系统依据学习数据自动生成，仅用于学习辅助，不替代正式组织评价。'
    };
  }

  static generateFallbackNarrative(profile, evaluation) {
    if (evaluation.score == null) {
      return {
        summary: '本周期还没有已判分的测评或考试，完成一份后即可查看综合评分。',
        strengths: [],
        weaknesses: [],
        suggestions: [{ title: '完成一次测评', content: '前往测评，提交已下发的试卷以查看知识点诊断。', knowledgePoint: null }]
      };
    }
    const strengths = [];
    const weaknesses = [];
    if (profile.totalTasks) {
      if (profile.completionRate >= 85) strengths.push('学习任务完成情况较好');
      else weaknesses.push('还有必修学习任务待完成');
    }
    const assessed = Object.values(profile.assessments).filter(item => item.count);
    if (assessed.every(item => item.avgScore >= 80)) strengths.push('本周期已完成的测评成绩较好');
    else weaknesses.push('可结合测评错题集中复习');
    if (profile.activeDays >= 10) strengths.push('能够保持一定学习频率');
    else weaknesses.push('学习频率分布不够均衡');
    const weak = profile.weakCategories[0];
    if (weak) weaknesses.push(`“${weak.category}”是当前主要薄弱知识点`);

    const suggestions = [];
    if (weak) {
      suggestions.push({
        title: '开展薄弱知识点专项学习',
        content: `优先学习与“${weak.category}”相关的公共内容，并完成错题复习。`,
        knowledgePoint: weak.category
      });
    }
    if (profile.totalTasks && profile.completionRate < 90) {
      suggestions.push({ title: '完善学习计划', content: '优先完成尚未结束的必修学习任务。', knowledgePoint: null });
    }
    if (!suggestions.length) {
      suggestions.push({ title: '保持学习节奏', content: '继续保持当前学习节奏，并适当拓展公共学习内容。', knowledgePoint: null });
    }
    return {
      summary: `本阶段综合学习表现为“${evaluation.level}”，各项结果均依据系统学习记录计算。`,
      strengths: strengths.length ? strengths : ['已形成基础学习记录'],
      weaknesses,
      suggestions
    };
  }
}

module.exports = ReportService;
