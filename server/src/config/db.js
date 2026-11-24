const mysql = require('mysql2/promise');
const logger = require('../utils/logger');

require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'party_school',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4',
  // MySQL container stores DATETIME values in UTC. Parse them as UTC so
  // JSON serialization does not apply the host machine's +08:00 offset twice.
  timezone: 'Z'
});

// 启动时主动探测连接会创建常驻 socket，导致 node --test 测试进程在用例
// 跑完后仍无法退出（表现为“测试挂起”）。测试环境下跳过探测，改为首次
// 真实查询时惰性建连；生产环境行为保持不变。
const skipConnectProbe = process.env.NODE_ENV === 'test'
  || Boolean(process.env.NODE_TEST_CONTEXT)
  || Boolean(process.env.JEST_WORKER_ID)
  || process.env.DB_SKIP_CONNECT_CHECK === '1';

if (!skipConnectProbe) {
  pool.getConnection()
    .then(conn => {
      logger.info('[DB] MySQL 连接成功');
      conn.release();
    })
    .catch(err => {
      logger.error('[DB] MySQL 连接失败:', err.message);
    });
}

module.exports = pool;
