// 幂等数据库初始化/迁移脚本。
// 绝不删除现有表：使用 sql/migrate.sql（CREATE TABLE IF NOT EXISTS + INSERT IGNORE）。
// 数据库口令与初始账号口令均来自环境变量，代码中不含任何真实密码。
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
require('dotenv').config();

/** 幂等补列：列已存在则跳过 */
async function ensureColumn(conn, table, column, alterSql) {
  const [cols] = await conn.query(
    `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  if (cols[0].n === 0) {
    await conn.query(alterSql);
    console.log(`已补齐列 ${table}.${column}`);
  }
}

async function init() {
  if (!process.env.DB_PASSWORD) {
    throw new Error('缺少环境变量 DB_PASSWORD，请在 server/.env 中配置数据库口令');
  }
  if (!process.env.SEED_PASSWORD) {
    throw new Error('缺少环境变量 SEED_PASSWORD，请设置初始账号口令（不要用弱口令）');
  }
  if (process.env.SEED_PASSWORD.length < 10) {
    throw new Error('SEED_PASSWORD 长度至少 10 位，请使用强口令');
  }

  let sql = fs.readFileSync(path.join(__dirname, 'sql', 'migrate.sql'), 'utf8');
  const seedHash = await bcrypt.hash(process.env.SEED_PASSWORD, 10);
  sql = sql.split('__SEED_PASSWORD_HASH__').join(seedHash);

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    multipleStatements: true,
    charset: 'utf8mb4'
  });

  try {
    console.log('已连接 MySQL，正在执行幂等迁移 sql/migrate.sql ...');
    await conn.query(sql);

    // 依次执行增量升级脚本（均为幂等 CREATE/ALTER）
    for (const file of ['ai_upgrade.sql', 'assessment_upgrade.sql']) {
      const upgradePath = path.join(__dirname, 'sql', file);
      if (fs.existsSync(upgradePath)) {
        await conn.query(fs.readFileSync(upgradePath, 'utf8'));
        console.log(`已应用增量脚本 ${file}`);
      }
    }

    // 旧库列补齐：learning_records.lastActiveAt（CREATE TABLE IF NOT EXISTS 不会改已有表）
    await ensureColumn(conn, 'learning_records', 'lastActiveAt',
      "ALTER TABLE party_school.learning_records ADD COLUMN lastActiveAt DATETIME NULL COMMENT '最近一次学习心跳时间' AFTER studySeconds");

    const [orgs] = await conn.query('SELECT id, name, type, parentId FROM party_school.organizations ORDER BY id');
    console.log(`\n组织数据（${orgs.length} 条）：`);
    orgs.slice(0, 10).forEach(row => {
      const indent = row.parentId ? '  ' : '';
      console.log(`  ${indent}ID=${row.id} | ${row.name} (${row.type})`);
    });

    const [userCount] = await conn.query('SELECT COUNT(*) AS total FROM party_school.users');
    console.log(`\n账号数量：${userCount[0].total}`);
  } finally {
    await conn.end();
  }
  console.log('\n数据库迁移完成（未删除任何现有表）。');
}

init().catch(err => {
  console.error('失败:', err.message);
  process.exit(1);
});
