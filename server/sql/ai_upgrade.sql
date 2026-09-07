USE party_school;

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
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_ai_audit_operator_time (operatorId, createdAt),
  INDEX idx_ai_audit_scene_time (scene, createdAt),
  FOREIGN KEY (operatorId) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AI调用审计日志';
