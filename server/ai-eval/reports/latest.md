# AI 质量评测报告 V2（离线确定性）

- 报告版本：2.1.0 ｜ 数据集版本：1.1.0 ｜ 状态：completed
- 生成时间：2026-11-25T08:29:04.126Z ｜ Git Commit：`74cfa907984143b8b1216ebdccdb8f821ba5110a`
- 运行环境：Node v22.22.2 / win32 x64 ｜ CI：否
- 知识库版本：10 个 Markdown ｜ SHA256 `bc881d8a19ec77fb55aa1911f74177edfb1a04f32cffd580ea54f0be850ddd68`
- 固定时钟：2026-06-15T02:00:00.000Z ｜ 样本划分规则：sha1(id) % 10 < 3 → heldout；其余 dev
- 样本总数：122，通过：120（98.4%），失败：2
- CI 门禁（依据：dev；仅最终独立报告，不用于阈值调整）：✅ 通过

## 评测边界与局限

- 旧 rag-evaluate.js 仅 19 道题、50 个分块、文档级 Recall@3=1，只说明"命中正确文档"，不能代表答案证据/分块级检索质量。
- keywordCoverageRate 为关键词覆盖率；factPointCoverageRate 为启发式要点覆盖（人工验证事实准确率标记 N/A）；citationSupportRate 为启发式证据支持度（LLM Judge 标记 N/A）。
- isGrounded=true 仅表示检索门禁通过且有来源，不等价于答案事实正确。
- CI 门禁只用 dev；heldout 仅用于最终独立报告，不参与阈值调整。

## 运行配置与后端

- Embedding：{"configured":false,"model":"qwen3.7-text-embedding-flash","dim":1024,"backend":"local-hash","semantic":false}
- Reranker：{"configured":false,"model":"qwen3.7-text-rerank","backend":"local-keyword","semantic":false}
- 分块数：50 ｜ 向量维度：1024
- LLM 生成：未配置（离线走确定性兜底）
- 检索参数：topK=5 ｜ topN=20

## 检索四方案对比（文档级 / 分块级）

| 检索配置 | 粒度 | Hit@1 | Hit@3 | Hit@5 | Recall@3 | Recall@5 | MRR@5 | 平均耗时 | P95 |
|---|---|---|---|---|---|---|---|---|---|
| bm25 | document | 0.925 | 1 | 1 | 1 | 1 | 0.9625 | 0.1303ms | 0.22ms |
| bm25 | chunk | 0.8 | 1 | 1 | 0.9875 | 0.9875 | 0.8917 | 0.1303ms | 0.22ms |
| vector | document | 0.75 | 0.925 | 1 | 0.9125 | 0.9875 | 0.8383 | 0.1008ms | 0.1ms |
| vector | chunk | 0.575 | 0.775 | 0.85 | 0.7625 | 0.85 | 0.68 | 0.1008ms | 0.1ms |
| hybrid | document | 0.85 | 1 | 1 | 1 | 1 | 0.9167 | 0.2453ms | 0.32ms |
| hybrid | chunk | 0.65 | 0.95 | 0.975 | 0.9375 | 0.975 | 0.7896 | 0.2453ms | 0.32ms |
| hybrid_rerank | document | 0.875 | 0.975 | 0.975 | 0.975 | 0.975 | 0.9167 | 0.504ms | 0.59ms |
| hybrid_rerank | chunk | 0.675 | 0.95 | 0.975 | 0.9375 | 0.9625 | 0.805 | 0.504ms | 0.59ms |

> dev/heldout 分组指标见 JSON 报告 `suites.retrieval.summary.configurations.<方案>.<粒度>.bySplit`；不用保留集反复调参。

## 分项指标

| 分项 | 样本数 | 关键指标 |
|---|---|---|
| 问答质量（真实 RagService 链路；启发式判定） | 12 | keywordCoverageRate=0.9167，factPointCoverageRate=0.9167，humanVerifiedFactAccuracy=N/A，citationNumberValidRate=1，citationSupportRate=1，overRefusalRate=0，fallbackReliabilityRate=1，llmJudgeScore=N/A |
| 无答案拒答 | 10 | refusalRate=1，unwarrantedAnswerRate=0，avgTopScore=0，avgScoreGap=0 |
| 引用编号校验 | 8 | accuracy=1 |
| 自然语言统计查询（工具选择 / 参数准确率） | 25 | toolSelectionAccuracy=1，metricAccuracy=1，organizationAccuracy=1，timeRangeAccuracy=1，groupByAccuracy=1，exactMatchRate=1 |
| 工具调用结构校验（接受/拒绝） | 12 | accuracy=1，acceptCorrectRate=1，rejectCorrectRate=1 |
| 角色权限与组织范围隔离 | 15 | permissionCorrectRate=1 |
| 工具调用与数据库真值一致性 | N/A | failedSamples=N/A |

