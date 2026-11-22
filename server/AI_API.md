# AI 后端接口

所有接口均要求 `Authorization: Bearer <JWT>`。统一响应包装为 `{ code: 0, message, data }`。

## 一、统一入口

`POST /api/ai/chat`

```json
{
  "scene": "organization_query",
  "message": "今年学生第一党支部学习完成率趋势"
}
```

`scene` 可选：

| scene | 说明 | 返回 |
| --- | --- | --- |
| `organization_query` | 管理员、支部书记可用，受控组织指标查询 | `answer + data + charts + sources` |
| `learning_recommendation` | 当前用户薄弱知识点与公共内容推荐 | 推荐列表 |
| `learning_evaluation` | 学习画像报告 / 个性化学习建议 | 报告或个性化问答 |
| `knowledge_qa` | RAG 知识库问答（带来源引用） | `answer + sources + isGrounded` |

省略 `scene` 时按关键词自动路由；涉及「薄弱/掌握得不好/重点学什么/怎么学/建议」会自动切换到个性化 RAG 问答。

## 二、RAG 知识库接口（P2 新增）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/ai/knowledge/search?q=...&topK=5` | 混合检索，仅返回命中文档片段（含 BM25/向量/RRF/重排分数） |
| `POST` | `/api/ai/knowledge/ask` | 知识问答：`{ "question": "组织生活会和民主生活会有什么区别？" }` |
| `POST` | `/api/ai/knowledge/personalized` | 学习画像 + RAG 个性化问答：`{ "question": "我最近哪些知识点掌握得不好？" }` |

### 知识问答响应示例

```json
{
  "scene": "knowledge_qa",
  "question": "组织生活会和民主生活会有什么区别？",
  "answer": "……（基于检索资料生成，含 [1][2] 引用）",
  "sources": [
    { "id": 1, "title": "组织生活会与民主生活会的区别", "source": "党组织生活制度规范.md",
      "excerpt": "……", "relevanceScore": 0.86, "rrfScore": 0.0323 }
  ],
  "isGrounded": true,
  "relevantCount": 4,
  "generatedAt": "2026-11-22T..."
}
```

**防幻觉门禁**：当 Top-1 相关度低于阈值 `RELEVANCE_THRESHOLD`（默认 0.28）时，`isGrounded=false`、`sources=[]`，明确返回「知识库暂未收录相关内容」的兜底话术，不编造答案。

### 个性化问答响应

在知识问答基础上额外返回 `profileSummary`（用户名、完成率、薄弱分类）与 `suggestions`（针对性学习建议），检索时会把薄弱知识点拼入查询词，实现「学习画像 → 检索 → 建议」业务联动。

## 三、其他独立接口

- `POST /api/ai/query`：受控组织指标查询（原生 Function Calling，见下节）。
- `GET /api/ai/metrics`：支持的指标目录。
- `GET /api/ai/recommendations/me?limit=5`：个性化推荐。
- `POST /api/ai/recommendations/:contentId/feedback`：反馈，`action` 为 `view/start/complete/dismiss`。
- `GET /api/ai/report/me`：综合评价报告。
- 原有 `GET /api/reports/me` 保持兼容，使用同一确定性评分实现。

## 四、原生 Function Calling

组织问数默认使用模型原生 Function Calling（P2 升级）：

- 请求携带 `tools`（`src/ai/queryTools.js` 中的 `TOOL_DEFINITIONS`）与 `tool_choice: auto`，工具含三个：`query_learning_statistics`、`query_exam_statistics`、`query_organization_statistics`。
- 响应解析 `message.tool_calls[].function`，参数经 Zod 严格校验后才执行。
- 工具执行走固定服务层，**不执行模型生成的 SQL**；仅允许指标白名单。
- 若模型/网关不支持原生工具调用或调用失败，自动回退到提示词 JSON 模式（`response_format: json_object`），保证可用性。可通过 `AI_TOOL_MODE=prompt` 强制使用回退模式。
- 审计字段 `trace.toolMode` 记录 `function`/`prompt`，`trace.functionCallingFallback` 记录回退原因。

## 五、RAG 检索架构与配置

```
知识库文档(PDF/Word/Markdown)
  → 解析清洗 → 分块 → Embedding → 向量索引
用户问题 → Query 处理
  ├─ BM25 关键词检索
  └─ 向量语义检索
  → RRF 倒数排名融合 → Reranker 重排 → Top-K
  → LLM 生成(带来源引用) → 答案 + 引用
```

### 真实语义检索配置（SiliconFlow，OpenAI 兼容）

在 `server/.env` 配置（详见 `.env.example`）：

