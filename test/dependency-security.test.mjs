import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * 依赖安全回归测试（离线，读取 package-lock.json）：
 * 锁定本轮已修复的高危漏洞版本下限，防止依赖回退重新引入已知漏洞。
 * 权威门禁由 CI 的 npm audit --omit=dev --audit-level=high 承担（阻断合并）。
 */

const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
const versions = {};
for (const [key, info] of Object.entries(lock.packages || {})) {
  const name = key.replace(/^node_modules\//, '');
  if (!name.includes('node_modules/') && info.version) versions[name] = info.version;
}

/** 简单语义化版本比较：a < b 返回 -1，相等 0，a > b 返回 1 */
function compareVersion(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

function assertMinVersion(name, min, reason) {
  const actual = versions[name];
  assert.ok(actual, `lockfile 中缺少 ${name}`);
  assert.ok(
    compareVersion(actual, min) >= 0,
    `${name}@${actual} 存在已知高危漏洞（需 >=${min}）：${reason}`
  );
}

test('生产依赖高危版本下限（vue/axios/follow-redirects）', () => {
  // vue 3.2.13-3.5.41：@vue/server-renderer XSS，属性名黑名单缺 CR（GHSA-g2v6-rqmx-r4w6）
  assertMinVersion('vue', '3.5.42', 'XSS via missing CR in attribute-name blacklist');
  // axios <=1.19.0：原型污染 / ReDoS / 头注入 / SSRF 一组高危（GHSA-vh66-26gq-q6x8 等）
  assertMinVersion('axios', '1.20.0', 'prototype pollution / ReDoS / header injection / SSRF');
  // follow-redirects <1.16.3：跨源凭据头剥离绕过
  assertMinVersion('follow-redirects', '1.16.3', 'sensitive header stripping bypass');
});

test('构建链高危版本下限（vite/nanoid/source-map-js）', () => {
  // vite：<=7.3.6 存在 launch-editor 命令执行与中间件跨源脚本问题
  const vite = versions.vite || '';
  const major = Number(vite.split('.')[0]);
  assert.ok(major === 7 || major === 8, `vite 大版本异常: ${vite}`);
  assertMinVersion('vite', major === 7 ? '7.3.7' : '8.3.7', 'launch-editor RCE / middleware issues');
  // nanoid v3：自定义生成器 size=0 死循环（DoS）
  assertMinVersion('nanoid', '3.3.20', 'infinite loop with zero-size custom generator');
  // source-map-js：index source-map 恶意偏移导致事件循环 DoS
  assertMinVersion('source-map-js', '1.2.4', 'event-loop DoS via source-map section offsets');
});
