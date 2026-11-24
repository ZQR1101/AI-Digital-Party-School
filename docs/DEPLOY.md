# 部署文档 — AI 数智党校学习系统

本文档覆盖 Docker Compose 一键部署、MySQL 数据持久化与备份、健康检查与指标、日志采集与常见问题。

## 一、系统组成

| 服务 | 说明 | 端口（宿主机默认） |
|---|---|---|
| mysql | MySQL 8.0，数据持久化在命名卷 `mysql_data` | 默认不暴露（可注释开启 3306） |
| db-init | 一次性幂等迁移（建库表/补列/补索引/种子账号），完成后退出 | - |
| server | Node.js 后端（API + 静态上传文件） | 默认不暴露（可注释开启 3001） |
| admin | 管理后台（Nginx 托管构建产物并反向代理 API） | **8080** |
| member | 学员端（Nginx 托管构建产物并反向代理 API） | **8081** |

请求链路：浏览器 → Nginx(admin/member) → `/api`、`/uploads` 反代到 server:3001 → MySQL。

## 二、一键部署

### 1. 准备环境变量

在**项目根目录**创建 `.env`（与 docker-compose.yml 同级）：

```bash
# 数据库 root 口令（强口令）
DB_PASSWORD=请替换为强口令

# 初始种子账号口令（≥10 位强口令，init-db.js 注入）
SEED_PASSWORD=请替换为强口令

# 后台新建用户默认口令（≥10 位强口令）
DEFAULT_USER_PASSWORD=请替换为强口令

# JWT 签名密钥（必须替换）：openssl rand -hex 32
JWT_SECRET=请替换为长随机串

# 可选：后台/学员端端口
ADMIN_PORT=8080
MEMBER_PORT=8081
# 可选：日志级别 debug|info|warn|error
LOG_LEVEL=info

# 可选：AI 模型与 RAG（不配置时后端自动降级为确定性模板/本地关键词算法）
# compose 会把以下变量原样传入后端容器
AI_API_URL=https://api.deepseek.com/v1/chat/completions
AI_API_KEY=
AI_MODEL=deepseek-chat
# RAG 语义检索（阿里云百炼，Key 形如 sk-xxx）
EMBEDDING_API_KEY=
RERANKER_API_KEY=
# 向量数据库（可选）
QDRANT_URL=
```

缺任一必填项时 `docker compose up` 会直接报错拒绝启动（`:?` 语法），不会带默认弱口令上线。

### 2. 启动

```bash
docker compose up -d --build
```

启动顺序由 healthcheck/depends_on 保证：mysql（healthy）→ db-init（迁移成功退出）→ server（healthy）→ admin/member。

首次启动后验证：

```bash
docker compose ps                 # 5 个服务，db-init 状态为 exited (0)
docker compose logs db-init       # 确认"迁移完成"日志
curl http://localhost:8080/api/health          # 存活探针
curl http://localhost:8080/api/health/ready    # 就绪探针（含 DB 检查）
```

- 管理后台：`http://localhost:8080`
- 学员端：`http://localhost:8081`
- 健康检查（经 Nginx 精确映射到后端，任一入口均可）：
  - `GET /api/health` 存活探针（liveness，不探测依赖）
  - `GET /api/health/ready` 就绪探针（readiness，探测 MySQL；不可用返回 503）
- 指标 `GET /metrics` **不对外公开**：仅限容器网络内部采集，例如
  `docker compose exec server wget -qO- http://127.0.0.1:3001/metrics`。

### 3. 重新构建与停止

```bash
docker compose up -d --build      # 代码更新后重建（数据保留）
docker compose down               # 停止并删除容器，数据卷保留
docker compose down -v            # ⚠️ 连同数据卷一并删除（数据库清空，慎用）
```

## 三、MySQL 数据持久化与备份

- 数据持久化在命名卷 `mysql_data`（容器删除/重建/升级不影响数据）。
- 上传文件持久化在命名卷 `uploads_data`，挂载到 server 容器 `/app/uploads`。

### 备份

```bash
# 逻辑备份（推荐每日 cron 执行）
docker compose exec mysql sh -c 'mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction --routines party_school' > backup_$(date +%F).sql

# 数据卷快照（停机备份）
docker compose stop server
docker run --rm -v ai-digital-party-school_mysql_data:/data -v "$PWD:/out" alpine \
  tar czf /out/mysql_data_$(date +%F).tar.gz -C /data .
```

### 恢复

```bash
docker compose exec -T mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" party_school' < backup_2026-01-01.sql
```

## 四、可观测性

### 请求链路追踪

