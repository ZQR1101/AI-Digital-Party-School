/**
 * V4 人工设计样本定义（证据锚定）。
 * evidence 用 { file, article } 时，build-datasets.js 会按条号从知识库原文精确抽取整条作为证据片段。
 * 设计原则：问题不照搬原文关键词（同义改写），答案与必备事实点严格对应证据条文。
 * 类别：同义改写 / 相近概念 / 跨文档检索 / 多跳推理 / 版本辨析 / 无答案 / 部分可回答 / 引用真实性 / 多条件
 */

// 文件名常量（V4 知识库中的实际文件名）
const F = {
  zz1: 'V4-01-中国共产党章程-党员.md',
  zz2: 'V4-02-中国共产党章程-党的组织制度.md',
  zz5: 'V4-05-中国共产党章程-党的基层组织.md',
  zz6: 'V4-06-中国共产党章程-党的干部.md',
  zz7: 'V4-07-中国共产党章程-党的纪律.md',
  zz11: 'V4-11-中国共产党章程-党徽党旗.md',
  jl13: 'V4-13-中国共产党纪律处分条例-违纪与纪律处分.md',
  jl14: 'V4-14-中国共产党纪律处分条例-纪律处分运用规则.md',
  jl19: 'V4-19-中国共产党纪律处分条例-对违反廉洁纪律行为的处分.md',
  jl22: 'V4-22-中国共产党纪律处分条例-对违反生活纪律行为的处分.md',
  zb24: 'V4-24-中国共产党支部工作条例（试行）-组织设置.md',
  zb26: 'V4-26-中国共产党支部工作条例（试行）-工作机制.md',
  zb27: 'V4-27-中国共产党支部工作条例（试行）-组织生活.md',
  zb28: 'V4-28-中国共产党支部工作条例（试行）-党支部委员会建设.md',
  zb30: 'V4-30-中国共产党支部工作条例（试行）-附则.md',
  jy31: 'V4-31-中国共产党党员教育管理工作条例-总则.md',
  jy34: 'V4-34-中国共产党党员教育管理工作条例-党员日常教育管理主要方式.md',
  jy35: 'V4-35-中国共产党党员教育管理工作条例-党籍和党员组织关系管理.md',
  jy36: 'V4-36-中国共产党党员教育管理工作条例-党员监督和组织处置.md',
  jy37: 'V4-37-中国共产党党员教育管理工作条例-流动党员管理.md',
  jy40: 'V4-40-中国共产党党员教育管理工作条例-附则.md',
  fz41: 'V4-41-中国共产党发展党员工作细则-总则.md',
  fz43: 'V4-43-中国共产党发展党员工作细则-发展对象的确定和考察.md',
  fz45: 'V4-45-中国共产党发展党员工作细则-预备党员的教育、考察和转正.md',
  fz47: 'V4-47-中国共产党发展党员工作细则-附则.md'
};

const V = (name) => ({ label: '人工设计（证据锚定）', designer: 'AI 质量评测 V4', method: '按条号从权威原文抽取证据，人工设计问题与标准答案，脚本严格校验逐字匹配', name });

