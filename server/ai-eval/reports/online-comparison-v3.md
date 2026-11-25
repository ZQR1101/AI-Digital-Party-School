# AI 在线质量评测 V3 · 小规模真实模型对照

- 报告版本：3.0.0 ｜ 生成时间：2026-11-25T11:31:17.833Z
- 数据集：1.1.0 ｜ 在线状态：**completed**

## 1. 模型与真实后端配置

| 组件 | 配置状态 | 模型 | 端点 | 实际后端 |
| --- | --- | --- | --- | --- |
| LLM | 已配置 | deepseek-v4-flash | https://api.deepseek.com/v1/chat/completions | api（模型输出） |
| Embedding | 已配置 | qwen3.7-text-embedding-flash | https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings | api |
| Reranker | 已配置 | BAAI/bge-reranker-v2-m3 | https://api.siliconflow.cn/v1/rerank | api |

请求上限：80；成本上限：¥2.00；LLM 估算单价：¥8.00/百万 token。
API Key 仅从环境变量读取，未写入仓库或报告。单价未配置时按 LLM ¥8/百万 token、Embedding ¥0.01/请求、Rerank ¥0.01/请求估算；实际账单以服务商为准。

### Reranker 配置核对与最小请求验证

- 官方兼容端点：`POST https://{WorkspaceId}.{region}.maas.aliyuncs.com/compatible-api/v1/reranks`；请求体为扁平结构，响应 `results[].{index, relevance_score}`。
- WorkspaceId：业务空间 ID（形如 `llm-xxxxxx`），可在创建 Key 弹窗或业务空间管理页的 API Host 获取，作为专属域名的一级子域。
- 地域 / 地域 ID / DashScope 域名：华北2（北京）=cn-beijing（dashscope.aliyuncs.com）；新加坡=ap-southeast-1（dashscope-intl.aliyuncs.com）；中国香港=cn-hongkong（cn-hongkong.dashscope.aliyuncs.com）；美国（弗吉尼亚）=us-east-1（dashscope-us.aliyuncs.com）。
- 地域与 API Key 绑定：每个地域有独立 API Key，不能跨地域混用；业务空间专属域名仅访问当前业务空间，DashScope 旧域名可访问所有业务空间但自 2026-09-30 起不再支持新特性
- 配置示例已修正：`https://dashscope.aliyuncs.com/compatible-api/v1/reranks` → `https://llm-xxxxxx.cn-beijing.maas.aliyuncs.com/compatible-api/v1/reranks`；涉及 4 个文件。
- 最小请求验证（每端点仅 1 请求，不参与指标）：
  - 旧兼容端点 + qwen3.7-text-rerank：`https://dashscope.aliyuncs.com/compatible-api/v1/reranks` → HTTP 403 `AllocationQuota.FreeTierOnly`。
  - DashScope 原生端点 + qwen3-rerank：`https://dashscope.aliyuncs.com/api/v1/services/rerank/text-rerank/text-rerank` → HTTP 403 `AllocationQuota.FreeTierOnly`。
  - 官方试用域名 + qwen3.7-text-rerank：`https://trial.cn-beijing.maas.aliyuncs.com/compatible-api/v1/reranks` → HTTP 403 `insufficient_quota`。
- 验证结论：百炼账号 rerank 模型免费额度耗尽（账号级），与 WorkspaceId 缺失或 URL 格式无关。V3 报告原将 403 归因于『未带 WorkspaceId』，经最小请求验证为错误归因，已修正。
- 改用服务：硅基流动 SiliconFlow，端点 `https://api.siliconflow.cn/v1/rerank`，模型 `BAAI/bge-reranker-v2-m3`；Key 仅从 `process.env.RERANKER_API_KEY（仅环境变量，未写入仓库或报告）`。
- 最小请求验证：`通过 src/rag/reranker.js 真实客户端发起，读取 getBackendInfo() 判定后端` → 实际后端 `api`、semantic=true，backend=api 且 semantic=true，确认走真实重排服务，非本地关键词降级。
- D 方案已补齐：completed，dev 检索 8 条（`ret-001, ret-006, ret-018, ret-023, ret-030, ret-034, ret-036, ret-039`，未扩样、未改标准答案），实际后端 `api`；以上指标取自 v3-online-dev.json 的 D_bm25_embedding_rrf_reranker；MRR@5 低于 C 方案，为真实观测结果，未调整样本追求满分

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
| A · BM25 关键词 | 8 | 100.0% | 0.9375 | 100.0% | 0.45 | 0.74 |
| B · 真实 Embedding 向量 | 8 | 100.0% | 0.8750 | 100.0% | 160.70 | 175.68 |
| C · BM25 + Embedding + RRF | 8 | 100.0% | 0.9375 | 100.0% | 161.19 | 176.10 |
| D · C + 真实 Reranker | 8 | 100.0% | 0.7500 | 100.0% | 496.99 | 548.30 |

