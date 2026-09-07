// 数据库连接测试脚本
const mysql = require('mysql2/promise');
require('dotenv').config();

async function test() {
  // 尝试多种连接方式
  const configs = [
    { name: '方式1: .env配置', host: process.env.DB_HOST || '127.0.0.1', port: process.env.DB_PORT || 3306, user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || '' },
    { name: '方式2: root+空密码', host: '127.0.0.1', user: 'root', password: '', port: 3306 },
    { name: '方式3: root+123456', host: '127.0.0.1', user: 'root', password: '123456', port: 3306 },
    { name: '方式4: root+root', host: '127.0.0.1', user: 'root', password: 'root', port: 3306 },
    { name: '方式5: localhost', host: 'localhost', user: 'root', password: '', port: 3306 },
  ];

  for (const cfg of configs) {
    try {
      const conn = await mysql.createConnection({
        host: cfg.host, user: cfg.user, password: cfg.password, port: cfg.port,
        connectTimeout: 3000
      });
      console.log(`✅ ${cfg.name} - 连接成功！MySQL版本:`, (await conn.query('SELECT VERSION()'))[0][0]['VERSION()']);
      await conn.end();
      return;
    } catch (err) {
      console.log(`❌ ${cfg.name} - 失败: ${err.code} ${err.message}`);
    }
  }
  console.log('\n⚠️ 所有方式都失败了，请检查：');
  console.log('1. MySQL服务是否已启动');
  console.log('2. root密码是否正确');
  console.log('3. 防火墙是否阻止了3306端口');
}

test();
