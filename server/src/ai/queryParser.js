const METRICS = {
  learning_completion_rate: {
    name: '学习完成率',
    unit: '%',
    aliases: ['学习完成率', '完成率', '任务完成率']
  },
  average_exam_score: {
    name: '考试平均分',
    unit: '分',
    aliases: ['考试平均分', '测验平均分', '考核平均分', '考试平均成绩', '测验平均成绩', '考核平均成绩', '平均分', '平均成绩']
  },
  exam_pass_rate: {
    name: '考试及格率',
    unit: '%',
    aliases: ['考试及格率', '测验及格率', '考核及格率', '考试通过率', '测验通过率', '考核通过率', '及格率', '通过率']
  },
  total_study_hours: {
    name: '学习时长',
    unit: '小时',
    aliases: ['总学习时长', '学习时长', '学习小时']
  },
  active_member_count: {
    name: '活跃党员人数',
    unit: '人',
    aliases: ['活跃党员人数', '活跃人数', '活跃党员', '学习活跃度', '活跃度']
  },
  organization_overview: {
    name: '组织基本概况',
    unit: '',
    aliases: ['组织概况', '支部概况', '组织信息', '基本情况']
  },
  member_distribution: {
    name: '党员人数分布',
    unit: '人',
    aliases: ['党员人数分布', '人数分布', '人员分布', '党员数量分布']
  },
  sub_organization_count: {
    name: '下属组织数量',
    unit: '个',
    aliases: ['下级党组织', '下级组织', '下属支部', '支部数量']
  }
};

const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
const TIME_PATTERN = /20\d{2}年(?:\s*\d{1,2}月)?|(?:最近|过去|近)\s*(?:3|三|6|六)\s*个?月|(?:最近|过去|近)\s*(?:30|三十)\s*天|今年|去年|上个月|上月|这个月|本月/g;
const METRIC_PATTERN = new RegExp(Object.values(METRICS).flatMap(item => item.aliases).sort((a, b) => b.length - a.length).join('|'), 'g');
const ALL_ORGANIZATIONS = /^(?:全校(?:党组织|所有党组织)?|全部(?:党组织|组织)?|所有(?:党组织|组织)|全体(?:党组织|组织))$/;

function findMetrics(message) {
  const text = String(message || '').trim();
  return Object.keys(METRICS).filter(key => METRICS[key].aliases.some(alias => text.includes(alias)));
}

function resolveMetric(message) {
  return findMetrics(message)[0] || null;
}

function invalidQuery(message, code = 'INVALID_QUERY') {
  return Object.assign(new Error(message), { code, statusCode: 400 });
}

function timeRange(label, start, end) {
  return {
    label,
    startDate: `${start.toISOString().slice(0, 10)} 00:00:00`,
    endDate: `${end.toISOString().slice(0, 10)} 00:00:00`
  };
}

function yearRange(year) {
  return timeRange(`${year}年`, new Date(Date.UTC(year, 0, 1)), new Date(Date.UTC(year + 1, 0, 1)));
}

function monthRange(year, monthIndex) {
  const start = new Date(Date.UTC(year, monthIndex, 1));
  const end = new Date(Date.UTC(year, monthIndex + 1, 1));
  return timeRange(`${start.getUTCFullYear()}年${start.getUTCMonth() + 1}月`, start, end);
}

function resolveTimeRange(message, now = new Date()) {
  const periods = String(message || '').match(TIME_PATTERN) || [];
  if (periods.length > 1) throw invalidQuery('请在一次查询中指定一个统计周期');
  const beijing = new Date(now.getTime() + BEIJING_OFFSET_MS);
  const year = beijing.getUTCFullYear();
  const month = beijing.getUTCMonth();
  const period = periods[0] || '今年';
  const explicit = period.match(/^(20\d{2})年(?:\s*(\d{1,2})月)?$/);
  if (explicit) {
    if (!explicit[2]) return yearRange(Number(explicit[1]));
    const monthNumber = Number(explicit[2]);
    if (monthNumber < 1 || monthNumber > 12) throw invalidQuery('月份应为 1 至 12 月');
    return monthRange(Number(explicit[1]), monthNumber - 1);
  }
  if (period === '去年') return yearRange(year - 1);
  if (period === '上月' || period === '上个月') return monthRange(year, month - 1);
  if (period === '本月' || period === '这个月') return monthRange(year, month);
  if (period.endsWith('天')) {
    const day = beijing.getUTCDate();
    return timeRange('最近30天', new Date(Date.UTC(year, month, day - 29)), new Date(Date.UTC(year, month, day + 1)));
  }
  if (period.endsWith('月')) {
    const count = /[6六]/.test(period) ? 6 : 3;
    return timeRange(`最近${count}个月（含本月）`, new Date(Date.UTC(year, month - count + 1, 1)), new Date(Date.UTC(year, month + 1, 1)));
  }
  return yearRange(year);
}

