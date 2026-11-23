const jwt = require('jsonwebtoken');
const db = require('../config/db');
require('dotenv').config();

/**
 * JWT 认证中间件
 * 从 Authorization: Bearer <token> 中提取并验证 token
 * 注意：JWT 中的 role 仅作展示，权限判定一律以数据库实时角色为准（见 loadCurrentUser）。
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
 * 从数据库加载当前用户实时身份，覆盖 JWT 中的 role/organizationId/status。
 * 这样即使用户角色被降级或账号被停用，已签发的旧 token 也无法继续提权。
 * 挂在 authenticate 之后、各授权中间件之前。
 */
async function loadCurrentUser(req, res, next) {
  if (!req.user?.userId) return res.status(401).json({ code: 401, message: '未登录', data: null });
  try {
    const [rows] = await db.query(
      'SELECT id AS userId, username, role, organizationId, status FROM users WHERE id = ?',
      [req.user.userId]
    );
    const current = rows[0];
    if (!current || Number(current.status) !== 1) {
      return res.status(403).json({ code: 403, message: '账号不存在或已停用', data: null });
    }
    req.user = { ...req.user, ...current };
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * 角色授权中间件工厂（基于数据库实时角色）
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

/** 仅系统管理员：全局性资源（人员、组织、题库、试卷、内容） */
const requireAdmin = authorize('admin');

/** 管理员或支部书记：本组织范围内的业务（任务、测评、统计、问数） */
const requireManager = authorize('admin', 'secretary');

module.exports = {
  authenticate,
  loadCurrentUser,
  authorize,
  requireAdmin,
  requireManager,
};
