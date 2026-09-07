const db = require('../config/db');

class AIAuditService {
  static async record({ actor, scene, question, parsedIntent, resultSummary, success = true, errorMessage = null }) {
    try {
      await db.query(
        `INSERT INTO ai_audit_logs
         (operatorId, operatorRole, scene, question, parsedIntent, resultSummary, success, errorMessage)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          actor?.userId || null,
          actor?.role || null,
          scene,
          String(question || '').slice(0, 1000),
          parsedIntent ? JSON.stringify(parsedIntent) : null,
          String(resultSummary || '').slice(0, 1000),
          success ? 1 : 0,
          errorMessage ? String(errorMessage).slice(0, 1000) : null
        ]
      );
    } catch (error) {
      console.warn('[AI Audit] 写入失败:', error.message);
    }
  }
}

module.exports = AIAuditService;