// ---------------- 检索集：同义改写 / 相近概念 / 跨文档 / 版本辨析 ----------------
const retrievalCases = [
  // 同义改写（问题用词与原文差异大）
  { id: 'v4-r-001', split: 'dev', category: '同义改写', query: '一名党员犯了错误受到党内警告，多久之内不能再提拔使用？', evidence: [{ file: F.jl13, article: '十' }], relevant: [F.jl13], note: '警告处分影响期', verification: V('同义改写-警告影响期') },
  { id: 'v4-r-002', split: 'dev', category: '同义改写', query: '被开除党籍的人要多长时间以后才有资格重新申请入党？', evidence: [{ file: F.jl13, article: '十三' }], relevant: [F.jl13], note: '开除党籍重新入党期限', verification: V('同义改写-开除党籍') },
  { id: 'v4-r-003', split: 'dev', category: '同义改写', query: '支部里正式党员达到几人就必须组建支委会，这个班子人数一般是多少？', evidence: [{ file: F.zb28, article: '二十' }], relevant: [F.zb28], note: '支委会设立门槛与人数', verification: V('同义改写-支委会') },
  { id: 'v4-r-004', split: 'dev', category: '同义改写', query: '党龄是从哪个时间节点开始起算的？', evidence: [{ file: F.zz1, article: '七' }], relevant: [F.zz1], note: '党龄起算（党章第七条明确“从预备期满转为正式党员之日算起”）', verification: V('同义改写-党龄') },
  { id: 'v4-r-005', split: 'dev', category: '同义改写', query: '党组织里党旗的图案和旗面是什么样的？', evidence: [{ file: F.zz11, article: '五十四' }], relevant: [F.zz11], note: '党旗样式', verification: V('同义改写-党旗') },
  { id: 'v4-r-006', split: 'heldout', category: '同义改写', query: '留党察看最长可以延续到多长时间？', evidence: [{ file: F.jl13, article: '十二' }], relevant: [F.jl13], note: '留党察看上限', verification: V('同义改写-留党察看') },
  { id: 'v4-r-007', split: 'heldout', category: '同义改写', query: '基层委员会和下设支部委员会一届一般干多少时间？', evidence: [{ file: F.zz5, article: '三十一' }], relevant: [F.zz5], note: '基层委员会任期', verification: V('同义改写-基层任期') },
  { id: 'v4-r-008', split: 'heldout', category: '同义改写', query: '党员一年里参加集中学习培训的最低学时是多少？', evidence: [{ file: F.jy34, article: '二十' }], relevant: [F.jy34], note: '年度培训学时', verification: V('同义改写-学时') },

  // 相近概念（易混淆制度）
  { id: 'v4-r-009', split: 'dev', category: '相近概念', query: '组织生活会一般安排在一年中的哪个季度召开？', evidence: [{ file: F.zb27, article: '十七' }], relevant: [F.zb27], note: '组织生活会时间（支部工作条例）', verification: V('相近概念-组织生活会季度') },
  { id: 'v4-r-010', split: 'dev', category: '相近概念', query: '党员教育管理工作条例规定的组织生活会多久至少开一次？', evidence: [{ file: F.jy34, article: '十七' }], relevant: [F.jy34], note: '组织生活会频次（党员教育条例）', verification: V('相近概念-组织生活会频次') },
  { id: 'v4-r-011', split: 'dev', category: '相近概念', query: '党员对党组织的处分决定不服，属于党员的哪一项权利体现？', evidence: [{ file: F.zz1, article: '四' }], relevant: [F.zz1], note: '党员权利-申辩', verification: V('相近概念-党员权利') },
  { id: 'v4-r-012', split: 'dev', category: '相近概念', query: '党支部党员大会多久开一次，与支委会会议频次一样吗？', evidence: [{ file: F.zb26, article: '十一' }], relevant: [F.zb26], note: '党员大会频次', verification: V('相近概念-党员大会') },
  { id: 'v4-r-013', split: 'heldout', category: '相近概念', query: '限期改正处置的最长期限是多久？', evidence: [{ file: F.jy36, article: '三十' }], relevant: [F.jy36], note: '限期改正', verification: V('相近概念-限期改正') },
  { id: 'v4-r-014', split: 'heldout', category: '相近概念', query: '发展对象公示期至少要几个工作日？', evidence: [{ file: F.fz43, article: '十三' }], relevant: [F.fz43], note: '公示期', verification: V('相近概念-公示期') },

  // 跨文档检索（需联合多份）
  { id: 'v4-r-015', split: 'dev', category: '跨文档检索', query: '预备党员没有党龄，那么党龄怎么算、预备期又有多长？', evidence: [{ file: F.zz1, article: '七' }, { file: F.fz45, article: '三十一' }], relevant: [F.zz1, F.fz45], note: '党龄起算+预备期时长（跨党章与发展党员细则）', verification: V('跨文档-党龄与预备期') },
  { id: 'v4-r-016', split: 'dev', category: '跨文档检索', query: '党支部每年至少开一次组织生活会，这个制度在支部工作条例和党员教育条例中分别是怎么规定的？', evidence: [{ file: F.zb27, article: '十七' }, { file: F.jy34, article: '十七' }], relevant: [F.zb27, F.jy34], note: '组织生活会双来源', verification: V('跨文档-组织生活会') },
  { id: 'v4-r-017', split: 'dev', category: '跨文档检索', query: '成立党支部需要正式党员3人以上，有了支部后多少党员要设支委会？', evidence: [{ file: F.zb24, article: '四' }, { file: F.zb28, article: '二十' }], relevant: [F.zb24, F.zb28], note: '支部设立+支委会门槛', verification: V('跨文档-支部与支委会') },
  { id: 'v4-r-018', split: 'heldout', category: '跨文档检索', query: '党纪处分的种类有哪几种，其中最重的是哪一种、多少年内不得重新入党？', evidence: [{ file: F.jl13, article: '八' }, { file: F.jl13, article: '十三' }], relevant: [F.jl13], note: '处分种类+开除党籍后果', verification: V('跨文档-处分种类与后果') },

  // 版本辨析
  { id: 'v4-r-019', split: 'dev', category: '版本辨析', query: '发展党员工作细则2014版与2026修订版，申请入党年龄条件是如何规定的？', evidence: [{ file: F.fz41, article: '一' }, { file: F.fz43, article: '十三' }], relevant: [F.fz41, F.fz43], versionNote: '设计缺陷样本（保留不删）：该题问的是两版相同的“年满十八岁”条件，且证据只锚定现行版，无法构成真正的版本辨析。补入2014历史版后新增 v4-r-049 / v4-q-036 作为真正的版本对照；本样本保留用于记录设计失误，不计入版本能力结论', note: '版本辨析（设计缺陷，保留）', verification: V('版本辨析-发展党员细则') },

  // 多条件（检索）
  { id: 'v4-r-020', split: 'dev', category: '多条件', query: '一个正式党员人数不足7人的党支部，设书记和副书记是怎么规定的？', evidence: [{ file: F.zb28, article: '二十' }], relevant: [F.zb28], note: '不足7人支部设置', verification: V('多条件-不足7人支部') },
  { id: 'v4-r-021', split: 'dev', category: '多条件', query: '受到严重警告处分的党员，一年半内在职务使用上有什么限制？', evidence: [{ file: F.jl13, article: '十' }], relevant: [F.jl13], note: '严重警告影响', verification: V('多条件-严重警告') },
  { id: 'v4-r-022', split: 'heldout', category: '多条件', query: '村社区党支部委员会一届任期与其它基层单位有何不同？', evidence: [{ file: F.zb28, article: '二十一' }], relevant: [F.zb28], note: '任期差异', verification: V('多条件-任期差异') }
];

