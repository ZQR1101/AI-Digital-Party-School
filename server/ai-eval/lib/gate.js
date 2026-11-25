// CI 质量门禁阈值（离线确定性评测，dev 划分）
// 首次基线（2026-11-25，数据集 v1.1.0）实测值即初始阈值：见 reports/latest.md。
// 已知短板（拒答率、引用清洗）如实纳入门禁基线并在报告中给出优化建议；
// 后续只允许上调或保持，禁止为了过门禁删除困难样本、改测试答案或放宽判定。

const FLOORS = {
  retrieval: { recallAt5: 0.95, mrrAt5: 0.9, hitAt5: 0.95 },
  refusal: { refusalRate: 0.6 },
  qa: { factAccuracyRate: 0.9, citationNumberValidRate: 1.0 },
  nlq: { toolSelectionAccuracy: 1.0, metricAccuracy: 1.0, exactMatchRate: 0.85 },
  toolParams: { accuracy: 1.0 },
  access: { permissionCorrectRate: 1.0 },
  citation: { accuracy: 0.85 }
};

function evaluateGate(suites) {
  const breaches = [];
  for (const [suite, floors] of Object.entries(FLOORS)) {
    const summary = suites[suite]?.summary;
    if (!summary) {
      breaches.push({ suite, metric: 'missing', floor: 'present', actual: null });
      continue;
    }
    for (const [metric, floor] of Object.entries(floors)) {
      const actual = summary[metric];
      if (typeof actual !== 'number') breaches.push({ suite, metric, floor, actual: null });
      else if (actual < floor) breaches.push({ suite, metric, floor, actual });
    }
  }
  return { passed: breaches.length === 0, breaches };
}

module.exports = { FLOORS, evaluateGate };
