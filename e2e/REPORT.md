# E2E 测试报告（第一轮真实业务测试）

- 日期：2026-11-24 ｜ 工具：Playwright（Chromium 真实浏览器驱动）
- 环境：完全隔离的 Docker Compose 测试栈（独立项目名 `-p ai_party_e2e_<runid>`、独立命名卷、端口 18090/18091、独立 MySQL），测试数据全部为 `E2E测试` 前缀专用种子，结束 `down -v` 销毁并断言无遗留
- 结果：**19/19 通过**（本地实跑），配套回归 server 202/202、admin 16/16、学员端 4/4

## 一、覆盖的业务链路

| 链路 | 用例 | 断言层次 |
|---|---|---|
| 管理后台登录/退出 | 成功登录、错误密码、退出清 token | 页面内容 + localStorage 状态 |
| 学员端登录/退出 | 成功登录、未登录重定向、退出清 token | 页面内容 + localStorage 状态 |
| 任务创建发布 | 管理员 UI 填表（名称/内容下拉/组织树勾选/截止日期）发布 | 创建接口响应 + 列表真实渲染 |
| 学员学习闭环 | 学员任务列表 → 学习页真实阅读 → 进度 100% | UI 进度文案 + `learning_records` 落库（status=completed、studySeconds≥5） |
| 统计呈现 | 管理员数据总览 | `/api/admin/statistics` 200 + 页面渲染 |
| 测评提交 | 学员答题 → 答题卡交卷 → 成绩页 | 成绩页渲染 + `assessment_attempts` 落库（score=100、passed=1） |
| 重复交卷防护 | 再次进入已交卷测评 | 直接呈现成绩视图 |
| RBAC-未登录 | 管理后台/学员端未登录访问受保护页 | 浏览器级重定向 |
| RBAC-角色权限 | 党员调管理员接口、书记调人员管理接口、书记越权组织建任务 | 后端 401/403 + 越权数据未落库 |
| 组织范围隔离 | 书记列表不含范围外任务、跨组织党员看不到他组织下发任务 | UI 列表内容 + 数据库对照 |
| 停用账号旧 Token | 登录后停用账号 | 403 实时生效 + 前端清 token 踢回登录页 |

## 二、发现并修复的问题

1. **P0 书记端无法发布任务（真实业务缺陷，RBAC 配置错误）**
   - `/api/admin/organizations` 与 `/api/admin/contents` 整个路由器 `requireAdmin`，而任务管理页（书记可用）的表单需要调这两个接口加载选项——书记登录后台后任务页必然报错，无法创建任务。
   - 修复（最小根因）：organizations 的 GET 开放给 manager（书记仅见本组织子树，写操作仍 requireAdmin）；contents 的 GET 开放给 manager（仅返回已发布内容），增删改/上传仍 requireAdmin 并逐个显式挂载；`security-hardening.test.js` 结构断言同步更新为新语义。server 回归 202/202。

2. **文档与代码不一致**：DEPLOY.md 的 `RERANKER_API_URL` 示例为百炼旧原生端点；按 `server/.env.example` 与 `reranker.js` 实际支持协议修正为 `https://dashscope.aliyuncs.com/compatible-api/v1/reranks`。

## 三、尚未覆盖的功能及原因

| 功能 | 原因 |
|---|---|
| 视频学习完成链路 | 测试环境无真实视频文件与转码设施；文章链路已覆盖同一学习记录管道 |
| AI 助教/AI 数据查询 | 依赖外部模型 Key，未配置时走降级链路，降级文案断言价值有限；拟在配置真实 Key 的环境专项覆盖 |
| 内容上传/富文本编辑 | 文件上传涉及魔数校验与大文件，第一轮聚焦核心学习闭环 |
| 组织/用户/题库/试卷的管理 CRUD 全量操作 | 以 RBAC 与统计链路为主，CRUD 交互覆盖留待第二轮 |
| 多浏览器（WebKit/Firefox） | 控制首轮 CI 时长，仅 Chromium；完整工作流可后续增加 project |

## 四、工程与 CI

- 工程：`e2e/`（Playwright + mysql2 直连断言），全局 setup 自动拉起隔离栈并种子数据、teardown 销毁并断言无遗留容器/卷。
- 稳定性约定：全部关键控件补 `data-testid`（两端 15 处）、无固定 sleep（进度用 `toHaveText` 轮询、落库用 `expect.poll` 轮询 DB）、失败自动保存截图/trace（输出目录可重定向，不进仓库）。
- CI：主流水线新增 `e2e-smoke` job（`--grep @smoke`，控时约 5-8 分钟）；完整套件独立工作流 `.github/workflows/e2e.yml`（workflow_dispatch + 每日定时）。
- 凭据安全：测试栈密码/密钥均为一次性隔离环境凭据（栈销毁即失效），通过环境变量注入，trace/截图/报告中不打印。
