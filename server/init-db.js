// 初始化数据库脚本 - 通过 Node.js 执行，解决中文路径和字符集问题
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function init() {
  const sql = fs.readFileSync(path.join(__dirname, 'sql', 'init.sql'), 'utf8');

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '123456',
    multipleStatements: true,
    charset: 'utf8mb4'
  });

  console.log('✅ MySQL 已连接，正在执行 init.sql ...');
  await conn.query(sql);
  console.log('✅ 数据库初始化完成！');

  // 验证数据
  const [orgs] = await conn.query('SELECT id, name, type, parentId FROM party_school.organizations ORDER BY id');
  console.log('\n📋 组织数据验证：');
  orgs.forEach(row => {
    const indent = row.parentId ? '  ' : '';
    console.log(`  ${indent}ID=${row.id} | ${row.name} (${row.type}) | parentId=${row.parentId || 'NULL'}`);
  });

  const [users] = await conn.query('SELECT id, username, realName, role FROM party_school.users');
  console.log('\n👤 用户数据验证：');
  users.forEach(u => {
    console.log(`  ID=${u.id} | ${u.username} | ${u.realName} | ${u.role}`);
  });

  await conn.end();
  console.log('\n🎉 一切就绪！可以 npm run dev 启动后端了。');
}

init().catch(err => {
  console.error('❌ 失败:', err.message);
  process.exit(1);
});
