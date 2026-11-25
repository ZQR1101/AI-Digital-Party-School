# AI 数智党校学习系统

面向党员学习和党组织管理的平台。学员可以完成课程、任务与测评，查看学习报告，并通过 AI 助教查询党校资料。管理员和支部书记通过管理后台组织学习、跟踪进度和查询统计数据。

## 主要功能

| 角色 | 功能 |
| --- | --- |
| 学员 | 浏览文章和视频、完成学习任务、在线测评与逐题查看判分，查看近 30 天学习报告、薄弱知识点和最近两次测评对比 |
| 管理员 | 管理组织和人员、发布学习内容、组卷并下发测评、发布学习任务、查看统计看板和使用 AI 问数 |
| 支部书记 | 在本组织及下级组织范围内发布学习任务、查看统计和使用 AI 问数 |

- **AI 助教**通过 BM25 与向量检索召回知识库片段，经 RRF 融合与重排后生成带来源的回答。资料不足时会提示未找到依据，并可结合个人学习画像给出学习建议。
- **个性化推荐**结合学习记录和薄弱知识点推荐公共学习内容。模型不可用时，推荐使用规则，综合评价使用确定性模板。
- **AI 组织问数**默认使用 Function Calling，将自然语言转换为受控的统计查询。后端校验工具参数和用户的组织权限范围。

接口、模型配置与知识库格式见 [AI 接口文档](server/AI_API.md)。

## 技术栈与目录

| 路径 | 用途 |
| --- | --- |
| `src-qianduan/`、`public-qianduan/` | 学员端，使用 Vue 3、Vite、Vant |
| `admin/` | 管理后台，使用 Vue 3、Vite、Element Plus、Pinia、ECharts |
| `server/` | Node.js、Express、MySQL 8.0 后端，使用 JWT 认证 |
| `server/src/rag/`、`server/knowledge/` | RAG 检索实现与知识库资料 |
| `server/sql/` | 数据库建表和迁移 SQL |
| `deploy/`、`docker-compose.yml` | Docker 部署、Nginx 代理和容器集成测试 |
| `e2e/`、`.github/workflows/` | Playwright 端到端测试和 GitHub Actions 工作流 |

## 本地开发

使用 Node.js 22.x（至少 22.13.0）及 MySQL 8.0。以下 PowerShell 命令均从仓库根目录执行。

### 配置并初始化数据库

```powershell
npm ci
npm --prefix admin ci
npm --prefix server ci
if (-not (Test-Path server/.env)) { Copy-Item server/.env.example server/.env }
```

启动本地 MySQL，在 `server/.env` 中填写以下变量。

| 变量 | 用途 |
| --- | --- |
| `DB_HOST`、`DB_PORT`、`DB_USER`、`DB_PASSWORD` | MySQL 连接信息，默认地址为 `127.0.0.1:3306`，初始化账号需有建库建表权限 |
| `DB_NAME` | 使用初始化脚本创建的 `party_school` |
| `SEED_PASSWORD` | 初始账号口令，至少 10 位 |
| `JWT_SECRET` | 用于签发登录令牌，填写长随机字符串 |
| `DEFAULT_USER_PASSWORD` | 后台创建或导入用户时使用的默认口令，启用该功能时填写至少 10 位 |

```powershell
npm --prefix server run db:init
```

`db:init` 可以重复执行，会创建基础表、应用 AI 和测评迁移并补齐学习记录相关的列和索引。旧库的 `papers` 表如果缺少 `category` 列，可在初始化后执行 `npm --prefix server run db:upgrade:papers`。

### 启动服务

完成配置与初始化后，Windows 上可双击 `一键启动.bat` 启动三端，双击 `一键停止.bat` 停止。也可以在三个终端分别运行下列命令。

| 服务 | 命令 | 默认地址 |
| --- | --- | --- |
| 后端 API | `npm --prefix server run dev` | `http://127.0.0.1:3001/api` |
| 管理后台 | `npm --prefix admin run dev` | `http://localhost:5173` |
| 学员端 | `npm run dev` | `http://localhost:5174` |

后端就绪检查使用 `http://127.0.0.1:3001/health/ready`。两个前端的开发服务器将 `/api` 与 `/uploads` 代理到后端。

首次初始化后，可用 `admin`（管理员）或 `zhangsan`（支部书记）登录后台，用 `lisi` 或 `wangwu` 登录学员端。初始口令为配置的 `SEED_PASSWORD`。重复初始化会保留已有账号的口令。学员端常用页面为推荐首页 `/#/home`、学习任务 `/#/tasks`、在线测评 `/#/exam`、学习档案 `/#/record` 和 AI 助教 `/#/ai-assistant`。

## Docker Compose 部署

在**仓库根目录**创建 `.env`，设置 `DB_PASSWORD`、`SEED_PASSWORD` 和 `JWT_SECRET`。如需在后台使用默认口令创建或导入用户，同时设置 `DEFAULT_USER_PASSWORD`。

