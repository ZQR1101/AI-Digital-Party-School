// 第二轮安全回归测试：
// 1) 书记跨组织管理任务越权拦截（orgScopeService）
// 2) 首次学习时长上报增量上限
// 3) 上传文件魔数校验（伪造扩展名拒绝）
// 4) 富文本 HTML 白名单清洗（防存储型 XSS）
process.env.NODE_ENV = 'test';
process.env.QDRANT_ENABLED = 'false';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateReportedSeconds } = require('../src/services/studyDuration');
const { matchesFileSignature } = require('../src/utils/uploadSecurity');
const { sanitizeHtml } = require('../src/utils/sanitizeHtml');
const OrgScopeService = require('../src/services/orgScopeService');
const db = require('../src/config/db');

// ---------------- 1) 组织范围授权 ----------------

test('书记只能管理本组织及下级组织的任务', async t => {
  // 组织树：1(学校党委) -> 2(计算机学院) -> 4(学生支部)，1 -> 9(机关党委)
  t.mock.method(db, 'query', async () => [
    [
      { id: 1, parentId: null },
      { id: 2, parentId: 1 },
      { id: 4, parentId: 2 },
      { id: 9, parentId: 1 },
    ],
  ]);

  const secretary = { userId: 2, role: 'secretary', organizationId: 2 };
  const scope = await OrgScopeService.getScopedOrgIds(secretary);
  assert.deepEqual([...scope].sort((a, b) => a - b), [2, 4]);

  // 范围内放行
  assert.doesNotThrow(() => OrgScopeService.assertInScope(scope, [4]));
  // 越权组织拒绝且状态码 403
  try {
    OrgScopeService.assertInScope(scope, [9]);
    assert.fail('越权未被拦截');
  } catch (err) {
    assert.equal(err.statusCode, 403);
  }
  // 批量目标中混入越权组织同样拒绝
  assert.throws(() => OrgScopeService.assertInScope(scope, [4, 9]), { statusCode: 403 });
});

test('admin 不受组织范围限制；未归属组织的书记无法执行管理操作', async t => {
  const admin = { userId: 1, role: 'admin', organizationId: 1 };
  const adminScope = await OrgScopeService.getScopedOrgIds(admin);
  assert.equal(adminScope, null);
  assert.doesNotThrow(() => OrgScopeService.assertInScope(adminScope, [999]));

  const orphanSecretary = { userId: 7, role: 'secretary', organizationId: null };
  await assert.rejects(
    () => OrgScopeService.getScopedOrgIds(orphanSecretary),
    (err) => err.statusCode === 403
  );
});

test('任务路由与列表必须接入范围校验', () => {
  const fs = require('node:fs');
  const routeSource = fs.readFileSync(require.resolve('../src/routes/admin/tasks'), 'utf8');
  assert.match(routeSource, /assertScopeForTask/, '任务详情/修改/删除未校验归属组织');
  assert.match(routeSource, /assertScopeForOrgIds/, '发布任务未校验下发组织范围');
  assert.match(routeSource, /organizationIds: scopeIds/, '任务列表未按书记范围过滤');
  const serviceSource = fs.readFileSync(require.resolve('../src/services/taskService'), 'utf8');
  assert.match(serviceSource, /organizationIds/, '任务列表服务未支持组织范围参数');
  assert.match(serviceSource, /t\.organizationId IN/, '任务列表服务未支持组织范围过滤');
});

// ---------------- 2) 首次学习时长上报 ----------------

test('首次上报同样受单次增量上限约束', () => {
  // 首次上报允许的正常范围（不超过应学时长+60s 或 120s 下限）
  assert.equal(validateReportedSeconds({ reported: 100, previous: 0, requiredSeconds: 300, contentType: 'article' }), 100);
  assert.equal(validateReportedSeconds({ reported: 360, previous: 0, requiredSeconds: 300, contentType: 'article' }), 360);
  // 首次即暴增：超过 deltaCap(360) 直接拒绝
  assert.throws(
    () => validateReportedSeconds({ reported: 500, previous: 0, requiredSeconds: 300, contentType: 'article' }),
    { statusCode: 400 }
  );
  // 视频首次上报 30 分钟以内放行，超过拒绝
  assert.equal(validateReportedSeconds({ reported: 1800, previous: 0, contentType: 'video' }), 1800);
  assert.throws(
    () => validateReportedSeconds({ reported: 1900, previous: 0, contentType: 'video' }),
    { statusCode: 400 }
  );
});

// ---------------- 3) 上传文件魔数校验 ----------------

