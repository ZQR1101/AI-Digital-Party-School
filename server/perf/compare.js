/**
 * 压测结果对比：node perf/compare.js baseline optimized
 */
const fs = require('fs');
const path = require('path');

function load(label) {
  const file = path.join(__dirname, 'results', `${label}.json`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

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
  console.log(`基线: ${beforeLabel} (${before.createdAt})\n优化后: ${afterLabel} (${after.createdAt})\n`);
  console.log('| 工作负载 | 基线均值 | 优化后均值 | 延迟变化 | 基线吞吐 | 优化后吞吐 | 吞吐变化 |');
  console.log('|---|---|---|---|---|---|---|');
  for (const [name, label] of Object.entries({
    taskList: '任务列表(逐行完成率)',
    taskCompletion: '任务完成率聚合',
    dashboardSecretary: '统计看板(书记)',
    dashboardAdmin: '统计看板(管理员)',
    orgTree: '组织树',
    userTasks: '党员任务列表',
    recordStats: '学习记录完成统计',
  })) {
    const r0 = b[name];
    const r1 = a[name];
    if (!r0 || !r1 || r0.error || r1.error) {
      const b0 = (r0 && r0.error) ? r0.error : (r0 ? `${r0.meanMs}ms` : '-');
      const a0 = (r1 && r1.error) ? r1.error : (r1 ? `${r1.meanMs}ms` : '-');
      console.log(`| ${label} | ${b0} | ${a0} | - | - | - | - |`);
      continue;
    }
    const dLatency = ((r1.meanMs - r0.meanMs) / r0.meanMs * 100).toFixed(1);
    const dThroughput = ((r1.throughputOpsPerSec - r0.throughputOpsPerSec) / r0.throughputOpsPerSec * 100).toFixed(1);
    console.log(`| ${label} | ${r0.meanMs}ms | ${r1.meanMs}ms | ${dLatency}% | ${r0.throughputOpsPerSec} ops/s | ${r1.throughputOpsPerSec} ops/s | ${dThroughput}% |`);
  }
}

main();
