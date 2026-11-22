const fs = require('fs');
const path = require('path');
const db = require('./src/config/db');

async function upgrade() {
  const sql = fs.readFileSync(path.join(__dirname, 'sql', 'assessment_upgrade.sql'), 'utf8');
  try {
    for (const statement of sql.split(';').map(item => item.trim()).filter(Boolean)) {
      await db.query(statement);
    }
    console.log('测评数据库升级完成');
  } finally {
    await db.end();
  }
}

upgrade().catch(error => {
  console.error('测评数据库升级失败:', error.message);
  process.exitCode = 1;
});
