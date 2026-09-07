// 登录调试脚本 - 精确定位是登录失败还是 token 验证失败
require('dotenv').config();
const axios = require('axios');

const BASE = `http://localhost:${process.env.PORT || 3000}`;

async function debug() {
  console.log('=== 后端地址:', BASE);
  console.log('=== JWT_SECRET 长度:', (process.env.JWT_SECRET || '').length);
  console.log('=== DB_HOST:', process.env.DB_HOST);

  // 第1步：测试登录
  console.log('\n[1] 测试登录 API...');
  try {
    const loginRes = await axios.post(`${BASE}/api/auth/login`, {
      username: 'admin',
      password: 'admin123'
    });
    console.log('✅ 登录成功！返回 code:', loginRes.data.code);
    console.log('   token前20位:', loginRes.data.data.token.substring(0, 20) + '...');

    // 第2步：用拿到的 token 测试验证
    console.log('\n[2] 测试 token 是否有效...');
    const token = loginRes.data.data.token;
    try {
      const meRes = await axios.get(`${BASE}/api/users/me`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      console.log('✅ token 验证通过！用户:', meRes.data.data.realName);
    } catch (err) {
      if (err.response) {
        console.log('❌ token 验证失败！状态码:', err.response.status);
        console.log('   返回内容:', err.response.data);
      } else {
        console.log('❌ 请求失败:', err.message);
      }
    }
  } catch (err) {
    if (err.response) {
      console.log('❌ 登录失败！状态码:', err.response.status);
      console.log('   返回内容:', JSON.stringify(err.response.data));
    } else {
      console.log('❌ 无法连接后端:', err.message);
    }
  }
}

debug();
