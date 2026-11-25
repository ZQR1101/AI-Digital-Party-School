// 评测元信息：Git Commit、知识库版本、运行环境与 N/A 约定
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const NA = 'N/A'; // 未运行项的唯一标记：禁止用 0 或 100% 代替缺失数据

function gitSha() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: path.resolve(__dirname, '../../..'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
  } catch {
    return NA;
  }
}

function knowledgeBaseVersion() {
  const dir = path.resolve(__dirname, '../../knowledge');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort();
  const hash = crypto.createHash('sha256');
  for (const file of files) {
    hash.update(file);
    hash.update(fs.readFileSync(path.join(dir, file)));
  }
  return { files: files.length, sha256: hash.digest('hex') };
}

function onlineLimits() {
  const integer = (name, fallback) => {
    const value = Number(process.env[name]);
    return Number.isSafeInteger(value) && value > 0 ? value : fallback;
  };
  return {
    // 覆盖 122 样本的 Embedding 批次 + 每样本 Rerank + NLQ 意图调用（含重试）
    maxRequests: integer('AI_EVAL_ONLINE_MAX_REQUESTS', 400),
    maxCostCny: Number(process.env.AI_EVAL_ONLINE_MAX_COST_CNY) > 0
      ? Number(process.env.AI_EVAL_ONLINE_MAX_COST_CNY) : 5,
    pricePerMillionTokens: Number(process.env.AI_EVAL_ONLINE_PRICE_PER_MTOK) > 0
      ? Number(process.env.AI_EVAL_ONLINE_PRICE_PER_MTOK) : 2,
    timeoutMs: integer('AI_TIMEOUT_MS', 12000),
    transportMaxAttempts: 2, // 由 src/ai/modelTransport.js 固化，评测不修改业务重试策略
    embeddingCostPerRequest: Number(process.env.AI_EVAL_ONLINE_EMBED_COST_PER_REQ) || 0,
    rerankCostPerRequest: Number(process.env.AI_EVAL_ONLINE_RERANK_COST_PER_REQ) || 0
  };
}

function collect({ mode, config }) {
  return {
    node: process.version,
    platform: `${process.platform} ${process.arch}`,
    ci: Boolean(process.env.CI),
    gitCommit: gitSha(),
    knowledgeBase: knowledgeBaseVersion(),
    config,
    mode
  };
}

module.exports = { NA, gitSha, knowledgeBaseVersion, onlineLimits, collect };
