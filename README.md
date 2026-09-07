# AI 数智党校学习系统

基于 AI 的党校学习平台，包含移动端学习前台、管理后台与后端服务三部分。系统为党员提供 AI 个性化内容推荐、在线测评与学习档案管理，为管理员提供内容、题库、任务、组织机构与数据统计的统一管理能力。

## 功能总览

**移动端学习前台（学员）**

- AI 个性化公共内容推荐首页（模型不可用时自动降级为规则推荐）
- 在线测评、成绩与答题记录
- 学习档案：学习记录、学习时长、进度追踪

**管理后台（管理员）**

- 内容管理：公共学习内容的发布与视频资源管理
- 题库与试卷管理：题目维护、试卷组卷
- 任务管理：学习任务下发与成员可见性控制
- 组织机构与用户管理
- 数据统计看板（ECharts）：学习时长、测评、推荐效果等维度

**后端服务**

- JWT 认证与管理员/学员角色区分
- AI 能力：内容推荐、综合评价（OpenAI 兼容接口，默认对接 DeepSeek）
- 学习记录、学习时长、推荐效果等统计服务
- 文件上传与静态资源服务

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
│   ├── src/routes/       # API 路由（auth/contents/tasks/examRecords...）
│   ├── sql/              # 数据库初始化与升级脚本
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
npm run db:upgrade:papers  # 试卷相关表升级（旧库需要）
```

### 2. 配置后端

复制 `server/.env.example` 为 `server/.env` 并按需修改：

```ini
PORT=3000
DB_HOST=127.0.0.1
DB_USER=root
DB_PASSWORD=你的数据库密码
DB_NAME=party_school
JWT_SECRET=替换为一段足够长的随机字符串

# AI 配置（可选）：不配置时推荐自动降级为规则推荐、
# 综合评价使用确定性中文模板
AI_API_URL=https://api.deepseek.com/v1/chat/completions
AI_API_KEY=你的AI平台Key
AI_MODEL=deepseek-chat
```

> API Key 仅保存在本地 `server/.env` 中，该文件已被 `.gitignore` 排除，不会提交到仓库。

### 3. 启动

**一键启动（推荐）**：双击 `一键启动.bat`（或运行 `start-all.ps1`）。脚本会自动拉起本机 MySQL（Windows 服务 / Docker / XAMPP 尽力探测），并分别打开三个窗口启动：

| 服务 | 地址 |
| --- | --- |
| 后端 API | http://127.0.0.1:3000/api |
| 管理后台 | http://localhost:5173 |
| 移动端前台 | http://localhost:5174 |

关闭对应窗口即可停止单个服务，双击 `一键停止.bat` 全部停止。局域网内其他设备可通过 `http://<本机IP>:5173` / `:5174` 访问。

**手动启动**：

```powershell
# 后端
cd server
npm install
npm run dev            # 端口 3000

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

移动端主要页面：推荐首页 `/#/home`、在线测评 `/#/exam`、学习档案 `/#/record`。

## 测试

```powershell
# 后端测试
cd server && npm test

# 管理后台测试
cd admin && npm test

# 移动端测试（项目根目录）
npm test
```
