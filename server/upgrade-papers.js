require('dotenv').config();
const db = require('./src/config/db');

async function upgrade() {
  const [columns] = await db.query("SHOW COLUMNS FROM papers LIKE 'category'");
  if (!columns.length) {
    await db.query("ALTER TABLE papers ADD COLUMN category VARCHAR(100) NULL COMMENT '试卷分类' AFTER title");
  }
  await db.query("ALTER TABLE papers MODIFY COLUMN status TINYINT DEFAULT 1 COMMENT '状态: 1草稿 2已发布 0已删除'");
  console.log('试卷结构升级完成');
  await db.end();
}

upgrade().catch(async (error) => {
  console.error('试卷结构升级失败:', error.message);
  await db.end();
  process.exit(1);
});