> 所有未运行项以 N/A 标记，不以 0 或 100% 代替；关键词覆盖率/要点覆盖率/证据支持度均为启发式辅助判定，LLM Judge 与人工事实核验未运行（N/A）。

### dev / heldout 独立指标

| 分项 | 划分 | 样本数 | 关键指标 |
|---|---|---|---|
| 问答质量（真实 RagService 链路；启发式判定） | dev | 10 | keywordCoverageRate=0.9，factPointCoverageRate=0.9，humanVerifiedFactAccuracy=N/A，citationNumberValidRate=1，citationSupportRate=1，overRefusalRate=0，fallbackReliabilityRate=1，llmJudgeScore=N/A |
| 问答质量（真实 RagService 链路；启发式判定） | heldout | 2 | keywordCoverageRate=1，factPointCoverageRate=1，humanVerifiedFactAccuracy=N/A，citationNumberValidRate=1，citationSupportRate=1，overRefusalRate=0，fallbackReliabilityRate=1，llmJudgeScore=N/A |
| 无答案拒答 | dev | 4 | refusalRate=1，unwarrantedAnswerRate=0，avgTopScore=0，avgScoreGap=0 |
| 无答案拒答 | heldout | 6 | refusalRate=1，unwarrantedAnswerRate=0，avgTopScore=0，avgScoreGap=0 |
| 引用编号校验 | dev | 6 | accuracy=1 |
| 引用编号校验 | heldout | 2 | accuracy=1 |
| 自然语言统计查询（工具选择 / 参数准确率） | dev | 16 | toolSelectionAccuracy=1，metricAccuracy=1，organizationAccuracy=1，timeRangeAccuracy=1，groupByAccuracy=1，exactMatchRate=1 |
| 自然语言统计查询（工具选择 / 参数准确率） | heldout | 9 | toolSelectionAccuracy=1，metricAccuracy=1，organizationAccuracy=1，timeRangeAccuracy=1，groupByAccuracy=1，exactMatchRate=1 |
| 工具调用结构校验（接受/拒绝） | dev | 8 | accuracy=1，acceptCorrectRate=1，rejectCorrectRate=1 |
| 工具调用结构校验（接受/拒绝） | heldout | 4 | accuracy=1，acceptCorrectRate=1，rejectCorrectRate=1 |
| 角色权限与组织范围隔离 | dev | 11 | permissionCorrectRate=1 |
| 角色权限与组织范围隔离 | heldout | 4 | permissionCorrectRate=1 |

> dev 为调参依据；heldout 仅最终独立报告，严禁反复用于阈值调整。

## 最值得优化的三个问题

1. **[影响：低]** 基线未发现显著短板 → 保持门禁阈值，扩大困难样本覆盖后复测。

## 失败案例（2 条；输入已脱敏，不含密钥/真实用户数据）

### [rerank_failure] retrieval / ret-019

- 输入：`怎样才算一名活跃的党员 统计上怎么定义`
- 期望：`{"document":["指标统计口径.md"],"evidence":["活跃党员人数为统计周期内至少产生一条有效学习时长记录的去重党员人数。"]}`
- 实际：`{"document":["党员组织关系与党籍管理.md","党费收缴使用与管理规定.md","党章核心要义与党员权利义务.md","党费收缴使用与管理规定.md","党组织生活制度规范.md"],"chunkMatched":0}`
- 诊断：相关来源已进入 RRF 融合候选（topN），但被重排挤出 Top-5
- 命中来源：1.党员组织关系与党籍管理.md 2.党费收缴使用与管理规定.md 3.党章核心要义与党员权利义务.md 4.党费收缴使用与管理规定.md 5.党组织生活制度规范.md

### [generation_failure] qa / qa-010

- 输入：`什么情况下需要转移党员组织关系？`
- 期望：`{"keywords":["六个月","转移组织关系"]}`
- 实际：`{"keywordCoverageRate":0,"missingKeywords":["六个月","转移组织关系"],"fallback":true}`
- 诊断：确定性兜底摘录未覆盖标准答案要点
- 命中来源：1.党员组织关系与党籍管理.md 2.党员组织关系与党籍管理.md 3.党员组织关系与党籍管理.md 4.党员组织关系与党籍管理.md
