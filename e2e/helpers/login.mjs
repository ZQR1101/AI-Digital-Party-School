// 登录助手：真实浏览器登录两端（密码为隔离测试库专用一次性凭据）
import { ADMIN_BASE, MEMBER_BASE } from './env.mjs';

export const TEST_PASSWORD = process.env.E2E_TEST_PASSWORD || 'e2e-seed-pass-2026';

export async function adminLogin(page, username) {
  await page.goto(`${ADMIN_BASE}/login`);
  await page.getByTestId('admin-username').fill(username);
  await page.getByTestId('admin-password').fill(TEST_PASSWORD);
  await page.getByTestId('admin-login-submit').click();
  await page.waitForURL(/\/dashboard/);
  await page.getByTestId('stat-welcome').waitFor();
  return page;
}

export async function memberLogin(page, username) {
  await page.goto(`${MEMBER_BASE}/#/login`);
  await page.getByTestId('mobile-username').fill(username);
  await page.getByTestId('mobile-password').fill(TEST_PASSWORD);
  await page.getByTestId('mobile-login-submit').click();
  await page.waitForURL(/#\/home/);
  return page;
}

export async function memberLogout(page) {
  await page.goto(`${MEMBER_BASE}/#/mine`);
  await page.getByTestId('member-logout').click();
  await page.waitForURL(/#\/login/);
}

export async function adminLogout(page) {
  await page.getByTestId('admin-logout').click();
  await page.waitForURL(/\/login/);
}
