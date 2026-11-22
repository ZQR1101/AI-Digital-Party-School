const express = require('express');
const router = express.Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const ResponseHelper = require('../utils/response');
const OrganizationQueryService = require('../services/organizationQueryService');
const RecommendationService = require('../services/recommendationService');
const ReportService = require('../services/reportService');
const AIAuditService = require('../services/aiAuditService');
const { METRICS } = require('../ai/queryParser');
const RagService = require('../services/ragService');

router.use(authenticate);

function detectScene(message) {
  const text = String(message || '');
  if (/推荐|学什么|学习内容/.test(text)) return 'learning_recommendation';
  if (/报告|评价|评分|学习表现/.test(text)) return 'learning_evaluation';
  return 'organization_query';
}

function ensureManager(req, res) {
  if (!['admin', 'secretary'].includes(req.user.role)) {
    ResponseHelper.forbidden(res, '组织数据查询仅对管理员和支部书记开放');
    return false;
  }
  return true;
}

async function handleError(res, error) {
  const status = Number(error.statusCode || (error.code === 'UNSUPPORTED_METRIC' ? 400 : 500));
  return ResponseHelper.error(res, error.message || 'AI服务异常', status, status);
}

router.get('/metrics', requireAdmin, (req, res) => {
  const metrics = Object.entries(METRICS).map(([key, value]) => ({
    key,
    name: value.name,
    unit: value.unit,
    aliases: value.aliases
  }));
  return ResponseHelper.success(res, metrics);
});

router.get('/knowledge/search', async (req, res) => {
  const query = String(req.query.q || '').trim();
  if (!query) return ResponseHelper.badRequest(res, 'q不能为空');
  const results = await RagService.search(query, req.query.topK);
  return ResponseHelper.success(res, { query, results });
});

router.post('/query', async (req, res) => {
  if (!ensureManager(req, res)) return;
  const message = String(req.body.message || '').trim();
  if (!message) return ResponseHelper.badRequest(res, 'message不能为空');
  try {
    const result = await OrganizationQueryService.query(message, req.user);
    await AIAuditService.record({
      actor: req.user,
      scene: 'organization_query',
      question: message,
      parsedIntent: result.query,
      resultSummary: result.answer
    });
    return ResponseHelper.success(res, result);
  } catch (error) {
    await AIAuditService.record({ actor: req.user, scene: 'organization_query', question: message, success: false, errorMessage: error.message });
    return handleError(res, error);
  }
});

router.get('/recommendations/me', async (req, res) => {
  try {
    const result = await RecommendationService.getForUser(req.user.userId, req.query.limit);
    await AIAuditService.record({ actor: req.user, scene: 'learning_recommendation', question: '获取个性化推荐', resultSummary: result.answer });
    return ResponseHelper.success(res, result);
  } catch (error) {
    return handleError(res, error);
  }
});

router.post('/recommendations/:contentId/feedback', async (req, res) => {
  try {
    const result = await RecommendationService.recordFeedback(
      req.user.userId,
      Number(req.params.contentId),
      String(req.body.action || '')
    );
    return ResponseHelper.success(res, result, '推荐反馈已记录');
  } catch (error) {
    return handleError(res, error);
  }
});

router.get('/report/me', async (req, res) => {
  try {
    const report = await ReportService.generateReport(req.user.userId);
    await AIAuditService.record({ actor: req.user, scene: 'learning_evaluation', question: '生成个人学习报告', resultSummary: report.score == null ? report.level : `${report.score}分/${report.level}` });
    return ResponseHelper.success(res, report);
  } catch (error) {
    return handleError(res, error);
  }
});

router.post('/chat', async (req, res) => {
  const message = String(req.body.message || '').trim();
  if (!message) return ResponseHelper.badRequest(res, 'message不能为空');
  const scene = String(req.body.scene || '').trim() || detectScene(message);
  try {
    let result;
    if (scene === 'organization_query') {
      if (!ensureManager(req, res)) return;
      result = await OrganizationQueryService.query(message, req.user);
    } else if (scene === 'learning_recommendation') {
      result = await RecommendationService.getForUser(req.user.userId, req.body.limit);
    } else if (scene === 'learning_evaluation') {
      result = await ReportService.generateReport(req.user.userId);
      result.answer = result.narrative.summary;
    } else {
      return ResponseHelper.badRequest(res, 'scene仅支持 organization_query、learning_recommendation、learning_evaluation');
    }
    const response = {
      requestId: `AI-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      scene,
      answer: result.answer || result.narrative?.summary || '',
      data: result,
      charts: result.charts || [],
      sources: result.sources || [],
      suggestions: result.narrative?.suggestions || [],
      generatedAt: new Date().toISOString()
    };
    await AIAuditService.record({ actor: req.user, scene, question: message, parsedIntent: result.query, resultSummary: response.answer });
    return ResponseHelper.success(res, response);
  } catch (error) {
    await AIAuditService.record({ actor: req.user, scene, question: message, success: false, errorMessage: error.message });
    return handleError(res, error);
  }
});

module.exports = router;
