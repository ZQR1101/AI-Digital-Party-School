// 全局清理：断开 DB、销毁测试栈与全部临时卷、断言无遗留
import { execFileSync } from 'node:child_process';
import { closeDb } from './helpers/db.mjs';
import { stackDown } from './helpers/stack.mjs';
import { PROJECT, RUN_ID } from './helpers/env.mjs';

export default async function globalTeardown() {
  await closeDb().catch(() => {});
  await stackDown();

  // 防遗留断言：本项目前缀的容器与卷必须全部清空
  const list = (args) => execFileSync('docker', args, { encoding: 'utf8' }).trim();
  const containers = list(['ps', '-aq', '--filter', `label=com.docker.compose.project=${PROJECT}`]);
  const volumes = list(['volume', 'ls', '-q', '--filter', `label=com.docker.compose.project=${PROJECT}`]);
  if (containers || volumes) {
    throw new Error(`E2E 清理不彻底：遗留容器=${containers || '无'} 卷=${volumes || '无'}`);
  }
  if (list(['volume', 'ls', '-q']).split('\n').some((v) => v.startsWith(`ai_party_e2e_`) && v.includes(RUN_ID.toLowerCase().replace(/_/g, '-')))) {
    throw new Error('E2E 存在本轮运行标识的遗留卷');
  }
  process.stdout.write('[e2e] 清理完成，无遗留容器与卷\n');
}
