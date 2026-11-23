/**
 * 压测结果对比：node perf/compare.js <before-label> <after-label>
 * 输出顺序采样延迟对比 + 多级并发实测吞吐对比。
 */
const fs = require('fs');
const path = require('path');

function load(label) {
  const file = path.join(__dirname, 'results', `${label}.json`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

const WORKLOADS = [
  ['taskList', '任务列表(逐行完成率)'],
  ['taskCompletion', '任务完成率聚合'],
  ['dashboardSecretary', '统计看板(书记)'],
  ['dashboardAdmin', '统计看板(管理员)'],
  ['orgTree', '组织树'],
  ['userTasks', '党员任务列表'],
  ['recordStats', '学习记录完成统计'],
];

function main() {
  const [beforeLabel, afterLabel] = process.argv.slice(2);
  if (!beforeLabel || !afterLabel) {
    console.error('用法: node perf/compare.js <before-label> <after-label>');
    process.exit(1);
  }
  const before = load(beforeLabel);
  const after = load(afterLabel);
  const byName = (payload) => Object.fromEntries(payload.results.map(r => [r.name, r]));
  const b = byName(before);
  const a = byName(after);

  console.log(`\n数据规模: ${before.orgCount} 组织 | MySQL ${before.mysqlVersion}`);
  console.log(`基线: ${beforeLabel} (${before.createdAt})\n优化后: ${afterLabel} (${after.createdAt})`);
  if (before.sampling) {
    console.log(`采样: 顺序 ${before.sampling.sequentialIterations} 次/负载 | 并发级别 ${(before.sampling.concurrencyLevels || []).join('/')}`);
  }

  console.log('\n## 顺序采样延迟\n');
  console.log('| 工作负载 | 基线均值 | 优化后均值 | 延迟变化 | 基线 p95 | 优化后 p95 | 基线吞吐 | 优化后吞吐 |');
  console.log('|---|---|---|---|---|---|---|---|');
  for (const [name, label] of WORKLOADS) {
    const r0 = b[name];
    const r1 = a[name];
    if (!r0 || !r1 || r0.error || r1.error) {
      const b0 = r0 && r0.error ? r0.error : (r0 ? `${r0.meanMs}ms` : '-');
      const a0 = r1 && r1.error ? r1.error : (r1 ? `${r1.meanMs}ms` : '-');
      console.log(`| ${label} | ${b0} | ${a0} | - | - | - | - | - |`);
      continue;
    }
    const dLatency = ((r1.meanMs - r0.meanMs) / r0.meanMs * 100).toFixed(1);
    console.log(`| ${label} | ${r0.meanMs}ms | ${r1.meanMs}ms | ${dLatency}% | ${r0.p95Ms}ms | ${r1.p95Ms}ms | ${r0.opsPerSec} ops/s | ${r1.opsPerSec} ops/s |`);
  }

  // 并发实测（若两侧均有 concurrency 数据）
  const bothConc = WORKLOADS.every(([name]) => b[name]?.concurrency && a[name]?.concurrency);
  if (bothConc) {
    const levels = b.taskList.concurrency.map(c => c.workers);
    console.log('\n## 并发实测吞吐（ops/s，时间预算实测）\n');
    console.log(`| 工作负载 | ${levels.map(l => `并发×${l}`).join(' | ')} |`);
    console.log(`|---|${levels.map(() => '---|').join('')}`);
    for (const [name, label] of WORKLOADS) {
      const cells = levels.map((l) => {
        const c0 = b[name].concurrency.find(c => c.workers === l);
        const c1 = a[name].concurrency.find(c => c.workers === l);
        if (!c0 || !c1) return '-';
        const ratio = (c1.opsPerSec / c0.opsPerSec).toFixed(1);
        return `${c0.opsPerSec} → ${c1.opsPerSec}（${ratio}×）`;
      });
      console.log(`| ${label} | ${cells.join(' | ')} |`);
    }
  } else {
    console.log('\n（其中一个结果文件缺少并发实测数据，跳过并发对比）');
  }
}

main();