function dashboardTimeRange(range) {
  return { '30d': '最近30天', '3m': '最近3个月', '6m': '最近6个月' }[range] || '最近6个月';
}

function toUtcSqlDate(beijingSqlDate) {
  return new Date(`${beijingSqlDate.replace(' ', 'T')}+08:00`).toISOString().slice(0, 19).replace('T', ' ');
}

function extractOrganizationName(message) {
  const text = String(message || '');
  const quoted = text.match(/「([^」]+)」/g);
  if (quoted?.length > 1) throw invalidQuery('请在一次查询中指定一个组织范围');
  if (quoted) {
    const name = quoted[0].slice(1, -1).trim();
    return !name || ALL_ORGANIZATIONS.test(name) ? null : name;
  }

  const strippedText = text
    .replace(TIME_PATTERN, ' ')
    .replace(METRIC_PATTERN, ' ')
    .replace(/[，。？！；：?!,;:“”"「」]/g, ' ')
    .replace(/(?:学习情况|完成情况|考试情况|整体情况|哪几个月|比较低|比较高|最低|最高)/g, ' ');

  const known = ['学生第一党支部', '行政第一党支部', '教师党支部', '第一党支部', '第一党小组', '第二党小组', '软件工程系党总支', '计算机系党总支', '信息工程学院党委', '机关党委', '学校党委'];
  for (const org of known.sort((a, b) => b.length - a.length)) {
    if (strippedText.includes(org)) return org;
  }
  const orgMatch = strippedText.match(/([a-zA-Z0-9\u4e00-\u9fa5]+?(?:党委|党总支|党支部|支部|党小组))/);
  if (orgMatch) {
    const candidate = orgMatch[1].replace(/^(?:请问|请|帮我|查一下|看一下|查询|统计|分析|查看)/, '').trim();
    if (candidate && !ALL_ORGANIZATIONS.test(candidate)) return candidate;
  }

  // 统计描述词既可能出现在组织名之前，也可能出现在其后；在识别兜底组织名时统一剥离。
  // 例：「全校学习完成率月度走势」→ 全校；「全校下级组织数量」→ 全校。
  const scope = strippedText
    .replace(/^(?:\s|请问|请|帮我|查一下|看一下|怎么查|查询|统计|看看|分析|查看)+/, '')
    .replace(/(?:\s|的|是多少|有多少个|有多少|多少个|几个|多少|怎么样|如何|情况|数据|月度趋势|月度走势|走势|趋势|每月|月度|按月|数量|是|呢|吗)+$/, '')
    .trim();
  return !scope || ALL_ORGANIZATIONS.test(scope) ? null : scope;
}

function parseOrganizationQuery(message, now = new Date()) {
  const text = String(message || '');
  const [metric, secondMetric] = findMetrics(text.replace(/「[^」]+」/g, ' '));
  if (!metric) {
    throw invalidQuery('暂不支持该指标，可查询学习完成率、考试平均分、考试及格率、学习时长或活跃党员人数', 'UNSUPPORTED_METRIC');
  }
  if (secondMetric) throw invalidQuery('请在一次查询中选择一个指标');
  if (/对比|环比|同比|排名|排行/.test(text)) throw invalidQuery('请先查询一个组织和统计周期，可使用月度趋势查看各月数据');
  return {
    intent: 'metric_query',
    metric,
    metricDefinition: METRICS[metric],
    organizationName: extractOrganizationName(text),
    timeRange: resolveTimeRange(text.replace(/「[^」]+」/g, ' '), now),
    groupBy: /趋势|每月|月度|按月|走势|哪几个月|哪些月|各月/.test(text) ? 'month' : null
  };
}

module.exports = { METRICS, parseOrganizationQuery, resolveMetric, resolveTimeRange, extractOrganizationName, dashboardTimeRange, toUtcSqlDate };
