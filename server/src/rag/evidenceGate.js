/**
 * 主题证据门禁（离线可复现的启发式判定）。
 *
 * 目标：防止「党的二十大题」「三严三实题」这类知识库未收录的问题，
 * 因通用字词（党的、内容、学习、召开）与资料偶然重叠而被误判为有依据回答。
 *
 * 做法：从问题中剥离通用的疑问/修饰词，只保留「主题短语」；
 * 要求主题短语至少有一个在检索到的前置分块标题或正文中逐字出现。
 * 这里不包含任何具体问题的硬编码，也不修改知识库或标注。
 */

// 通用疑问/修饰短语（与具体党务知识点无关）
const BOILERPLATE_PHRASES = [
  '是什么内容', '指的是什么', '具体指哪', '具体指', '有哪些方面', '有哪些', '哪些种类',
  '有没有', '是不是', '是什么', '什么是', '为什么', '怎么样', '怎么进行', '应该怎么',
  '怎样定义', '如何定义', '哪几个', '哪一年', '哪一天', '哪里', '哪些', '哪个',
  '主要讲了', '主要内容', '主要包括', '主要', '具体', '内容', '方面', '种类',
  '是什么', '什么', '怎么', '怎样', '如何', '是否', '多少', '几个', '为何',
  '情况下', '情况', '受到', '可能', '应该', '进行', '开始算', '统计上', '定义',
  '指哪', '旨在', '包括', '请问', '帮我', '一下', '说一下', '告诉我', '看一下',
  '需要', '要经过', '指标', '统计出来', '任期届满', '召开', '到底', '意思', '读取',
  '每个月', '每月', '一名', '一个', '这几', '那几', '有哪些'
];

// 通用单字虚词：仅删除不影响主题短语的语义
const BOILERPLATE_CHARS = /[的了吗呢啊吧嘛呀是在和与及有为上下的我你您他她它们这那几每按从到对被给让或且但哪交]/g;

/** 提取问题中的主题短语（长度≥2，英文/数字同样保留） */
function extractTopicPhrases(query) {
  let text = String(query || '').toLowerCase();
  text = text.replace(/[「」《》【】\[\]（）()〈〉，。？！；：、,.?!;:"'`~—_\-\s\d]/g, ' ');
  for (const phrase of BOILERPLATE_PHRASES) {
    text = text.split(phrase).join(' ');
  }
  text = text.replace(BOILERPLATE_CHARS, ' ');
  return [...new Set(text.split(/\s+/).filter((part) =>
    /^[\u4e00-\u9fa5a-z0-9_-]{2,}$/.test(part)
  ))];
}

/** 最长公共连续子串长度：长主题短语允许语序/修饰差异，但仍要求 5 字以上的连续证据 */
function longestCommonSubstring(a, b) {
  if (!a || !b) return 0;
  const prev = new Array(b.length + 1).fill(0);
  let best = 0;
  for (let i = 1; i <= a.length; i++) {
    const curr = new Array(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        curr[j] = prev[j - 1] + 1;
        if (curr[j] > best) best = curr[j];
      }
    }
    prev.splice(0, prev.length, ...curr);
  }
  return best;
}

/**
 * 判断检索到的分块是否为问题提供了主题证据。
 * @returns {{pass:boolean, phrases:string[], matched:string[], chunkIndex:number|null}}
 */
function hasTopicEvidence(query, chunks, options = {}) {
  const phrases = extractTopicPhrases(query);
  const topK = Math.max(1, Number(options.topK) || 3);
  if (!phrases.length) {
    return { pass: true, phrases, matched: [], chunkIndex: null, reason: 'no_topic_phrase' };
  }
  for (let i = 0; i < Math.min(topK, chunks.length); i++) {
    const chunk = chunks[i];
    const text = `${chunk.title || ''}\n${chunk.content || ''}`.toLowerCase();
    const matched = phrases.filter((phrase) => {
      if (text.includes(phrase)) return true;
      // 长主题短语允许「转移党员组织关系」与「党员组织关系转移」这类修饰顺序差异，
      // 但必须存在至少 5 个连续字作为证据；短短语（含年份/专有名词）要求逐字命中。
      return phrase.length >= 5 && longestCommonSubstring(phrase, text) >= 5;
    });
    if (matched.length) return { pass: true, phrases, matched, chunkIndex: i };
  }
  return { pass: false, phrases, matched: [], chunkIndex: null, reason: 'topic_not_found' };
}

module.exports = { extractTopicPhrases, hasTopicEvidence };
