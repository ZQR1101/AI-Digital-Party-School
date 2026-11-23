const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const auditColumns = {
  requestId: 'VARCHAR(64) NULL',
  durationMs: 'INT UNSIGNED NULL',
  modelDurationMs: 'INT UNSIGNED NULL',
  model: 'VARCHAR(120) NULL',
  promptTokens: 'INT UNSIGNED NULL',
  completionTokens: 'INT UNSIGNED NULL',
  totalTokens: 'INT UNSIGNED NULL',
  attempts: 'TINYINT UNSIGNED NOT NULL DEFAULT 0',
  errorType: 'VARCHAR(64) NULL',
  fallbackReason: 'VARCHAR(64) NULL'
};

async function getMissingColumns(conn, database) {
  const [columns] = await conn.query(
    "SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'ai_audit_logs'",
    [database]
  );
  const existing = new Set(columns.map(column => column.name.toLowerCase()));
  return Object.entries(auditColumns).filter(([name]) => !existing.has(name.toLowerCase()));
}

async function upgrade() {
  const database = process.env.DB_NAME || 'party_school';
  if (!/^[a-zA-Z0-9_]+$/.test(database)) throw new Error('DB_NAME包含非法字符');
  let sql = fs.readFileSync(path.join(__dirname, 'sql', 'ai_upgrade.sql'), 'utf8');
  sql = sql.replace(/^USE\s+party_school\s*;/i, `USE \`${database}\`;`);
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    multipleStatements: true,
    charset: 'utf8mb4'
  });
  try {
    await conn.query(sql);
    const missing = await getMissingColumns(conn, database);
    if (missing.length) {
      const additions = missing.map(([name, definition]) => `ADD COLUMN \`${name}\` ${definition}`);
      try {
        await conn.query('ALTER TABLE ai_audit_logs ' + additions.join(', '));
      } catch (error) {
        if (error.code !== 'ER_DUP_FIELDNAME' || (await getMissingColumns(conn, database)).length) throw error;
      }
    }
    console.log('AI数据库升级完成：推荐反馈、推荐快照、调用审计');
  } finally {
    await conn.end();
  }
}

upgrade().catch(error => {
  console.error('❌ AI数据库升级失败:', error.message);
  process.exit(1);
});
