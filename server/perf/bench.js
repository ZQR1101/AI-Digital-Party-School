/**
 * 数据库性能压测脚本（可重复执行）。
 *
 * 通过真实服务层代码路径压测四类目标查询：
 *   1) 任务完成率   TaskService.list（含逐行完成率相关子查询）+ queryTaskCompletion
 *   2) 统计报表     StatisticsService.getDashboard（书记范围 / 管理员全局）
 *   3) 组织树       OrganizationService.getTree
 *   4) 学习记录查询 TaskService.getUserTasks + LearningRecordService.getCompletionStats
 *
 * 【P0 防护】压测必须连接独立压测库 party_school_perf：
 *   - 在导入任何服务模块（含 ../src/config/db 建池）之前，硬性覆盖 DB_NAME。
 *     dotenv 不会覆盖已存在的环境变量，因此 .env 里的 DB_NAME=party_school 不会生效；
 *   - 正式压测前执行 SELECT DATABASE() 复核，不符立即终止。
 *
 * 用法：
 *   node perf/seed-perf.js                # 先建库/造数
 *   node perf/bench.js --label=baseline   # 直接执行也只可能连压测库
 *
 * 采样：默认每个负载顺序采样 100 次（--iter 可调，含 30s 时间预算保护，
 * 大负载自动提前截断但保底 10 个样本）；随后按 1/5/10/20 并发实测吞吐
 * （--conc-levels / --conc-budget / --no-conc 可调）。结果写入 perf/results/<label>.json。
 */
const PERF_DB = 'party_school_perf';
// P0：必须先于 dotenv 与服务模块导入执行
process.env.DB_NAME = PERF_DB;
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const db = require('../src/config/db');
const TaskService = require('../src/services/taskService');
const StatisticsService = require('../src/services/statisticsService');
const OrganizationService = require('../src/services/organizationService');
const LearningRecordService = require('../src/services/learningRecordService');
const { queryTaskCompletion } = require('../src/services/taskCompletionStatistics');
const { dashboardTimeRange, resolveTimeRange } = require('../src/ai/queryParser');

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

function summarize(samples, ops, elapsedMs, extra = {}) {
  const sorted = [...samples].sort((a, b) => a - b);
  const mean = samples.reduce((a, b) => a + b, 0) / (samples.length || 1);
  return {
    samples: samples.length,
    ...extra,
    meanMs: Math.round(mean * 100) / 100,
    p50Ms: Math.round(percentile(sorted, 50) * 100) / 100,
    p95Ms: Math.round(percentile(sorted, 95) * 100) / 100,
    p99Ms: Math.round(percentile(sorted, 99) * 100) / 100,
    maxMs: sorted.length ? Math.round(sorted[sorted.length - 1] * 100) / 100 : 0,
    totalMs: Math.round(elapsedMs * 100) / 100,
    opsPerSec: Math.round((ops / (elapsedMs / 1000)) * 100) / 100,
  };
}

/** 顺序采样：iterations 上限 + 时间预算（保底 10 个样本，防大负载拖垮总时长） */
async function measureSequential(name, fn, iterations, budgetMs) {
  for (let i = 0; i < 3; i += 1) await fn(); // 预热 3 次不计入
  const samples = [];
  const started = Date.now();
  for (let i = 0; i < iterations; i += 1) {
    const t0 = process.hrtime.bigint();
    await fn();
    samples.push(Number(process.hrtime.bigint() - t0) / 1e6);
    if (samples.length >= 10 && Date.now() - started >= budgetMs) break;
  }
  return summarize(samples, samples.length, Date.now() - started, { name, mode: 'sequential', iterations: samples.length });
}

/** 并发实测：N 个 worker 并行调用直至时间预算耗尽，记录每请求延迟 */
async function measureConcurrent(fn, workers, budgetMs) {
  await fn(); // 预热
  const samples = [];
  let ops = 0;
  const errors = [];
  const deadline = Date.now() + budgetMs;
  async function worker() {
    while (Date.now() < deadline) {
      const t0 = process.hrtime.bigint();
      try {
        await fn();
      } catch (err) {
        errors.push(String(err.message || err).slice(0, 200));
        return;
      }
      samples.push(Number(process.hrtime.bigint() - t0) / 1e6);
      ops += 1;
    }
  }
  const started = Date.now();
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return summarize(samples, ops, Date.now() - started, { mode: 'concurrent', workers, errors: errors.length });
}

async function resolveSubjects() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: PERF_DB,
  });
  const [[secretary]] = await conn.query(
    "SELECT u.id, u.organizationId FROM users u JOIN organizations o ON o.id = u.organizationId \
     WHERE u.role = 'secretary' AND u.username LIKE 'perf_sec_%' \
       AND EXISTS (SELECT 1 FROM organizations c WHERE c.parentId = o.id) \
     ORDER BY o.id LIMIT 1"
  );
  const [[member]] = await conn.query(
    "SELECT id, organizationId FROM users WHERE role = 'member' AND username LIKE 'perf_mem_%' ORDER BY id LIMIT 1"
  );
  const [[branchOrg]] = await conn.query(
    "SELECT id FROM organizations WHERE type = 'branch' ORDER BY id LIMIT 1"
  );
  const [[orgCount]] = await conn.query('SELECT COUNT(*) AS n FROM organizations');
  await conn.end();
  if (!secretary || !member || !branchOrg) throw new Error('压测库数据不完整，请先执行 perf/seed-perf.js');
  return { secretary, member, branchOrg: branchOrg.id, orgCount: orgCount.n };
}

