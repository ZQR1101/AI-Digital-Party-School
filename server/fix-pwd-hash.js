// 用 bcryptjs 重新生成所有密码 hash，然后更新 init.sql
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

async function main() {
  console.log('正在用 bcryptjs 生成密码 hash...\n');

  // 生成 hash
  const hash = await bcrypt.hash('admin123', 10);
  console.log('admin123 的新 hash:', hash);
  console.log('前缀:', hash.substring(0, 7));
  console.log('自测:', await bcrypt.compare('admin123', hash) ? '✅ 通过' : '❌ 失败');

  // 更新 init.sql
  const sqlPath = path.join(__dirname, 'sql', 'init.sql');
  let sql = fs.readFileSync(sqlPath, 'utf8');

  // 替换所有旧 hash
  const oldHash = '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';
  sql = sql.split(oldHash).join(hash);

  fs.writeFileSync(sqlPath, sql, 'utf8');
  console.log('\n✅ init.sql 已更新，所有密码 hash 已替换为 bcryptjs 格式');
}

main().catch(err => console.error('错误:', err));
