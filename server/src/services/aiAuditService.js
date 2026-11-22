const db = require('../config/db');

class AIAuditService {
  static async record({ actor, scene, operation, parsedIntent, success, requestId, durationMs, errorType, mode, trace }) {
    const values = [
      actor?.userId || null, actor?.role || null, scene, operation,
      parsedIntent ? JSON.stringify(parsedIntent) : null,
      mode || null, success ? 1 : 0, errorType || null
    ];
    try {
      try {
        await db.query({
          sql: `INSERT INTO ai_audit_logs
            (operatorId, operatorRole, scene, question, parsedIntent, resultSummary, success, errorMessage,
             requestId, durationMs, modelDurationMs, model, promptTokens, completionTokens, totalTokens,
             attempts, errorType, fallbackReason)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          timeout: 1500
        }, [
          ...values, requestId, durationMs, trace.modelDurationMs ?? null,
          trace.model?.slice(0, 120) ?? null, trace.promptTokens ?? null, trace.completionTokens ?? null,
          trace.totalTokens ?? null, trace.attempts || 0, errorType || null, trace.fallbackReason || null
        ]);
      } catch (error) {
        if (error.code !== 'ER_BAD_FIELD_ERROR') throw error;
        await db.query({
          sql: `INSERT INTO ai_audit_logs
            (operatorId, operatorRole, scene, question, parsedIntent, resultSummary, success, errorMessage)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          timeout: 1500
        }, values);
      }
    } catch (error) {
      console.warn('[AI Audit] 写入失败:', requestId, error.code || 'internal_error');
    }
  }
}

module.exports = AIAuditService;
