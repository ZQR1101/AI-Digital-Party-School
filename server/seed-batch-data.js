/**
 * 演示数据扩容：约 100 名党员、20 份学习内容（半数视频且时长>1分钟）、
 * 10 个学习任务（半数视频）、60 道题库与 3 份各 20 题的试卷。
 * 可重复执行，已存在的账号/标题会跳过。
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

const PASSWORD_HASH = '$2a$10$ALaZI5L.ywOltKqgdKHSXOrtTQbhFQUbQ4tszGFZavdaCIzHDdQFO'; // admin123

const LONG_VIDEOS = [
  { url: '/uploads/demo-lecture.mp4', minutes: 10 },
  { url: '/uploads/demo-lecture.mp4', minutes: 11 },
  { url: '/uploads/demo-lecture.mp4', minutes: 15 },
  { url: '/uploads/demo-lecture.mp4', minutes: 12 },
];

const SURNAMES = '赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许'.split('');
const GIVENS = ['伟', '芳', '娜', '敏', '静', '丽', '强', '军', '洋', '勇', '艳', '杰', '娟', '涛', '超', '秀', '英', '华', '慧', '鹏'];

const ARTICLE_BODIES = [
  '理论学习要坚持读原著、学原文、悟原理。党员要把学习作为一种政治责任，联系岗位实际思考问题、改进工作。基层党组织应定期组织研讨交流，防止学习停留在记笔记、走过场。通过专题辅导、个人自学和集中研讨相结合，把学习成果转化为推动工作的思路和办法。',
  '组织生活是锤炼党性的熔炉。三会一课、主题党日、组织生活会和民主评议党员要按制度落实，突出政治性和庄重感。会议应有明确主题、完整记录和整改闭环，让每名党员都参与进来、受到教育。',
  '密切联系群众是党的最大政治优势。党员要经常深入一线倾听意见，把群众的急难愁盼摸清楚、办扎实。调查研究要带着问题下去，把情况弄准，把对策提实，把作风转正。',
  '纪律是管党治党的戒尺。党员要熟知六项纪律的基本要求，做到知敬畏、存戒惧、守底线。日常工作中要慎独慎微，管好小节，自觉接受组织和群众监督。',
  '宣传思想工作要围绕中心、服务大局。党支部应结合本单位实际开展形势政策宣讲，用群众听得懂的语言讲清道理。网络空间同样需要规范言行，做到不信谣、不传谣。',
  '发展党员必须把政治标准放在首位，严格程序、严肃纪律。从入党申请、培养教育到预备期满转正，每个环节都要有记录、有考察、有把关，保证新党员质量。',
  '统一战线是党的重要法宝。基层党组织要做好凝聚人心、汇聚力量的工作，尊重差异、寻求共识，把各方面智慧和力量汇集到事业发展上来。',
  '青年党员是事业的生力军。要加强政治训练和实践锻炼，帮助青年党员在急难险重任务中经风雨、见世面、壮筋骨，扣好职业生涯的第一粒扣子。',
  '党建与业务不能两张皮。要把党建工作融入教学科研、管理服务和疫情防控等具体任务，用业务成果检验党建成效，用党建优势保障业务推进。',
  '廉洁文化要润物无声。通过案例警示、岗位廉政风险排查和家风建设，引导党员清白做人、干净做事，营造风清气正的校园政治生态。',
];

const CONTENTS = [
  { type: 'article', title: '新时代党员理论武装工作要点', category: '理论学习', summary: '围绕读原著学原文悟原理，梳理基层理论学习的组织方法和检验标准。' },
  { type: 'article', title: '党支部组织生活规范化操作指南', category: '业务培训', summary: '介绍三会一课、主题党日和组织生活会的流程、记录与整改要求。' },
  { type: 'article', title: '密切联系群众的实践路径', category: '理论学习', summary: '从走访调研到解决问题，帮助党员掌握联系服务群众的基本方法。' },
  { type: 'article', title: '六项纪律简明读本', category: '纪律教育', summary: '用案例解读政治纪律、组织纪律等六项纪律的日常适用场景。' },
  { type: 'article', title: '校园意识形态工作责任清单', category: '时政要闻', summary: '明确党支部在宣传思想、网络舆论和阵地管理中的责任分工。' },
  { type: 'article', title: '发展党员工作程序详解', category: '业务培训', summary: '按阶段说明入党申请、培养考察、预备期教育和转正审批要求。' },
  { type: 'article', title: '高校统战工作入门', category: '理论学习', summary: '介绍基层党组织开展统战工作的基本任务和方式方法。' },
  { type: 'article', title: '青年党员成长手册', category: '党史知识', summary: '结合党的青年工作传统，提出青年党员政治训练和实践锻炼建议。' },
  { type: 'article', title: '党建与业务融合案例集', category: '业务培训', summary: '选取教学、科研、管理场景，说明如何把党建要求落到具体工作。' },
  { type: 'article', title: '廉洁文化进支部', category: '纪律教育', summary: '从警示教育、风险排查和家风建设三方面推进基层廉洁文化建设。' },
  { type: 'video', title: '专题片：全面从严治党永远在路上', category: '纪律教育', summary: '示范辅导片，片长约10分钟，系统讲解全面从严治党的实践要求。' },
  { type: 'video', title: '辅导课：中国式现代化的内涵与要求', category: '理论学习', summary: '示范辅导片，片长约11分钟，帮助党员把握中国式现代化的科学内涵。' },
  { type: 'video', title: '党课视频：伟大建党精神的时代价值', category: '党史知识', summary: '示范党课，片长约15分钟，阐释伟大建党精神的核心要义和现实意义。' },
  { type: 'video', title: '微党课：新时代好干部标准', category: '业务培训', summary: '示范微党课，片长约12分钟，解读信念坚定、为民服务、勤政务实等要求。' },
  { type: 'video', title: '宣讲视频：二十大报告核心要义', category: '时政要闻', summary: '示范宣讲片，片长约10分钟，梳理二十大报告的主题、使命和战略安排。' },
  { type: 'video', title: '警示教育片：纪律面前没有例外', category: '纪律教育', summary: '示范警示片，片长约11分钟，通过典型问题强化纪律意识和底线思维。' },
  { type: 'video', title: '组织生活示范：一次高质量主题党日', category: '业务培训', summary: '示范教学片，片长约15分钟，展示主题党日的策划、开展和总结流程。' },
  { type: 'video', title: '形势政策课：高质量发展与党建引领', category: '时政要闻', summary: '示范课程，片长约12分钟，说明党建如何服务高质量发展。' },
  { type: 'video', title: '党史故事会：长征中的理想信念', category: '党史知识', summary: '示范故事片，片长约10分钟，用长征故事讲理想信念教育。' },
  { type: 'video', title: '技能党课：做好新时代群众工作', category: '理论学习', summary: '示范技能课，片长约11分钟，讲解沟通、走访和解决问题的方法。' },
];

const TASKS = [
  { title: '全面从严治党专题片必修', contentTitle: '专题片：全面从严治党永远在路上', days: 21 },
  { title: '中国式现代化辅导课学习', contentTitle: '辅导课：中国式现代化的内涵与要求', days: 24 },
  { title: '伟大建党精神党课观摩', contentTitle: '党课视频：伟大建党精神的时代价值', days: 27 },
  { title: '二十大报告核心要义宣讲', contentTitle: '宣讲视频：二十大报告核心要义', days: 18 },
  { title: '高质量主题党日示范观摩', contentTitle: '组织生活示范：一次高质量主题党日', days: 30 },
  { title: '新时代党员理论武装专题', contentTitle: '新时代党员理论武装工作要点', days: 20 },
  { title: '组织生活规范化专项学习', contentTitle: '党支部组织生活规范化操作指南', days: 22 },
  { title: '六项纪律简明读本自学', contentTitle: '六项纪律简明读本', days: 16 },
  { title: '发展党员程序专题培训', contentTitle: '发展党员工作程序详解', days: 25 },
  { title: '廉洁文化进支部学习任务', contentTitle: '廉洁文化进支部', days: 28 },
];

function letters(options) {
  return options.map((text, index) => `${'ABCD'[index]}. ${text}`);
}

function q(type, category, difficulty, title, options, answer, analysis) {
  return {
    type,
    category,
    difficulty,
    title,
    options: type === 'judge' ? [] : letters(options),
    answer,
    analysis,
  };
}

const QUESTIONS = [
  q('single', '理论学习', 1, '中国共产党的根本宗旨是什么？', ['全心全意为人民服务', '以经济建设为中心', '解放和发展生产力', '实现共同富裕'], 'A', '党章规定，中国共产党的根本宗旨是全心全意为人民服务。'),
  q('single', '理论学习', 1, '中国共产党的最高理想和最终目标是什么？', ['全面建成小康社会', '实现中华民族伟大复兴', '实现共产主义', '基本实现现代化'], 'C', '党章明确，党的最高理想和最终目标是实现共产主义。'),
  q('single', '理论学习', 1, '中国共产党的根本组织原则是什么？', ['议会制', '民主集中制', '行政首长负责制', '委员会协商制'], 'B', '民主集中制是党的根本组织原则。'),
  q('single', '理论学习', 2, '党的领导核心作用，首先体现在哪个方面？', ['经济调控', '政治领导', '文化管理', '社会服务'], 'B', '党是最高政治领导力量，首先体现在政治领导。'),
  q('single', '理论学习', 2, '党员必须履行的义务不包括下列哪一项？', ['认真学习党的理论', '自觉遵守党的纪律', '可以不参加组织生活', '密切联系群众'], 'C', '参加党的组织生活是党员的基本义务。'),
  q('single', '理论学习', 1, '申请入党的基本条件之一是年满多少周岁？', ['16周岁', '18周岁', '20周岁', '22周岁'], 'B', '年满十八岁的中国工人、农民、军人、知识分子和其他社会阶层的先进分子可以申请入党。'),
  q('single', '理论学习', 2, '党支部的基本职责首先是什么？', ['抓好后勤保障', '宣传和执行党的路线方针政策', '组织文体活动', '负责行政审批'], 'B', '党支部要宣传和执行党的路线方针政策和决议。'),
  q('single', '理论学习', 1, '党的根本工作路线是什么？', ['群众路线', '封闭管理', '精英路线', '技术路线'], 'A', '群众路线是党的生命线和根本工作路线。'),
  q('single', '党史知识', 1, '中国共产党第一次全国代表大会召开于哪一年？', ['1919年', '1921年', '1927年', '1949年'], 'B', '中共一大于1921年召开。'),
  q('single', '党史知识', 1, '党的二十大召开于哪一年？', ['2017年', '2019年', '2022年', '2023年'], 'C', '中国共产党第二十次全国代表大会于2022年召开。'),
  q('single', '党史知识', 2, '井冈山革命根据地的开辟，标志着什么？', ['抗日战争开始', '中国革命走上建立农村根据地、以农村包围城市的道路', '新中国成立', '改革开放起步'], 'B', '井冈山根据地开辟了农村包围城市、武装夺取政权的道路。'),
  q('single', '党史知识', 2, '遵义会议最重要的意义是什么？', ['提出改革开放', '确立了毛泽东在党中央和红军的领导地位', '通过新党章', '宣布抗战胜利'], 'B', '遵义会议在最危急关头挽救了党、挽救了红军、挽救了中国革命。'),
  q('single', '党史知识', 1, '伟大建党精神的第一句是什么？', ['坚持真理、坚守理想', '践行初心、担当使命', '不怕牺牲、英勇斗争', '对党忠诚、不负人民'], 'A', '伟大建党精神以“坚持真理、坚守理想”开篇。'),
  q('single', '党史知识', 2, '党的十一届三中全会作出的历史性决策是什么？', ['建立新中国', '把党和国家工作中心转移到经济建设上来、实行改革开放', '加入世界贸易组织', '全面建成小康社会'], 'B', '十一届三中全会实现了新中国成立以来党的历史上具有深远意义的伟大转折。'),
  q('single', '纪律教育', 1, '党的纪律处分有几种？', ['三种', '四种', '五种', '六种'], 'C', '对党员的纪律处分包括警告、严重警告、撤销党内职务、留党察看、开除党籍五种。'),
  q('single', '纪律教育', 2, '下列哪一项属于政治纪律的要求？', ['按时上下班', '在重大原则问题上同党中央保持一致', '节约办公用电', '参加文体活动'], 'B', '政治纪律要求党员在思想上政治上行动上同党中央保持高度一致。'),
  q('single', '纪律教育', 1, '党员如果没有正当理由，连续多少个月不参加党的组织生活，就被认为是自行脱党？', ['三个月', '六个月', '九个月', '十二个月'], 'B', '连续六个月不参加党的组织生活，或不交纳党费，或不做党所分配的工作，就被认为是自行脱党。'),
  q('single', '纪律教育', 2, '中央八项规定精神重点整治的问题不包括？', ['形式主义', '官僚主义', '享乐主义和奢靡之风', '依法纳税'], 'D', '八项规定精神聚焦作风问题，依法纳税不属于其整治范围。'),
  q('single', '时政要闻', 1, '中国式现代化是哪一个主体领导的社会主义现代化？', ['全国人民代表大会', '中国共产党', '国务院', '全国政协'], 'B', '中国式现代化是中国共产党领导的社会主义现代化。'),
  q('single', '时政要闻', 2, '高质量发展的首要任务是什么？', ['扩大城市规模', '完整、准确、全面贯彻新发展理念', '提高房价', '减少科研投入'], 'B', '高质量发展必须完整、准确、全面贯彻新发展理念。'),
  q('single', '业务培训', 1, '“三会一课”中的“三会”通常不包括？', ['支部党员大会', '党支部委员会', '党小组会', '职工代表大会'], 'D', '三会指支部党员大会、党支部委员会、党小组会。'),
  q('single', '业务培训', 1, '主题党日一般应当多长时间开展一次？', ['每天', '每月', '每五年', '不定期即可'], 'B', '基层党组织一般每月相对固定一天开展主题党日。'),
  q('single', '业务培训', 2, '发展党员必须把什么标准放在首位？', ['学历标准', '年龄标准', '政治标准', '职务标准'], 'C', '发展党员必须把政治标准放在首位。'),
  q('single', '业务培训', 2, '民主评议党员的结果通常分为几类？', ['两类', '三类', '四类', '五类'], 'B', '民主评议党员结果一般分为优秀、合格、不合格等情形，实践中常按三类掌握。'),
  q('single', '理论学习', 2, '习近平新时代中国特色社会主义思想的核心内容被概括为哪个简称？', ['三个代表', '科学发展观', '十个明确等体系化概括', '两个凡是'], 'C', '这一思想的主要内容包括十个明确、十四个坚持、十三个方面成就等。'),
  q('single', '党史知识', 3, '党的七大确立的指导思想是什么？', ['毛泽东思想', '邓小平理论', '“三个代表”重要思想', '科学发展观'], 'A', '党的七大把毛泽东思想确立为党的指导思想。'),
  q('single', '纪律教育', 3, '对党组织的问责方式不包括？', ['检查', '通报', '改组', '行政拘留'], 'D', '对党组织的问责方式包括检查、通报、改组等，行政拘留不属于党内问责方式。'),
  q('single', '时政要闻', 2, '教育强国建设必须坚持的根本保证是什么？', ['党的全面领导', '扩大招生规模', '增加收费项目', '减少思政课'], 'A', '坚持党的全面领导是建设教育强国的根本保证。'),
  q('single', '业务培训', 1, '党费计算的基本依据是什么？', ['职务高低', '工资收入', '党龄长短', '所在城市'], 'B', '党员交纳党费的比例按月工资收入确定。'),
  q('single', '理论学习', 3, '新时代坚持和发展中国特色社会主义的基本方略被概括为多少个坚持？', ['八个', '十个', '十四个', '二十个'], 'C', '基本方略概括为“十四个坚持”。'),
  q('multiple', '理论学习', 2, '党员享有的权利包括哪些？', ['参加党的有关会议', '对党的工作提出建议和倡议', '可以公开发表反对党的决定的言论', '行使表决权、选举权'], 'A,B,D', '党员必须遵守党的纪律，不得公开发表反对党的决定的言论。'),
  q('multiple', '理论学习', 2, '党的建设必须坚决实现的基本要求包括？', ['坚持党的基本路线', '坚持解放思想、实事求是、与时俱进、求真务实', '坚持民主集中制', '坚持把商品交换原则引入党内生活'], 'A,B,C', '党内生活不能搞商品交换原则。'),
  q('multiple', '纪律教育', 2, '下列属于六项纪律的是？', ['政治纪律', '组织纪律', '廉洁纪律', '学术纪律'], 'A,B,C', '六项纪律为政治、组织、廉洁、群众、工作、生活纪律。'),
  q('multiple', '纪律教育', 3, '落实中央八项规定精神，应当重点纠治哪些问题？', ['形式主义', '官僚主义', '享乐主义', '奢靡之风'], 'A,B,C,D', '四风问题都是重点纠治对象。'),
  q('multiple', '党史知识', 2, '伟大建党精神的内涵包括？', ['坚持真理、坚守理想', '践行初心、担当使命', '不怕牺牲、英勇斗争', '对党忠诚、不负人民'], 'A,B,C,D', '四句话共同构成伟大建党精神。'),
  q('multiple', '党史知识', 2, '中国共产党在新民主主义革命时期的三大法宝是？', ['统一战线', '武装斗争', '党的建设', '计划经济'], 'A,B,C', '三大法宝是统一战线、武装斗争、党的建设。'),
  q('multiple', '时政要闻', 2, '中国式现代化的中国特色包括？', ['人口规模巨大的现代化', '全体人民共同富裕的现代化', '物质文明和精神文明相协调的现代化', '走先污染后治理的现代化'], 'A,B,C', '中国式现代化是人与自然和谐共生的现代化，不是先污染后治理。'),
  q('multiple', '业务培训', 2, '基层党组织开展组织生活的基本形式包括？', ['三会一课', '主题党日', '组织生活会', '股东会'], 'A,B,C', '股东会不是党内组织生活形式。'),
  q('multiple', '业务培训', 1, '党支部委员会一般应当讨论的事项包括？', ['学习贯彻上级党组织决策部署', '发展党员', '党员教育管理监督', '代替行政班子决定所有业务合同'], 'A,B,C', '党支部不能包办行政业务决策。'),
  q('multiple', '理论学习', 3, '学习习近平新时代中国特色社会主义思想，应当做到？', ['学思用贯通', '知信行统一', '只摘金句不读原文', '联系实际指导工作'], 'A,B,D', '不能停留在摘抄金句，要读原著、联系实际。'),
  q('multiple', '时政要闻', 2, '教育系统党建工作应当服务哪些目标？', ['立德树人', '为党育人、为国育才', '建设教育强国', '弱化思政课地位'], 'A,B,C', '必须加强而不是弱化思政课。'),
  q('multiple', '纪律教育', 1, '党员应当自觉接受哪些监督？', ['党内监督', '群众监督', '舆论监督', '可以拒绝任何监督'], 'A,B,C', '党员必须接受监督，不能拒绝监督。'),
  q('judge', '理论学习', 1, '中国共产党是中国工人阶级的先锋队，同时是中国人民和中华民族的先锋队。', [], 'true', '这是党章对党的性质的重要表述。'),
  q('judge', '理论学习', 1, '党员可以只交纳党费，不参加党的组织生活。', [], 'false', '参加组织生活和交纳党费都是党员义务。'),
  q('judge', '理论学习', 2, '民主集中制就是只要集中、不要民主。', [], 'false', '民主集中制是民主基础上的集中和集中指导下的民主相结合。'),
  q('judge', '党史知识', 1, '中国共产党在嘉兴南湖红船上完成了一大的闭幕，因此常以红船精神作为重要精神谱系内容。', [], 'true', '红船精神是中国革命精神之源。'),
  q('judge', '党史知识', 2, '长征的胜利说明理想信念是共产党人的政治灵魂。', [], 'true', '长征是理想信念的伟大远征。'),
  q('judge', '党史知识', 1, '党的二十大报告指出，从现在起中国共产党的中心任务是团结带领全国各族人民全面建成社会主义现代化强国、实现第二个百年奋斗目标，以中国式现代化全面推进中华民族伟大复兴。', [], 'true', '这是二十大报告明确的中心任务。'),
  q('judge', '纪律教育', 1, '党员领导干部可以在职务影响范围内为亲属承揽工程提供便利。', [], 'false', '这属于违反廉洁纪律的行为。'),
  q('judge', '纪律教育', 1, '对党忠诚老实，是党员的基本要求。', [], 'true', '对党忠诚老实写入党员义务。'),
  q('judge', '纪律教育', 2, '情节轻微的违纪问题，党组织可以不予过问。', [], 'false', '对违纪问题必须抓早抓小、动辄则咎。'),
  q('judge', '时政要闻', 1, '高质量发展只是经济领域的要求，与党建工作无关。', [], 'false', '党建工作要服务高质量发展，二者紧密相关。'),
  q('judge', '时政要闻', 2, '教育是国之大计、党之大计。', [], 'true', '这是党中央对教育工作的战略定位。'),
  q('judge', '业务培训', 1, '预备党员的义务同正式党员一样，但权利有所不同，没有表决权、选举权和被选举权。', [], 'true', '党章对预备党员的权利义务有明确规定。'),
  q('judge', '业务培训', 2, '党支部书记可以个人决定发展党员。', [], 'false', '发展党员必须经过支部大会讨论和上级党委审批。'),
  q('judge', '业务培训', 1, '主题党日可以简单用行政例会代替。', [], 'false', '主题党日是党内组织生活，不能用行政会代替。'),
  q('judge', '理论学习', 2, '学习党的创新理论，既要知其然，也要知其所以然、知其所以必然。', [], 'true', '这是对理论学习的更高要求。'),
  q('judge', '党史知识', 3, '改革开放只有经济意义，没有党内自我革命意义。', [], 'false', '改革开放是党领导的伟大社会革命，也推动党的自我革命。'),
  q('judge', '纪律教育', 3, '党员在网络上发表不当言论，因为不是工作时间，所以不受纪律约束。', [], 'false', '网络空间不是法外之地，党员言行同样受纪律约束。'),
  q('judge', '业务培训', 2, '流动党员可以长期脱离组织管理。', [], 'false', '党组织必须加强对流动党员的教育管理。'),
];

const PAPERS = [
  {
    title: '党章党规与理论武装测验',
    category: '理论学习',
    description: '围绕党的性质宗旨、组织原则和党员义务权利，检验理论学习成效。',
    start: 0,
    count: 20,
  },
  {
    title: '党史学习与时政要点测验',
    category: '党史知识',
    description: '覆盖党史重大事件、伟大建党精神和新时代使命任务。',
    start: 20,
    count: 20,
  },
  {
    title: '纪律教育与组织生活实务测验',
    category: '纪律教育',
    description: '检验六项纪律、八项规定精神和基层组织生活规范掌握情况。',
    start: 40,
    count: 20,
  },
];

function pad(num) {
  return String(num).padStart(3, '0');
}

function deadlineDate(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d} 23:59:59`;
}

async function main() {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'party_school',
    charset: 'utf8mb4',
  });

  const [[orgCount]] = await db.query('SELECT COUNT(*) AS c FROM organizations');
  const [orgs] = await db.query('SELECT id, name, type FROM organizations ORDER BY id');
  if (!orgs.length) throw new Error('请先初始化组织数据');

  const stats = { users: 0, contents: 0, videos: 0, tasks: 0, questions: 0, papers: 0 };

  const userCount = 100;
  for (let i = 0; i < userCount; i += 1) {
    const username = `member${pad(i + 1)}`;
    const [[exists]] = await db.query('SELECT id FROM users WHERE username = ?', [username]);
    if (exists) continue;
    const org = orgs[i % orgs.length];
    const isLeaderSlot = Math.floor(i / orgs.length) === 0 && ['branch', 'group', 'generalBranch'].includes(org.type);
    const [[hasSecretary]] = await db.query(
      "SELECT id FROM users WHERE organizationId = ? AND role = 'secretary' LIMIT 1",
      [org.id]
    );
    const role = isLeaderSlot && !hasSecretary ? 'secretary' : 'member';
    await db.query(
      'INSERT INTO users (username, password, realName, role, organizationId, phone, email, status) VALUES (?, ?, ?, ?, ?, ?, ?, 1)',
      [
        username,
        PASSWORD_HASH,
        `${SURNAMES[i % SURNAMES.length]}${GIVENS[Math.floor(i / SURNAMES.length) % GIVENS.length]}`,
        role,
        org.id,
        `139${String(80000000 + i).slice(-8)}`,
        `${username}@dxdx.local`,
      ]
    );
    stats.users += 1;
  }

  const contentIdsByTitle = new Map();
  for (let i = 0; i < CONTENTS.length; i += 1) {
    const item = CONTENTS[i];
    const [[exists]] = await db.query('SELECT id, type FROM contents WHERE title = ?', [item.title]);
    if (exists) {
      contentIdsByTitle.set(item.title, exists);
      continue;
    }
    const video = LONG_VIDEOS[i % LONG_VIDEOS.length];
    const body = item.type === 'video'
      ? video.url
      : ARTICLE_BODIES[i % ARTICLE_BODIES.length];
    const tags = item.type === 'video'
      ? `${item.category},视频课程,时长${video.minutes}分钟`
      : `${item.category},学习文章`;
    const [result] = await db.query(
      'INSERT INTO contents (title, type, coverUrl, bodyOrVideoUrl, summary, tags, isPublic, status, createdBy) VALUES (?, ?, ?, ?, ?, ?, 1, ?, 1)',
      [item.title, item.type, null, body, item.summary, tags, 'published']
    );
    contentIdsByTitle.set(item.title, { id: result.insertId, type: item.type });
    stats.contents += 1;
    if (item.type === 'video') stats.videos += 1;
  }

  await db.query(
    "UPDATE contents SET bodyOrVideoUrl = ? WHERE type = 'video' AND (bodyOrVideoUrl LIKE '%flower.mp4%' OR bodyOrVideoUrl LIKE '%googleapis.com%' OR bodyOrVideoUrl LIKE '%gtv-videos-bucket%')"
    , [LONG_VIDEOS[0].url]
  );

  const [[orgForTasks]] = await db.query('SELECT id FROM organizations ORDER BY id');
  for (let i = 0; i < TASKS.length; i += 1) {
    const item = TASKS[i];
    const content = contentIdsByTitle.get(item.contentTitle);
    if (!content) continue;
    const org = orgs[i % orgs.length];
    const [[exists]] = await db.query(
      'SELECT id FROM learning_tasks WHERE title = ? AND organizationId = ?',
      [item.title, org.id]
    );
    if (exists) continue;
    await db.query(
      'INSERT INTO learning_tasks (title, contentId, organizationId, deadline, description, status, createdBy) VALUES (?, ?, ?, ?, ?, ?, 1)',
      [
        item.title,
        content.id,
        org.id,
        deadlineDate(item.days),
        content.type === 'video' ? '视频必修任务，片长超过1分钟，须完整观看。' : '文章学习任务，须完成阅读并标记学完。',
        'published',
      ]
    );
    stats.tasks += 1;
  }
  void orgForTasks;

  const questionIds = [];
  for (const item of QUESTIONS) {
    const [[exists]] = await db.query('SELECT id FROM questions WHERE title = ? AND status = 1', [item.title]);
    if (exists) {
      questionIds.push(exists.id);
      continue;
    }
    const [result] = await db.query(
      'INSERT INTO questions (type, title, options, answer, analysis, category, difficulty, status, createdBy) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1)',
      [item.type, item.title, JSON.stringify(item.options), item.answer, item.analysis, item.category, item.difficulty]
    );
    questionIds.push(result.insertId);
    stats.questions += 1;
  }

  for (const paper of PAPERS) {
    const [[exists]] = await db.query('SELECT id FROM papers WHERE title = ? AND status <> 0', [paper.title]);
    if (exists) continue;
    const ids = questionIds.slice(paper.start, paper.start + paper.count);
    if (ids.length < 20) throw new Error(`试卷「${paper.title}」题目不足20道`);
    const [result] = await db.query(
      'INSERT INTO papers (title, category, description, duration, totalScore, passScore, status, createdBy) VALUES (?, ?, ?, 60, 100, 60, 2, 1)',
      [paper.title, paper.category, paper.description]
    );
    const score = Number((100 / ids.length).toFixed(2));
    const values = ids.flatMap((questionId, index) => [result.insertId, questionId, score, index + 1]);
    const placeholders = ids.map(() => '(?, ?, ?, ?)').join(',');
    await db.query(
      `INSERT INTO paper_questions (paperId, questionId, score, sort) VALUES ${placeholders}`,
      values
    );
    stats.papers += 1;
  }

  const [summary] = await db.query(`
    SELECT
      (SELECT COUNT(*) FROM users) AS users,
      (SELECT COUNT(*) FROM organizations) AS orgs,
      (SELECT COUNT(*) FROM contents WHERE status='published') AS contents,
      (SELECT COUNT(*) FROM contents WHERE status='published' AND type='video') AS videos,
      (SELECT COUNT(*) FROM learning_tasks WHERE status='published') AS tasks,
      (SELECT COUNT(*) FROM questions WHERE status=1) AS questions,
      (SELECT COUNT(*) FROM papers WHERE status=2) AS papers
  `);
  const [byOrg] = await db.query(
    `SELECT o.id, o.name, COUNT(u.id) AS members
     FROM organizations o LEFT JOIN users u ON u.organizationId = o.id
     GROUP BY o.id, o.name ORDER BY o.id`
  );
  const [paperSizes] = await db.query(
    `SELECT p.title, COUNT(pq.id) AS questionCount
     FROM papers p LEFT JOIN paper_questions pq ON pq.paperId = p.id
     WHERE p.status = 2 GROUP BY p.id, p.title`
  );

  console.log('本次新增', stats);
  console.log('当前总量', summary[0]);
  console.log('各组织人数');
  byOrg.forEach((row) => console.log(`  ${row.name}: ${row.members} 人`));
  console.log('已发布试卷');
  paperSizes.forEach((row) => console.log(`  ${row.title}: ${row.questionCount} 题`));
  console.log('\n演示账号密码均为 admin123，党员示例：member001 / admin123');

  await db.end();
}

main().catch((error) => {
  console.error('扩容失败:', error.message);
  process.exit(1);
});
