// CI 质量门禁阈值（离线确定性评测，固定以 dev 划分为依据）
// 首次基线（2026-11-25，数据集 v1.1.0）实测值即初始阈值：见 reports/baseline-v1.1.0.json。
// V2 依据 dev 划分上调拒答率、问数组织名与精确匹配阈值（dev 实测均为 1.0）以锁定优化收益；
// heldout 只用于最终独立报告，不参与阈值调整或复测调参。
// 禁止为了过门禁删除困难样本、改测试答案或放宽判定；后续只允许上调或保持阈值。

const FLOORS = {
  retrieval: { recallAt5: 0.95, mrrAt5: 0.9, hitAt5: 0.95 },
  refusal: { refusalRate: 0.9 },
  qa: { factPointCoverageRate: 0.9, citationNumberValidRate: 1.0, overRefusalRate: 0 },
  nlq: {
    toolSelectionAccuracy: 1.0,
    metricAccuracy: 1.0,
    organizationAccuracy: 1.0,
    exactMatchRate: 1.0
  },
  toolParams: { accuracy: 1.0 },
  access: { permissionCorrectRate: 1.0 },
  citation: { accuracy: 0.85 },
  dbTruth: { consistencyRate: 1.0 }
};

function devSummary(suite) {
  return suite?.bySplit?.dev || suite?.summary;
}

function evaluateGate(suites) {
  const breaches = [];
  for (const [suite, floors] of Object.entries(FLOORS)) {
    // dev 优先；dbTruth 无 dev 分组时，未运行（N/A）不按 0 处理
    const summary = suite === 'dbTruth' ? suites[suite]?.summary : devSummary(suites[suite]);
    if (suites[suite]?.status === 'not_run' || summary?.samples === 'N/A') {
      // 未运行项在报告中标记 N/A，不按 0 计入门禁失败
      continue;
    }
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
  return {
    basis: 'dev',
    heldoutUsage: '仅最终独立报告，不用于阈值调整',
    passed: breaches.length === 0,
    breaches
  };
}

module.exports = { FLOORS, evaluateGate, devSummary };
