-- ============================================================
-- 幂等数据库迁移脚本（禁止 DROP 现有表，重复执行安全）
-- 重复执行安全：CREATE TABLE IF NOT EXISTS + INSERT IGNORE
-- 初始账号密码通过 SEED_PASSWORD 环境变量注入，未在代码中写死
-- ============================================================

CREATE DATABASE IF NOT EXISTS party_school DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE party_school;

-- 关闭外键检查，避免删表顺序问题
SET FOREIGN_KEY_CHECKS = 0;



-- ----------------------------
-- 1. 组织架构表
-- type: committee(党委) / generalBranch(党总支) / branch(党支部) / group(党小组)
-- ----------------------------

CREATE TABLE IF NOT EXISTS organizations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL COMMENT '组织名称',
  type VARCHAR(20) NOT NULL COMMENT '组织类型: committee/generalBranch/branch/group',
  parentId INT NULL COMMENT '上级组织ID',
  leaderUserId INT NULL COMMENT '负责人用户ID',
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (parentId) REFERENCES organizations(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='组织架构表';

-- ----------------------------
-- 2. 用户表
-- role: member(党员) / secretary(支部书记) / admin(系统管理员)
-- ----------------------------

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) NOT NULL UNIQUE COMMENT '登录账号',
  password VARCHAR(255) NOT NULL COMMENT '密码哈希',
  realName VARCHAR(50) NOT NULL COMMENT '真实姓名',
  role VARCHAR(20) NOT NULL DEFAULT 'member' COMMENT '角色: member/secretary/admin',
  organizationId INT NULL COMMENT '所属组织ID',
  phone VARCHAR(20) NULL COMMENT '手机号',
  email VARCHAR(100) NULL COMMENT '邮箱',
  status TINYINT DEFAULT 1 COMMENT '状态: 1启用 0禁用',
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (organizationId) REFERENCES organizations(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户表';

-- ----------------------------
-- 3. 学习内容表
-- type: article(文章) / video(视频)
-- status: draft(草稿) / published(已发布) / offlined(已下架)
-- ----------------------------

CREATE TABLE IF NOT EXISTS contents (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(200) NOT NULL COMMENT '标题',
  type VARCHAR(20) NOT NULL COMMENT '类型: article/video',
  coverUrl VARCHAR(500) NULL COMMENT '封面图URL',
  bodyOrVideoUrl TEXT NULL COMMENT '文章正文HTML或视频URL',
  summary VARCHAR(500) NULL COMMENT '摘要',
  tags VARCHAR(500) NULL COMMENT '标签，逗号分隔',
  isPublic TINYINT DEFAULT 0 COMMENT '是否公共内容: 1是 0否',
  status VARCHAR(20) NOT NULL DEFAULT 'draft' COMMENT '状态: draft/published/offlined',
  createdBy INT NULL COMMENT '创建人ID',
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (createdBy) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='学习内容表';

-- ----------------------------
-- 4. 学习任务表
-- status: draft(草稿) / published(已发布) / closed(已关闭)
-- ----------------------------

CREATE TABLE IF NOT EXISTS learning_tasks (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(200) NOT NULL COMMENT '任务标题',
  contentId INT NOT NULL COMMENT '关联学习内容ID',
  organizationId INT NOT NULL COMMENT '下发组织ID',
  deadline DATETIME NULL COMMENT '截止时间',
  description TEXT NULL COMMENT '任务描述',
  status VARCHAR(20) NOT NULL DEFAULT 'draft' COMMENT '状态: draft/published/closed',
  createdBy INT NULL COMMENT '创建人ID',
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (contentId) REFERENCES contents(id) ON DELETE CASCADE,
  FOREIGN KEY (organizationId) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (createdBy) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='学习任务表';

-- ----------------------------
-- 5. 学习记录表
-- status: inProgress(学习中) / completed(已完成)
-- ----------------------------

CREATE TABLE IF NOT EXISTS learning_records (
  id INT AUTO_INCREMENT PRIMARY KEY,
  userId INT NOT NULL COMMENT '用户ID',
  taskId INT NOT NULL COMMENT '任务ID',
  studySeconds INT DEFAULT 0 COMMENT '学习时长(秒)',
  lastActiveAt DATETIME NULL COMMENT '最近一次学习心跳时间，服务端据此限制可计入时长',
  sessionStartedAt DATETIME NULL COMMENT '学习会话开始时间(服务端建立，累计时长约束基准)',
  completedAt DATETIME NULL COMMENT '完成时间',
  status VARCHAR(20) DEFAULT 'inProgress' COMMENT '状态: inProgress/completed',
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (taskId) REFERENCES learning_tasks(id) ON DELETE CASCADE,
  UNIQUE KEY uk_user_task (userId, taskId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='学习记录表';

-- ----------------------------
-- 6. 题库表
-- type: single(单选) / multiple(多选) / judge(判断)
-- options: JSON数组格式，如 ["A.选项1","B.选项2","C.选项3","D.选项4"]
-- answer: 单选如 "A"，多选如 "A,C"，判断如 "true"/"false"
-- ----------------------------

CREATE TABLE IF NOT EXISTS questions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  type VARCHAR(20) NOT NULL COMMENT '题型: single/multiple/judge',
  title TEXT NOT NULL COMMENT '题目内容',
  options JSON NULL COMMENT '选项列表(判断题为null)',
  answer VARCHAR(100) NOT NULL COMMENT '正确答案',
  analysis TEXT NULL COMMENT '解析',
  category VARCHAR(100) NULL COMMENT '题目分类',
  difficulty TINYINT DEFAULT 1 COMMENT '难度: 1简单 2中等 3困难',
  status TINYINT DEFAULT 1 COMMENT '状态: 1启用 0禁用',
  createdBy INT NULL COMMENT '创建人ID',
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (createdBy) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='题库表';

-- ----------------------------
-- 7. 考试/测验记录表
-- ----------------------------

CREATE TABLE IF NOT EXISTS exam_records (
  id INT AUTO_INCREMENT PRIMARY KEY,
  userId INT NOT NULL COMMENT '用户ID',
  taskId INT NOT NULL COMMENT '关联任务ID',
  score DECIMAL(5,2) NOT NULL COMMENT '得分',
  totalScore DECIMAL(5,2) DEFAULT 100.00 COMMENT '总分',
  answers JSON NULL COMMENT '用户答案JSON',
  submittedAt DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '提交时间',
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (taskId) REFERENCES learning_tasks(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='考试记录表';

-- ----------------------------
-- 8. 试卷表（扩展）
-- ----------------------------

CREATE TABLE IF NOT EXISTS papers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(200) NOT NULL COMMENT '试卷标题',
  category VARCHAR(100) NULL COMMENT '试卷分类',
  description TEXT NULL COMMENT '试卷说明',
  duration INT DEFAULT 60 COMMENT '考试时长(分钟)',
  totalScore DECIMAL(5,2) DEFAULT 100.00 COMMENT '总分',
  passScore DECIMAL(5,2) DEFAULT 60.00 COMMENT '及格分',
  status TINYINT DEFAULT 1 COMMENT '状态: 1草稿 2已发布 0已删除',
  createdBy INT NULL,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (createdBy) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='试卷表';

-- ----------------------------
-- 9. 试卷-题目关联表
-- ----------------------------

CREATE TABLE IF NOT EXISTS paper_questions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  paperId INT NOT NULL,
  questionId INT NOT NULL,
  score DECIMAL(5,2) DEFAULT 0 COMMENT '该题分值',
  sort INT DEFAULT 0 COMMENT '排序',
  FOREIGN KEY (paperId) REFERENCES papers(id) ON DELETE CASCADE,
  FOREIGN KEY (questionId) REFERENCES questions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='试卷题目关联表';

-- 试卷下发和交卷记录（结构需与 assessment_upgrade.sql 一致）
CREATE TABLE IF NOT EXISTS assessments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  paperId INT NOT NULL,
  organizationId INT NOT NULL,
  kind ENUM('quiz', 'exam') NOT NULL,
  title VARCHAR(200) NOT NULL,
  deadline DATETIME NULL,
  totalScore DECIMAL(5,2) NOT NULL,
  passScore DECIMAL(5,2) NOT NULL,
  questions JSON NOT NULL COMMENT '下发时的题目和答案快照',
  createdBy INT NULL,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_assessment_org (organizationId, createdAt),
  FOREIGN KEY (paperId) REFERENCES papers(id),
  FOREIGN KEY (organizationId) REFERENCES organizations(id),
  FOREIGN KEY (createdBy) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='已下发测评';

CREATE TABLE IF NOT EXISTS assessment_attempts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  assessmentId INT NOT NULL,
  userId INT NOT NULL,
  score DECIMAL(5,2) NOT NULL COMMENT '百分制成绩',
  earnedPoints DECIMAL(5,2) NOT NULL,
  totalScore DECIMAL(5,2) NOT NULL,
  passed TINYINT NOT NULL,
  results JSON NOT NULL COMMENT '判题结果和知识点快照',
  submittedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_assessment_user (assessmentId, userId),
  INDEX idx_attempt_user_time (userId, submittedAt),
  FOREIGN KEY (assessmentId) REFERENCES assessments(id),
  FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='测评交卷记录';

-- ----------------------------
-- 10. AI推荐反馈与审计
-- ----------------------------

CREATE TABLE IF NOT EXISTS recommendation_feedback (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  userId INT NOT NULL,
  contentId INT NOT NULL,
  action VARCHAR(20) NOT NULL COMMENT 'view/start/complete/dismiss',
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_feedback_user_time (userId, createdAt),
  FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (contentId) REFERENCES contents(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AI推荐反馈';


CREATE TABLE IF NOT EXISTS ai_audit_logs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  operatorId INT NULL,
  operatorRole VARCHAR(20) NULL,
  scene VARCHAR(50) NOT NULL,
  question TEXT NULL,
  parsedIntent JSON NULL,
  resultSummary TEXT NULL,
  success TINYINT DEFAULT 1,
  errorMessage TEXT NULL,
  requestId VARCHAR(64) NULL,
  durationMs INT UNSIGNED NULL,
  modelDurationMs INT UNSIGNED NULL,
  model VARCHAR(120) NULL,
  promptTokens INT UNSIGNED NULL,
  completionTokens INT UNSIGNED NULL,
  totalTokens INT UNSIGNED NULL,
  attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  errorType VARCHAR(64) NULL,
  fallbackReason VARCHAR(64) NULL,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_ai_audit_operator_time (operatorId, createdAt),
  INDEX idx_ai_audit_scene_time (scene, createdAt),
  FOREIGN KEY (operatorId) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AI调用审计日志';

-- 恢复外键检查
SET FOREIGN_KEY_CHECKS = 1;

-- ----------------------------
-- 初始化数据：组织架构
-- ----------------------------
INSERT IGNORE INTO organizations (id, name, type, parentId) VALUES
(1, '学校党委', 'committee', NULL),
(2, '信息工程学院党委', 'committee', 1),
(3, '软件工程系党总支', 'generalBranch', 2),
(4, '学生第一党支部', 'branch', 3),
(5, '第一党小组', 'group', 4),
(6, '第二党小组', 'group', 4),
(7, '教师党支部', 'branch', 3),
(8, '计算机系党总支', 'generalBranch', 2),
(9, '机关党委', 'committee', 1),
(10, '行政第一党支部', 'branch', 9);

-- ----------------------------
-- 初始化数据：账号密码由 SEED_PASSWORD 环境变量注入
-- ----------------------------
INSERT IGNORE INTO users (id, username, password, realName, role, organizationId, status) VALUES
(1, 'admin', '__SEED_PASSWORD_HASH__', '系统管理员', 'admin', 1, 1),
(2, 'zhangsan', '__SEED_PASSWORD_HASH__', '张三', 'secretary', 4, 1),
(3, 'lisi', '__SEED_PASSWORD_HASH__', '李四', 'member', 4, 1),
(4, 'wangwu', '__SEED_PASSWORD_HASH__', '王五', 'member', 5, 1);

-- 公共学习内容种子（幂等：仅在新库插入，已有同 id 数据不受影响）
INSERT IGNORE INTO contents (id, title, type, coverUrl, bodyOrVideoUrl, summary, tags, isPublic, status, createdBy) VALUES
(1, '三会一课制度要点', 'article', NULL, '<p>“三会一课”指定期召开支部党员大会、支部委员会会议、党小组会，按时上好党课。支部党员大会一般每季度召开一次，支部委员会会议一般每月召开一次，党小组会一般每月召开一至两次，党课每季度至少一次。</p><p>“三会一课”应突出政治学习和教育，突出党性锻炼，坚决防止表面化、形式化、娱乐化、庸俗化。党支部要结合实际，把“三会一课”与“主题党日”结合起来，组织党员集中学习、过组织生活、进行民主议事和志愿服务。对没有正当理由不参加“三会一课”的党员，党支部应当及时提醒、批评教育；多次不参加的，按照党章和党内有关规定严肃处理。</p>', '“三会一课”是党的组织生活的基本制度：支部党员大会每季度一次，支委会每月一次，党小组会每月一至两次，党课每季度至少一次，应突出政治学习和党性锻炼。', '组织生活,三会一课,基本制度', 1, 'published', 1),
(2, '学习完成率统计口径说明', 'article', NULL, '<p>学习完成率的计算口径为：已完成学习任务人次除以应完成学习任务人次，再乘以 100%。应完成人次按任务下发组织的在册正式党员数统计，停用账号不计入。</p>', '学习完成率 = 已完成学习任务人次 ÷ 应完成学习任务人次 × 100%，停用账号不计入应完成人次。', '统计,学习制度,完成率', 1, 'published', 1),
(3, '重温入党誓词（示范视频）', 'video', NULL, '/uploads/content/seed-oath.mp4', '重温入党誓词示范视频，用于组织生活与党员教育。', '入党誓词,组织生活,视频', 1, 'published', 1),
(4, '党员组织关系转接流程', 'article', NULL, '<p>党员组织关系转接遵循“应转尽转”原则：凭《中国共产党党员组织关系介绍信》办理，转出地党组织开具介绍信，接收地党组织核对党员信息并回执确认，全程通过全国党员信息系统线上流转。</p>', '党员组织关系转接凭介绍信办理，转出开具、接收回执，全国党员信息系统线上流转。', '组织关系,党员管理,流程', 1, 'published', 1);
