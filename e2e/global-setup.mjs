// 全局初始化：启动隔离测试栈 → 种子数据 → 写运行时信息（tests 通过 envRuntime 读取）
import { mkdirSync, writeFileSync } from 'node:fs';
import { stackUp } from './helpers/stack.mjs';
import { seedTestData, seedInfo } from './seed.mjs';
import { closeDb } from './helpers/db.mjs';
import { ADMIN_BASE, MEMBER_BASE, RUN_ID, SEED_PASSWORD } from './helpers/env.mjs';

export default async function globalSetup() {
  await stackUp();
  const seeded = await seedTestData();
  const info = await seedInfo();
  await closeDb();

  mkdirSync(new URL('./.runtime', import.meta.url), { recursive: true });
  writeFileSync(
    new URL('./.runtime/env.json', import.meta.url),
    JSON.stringify({ ...seeded, runId: RUN_ID, adminBase: ADMIN_BASE, memberBase: MEMBER_BASE }, null, 2)
  );

  // 密码不写入任何产物；仅通过环境变量传递给测试进程（隔离库专用）
  process.env.E2E_SEED_PASSWORD_RUNTIME = SEED_PASSWORD;
  process.stdout.write(`[e2e] 种子完成 taskId=${seeded.taskId} assessmentId=${seeded.assessmentId} users=${info.users.length}\n`);
  return seeded;
}
