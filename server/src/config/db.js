const mysql = require('mysql2/promise');
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

// 测试连接
pool.getConnection()
  .then(conn => {
    console.log('[DB] MySQL 连接成功');
    conn.release();
  })
  .catch(err => {
    console.error('[DB] MySQL 连接失败:', err.message);
  });

module.exports = pool;
