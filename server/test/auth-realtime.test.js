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

/** 从 router 栈中提取指定 method+path 的完整中间件链（含此前累积的 router.use 前缀） */
function findRouteChain(router, method, path) {
  let useChain = [];
  for (const layer of router.stack) {
    if (!layer.route) {
      useChain.push(layer.handle);
      continue;
    }
    const methods = layer.route.methods || {};
    if (layer.route.path === path && methods[method]) {
      return [...useChain, ...layer.route.stack.map((s) => s.handle)];
    }
  }
  return null;
}

// ---------------- 1.5) /api/users/me 实时身份校验（真实路由链路） ----------------

test('停用账号访问 GET /api/users/me 返回 403，不泄露用户信息', async t => {
  const authRouter = require('../src/routes/auth');
  const chain = findRouteChain(authRouter, 'get', '/users/me');
  assert.ok(chain, '路由表中应存在 GET /users/me');
  assert.ok(chain.includes(authenticate), '/users/me 应挂载 authenticate');
  assert.ok(chain.includes(loadCurrentUser), '/users/me 应挂载 loadCurrentUser（实时账号状态校验）');

  const calls = [];
  t.mock.method(db, 'query', async (sql) => {
    calls.push(sql.slice(0, 40));
    return [[{ userId: 3, username: 'lisi', role: 'member', organizationId: 4, status: 0 }]];
  });
  const token = signToken({ userId: 3, username: 'lisi', role: 'member' });
  const req = { method: 'GET', headers: { authorization: `Bearer ${token}` } };
  const res = await runChain(chain, req);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, 403);
  assert.match(res.body.message, /停用|不存在/);
  assert.equal(calls.length, 1, '应在校验用户表后立即拒绝，不再执行用户信息查询');
});

test('正常账号访问 /api/users/me 返回数据库实时身份（覆盖 JWT 过期角色）', async t => {
  const authRouter = require('../src/routes/auth');
  const chain = findRouteChain(authRouter, 'get', '/users/me');
  t.mock.method(db, 'query', async (sql) => {
    if (/FROM users WHERE id/i.test(sql)) {
      return [[{ userId: 3, username: 'lisi', role: 'member', organizationId: 4, status: 1 }]];
    }
    return [[{ id: 3, username: 'lisi', realName: '李四', role: 'member', organizationId: 4, organizationName: '第一党支部' }]];
  });
  // JWT 签发时 role=admin，数据库已降级为 member
  const token = signToken({ userId: 3, username: 'lisi', role: 'admin' });
  const req = { method: 'GET', headers: { authorization: `Bearer ${token}` } };
  const res = await runChain(chain, req);
  assert.equal(res.body.code, 0, '正常账号应完整走通链路返回用户信息');
  assert.equal(res.body.data.role, 'member', '返回的角色应是数据库实时角色');
  assert.equal(res.body.data.username, 'lisi');
});

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

// ---------------- 6) 结构回归：认证中间件不允许整体或局部遗漏 ----------------

/** 将 router 栈解析为 [{ path, method, chain }]，router.use 按顺序合并进每条路由 */
function buildRouteChains(router) {
  const chains = [];
  let useChain = [];
  for (const layer of router.stack) {
    if (!layer.route) {
      useChain.push(layer.handle);
      continue;
    }
    const methods = Object.keys(layer.route.methods || {});
    for (const method of methods) {
      chains.push({
        method,
        path: layer.route.path,
        chain: [...useChain, ...layer.route.stack.map((s) => s.handle)],
      });
    }
  }
  return chains;
}

test('所有受保护业务路由的每一条路由都必须挂载 authenticate + loadCurrentUser（顺序正确）', () => {
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

  let totalRoutes = 0;
  for (const [name, router] of Object.entries(protectedRouters)) {
    const chains = buildRouteChains(router);
    assert.ok(chains.length > 0, `${name}: 未找到任何路由（路由文件可能被清空或改写）`);
    totalRoutes += chains.length;
    for (const { method, path, chain } of chains) {
      const authIdx = chain.indexOf(authenticate);
      assert.ok(
        authIdx !== -1,
        `${name} ${method.toUpperCase()} ${path}: 缺少 authenticate（认证中间件遗漏）`
      );
      assert.ok(
        chain.includes(loadCurrentUser),
        `${name} ${method.toUpperCase()} ${path}: 缺少 loadCurrentUser（实时账号状态/角色校验遗漏）`
      );
      assert.ok(
        chain.indexOf(loadCurrentUser) > authIdx,
        `${name} ${method.toUpperCase()} ${path}: loadCurrentUser 必须在 authenticate 之后`
      );
    }
  }

  // 防止路由整体丢失（如路由文件被意外清空后测试静默通过）
  assert.ok(
    totalRoutes >= 40,
    `受保护路由总数异常偏少（${totalRoutes} 条），可能发生了路由整体丢失`
  );
});

test('auth 路由器：仅 /login 公开，其余路由（如 /users/me）必须完整受保护', () => {
  const authRouter = require('../src/routes/auth');
  const chains = buildRouteChains(authRouter);
  assert.ok(chains.length > 0, 'auth 路由器不应为空');

  const PUBLIC_ROUTES = new Set(['post /login']); // 唯一允许匿名访问的入口
  for (const { method, path, chain } of chains) {
    const key = `${method} ${path}`;
    if (PUBLIC_ROUTES.has(key)) {
      assert.ok(
        !chain.includes(authenticate),
        `${key}: 公开路由不应挂载 authenticate`
      );
      continue;
    }
    const authIdx = chain.indexOf(authenticate);
    assert.ok(authIdx !== -1, `auth ${key}: 非 /login 路由必须挂载 authenticate`);
    assert.ok(
      chain.includes(loadCurrentUser) && chain.indexOf(loadCurrentUser) > authIdx,
      `auth ${key}: 必须挂载 loadCurrentUser 且位于 authenticate 之后`
    );
  }
});
