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
```

新增 `recommendation_feedback` 与 `ai_audit_logs`。未升级时核心查询、推荐和报告仍可执行，但推荐反馈无法保存，审计日志会降级为服务端警告。

## 设计约束

- 组织查询只支持指标白名单，不执行模型生成的 SQL。
- 支部书记的数据范围限制在本人组织及下级组织。
- 综合分数由 `src/ai/scoring.js` 固定规则计算，大模型只能生成评语。
- `knowledge/*.md` 提供轻量本地RAG；用于制度、指标口径和课程知识，不用于计算实时统计值。后续可把 `ragService` 替换为向量数据库，接口契约不变。
