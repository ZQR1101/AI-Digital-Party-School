const express = require('express');
const { authenticate } = require('../middleware/auth');
const { accessError, requireStatisticsRole } = require('../services/organizationAccess');
const OrganizationQueryService = require('../services/organizationQueryService');
const RecommendationService = require('../services/recommendationService');
const ReportService = require('../services/reportService');
const { runAiRequest } = require('../ai/request');
const { METRICS } = require('../ai/queryParser');
const RagService = require('../services/ragService');

const router = express.Router();
router.use(authenticate);

const organization = 'organization_query';
const recommendation = 'learning_recommendation';
const evaluation = 'learning_evaluation';
const scenes = new Set([organization, recommendation, evaluation]);

function detectScene(message = '') {
  if (/推荐|学什么|学习内容/.test(message)) return recommendation;
  if (/报告|评价|评分|学习表现/.test(message)) return evaluation;
  return organization;
}

function requireText(value, label) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || text.length > 1000) throw accessError(400, label + '须为 1 至 1000 字的文本');
  return text;
}

async function queryOrganization(message, actor, trace) {
  requireStatisticsRole(actor);
  const result = await OrganizationQueryService.query(requireText(message, '问题'), actor);
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
  const results = await RagService.search(query, req.query.topK);
  trace.resultMode = 'lookup';
  return { query, results };
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
    if (!scenes.has(scene)) throw accessError(400, 'scene 仅支持 organization_query、learning_recommendation、learning_evaluation');
    const text = requireText(message, '问题');
    let result;
    if (scene === organization) result = await queryOrganization(text, actor, trace);
    if (scene === recommendation) result = await RecommendationService.getForUser(actor.userId, req.body?.limit, trace);
    if (scene === evaluation) result = await ReportService.generateReport(actor.userId, trace);
    return {
      requestId,
      scene,
      answer: result.answer || result.narrative?.summary || '',
      data: result,
      charts: result.charts || [],
      sources: result.sources || [],
      suggestions: result.narrative?.suggestions || [],
      generatedAt: new Date().toISOString()
    };
  });
});

module.exports = router;
