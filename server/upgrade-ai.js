const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function upgrade() {
  const database = process.env.DB_NAME || 'party_school';
  if (!/^[a-zA-Z0-9_]+$/.test(database)) throw new Error('DB_NAME包含非法字符');
  let sql = fs.readFileSync(path.join(__dirname, 'sql', 'ai_upgrade.sql'), 'utf8');
  sql = sql.replace(/^USE\s+party_school\s*;/i, `USE \`${database}\`;`);
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '123456',
    multipleStatements: true,
    charset: 'utf8mb4'
  });
  await conn.query(sql);
  await conn.end();
  console.log('✅ AI数据库升级完成：recommendation_feedback、ai_audit_logs');
}

upgrade().catch(error => {
  console.error('❌ AI数据库升级失败:', error.message);
  process.exit(1);
});
