import { defineConfig } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';

// 输出目录：默认 test-results（CI 用）；本地沙箱环境可设 E2E_OUTPUT_DIR
// 指向全新临时目录，避免 Playwright 启动时批量清理旧工件触发删除保护。
const outputDir = process.env.E2E_OUTPUT_DIR
  ? path.join(process.env.E2E_OUTPUT_DIR, `run-${Date.now()}`)
  : './test-results';

export default defineConfig({
  testDir: './tests',
  timeout: 90000,
  expect: { timeout: 15000 },
  globalSetup: './global-setup.mjs',
  globalTeardown: './global-teardown.mjs',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  outputDir: path.join(outputDir, 'artifacts'),
  reporter: [
    ['list'],
    ['json', { outputFile: path.join(outputDir, 'report.json') }],
    ['html', { outputFolder: path.join(outputDir, 'html'), open: 'never' }],
  ],
  use: {
    actionTimeout: 15000,
    navigationTimeout: 30000,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'off',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
});
