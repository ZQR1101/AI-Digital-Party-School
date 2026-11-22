require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

// 路由
const authRoutes = require('./routes/auth');
const taskRoutes = require('./routes/tasks');
const learningRecordRoutes = require('./routes/learningRecords');
const examRecordRoutes = require('./routes/examRecords');
const assessmentRoutes = require('./routes/assessments');
const reportRoutes = require('./routes/reports');
const aiRoutes = require('./routes/ai');
const contentRoutes = require('./routes/contents');
const adminOrgRoutes = require('./routes/admin/organizations');
const adminUserRoutes = require('./routes/admin/users');
const adminContentRoutes = require('./routes/admin/contents');
const adminTaskRoutes = require('./routes/admin/tasks');
const adminQuestionRoutes = require('./routes/admin/questions');
const adminPaperRoutes = require('./routes/admin/papers');
const adminAssessmentRoutes = require('./routes/admin/assessments');
const adminStatisticsRoutes = require('./routes/admin/statistics');

const app = express();
// 后端统一端口：与前端 Vite 代理、README 保持一致（默认 3001）
const PORT = process.env.PORT || 3001;

// 中间件
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// 静态文件服务
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// ============== 通用接口 ==============
app.use('/api/auth', authRoutes);
app.use('/api', authRoutes); // /api/users/me 挂载在 auth 路由下
app.use('/api/tasks', taskRoutes);
app.use('/api/learning-records', learningRecordRoutes);
app.use('/api/exam-records', examRecordRoutes);
app.use('/api/assessments', assessmentRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/contents', contentRoutes);
app.use('/api/ai', aiRoutes);

// ============== 管理后台接口 ==============
app.use('/api/admin/organizations', adminOrgRoutes);
app.use('/api/admin/users', adminUserRoutes);
app.use('/api/admin/contents', adminContentRoutes);
app.use('/api/admin/tasks', adminTaskRoutes);
app.use('/api/admin/questions', adminQuestionRoutes);
app.use('/api/admin/papers', adminPaperRoutes);
app.use('/api/admin/assessments', adminAssessmentRoutes);
app.use('/api/admin/statistics', adminStatisticsRoutes);

// 404
app.use((req, res) => {
  res.status(404).json({ code: 404, message: `接口不存在: ${req.method} ${req.originalUrl}`, data: null });
});

// 全局错误处理
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ code: 500, message: '服务器内部错误', data: null });
});

app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════╗
║   基于AI的数智党校学习系统 - 后端服务     ║
║   端口: ${PORT}                           ║
║   接口前缀: /api                          ║
║   API文档: 详见项目核心方案               ║
╚══════════════════════════════════════════╝
  `);
});

module.exports = app;
