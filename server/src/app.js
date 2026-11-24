require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const logger = require('./utils/logger');

// 路由
const healthRoutes = require('./routes/health');
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
const { requestContext } = require('./middleware/requestContext');

const app = express();
// 后端统一端口：与前端 Vite 代理、README 保持一致（默认 3001）
const PORT = process.env.PORT || 3001;

// 中间件
// 链路追踪最先挂载：全链路 requestId（响应头 X-Request-ID）+ 访问日志 + 指标采集
app.use(requestContext);
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// 静态文件服务
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// ============== 运维接口（公开：探活/就绪/指标） ==============
app.use('/', healthRoutes); // /health /health/ready /metrics

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
  logger.error('Unhandled error', {
    requestId: req.requestId,
    method: req.method,
    path: req.originalUrl || req.url,
    error: err,
  });
  res.status(500).json({ code: 500, message: '服务器内部错误', data: null, requestId: req.requestId });
});

app.listen(PORT, () => {
  logger.info(`服务已启动 port=${PORT} prefix=/api health=/health metrics=/metrics`);
});

module.exports = app;
