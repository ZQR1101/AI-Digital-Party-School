/**
 * 在线评测请求预算：统一计数 LLM（含重试）、Embedding（按批次）、Reranker 请求，
 * 记录估算成本，并在任何一项超预算时立即停止后续调用。
 *
 * 约定：
 * - LLM 的实际 HTTP 次数以 modelTransport 写入 trace.attempts 为准（含重试）；
 * - Embedding 每次 embedTexts 按 API 配置下的批次数计（本地 fallback 不计外部请求）；
 * - Reranker 每次 rerank 计 1 次（仅 API 配置时计外部请求）；
 * - 单价由 AI_EVAL_ONLINE_* 环境变量提供，未配置时记 0 并在报告中说明。
 */
const { NA } = require('./envinfo');

function createBudget(limits) {
  const state = {
    requests: 0,
    byKind: { llm: 0, embedding: 0, rerank: 0 },
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    durationMs: 0,
    models: new Set(),
    costCny: 0,
    stopped: false,
    stopReason: null
  };

  const unitPrice = {
    llmPerMillionTokens: limits.pricePerMillionTokens,
    embeddingPerRequest: Number(process.env.AI_EVAL_ONLINE_EMBED_COST_PER_REQ) || 0,
    rerankPerRequest: Number(process.env.AI_EVAL_ONLINE_RERANK_COST_PER_REQ) || 0
  };

  function stop(reason) {
    if (!state.stopped) {
      state.stopped = true;
      state.stopReason = reason;
    }
    return false;
  }

  /** 超预算立即停止；silent=true 时返回 false 供重试钩子使用，不抛异常 */
  function canSpend(kind, count = 1, silent = false) {
    if (state.stopped) {
      if (silent) return false;
      throw new Error(`在线评测已停止：${state.stopReason}`);
    }
    const amount = Math.max(0, Number(count) || 0);
    if (state.requests + amount > limits.maxRequests) {
      const reason = `请求数将超过上限 ${limits.maxRequests}（已用 ${state.requests}，本次 ${amount}）`;
      if (silent) return stop(reason);
      stop(reason);
      throw new Error(`在线评测预算超限：${reason}`);
    }
    if (state.costCny >= limits.maxCostCny) {
      const reason = `估算成本已达上限 ¥${limits.maxCostCny}（当前 ¥${state.costCny}）`;
      if (silent) return stop(reason);
      stop(reason);
      throw new Error(`在线评测预算超限：${reason}`);
    }
    return true;
  }

  function reserve(kind, count = 1) {
    canSpend(kind, count);
    state.requests += count;
    state.byKind[kind] = (state.byKind[kind] || 0) + count;
  }

  /** modelTransport 每次重试前调用：超额时让业务请求循环立即中断 */
  function attemptHook(kind) {
    let reserved = 0;
    return (attempt) => {
      if (attempt <= reserved) return true;
      reserved = Math.max(reserved, attempt);
      if (attempt === 1) return !state.stopped;
      return canSpend(kind, 1, true);
    };
  }

  function recordUsage(trace) {
    for (const key of ['promptTokens', 'completionTokens', 'totalTokens']) {
      state[key] += Number(trace?.[key] || 0);
    }
    state.durationMs += Number(trace?.modelDurationMs || 0);
    if (trace?.model) state.models.add(trace.model);
    state.costCny += Math.round((Number(trace?.totalTokens || 0) / 1e6) * unitPrice.llmPerMillionTokens * 1e8) / 1e8;
    if (state.costCny > limits.maxCostCny) {
      stop(`估算成本 ¥${state.costCny} 超过上限 ¥${limits.maxCostCny}`);
      throw new Error(`在线评测预算超限：${state.stopReason}`);
    }
  }

  function recordExternal(kind, requests) {
    const n = Math.max(0, Number(requests) || 0);
    if (!n) return;
    state.costCny += Math.round(n * (kind === 'embedding' ? unitPrice.embeddingPerRequest : unitPrice.rerankPerRequest) * 1e8) / 1e8;
    if (state.costCny > limits.maxCostCny) {
      stop(`估算成本 ¥${state.costCny} 超过上限 ¥${limits.maxCostCny}`);
      throw new Error(`在线评测预算超限：${state.stopReason}`);
    }
  }

  function summary() {
    return {
      requests: state.requests,
      byKind: { ...state.byKind },
      promptTokens: state.promptTokens,
      completionTokens: state.completionTokens,
      totalTokens: state.totalTokens,
      durationMs: state.durationMs,
      models: [...state.models],
      estimatedCostCny: Math.round(state.costCny * 10000) / 10000,
      stopped: state.stopped,
      stopReason: state.stopReason || NA,
      unitPrice: { ...unitPrice }
    };
  }

  return { state, canSpend, reserve, attemptHook, recordUsage, recordExternal, summary, stop };
}

module.exports = { createBudget };
