# AI 后端接口

所有接口均要求 `Authorization: Bearer <JWT>`。

## 统一入口

`POST /api/ai/chat`

```json
{
  "scene": "organization_query",
  "message": "今年学生第一党支部学习完成率趋势"
}
```

`scene` 可选：

- `organization_query`：管理员、支部书记可用；返回 `answer + data + charts`。
- `learning_recommendation`：返回当前用户的薄弱知识点和公共内容推荐。
- `learning_evaluation`：返回当前用户的确定性评分和 AI/规则评语。

省略 `scene` 时根据关键词路由。

## 独立接口

- `POST /api/ai/query`：受控组织指标查询。
- `GET /api/ai/metrics`：支持的指标目录。
- `GET /api/ai/knowledge/search?q=完成率统计口径`：检索制度和指标知识库。
- `GET /api/ai/recommendations/me?limit=5`：个性化推荐。
- `POST /api/ai/recommendations/:contentId/feedback`：反馈，`action` 为 `view/start/complete/dismiss`。
- `GET /api/ai/report/me`：综合评价报告。
- 原有 `GET /api/reports/me` 保持兼容，使用同一确定性评分实现。

## 数据库升级

已有数据库执行：

```bash
npm run db:upgrade:ai
npm run db:upgrade:assessments
```

AI 升级脚本会创建所需表并追加审计字段。脚本可以重复运行，已有反馈和历史审计会继续保留。

测评升级新增 `assessments` 和 `assessment_attempts`。原有 `exam_records` 保留供历史成绩读取。错题诊断和复测对比使用新测评保存的逐题判分结果。

## 测评和复测流程

1. 在后台创建并发布试卷，然后选择「下发测评」，指定学员的组织和测验或正式考试。该组织及其下级组织的学员均可查看。
2. 用一致的知识点名称维护题目分类和公共课程标签。学员提交后会看到逐题判分，并可从首页或学习档案打开推荐课程。
3. 用同一个知识点的另一份试卷下发复测。「学习档案」会显示最近两次作答各答对几道题，并更新薄弱知识点。

- `POST /api/admin/assessments` 下发试卷，参数为 `paperId`、`organizationId`、`kind`（`quiz` 或 `exam`）和可选的 `deadline`。
- `GET /api/assessments` 列出当前学员可参加的测评，`GET /api/assessments/:id` 获取不含答案的试卷或本人的交卷结果。
- `POST /api/assessments/:id/submit` 提交按题号索引的 `answers`。重复交卷返回已有结果。
- 报告按北京时间统计最近 30 个日历日，阶段测验和正式考试分别计算。没有已判分的测评时只展示已有事实。学习活跃天数按有进度更新的任务记录计算，学习时长为这些任务的累计时长。

## 设计约束

- 组织查询只支持指标白名单，不执行模型生成的 SQL。
- 支部书记的数据范围限制在本人组织及下级组织。
- 综合分数由 `src/ai/scoring.js` 固定规则计算，大模型只能生成评语。
- `knowledge/*.md` 提供轻量本地RAG；用于制度、指标口径和课程知识，不用于计算实时统计值。后续可把 `ragService` 替换为向量数据库，接口契约不变。

## 权限、降级与审计

- AI 接口每次从数据库读取账号状态、角色和所属组织。后台问数与统计看板共用组织授权逻辑。书记无有效组织、查询其他组织或遇到异常组织层级时，接口返回 403。
- 推荐与评语共用 Zod 输出校验。推荐校验课程 ID 和语义分，评语校验字段、知识点和数字。无效输出直接使用规则结果。
- 推荐模型调用总预算为 4 秒，报告默认为 15 秒。可通过 `AI_TIMEOUT_MS` 缩短推荐预算或调整报告预算，报告上限为 30 秒。超时、暂时性网络异常、限流和上游 5xx 仅在预算内重试一次。限流重试遵守上游的 `Retry-After`。
- 通过响应头 `X-Request-Id` 可在 `ai_audit_logs` 定位记录。新字段记录请求和模型耗时、模型名、上游返回的输入/输出/总 Token、尝试次数、错误类型及降级原因。规则降级可以返回成功，审计仍保留降级原因。新记录只保存操作类型、结果模式和结构化查询意图，完整问句、提示词和模型回复留在请求处理过程中。
