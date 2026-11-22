const express = require('express');
const { authenticate, requireAdmin } = require('../../middleware/auth');
const AssessmentService = require('../../services/assessmentService');
const ResponseHelper = require('../../utils/response');
const assessmentErrors = require('../assessmentErrors');

const router = express.Router();
router.use(authenticate, requireAdmin);

router.post('/', async (req, res, next) => {
  try {
    const assessment = await AssessmentService.publish(req.user, req.body || {});
    return ResponseHelper.success(res, assessment, '测评已下发');
  } catch (error) {
    return next(error);
  }
});

router.use(assessmentErrors);
module.exports = router;
