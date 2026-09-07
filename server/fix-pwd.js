const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
require('dotenv').config();

async function fix() {
  const conn = await mysql.createConnection({
    host: '127.0.0.1', user: 'root', password: '123456', database: 'party_school'
  });

  const hash = await bcrypt.hash('admin123', 10);
  for (const username of ['admin', 'zhangsan', 'lisi', 'wangwu']) {
    await conn.query('UPDATE users SET password = ? WHERE username = ?', [hash, username]);
  }

  // 验证
  const [rows] = await conn.query('SELECT username, realName FROM users');
  console.log('✅ 密码已重置为 admin123：');
  rows.forEach(r => console.log('  ' + r.username + ' | ' + r.realName));

  await conn.end();
  console.log('\n🎉 现在可以正常登录了！');
}

fix();
