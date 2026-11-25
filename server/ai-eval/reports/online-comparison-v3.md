# AI 在线质量评测 V3 · 小规模真实模型对照

- 报告版本：3.0.0 ｜ 生成时间：2026-11-25T09:30:41.381Z
- 数据集：1.1.0 ｜ 在线状态：**completed**（部分方案 not_run：D / 真实 Reranker）

## 1. 模型与真实后端配置

| 组件 | 配置状态 | 模型 | 端点 | 实际后端 |
| --- | --- | --- | --- | --- |
| LLM | 已配置 | deepseek-v4-flash | https://api.deepseek.com/v1/chat/completions | api（模型输出） |
| Embedding | 已配置 | qwen3.7-text-embedding-flash | https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings | api |
| Reranker | 已配置 | qwen3.7-text-rerank | https://dashscope.aliyuncs.com/compatible-api/v1/reranks | local-keyword |

请求上限：80；成本上限：¥2.00；LLM 估算单价：¥8.00/百万 token。
API Key 仅从环境变量读取，未写入仓库或报告。单价未配置时按 LLM ¥8/百万 token、Embedding ¥0.01/请求、Rerank ¥0.01/请求估算；实际账单以服务商为准。

## 2. 样本 ID 与数量

- **dev**：共 20 条（1.1.0）
  - retrieval（8）：ret-001, ret-006, ret-018, ret-023, ret-030, ret-034, ret-036, ret-039
  - qa（5）：qa-001, qa-002, qa-005, qa-007, qa-008
  - refusal（4）：ref-001, ref-005, ref-006, ref-009
  - nlq（3）：nlq-003, nlq-004, nlq-012
- **heldout（配置冻结后复核）**：共 5 条（1.1.0）
  - retrieval（2）：ret-002, ret-028
  - qa（1）：qa-004
  - refusal（1）：ref-007
  - nlq（1）：nlq-001

## 3. 四种检索方案质量对比（分块级 Recall@5 / MRR@5）

在线 dev：

| 方案 | 样本 | Recall@5 | MRR@5 | 文档级 Recall@5 | 平均耗时(ms) | P95(ms) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| A · BM25 关键词 | 8 | 100.0% | 0.9375 | 100.0% | 0.43 | 0.75 |
| B · 真实 Embedding 向量 | 8 | 100.0% | 0.8750 | 100.0% | 164.14 | 221.18 |
| C · BM25 + Embedding + RRF | 8 | 100.0% | 0.9375 | 100.0% | 164.61 | 221.57 |
| D · C + 真实 Reranker | N/A | N/A | N/A | N/A | N/A | N/A |

离线同 ID 基线：

| 方案 | 样本 | Recall@5 | MRR@5 | 平均耗时(ms) |
| --- | ---: | ---: | ---: | ---: |
| A · BM25 关键词 | 8 | 100.0% | 0.9375 | 0.40 |
| B · 真实 Embedding 向量 | 8 | 100.0% | 0.9375 | 0.21 |
| C · BM25 + Embedding + RRF | 8 | 100.0% | 0.9375 | 0.64 |
| D · C + 真实 Reranker | 8 | 100.0% | 0.9375 | 0.91 |

heldout 独立复核：

| 方案 | 样本 | Recall@5 | MRR@5 | 平均耗时(ms) |
| --- | ---: | ---: | ---: | ---: |
| A · BM25 关键词 | 2 | 100.0% | 1.0000 | 0.39 |
| B · 真实 Embedding 向量 | 2 | 100.0% | 1.0000 | 162.69 |
| C · BM25 + Embedding + RRF | 2 | 100.0% | 1.0000 | 163.16 |
| D · C + 真实 Reranker | N/A | N/A | N/A | N/A |

## 4. 问答、拒答与工具调用

| 分组 | 模式 | 样本 | 要点覆盖 | 引用编号合法 | 引用支持 | 过度拒答 | 平均生成耗时(ms) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| dev | 离线确定性 | 5 | 100.0% | 100.0% | 100.0% | 0.0% | 0.06 |
| dev | 在线 LLM | 5 | 100.0% | 100.0% | 100.0% | 0.0% | 2629.81 |
| dev | 在线确定性对照 | 5 | 100.0% | 100.0% | 100.0% | 0.0% | 0.04 |
| heldout | 离线确定性 | 1 | 100.0% | 100.0% | 100.0% | 0.0% | 0.26 |
| heldout | 在线 LLM | 1 | 100.0% | 100.0% | 100.0% | 0.0% | 3105.38 |
| heldout | 在线确定性对照 | 1 | 100.0% | 100.0% | 100.0% | 0.0% | 0.07 |

- dev 拒答：离线 100.0% / 在线 100.0%；无依据回答率离线 0.0% / 在线 0.0%。
- dev 工具：离线精确匹配 100.0%（{"rules":3}）/ 在线精确匹配 100.0%（{"llm":3}）；在线工具选择准确率 100.0%。
- heldout 拒答：离线 100.0% / 在线 100.0%；无依据回答率离线 0.0% / 在线 0.0%。
- heldout 工具：离线精确匹配 100.0%（{"rules":1}）/ 在线精确匹配 100.0%（{"llm":1}）；在线工具选择准确率 100.0%。

检索质量、生成质量与权限安全分开统计：组织统计仅解析工具选择与参数，未执行 SQL；权限安全由现有离线门禁与回归测试覆盖，不并入本实验的“AI 准确率”。

## 5. Token、请求数与预估成本

| 范围 | 请求数 | LLM | Embedding | Rerank | Prompt tokens | Completion tokens | 估算成本(¥) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| dev | 31 | 8 | 22 | 1 | 6403 | 2313 | 0.2997 |
| heldout | 12 | 2 | 9 | 1 | 1877 | 616 | 0.1199 |
| 合计 | 43 | 10 | 31 | 2 | 8280 | 2929 | 0.4196 |

成本按保守单价估算，Token 事后计费可能导致账单差异；未配置单价时按说明中的上限参数估算。

## 6. 失败案例与错误归因

- [runtime/rerank_api_error] N/A：Reranker 接口异常；D 方案标记 not_run，后续问答/拒答使用 C 方案上下文，不使用本地重排冒充真实模型（Reranker API 调用失败，实际后端=local-keyword：Request failed with status code 403）
- [runtime/rerank_api_error] N/A：Reranker 接口异常；D 方案标记 not_run，后续问答/拒答使用 C 方案上下文，不使用本地重排冒充真实模型（Reranker API 调用失败，实际后端=local-keyword：Request failed with status code 403）

## 7. 结论

- **总体判断**：partial_d_not_run
- **Embedding**：真实 Embedding 相对 BM25：chunk Recall@5 100.0% vs 100.0%（+0.0000），MRR@5 0.8750 vs 0.9375（-0.0625），平均耗时 +163.71 ms。未观察到足以抵消延迟的质量增益。
- **Reranker**：D 方案 not_run：Reranker 接口返回 403（当前配置未带百炼兼容端点所需的 WorkspaceId），无法评价真实重排收益；修复端点前应继续禁用，禁止用本地关键词重排冒充。
- 当前样本下不建议默认启用真实 Embedding；Reranker 需在接口修复后重测 D 方案再决定。 heldout 独立复核已完成，结论仍受小样本限制。

本实验不修改标准答案、不改变既有 RAG 策略，也未访问生产数据库。
