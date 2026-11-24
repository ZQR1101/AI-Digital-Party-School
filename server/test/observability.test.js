const test = require('node:test');
const { after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..', '..'); // 仓库根（server 的上一级）

// 本文件测试均为纯同步/微任务操作（无 I/O），事件循环会提前排空导致排队测试
// 被 cancelled。用受控定时器保活，全部测试结束后清理退出。
const keepAlive = setInterval(() => {}, 1000);
after(() => clearInterval(keepAlive));

// ============== 1) JSON 结构化日志 ==============

const logger = require('../src/utils/logger');

function captureLogger() {
  const lines = [];
  logger.setSink((entry) => lines.push(entry));
  return lines;
}

test('logger: 单条日志序列化为单行 JSON，含 timestamp/level/message', () => {
  const lines = captureLogger();
  logger.info('服务已启动', { port: 3001 });
  assert.equal(lines.length, 1);
  assert.equal(lines[0].level, 'info');
  assert.equal(lines[0].message, '服务已启动');
  assert.equal(lines[0].meta.port, 3001);
  assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(lines[0].timestamp));
  assert.equal(JSON.stringify(lines[0]).split('\n').length, 1);
});

test('logger: 级别过滤（info 级别下 debug 不输出）', () => {
  const lines = captureLogger();
  logger.setLevel('info');
  logger.debug('调试信息');
  logger.warn('警告信息');
  assert.equal(lines.length, 1);
  assert.equal(lines[0].level, 'warn');
});

test('logger: 敏感字段脱敏（password/token/secret/authorization/apiKey）', () => {
  const lines = captureLogger();
  logger.info('登录尝试', { username: 'admin', password: 'p@ss', token: 'jwt-xxx', apiKey: 'sk-1', nested: { secret: 'abc', note: 'ok' } });
  const meta = lines[0].meta;
  assert.equal(meta.username, 'admin');
  assert.equal(meta.password, logger.MASK);
  assert.equal(meta.token, logger.MASK);
  assert.equal(meta.apiKey, logger.MASK);
  assert.equal(meta.nested.secret, logger.MASK);
  assert.equal(meta.nested.note, 'ok');
});

test('logger: Error 对象序列化为 name/message/stack，不整段内联', () => {
  const lines = captureLogger();
  const err = new Error('数据库连接失败');
  err.code = 'ER_ACCESS_DENIED';
  logger.error('查询出错', err);
  const entry = lines[0];
  assert.equal(entry.level, 'error');
  assert.equal(entry.error.name, 'Error');
  assert.equal(entry.error.message, '数据库连接失败');
  assert.equal(entry.error.code, 'ER_ACCESS_DENIED');
  assert.ok(entry.error.stack.includes('observability.test.js'));
});

// ============== 2) 请求链路追踪中间件 ==============

const { requestContext, pickRequestId, REQUEST_ID_RE } = require('../src/middleware/requestContext');
const metrics = require('../src/utils/metrics');
const { EventEmitter } = require('node:events');

/** 构造带 EventEmitter 的假 res（finish 事件可手动触发） */
function makeTraceRes() {
  const res = new EventEmitter();
  res.statusCode = 200;
  res.headers = {};
  res.setHeader = (k, v) => { res.headers[String(k).toLowerCase()] = v; };
  res.getHeader = (k) => res.headers[String(k).toLowerCase()];
  return res;
}

test('requestId: 复用合法上游 X-Request-ID，拒绝非法值', () => {
  assert.equal(pickRequestId({ headers: { 'x-request-id': 'trace-abc_123' } }), 'trace-abc_123');
  assert.ok(REQUEST_ID_RE.test('trace-abc_123'));
  // 注入字符 / 超长 / 空值 一律重新生成
  assert.notEqual(pickRequestId({ headers: { 'x-request-id': '../etc/passwd' } }), '../etc/passwd');
  assert.notEqual(pickRequestId({ headers: { 'x-request-id': 'x'.repeat(65) } }), 'x'.repeat(65));
  assert.notEqual(pickRequestId({ headers: { 'x-request-id': '' } }), '');
  // 无头时生成 UUID v4
  const gen = pickRequestId({ headers: {} });
  assert.equal(gen.length, 36);
  assert.match(gen, /^[0-9a-f-]{36}$/);
});

