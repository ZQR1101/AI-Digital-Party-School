const METRICS = {
  learning_completion_rate: {
    name: '学习完成率',
    unit: '%',
    aliases: ['学习完成率', '完成率', '任务完成率']
  },
  average_exam_score: {
    name: '考试平均分',
    unit: '分',
    aliases: ['考试平均分', '平均分', '平均成绩']
  },
  exam_pass_rate: {
    name: '考试及格率',
    unit: '%',
    aliases: ['考试及格率', '及格率']
  },
  total_study_hours: {
    name: '学习时长',
    unit: '小时',
    aliases: ['总学习时长', '学习时长', '学习小时']
  },
  active_member_count: {
    name: '活跃党员人数',
    unit: '人',
    aliases: ['活跃党员人数', '活跃人数', '活跃党员']
  }
};

function resolveMetric(message) {
  const text = String(message || '').trim();
  for (const [key, definition] of Object.entries(METRICS)) {
    if (definition.aliases.some(alias => text.includes(alias))) return key;
  }
  return null;
}

function yearRange(year) {
  return {
    label: `${year}年`,
    startDate: `${year}-01-01 00:00:00`,
    endDate: `${year + 1}-01-01 00:00:00`
  };
}

function monthRange(year, month) {
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const pad = value => String(value).padStart(2, '0');
  return {
    label: `${year}年${month}月`,
    startDate: `${year}-${pad(month)}-01 00:00:00`,
    endDate: `${nextYear}-${pad(nextMonth)}-01 00:00:00`
  };
}

function resolveTimeRange(message, now = new Date()) {
  const text = String(message || '');
  const currentYear = now.getFullYear();
  const explicitMonth = text.match(/(20\d{2})年\s*(1[0-2]|0?[1-9])月/);
  if (explicitMonth) return monthRange(Number(explicitMonth[1]), Number(explicitMonth[2]));

  const explicitYear = text.match(/(20\d{2})年/);
  if (explicitYear) return yearRange(Number(explicitYear[1]));
  if (text.includes('去年')) return yearRange(currentYear - 1);
  if (text.includes('本月') || text.includes('这个月')) {
    return monthRange(currentYear, now.getMonth() + 1);
  }
  return yearRange(currentYear);
}

function extractOrganizationName(message) {
  const text = String(message || '').replace(/[，。？！?,!]/g, ' ').trim();
  const patterns = [
    /(?:查询|统计|看看|分析)?\s*([^\s]{2,30}(?:党委|党总支|党支部|支部|党小组))(?=的|学习|考试|完成|平均|及格|活跃|今年|去年|本月|20\d{2}年|\s|$)/,
    /(?:今年|去年|本月|\d{4}年)\s*([^\s]{2,30}(?:党委|党总支|党支部|支部|党小组))/
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1].replace(/^(今年|去年|本月)/, '').trim();
  }
  return null;
}

function parseOrganizationQuery(message, now = new Date()) {
  const metric = resolveMetric(message);
  if (!metric) {
    const error = new Error('暂不支持该指标，可查询学习完成率、考试平均分、考试及格率、学习时长或活跃党员人数');
    error.code = 'UNSUPPORTED_METRIC';
    throw error;
  }
  const text = String(message || '');
  return {
    intent: 'metric_query',
    metric,
    metricDefinition: METRICS[metric],
    organizationName: extractOrganizationName(text),
    timeRange: resolveTimeRange(text, now),
    groupBy: /趋势|每月|月度|按月/.test(text) ? 'month' : null
  };
}

module.exports = { METRICS, parseOrganizationQuery, resolveMetric, resolveTimeRange, extractOrganizationName };
