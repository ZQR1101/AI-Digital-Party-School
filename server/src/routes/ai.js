const express = require('express');
const { authenticate, loadCurrentUser } = require('../middleware/auth');
const { accessError, requireStatisticsRole } = require('../services/organizationAccess');
const OrganizationQueryService = require('../services/organizationQueryService');
const RecommendationService = require('../services/recommendationService');
const ReportService = require('../services/reportService');
const { runAiRequest } = require('../ai/request');
const { METRICS } = require('../ai/queryParser');
const RagService = require('../services/ragService');

const router = express.Router();
router.use(authenticate, loadCurrentUser);

const organization = 'organization_query';
const recommendation = 'learning_recommendation';
const evaluation = 'learning_evaluation';
const knowledge = 'knowledge_qa';
const scenes = new Set([organization, recommendation, evaluation, knowledge]);

function detectScene(message = '') {
  if (/我最近|薄弱|掌握得不好|重点学什么|怎么学|建议/.test(message)) return evaluation;
  if (/推荐|学什么|学习内容|好课/.test(message)) return recommendation;
  if (/完成率|及格率|平均分|时长|活跃|趋势|月度|哪几个月|排名|统计|支部数据/.test(message)) return organization;
  return knowledge;
}

function requireText(value, label) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || text.length > 1000) throw accessError(400, label + '须为 1 至 1000 字的文本');
  return text;
}

async function queryOrganization(message, actor, trace) {
  requireStatisticsRole(actor);
  const result = await OrganizationQueryService.query(requireText(message, '问题'), actor, trace);
  trace.resultMode = 'query';
  return result;
}

router.get('/metrics', (req, res) => runAiRequest(req, res, organization, 'metrics', ({ actor, trace }) => {
  requireStatisticsRole(actor);
  trace.resultMode = 'lookup';
  return Object.entries(METRICS).map(([key, value]) => ({ key, ...value }));
}));

router.get('/knowledge/search', (req, res) => runAiRequest(req, res, 'knowledge_search', 'knowledge', async ({ trace }) => {
  const query = requireText(req.query.q, '查询词');
  const results = await RagService.hybridSearch(query, { topK: Number(req.query.topK) || 5 });
  trace.resultMode = 'lookup';
  return { query, results };
}));

router.post('/knowledge/ask', (req, res) => runAiRequest(req, res, knowledge, 'ask', async ({ actor, trace }) => {
  const question = requireText(req.body?.question || req.body?.message, '问题');
  const result = await RagService.ask(question, { actor, trace });
  trace.resultMode = result.isGrounded ? 'grounded_rag' : 'no_knowledge';
  return result;
}));

router.post('/knowledge/personalized', (req, res) => runAiRequest(req, res, evaluation, 'personalized_rag', async ({ actor, trace }) => {
  const question = requireText(req.body?.question || req.body?.message, '问题');
  const result = await RagService.personalizedAsk(question, actor, trace);
  trace.resultMode = 'personalized_rag';
  return result;
}));

router.post('/query', (req, res) => runAiRequest(req, res, organization, 'query', ({ actor, trace }) => (
  queryOrganization(req.body?.message, actor, trace)
)));

router.get('/recommendations/me', (req, res) => runAiRequest(req, res, recommendation, 'recommendations', ({ actor, trace }) => (
  RecommendationService.getForUser(actor.userId, req.query.limit, trace)
)));

router.post('/recommendations/:contentId/feedback', (req, res) => runAiRequest(req, res, recommendation, 'feedback', async ({ actor, trace }) => {
  const contentId = Number(req.params.contentId);
  const action = req.body?.action;
  if (!Number.isSafeInteger(contentId) || contentId < 1 || !['view', 'start', 'complete', 'dismiss'].includes(action)) {
    throw accessError(400, '推荐反馈参数无效');
  }
  const result = await RecommendationService.recordFeedback(actor.userId, contentId, action);
  trace.resultMode = 'write';
  return result;
}));

router.get('/report/me', (req, res) => runAiRequest(req, res, evaluation, 'report', ({ actor, trace }) => (
  ReportService.generateReport(actor.userId, trace)
)));

router.post('/chat', (req, res) => {
  const explicit = req.body?.scene;
  const message = req.body?.message;
  const scene = explicit == null || explicit === '' ? detectScene(typeof message === 'string' ? message : '') : explicit;
  return runAiRequest(req, res, scenes.has(scene) ? scene : 'unknown', 'chat', async ({ actor, trace, requestId }) => {
    if (!scenes.has(scene)) throw accessError(400, 'scene 仅支持 organization_query、learning_recommendation、learning_evaluation、knowledge_qa');
    const text = requireText(message, '问题');
    let result;
    if (scene === organization) result = await queryOrganization(text, actor, trace);
    if (scene === recommendation) result = await RecommendationService.getForUser(actor.userId, req.body?.limit, trace);
    if (scene === evaluation) {
      if (/薄弱|掌握得不好|重点学什么|怎么学|建议/.test(text)) {
        result = await RagService.personalizedAsk(text, actor, trace);
      } else {
        result = await ReportService.generateReport(actor.userId, trace);
      }
    }
    if (scene === knowledge) result = await RagService.ask(text, { actor, trace });
    return {
      requestId,
      scene,
      answer: result.answer || result.narrative?.summary || '',
      data: result,
      charts: result.charts || [],
      sources: result.sources || [],
      suggestions: result.narrative?.suggestions || result.suggestions || [],
      generatedAt: new Date().toISOString()
    };
  });
});

module.exports = router;