test('requestContext: 回写响应头并输出带 requestId 的访问日志，上报指标', () => {
  const lines = captureLogger();
  const req = { headers: { 'x-request-id': 'trace-1' }, method: 'GET', url: '/api/tasks/123', originalUrl: '/api/tasks/123?x=1', user: { userId: 7 }, on() {} };
  const res = makeTraceRes();

  requestContext(req, res, () => {});
  assert.equal(res.headers['x-request-id'], 'trace-1');
  assert.equal(req.requestId, 'trace-1');

  const before = metrics.snapshot().requestsTotal;
  res.statusCode = 500;
  res.emit('finish');

  const entry = lines.find((l) => l.message === 'access');
  assert.ok(entry, '应输出 access 日志');
  assert.equal(entry.meta.requestId, 'trace-1');
  assert.equal(entry.meta.statusCode, 500);
  assert.equal(entry.meta.userId, 7);
  assert.equal(entry.meta.path, '/api/tasks/123?x=1');
  assert.equal(entry.level, 'error'); // 5xx → error 级别
  assert.ok(typeof entry.meta.durationMs === 'number');

  const after = metrics.snapshot();
  assert.equal(after.requestsTotal, before + 1);
  assert.equal(after.byStatusClass['5xx'] >= 1, true);
});

test('requestContext: 无上游 ID 时生成 UUID 并回写', () => {
  const req = { headers: {}, method: 'GET', url: '/health', on() {} };
  const res = makeTraceRes();
  requestContext(req, res, () => {});
  assert.match(res.headers['x-request-id'], /^[0-9a-f-]{36}$/);
  res.emit('finish');
});

// ============== 3) 健康检查与指标端点 ==============

const db = require('../src/config/db');
const healthRouter = require('../src/routes/health');

/** 从 router 栈提取指定 path 的处理函数 */
function routeHandler(router, method, routePath) {
  const layer = router.stack.find((l) => l.route && l.route.path === routePath && l.route.methods[method.toLowerCase()]);
  assert.ok(layer, `路由 ${method} ${routePath} 应存在`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function makeJsonRes() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

/** 调用路由处理函数：同步 handler 在下个 tick 兜底完成，异步 handler 等待其 Promise */
function invoke(handler, req, res) {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (err) => {
      if (done) return;
      done = true;
      err ? reject(err) : resolve();
    };
    const ret = handler(req, res, finish);
    if (ret instanceof Promise) ret.then(() => finish(), finish);
    else process.nextTick(finish);
  });
}

test('health: /health 存活探针不探测依赖直接返回 ok', async () => {
  const handler = routeHandler(healthRouter, 'GET', '/health');
  const res = makeJsonRes();
  await invoke(handler, {}, res);
  assert.equal(res.statusCode, null); // 未设置非 200
  assert.equal(res.body.code, 0);
  assert.equal(res.body.data.status, 'ok');
});

test('health: /health/ready 数据库可达时返回 ready', async () => {
  const originalQuery = db.query;
  db.query = async () => [[{ 1: 1 }], []];
  try {
    const handler = routeHandler(healthRouter, 'GET', '/health/ready');
    const res = makeJsonRes();
    await invoke(handler, {}, res);
    assert.equal(res.body.code, 0);
    assert.equal(res.body.data.status, 'ready');
    assert.equal(res.body.data.db, true);
    assert.ok(typeof res.body.data.dbLatencyMs === 'number');
  } finally {
    db.query = originalQuery;
  }
});

test('health: /health/ready 数据库不可用时返回 503（readiness 失败）', async () => {
  const originalQuery = db.query;
  db.query = async () => { throw new Error('ECONNREFUSED'); };
  try {
    const handler = routeHandler(healthRouter, 'GET', '/health/ready');
    const res = makeJsonRes();
    await invoke(handler, {}, res);
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.code, 503);
    assert.equal(res.body.data.db, false);
  } finally {
    db.query = originalQuery;
  }
});

test('health: /metrics 返回完整指标快照', async () => {
  const handler = routeHandler(healthRouter, 'GET', '/metrics');
  const res = makeJsonRes();
  await invoke(handler, {}, res);
  const snap = res.body.data;
  assert.equal(res.body.code, 0);
  assert.ok(snap.requestsTotal >= 0);
  assert.ok(snap.uptimeSeconds >= 0);
  assert.ok(snap.latencyEstimatesMs && 'p50' in snap.latencyEstimatesMs && 'p95' in snap.latencyEstimatesMs);
  assert.ok(Array.isArray(snap.topRoutes));
  assert.ok(snap.process && typeof snap.process.memoryRssMb === 'number');
});

// ============== 4) 指标采集器 ==============

test('metrics: 路径模板归一化，数字段折叠为 :id，避免高基数', () => {
  assert.equal(metrics.routeTemplate('/api/tasks/123'), '/api/tasks/:id');
  assert.equal(metrics.routeTemplate('/api/tasks/123/sub'), '/api/tasks/:id/sub');
  assert.equal(metrics.routeTemplate('/api/contents'), '/api/contents');
});

