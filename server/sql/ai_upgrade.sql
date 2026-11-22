USE party_school;

CREATE TABLE IF NOT EXISTS recommendation_feedback (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  userId INT NOT NULL,
  contentId INT NOT NULL,
  action VARCHAR(20) NOT NULL,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_feedback_user_time (userId, createdAt),
  FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (contentId) REFERENCES contents(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='推荐反馈记录';

CREATE TABLE IF NOT EXISTS recommendation_daily (
  userId INT NOT NULL,
  dayKey CHAR(10) NOT NULL,
  contentIds TEXT NOT NULL,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (userId, dayKey)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='当日推荐快照';

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
