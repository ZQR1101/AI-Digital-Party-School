const { AssessmentError } = require('../services/assessmentService');
const ResponseHelper = require('../utils/response');

module.exports = function assessmentErrors(error, req, res, next) {
  if (error instanceof AssessmentError) {
    return ResponseHelper.error(res, error.message, error.status, error.status);
  }
  if (error.code === 'ER_NO_SUCH_TABLE') {
    return ResponseHelper.error(res, '测评服务尚未完成数据库升级', 503, 503);
  }
  return next(error);
};
