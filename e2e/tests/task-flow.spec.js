// 核心业务闭环：管理员创建发布任务 → 学员真实浏览器学习 → 进度落库 → 统计页呈现
// 全部为真实 UI 驱动 + 接口响应 + 数据库状态三重断言
import { test, expect } from '@playwright/test';
import { ADMIN_BASE, MEMBER_BASE, ACCOUNTS, E2E_PREFIX } from '../helpers/env.mjs';
import { adminLogin, memberLogin } from '../helpers/login.mjs';
import { queryOne } from '../helpers/db.mjs';

let taskTitle;

test.beforeAll(async () => {
  taskTitle = `${E2E_PREFIX}闭环任务-${Date.now()}`;
});

test.describe.serial('任务创建发布 → 学员学习 → 统计呈现', () => {
  test('管理员通过 UI 创建并发布学习任务 @smoke', async ({ page }) => {
    await adminLogin(page, ACCOUNTS.admin.username);
    // 监听创建请求，后续用例依赖其成功
    const created = page.waitForResponse((r) => r.url().includes('/api/admin/tasks') && r.request().method() === 'POST' && r.status() < 300);

    await page.goto(`${ADMIN_BASE}/tasks`);
    await page.getByTestId('admin-task-create').click();

    await page.getByTestId('task-title-input').fill(taskTitle);
    // 选择学习内容（下拉）
    await page.getByTestId('task-content-select').click();
    await page.locator('.el-select-dropdown__item').filter({ hasText: `${E2E_PREFIX}党章学习短文` }).first().click();
    // 选择组织（树形多选）：逐级展开到支部后勾选 checkbox，再收起弹层
    const orgWrapper = page.locator('div.el-select[data-testid="task-org-select"] .el-select__wrapper');
    await orgWrapper.click();
    for (const name of ['学校党委', '信息工程学院党委', '软件工程系党总支']) {
      await page.locator('.el-tree-node__content').filter({ hasText: name }).first()
        .locator('.el-tree-node__expand-icon:not(.expanded)').click();
    }
    await page.locator('.el-tree-node__content').filter({ hasText: '学生第一党支部' }).first()
      .locator('.el-checkbox__inner').click();
    await orgWrapper.click();
    // 截止时间（Element Plus 日期输入键盘填写）
    await page.getByRole('dialog').locator('.el-date-editor input').first().fill('2026-12-31');
    await page.keyboard.press('Enter');

    await page.getByTestId('task-submit').click();
    const resp = await created;
    expect(resp.status(), '创建任务接口应成功').toBeLessThan(300);

    // 列表真实渲染出新任务
    await page.goto(`${ADMIN_BASE}/tasks`);
    await expect(page.locator('.el-table').filter({ hasText: taskTitle })).toBeVisible();
  });

  test('学员在任务列表看到新任务并完成学习，进度写入数据库', async ({ page }) => {
    await memberLogin(page, ACCOUNTS.member.username);

    await page.goto(`${MEMBER_BASE}/#/tasks`);
    const card = page.locator('[data-testid^="task-card-"]').filter({ hasText: taskTitle });
    await expect(card).toBeVisible();

    await card.getByTestId('task-open').click();
    await page.waitForURL(/#\/task\//);
    // 真实阅读等待：短文核算时长约 6s，等待页面进度到达 100%（不使用固定 sleep 做断言依据）
    await expect(page.getByTestId('task-progress-percent')).toHaveText(/100%/, { timeout: 45000 });
    await expect(page.getByTestId('task-hint')).toContainText('已达到规定学习时长');

    // 数据库断言：学习记录真实落库且完成（落库随 3s 心跳，轮询等待而非固定 sleep）
    await expect.poll(async () => {
      const record = await queryOne(
        `SELECT lr.status, lr.studySeconds, lr.completedAt
         FROM learning_records lr
         JOIN learning_tasks lt ON lt.id = lr.taskId
         JOIN users u ON u.id = lr.userId
         WHERE lt.title = ? AND u.username = ?`,
        [taskTitle, ACCOUNTS.member.username]
      );
      return record ? `${record.status}:${record.studySeconds}` : 'missing';
    }, { timeout: 20000, message: '学习记录应在心跳周期内落库并完成' }).toMatch(/^completed:/);
  });

  test('管理员统计页真实呈现看板数据（接口 200 且页面渲染）', async ({ page }) => {
    await adminLogin(page, ACCOUNTS.admin.username);
    await page.goto(`${ADMIN_BASE}/dashboard`);

    // 接口断言：真实调用统计概览（携带页面会话 token）
    const overview = await page.evaluate(async () => {
      const token = localStorage.getItem('adminToken');
      const res = await fetch('/api/admin/statistics', { headers: { Authorization: `Bearer ${token}` } });
      return { status: res.status, body: await res.json() };
    });
    expect(overview.status, '统计概览接口应返回 200').toBe(200);
    expect(overview.body.code).toBe(0);
    expect(overview.body.data).toBeTruthy();

    // 页面渲染断言：真实数据经浏览器渲染
    await expect(page.getByRole('heading', { name: '数据总览' })).toBeVisible();
    await expect(page.locator('.metric-card').first()).toBeVisible();
    await expect(page.getByTestId('stat-welcome')).toContainText('系统管理员');
  });
});
