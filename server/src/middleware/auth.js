const jwt = require('jsonwebtoken');
require('dotenv').config();

/**
 * JWT 认证中间件
 * 从 Authorization: Bearer <token> 中提取并验证 token
 */
function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ code: 401, message: '未登录或登录已过期', data: null });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // { userId, username, role, organizationId }
    next();
  } catch (err) {
    return res.status(401).json({ code: 401, message: '登录已过期，请重新登录', data: null });
  }
}

/**
 * 角色授权中间件工厂
 * @param  {...string} roles 允许访问的角色列表
 */
function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ code: 401, message: '未登录', data: null });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ code: 403, message: '无权限访问', data: null });
    }
    next();
  };
}

/**
 * 仅允许管理员或支部书记
 */
function requireAdmin(req, res, next) {
  if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'secretary')) {
    return res.status(403).json({ code: 403, message: '无权限访问', data: null });
  }
  next();
}

module.exports = { authenticate, authorize, requireAdmin };
