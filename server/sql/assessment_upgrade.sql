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
