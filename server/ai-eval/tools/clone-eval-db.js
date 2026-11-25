/**
 * 评测专用：把 init-db.js 建好的 party_school 种子库复制到一个隔离 eval 库。
 *
 * 只用于 CI / 本地一次性测试环境；不会修改源库，不会连接外部主机。
 * 目标库名由 DB_NAME 指定且必须包含 eval，例如 ai_eval_ci。
 *
 * 用法：node ai-eval/tools/clone-eval-db.js
 */
const mysql = require('mysql2/promise');

async function main() {
  const dbName = process.env.DB_NAME || '';
  if (!/eval/i.test(dbName)) {
    throw new Error(`拒绝复制：DB_NAME=${dbName || '(未设置)'} 不包含 eval，避免触碰业务库`);
  }
  if (!/^(127\.0\.0\.1|localhost|::1)$/.test(process.env.DB_HOST || '127.0.0.1')) {
    throw new Error('拒绝复制：评测库只允许位于本机（CI 服务容器）');
  }
  if (!process.env.DB_PASSWORD) throw new Error('缺少 DB_PASSWORD');

  const source = 'party_school';
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    multipleStatements: true
  });
  try {
    await conn.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` DEFAULT CHARACTER SET utf8mb4`);
    const [rows] = await conn.query('SHOW TABLES FROM ??', [source]);
    const tables = rows.map((row) => Object.values(row)[0]);
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const table of tables) {
      await conn.query(`DROP TABLE IF EXISTS \`${dbName}\`.\`${table}\``);
      await conn.query(`CREATE TABLE \`${dbName}\`.\`${table}\` LIKE \`${source}\`.\`${table}\``);
      await conn.query(`INSERT INTO \`${dbName}\`.\`${table}\` SELECT * FROM \`${source}\`.\`${table}\``);
    }
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    console.log(`已复制 ${tables.length} 张表到隔离评测库 ${dbName}`);
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error('隔离评测库准备失败:', err.message);
  process.exit(1);
});
