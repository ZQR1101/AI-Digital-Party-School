// RAG 质量修复回归测试：
// 1) AI 助教快捷提问按当前模式遍历 2) 个性化 RAG 相关性拒答门禁
// 3) 模型引用编号校验 4) PDF/Word 解析 5) API 配置同时检查 URL 与 Key
process.env.NODE_ENV = 'test';
process.env.QDRANT_ENABLED = 'false';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DocumentParser = require('../src/rag/documentParser');
const { EmbeddingClient } = require('../src/rag/vectorStore');
const Reranker = require('../src/rag/reranker');
const RagService = require('../src/services/ragService');
const { AIClient } = require('../src/services/aiClient');
const LearningProfileService = require('../src/services/learningProfileService');

// dotenv 可能在依赖导入链中重新注入变量，测试内显式清理，确保走确定性本地逻辑
for (const key of [
  'EMBEDDING_API_URL', 'RERANKER_API_URL', 'EMBEDDING_API_KEY',
  'RERANKER_API_KEY', 'DASHSCOPE_API_KEY', 'AI_API_KEY', 'AI_API_URL'
]) {
  delete process.env[key];
}

test('快捷提问：前端按当前模式遍历，而不是遍历整个模式对象', () => {
  const vue = fs.readFileSync(
    path.join(__dirname, '../../src-qianduan/AiAssistant-index.vue'), 'utf8'
  );
  assert.match(vue, /v-for="q in currentQuickQuestions"/);
  assert.match(vue, /quickQuestions\[mode\.value\]/);
  assert.doesNotMatch(vue, /v-for="q in quickQuestions"/);
});

test('引用校验：仅保留指向真实来源的 [n]，越界编号被剔除并记录', () => {
  const result = RagService.sanitizeCitations('正确[1] 越界[9] 非法[0] 末尾[4]', 4);
  assert.equal(result.answer, '正确[1] 越界 非法 末尾[4]');
  assert.deepEqual(result.invalidCitations, [9, 0]);
});

test('引用校验：知识问答中模型生成的越界引用不会返回给学员', async () => {
  const original = AIClient.generateRagAnswer;
  AIClient.generateRagAnswer = async () => '依据资料[1]，另有[8]补充说明。';
  const trace = {};
  try {
    const result = await RagService.ask('组织生活会与民主生活会有什么区别？', { trace });
    assert.match(result.answer, /\[1\]/);
    assert.doesNotMatch(result.answer, /\[8\]/);
    assert.deepEqual(trace.invalidCitations, [8]);
  } finally {
    AIClient.generateRagAnswer = original;
  }
});

test('个性化 RAG：检索结果相关性不足时拒答，不使用画像数据伪造知识依据', async () => {
  const original = LearningProfileService.getProfile;
  LearningProfileService.getProfile = async () => ({
    userName: '测试学员',
    completionRate: 80,
    completedTasks: 8,
    totalTasks: 10,
    weakCategories: [],
    recentWrongQuestions: []
  });
  const trace = {};
  try {
    const result = await RagService.personalizedAsk(
      '外星文明飞船发动机维修手册如何保养？', { userId: 1 }, trace
    );
    assert.equal(result.isGrounded, false);
    assert.equal(result.relevantCount, 0);
    assert.equal(result.sources.length, 0);
    assert.match(result.answer, /暂未收录/);
    assert.equal(result.profileSummary.userName, '测试学员');
    assert.equal(trace.ragOutcome, 'no_relevant_knowledge');
  } finally {
    LearningProfileService.getProfile = original;
  }
});

test('文档解析：PDF 与 .docx 均可提取文本，同步接口保持向下兼容', async () => {
  const fixtureDir = path.join(__dirname, 'fixtures');
  const chunks = await DocumentParser.loadFromDirectoryAsync(fixtureDir);
  assert.ok(chunks.some(c => c.source === 'sample.pdf' && c.content.includes('Party branch meeting')));
  assert.ok(chunks.some(c => c.source === 'sample.docx' && c.content.includes('Party branch meeting')));
  assert.equal(DocumentParser.loadFromDirectory(fixtureDir).length, 0);
});

test('配置检测：只配 URL 不配 Key 时判定为未接入真实模型', () => {
  const keys = ['DASHSCOPE_API_KEY', 'EMBEDDING_API_KEY', 'AI_API_KEY', 'RERANKER_API_KEY',
    'EMBEDDING_API_URL', 'RERANKER_API_URL'];
  const previous = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  const previousBackend = EmbeddingClient.lastBackend;
  try {
    for (const k of keys) delete process.env[k];
    process.env.EMBEDDING_API_URL = 'https://example.com/v1/embeddings';
    process.env.RERANKER_API_URL = 'https://example.com/v1/rerank';
    EmbeddingClient.lastBackend = null;

    assert.equal(EmbeddingClient.isApiConfigured(), false);
    assert.equal(Reranker.isApiConfigured(), false);
    assert.equal(EmbeddingClient.getBackendInfo().configured, false);

    process.env.DASHSCOPE_API_KEY = 'sk-test-key';
    assert.equal(EmbeddingClient.isApiConfigured(), true);
    assert.equal(Reranker.isApiConfigured(), true);
    assert.equal(EmbeddingClient.getBackendInfo().configured, true);
  } finally {
    EmbeddingClient.lastBackend = previousBackend;
    for (const k of keys) {
      if (previous[k] === undefined) delete process.env[k];
      else process.env[k] = previous[k];
    }
  }
});
