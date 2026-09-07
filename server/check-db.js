const mysql = require('mysql2/promise');
require('dotenv').config();

(async () => {
  const c = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '123456',
    database: process.env.DB_NAME || 'party_school'
  });

  console.log('\n========================================');
  console.log('  📦 MySQL 中所有数据库：');
  const [dbs] = await c.query('SHOW DATABASES');
  dbs.forEach(d => {
    if (d.Database === 'party_school') console.log('  ✅ ' + d.Database + '  ← 就是这个');
    else console.log('     ' + d.Database);
  });

  console.log('\n========================================');
  console.log('  📊 party_school 中的表：');
  const [tbs] = await c.query(
    "SELECT TABLE_NAME, TABLE_ROWS FROM information_schema.tables WHERE table_schema='party_school' ORDER BY TABLE_NAME"
  );
  tbs.forEach(t => console.log('  ' + t.TABLE_NAME + '  (' + t.TABLE_ROWS + ' 行)'));

  console.log('\n========================================');
  console.log('  🏢 组织架构数据：');
  const [orgs] = await c.query('SELECT id, name, type, parentId FROM party_school.organizations ORDER BY id');
  orgs.forEach(r => {
    console.log('  ' + (r.parentId ? '  ├─ ' : '') + 'ID=' + r.id + '  ' + r.name + '  (' + r.type + ')');
  });

  console.log('\n========================================');
  console.log('  👤 用户数据：');
  const [users] = await c.query('SELECT id, username, realName, role FROM party_school.users');
  users.forEach(u => {
    console.log('  ' + u.username + ' | ' + u.realName + ' | ' + u.role);
  });

  console.log('\n✅ 千真万确，数据都在！\n');
  await c.end();
})();
