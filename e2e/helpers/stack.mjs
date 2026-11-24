// 隔离 Docker 测试栈启动/停止（独立项目名 + 独立卷 + 独立端口，绝不触碰已有部署）
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { COMPOSE_ARGS, COMPOSE_ENV, RUN_ID, ADMIN_BASE, MEMBER_BASE } from './env.mjs';

const PROJECT_ROOT = fileURLToPath(new URL('../../', import.meta.url));

// 最近一次探针失败原因（probe 内写入，供超时报错定位；必须声明在模块层，
// 因为 probe 是独立函数，声明在 waitReady 内会触发 ReferenceError——CI 冷启动必现）
let lastErr = '';

function compose(args) {
  execFileSync('docker', ['compose', ...COMPOSE_ARGS, ...args], {
    cwd: PROJECT_ROOT,
    env: COMPOSE_ENV,
    stdio: 'inherit',
  });
}

export async function stackUp({ build = true } = {}) {
  compose(build ? ['up', '-d', '--build', '--quiet-pull'] : ['up', '-d']);
  await waitReady();
}

export async function stackDown() {
  compose(['down', '-v', '--remove-orphans']);
}

export async function stackDownKeepVolumes() {
  compose(['down', '--remove-orphans']);
}

async function waitReady(timeoutMs = 420000) {
  const deadline = Date.now() + timeoutMs;
  process.stdout.write(`[e2e] 等待测试栈就绪（RUN_ID=${RUN_ID}）…\n`);
  lastErr = '';
  while (Date.now() < deadline) {
    const [adminOk, memberOk] = await Promise.all([probe(ADMIN_BASE), probe(MEMBER_BASE)]);
    if (adminOk && memberOk) {
      process.stdout.write('[e2e] 测试栈就绪\n');
      return;
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`测试栈在 ${timeoutMs / 1000}s 内未就绪：${lastErr}`);
}

async function probe(base) {
  try {
    const res = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(4000) });
    return res.ok;
  } catch (err) {
    lastErr = err.message;
    return false;
  }
}
