/**
 * V4 引用真实性样本：验证回答中的引用编号是否指向真实支持结论的证据。
 * 格式沿用 V1 citation：answer（含[n]）、validCount、expectAnswerContains、expectInvalid、split。
 * 所有引用内容均来自 V4 知识库真实条文，证据由 answer 中的引用编号对应 evidence 顺序。
 */
const V = (name) => ({ label: '人工设计（证据锚定）', designer: 'AI 质量评测 V4', method: '引用编号与真实条文一一对应，人工设计合法/越界案例', name });

const citationCases = [
  {
    id: 'v4-c-001', split: 'dev', category: '引用真实性', name: '双条引用均合法',
    answer: '预备党员预备期为一年[1]，党龄从预备期满转为正式党员之日算起[2]。',
    validCount: 2, expectAnswerContains: ['[1]', '[2]'], expectInvalid: [],
    evidence: [
      { source: 'V4-01-中国共产党章程-党员.md', snippet: '预备党员的预备期为一年。' },
      { source: 'V4-01-中国共产党章程-党员.md', snippet: '党员的党龄，从预备期满转为正式党员之日算起。' }
    ],
    relevant: ['V4-01-中国共产党章程-党员.md'], answerable: true, requiredFacts: ['预备期为一年', '党龄从预备期满转为正式党员之日算起'],
    verification: V('引用真实性-双合法引用')
  },
  {
    id: 'v4-c-002', split: 'dev', category: '引用真实性', name: '单条合法引用',
    answer: '党员受到警告处分一年内，不得在党内提拔职务或者进一步使用[1]。',
    validCount: 1, expectAnswerContains: ['[1]'], expectInvalid: [],
    evidence: [{ source: 'V4-13-中国共产党纪律处分条例-违纪与纪律处分.md', snippet: '党员受到警告处分一年内、受到严重警告处分一年半内，不得在党内提拔职务或者进一步使用' }],
    relevant: ['V4-13-中国共产党纪律处分条例-违纪与纪律处分.md'], answerable: true, requiredFacts: ['警告处分一年内', '不得在党内提拔职务'],
    verification: V('引用真实性-单合法引用')
  },
  {
    id: 'v4-c-003', split: 'dev', category: '引用真实性', name: '引用编号越界应被识别',
    answer: '支部有正式党员3人以上应当成立党支部[1]，7人以上应设支委会[3]。',
    validCount: 2, expectAnswerContains: ['[1]'], expectInvalid: ['[3]'],
    evidence: [
      { source: 'V4-24-中国共产党支部工作条例（试行）-组织设置.md', snippet: '凡是有正式党员3人以上的，都应当成立党支部。' },
      { source: 'V4-28-中国共产党支部工作条例（试行）-党支部委员会建设.md', snippet: '有正式党员7人以上的党支部，应当设立党支部委员会。' }
    ],
    relevant: ['V4-24-中国共产党支部工作条例（试行）-组织设置.md', 'V4-28-中国共产党支部工作条例（试行）-党支部委员会建设.md'],
    answerable: true, requiredFacts: ['3人以上成立党支部', '7人以上的党支部应当设立党支部委员会'],
    note: '合法引用应为[1][2]，答案写成[1][3]，[3]越界',
    verification: V('引用真实性-越界引用')
  },
  {
    id: 'v4-c-004', split: 'heldout', category: '引用真实性', name: '跨文档双合法引用',
    answer: '党支部每年至少召开1次组织生活会[1]，一般安排在第四季度[2]。',
    validCount: 2, expectAnswerContains: ['[1]', '[2]'], expectInvalid: [],
    evidence: [
      { source: 'V4-27-中国共产党支部工作条例（试行）-组织生活.md', snippet: '党支部每年至少召开1次组织生活会，一般安排在第四季度' },
      { source: 'V4-34-中国共产党党员教育管理工作条例-党员日常教育管理主要方式.md', snippet: '党支部每年至少召开1次组织生活会' }
    ],
    relevant: ['V4-27-中国共产党支部工作条例（试行）-组织生活.md', 'V4-34-中国共产党党员教育管理工作条例-党员日常教育管理主要方式.md'],
    answerable: true, requiredFacts: ['每年至少召开1次组织生活会', '一般安排在第四季度'],
    verification: V('引用真实性-跨文档引用')
  },
  {
    id: 'v4-c-005', split: 'heldout', category: '引用真实性', name: '引用与证据主题不符应识别',
    answer: '党员每年集中学习培训时间一般不少于32学时[1]。',
    validCount: 1, expectAnswerContains: ['[1]'], expectInvalid: [],
    evidence: [{ source: 'V4-34-中国共产党党员教育管理工作条例-党员日常教育管理主要方式.md', snippet: '党员每年集中学习培训时间一般不少于32学时。' }],
    relevant: ['V4-34-中国共产党党员教育管理工作条例-党员日常教育管理主要方式.md'],
    answerable: true, requiredFacts: ['不少于32学时'],
    verification: V('引用真实性-证据对应')
  },
  {
    id: 'v4-c-006', split: 'dev', category: '引用真实性', name: '开除党籍后果引用',
    answer: '党员受到开除党籍处分，五年内不得重新入党[1]。',
    validCount: 1, expectAnswerContains: ['[1]'], expectInvalid: [],
    evidence: [{ source: 'V4-13-中国共产党纪律处分条例-违纪与纪律处分.md', snippet: '党员受到开除党籍处分，五年内不得重新入党' }],
    relevant: ['V4-13-中国共产党纪律处分条例-违纪与纪律处分.md'], answerable: true, requiredFacts: ['五年内不得重新入党'],
    verification: V('引用真实性-开除党籍')
  },
  {
    id: 'v4-c-007', split: 'heldout', category: '引用真实性', name: '发展对象条件引用',
    answer: '拟列为发展对象的公示期不少于五个工作日[1]，应当有两名正式党员作入党介绍人[2]。',
    validCount: 2, expectAnswerContains: ['[1]', '[2]'], expectInvalid: [],
    evidence: [
      { source: 'V4-43-中国共产党发展党员工作细则-发展对象的确定和考察.md', snippet: '公示期不少于五个工作日' },
      { source: 'V4-43-中国共产党发展党员工作细则-发展对象的确定和考察.md', snippet: '发展对象应当有两名正式党员作入党介绍人。' }
    ],
    relevant: ['V4-43-中国共产党发展党员工作细则-发展对象的确定和考察.md'], answerable: true, requiredFacts: ['公示期不少于五个工作日', '两名正式党员作入党介绍人'],
    verification: V('引用真实性-发展对象条件')
  },
  {
    id: 'v4-c-008', split: 'dev', category: '引用真实性', name: '影响期计算引用',
    answer: '党员在党纪处分影响期内又受到党纪处分的，其影响期为原处分尚未执行的影响期与新处分影响期之和[1]。',
    validCount: 1, expectAnswerContains: ['[1]'], expectInvalid: [],
    evidence: [{ source: 'V4-14-中国共产党纪律处分条例-纪律处分运用规则.md', snippet: '其影响期为原处分尚未执行的影响期与新处分影响期之和。' }],
    relevant: ['V4-14-中国共产党纪律处分条例-纪律处分运用规则.md'], answerable: true, requiredFacts: ['影响期为原处分尚未执行影响期与新处分影响期之和'],
    verification: V('引用真实性-影响期计算')
  }
];

module.exports = { description: 'V4 引用真实性集：合法引用与越界引用识别', cases: citationCases };
