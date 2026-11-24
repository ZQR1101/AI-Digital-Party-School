/**
 * 健康检查路由（公开，供负载均衡/容器编排探活）。
 *
 * - GET /health   ：存活探针（liveness）。进程能响应即返回 200，不探测依赖。
 * - GET /health/ready：就绪探针（readiness）。探测 MySQL 连通性，不可用时返回 503。
 * - GET /metrics  ：基础指标（JSON），供监控采集。
 *
 * 探针不应经过请求日志的噪音放大，但仍记录指标与 requestId。
 */

const express = require('express');
const db = require('../config/db');
const metrics = require('../utils/metrics');

const router = express.Router();

// 存活探针：进程内不做任何依赖检查
router.get('/health', (req, res) => {
  res.json({ code: 0, message: 'ok', data: { status: 'ok', uptimeSeconds: Math.round(process.uptime()) } });
});

// 就绪探针：检查 MySQL 可达
router.get('/health/ready', async (req, res, next) => {
  const startedAt = Date.now();
  try {
    await db.query('SELECT 1');
    res.json({
      code: 0,
      message: 'ready',
      data: {
        status: 'ready',
        db: true,
        dbLatencyMs: Date.now() - startedAt,
        uptimeSeconds: Math.round(process.uptime()),
      },
    });
  } catch (err) {
    // 依赖不可用属于服务自身状态问题，用 503 表达而不是 500
    return res.status(503).json({
      code: 503,
      message: '数据库不可用',
      data: { status: 'unready', db: false },
    });
  }
});

// 基础指标
router.get('/metrics', (req, res) => {
  res.json({ code: 0, message: 'ok', data: metrics.snapshot() });
});

module.exports = router;
