function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function calculateEvaluation(metrics) {
  const completion = clamp(metrics.completionRate);
  const activity = clamp((Math.min(metrics.activeDays || 0, 20) / 20) * 70 + (Math.min(metrics.totalStudyHours || 0, 20) / 20) * 30);
  const quiz = clamp(metrics.avgScore);
  const exam = clamp(metrics.avgScore);
  const weakCount = Array.isArray(metrics.weakCategories) ? metrics.weakCategories.length : 0;
  const improvement = clamp(100 - weakCount * 12);

  const dimensions = {
    completion: round(completion),
    activity: round(activity),
    quiz: round(quiz),
    exam: round(exam),
    improvement: round(improvement)
  };
  const score = Math.round(
    dimensions.completion * 0.30 +
    dimensions.activity * 0.20 +
    dimensions.quiz * 0.20 +
    dimensions.exam * 0.25 +
    dimensions.improvement * 0.05
  );
  const level = score >= 90 ? '优秀' : score >= 80 ? '良好' : score >= 60 ? '合格' : '待提升';
  return {
    score,
    level,
    ruleVersion: '2026.1',
    dimensions,
    weights: { completion: 0.30, activity: 0.20, quiz: 0.20, exam: 0.25, improvement: 0.05 }
  };
}

module.exports = { calculateEvaluation, clamp, round };
