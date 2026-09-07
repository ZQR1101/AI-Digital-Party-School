const bcrypt = require('bcryptjs');

const hash = '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';

async function test() {
  const result = await bcrypt.compare('admin123', hash);
  console.log('admin123 匹配:', result);
  
  // 生成一个新的正确哈希
  const newHash = await bcrypt.hash('admin123', 10);
  console.log('新哈希:', newHash);
}

test();
