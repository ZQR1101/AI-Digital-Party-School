const db = require('../config/db');

class ExamRecordService {
  /** 提交答案并计算成绩 */
  static async submit(userId, { taskId, answers }) {
    // 获取任务关联的试卷/题目
    const [task] = await db.query(
      `SELECT t.*, pq.questionId, q.type, q.answer, q.title, q.options, q.analysis, pq.score as questionScore
       FROM learning_tasks t
       JOIN paper_questions pq ON pq.paperId = t.contentId
       JOIN questions q ON q.id = pq.questionId
       WHERE t.id = ?`,
      [taskId]
    );

    if (task.length === 0) {
      throw new Error('该任务没有关联的考试题目');
    }

    let totalScore = 0;
    let earnedScore = 0;
    const results = [];

    for (const q of task) {
      totalScore += Number(q.questionScore);
      const userAnswer = answers[q.questionId] || '';
      const correct = this.checkAnswer(q.type, userAnswer, q.answer);
      if (correct) earnedScore += Number(q.questionScore);
      results.push({
        questionId: q.questionId,
        title: q.title,
        userAnswer,
        correctAnswer: q.answer,
        isCorrect: correct,
        score: correct ? Number(q.questionScore) : 0,
        analysis: q.analysis
      });
    }

    const score = totalScore > 0 ? Math.round((earnedScore / totalScore) * 100 * 100) / 100 : 0;

    // 保存考试记录
    await db.query(
      'INSERT INTO exam_records (userId, taskId, score, totalScore, answers) VALUES (?, ?, ?, ?, ?)',
      [userId, taskId, score, 100, JSON.stringify(answers)]
    );

    return { score, totalScore: 100, details: results };
  }

  static checkAnswer(questionType, userAnswer, correctAnswer) {
    if (questionType === 'judge') {
      return String(userAnswer).toLowerCase() === String(correctAnswer).toLowerCase();
    }
    if (questionType === 'multiple') {
      const userSet = new Set(String(userAnswer).toUpperCase().split(',').map(s => s.trim()).filter(Boolean));
      const correctSet = new Set(String(correctAnswer).toUpperCase().split(',').map(s => s.trim()).filter(Boolean));
      return userSet.size === correctSet.size && [...userSet].every(v => correctSet.has(v));
    }
    // single choice
    return String(userAnswer).toUpperCase().trim() === String(correctAnswer).toUpperCase().trim();
  }

  /** 获取用户考试记录 */
  static async getUserRecords(userId, { page = 1, pageSize = 10 }) {
    const [countRows] = await db.query(
      'SELECT COUNT(*) as total FROM exam_records WHERE userId = ?', [userId]
    );
    const [rows] = await db.query(
      `SELECT er.*, lt.title as taskTitle 
       FROM exam_records er 
       LEFT JOIN learning_tasks lt ON er.taskId = lt.id 
       WHERE er.userId = ? 
       ORDER BY er.submittedAt DESC LIMIT ? OFFSET ?`,
      [userId, Number(pageSize), (page - 1) * pageSize]
    );
    return { total: countRows[0].total, list: rows };
  }
}

module.exports = ExamRecordService;
