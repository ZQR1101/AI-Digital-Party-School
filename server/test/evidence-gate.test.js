const test = require('node:test');
const assert = require('node:assert/strict');
const { extractTopicPhrases, hasTopicEvidence } = require('../src/rag/evidenceGate');

const CHUNKS = [
  { title: '党费收缴使用与管理规定', content: '党员应当主动、按月、足额交纳党费。' },
  { title: '党组织生活制度规范', content: '“三会一课”是指定期召开支部党员大会、支部委员会会议、党小组会，按时上好党课。' },
  { title: '党员组织关系与党籍管理', content: '党员组织关系转移需要办理手续，一般应在六个月内完成。' },
  { title: '党史学习教育要点', content: '党史学习教育要点' }
];

test('空主题不再默认通过，但只影响完全无主题短语的问题', () => {
  for (const query of ['这是什么？', '请介绍一下']) {
    assert.deepEqual(extractTopicPhrases(query), []);
    const result = hasTopicEvidence(query, CHUNKS);
    assert.equal(result.pass, false);
    assert.equal(result.reason, 'no_topic_phrase');
    assert.equal(result.uncertain, true);
  }

  // 有明确主题的问题仍按证据匹配，不因空主题回退策略被一律拒答。
  const normal = hasTopicEvidence('什么情况下需要转移党员组织关系？', CHUNKS);
  assert.equal(normal.pass, true);
  assert.ok(normal.matched.includes('组织关系'));
});

test('同义改写与简称通过领域词归一后能命中证据', () => {
  for (const query of ['党费缴纳标准是什么', '党费收缴比例是多少']) {
    const result = hasTopicEvidence(query, CHUNKS);
    assert.equal(result.pass, true, query);
    assert.ok(result.matched.includes('党费'), query);
  }

  const abbreviation = hasTopicEvidence('三会一课是什么', CHUNKS);
  assert.equal(abbreviation.pass, true);
  assert.ok(abbreviation.matched.includes('三会一课'));
});

test('多意图问题任一主题命中即通过，并记录未命中主题供诊断', () => {
  const result = hasTopicEvidence('党费怎么交和组织关系怎么转', CHUNKS);
  assert.equal(result.pass, true);
  assert.deepEqual(result.phrases.sort(), ['党费', '组织关系']);
  assert.deepEqual(result.matched, ['党费']);

  // 两个主题都无证据时仍拒绝，避免多意图绕过门禁。
  const none = hasTopicEvidence('量子力学和红烧肉怎么做', CHUNKS);
  assert.equal(none.pass, false);
  assert.equal(none.reason, 'topic_not_found');
});

test('相似主题不得因放宽匹配而误通过', () => {
  // 「两学一做」不在知识库，只有「学习教育」四字偶然重叠，不能算有证据。
  const result = hasTopicEvidence('两学一做学习教育具体指哪两学哪一做', CHUNKS);
  assert.equal(result.pass, false);
  assert.equal(result.reason, 'topic_not_found');
});
