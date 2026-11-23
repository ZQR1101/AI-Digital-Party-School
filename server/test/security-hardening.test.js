// 安全加固回归测试：RBAC / 学习记录真实性 / 上传白名单 / 登录防护 / 凭据 / 迁移幂等
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { requireAdmin, requireManager, loadCurrentUser } = require('../src/middleware/auth');
const { validateReportedSeconds } = require('../src/services/studyDuration');
const { contentFileFilter, sheetFileFilter, safeFileName } = require('../src/utils/uploadSecurity');
const { LoginGuard } = require('../src/utils/loginGuard');
const db = require('../src/config/db');

const ROOT = path.join(__dirname, '../..');

// ---------- RBAC ----------
function runMiddleware(mw, user) {
  return new Promise((resolve) => {
    let status = null;
    const res = {
      status(code) { status = code; return this; },
      json() { resolve({ status, next: false }); return this; }
    };
    mw({ user }, res, () => resolve({ status, next: true }));
  });
}

test('RBAC：支部书记不能访问仅管理员的全局资源，但可进入本组织业务', async () => {
  assert.equal((await runMiddleware(requireAdmin, { role: 'secretary' })).status, 403);
  assert.equal((await runMiddleware(requireAdmin, { role: 'admin' })).next, true);
  assert.equal((await runMiddleware(requireManager, { role: 'secretary' })).next, true);
  assert.equal((await runMiddleware(requireManager, { role: 'member' })).status, 403);
});

test('RBAC：人员/组织/题库/试卷/内容路由仅挂载管理员中间件，任务/测评允许书记', () => {
  const adminDir = path.join(__dirname, '../src/routes/admin');
  const adminOnly = ['users.js', 'organizations.js', 'questions.js', 'papers.js', 'contents.js'];
  const manager = ['tasks.js', 'assessments.js'];
  for (const f of adminOnly) {
    const s = fs.readFileSync(path.join(adminDir, f), 'utf8');
    assert.match(s, /router\.use\(authenticate, loadCurrentUser, requireAdmin\)/, `${f} 应为管理员专属`);
  }
  for (const f of manager) {
    const s = fs.readFileSync(path.join(adminDir, f), 'utf8');
    assert.match(s, /requireManager/, `${f} 应允许书记访问`);
  }
});

test('RBAC：权限判定以数据库实时角色为准，降权/停用旧 token 立即失效', async t => {
  t.mock.method(db, 'query', async () => [[{ userId: 7, username: 'u', role: 'member', organizationId: 2, status: 0 }]]);
  const res = await new Promise((resolve) => {
    const r = {
      status(code) { this._code = code; return this; },
      json(body) { resolve({ code: this._code, body }); return this; }
    };
    loadCurrentUser({ user: { userId: 7, role: 'admin' } }, r, () => resolve({ code: 200 }));
  });
  assert.equal(res.code, 403, '停用账号应被拒绝');
});

// ---------- 学习记录真实性 ----------
test('学习时长：非法值、突变增量、超限累计均被服务端拒绝', () => {
  assert.throws(() => validateReportedSeconds({ reported: -5 }), { statusCode: 400 });
  assert.throws(() => validateReportedSeconds({ reported: 'abc' }), { statusCode: 400 });
  assert.throws(() => validateReportedSeconds({ reported: 3 * 3600, contentType: 'article' }), { statusCode: 400 });
  // 已有记录时，一次请求暴增到完成阈值以上属于异常
  assert.throws(() => validateReportedSeconds({ reported: 5000, previous: 0, requiredSeconds: 300, contentType: 'article' }), { statusCode: 400 });
  // 正常增量放行，且禁止回退
  assert.equal(validateReportedSeconds({ reported: 120, previous: 60, requiredSeconds: 300, contentType: 'article' }), 120);
  assert.equal(validateReportedSeconds({ reported: 30, previous: 60, requiredSeconds: 300, contentType: 'article' }), 60);
});

test('学习记录服务：任务未发布/不属于用户组织时拒绝，且不写库', async t => {
  const LearningRecordService = require('../src/services/learningRecordService');
  const calls = [];
  t.mock.method(db, 'query', async (sql, params) => {
    calls.push(sql);
    if (sql.includes('FROM learning_tasks')) {
      return [[{ organizationId: 99, taskStatus: 'draft', contentType: 'article', title: 'x' }]];
    }
    throw new Error('不应继续查询');
  });
  await assert.rejects(
    () => LearningRecordService.submit(1, { taskId: 5, studySeconds: 60, completed: false }),
    /尚未发布/
  );
  assert.equal(calls.length, 1, '任务未发布应立即拒绝，不再查用户组织与写记录');
});

