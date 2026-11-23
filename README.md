# AI 数智党校学习系统

基于 AI 的党校学习平台，包含移动端学习前台、管理后台与后端服务三部分。系统为党员提供 AI 个性化内容推荐、在线测评与学习档案管理，为管理员提供内容、题库、任务、组织机构与数据统计的统一管理能力。

## 功能总览

**移动端学习前台（学员）**

- AI 个性化公共内容推荐首页（模型不可用时自动降级为规则推荐）
- **AI 助教**：基于党校知识库的 RAG 问答（附资料来源、防幻觉兜底）与学习画像驱动的学习诊断
- 在线测评、服务端判分和逐题错题记录
- 近 30 天个人学习报告、薄弱知识点和两次测评对比
- 学习档案：学习记录、学习时长、进度追踪

**管理后台（管理员）**

- 内容管理：公共学习内容的发布与视频资源管理
- 题库与试卷管理：题目维护、试卷组卷
- 测评与考试下发：已发布试卷可下发至指定组织及其下级
- 任务管理：学习任务下发与成员可见性控制
- 组织机构与用户管理
- 数据统计看板（ECharts）：学习时长、测评、推荐效果等维度

**后端服务**

- JWT 认证与管理员/学员角色区分
- AI 能力：内容推荐、综合评价、组织问数（原生 Function Calling）
- **RAG 知识库系统**：BM25 + 向量双路召回、RRF 融合、Reranker 重排、带来源问答与防幻觉兜底、画像个性化问答
- 学习记录、学习时长、推荐效果等统计服务
- 文件上传与静态资源服务

详细接口与 RAG 配置见 [`server/AI_API.md`](server/AI_API.md)。

## 技术栈

| 端 | 技术 |
| --- | --- |
| 移动端前台 | Vue 3、Vite、Vant、Vue Router |
| 管理后台 | Vue 3、Vite、Element Plus、Pinia、ECharts |
| 后端 | Node.js、Express、MySQL（mysql2）、JWT、Multer |
| 测试 | Node.js 内置 test runner |

## 目录结构

```
├── index.html / src-qianduan/ / public-qianduan/   # 移动端学习前台
├── admin/                # 管理后台
├── server/               # 后端服务
│   ├── src/routes/       # API 路由（auth/contents/tasks/ai/...）
│   ├── src/rag/          # RAG 检索模块（解析/BM25/向量/RRF/Reranker）
│   ├── knowledge/        # RAG 知识库 Markdown 语料
│   ├── sql/              # 数据库初始化与升级脚本
│   ├── rag-evaluate.js   # 检索效果评测
│   ├── rag-diagnose.js   # 检索后端诊断
│   ├── seed-*.js         # 演示数据生成脚本（幂等）
│   └── uploads/          # 上传文件（视频等）
├── test/                 # 移动端测试
├── start-all.ps1         # 一键启动（MySQL + 三端）
└── stop-all.ps1          # 一键停止
```

## 快速开始

### 环境要求

- Node.js 18+
- MySQL 5.7+ / 8.0（本地 3306 端口）

### 1. 初始化数据库

```powershell
cd server
npm install
npm run db:init        # 创建 party_school 库并写入初始数据
npm run db:upgrade:ai      # AI 相关表升级（旧库需要）
npm run db:upgrade:assessments  # 测评相关表升级（旧库需要）
npm run db:upgrade:papers  # 试卷相关表升级（旧库需要）
```

### 2. 配置后端

复制 `server/.env.example` 为 `server/.env` 并按需修改：

```ini
PORT=3001
DB_HOST=127.0.0.1
DB_USER=root
DB_PASSWORD=你的数据库密码
DB_NAME=party_school
JWT_SECRET=替换为一段足够长的随机字符串

# AI 配置（可选）：不配置时推荐自动降级为规则推荐、综合评价使用确定性中文模板
AI_API_URL=https://api.deepseek.com/v1/chat/completions
AI_API_KEY=你的AI平台Key
AI_MODEL=deepseek-chat
AI_TOOL_MODE=function          # 组织问数：function=原生 Function Calling / prompt=提示词JSON

# RAG 真实语义检索（可选，阿里云百炼/通义千问；不配置则降级为本地关键词算法）
# Key 申请：https://bailian.console.aliyun.com/ ，也可用标准变量 DASHSCOPE_API_KEY
EMBEDDING_API_URL=https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings
EMBEDDING_API_KEY=你的百炼Key
EMBEDDING_MODEL=text-embedding-v4
EMBEDDING_BATCH=10
RERANKER_API_URL=https://dashscope.aliyuncs.com/compatible-api/v1/reranks
RERANKER_API_KEY=你的百炼Key
RERANKER_MODEL=qwen3-rerank
```

> API Key 仅保存在本地 `server/.env` 中，该文件已被 `.gitignore` 排除，不会提交到仓库。完整配置项见 `server/.env.example`。运行 `cd server && node rag-diagnose.js` 可查看 RAG 实际使用的检索后端。

### 3. 启动

**一键启动（推荐）**：双击 `一键启动.bat`（或运行 `start-all.ps1`）。脚本会自动拉起本机 MySQL（Windows 服务 / Docker / XAMPP 尽力探测），并分别打开三个窗口启动：

| 服务 | 地址 |
| --- | --- |
| 后端 API | http://127.0.0.1:3001/api |
| 管理后台 | http://localhost:5173 |
| 移动端前台 | http://localhost:5174 |

关闭对应窗口即可停止单个服务，双击 `一键停止.bat` 全部停止。局域网内其他设备可通过 `http://<本机IP>:5173` / `:5174` 访问。

**手动启动**：

```powershell
# 后端
cd server
npm install
npm run dev            # 端口 3001

# 管理后台
cd admin
npm install
npm run dev            # 端口 5173

# 移动端（项目根目录）
npm install
npm run dev            # 端口 5174
```

## 演示账号

| 端 | 账号 | 密码 |
| --- | --- | --- |
| 管理后台 | `admin` | `admin123` |
| 移动端 | `lisi` | `admin123` |

移动端主要页面：推荐首页 `/#/home`、**AI 助教 `/#/ai-assistant`**（首页横幅或"我的"入口进入）、在线测评 `/#/exam`、学习档案 `/#/record`。

## RAG 检索效果评测

```powershell
cd server
node rag-evaluate.js        # 对比 BM25 / 向量 / Hybrid+Rerank 的 Hit@K、Recall@K、MRR
node rag-diagnose.js        # 查看 Embedding/Reranker 实际后端（--live 做真实调用验证）
```

评测报告输出到 `server/rag-eval-report.json`。代表性 query 同时固化为自动化测试，防止检索质量回退。

## 测试

```powershell
# 后端测试（含 RAG、Function Calling、检索效果回归）
cd server && npm test

# 管理后台测试
cd admin && npm test

# 移动端测试（项目根目录）
npm test
```
