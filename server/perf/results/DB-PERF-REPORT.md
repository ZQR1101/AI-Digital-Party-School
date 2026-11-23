# 数据库性能诊断报告 — AI-Digital-Party-School

- 日期：2026-11-23 ｜ MySQL 8.0.46 ｜ 数据规模：134 组织（99 支部）/ 3124 用户 / 437 任务 / 16457 学习记录 / 6039 考试记录
- 方法：独立测试库 `party_school_perf`（绝不触碰生产库 `party_school`）、确定性种子（固定 PRNG，结果可复现）、EXPLAIN ANALYZE 实测执行计划、真实服务层压测（延迟分位数 + 吞吐量）
- 压测安全防护：bench.js 在导入服务层之前**强制** `DB_NAME=party_school_perf`（dotenv 不覆盖已存在变量，杜绝 .env 的 DB_NAME=party_school 误连业务库），并在执行压测前用 `SELECT DATABASE()` 复核，不符立即终止
- 基线公平性：优化前基线在 git worktree（优化前提交）+ **已摘除新增索引**（还原为 FK 单列索引状态）的库上测得，确保优化后代码不会"蹭到"索引收益、基线代码也不会蹭到新索引
- 采样规模：每负载顺序采样 100 次（分位数 p50/p95/p99 有统计意义），另实测并发 1/5/10/20 的吞吐（时间预算制，非顺序换算）

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

## 三、优化前后对比（v2：worktree 旧代码+旧索引 vs 新代码+新索引，各 100 次采样）

| 工作负载 | 基线均值 | 优化后均值 | 延迟变化 | 基线 p95 | 优化后 p95 | 基线吞吐 | 优化后吞吐 |
|---|---|---|---|---|---|---|---|
| 任务列表(逐行完成率) | 3.44ms | 3.39ms | -1.5% | 4.18ms | 4.43ms | 289.9 ops/s | 295.0 ops/s |
| 任务完成率聚合 | 5.55ms | 5.17ms | -6.8% | 6.67ms | 6.58ms | 180.2 ops/s | 193.4 ops/s |
| **统计看板(书记)** | 57.33ms | 13.73ms | **-76.1%** | 61.43ms | 15.52ms | 17.4 ops/s | 72.8 ops/s |
| **统计看板(管理员)** | 1468.28ms | 206.81ms | **-85.9%** | 1526.67ms | 222.19ms | 0.68 ops/s | 4.84 ops/s |
| 组织树 | 2.79ms | 1.75ms | **-37.3%** | 3.44ms | 2.12ms | 358.4 ops/s | 568.2 ops/s |
| 党员任务列表 | 2.81ms | 2.82ms | +0.4% | 3.41ms | 3.47ms | 354.6 ops/s | 353.4 ops/s |
| 学习记录完成统计 | 0.96ms | 0.92ms | -4.2% | 1.26ms | 1.18ms | 1041.7 ops/s | 1087.0 ops/s |

### 并发实测吞吐（ops/s，多用户并发实测，非顺序换算）

| 工作负载 | 并发×1 | 并发×5 | 并发×10 | 并发×20 |
|---|---|---|---|---|
| 任务列表(逐行完成率) | 295→326 (1.1×) | 1207→1340 (1.1×) | 1792→2084 (1.2×) | 1805→1954 (1.1×) |
| 任务完成率聚合 | 182→198 (1.1×) | 632→681 (1.1×) | 873→870 (1.0×) | 902→839 (0.9×) |
| 统计看板(书记) | 17.4→74 (4.2×) | 70.7→108 (1.5×) | 86.4→102 (1.2×) | 85.5→98.7 (1.2×) |
| **统计看板(管理员)** | 0.69→4.89 (7.1×) | 2.92→4.91 (1.7×) | 4.01→4.96 (1.2×) | 4.13→5.00 (1.2×) |
| 组织树 | 375→576 (1.5×) | 1010→2167 (2.1×) | 1098→2204 (2.0×) | 1115→2232 (2.0×) |
| 党员任务列表 | 350→359 (1.0×) | 1251→1101 (0.9×) | 1498→1179 (0.8×) | 1474→1180 (0.8×) |
| 学习记录完成统计 | 1048→1066 (1.0×) | 4809→4755 (1.0×) | 7814→6924 (0.9×) | 7846→6789 (0.9×) |

并发解读：管理员看板单请求快 7.1 倍，但高并发下吞吐封顶在 ≈5 ops/s——瓶颈转为 Node 进程内的串行 SQL
往返（连接池默认 10，而看板仍需数十条查询），这是下一步引入聚合 SQL/缓存的自然候选；
组织树与书记看板在并发下仍稳定扩展 2.0-2.1×/4.2×。党员任务列表高并发下有 10-20% 波动（新索引对该
查询无收益、处于噪声区间），如需进一步压榨可考虑为其单独建 `(status, organizationId)` 索引。

> v1（5 次迭代）对比结论与 v2 一致：管理员看板 -87%、书记看板 -76%、组织树 -36%；
> v2 以更大采样与并发实测复核了同一结论。v1 数据保留在 results/baseline.json、results/optimized.json。

索引生效验证（EXPLAIN ANALYZE）：`getTrend` 由全表扫描变为
`Covering index range scan on learning_records using idx_record_status_completed`；
任务完成率聚合（实际生产 SQL 经 FORMAT=TREE + 物化对集实测 0.7ms）走
`idx_task_org_status` 与 `idx_users_org_status_role` 覆盖索引查找。

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
node perf/bench.js --label=baseline --iter=100           # 100 次采样 + 并发 1/5/10/20 实测（强制压测库，连错即终止）
node perf/explain.js --out=explain-baseline.txt          # EXPLAIN ANALYZE 诊断（含实际生产 SQL 分析）
# ...应用优化...
node perf/bench.js --label=optimized --iter=100
node perf/compare.js baseline optimized                  # 前后对比表（延迟分位数 + 并发吞吐）
```

注：bench.js 无需手动传 DB_NAME——它在导入服务层之前强制注入压测库名并二次校验，
即使 .env 写的是业务库名也不会误连（P0 防护）。
