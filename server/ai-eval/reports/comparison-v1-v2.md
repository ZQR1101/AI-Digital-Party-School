# AI 质量评测 V1→V2 同版本对照报告

- 数据集版本：1.1.0（基线、优化、策略分析完全一致）
- 知识库 SHA256：bc881d8a19ec77fb55aa1911f74177edfb1a04f32cffd580ea54f0be850ddd68（优化前后相同）
- 基线：2026-11-25T07:35:10.746Z ｜ Git 336da63cb667f6bbc305e7a6434370177782594e ｜ 112/122 通过
- 优化后：2026-11-25T08:29:04.126Z ｜ Git 74cfa907984143b8b1216ebdccdb8f821ba5110a ｜ 120/122 通过
- CI 门禁：基线依据 N/A；优化后依据 dev，全部达标

## 拒答与误拒

| 指标 | 样本数 | V1 基线 | V2 优化后 |
|---|---|---|---|
| 拒答率 | 10 | 60.00% | 100.00% |
| 无依据回答率 | 10 | 40.00% | 0.00% |
| 正常问答误拒率 | 12 | 0.00% | 0.00% |

dev 拒答率：50.00% → 100.00%（4 条）；heldout 最终独立复核：66.67% → 100.00%（6 条）。

### dev 策略对比（heldout 仅最终复核）

| 策略 | dev 拒答率 | dev 误拒率 | heldout 拒答率（最终复核） | heldout 误拒率 |
|---|---|---|---|---|
| baseline | 50.00% | 0.00% | 66.67% | 0.00% |
| fixedThreshold | 100.00% | 0.00% | 66.67% | 0.00% |
| scoreGap | 75.00% | 20.00% | 33.33% | 0.00% |
| evidenceMatch | 100.00% | 0.00% | 100.00% | 0.00% |
| combined | 100.00% | 0.00% | 100.00% | 0.00% |

选定策略：evidenceMatch（保留原阈值 0.24 + 主题证据匹配；未提高全局阈值）。未采用固定阈值方案（需上调全局阈值且 heldout 更低）。

## 问答质量（启发式）

| 指标 | 样本数 | V1 基线 | V2 优化后 |
|---|---|---|---|
| 关键词覆盖率 | 12 | 91.67% | 91.67% |
| 要点覆盖率 | 12 | 91.67% | 91.67% |
| 引用编号合法率 | 12 | 100.00% | 100.00% |
| 引用证据支持率（启发式） | 12 | 100.00% | 100.00% |
| 正常问答误拒率 | 12 | N/A | 0.00% |
| 兜底可靠性 | 12 | 100.00% | 100.00% |

人工验证事实准确率：N/A ｜ LLM Judge：N/A。V1 的 factAccuracyRate/avgFactCoverage 不冒充人工事实准确率。

## 检索：BM25 与 Hybrid + Rerank

| 配置 | 粒度 | 划分 | 样本数 | V1 Recall@5 | V2 Recall@5 | V1 MRR@5 | V2 MRR@5 |
|---|---|---|---|---|---|---|---|
| bm25 | document | all | 40 | 100.00% | 100.00% | 0.9625 | 0.9625 |
| bm25 | document | dev | 28 | 100.00% | 100.00% | 0.9643 | 0.9643 |
| bm25 | document | heldout | 12 | 100.00% | 100.00% | 0.9583 | 0.9583 |
| bm25 | chunk | all | 40 | 98.75% | 98.75% | 0.8917 | 0.8917 |
| bm25 | chunk | dev | 28 | 98.21% | 98.21% | 0.8869 | 0.8869 |
| bm25 | chunk | heldout | 12 | 100.00% | 100.00% | 0.9028 | 0.9028 |
| hybrid_rerank | document | all | 40 | 97.50% | 97.50% | 0.9167 | 0.9167 |
| hybrid_rerank | document | dev | 28 | 100.00% | 100.00% | 0.9821 | 0.9821 |
| hybrid_rerank | document | heldout | 12 | 91.67% | 91.67% | 0.7639 | 0.7639 |
| hybrid_rerank | chunk | all | 40 | 96.25% | 96.25% | 0.805 | 0.805 |
| hybrid_rerank | chunk | dev | 28 | 98.21% | 98.21% | 0.869 | 0.869 |
| hybrid_rerank | chunk | heldout | 12 | 91.67% | 91.67% | 0.6556 | 0.6556 |

## 自然语言统计查询

| 指标 | 划分 | 样本数 | V1 | V2 |
|---|---|---|---|---|
| toolSelectionAccuracy | all | 25 | 100.00% | 100.00% |
| toolSelectionAccuracy | dev | 16 | 100.00% | 100.00% |
| toolSelectionAccuracy | heldout | 9 | 100.00% | 100.00% |
| metricAccuracy | all | 25 | 100.00% | 100.00% |
| metricAccuracy | dev | 16 | 100.00% | 100.00% |
| metricAccuracy | heldout | 9 | 100.00% | 100.00% |
| organizationAccuracy | all | 25 | 88.00% | 100.00% |
| organizationAccuracy | dev | 16 | 100.00% | 100.00% |
| organizationAccuracy | heldout | 9 | 66.67% | 100.00% |
| timeRangeAccuracy | all | 25 | 100.00% | 100.00% |
| timeRangeAccuracy | dev | 16 | 100.00% | 100.00% |
| timeRangeAccuracy | heldout | 9 | 100.00% | 100.00% |
| groupByAccuracy | all | 25 | 100.00% | 100.00% |
| groupByAccuracy | dev | 16 | 100.00% | 100.00% |
| groupByAccuracy | heldout | 9 | 100.00% | 100.00% |
| exactMatchRate | all | 25 | 88.00% | 100.00% |
| exactMatchRate | dev | 16 | 100.00% | 100.00% |
| exactMatchRate | heldout | 9 | 66.67% | 100.00% |

## 数据库真值与失败样本

本地数据库真值：基线 not_run，优化后 not_run（N/A，不以 0/100% 代替）。CI 隔离库结果以 CI 产物为准。

失败样本：V1 10 条（retrieval/rerank_failure×1、qa/generation_failure×1、refusal/unwarranted_answer×4、citation/citation_error×1、nlq/tool_error×3）→ V2 2 条（retrieval/rerank_failure×1、qa/generation_failure×1）；原有困难样本全部保留。

## 结论

- 拒答率由 60% 提升至 100%，无依据回答率由 40% 降至 0；正常问答误拒率维持 0。
- 策略在 dev 上比较固定阈值、分数差距、主题证据匹配后选定；未全局提高相关性阈值。
- 组织名边界与引用编号清洗修复后，问数精确匹配率 88%→100%，引用编号校验维持 100%。
- 检索层 BM25 与 Hybrid+Rerank 文档级/分块级 Recall@5、MRR@5 无实质回退。
- 剩余 2 条失败样本全部保留：1 条重排困难样本、1 条确定性兜底要点覆盖不足；未改标注。
