const db = require('../config/db');

/** 北京时间自然日 key（YYYY-MM-DD），与画像服务口径一致 */
function beijingDayKey(date) {
  const bj = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return bj.toISOString().slice(0, 10);
}

class HomeSummaryService {
  /**
   * 学员首页轻量统计（不走 AI，直接基于学习记录计算）：
   *  - streak：连续有学习记录的天数
   *  - weekHours：近 7 天学习时长（小时，保留 1 位）
   *  - pendingCount：进行中/未完成任务数
   *  - completedCount：已完成任务数
   */
  static async getSummary(userId) {
    const [rows] = await db.query(
      `SELECT lr.studySeconds, lr.status, lr.updatedAt, lt.organizationId
       FROM learning_records lr
       LEFT JOIN learning_tasks lt ON lt.id = lr.taskId
       WHERE lr.userId = ?`,
      [userId]
    );

    const activeDays = new Set();
    let weekSeconds = 0;
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    for (const row of rows) {
      if (!row.updatedAt) continue;
      const day = new Date(row.updatedAt);
      activeDays.add(beijingDayKey(day));
      if (day >= weekAgo) weekSeconds += Number(row.studySeconds) || 0;
    }

    // 连续天数：从今天（或最近有记录日）向前逐日回溯
    let streak = 0;
    const daySet = activeDays;
    const cursor = new Date(beijingDayKey(now) + 'T00:00:00Z');
    if (!daySet.has(beijingDayKey(cursor))) {
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    }
    while (daySet.has(beijingDayKey(cursor))) {
      streak += 1;
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    }

    const completedCount = rows.filter(r => r.status === 'completed').length;
    const pendingCount = rows.filter(r => r.status !== 'completed').length;

    return {
      streak,
      weekHours: Math.round((weekSeconds / 3600) * 10) / 10,
      pendingCount,
      completedCount,
      activeDays: activeDays.size,
      generatedAt: new Date().toISOString()
    };
  }
}

module.exports = HomeSummaryService;
