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

test('P0: 组织 ID 失效（后代为空）时不得解释为无限制', async t => {
  // 书记的组织 ID 已失效：组织表里查不到，getDescendantIds 返回空数组
  t.mock.method(db, 'query', async () => [[{ id: 1, parentId: null }]]);
  const ghostSecretary = { userId: 7, role: 'secretary', organizationId: 7 };
  await assert.rejects(
    () => OrgScopeService.getScopedOrgIds(ghostSecretary),
    (err) => err.statusCode === 403
  );

  // 纵深防御：即使空数组传到列表服务，也必须返回空列表而不是全量
  const TaskService = require('../src/services/taskService');
  t.mock.method(db, 'query', async () => {
    throw new Error('空范围不应触发任何 SQL 查询');
  });
  const result = await TaskService.list({ page: 1, pageSize: 10, organizationIds: [] });
  assert.deepEqual(result, { total: 0, list: [] }, '空组织范围被解释成了无限制');
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

// ---------------- 2) 学习时长真实性：服务端经过时间约束 ----------------

test('首次上报最多计入 60 秒，无论客户端报多少', () => {
  const { creditableSeconds } = require('../src/services/studyDuration');
  // 首次上报 100s -> 只计入 60s
  assert.equal(creditableSeconds({ requestedDelta: 100, isFirstReport: true }), 60);
  // 首次直接报满 300s（required=300）-> 仍只计入 60s，无法刷满
  assert.equal(creditableSeconds({ requestedDelta: 300, isFirstReport: true, contentType: 'article', requiredSeconds: 300 }), 60);
  // 首次上报 3s（正常心跳）-> 全额计入
  assert.equal(creditableSeconds({ requestedDelta: 3, isFirstReport: true }), 3);
});

test('有服务端基线后，可计入时长受真实经过时间限制', () => {
  const { creditableSeconds } = require('../src/services/studyDuration');
  // 服务端只经过 10 秒，客户端却报增量 300 -> 只计入 40s（10+30 宽限）
  assert.equal(creditableSeconds({ requestedDelta: 300, serverElapsedSeconds: 10, contentType: 'article', requiredSeconds: 300 }), 40);
  // 服务端经过 600 秒，报 300 -> 全额计入（不超 deltaCap 360）
  assert.equal(creditableSeconds({ requestedDelta: 300, serverElapsedSeconds: 600, contentType: 'article', requiredSeconds: 300 }), 300);
  // 视频单次计入上限 30 分钟
  assert.equal(creditableSeconds({ requestedDelta: 1900, serverElapsedSeconds: 3600, contentType: 'video' }), 1800);
  // 负数/NaN 增量安全处理
  assert.equal(creditableSeconds({ requestedDelta: -5, isFirstReport: true }), 0);
  assert.equal(creditableSeconds({ requestedDelta: 'abc', isFirstReport: true }), 0);
});

test('提交学习记录：首次刷满被拒计入，视频 1 秒不能标记学完', async t => {
  const LearningRecordService = require('../src/services/learningRecordService');
  const state = { rows: [], writes: [] };
  t.mock.method(db, 'query', async (sql, params) => {
    if (sql.includes('FROM learning_tasks')) {
      return [[{ organizationId: 4, taskStatus: 'published', contentType: 'article', title: 'x', summary: '', bodyOrVideoUrl: 'x'.repeat(2000) }]];
    }
    if (sql.includes('FROM users WHERE id')) return [[{ organizationId: 4 }]];
    if (sql.includes('SELECT id, parentId FROM organizations')) return [[{ id: 4, parentId: null }]];
    if (sql.includes('FROM learning_records WHERE')) return [state.rows];
    if (/^UPDATE learning_records/.test(sql)) {
      state.writes.push({ sql, params });
      state.rows = [{ id: 1, status: params[2], studySeconds: params[0], lastActiveAt: params[1] }];
      return [{ affectedRows: 1 }];
    }
    if (/^INSERT INTO learning_records/.test(sql)) {
      state.writes.push({ sql, params });
      state.rows = [{ id: 1, status: params[4], studySeconds: params[2], lastActiveAt: params[3] }];
      return [{ insertId: 1 }];
    }
    throw new Error('意外 SQL: ' + sql.slice(0, 60));
  });

  // 首次直接上报 300s（应学约 400s）：只计入 60s，不得完成
  const first = await LearningRecordService.submit(3, { taskId: 5, studySeconds: 300, completed: true });
  assert.equal(first.creditedSeconds, 60);
  assert.notEqual(first.status, 'completed', '首次上报不允许直接学完');

  // 视频任务：首次上报 1 秒 + completed=true，不能标记学完
  db.query.mock.restore();
  const state2 = { rows: [], writes: [] };
  t.mock.method(db, 'query', async (sql, params) => {
    if (sql.includes('FROM learning_tasks')) {
      return [[{ organizationId: 4, taskStatus: 'published', contentType: 'video', title: 'v', summary: '', bodyOrVideoUrl: '/v.mp4' }]];
    }
    if (sql.includes('FROM users WHERE id')) return [[{ organizationId: 4 }]];
    if (sql.includes('SELECT id, parentId FROM organizations')) return [[{ id: 4, parentId: null }]];
    if (sql.includes('FROM learning_records WHERE')) return [state2.rows];
    if (/^UPDATE learning_records/.test(sql)) { state2.writes.push(params); state2.rows = [{ id: 1, status: params[2], studySeconds: params[0], lastActiveAt: params[1] }]; return [{ affectedRows: 1 }]; }
    if (/^INSERT INTO learning_records/.test(sql)) { state2.writes.push(params); state2.rows = [{ id: 1, status: params[4], studySeconds: params[2], lastActiveAt: params[3] }]; return [{ insertId: 1 }]; }
    throw new Error('意外 SQL: ' + sql.slice(0, 60));
  });
  const video = await LearningRecordService.submit(3, { taskId: 6, studySeconds: 1, completed: true });
  assert.notEqual(video.status, 'completed', '视频 1 秒不允许标记学完');
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

// ---------------- 5) 表格导入：exceljs/CSV 替代 SheetJS ----------------

test('表格解析：exceljs 读取 xlsx、内置解析 csv（含引号转义）', async () => {
  const ExcelJS = require('exceljs');
  const { parseSheetRows, parseCsvRows } = require('../src/utils/sheetImport');

  // xlsx：exceljs 生成 -> parseSheetRows 读取
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('人员');
  ws.addRow(['用户名', '姓名', '角色', '组织ID']);
  ws.addRow(['lisi', '李四', '党员', 4]);
  const xlsxBuffer = Buffer.from(await wb.xlsx.writeBuffer());
  const rows = await parseSheetRows(xlsxBuffer, 'members.xlsx');
  assert.equal(rows.length, 1);
  assert.equal(rows[0]['用户名'], 'lisi');
  assert.equal(rows[0]['姓名'], '李四');

  // csv：BOM、引号内逗号与转义引号
  const csv = '\uFEFFusername,realName,role\n"wang,""wu"",x",王五,党员\n';
  const csvRows = parseCsvRows(Buffer.from(csv));
  assert.equal(csvRows.length, 1);
  assert.equal(csvRows[0].username, 'wang,"wu",x');
  assert.equal(csvRows[0].realName, '王五');

  // 路由已切换到 exceljs，xlsx 库彻底移除
  const routeSource = require('fs').readFileSync(require.resolve('../src/routes/admin/users'), 'utf8');
  assert.doesNotMatch(routeSource, /require\('xlsx'\)/, '路由仍引用已弃用的 xlsx 库');
  assert.match(routeSource, /parseSheetRows/, '路由未接入统一表格解析');
});
