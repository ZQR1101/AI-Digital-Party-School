const express = require('express');
const { authenticate, authorize } = require('../middleware/auth');
const AssessmentService = require('../services/assessmentService');
const ResponseHelper = require('../utils/response');
const assessmentErrors = require('./assessmentErrors');

const router = express.Router();
router.use(authenticate, authorize('member'));

router.get('/', async (req, res, next) => {
  try {
    return ResponseHelper.success(res, await AssessmentService.list(req.user.userId));
  } catch (error) {
    return next(error);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    return ResponseHelper.success(res, await AssessmentService.detail(req.user.userId, req.params.id));
  } catch (error) {
    return next(error);
  }
});

router.post('/:id/submit', async (req, res, next) => {
  try {
    const attempt = await AssessmentService.submit(req.user.userId, req.params.id, req.body?.answers);
    return ResponseHelper.success(res, attempt, '交卷成功');
  } catch (error) {
    return next(error);
  }
});

router.use(assessmentErrors);
module.exports = router;
