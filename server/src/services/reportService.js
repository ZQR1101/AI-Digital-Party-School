const LearningProfileService = require('./learningProfileService');
const { calculateEvaluation } = require('../ai/scoring');
const { AIClient } = require('./aiClient');

class ReportService {
  static async generateReport(userId) {
    const profile = await LearningProfileService.getProfile(userId);
    const evaluation = calculateEvaluation(profile);
    const facts = {
      completionRate: profile.completionRate,
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
      ...facts
    };

    let narrative;
    let generatedBy = 'rules';
    try {
      narrative = await AIClient.generateEvaluationNarrative(aiInput);
      if (narrative) generatedBy = 'llm';
    } catch (error) {
      console.warn('AI评语生成失败，使用确定性模板:', error.message);
    }
    narrative ||= this.generateFallbackNarrative(profile, evaluation);

    return {
      scene: 'learning_evaluation',
      generatedAt: new Date().toISOString(),
      period: 'current',
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
    const strengths = [];
    const weaknesses = [];
    if (profile.completionRate >= 85) strengths.push('学习任务完成情况较好');
    else weaknesses.push('学习任务完成度仍有提升空间');
    if (profile.avgScore >= 80) strengths.push('考试成绩较为稳定');
    else if (profile.totalExams > 0) weaknesses.push('测验和考试知识掌握需要进一步巩固');
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
    if (profile.completionRate < 90) {
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
