function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function calculateEvaluation(metrics) {
  const { quiz, exam } = metrics.assessments;
  const hasAssessment = quiz.count > 0 || exam.count > 0;
  const activity = (Math.min(metrics.activeDays, 20) / 20) * 70
    + (Math.min(metrics.totalStudyHours, 20) / 20) * 30;

  const dimensions = {
    completion: metrics.totalTasks ? round(clamp(metrics.completionRate)) : null,
    activity: metrics.activeDays ? round(clamp(activity)) : null,
    quiz: quiz.count ? round(clamp(quiz.avgScore)) : null,
    exam: exam.count ? round(clamp(exam.avgScore)) : null
  };
  const baseWeights = { completion: 30, activity: 20, quiz: 20, exam: 30 };
  const scored = Object.keys(dimensions).filter(key => dimensions[key] != null);
  const totalWeight = scored.reduce((sum, key) => sum + baseWeights[key], 0);
  const weights = Object.fromEntries(Object.keys(dimensions).map(key => [
    key, hasAssessment && dimensions[key] != null ? round(baseWeights[key] / totalWeight, 4) : 0
  ]));
  const score = hasAssessment
    ? Math.round(scored.reduce((sum, key) => sum + dimensions[key] * baseWeights[key], 0) / totalWeight)
    : null;
  const level = score == null ? '数据不足' : score >= 90 ? '优秀' : score >= 80 ? '良好' : score >= 60 ? '合格' : '待提升';
  return {
    score,
    level,
    ruleVersion: '2026.2',
    dimensions,
    weights
  };
}

module.exports = { calculateEvaluation, clamp, round };
