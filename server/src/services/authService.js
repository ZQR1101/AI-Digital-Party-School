const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/db');

class AuthService {
  /**
   * 用户登录
   */
  static async login(username, password) {
    const [rows] = await db.query(
      'SELECT u.*, o.name as organizationName FROM users u LEFT JOIN organizations o ON u.organizationId = o.id WHERE u.username = ? AND u.status = 1',
      [username]
    );
    if (rows.length === 0) return null;

    const user = rows[0];
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return null;

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
