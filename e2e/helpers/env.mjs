// E2E 运行环境常量（隔离 Docker 测试栈的连接信息）
import { randomUUID } from 'node:crypto';

// 测试栈固定端口（错开默认部署 8080/8081 与集成测试 18080/18081 之外的冲突可能）
export const ADMIN_PORT = Number(process.env.E2E_ADMIN_PORT || 18090);
export const MEMBER_PORT = Number(process.env.E2E_MEMBER_PORT || 18091);
export const DB_PORT = Number(process.env.E2E_DB_PORT || 23406);

// 隔离凭据：只作用于一次性测试卷，不属于任何真实环境
export const DB_PASSWORD = process.env.E2E_DB_PASSWORD || 'e2e-db-pass-2026';
export const SEED_PASSWORD = process.env.E2E_SEED_PASSWORD || 'e2e-seed-pass-2026';
export const JWT_SECRET = process.env.E2E_JWT_SECRET || 'e2e-jwt-secret-2026';

export const ADMIN_BASE = `http://localhost:${ADMIN_PORT}`;
export const MEMBER_BASE = `http://localhost:${MEMBER_PORT}`;

// 隔离标识：独立 compose 项目名 + 容器名后缀，保证绝不触碰已有部署
export const RUN_ID = `e2e-${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}-${randomUUID().slice(0, 6)}`;
export const PROJECT = `ai_party_e2e_${RUN_ID.replace(/-/g, '_')}`;

export const COMPOSE_ARGS = [
  '-p', PROJECT,
  '-f', 'docker-compose.yml',
  '-f', 'deploy/docker-compose.it.yml',
];

export const COMPOSE_ENV = {
  ...process.env,
  DB_PASSWORD,
  SEED_PASSWORD,
  JWT_SECRET,
  ADMIN_PORT: String(ADMIN_PORT),
  MEMBER_PORT: String(MEMBER_PORT),
  IT_DB_PORT: String(DB_PORT),
  IT_RUN_ID: RUN_ID,
};

// 种子账号（隔离库专用测试账号，密码统一为 SEED_PASSWORD）
export const ACCOUNTS = {
  admin: { username: 'admin', role: 'admin', organizationId: 1 },
  secretary: { username: 'zhangsan', role: 'secretary', organizationId: 4 },
  member: { username: 'lisi', role: 'member', organizationId: 4 },
  memberOtherOrg: { username: 'wangwu', role: 'member', organizationId: 5 },
  // 停用场景专用账号，避免污染其他用例
  memberDisabled: { username: 'e2e_disabled', role: 'member', organizationId: 4 },
};

// E2E 专用数据标记（可重复：global setup 每次全新卷，数据前缀便于断言与清理）
export const E2E_PREFIX = 'E2E测试';