// ---------------- 问答集：事实要点 + 引用 ----------------
const qaCases = [
  { id: 'v4-q-001', split: 'dev', category: '同义改写', question: '预备党员的预备期有多长，党龄从什么时候开始计算？', expectedSource: F.zz1, expectedKeywords: ['一年', '预备期满', '正式党员'], evidence: [{ file: F.zz1, article: '七' }], answer: '预备党员的预备期为一年，党员的党龄从预备期满转为正式党员之日算起。', requiredFacts: ['预备期为一年', '党龄从预备期满转为正式党员之日算起'], answerable: true, verification: V('问答-预备期与党龄') },
  { id: 'v4-q-002', split: 'dev', category: '同义改写', question: '党员受到警告处分后，多长时间内不能在党内提拔职务？', expectedSource: F.jl13, expectedKeywords: ['一年', '警告', '提拔'], evidence: [{ file: F.jl13, article: '十' }], answer: '党员受到警告处分一年内，不得在党内提拔职务或者进一步使用。', requiredFacts: ['一年内', '不得在党内提拔职务'], answerable: true, verification: V('问答-警告影响期') },
  { id: 'v4-q-003', split: 'dev', category: '相近概念', question: '开除党籍和留党察看在重新入党、恢复权利方面分别有什么规定？', expectedSource: F.jl13, expectedKeywords: ['五年内', '二年', '恢复党员权利'], evidence: [{ file: F.jl13, article: '十二' }, { file: F.jl13, article: '十三' }], answer: '留党察看分为一年、二年，最长不超过二年，确有悔改表现的期满后恢复党员权利；受到开除党籍处分的党员，五年内不得重新入党。', requiredFacts: ['留党察看最长不得超过二年', '期满后恢复其党员权利', '五年内不得重新入党'], answerable: true, verification: V('问答-党纪处分差异') },
  { id: 'v4-q-004', split: 'dev', category: '跨文档检索', question: '成立党支部对正式党员人数有什么要求？成立支委会又有什么要求？', expectedSource: F.zb24, expectedKeywords: ['3人', '7人', '3至5人'], evidence: [{ file: F.zb24, article: '四' }, { file: F.zb28, article: '二十' }], answer: '凡有正式党员3人以上的，都应当成立党支部；有正式党员7人以上的党支部，应当设立党支部委员会，支委会由3至5人组成，一般不超过7人。', requiredFacts: ['正式党员3人以上应当成立党支部', '正式党员7人以上应设党支部委员会', '支委会由3至5人组成'], answerable: true, verification: V('问答-支部与支委会') },
  { id: 'v4-q-005', split: 'dev', category: '多条件', question: '村、社区党支部委员会与其他基层单位党支部委员会的任期分别是多少？', expectedSource: F.zb28, expectedKeywords: ['5年', '3年'], evidence: [{ file: F.zb28, article: '二十一' }], answer: '村、社区党支部委员会每届任期5年，其他基层单位党支部委员会一般每届任期3年。', requiredFacts: ['村社区党支部委员会每届任期5年', '其他基层单位一般每届任期3年'], answerable: true, verification: V('问答-任期差异') },
  { id: 'v4-q-006', split: 'heldout', category: '同义改写', question: '党员每年集中学习培训时间一般不少于多少学时？', expectedSource: F.jy34, expectedKeywords: ['32学时', '集中培训'], evidence: [{ file: F.jy34, article: '二十' }], answer: '党员每年集中学习培训时间一般不少于32学时。', requiredFacts: ['一般不少于32学时'], answerable: true, verification: V('问答-培训学时') },
  { id: 'v4-q-007', split: 'heldout', category: '跨文档检索', question: '党支部每年至少召开几次组织生活会，这个规定在哪些法规中有体现？', expectedSource: F.zb27, expectedKeywords: ['每年至少1次', '第四季度'], evidence: [{ file: F.zb27, article: '十七' }, { file: F.jy34, article: '十七' }], answer: '党支部每年至少召开1次组织生活会，一般安排在第四季度；党员教育管理工作条例也有每年至少召开1次组织生活会的规定。', requiredFacts: ['每年至少召开1次组织生活会', '一般安排在第四季度'], answerable: true, verification: V('问答-组织生活会') },
  { id: 'v4-q-008', split: 'heldout', category: '多条件', question: '发展对象中，公示期不少于几个工作日？入党介绍人需要几名正式党员？', expectedSource: F.fz43, expectedKeywords: ['五个工作日', '两名', '正式党员'], evidence: [{ file: F.fz43, article: '十三' }, { file: F.fz43, article: '十四' }], answer: '拟列为发展对象的，公示期不少于五个工作日；发展对象应当有两名正式党员作入党介绍人。', requiredFacts: ['公示期不少于五个工作日', '两名正式党员作入党介绍人'], answerable: true, verification: V('问答-发展对象条件') }
];

