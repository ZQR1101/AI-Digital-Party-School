/**
 * 基础运行指标（进程内存态，重启归零）。
 *
 * 采集：
 * - requests_total：总请求数
 * - 按状态类（2xx/3xx/4xx/5xx）分桶
 * - 按路由模板（如 /api/tasks/:taskId）统计请求/错误
 * - 延迟直方图（固定分桶，可计算 p50/p95/p99 估计值）
 * - 进程运行时长、内存、活跃数据库连接数
 *
 * 通过 GET /metrics 以 JSON 暴露。
 */

const HISTOGRAM_BUCKETS_MS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

const startedAt = Date.now();
const requestsTotal = { count: 0 };
const byStatusClass = { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 };
const byRoute = new Map(); // routeTemplate -> { count, errors, totalMs }
const latency = HISTOGRAM_BUCKETS_MS.map((le) => ({ le, count: 0 }));
const activeRequests = { count: 0 };

function statusClass(code) {
  if (code >= 500) return '5xx';
  if (code >= 400) return '4xx';
  if (code >= 300) return '3xx';
  return '2xx';
}

/** 把具体路径归一化为路由模板，避免高基数：/api/tasks/123 -> /api/tasks/:id */
function routeTemplate(path) {
  return String(path || '')
    .split('/')
    .map((seg) => (/^\d+$/.test(seg) ? ':id' : seg))
    .join('/');
}

/** 记录一次完成的请求（由 requestContext 中间件在 finish 时调用） */
function observeRequest({ path, method, statusCode, durationMs }) {
  requestsTotal.count += 1;
  const cls = statusClass(statusCode);
  if (byStatusClass[cls] !== undefined) byStatusClass[cls] += 1;

  const key = `${method} ${routeTemplate(path)}`;
  const stat = byRoute.get(key) || { count: 0, errors: 0, totalMs: 0 };
  stat.count += 1;
  if (cls === '4xx' || cls === '5xx') stat.errors += 1;
  stat.totalMs += durationMs;
  byRoute.set(key, stat);

  const bucket = latency.find((b) => durationMs <= b.le);
  if (bucket) bucket.count += 1;
}

function percentileFromHistogram(p) {
  const total = latency.reduce((s, b) => s + b.count, 0);
  if (!total) return 0;
  const target = total * p;
  let acc = 0;
  for (const b of latency) {
    acc += b.count;
    if (acc >= target) return b.le;
  }
  return null;
}

function snapshot() {
  const mem = process.memoryUsage();
  let db = null;
  try {
    const pool = require('../config/db');
    db = { total: pool.pool?._allConnections?.length || 0, free: pool.pool?._freeConnections?.length || 0 };
  } catch {
    db = null;
  }
  return {
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    timestamp: new Date().toISOString(),
    requestsTotal: requestsTotal.count,
    // 快照必须是不可变拷贝：调用方持有旧快照不应看到后续请求的实时变化
    byStatusClass: { ...byStatusClass },
    errorRate: requestsTotal.count
      ? Number(((byStatusClass['4xx'] + byStatusClass['5xx']) / requestsTotal.count).toFixed(4))
      : 0,
    latencyHistogramMs: latency.map((b) => ({ le: b.le, count: b.count })),
    latencyEstimatesMs: {
      p50: percentileFromHistogram(0.5),
      p95: percentileFromHistogram(0.95),
      p99: percentileFromHistogram(0.99),
    },
    topRoutes: [...byRoute.entries()]
      .map(([route, s]) => ({ route, count: s.count, errors: s.errors, avgMs: Number((s.totalMs / s.count).toFixed(2)) }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20),
    process: {
      memoryRssMb: Number((mem.rss / 1048576).toFixed(2)),
      memoryHeapUsedMb: Number((mem.heapUsed / 1048576).toFixed(2)),
      nodeVersion: process.version,
      pid: process.pid,
      activeRequests: activeRequests.count,
      dbConnections: db,
    },
  };
}

module.exports = { observeRequest, snapshot, routeTemplate, HISTOGRAM_BUCKETS_MS, activeRequests };