async function main() {
  const args = Object.fromEntries(process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => a.replace(/^--/, '').split('=')));
  const label = args.label || `run-${Date.now()}`;
  const iter = Number(args.iter || 100);
  const budgetMs = Number(args.budget || 30000);
  const concLevels = (args['conc-levels'] || '1,5,10,20').split(',').map(Number).filter(Boolean);
  const concBudget = Number(args['conc-budget'] || 3000);
  const runConc = !args['no-conc'];

  console.log(`压测库: ${PERF_DB} | 标签: ${label} | 顺序采样 ${iter} 次 | 并发级别 ${runConc ? concLevels.join('/') : '跳过'}`);
  const subjects = await resolveSubjects();

  // P0 复核：服务层连接池必须落在压测库上，否则立即终止
  const [guardRows] = await db.query('SELECT DATABASE() AS db');
  const actualDb = guardRows[0].db;
  if (actualDb !== PERF_DB) {
    console.error(`\n[P0] 终止：服务层实际连接的是 "${actualDb}"，期望压测库 "${PERF_DB}"。未执行任何压测。`);
    await db.end().catch(() => {});
    process.exit(1);
  }
  console.log(`[P0] 服务层连接复核通过: SELECT DATABASE() = ${actualDb}`);

  console.log(`组织 ${subjects.orgCount} 个 | 书记#${subjects.secretary.id} 党员#${subjects.member.id} 支部#${subjects.branchOrg}`);

  // 书记数据范围（复用真实权限语义：本组织及下级）
  const secScope = await OrganizationService.getDescendantIds(subjects.secretary.organizationId);
  const memberScope = await OrganizationService.getAncestorIds(subjects.member.organizationId);
  console.log(`书记范围 ${secScope.length} 个组织 | 党员可见任务组织 ${memberScope.length} 个`);

  const completionRange = resolveTimeRange(dashboardTimeRange('6m'));
  const workloads = [
    { key: 'taskList', label: '任务列表(含逐行完成率)', fn: () => TaskService.list({ page: 1, pageSize: 10, organizationIds: secScope }) },
    { key: 'taskCompletion', label: '任务完成率聚合', fn: () => queryTaskCompletion(secScope, completionRange) },
    { key: 'dashboardSecretary', label: '统计看板(书记)', fn: () => StatisticsService.getDashboard({ orgIds: secScope, range: '6m' }) },
    { key: 'dashboardAdmin', label: '统计看板(管理员全局)', fn: () => StatisticsService.getDashboard({ orgIds: null, range: '6m' }) },
    { key: 'orgTree', label: '组织树', fn: () => OrganizationService.getTree() },
    { key: 'userTasks', label: '党员任务列表', fn: () => TaskService.getUserTasks(subjects.member.id, { page: 1, pageSize: 10 }) },
    { key: 'recordStats', label: '学习记录完成统计', fn: () => LearningRecordService.getCompletionStats(subjects.branchOrg) },
  ];

  const results = [];
  for (const w of workloads) {
    process.stdout.write(`[顺序] ${w.label} ... `);
    try {
      const stat = await measureSequential(w.key, w.fn, iter, budgetMs);
      results.push(stat);
      console.log(`n=${stat.samples} 均值 ${stat.meanMs}ms | p95 ${stat.p95Ms}ms | p99 ${stat.p99Ms}ms | 吞吐 ${stat.opsPerSec} ops/s`);
    } catch (err) {
      console.log(`失败: ${err.message}`);
      results.push({ name: w.key, label: w.label, error: err.message });
      continue;
    }
    if (runConc) {
      const conc = [];
      for (const level of concLevels) {
        process.stdout.write(`[并发×${level}] ${w.label} ... `);
        try {
          const stat = await measureConcurrent(w.fn, level, concBudget);
          conc.push(stat);
          console.log(`ops=${stat.samples} 吞吐 ${stat.opsPerSec} ops/s | p50 ${stat.p50Ms}ms | p95 ${stat.p95Ms}ms${stat.errors ? ` | 错误 ${stat.errors}` : ''}`);
        } catch (err) {
          console.log(`失败: ${err.message}`);
        }
      }
      const entry = results.find(r => r.name === w.key);
      entry.concurrency = conc;
    }
  }

  const outDir = path.join(__dirname, 'results');
  fs.mkdirSync(outDir, { recursive: true });
  const versionRows = await db.query('SELECT VERSION() AS v').then(r => r[0]);
  const payload = {
    label,
    createdAt: new Date().toISOString(),
    mysqlVersion: versionRows[0].v,
    orgCount: subjects.orgCount,
    guard: { database: actualDb, expected: PERF_DB, verified: actualDb === PERF_DB },
    sampling: { sequentialIterations: iter, sequentialBudgetMs: budgetMs, concurrencyLevels: runConc ? concLevels : [], concurrencyBudgetMs: concBudget },
    results,
  };
  const outFile = path.join(outDir, `${label}.json`);
  fs.writeFileSync(outFile, JSON.stringify(payload, null, 2));
  console.log(`\n结果已写入 ${outFile}`);
  await db.end().catch(() => {});
}

main().catch((err) => {
  console.error('压测失败:', err);
  process.exit(1);
});
