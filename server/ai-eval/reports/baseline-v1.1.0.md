# AI 质量评测报告 V1（离线确定性）

- 报告版本：2.0.0 ｜ 数据集版本：1.1.0 ｜ 状态：completed
- 生成时间：2026-11-25T07:35:10.746Z ｜ Git Commit：`336da63cb667f6bbc305e7a6434370177782594e`
- 运行环境：Node v22.22.2 / win32 x64 ｜ CI：否
- 知识库版本：10 个 Markdown ｜ SHA256 `bc881d8a19ec77fb55aa1911f74177edfb1a04f32cffd580ea54f0be850ddd68`
- 固定时钟：2026-06-15T02:00:00.000Z ｜ 样本划分规则：sha1(id) % 10 < 3 → heldout；其余 dev
- 样本总数：122，通过：112（91.8%），失败：10
- CI 门禁：✅ 通过

## 评测边界与局限

- 旧 rag-evaluate.js 仅 19 道题、50 个分块、文档级 Recall@3=1，只说明"命中正确文档"，不能代表答案证据/分块级检索质量。
- 引用支持度为启发式规则判定（可人工复核），不是 LLM Judge 客观真值。
- isGrounded=true 仅表示检索门禁通过且有来源，不等价于答案事实正确。

## 运行配置与后端

- Embedding：{"configured":false,"model":"qwen3.7-text-embedding-flash","dim":1024,"backend":"local-hash","semantic":false}
- Reranker：{"configured":false,"model":"qwen3.7-text-rerank","backend":"local-keyword","semantic":false}
- 分块数：50 ｜ 向量维度：1024
- LLM 生成：未配置（离线走确定性兜底）
- 检索参数：topK=5 ｜ topN=20

## 检索四方案对比（文档级 / 分块级）

| 检索配置 | 粒度 | Hit@1 | Hit@3 | Hit@5 | Recall@3 | Recall@5 | MRR@5 | 平均耗时 | P95 |
|---|---|---|---|---|---|---|---|---|---|
| bm25 | document | 0.925 | 1 | 1 | 1 | 1 | 0.9625 | 0.1253ms | 0.2ms |
| bm25 | chunk | 0.8 | 1 | 1 | 0.9875 | 0.9875 | 0.8917 | 0.1253ms | 0.2ms |
| vector | document | 0.75 | 0.925 | 1 | 0.9125 | 0.9875 | 0.8383 | 0.1047ms | 0.11ms |
| vector | chunk | 0.575 | 0.775 | 0.85 | 0.7625 | 0.85 | 0.68 | 0.1047ms | 0.11ms |
| hybrid | document | 0.85 | 1 | 1 | 1 | 1 | 0.9167 | 0.246ms | 0.29ms |
| hybrid | chunk | 0.65 | 0.95 | 0.975 | 0.9375 | 0.975 | 0.7896 | 0.246ms | 0.29ms |
| hybrid_rerank | document | 0.875 | 0.975 | 0.975 | 0.975 | 0.975 | 0.9167 | 0.4575ms | 0.58ms |
| hybrid_rerank | chunk | 0.675 | 0.95 | 0.975 | 0.9375 | 0.9625 | 0.805 | 0.4575ms | 0.58ms |

> dev/heldout 分组指标见 JSON 报告 `suites.retrieval.summary.configurations.<方案>.<粒度>.bySplit`；不用保留集反复调参。

## 分项指标

| 分项 | 样本数 | 关键指标 |
|---|---|---|
| 问答质量（真实 RagService 链路） | 12 | factAccuracyRate=0.9167，citationNumberValidRate=1，citationSupportRate=1，fallbackReliabilityRate=1，llmJudgeScore=N/A，avgFactCoverage=0.9167 |
| 无答案拒答 | 10 | refusalRate=0.6，unwarrantedAnswerRate=0.4 |
| 引用编号校验 | 8 | accuracy=0.875 |
| 自然语言统计查询（工具选择 / 参数准确率） | 25 | toolSelectionAccuracy=1，metricAccuracy=1，organizationAccuracy=0.88，timeRangeAccuracy=1，groupByAccuracy=1，exactMatchRate=0.88 |
| 工具调用结构校验（接受/拒绝） | 12 | accuracy=1，acceptCorrectRate=1，rejectCorrectRate=1 |
| 角色权限与组织范围隔离 | 15 | permissionCorrectRate=1 |
| 工具调用与数据库真值一致性 | N/A |  |

> 所有未运行项以 N/A 标记，不以 0 或 100% 代替；引用支持度为启发式辅助判定，LLM Judge 分数未运行。

## 最值得优化的三个问题

1. **[影响：高]** 无依据问题拒答率仅 60.0% → 先调整检索相关性门禁与来源Evidence校验（仅改判定策略，不改知识库事实），避免低分片段被当作依据生成回答。
2. **[影响：中]** 引用相关失败 1 条（年份/编号被误当引用编号） → 收紧引用编号正则与语义判定，仅清理确属越界的 [n]，保留正文中的年份/附录编号。
3. **[影响：中]** 自然语言问数组织识别错误 3 条 → 修正组织名称抽取边界，避免把"月度走势/数量"等统计词并入组织名；保持规则解析与 Function Calling 同构。