// ---------- 文件上传 ----------
test('上传白名单：脚本/可执行文件被拒，合法图片视频放行', async () => {
  const check = (filter, name, mime) => new Promise(resolve => {
    filter({}, { originalname: name, mimetype: mime }, (err, ok) => resolve({ err, ok }));
  });
  assert.ok((await check(contentFileFilter, 'shell.php', 'application/x-php')).err);
  assert.ok((await check(contentFileFilter, 'page.html', 'text/html')).err);
  // 扩展名与 MIME 必须匹配：jpg 扩展伪装成脚本 MIME 也应拒绝
  assert.ok((await check(contentFileFilter, 'pic.jpg', 'application/x-php')).err);
  assert.equal((await check(contentFileFilter, 'cover.png', 'image/png')).ok, true);
  assert.equal((await check(contentFileFilter, 'lecture.mp4', 'video/mp4')).ok, true);
  assert.equal((await check(sheetFileFilter, 'users.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).ok, true);
  assert.ok((await check(sheetFileFilter, 'evil.exe', 'application/octet-stream')).err);
});

test('上传文件名：不使用用户提供的原始名，杜绝路径穿越', () => {
  const name = safeFileName('../../etc/passwd.jpg');
  assert.match(name, /^\d+-[0-9a-f]{24}\.jpg$/);
  assert.ok(!name.includes('..') && !name.includes('/'));
});

// ---------- 登录防护 ----------
test('登录防护：连续失败达到阈值后锁定，成功清除记录，过期自动解锁', () => {
  let now = 1000;
  const guard = new LoginGuard({ maxAttempts: 3, lockMs: 1000, now: () => now });
  assert.equal(guard.fail('u@ip'), false);
  assert.equal(guard.fail('u@ip'), false);
  assert.equal(guard.fail('u@ip'), true);
  assert.equal(guard.isLocked('u@ip'), true);
  guard.succeed('u@ip');
  assert.equal(guard.isLocked('u@ip'), false);
  guard.fail('v@ip'); guard.fail('v@ip'); guard.fail('v@ip');
  now += 1001;
  assert.equal(guard.isLocked('v@ip'), false);
});

// ---------- 凭据与迁移 ----------
test('凭据安全：含明文密码的 SFTP/调试脚本不再被版本控制跟踪', () => {
  const tracked = require('child_process')
    .execSync('git ls-files', { cwd: ROOT })
    .toString().split('\n');
  assert.ok(!tracked.includes('.vscode/sftp.json'), 'SFTP 明文配置必须移出版本控制');
  for (const f of ['check-db.js', 'debug-auth.js', 'debug-sql.js', 'fix-pwd.js', 'test-connection.js']) {
    assert.ok(!tracked.includes(`server/${f}`), `${f} 不应被跟踪`);
  }
  const template = fs.readFileSync(path.join(ROOT, '.vscode/sftp.example.json'), 'utf8');
  assert.ok(!/116\.62|123456|llk/.test(template), '模板不得含真实凭据');
});

test('凭据安全：被跟踪的源码/脚本中不含明文数据库口令与弱口令哈希', () => {
  const files = [
    'server/init-db.js', 'server/seed-batch-data.js', 'server/upgrade-ai.js',
    'server/src/services/userService.js', 'server/sql/migrate.sql', 'server/sql/init.sql'
  ];
  for (const f of files) {
    const s = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.ok(!s.includes("'123456'"), `${f} 含明文数据库口令`);
    assert.ok(!s.includes('admin123'), `${f} 含弱口令明文`);
    assert.ok(!s.includes('$2a$10$ALaZI5L'), `${f} 含固定弱口令哈希`);
  }
});

test('数据库迁移：migrate.sql 幂等（无 DROP，建表带 IF NOT EXISTS）', () => {
  const sql = fs.readFileSync(path.join(ROOT, 'server/sql/migrate.sql'), 'utf8');
  assert.doesNotMatch(sql, /DROP TABLE/i, '迁移脚本不得删除现有表');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS organizations/);
  assert.match(sql, /INSERT IGNORE INTO/);
  assert.ok(!sql.includes('$2a$'), '初始口令哈希应由环境变量注入');
});

test.after(() => db.end());
