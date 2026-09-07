// 深入排查登录问题 - 直接查数据库、测 bcrypt
require('dotenv').config();
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

async function debug() {
  console.log('=== 连接云数据库...');
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    charset: 'utf8mb4'
  });

  // 第1步: 直接查 admin 用户
  console.log('\n[1] 查询 admin 用户...');
  const [rows] = await conn.query("SELECT id, username, realName, role, status, password FROM users WHERE username='admin'");
  if (rows.length === 0) {
    console.log('❌ 数据库中找不到 admin 用户！');
    await conn.end();
    return;
  }
  const user = rows[0];
  console.log('✅ 找到用户:');
  console.log('   id:', user.id);
  console.log('   username:', user.username);
  console.log('   realName:', user.realName);
  console.log('   role:', user.role);
  console.log('   status:', user.status);
  console.log('   密码hash前30位:', user.password.substring(0, 30));

  // 第2步: 测试 bcrypt 比对
  console.log('\n[2] 测试 bcrypt 密码比对...');
  console.log('   输入密码: admin123');
  try {
    const valid = await bcrypt.compare('admin123', user.password);
    console.log('   比对结果:', valid ? '✅ 匹配' : '❌ 不匹配');
  } catch (err) {
    console.log('❌ bcrypt 比对异常:', err.message);
  }

  // 第3步: 测试生成一个新hash并比对
  console.log('\n[3] 生成新hash并测试...');
  try {
    const newHash = await bcrypt.hash('admin123', 10);
    console.log('   新hash前30位:', newHash.substring(0, 30));
    const valid = await bcrypt.compare('admin123', newHash);
    console.log('   新hash比对:', valid ? '✅' : '❌');
  } catch (err) {
    console.log('❌', err.message);
  }

  await conn.end();
}

debug().catch(err => console.error('脚本错误:', err));