## 失败案例（10 条；输入已脱敏，不含密钥/真实用户数据）

### [rerank_failure] retrieval / ret-019

- 输入：`怎样才算一名活跃的党员 统计上怎么定义`
- 期望：`{"document":["指标统计口径.md"],"evidence":["活跃党员人数为统计周期内至少产生一条有效学习时长记录的去重党员人数。"]}`
- 实际：`{"document":["党员组织关系与党籍管理.md","党费收缴使用与管理规定.md","党章核心要义与党员权利义务.md","党费收缴使用与管理规定.md","党组织生活制度规范.md"],"chunkMatched":0}`
- 诊断：相关来源已进入 RRF 融合候选（topN），但被重排挤出 Top-5
- 命中来源：1.党员组织关系与党籍管理.md 2.党费收缴使用与管理规定.md 3.党章核心要义与党员权利义务.md 4.党费收缴使用与管理规定.md 5.党组织生活制度规范.md

### [generation_failure] qa / qa-010

- 输入：`什么情况下需要转移党员组织关系？`
- 期望：`{"keywords":["六个月","转移组织关系"]}`
- 实际：`{"keywordCoverage":0,"missingKeywords":["六个月","转移组织关系"],"fallback":true}`
- 诊断：确定性兜底摘录未覆盖标准答案要点
- 命中来源：1.党员组织关系与党籍管理.md 2.党员组织关系与党籍管理.md 3.党员组织关系与党籍管理.md 4.党员组织关系与党籍管理.md

### [unwarranted_answer] refusal / ref-005

- 输入：`党的二十大是哪一年召开的`
- 期望：`{"isGrounded":false,"sources":[]}`
- 实际：`{"isGrounded":true,"topScore":0.26}`
- 诊断：知识库不含该事实，系统仍给出带来源的回答
- 命中来源：党组织生活制度规范.md 党史学习教育要点.md 党员教育管理与发展工作细则.md 党组织生活制度规范.md

### [unwarranted_answer] refusal / ref-006

- 输入：`三严三实的具体内容是什么`
- 期望：`{"isGrounded":false,"sources":[]}`
- 实际：`{"isGrounded":true,"topScore":0.26}`
- 诊断：知识库不含该事实，系统仍给出带来源的回答
- 命中来源：中央八项规定精神与作风建设.md 党规党纪与纪律处分要点.md 党组织生活制度规范.md 党组织生活制度规范.md

### [unwarranted_answer] refusal / ref-007

- 输入：`统一战线工作条例主要讲了什么内容`
- 期望：`{"isGrounded":false,"sources":[]}`
- 实际：`{"isGrounded":true,"topScore":0.29}`
- 诊断：知识库不含该事实，系统仍给出带来源的回答
- 命中来源：中央八项规定精神与作风建设.md 党规党纪与纪律处分要点.md 党组织生活制度规范.md 党组织生活制度规范.md

### [unwarranted_answer] refusal / ref-010

- 输入：`两学一做学习教育具体指哪两学哪一做`
- 期望：`{"isGrounded":false,"sources":[]}`
- 实际：`{"isGrounded":true,"topScore":0.33}`
- 诊断：知识库不含该事实，系统仍给出带来源的回答
- 命中来源：党史学习教育要点.md 党员教育管理与发展工作细则.md 党史学习教育要点.md 指标统计口径.md

### [citation_error] citation / cit-008

- 输入：`参见附录[附录A]与[2026]年修订版说明[1]。`
- 期望：`{"invalid":[],"contains":["[附录A]","[2026]年修订版说明[1]"]}`
- 实际：`{"invalid":[2026],"answer":"参见附录[附录A]与年修订版说明[1]。"}`
- 诊断：引用编号清洗结果与预期不符

### [tool_error] nlq / nlq-006

- 输入：`看看2025年全校学习完成率月度走势`
- 期望：`{"metric":"learning_completion_rate","organizationName":null,"timeRangeLabel":"2025年","groupBy":"month"}`
- 实际：`{"metric":"learning_completion_rate","organizationName":"全校 月度走势","timeRangeLabel":"2025年","groupBy":"month","tool":"query_learning_statistics"}`
- 诊断：规则解析字段错误：organizationName

### [tool_error] nlq / nlq-013

- 输入：`全校下级组织数量`
- 期望：`{"metric":"sub_organization_count","organizationName":null,"timeRangeLabel":"2026年","groupBy":null}`
- 实际：`{"metric":"sub_organization_count","organizationName":"全校 数量","timeRangeLabel":"2026年","groupBy":null,"tool":"query_organization_statistics"}`
- 诊断：规则解析字段错误：organizationName

### [tool_error] nlq / nlq-015

- 输入：`2024年全校下级组织有多少个`
- 期望：`{"metric":"sub_organization_count","organizationName":null,"timeRangeLabel":"2024年","groupBy":null}`
- 实际：`{"metric":"sub_organization_count","organizationName":"全校 有多少个","timeRangeLabel":"2024年","groupBy":null,"tool":"query_organization_statistics"}`
- 诊断：规则解析字段错误：organizationName
