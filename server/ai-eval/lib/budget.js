/**
 * 在线评测请求预算：统一计数 LLM（含重试）、Embedding（按批次）、Reranker 请求，
 * 记录估算成本，并在任何一项超预算时立即停止后续调用。
 *
 * 约定：
 * - LLM 的实际 HTTP 次数以 attemptHook 在每次请求前的 reserve 为准（含首次与重试）；
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

  // 同一 trace 可能在重试钩子与最终收尾中被多次观测；按增量记账避免重复累计 token / 成本。
  const accountedByTrace = new WeakMap();

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

  /**
   * modelTransport 每次真实 HTTP 尝试前调用：首次与重试都在发请求前 reserve，
   * 因此报告中的请求数等于实际 axios.post 次数。超额时返回 false 让请求循环立即中断。
   */
  function attemptHook(kind, trace) {
    let reservedAttempt = 0;
    return (attempt) => {
      const current = Math.max(1, Number(attempt) || 1);
      if (current <= reservedAttempt) return true;
      try {
        // 先结算上一段响应已写入 trace 的 token，确保成本上限在下一请求前生效。
        recordUsage(trace, { silent: true });
        reserve(kind, 1);
        reservedAttempt = current;
        return !state.stopped;
      } catch (err) {
        if (!state.stopped) stop(err.message);
        return false;
      }
    };
  }

  /** 按 trace 增量记录 token / 时长 / 模型；silent=true 供重试钩子预检成本使用 */
  function recordUsage(trace, options = {}) {
    if (!trace || typeof trace !== 'object') return;
    const prev = accountedByTrace.get(trace) || { promptTokens: 0, completionTokens: 0, totalTokens: 0, durationMs: 0 };
    const next = {
      promptTokens: Math.max(0, Number(trace.promptTokens) || 0),
      completionTokens: Math.max(0, Number(trace.completionTokens) || 0),
      totalTokens: Math.max(0, Number(trace.totalTokens) || 0),
      durationMs: Math.max(0, Number(trace.modelDurationMs) || 0)
    };
    const deltaPrompt = Math.max(0, next.promptTokens - prev.promptTokens);
    const deltaCompletion = Math.max(0, next.completionTokens - prev.completionTokens);
    const deltaTotal = Math.max(0, next.totalTokens - prev.totalTokens);
    state.promptTokens += deltaPrompt;
    state.completionTokens += deltaCompletion;
    state.totalTokens += deltaTotal;
    state.durationMs += Math.max(0, next.durationMs - prev.durationMs);
    if (trace.model) state.models.add(trace.model);
    state.costCny += Math.round((deltaTotal / 1e6) * unitPrice.llmPerMillionTokens * 1e8) / 1e8;
    accountedByTrace.set(trace, next);
    if (state.costCny > limits.maxCostCny) {
      stop(`估算成本 ¥${state.costCny} 超过上限 ¥${limits.maxCostCny}`);
      if (!options.silent) throw new Error(`在线评测预算超限：${state.stopReason}`);
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
