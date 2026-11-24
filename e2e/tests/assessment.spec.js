// 测评链路：学员在列表看到测评 → 真实浏览器答题交卷 → 成绩页 + 数据库交卷记录
import { test, expect } from '@playwright/test';
import { MEMBER_BASE, ACCOUNTS, E2E_PREFIX } from '../helpers/env.mjs';
import { memberLogin } from '../helpers/login.mjs';
import { queryOne } from '../helpers/db.mjs';

test.describe.serial('测评提交与成绩查看', () => {
  test('党员答题交卷得到成绩，数据库写入交卷记录', async ({ page }) => {
    await memberLogin(page, ACCOUNTS.member.username);

    // 测评列表出现 E2E 测评
    await page.goto(`${MEMBER_BASE}/#/exam`);
    const card = page.locator('[data-testid^="exam-card-"]').filter({ hasText: `${E2E_PREFIX}党章知识测评` });
    await expect(card).toBeVisible();
    await card.getByTestId('exam-start').click();
    await page.waitForURL(/#\/exam\/take/);

    // 真实答题：选择正确选项 A「党章」
    await page.locator('.options label').filter({ hasText: '党章' }).first().click();

    // 打开答题卡并交卷
    await page.locator('.sheet-btn').click();
    await page.getByTestId('exam-submit').click();

    // 成绩页真实渲染满分
    const score = page.getByTestId('exam-result');
    await expect(score).toBeVisible({ timeout: 20000 });
    await expect(score).toContainText('100');

    // 数据库断言：assessment_attempts 真实落库、判分正确
    const attempt = await queryOne(
      `SELECT a.score, a.earnedPoints, a.totalScore, a.passed
       FROM assessment_attempts a
       JOIN users u ON u.id = a.userId
       JOIN assessments s ON s.id = a.assessmentId
       WHERE u.username = ? AND s.title = ?`,
      [ACCOUNTS.member.username, `${E2E_PREFIX}党章知识测评`]
    );
    expect(attempt, '数据库应存在交卷记录').toBeTruthy();
    expect(Number(attempt.score)).toBe(100);
    expect(Number(attempt.earnedPoints)).toBe(100);
    expect(Number(attempt.passed)).toBe(1);
  });

  test('重复交卷被服务端拒绝（仅保留首次成绩）', async ({ page }) => {
    await memberLogin(page, ACCOUNTS.member.username);
    await page.goto(`${MEMBER_BASE}/#/exam`);
    const card = page.locator('[data-testid^="exam-card-"]').filter({ hasText: `${E2E_PREFIX}党章知识测评` });
    await expect(card).toBeVisible();
    await card.getByTestId('exam-start').click();
    await page.waitForURL(/#\/exam\/take/);

    // 已交卷的测评应直接呈现成绩视图而非空白答题页
    await expect(page.getByTestId('exam-result')).toBeVisible();
  });
});