- D 方案样本：dev 检索 8 条（`ret-001, ret-006, ret-018, ret-023, ret-030, ret-034, ret-036, ret-039`）保持原 V3 预设不变，未扩样、未改标准答案。
- D 方案状态 **completed**：Recall@5 100.0%、MRR@5 0.7500、平均耗时 496.99 ms、P95 548.30 ms（见上表）。相对 C 方案 MRR@5 由 0.9375 降至 0.7500，为真实观测，未调整样本。
- 本轮 Rerank 真实请求 18 次（可用性探测 1 次 + D 方案 8 条各 1 次 + 问答/拒答复用 D 上下文等，均由预算器计量）；Reranker 实际后端：`api`（模型 `BAAI/bge-reranker-v2-m3`，非本地降级）。

离线同 ID 基线：

| 方案 | 样本 | Recall@5 | MRR@5 | 平均耗时(ms) |
| --- | ---: | ---: | ---: | ---: |
| A · BM25 关键词 | 8 | 100.0% | 0.9375 | 0.40 |
| B · 真实 Embedding 向量 | 8 | 100.0% | 0.9375 | 0.21 |
| C · BM25 + Embedding + RRF | 8 | 100.0% | 0.9375 | 0.64 |
| D · C + 真实 Reranker | 8 | 100.0% | 0.9375 | 0.91 |

heldout 独立复核（上次百炼配置下冻结复核的历史记录；本次仅在 dev 补齐 D，未重跑 heldout）：

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
| dev | 在线 LLM | 5 | 100.0% | 100.0% | 100.0% | 0.0% | 3333.25 |
| dev | 在线确定性对照 | 5 | 100.0% | 100.0% | 100.0% | 0.0% | 0.03 |
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
| dev | 48 | 8 | 22 | 18 | 6717 | 2627 | 0.4748 |
| heldout | 12 | 2 | 9 | 1 | 1877 | 616 | 0.1199 |
| 合计 | 60 | 10 | 31 | 19 | 8594 | 3243 | 0.5947 |

成本按保守单价估算，Token 事后计费可能导致账单差异；未配置单价时按说明中的上限参数估算。

## 6. 失败案例与错误归因

- [runtime/rerank_api_error] N/A：Reranker 接口异常；D 方案标记 not_run，后续问答/拒答使用 C 方案上下文，不使用本地重排冒充真实模型（Reranker API 调用失败，实际后端=local-keyword：Request failed with status code 403）

## 7. 结论

- **总体判断**：not_default_yet
- **Embedding**：真实 Embedding 相对 BM25：chunk Recall@5 100.0% vs 100.0%（+0.0000），MRR@5 0.8750 vs 0.9375（-0.0625），平均耗时 +160.25 ms。未观察到足以抵消延迟的质量增益。
- **Reranker**：硅基流动真实 Reranker（BAAI/bge-reranker-v2-m3）相对 C：chunk Recall@5 100.0% vs 100.0%（+0.0000），MRR@5 0.7500 vs 0.9375（-0.1875），平均耗时 +335.81 ms，P95 548.30 ms vs 176.10 ms。 Recall@5 持平但排序质量（MRR）下降、延迟显著上升，本批样本未观察到真实重排的收益。
- 当前样本下不建议默认启用真实 Embedding 或真实 Reranker；优先保持确定性链路，并在扩大困难样本后再评估。 heldout 独立复核已完成，结论仍受小样本限制。

本实验不修改标准答案、不改变既有 RAG 策略，也未访问生产数据库。