// ---------------- 拒答集：无答案 / 部分可回答 ----------------
const refusalCases = [
  { id: 'v4-rf-001', split: 'dev', category: '无答案', query: '党员每季度应当缴纳多少元党费的具体金额标准是多少？', answerable: false, note: '知识库未收录按工资基数计算党费的具体金额表，不得编造', verification: V('拒答-党费金额') },
  { id: 'v4-rf-002', split: 'dev', category: '无答案', query: '2026年全国党员总数是多少万人？', answerable: false, note: '知识库无党内统计公报数据', verification: V('拒答-党员总数') },
  { id: 'v4-rf-003', split: 'dev', category: '无答案', query: '量子纠缠在党内法规中如何规定？', answerable: false, note: '与党务无关的自然科学概念', verification: V('拒答-无关领域') },
  { id: 'v4-rf-004', split: 'heldout', category: '部分可回答', query: '预备党员转正后党龄怎么算，以及转正需要支部大会多少票通过？', answerable: false, note: '党龄起算有证据，但支部大会表决通过比例在V4知识库该条文中未收录，需拒答或说明部分可答', verification: V('拒答-部分可回答') },
  { id: 'v4-rf-005', split: 'heldout', category: '无答案', query: '党支部书记每月应当领取多少职务津贴？', answerable: false, note: '知识库无津贴标准', verification: V('拒答-津贴标准') }
];

// 合并扩充样本（证据锚定，同一严格校验标准）
const extra = require('./case-defs-extra');
retrievalCases.push(...extra.retrievalExtra);
qaCases.push(...extra.qaExtra);
refusalCases.push(...extra.refusalExtra);

const citationGroup = require('./case-defs-citation');
// citation 样本无独立 query，用 name 作为问题字段以通过统一校验
citationGroup.cases.forEach((c) => { c.query = c.name; });

module.exports = {
  retrieval: { description: 'V4 高难度检索集：同义改写/相近概念/跨文档/版本辨析/多跳/多条件', cases: retrievalCases },
  qa: { description: 'V4 问答集：事实要点与引用', cases: qaCases },
  refusal: { description: 'V4 拒答集：无答案与部分可回答', cases: refusalCases },
  citation: citationGroup
};
