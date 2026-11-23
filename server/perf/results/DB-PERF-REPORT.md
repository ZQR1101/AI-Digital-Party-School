# 数据库性能诊断报告 — AI-Digital-Party-School

- 日期：2026-11-23 ｜ MySQL 8.0.46 ｜ 数据规模：134 组织（99 支部）/ 3124 用户 / 437 任务 / 16457 学习记录 / 6039 考试记录
- 方法：独立测试库 `party_school_perf`（绝不触碰生产库 `party_school`）、确定性种子（固定 PRNG，结果可复现）、EXPLAIN ANALYZE 实测执行计划、真实服务层压测（延迟分位数 + 吞吐量）

## 一、诊断结论（优化前基线）

| 工作负载 | 均值 | p95 | 吞吐 |
|---|---|---|---|
| 任务列表（逐行完成率） | 3.75ms | 4.73ms | 267 ops/s |
| 任务完成率聚合 | 5.65ms | 6.32ms | 177 ops/s |
| 统计看板（书记） | 60.93ms | 66.07ms | 16.4 ops/s |
| **统计看板（管理员全局）** | **1481.35ms** | 1525.24ms | **0.68 ops/s** |
| 组织树 | 2.76ms | 3.03ms | 362 ops/s |
| 党员任务列表 | 3.02ms | 3.76ms | 331 ops/s |
| 学习记录完成统计 | 0.95ms | 1.21ms | 1047 ops/s |

EXPLAIN ANALYZE 定位的三个瓶颈：

1. **统计报表 N+1（主瓶颈）**：`getBranchRanking`/`getByOrganization` 对每个支部循环调用
   `getDescendantIds`（每次全表加载 organizations）+ `getOverview`（8 条串行查询）+
   `queryTaskCompletion`（再查一次组织表）。管理员看板 ≈ 99 支部 × 10+ 次查询 ≈ 1000+ 次串行往返。
   单条 SQL 的执行计划全部走索引且亚毫秒级——问题纯粹是查询次数。
2. **完成率趋势全表扫描**：`getTrend` 的 `WHERE status='completed' AND completedAt IS NOT NULL`
   扫描 learning_records 全表（实测 7.7ms@1.6 万行，随记录数线性恶化）。
3. **范围过滤缺覆盖索引**：users 按 `(organizationId, status, role)` 过滤、learning_tasks 按
   `(organizationId, status)` 过滤、活跃趋势按 `updatedAt` 过滤均依赖 FK 单列索引后回表过滤。

## 二、优化措施（权限语义不变）

| 措施 | 文件 | 说明 |
|---|---|---|
| 组织快照消除 N+1 | `organizationService.js` | 新增 `descendantIdsFromRows`（与 `getDescendantIds` 语义完全一致的纯函数：根缺失→[]、环截断、类型归一） |
| 排行/分组统计快照化 | `statisticsService.js` | `getBranchRanking`/`getByOrganization` 组织表只查一次；各支部概览并行计算（结果顺序不变） |
| 概览查询并行化 | `statisticsService.js` | `getOverview` 8 条独立统计并行下发 |
| 完成率快照透传 | `taskCompletionStatistics.js` | `queryTaskCompletion` 新增可选第 4 参数 orgSnapshot（向后兼容，不传行为不变） |
| 幂等补索引 | `sql/init.sql` + `init-db.js` | `users(organizationId,status,role)`、`learning_tasks(organizationId,status)`、`learning_records(status,completedAt)`、`learning_records(updatedAt)`、`contents(status,createdAt)`；旧库走 `ensureIndex`（information_schema 检查后 ALTER） |

## 三、优化前后对比（同一数据、同一脚本、5 次迭代取分位）

| 工作负载 | 基线均值 | 优化后均值 | 延迟变化 | 基线吞吐 | 优化后吞吐 | 吞吐变化 |
|---|---|---|---|---|---|---|
| 任务列表(逐行完成率) | 3.75ms | 3.62ms | -3.5% | 266.78 ops/s | 276.1 ops/s | +3.5% |
| 任务完成率聚合 | 5.65ms | 5.36ms | -5.1% | 176.98 ops/s | 186.68 ops/s | +5.5% |
| **统计看板(书记)** | 60.93ms | 14.44ms | **-76.3%** | 16.41 ops/s | 69.23 ops/s | **+321.9%** |
| **统计看板(管理员)** | 1481.35ms | 191ms | **-87.1%** | 0.68 ops/s | 5.24 ops/s | **+670.6%** |
| 组织树 | 2.76ms | 1.77ms | -35.9% | 361.86 ops/s | 564.35 ops/s | +56.0% |
| 党员任务列表 | 3.02ms | 2.79ms | -7.6% | 330.95 ops/s | 358.32 ops/s | +8.3% |
| 学习记录完成统计 | 0.95ms | 0.95ms | 0.0% | 1046.72 ops/s | 1050.3 ops/s | +0.3% |

索引生效验证（EXPLAIN ANALYZE）：`getTrend` 由全表扫描变为
`Covering index range scan on learning_records using idx_record_status_completed`。

## 四、语义与回归保障

- `test/org-descendant-parity.test.js`（新增 2 项）：
  - 快照算法 vs 查询版 `getDescendantIds` 在 11 种输入（含字符串 ID、悬挂节点、环、空快照）上逐一比对；
  - 源码断言统计服务不得再逐组织调用 `getDescendantIds`（防 N+1 复发）。
- 权限三态语义未动：admin=null 不限制、非空数组=限定范围、空数组=无权（`getScopedOrgIds`/`assertInScope` 未改）。
- 全量回归：server **184/184 通过**（原 182 + 新增 2）。

## 五、复现方式

```bash
cd server
node perf/seed-perf.js                                   # 重建独立库 party_school_perf（可重复）
DB_NAME=party_school_perf node perf/bench.js --label=baseline --iter=5
node perf/explain.js --out=explain-baseline.txt          # EXPLAIN ANALYZE 诊断
# ...应用优化...
DB_NAME=party_school_perf node perf/bench.js --label=optimized --iter=5
node perf/compare.js baseline optimized                  # 前后对比表
```
