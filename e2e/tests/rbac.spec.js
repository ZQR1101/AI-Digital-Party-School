// RBAC 与组织范围隔离：前端按钮隐藏不能替代后端验证，这里在真实浏览器会话中直接验证后端行为
import { test, expect } from '@playwright/test';
import { ADMIN_BASE, MEMBER_BASE, ACCOUNTS, E2E_PREFIX } from '../helpers/env.mjs';
import { adminLogin, memberLogin, TEST_PASSWORD } from '../helpers/login.mjs';
import { query, queryOne } from '../helpers/db.mjs';

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

test.describe('未登录访问防护', () => {
  test('未登录访问管理后台任务页被重定向到登录页', async ({ page }) => {
    await page.goto(`${ADMIN_BASE}/tasks`);
    await page.waitForURL(/\/login/);
    await expect(page.getByTestId('admin-login-submit')).toBeVisible();
  });

  test('未登录直连后端受保护接口返回 401', async ({ page }) => {
    await page.goto(`${ADMIN_BASE}/login`);
    const res = await fetchAsUser(page, '/api/admin/users');
    expect(res.status).toBe(401);
  });
});

test.describe('角色权限（后端强制，而非仅前端隐藏）', () => {
  test('普通党员持有效 token 直连管理员接口被 403 拒绝', async ({ page }) => {
    await memberLogin(page, ACCOUNTS.member.username);

    const users = await fetchAsUser(page, '/api/admin/users');
    expect(users.status).toBe(403);

    const adminTasks = await fetchAsUser(page, '/api/admin/tasks', { method: 'POST', body: JSON.stringify({ title: '越权任务', contentId: 9999, organizationIds: [4], deadline: '2026-12-31' }) });
    expect(adminTasks.status).toBe(403);
  });

  test('支部书记持有效 token 访问人员管理等管理员专属接口被 403 拒绝', async ({ page }) => {
    await adminLogin(page, ACCOUNTS.secretary.username);
    const res = await fetchAsUser(page, '/api/admin/users');
    expect(res.status).toBe(403);
  });

  test('支部书记创建任务引用范围外组织被后端拒绝', async ({ page }) => {
    await adminLogin(page, ACCOUNTS.secretary.username);
    // org 9（机关党委）在书记（组织 4）范围之外
    const res = await fetchAsUser(page, '/api/admin/tasks', {
      method: 'POST',
      body: JSON.stringify({ title: `${E2E_PREFIX}越权组织任务`, contentId: 1, organizationIds: [9], deadline: '2026-12-31' }),
    });
    expect([400, 403, 422]).toContain(res.status);

    // 确认越权任务未落库
    const row = await queryOne('SELECT id FROM learning_tasks WHERE title = ?', [`${E2E_PREFIX}越权组织任务`]);
    expect(row).toBeFalsy();
  });
});

