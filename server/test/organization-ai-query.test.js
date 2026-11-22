const test = require('node:test');
const assert = require('node:assert/strict');
const { parseOrganizationQuery, resolveTimeRange, dashboardTimeRange, toUtcSqlDate } = require('../src/ai/queryParser');

const now = new Date('2026-12-31T16:10:00Z');

test('上个月按北京时间跨年识别组织和完整自然月', () => {
  const query = parseOrganizationQuery('学生第一党支部上个月的学习完成率是多少？', now);
  assert.equal(query.organizationName, '学生第一党支部');
  assert.equal(query.metric, 'learning_completion_rate');
  assert.deepEqual(query.timeRange, {
    label: '2026年12月',
    startDate: '2026-12-01 00:00:00',
    endDate: '2027-01-01 00:00:00'
  });
  assert.equal(toUtcSqlDate(query.timeRange.endDate), '2026-12-31 16:00:00');
});

test('看板近三个月和问数共用同一统计周期', () => {
  const query = parseOrganizationQuery('查询「全校党组织」最近三个月活跃度趋势', now);
  assert.equal(query.organizationName, null);
  assert.equal(query.groupBy, 'month');
  assert.deepEqual(query.timeRange, resolveTimeRange(dashboardTimeRange('3m'), now));
  assert.equal(query.timeRange.startDate, '2026-11-01 00:00:00');
  assert.equal(query.timeRange.endDate, '2027-02-01 00:00:00');
});

test('保留组织名称中的指标和时间文字', () => {
  const query = parseOrganizationQuery('查询「2025年学习时长研究组」本月学习完成率', now);
  assert.equal(query.organizationName, '2025年学习时长研究组');
  assert.equal(query.timeRange.label, '2027年1月');
});

test('测验和考试的常见指标问法都可识别组织', () => {
  const average = parseOrganizationQuery('最近三个月学生第一党支部测验平均分趋势', now);
  assert.equal(average.metric, 'average_exam_score');
  assert.equal(average.organizationName, '学生第一党支部');
  const passRate = parseOrganizationQuery('学生第一党支部本月考核通过率', now);
  assert.equal(passRate.metric, 'exam_pass_rate');
  assert.equal(passRate.organizationName, '学生第一党支部');
});

test('不把模糊组织和无法识别的时间条件降级为全校', () => {
  const query = parseOrganizationQuery('教师组织上周的学习时长', now);
  assert.ok(query.organizationName);
});

test('多指标、多周期和越界月份返回提示', () => {
  assert.throws(() => parseOrganizationQuery('学习完成率和考试及格率', now), /一个指标/);
  assert.throws(() => parseOrganizationQuery('今年和去年学习完成率', now), /一个统计周期/);
  assert.throws(() => parseOrganizationQuery('2026年13月学习完成率', now), /月份应为/);
  assert.throws(() => parseOrganizationQuery('对比「甲党支部」和「乙党支部」的学习完成率', now), /一个组织/);
});
