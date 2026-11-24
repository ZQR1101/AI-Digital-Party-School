// 登录/退出链路：真实浏览器操作 + 页面内容与存储状态断言
import { test, expect } from '@playwright/test';
import { ADMIN_BASE, MEMBER_BASE, ACCOUNTS } from '../helpers/env.mjs';
import { adminLogin, memberLogin, memberLogout, adminLogout, TEST_PASSWORD } from '../helpers/login.mjs';

test.describe('认证：管理后台登录/退出', () => {
  test('管理员账号密码登录成功，进入数据总览并持有 token @smoke', async ({ page }) => {
    await adminLogin(page, ACCOUNTS.admin.username);

    expect(new URL(page.url()).pathname).toContain('/dashboard');
    await expect(page.getByRole('heading', { name: '数据总览' })).toBeVisible();
    // 统计卡片真实渲染（数据来自 /api/admin/statistics/overview）
    await expect(page.locator('.metric-card').first()).toBeVisible();
    const token = await page.evaluate(() => localStorage.getItem('adminToken'));
    expect(token).toBeTruthy();
  });

  test('错误密码登录失败，页面给出错误提示且不跳转', async ({ page }) => {
    await page.goto(`${ADMIN_BASE}/login`);
    await page.getByTestId('admin-username').fill(ACCOUNTS.admin.username);
    await page.getByTestId('admin-password').fill('wrong-password-123');
    await page.getByTestId('admin-login-submit').click();

    await expect(page.locator('.el-message').filter({ hasText: /账号或密码|登录失败|错误/ })).toBeVisible();
    await expect(page).not.toHaveURL(/dashboard/);
    const token = await page.evaluate(() => localStorage.getItem('adminToken'));
    expect(token).toBeFalsy();
  });

  test('退出登录清空 token 并回到登录页', async ({ page }) => {
    await adminLogin(page, ACCOUNTS.admin.username);
    await adminLogout(page);

    expect(page.url()).toContain('/login');
    const token = await page.evaluate(() => localStorage.getItem('adminToken'));
    expect(token).toBeFalsy();
  });
});

test.describe('认证：学员端登录/退出', () => {
  test('党员账号登录成功进入首页并持有 token', async ({ page }) => {
    await memberLogin(page, ACCOUNTS.member.username);

    const token = await page.evaluate(() => localStorage.getItem('mobileToken'));
    expect(token).toBeTruthy();
    await expect(page.getByTestId('member-home-welcome')).toBeVisible();
  });

  test('未登录访问学员端任务页被重定向到登录页 @smoke', async ({ page }) => {
    await page.goto(`${MEMBER_BASE}/#/tasks`);
    await page.waitForURL(/#\/login/);
    await expect(page.getByTestId('mobile-login-submit')).toBeVisible();
  });

  test('学员退出登录清空 token 回到登录页', async ({ page }) => {
    await memberLogin(page, ACCOUNTS.member.username);
    await memberLogout(page);

    const token = await page.evaluate(() => localStorage.getItem('mobileToken'));
    expect(token).toBeFalsy();
  });
});
