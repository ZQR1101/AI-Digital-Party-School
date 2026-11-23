const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const { LoginGuard } = require('../utils/loginGuard');

// 单例登录防护：连续失败锁定，配置来自环境变量
const loginGuard = new LoginGuard({
  maxAttempts: Number(process.env.LOGIN_MAX_ATTEMPTS || 5),
  lockMs: Number(process.env.LOGIN_LOCK_MINUTES || 15) * 60 * 1000,
});

class AuthService {
  /** 暴露给测试/路由查询锁定状态 */
  static get loginGuard() { return loginGuard; }

  /**
   * 用户登录。返回 { locked, retryAfterMs } 表示被临时锁定。
   */
  static async login(username, password, ip = '') {
    const guardKey = `${username}@${ip}`;
    const remaining = loginGuard.remainingLockMs(guardKey);
    if (remaining > 0) return { locked: true, retryAfterMs: remaining };

    const [rows] = await db.query(
      'SELECT u.*, o.name as organizationName FROM users u LEFT JOIN organizations o ON u.organizationId = o.id WHERE u.username = ? AND u.status = 1',
      [username]
    );
    if (rows.length === 0) {
      loginGuard.fail(guardKey);
      return null;
    }

    const user = rows[0];
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      loginGuard.fail(guardKey);
      return null;
    }
    loginGuard.succeed(guardKey);

    const payload = {
      userId: user.id,
      username: user.username,
      role: user.role,
      organizationId: user.organizationId
    };
    const token = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || '24h'
    });

    return {
      token,
      user: {
        id: user.id,
        username: user.username,
        realName: user.realName,
        role: user.role,
        organizationId: user.organizationId,
        organizationName: user.organizationName
      }
    };
  }

  /**
   * 获取当前用户信息
   */
  static async getUserInfo(userId) {
    const [rows] = await db.query(
      'SELECT u.id, u.username, u.realName, u.role, u.organizationId, u.phone, u.email, o.name as organizationName FROM users u LEFT JOIN organizations o ON u.organizationId = o.id WHERE u.id = ?',
      [userId]
    );
    return rows[0] || null;
  }
}

module.exports = AuthService;
