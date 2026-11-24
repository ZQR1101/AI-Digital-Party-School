// 书记发布任务独立闭环：不依赖管理员创建任务的用例（task-flow.spec.js），可单独重复执行
// 链路：书记登录 → UI 填表（内容/本组织树/截止时间）发布 → 任务落库 → 列表展示 → 本组织党员可见 → 范围外组织被后端拒绝
import { test, expect } from '@playwright/test';
import { ADMIN_BASE, MEMBER_BASE, ACCOUNTS, E2E_PREFIX } from '../helpers/env.mjs';
import { adminLogin, memberLogin } from '../helpers/login.mjs';
import { query, queryOne } from '../helpers/db.mjs';

let taskTitle;

test.beforeAll(async () => {
  taskTitle = `${E2E_PREFIX}书记发布任务-${Date.now()}`;
});

/** 在已登录页面的浏览器上下文里用真实 token 调后端接口 */
async function fetchAsUser(page, path, options = {}) {
  return page.evaluate(async ({ path, options }) => {
    const token = localStorage.getItem('mobileToken') || localStorage.getItem('adminToken');
    const res = await fetch(path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {}),
      },
    });
    let body = null;
    try { body = await res.json(); } catch { /* ignore */ }
    return { status: res.status, body };
  }, { path, options });
}

test.describe.serial('书记在本组织范围创建并发布任务', () => {
  test('书记通过后台 UI 填表发布任务，落库且列表展示', async ({ page }) => {
    await adminLogin(page, ACCOUNTS.secretary.username);
    const created = page.waitForResponse((r) => r.url().includes('/api/admin/tasks') && r.request().method() === 'POST' && r.status() < 300);

    await page.goto(`${ADMIN_BASE}/tasks`);
    await page.getByTestId('admin-task-create').click();

    await page.getByTestId('task-title-input').fill(taskTitle);
    // 学习内容（书记仅见已发布内容；种子短文为 published）
    await page.getByTestId('task-content-select').click();
    await page.locator('.el-select-dropdown__item').filter({ hasText: `${E2E_PREFIX}党章学习短文` }).first().click();

    // 组织树：书记树保留祖先路径（可逐级展开），但仅能选择本组织（org 4）子树
    const orgWrapper = page.locator('div.el-select[data-testid="task-org-select"] .el-select__wrapper');
    await orgWrapper.click();
    for (const name of ['学校党委', '信息工程学院党委', '软件工程系党总支']) {
      await page.locator('.el-tree-node__content').filter({ hasText: name }).first()
        .locator('.el-tree-node__expand-icon:not(.expanded)').click();
    }
    await expect(page.locator('.el-tree-node__content').filter({ hasText: '学生第一党支部' }).first()).toBeVisible();
    // 跨组织限制：范围外组织（机关党委）不在可选项中
    await expect(page.locator('.el-tree-node__content').filter({ hasText: '机关党委' })).toHaveCount(0);
    await page.locator('.el-tree-node__content').filter({ hasText: '学生第一党支部' }).first()
      .locator('.el-checkbox__inner').click();
    await orgWrapper.click();

    // 截止时间（Element Plus 日期输入键盘填写）
    await page.getByRole('dialog').locator('.el-date-editor input').first().fill('2026-12-31');
    await page.keyboard.press('Enter');

    await page.getByTestId('task-submit').click();
    const resp = await created;
    expect(resp.status(), '书记发布任务接口应成功').toBeLessThan(300);

    // 任务列表真实渲染
    await page.goto(`${ADMIN_BASE}/tasks`);
    await expect(page.locator('.el-table').filter({ hasText: taskTitle })).toBeVisible();

    // 数据库断言：真实落库到书记本组织（org 4）且为已发布
    await expect.poll(async () => {
      const row = await queryOne(
        'SELECT organizationId, status, createdBy FROM learning_tasks WHERE title = ?',
        [taskTitle]
      );
      return row ? `${row.organizationId}:${row.status}` : 'missing';
    }, { timeout: 10000, message: '书记发布的任务应落库' }).toBe('4:published');
    const row = await queryOne(
      `SELECT lt.createdBy, u.role FROM learning_tasks lt JOIN users u ON u.id = lt.createdBy WHERE lt.title = ?`,
      [taskTitle]
    );
    expect(row.role, '创建者应为书记').toBe('secretary');
  });

  test('本组织党员在学员端任务列表看到书记发布的任务', async ({ page }) => {
    await memberLogin(page, ACCOUNTS.member.username);
    await page.goto(`${MEMBER_BASE}/#/tasks`);
    const card = page.locator('[data-testid^="task-card-"]').filter({ hasText: taskTitle });
    await expect(card, '本组织党员应看到书记发布的任务').toBeVisible();
  });

  test('书记向范围外组织创建任务被后端拒绝且不落库', async ({ page }) => {
    await adminLogin(page, ACCOUNTS.secretary.username);

    const seedContent = await queryOne('SELECT id FROM contents WHERE title = ?', [`${E2E_PREFIX}党章学习短文`]);
    expect(seedContent, '种子内容应存在').toBeTruthy();
    const countBefore = await queryOne('SELECT COUNT(*) AS c FROM learning_tasks');

    // org 9（机关党委）在书记范围之外
    const res = await fetchAsUser(page, '/api/admin/tasks', {
      method: 'POST',
      body: JSON.stringify({ title: `${E2E_PREFIX}书记越权范围任务`, contentId: seedContent.id, organizationIds: [9], deadline: '2026-12-31' }),
    });
    expect([400, 403, 422], '越权组织应被拒绝').toContain(res.status);

    const countAfter = await queryOne('SELECT COUNT(*) AS c FROM learning_tasks');
    expect(Number(countAfter.c)).toBe(Number(countBefore.c));
    expect(await query('SELECT id FROM learning_tasks WHERE title = ?', [`${E2E_PREFIX}书记越权范围任务`])).toHaveLength(0);
  });
});