test('伪造扩展名的文件被魔数校验拒绝，真实媒体/表格放行', () => {
  // 把 PHP 木马改名成 .png —— 必须拒绝
  const fakePng = Buffer.concat([Buffer.from('<?php system($_GET["c"]); ?>'), Buffer.alloc(64, 0x41)]);
  assert.equal(matchesFileSignature(fakePng, 'avatar.png'), false);
  // 真实 PNG 头放行
  const realPng = Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.alloc(32)]);
  assert.equal(matchesFileSignature(realPng, 'avatar.png'), true);
  // JPEG 头放行
  const jpeg = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(32)]);
  assert.equal(matchesFileSignature(jpeg, 'cover.jpg'), true);
  // HTML 伪装成 .csv（含标签与 NUL 检测）——可解码文本放行（CSV 本就是文本）
  const csv = Buffer.from('username,realName,role\nlisi,李四,党员\n');
  assert.equal(matchesFileSignature(csv, 'users.csv'), true);
  // 二进制可执行内容伪装成 .csv —— NUL 字节拒绝
  const binCsv = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(100, 0)]);
  assert.equal(matchesFileSignature(binCsv, 'users.csv'), false);
  // xlsx 必须 PK zip 头
  const zipHead = Buffer.from([0x50, 0x4B, 0x03, 0x04, 0x14, 0x00]);
  assert.equal(matchesFileSignature(Buffer.concat([zipHead, Buffer.alloc(32)]), 'members.xlsx'), true);
  assert.equal(matchesFileSignature(fakePng, 'members.xlsx'), false);
  // webp RIFF 头
  const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(16)]);
  assert.equal(matchesFileSignature(webp, 'img.webp'), true);
});

test('内容上传与人员导入路由已接入魔数校验', () => {
  const fs = require('node:fs');
  const contentsRoute = fs.readFileSync(require.resolve('../src/routes/admin/contents'), 'utf8');
  assert.match(contentsRoute, /assertFileSignature/, '内容上传未做文件头校验');
  const usersRoute = fs.readFileSync(require.resolve('../src/routes/admin/users'), 'utf8');
  assert.match(usersRoute, /assertFileSignature/, '人员导入未做文件头校验');
});

// ---------------- 4) 富文本 HTML 清洗 ----------------

test('HTML 清洗：移除脚本与事件属性，保留安全结构', () => {
  const dirty = [
    '<p onclick="alert(1)">正常段落</p>',
    '<script>fetch("//evil.com")</script>',
    '<img src="x" onerror="alert(1)">',
    '<a href="javascript:alert(1)">链接</a>',
    '<style>body{}</style>',
    '<iframe src="//evil.com"></iframe>',
    '<strong>重点</strong>',
  ].join('');

  const clean = sanitizeHtml(dirty);
  assert.equal(clean.includes('<script'), false, 'script 未移除');
  assert.equal(clean.includes('fetch'), false, 'script 内容未移除');
  assert.equal(clean.includes('onerror'), false, 'onerror 属性未移除');
  assert.equal(clean.includes('onclick'), false, 'onclick 属性未移除');
  assert.equal(clean.includes('javascript:'), false, 'javascript: URL 未移除');
  assert.equal(clean.includes('<iframe'), false, 'iframe 未移除');
  assert.equal(clean.includes('<style'), false, 'style 未移除');
  assert.ok(clean.includes('<p>正常段落</p>'), '安全段落被误删');
  assert.ok(clean.includes('<strong>重点</strong>'), '安全标签被误删');
  // img 的 src 保留（http 来源），事件属性剔除
  assert.match(clean, /<img src="x"[^>]*>/, 'img 标签丢失');
  assert.equal(clean.match(/<img[^>]*>/)[0].includes('onerror'), false);
});

test('data: URL 仅放行图片，其他协议一律拒绝', () => {
  const ok = sanitizeHtml('<img src="data:image/png;base64,iVBOR">');
  assert.ok(ok.includes('data:image/png;base64'), 'data:image 被误杀');
  const bad = sanitizeHtml('<a href="data:text/html;base64,PHNjcmlwdD4=">x</a>');
  assert.equal(bad.includes('data:text/html'), false, 'data:text/html 未拦截');
});

test('内容服务入库前对文章正文做清洗（video 不动）', async t => {
  const ContentService = require('../src/services/contentService');
  const captured = [];
  t.mock.method(db, 'query', async (sql, params) => {
    if (/^INSERT INTO contents/.test(sql)) {
      captured.push({ sql, params });
      return [{ insertId: 1 }];
    }
    if (/SELECT type FROM contents/.test(sql)) {
      return [{ type: 'article' }];
    }
    return [[]];
  });

  await ContentService.create({
    title: 'xss 测试', type: 'article',
    bodyOrVideoUrl: '<p>正文</p><script>alert(1)</script>',
  });
  const stored = captured[0].params[3];
  assert.equal(stored.includes('<script'), false, '入库正文仍含 script');

  // video 类型的 URL 不被清洗改动
  await ContentService.create({
    title: '视频', type: 'video',
    bodyOrVideoUrl: '/uploads/content/a.mp4?width=16&height=9',
  });
  assert.equal(captured[1].params[3], '/uploads/content/a.mp4?width=16&height=9');
});
