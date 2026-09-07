/**
 * 统一响应工具
 */
class ResponseHelper {
  /**
   * 成功响应
   * @param {object} res - Express response
   * @param {*} data - 返回数据
   * @param {string} message - 消息
   */
  static success(res, data = null, message = 'success') {
    return res.json({ code: 0, message, data });
  }

  /**
   * 分页成功响应
   * @param {object} res
   * @param {Array} list - 数据列表
   * @param {number} total - 总记录数
   * @param {string} message
   */
  static page(res, list, total, message = 'success') {
    return res.json({ code: 0, message, data: { total, list } });
  }

  /**
   * 失败响应
   */
  static error(res, message = '服务器异常', code = 500, statusCode = 500) {
    return res.status(statusCode).json({ code, message, data: null });
  }

  static badRequest(res, message = '参数错误') {
    return this.error(res, message, 400, 400);
  }

  static notFound(res, message = '资源不存在') {
    return this.error(res, message, 404, 404);
  }

  static forbidden(res, message = '无权限') {
    return this.error(res, message, 403, 403);
  }

  static unauthorized(res, message = '未登录或登录过期') {
    return this.error(res, message, 401, 401);
  }
}

module.exports = ResponseHelper;
