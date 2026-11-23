/**
 * 数据库性能压测脚本（可重复执行）。
 *
 * 通过真实服务层代码路径压测四类目标查询：
 *   1) 任务完成率   TaskService.list（含逐行完成率相关子查询）+ queryTaskCompletion
 *   2) 统计报表     StatisticsService.getDashboard（书记范围 / 管理员全局）
 *   3) 组织树       OrganizationService.getTree
 *   4) 学习记录查询 TaskService.getUserTasks + LearningRecordService.getCompletionStats
 *
 * 用法：
 *   node perf/seed-perf.js              # 先建库/造数
 *   DB_NAME=party_school_perf node perf/bench.js [--label=baseline] [--iter=N]
 *
 * 输出：perf/results/<label>.json（含延迟分位数与吞吐量），供 compare.js 对比。
 */
require('dotenv').config();
process.env.DB_NAME = process.env.DB_NAME || 'party_school_perf';

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

const PERF_DB = 'party_school_perf';

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

/** 顺序执行 N 次采集延迟样本；吞吐量按总耗时折算 */
async function measure(name, fn, iterations) {
  await fn(); // 1 次预热（不计入统计）
  const samples = [];
  const started = process.hrtime.bigint();
  for (let i = 0; i < iterations; i += 1) {
    const t0 = process.hrtime.bigint();
    await fn();
    samples.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  const totalMs = Number(process.hrtime.bigint() - started) / 1e6;
  const sorted = [...samples].sort((a, b) => a - b);
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  return {
    name,
    iterations,
    meanMs: Math.round(mean * 100) / 100,
    p50Ms: Math.round(percentile(sorted, 50) * 100) / 100,
    p95Ms: Math.round(percentile(sorted, 95) * 100) / 100,
    p99Ms: Math.round(percentile(sorted, 99) * 100) / 100,
    maxMs: Math.round(sorted[sorted.length - 1] * 100) / 100,
    totalMs: Math.round(totalMs * 100) / 100,
    throughputOpsPerSec: Math.round((iterations / (totalMs / 1000)) * 100) / 100,
  };
}

async function resolveSubjects() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: PERF_DB,
  });
  // 书记选有下级组织的（党总支层级），保证数据范围非平凡
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
  const iterHeavy = Number(args.iter || 5);
  const iterLight = Math.max(iterHeavy, 20);

  console.log(`压测库: ${PERF_DB} | 标签: ${label}`);
  const subjects = await resolveSubjects();
  console.log(`组织 ${subjects.orgCount} 个 | 书记#${subjects.secretary.id} 党员#${subjects.member.id} 支部#${subjects.branchOrg}`);

  // 书记数据范围（复用真实权限语义：本组织及下级）
  const secScope = await OrganizationService.getDescendantIds(subjects.secretary.organizationId);
  const memberScope = await OrganizationService.getAncestorIds(subjects.member.organizationId);
  console.log(`书记范围 ${secScope.length} 个组织 | 党员可见任务组织 ${memberScope.length} 个`);

  const completionRange = resolveTimeRange(dashboardTimeRange('6m'));
  const workloads = [
    { key: 'taskList', label: '任务列表(含逐行完成率)', fn: () => TaskService.list({ page: 1, pageSize: 10, organizationIds: secScope }), iter: iterHeavy },
    { key: 'taskCompletion', label: '任务完成率聚合', fn: () => queryTaskCompletion(secScope, completionRange), iter: iterHeavy },
    { key: 'dashboardSecretary', label: '统计看板(书记)', fn: () => StatisticsService.getDashboard({ orgIds: secScope, range: '6m' }), iter: iterHeavy },
    { key: 'dashboardAdmin', label: '统计看板(管理员全局)', fn: () => StatisticsService.getDashboard({ orgIds: null, range: '6m' }), iter: Math.max(3, Math.min(iterHeavy, 5)) },
    { key: 'orgTree', label: '组织树', fn: () => OrganizationService.getTree(), iter: iterLight },
    { key: 'userTasks', label: '党员任务列表', fn: () => TaskService.getUserTasks(subjects.member.id, { page: 1, pageSize: 10 }), iter: iterLight },
    { key: 'recordStats', label: '学习记录完成统计', fn: () => LearningRecordService.getCompletionStats(subjects.branchOrg), iter: iterLight },
  ];

  const results = [];
  for (const w of workloads) {
    process.stdout.write(`测量 ${w.label} ... `);
    try {
      const stat = await measure(w.key, w.fn, w.iter);
      results.push(stat);
      console.log(`均值 ${stat.meanMs}ms | p95 ${stat.p95Ms}ms | 吞吐 ${stat.throughputOpsPerSec} ops/s`);
    } catch (err) {
      console.log(`失败: ${err.message}`);
      results.push({ name: w.key, label: w.label, error: err.message });
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
