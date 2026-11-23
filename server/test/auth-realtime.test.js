const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'auth-realtime-test-secret';

const db = require('../src/config/db');
const {
  authenticate, loadCurrentUser, authorize, requireAdmin, requireManager,
} = require('../src/middleware/auth');
const { loadActiveActor } = require('../src/services/organizationAccess');

/** 构造可断言的假 res */
function makeRes() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

/** 顺序执行中间件链，遇到已写响应或抛错即停止 */
function runChain(chain, req) {
  return (async () => {
    const res = makeRes();
    for (const mw of chain) {
      if (res.statusCode !== null) break;
      await new Promise((resolve, reject) => {
        let done = false;
        const finish = (err) => {
          if (done) return;
          done = true;
          err ? reject(err) : resolve();
        };
        const ret = mw(req, res, finish);
        // 同步中间件（如 authenticate 校验失败直接写响应、成功调 next 后返回）：
        // 返回即结束；异步中间件的 Promise 在内部 next 之后 resolve
        if (ret instanceof Promise) ret.then(() => finish(), finish);
        else finish();
      });
    }
    return res;
  })();
}

function signToken(payload, options = {}) {
  return jwt.sign(payload, process.env.JWT_SECRET, options);
}

// ---------------- 1) 过期 Token / 未登录 ----------------

test('过期 Token 返回 401，不再进入业务处理', async () => {
  const token = signToken({ userId: 3, username: 'lisi', role: 'member' }, { expiresIn: '-10s' });
  const req = { headers: { authorization: `Bearer ${token}` } };
  const res = await runChain([authenticate], req);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, 401);
  assert.match(res.body.message, /过期|重新登录/);
});

test('缺少或伪造 Token 返回 401', async () => {
  const res1 = await runChain([authenticate], { headers: {} });
  assert.equal(res1.statusCode, 401);
  const res2 = await runChain([authenticate], { headers: { authorization: 'Bearer not-a-jwt' } });
  assert.equal(res2.statusCode, 401);
});

// ---------------- 2) 停用账号 ----------------

test('停用账号（status=0）返回 403，不能访问任何受保护接口', async t => {
  const calls = [];
  t.mock.method(db, 'query', async (sql, params) => {
    calls.push(sql.slice(0, 40));
    return [[{ userId: 3, username: 'lisi', role: 'member', organizationId: 4, status: 0 }]];
  });
  const token = signToken({ userId: 3, username: 'lisi', role: 'member' });
  const req = { user: { userId: 3, username: 'lisi', role: 'member' }, headers: { authorization: `Bearer ${token}` } };
  const res = await runChain([authenticate, loadCurrentUser, authorize('member')], req);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, 403);
  assert.match(res.body.message, /停用/);
  assert.equal(calls.length, 1, '应只查一次用户表');
});

test('用户已被删除（查无此人）返回 403', async t => {
  t.mock.method(db, 'query', async () => [[]]);
  const res = await runChain([loadCurrentUser], { user: { userId: 999, role: 'member' } });
  assert.equal(res.statusCode, 403);
});

// ---------------- 3) 角色降级 ----------------

test('角色降级后旧 Token 按数据库实时角色判定（member 旧 token 冒充 admin 被拒）', async t => {
  t.mock.method(db, 'query', async () => [
    [{ userId: 3, username: 'lisi', role: 'member', organizationId: 4, status: 1 }],
  ]);
  // JWT 里写的是 admin（降级前签发）
  const token = signToken({ userId: 3, username: 'lisi', role: 'admin' });
  const req = { user: { userId: 3, role: 'admin' }, headers: { authorization: `Bearer ${token}` } };
  const res = await runChain([authenticate, loadCurrentUser, requireAdmin], req);
  assert.equal(res.statusCode, 403);
  assert.equal(req.user.role, 'member', 'req.user 应被数据库实时角色覆盖');
  // 对 member 开放的接口仍可访问
  const res2 = await runChain([authenticate, loadCurrentUser, authorize('member')], req);
  assert.equal(res2.statusCode, null);
});

// ---------------- 4) 组织变更 ----------------

