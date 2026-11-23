const express = require('express');
const router = express.Router();
const AuthService = require('../services/authService');
const ResponseHelper = require('../utils/response');
const { authenticate } = require('../middleware/auth');

/**
 * POST /api/auth/login
 * 用户登录，返回 token 与用户信息
 */
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return ResponseHelper.badRequest(res, '用户名和密码不能为空');
    }

    const ip = req.ip || req.socket?.remoteAddress || '';
    const result = await AuthService.login(username, password, ip);
    if (result && result.locked) {
      const minutes = Math.max(1, Math.ceil((result.retryAfterMs || 0) / 60000));
      return res.status(429).json({
        code: 429,
        message: `登录失败次数过多，请 ${minutes} 分钟后再试`,
        data: null
      });
    }
    if (!result) {
      return ResponseHelper.unauthorized(res, '用户名或密码错误');
    }

    return ResponseHelper.success(res, result, '登录成功');
  } catch (err) {
    console.error('Login error:', err);
    return ResponseHelper.error(res, '服务器异常');
  }
});

/**
 * GET /api/users/me
 * 获取当前登录用户信息与角色
 */
router.get('/users/me', authenticate, async (req, res) => {
  try {
    const user = await AuthService.getUserInfo(req.user.userId);
    if (!user) {
      return ResponseHelper.notFound(res, '用户不存在');
    }
    return ResponseHelper.success(res, user);
  } catch (err) {
    console.error('Get user info error:', err);
    return ResponseHelper.error(res);
  }
});

module.exports = router;