- 每个请求分配 `requestId`：优先复用上游 `X-Request-ID` 头（需匹配 `[A-Za-z0-9._-]{1,64}`），否则生成 UUID v4。
- 响应头回写 `X-Request-ID`；前端/网关报障时携带该 ID 即可精确定位一条请求的全部日志。
- 访问日志 JSON 字段：`requestId / method / path / statusCode / durationMs / userId / userAgent`。

### JSON 结构化日志

- 单行 JSON 输出到 stdout/stderr，`docker compose logs server` 或接 Loki/ELK 直接采集。
- 字段：`timestamp / level / message / requestId / meta / error{name,message,stack}`。
- 敏感字段（password/token/secret/authorization/apiKey 等）自动脱敏为 `***`。
- 级别由 `LOG_LEVEL` 控制（默认 `info`）。

### 健康检查

| 端点 | 用途 | 失败行为 |
|---|---|---|
| `GET /health` | liveness：进程存活 | 进程挂掉由编排重启 |
| `GET /health/ready` | readiness：MySQL 可达 | 返回 503，负载均衡摘除该实例 |
| `GET /metrics` | 指标采集 | - |

容器级 HEALTHCHECK（server 镜像内置）调用 `/health/ready`。

### 基础指标（GET /metrics，仅容器网络内部可访问）

```json
{
  "requestsTotal": 1234,
  "byStatusClass": { "2xx": 1100, "4xx": 120, "5xx": 14 },
  "errorRate": 0.1085,
  "latencyEstimatesMs": { "p50": 25, "p95": 500, "p99": 2500 },
  "topRoutes": [{ "route": "GET /api/tasks/my", "count": 320, "errors": 2, "avgMs": 8.5 }],
  "process": { "memoryRssMb": 128.4, "dbConnections": { "total": 10, "free": 8 }, "activeRequests": 3 }
}
```

指标为进程内存态（重启归零）。生产建议接入 Prometheus 时按 `requestsTotal`/`byStatusClass` 做速率查询。

## 五、升级与回滚

```bash
# 升级：拉新代码后重建（迁移幂等，自动补列/补索引，不删数据）
git pull
docker compose up -d --build

# 回滚：切回旧版本重建（数据库迁移只增不删，回滚旧代码兼容）
git checkout <上一个发布 tag>
docker compose up -d --build
```

数据库迁移（`server/init-db.js`）幂等可重复执行：只 `CREATE TABLE IF NOT EXISTS`、补缺失列/索引，绝不删表删列。

## 六、常见问题

| 现象 | 排查 |
|---|---|
| `db-init` 反复重启失败 | `docker compose logs mysql db-init`：多为 `SEED_PASSWORD` 弱口令被拒（需 ≥10 位）或 MySQL 未就绪（重试 30 次 ×5s） |
| server 起不来，日志 `ER_ACCESS_DENIED` | 根 `.env` 的 `DB_PASSWORD` 与既有 `mysql_data` 卷中的旧口令不一致；改回旧口令或 `down -v` 重建卷 |
| 登录报 401 且日志出现 `JWT` 相关错误 | 部署后更换过 `JWT_SECRET`，旧 token 全部失效，重新登录即可 |
| 页面能打开但接口 502 | server 未就绪（`/health/ready` 503）或数据库未迁移完成，查看 `docker compose logs server db-init` |
| 磁盘增长 | 日志由 Docker 轮转；上传文件在 `uploads_data` 卷，用 `docker compose exec server ls /app/uploads` 排查 |

## 七、非 Docker 部署（备选）

```bash
# 后端（pm2）
cd server && npm ci --omit=dev
SEED_PASSWORD=... DB_PASSWORD=... node init-db.js   # 幂等迁移
pm2 start ecosystem.config.js
# 前端
cd admin && npm ci && npm run build   # 产物 dist/ 交由任意 Nginx 托管（参考 admin/nginx.conf）
npm ci && npm run build               # 学员端（仓库根目录），参考 deploy/member-nginx.conf
```

## 八、安全清单（上线前）

- [ ] 根 `.env` 四个必填密钥全部为强随机值（`openssl rand -hex 32` / `pwgen -s 16 1`）
- [ ] `.env` 不进入版本库（.gitignore 已覆盖；确认无提交记录）
- [ ] MySQL 3306 不对公网暴露（compose 默认不映射端口）
- [ ] 生产环境在 Nginx 外层接入 TLS（本方案 Nginx 监听 80，建议外层由云 LB/Ingress 终止 HTTPS）
- [ ] 首次登录后立即修改种子账号口令