test('组织变更后旧 Token 使用数据库实时组织（权限判定跟随新组织）', async t => {
  t.mock.method(db, 'query', async () => [
    [{ userId: 2, username: 'zhangsan', role: 'secretary', organizationId: 9, status: 1 }],
  ]);
  const token = signToken({ userId: 2, username: 'zhangsan', role: 'secretary', organizationId: 4 });
  const req = { user: { userId: 2, role: 'secretary', organizationId: 4 }, headers: { authorization: `Bearer ${token}` } };
  await runChain([authenticate, loadCurrentUser, requireManager], req);
  assert.equal(req.user.organizationId, 9, '组织 ID 应以数据库为准');
  // 组织权限服务拿到的 actor 也是新组织
  const actor = await loadActiveActor(req.user);
  assert.equal(actor.organizationId, 9);
});

// ---------------- 5) loadActiveActor 复用与一致性 ----------------

test('loadActiveActor 复用 loadCurrentUser 已加载身份，不再重复查询', async t => {
  const query = t.mock.method(db, 'query', async () => [[]]);
  const actor = await loadActiveActor({ userId: 3, role: 'member', organizationId: 4, status: 1 });
  assert.deepEqual(actor, { userId: 3, role: 'member', organizationId: 4 });
  assert.equal(query.mock.callCount(), 0, '不应再次查询数据库');
});

test('loadActiveActor 对停用的已加载身份同样拒绝（403），未加载时回退查库', async t => {
  t.mock.method(db, 'query', async () => [[]]);
  await assert.rejects(
    () => loadActiveActor({ userId: 3, role: 'member', organizationId: 4, status: 0 }),
    (err) => err.statusCode === 403
  );
  await assert.rejects(
    () => loadActiveActor({ userId: 3 }),
    (err) => err.statusCode === 403,
    '无实时身份时查库，status=1 过滤后无行应 403'
  );
});

// ---------------- 6) 结构回归：所有受保护路由均已挂载实时身份校验 ----------------

test('所有需要登录的业务路由都挂载了 loadCurrentUser（authenticate 之后）', () => {
  const protectedRouters = {
    'tasks': require('../src/routes/tasks'),
    'learningRecords': require('../src/routes/learningRecords'),
    'reports': require('../src/routes/reports'),
    'examRecords': require('../src/routes/examRecords'),
    'assessments': require('../src/routes/assessments'),
    'contents': require('../src/routes/contents'),
    'ai': require('../src/routes/ai'),
    'admin/statistics': require('../src/routes/admin/statistics'),
    'admin/tasks': require('../src/routes/admin/tasks'),
    'admin/users': require('../src/routes/admin/users'),
    'admin/contents': require('../src/routes/admin/contents'),
    'admin/organizations': require('../src/routes/admin/organizations'),
    'admin/questions': require('../src/routes/admin/questions'),
    'admin/papers': require('../src/routes/admin/papers'),
    'admin/assessments': require('../src/routes/admin/assessments'),
  };

  for (const [name, router] of Object.entries(protectedRouters)) {
    const layers = router.stack.map((l) => ({
      isUse: !l.route,
      path: l.route ? l.route.path : (l.regexp?.source || ''),
      handle: l.handle,
    }));

    // use 级中间件（router.use）按顺序累积，合并进每条路由的链
    let useChain = [];
    const routeChains = [];
    for (const layer of layers) {
      if (layer.isUse) {
        useChain.push(layer.handle);
      } else {
        routeChains.push({ path: layer.path, chain: [...useChain, ...(layer.handle.stack || []).map((s) => s.handle)] });
      }
    }

    assert.ok(
      routeChains.length > 0,
      `${name}: 未找到任何路由`
    );
    for (const { path, chain } of routeChains) {
      const authIdx = chain.indexOf(authenticate);
      if (authIdx === -1) continue; // 该路由不要求登录（如 auth 相关）
      assert.ok(
        chain.includes(loadCurrentUser),
        `${name} ${path}: 挂载了 authenticate 但缺少 loadCurrentUser（实时账号状态/角色校验）`
      );
      assert.ok(
        chain.indexOf(loadCurrentUser) > authIdx,
        `${name} ${path}: loadCurrentUser 必须在 authenticate 之后`
      );
    }
  }
});