test('metrics: observeRequest 累计计数、状态分桶与错误率', () => {
  const snap0 = metrics.snapshot();
  metrics.observeRequest({ path: '/api/x/1', method: 'GET', statusCode: 200, durationMs: 3 });
  metrics.observeRequest({ path: '/api/x/2', method: 'GET', statusCode: 404, durationMs: 8 });
  metrics.observeRequest({ path: '/api/x/3', method: 'GET', statusCode: 500, durationMs: 20 });

  const snap1 = metrics.snapshot();
  assert.equal(snap1.requestsTotal, snap0.requestsTotal + 3);
  assert.ok(snap1.byStatusClass['2xx'] >= snap0.byStatusClass['2xx'] + 1);
  assert.ok(snap1.byStatusClass['4xx'] >= snap0.byStatusClass['4xx'] + 1);
  assert.ok(snap1.byStatusClass['5xx'] >= snap0.byStatusClass['5xx'] + 1);
  // 错误率计算基于全量计数，仍应落在 (0,1)
  assert.ok(snap1.errorRate > 0 && snap1.errorRate < 1);
  // p95 直方图分桶上界 >= p50 上界
  assert.ok(snap1.latencyEstimatesMs.p95 >= snap1.latencyEstimatesMs.p50);
  // topRoutes 含归一化模板且平均耗时正确
  const route = snap1.topRoutes.find((r) => r.route === 'GET /api/x/:id');
  assert.ok(route, 'topRoutes 应含归一化后的路由');
  assert.equal(route.count >= 3, true);
});

// ============== 5) app.js 装配与部署产物防回归 ==============

test('app.js 装配：requestContext 必须最先挂载，健康/指标路由注册，错误处理带 requestId', () => {
  const appSrc = fs.readFileSync(path.join(ROOT, 'server/src/app.js'), 'utf8');  const ctxIdx = appSrc.indexOf('app.use(requestContext)');
  const corsIdx = appSrc.indexOf('app.use(cors())');
  assert.ok(ctxIdx !== -1, 'app.js 应挂载 requestContext');
  assert.ok(corsIdx > ctxIdx, 'requestContext 必须在 cors 之前（全链路 requestId）');
  assert.ok(appSrc.includes("require('./routes/health')"), '应注册健康检查路由');
  assert.ok(appSrc.includes("app.use('/', healthRoutes)"), '健康/指标路由应挂载在根路径');
  assert.ok(appSrc.includes('requestId: req.requestId') && appSrc.includes("logger.error('Unhandled error'"), '全局错误处理应输出含 requestId 的 JSON 日志');
});

test('部署产物：compose 持久化卷/健康依赖序，server 镜像非 root + 健康检查，部署文档齐备', () => {
  const compose = fs.readFileSync(path.join(ROOT, 'docker-compose.yml'), 'utf8');
  assert.ok(compose.includes('mysql_data:/var/lib/mysql'), 'MySQL 数据必须使用命名卷持久化');
  assert.ok(compose.includes('uploads_data:/app/uploads'), '上传文件必须使用命名卷持久化');
  assert.ok(compose.includes('condition: service_healthy'), '服务启动必须依赖 healthcheck');
  assert.ok(compose.includes('service_completed_successfully'), 'server 必须在幂等迁移成功后启动');
  assert.ok(compose.includes('node init-db.js'), '必须执行幂等迁移');
  assert.ok(compose.includes('${DB_PASSWORD:?'), '必填密钥缺失时 compose 必须拒绝启动');

  const serverDockerfile = fs.readFileSync(path.join(ROOT, 'server/Dockerfile'), 'utf8');
  assert.ok(/USER\s+node/.test(serverDockerfile), 'server 容器必须以非 root 用户运行');
  assert.ok(serverDockerfile.includes('HEALTHCHECK'), 'server 镜像必须内置健康检查');
  assert.ok(serverDockerfile.includes('--omit=dev'), '生产镜像不得安装 devDependencies');

  const adminNginx = fs.readFileSync(path.join(ROOT, 'admin/nginx.conf'), 'utf8');
  assert.ok(adminNginx.includes('proxy_pass http://server:3001'), 'Nginx 必须反代后端');
  assert.ok(adminNginx.includes('try_files $uri $uri/ /index.html'), 'history 路由必须有回退');

  const deployDoc = fs.readFileSync(path.join(ROOT, 'docs/DEPLOY.md'), 'utf8');
  assert.ok(deployDoc.includes('mysqldump'), '部署文档必须包含备份方式');
  assert.ok(deployDoc.includes('mysql_data'), '部署文档必须说明数据持久化');
  assert.ok(deployDoc.includes('/health/ready'), '部署文档必须说明健康检查');
});