```ini
EMBEDDING_API_URL=https://api.siliconflow.cn/v1/embeddings
EMBEDDING_API_KEY=你的Key
EMBEDDING_MODEL=BAAI/bge-m3
EMBEDDING_DIM=1024

RERANKER_API_URL=https://api.siliconflow.cn/v1/rerank
RERANKER_API_KEY=你的Key
RERANKER_MODEL=BAAI/bge-reranker-v2-m3
```

- Key 申请：https://cloud.siliconflow.cn/account/ak
- 未配置时自动降级为本地哈希向量 + 关键词重排（**非语义**），通过 `node rag-diagnose.js` 可查看实际后端；加 `--live` 做真实调用验证。
- 运行时可调用 `RagService.getBackendStatus()` 获取 `embedding.semantic` / `reranker.semantic`，确认真实模型是否生效。
- Qdrant 为可选：配置 `QDRANT_URL` 或 `QDRANT_ENABLED=true` 启用；否则使用内置内存向量索引。测试环境一律禁用外部服务。

## 六、检索效果评测

- `node rag-evaluate.js`：19 条口语化/同义改写评测集，对比 BM25、向量、Hybrid+Rerank 的 `Hit@K / Recall@K / MRR`，报告写入 `rag-eval-report.json`。
- `test/rag-evaluation.test.js`：把代表性 query 固化为 CI 断言，防止检索质量回退。
- 评测会标注实际使用的后端（本地降级 or 真实语义），便于对比接入真实模型前后的效果差异。

## 七、数据库升级

已有数据库执行：

```bash
npm run db:upgrade:ai
npm run db:upgrade:assessments
```

AI 升级脚本会创建所需表并追加审计字段。脚本可以重复运行，已有反馈和历史审计会继续保留。

测评升级新增 `assessments` 和 `assessment_attempts`。原有 `exam_records` 保留供历史成绩读取。错题诊断和复测对比使用新测评保存的逐题判分结果。

演示数据脚本（可幂等重复执行）：

```bash
node seed-batch-data.js            # 党员、内容、任务、题库等基础演示数据
node seed-personal-learning-data.js # 全员学习记录 + 带薄弱分类的测评记录（驱动画像与个性化 RAG）
```

## 八、测评和复测流程

1. 在后台创建并发布试卷，然后选择「下发测评」，指定学员的组织和测验或正式考试。该组织及其下级组织的学员均可查看。
2. 用一致的知识点名称维护题目分类和公共课程标签。学员提交后会看到逐题判分，并可从首页或学习档案打开推荐课程。
3. 用同一个知识点的另一份试卷下发复测。「学习档案」会显示最近两次作答各答对几道题，并更新薄弱知识点。

- `POST /api/admin/assessments` 下发试卷，参数为 `paperId`、`organizationId`、`kind`（`quiz` 或 `exam`）和可选的 `deadline`。
- `GET /api/assessments` 列出当前学员可参加的测评，`GET /api/assessments/:id` 获取不含答案的试卷或本人的交卷结果。
- `POST /api/assessments/:id/submit` 提交按题号索引的 `answers`。重复交卷返回已有结果。
- 报告按北京时间统计最近 30 个日历日，阶段测验和正式考试分别计算。没有已判分的测评时只展示已有事实。

## 九、设计约束

- 组织查询只支持指标白名单，不执行模型生成的 SQL。
- 支部书记的数据范围限制在本人组织及下级组织。
- 综合分数由 `src/ai/scoring.js` 固定规则计算，大模型只能生成评语。
- `knowledge/*.md` 提供本地 RAG 语料；用于制度、指标口径和课程知识，不用于计算实时统计值。RAG 采用 Hybrid Search + RRF + Reranker，接口契约保持稳定。

## 十、权限、降级与审计

- AI 接口每次从数据库读取账号状态、角色和所属组织。后台问数与统计看板共用组织授权逻辑。书记无有效组织、查询其他组织或遇到异常组织层级时，接口返回 403。
- 推荐与评语共用 Zod 输出校验。推荐校验课程 ID 和语义分，评语校验字段、知识点和数字；工具调用校验工具名与参数。无效输出直接使用规则/确定性结果。
- 推荐模型调用总预算为 4 秒，报告默认为 15 秒。可通过 `AI_TIMEOUT_MS` 缩短推荐预算或调整报告预算，报告上限为 30 秒。超时、暂时性网络异常、限流和上游 5xx 仅在预算内重试一次。限流重试遵守上游的 `Retry-After`。
- Embedding/Reranker 请求独立超时（`EMBEDDING_TIMEOUT_MS` / `RERANKER_TIMEOUT_MS`，默认 8 秒），失败自动降级，不影响主问答链路。
- 通过响应头 `X-Request-Id` 可在 `ai_audit_logs` 定位记录。新字段记录请求和模型耗时、模型名、上游返回的输入/输出/总 Token、尝试次数、错误类型及降级原因。规则降级可以返回成功，审计仍保留降级原因。