```powershell
docker compose up -d --build
docker compose ps --all
curl.exe http://localhost:8080/api/health/ready
```

默认入口为管理后台 `http://localhost:8080` 和学员端 `http://localhost:8081`。Compose 等待 MySQL 就绪并完成 `db-init` 迁移后启动后端。两个入口都提供 `/api/health` 和 `/api/health/ready`，运行指标 `/metrics` 供容器网络内部采集。数据库和上传文件分别存放在 `mysql_data`、`uploads_data` 命名卷中。

容器运行的 AI 助教需要挂载知识库目录。可在根目录创建 `docker-compose.override.yml`，为后端添加只读挂载。

```yaml
services:
  server:
    volumes:
      - ./server/knowledge:/app/knowledge:ro
```

保存后运行 `docker compose up -d` 应用挂载。

端口配置、日志、备份与恢复见 [部署文档](docs/DEPLOY.md)。

## AI 配置与检索评测

本地开发在 `server/.env` 中配置 AI。Compose 部署使用仓库根目录的 `.env`。设置 `AI_API_URL`、`AI_API_KEY` 和 `AI_MODEL` 可接入 OpenAI 兼容对话模型。语义检索和重排分别通过 `EMBEDDING_*`、`RERANKER_*` 配置，缺少对应配置时会使用本地哈希向量和关键词重排。环境变量模板见 [后端配置示例](server/.env.example)。

```powershell
Push-Location server
node rag-diagnose.js
node rag-evaluate.js
Pop-Location
```

`rag-diagnose.js` 显示检索后端，加 `--live` 可验证已配置的外部服务。`rag-evaluate.js` 是历史兼容脚本：19 道题、50 个分块、仅文档级 Recall@3；命中正确文档不等于命中正确分块或答案证据，结果写入 `server/rag-eval-report.json`。

系统化质量基线在 `server/ai-eval/`：122 条样本（40 检索 / 12 问答 / 10 拒答 / 8 引用 / 25 问数 / 12 工具参数 / 15 权限），按 ID 哈希划分 dev 与 heldout，覆盖文档级与分块级证据标注、四种检索方案、问答事实与引用支持度、工具参数和权限隔离。

```powershell
Push-Location server
npm run eval:offline                       # 离线确定性评测 + CI 门禁（无外部 API）
node ai-eval/run-eval.js --mode=offline    # 只生成报告，不执行门禁
Pop-Location
```

报告写入 `server/ai-eval/reports/latest.json` 与 `latest.md`。V2 优化的同版本基线、策略分析与前后对照报告分别为 `baseline-v1.1.0.json/.md`、`refusal-strategy-analysis.json`、`comparison-v1-v2.json/.md`；可复现命令：

```powershell
Push-Location server
npm run eval:refusal-analysis   # 拒答策略 dev 对比 + heldout 最终复核
npm run eval:compare            # 生成 V1→V2 同版本对照报告
Pop-Location
```

在线评测必须显式开启，并配置全部真实模型 Key；未配置时报告标记 N/A，不会把本地 fallback 冒充在线结果。预算钩子覆盖 LLM（含重试）、Embedding 批次与 Reranker 请求，任一超限立即停止：

```powershell
Push-Location server
$env:AI_EVAL_ONLINE = '1'
$env:AI_EVAL_ONLINE_MAX_REQUESTS = '400'  # 请求数上限（含重试）
$env:AI_EVAL_ONLINE_MAX_COST_CNY = '5'    # 成本上限（元）
npm run eval:online
Pop-Location
```

V2 离线基线结果：122 样本 120 通过；拒答率 60%→100%、无依据回答率 40%→0、正常问答误拒率 0；问数精确匹配率 88%→100%。策略在 dev 选定、heldout 仅最终复核，未删除失败样本或修改标准答案。

数据库真值一致性校验仅在隔离库执行：需设置 `AI_EVAL_DB_TRUTH=1` 且 `DB_NAME` 包含 `eval`，否则该项标记 N/A。CI 使用独立 `ai_eval_ci` 库并复制种子数据，真实执行一致性检查；存在失败时不会标记 passed。

## 测试

```powershell
npm test
npm --prefix admin test
npm --prefix server test
```

后端套件包含写入测试数据的用例，请连接已执行 `db:init` 的独立测试数据库。

端到端测试需要 Docker Compose 和 Chromium。它会创建独立的数据库和应用容器，覆盖登录、任务发布与学习进度、测评交卷和组织权限。

```powershell
Push-Location e2e
npm ci
npx playwright install chromium
npm run test:smoke
# 完整端到端套件
npm test
Pop-Location
```

主 CI 流水线运行三端测试、两端前端构建、Docker 集成测试和 E2E 冒烟用例。完整 E2E 由独立工作流定时执行，也可手动触发。覆盖范围见 [E2E 测试报告](e2e/REPORT.md)。