test.describe('组织管理写权限（真实 HTTP 层，书记只读、写操作仅管理员）', () => {
  test('书记对组织新增/修改/删除全部 403，且数据库状态不变', async ({ page }) => {
    await adminLogin(page, ACCOUNTS.secretary.username);

    const countBefore = await queryOne('SELECT COUNT(*) AS c FROM organizations');
    const target = await queryOne('SELECT id, name FROM organizations WHERE id = 4');

    const post = await fetchAsUser(page, '/api/admin/organizations', {
      method: 'POST',
      body: JSON.stringify({ name: `${E2E_PREFIX}越权新增组织`, type: 'group', parentId: 4 }),
    });
    expect(post.status, '书记新增组织应被 403 拒绝').toBe(403);

    const put = await fetchAsUser(page, `/api/admin/organizations/${target.id}`, {
      method: 'PUT',
      body: JSON.stringify({ name: `${E2E_PREFIX}越权改名组织` }),
    });
    expect(put.status, '书记修改组织应被 403 拒绝').toBe(403);

    const del = await fetchAsUser(page, `/api/admin/organizations/${target.id}`, { method: 'DELETE' });
    expect(del.status, '书记删除组织应被 403 拒绝').toBe(403);

    // 数据库零变化：行数一致、目标组织未被篡改、越权新增未落库
    const countAfter = await queryOne('SELECT COUNT(*) AS c FROM organizations');
    expect(Number(countAfter.c)).toBe(Number(countBefore.c));
    const unchanged = await queryOne('SELECT name FROM organizations WHERE id = ?', [target.id]);
    expect(unchanged.name).toBe(target.name);
    expect(await queryOne('SELECT id FROM organizations WHERE name = ?', [`${E2E_PREFIX}越权新增组织`])).toBeFalsy();
  });

  test('管理员组织新增/删除正常并真实落库/清除', async ({ page }) => {
    await adminLogin(page, ACCOUNTS.admin.username);
    const name = `${E2E_PREFIX}临时组织-${Date.now()}`;

    const created = await fetchAsUser(page, '/api/admin/organizations', {
      method: 'POST',
      body: JSON.stringify({ name, type: 'group', parentId: 4 }),
    });
    expect(created.status, '管理员新增组织应成功').toBeLessThan(300);
    const row = await queryOne('SELECT id FROM organizations WHERE name = ?', [name]);
    expect(row, '新增组织应真实落库').toBeTruthy();

    const del = await fetchAsUser(page, `/api/admin/organizations/${row.id}`, { method: 'DELETE' });
    expect(del.status, '管理员删除组织应成功').toBeLessThan(300);
    expect(await queryOne('SELECT id FROM organizations WHERE id = ?', [row.id])).toBeFalsy();
  });

  test('普通党员读取组织管理资源仍被 403 拒绝', async ({ page }) => {
    await memberLogin(page, ACCOUNTS.member.username);
    const res = await fetchAsUser(page, '/api/admin/organizations');
    expect(res.status).toBe(403);
  });
});

test.describe('组织范围数据隔离', () => {
  test('书记任务列表仅呈现本组织范围数据（越权范围任务不可见）', async ({ page }) => {
    await adminLogin(page, ACCOUNTS.secretary.username);
    await page.goto(`${ADMIN_BASE}/tasks`);
    await page.waitForLoadState('networkidle');

    // 数据库中若存在范围外任务，书记的列表必须不包含它
    const outOfScope = await queryOne(
      `SELECT id, title FROM learning_tasks WHERE organizationId = 9 LIMIT 1`
    );
    const rows = await page.evaluate(() => Array.from(document.querySelectorAll('.el-table__row')).map((r) => r.textContent));
    if (outOfScope) {
      expect(rows.join('')).not.toContain(outOfScope.title);
    }
    // 本支部的 E2E 任务应可见（由种子/前序用例创建）
    const inScope = await queryOne(`SELECT title FROM learning_tasks WHERE organizationId = 4 ORDER BY id DESC LIMIT 1`);
    if (inScope) {
      expect(rows.join('')).toContain(inScope.title);
    }
  });

  test('党员只能看到本组织范围下发的任务', async ({ page }) => {
    await memberLogin(page, ACCOUNTS.memberOtherOrg.username); // wangwu：组织 5（学生第一党支部下属党小组）
    await page.goto(`${MEMBER_BASE}/#/tasks`);
    await page.waitForLoadState('networkidle');

    // 王五属于支部 4 下的小组 5，可看到支部 4 的任务（祖先链下发）；机关党委（9）的任务不可见
    const rows = await page.evaluate(() => document.body.innerText);
    const org9Tasks = await query(`SELECT title FROM learning_tasks WHERE organizationId = 9`);
    for (const t of org9Tasks) {
      expect(rows).not.toContain(t.title);
    }
  });
});

test.describe('停用账号旧 token 失效', () => {
  test('停用账号即使持有旧 token 也被实时拒绝并踢回登录页', async ({ page }) => {
    const username = ACCOUNTS.memberDisabled.username;
    await memberLogin(page, username);

    // 停用账号（模拟管理员封禁，旧 token 仍然有效）
    await query('UPDATE users SET status = 0 WHERE username = ?', [username]);
    try {
      await page.goto(`${MEMBER_BASE}/#/home`);
      await page.waitForURL(/#\/login/, { timeout: 20000 });
      const token = await page.evaluate(() => localStorage.getItem('mobileToken'));
      expect(token, '停用后旧 token 应被前端清除').toBeFalsy();
    } finally {
      await query('UPDATE users SET status = 1 WHERE username = ?', [username]);
    }
  });
});
