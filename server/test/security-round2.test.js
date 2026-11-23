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

// ---------------- 2) 学习时长真实性：累计时长受服务端会话总经过时间约束 ----------------

test('一次性宽限 + 会话记账：会话内快速连续请求无法重复领取宽限，跨会话合法累计叠加', () => {
  const { creditableSeconds, ONE_TIME_ALLOWANCE } = require('../src/services/studyDuration');
  // 会话刚建立（基线 0，经过 0s）：首次上报 300s 只计入一次性宽限 60s
  assert.equal(creditableSeconds({ requestedDelta: 300, prevSeconds: 0, sessionBaseSeconds: 0, sessionElapsedSeconds: 0 }), ONE_TIME_ALLOWANCE);
  // 紧接着 1s 后再次上报：本会话上限 0+1+60=61，已计入 60 -> 只加 1s（宽限不可重复领取）
  assert.equal(creditableSeconds({ requestedDelta: 300, prevSeconds: 60, sessionBaseSeconds: 0, sessionElapsedSeconds: 1 }), 1);
  assert.equal(creditableSeconds({ requestedDelta: 300, prevSeconds: 61, sessionBaseSeconds: 0, sessionElapsedSeconds: 2 }), 1);
  // 真实学习 297s 后（elapsed=300, prev=63）：计入到 360 上限内 -> 加 297
  assert.equal(creditableSeconds({ requestedDelta: 297, prevSeconds: 63, sessionBaseSeconds: 0, sessionElapsedSeconds: 300 }), 297);
  // 隔天新会话（基线快照为昨日累计 100）：新宽限 60s 可用，昨日累计不被清零也不卡死
  assert.equal(creditableSeconds({ requestedDelta: 100, prevSeconds: 100, sessionBaseSeconds: 100, sessionElapsedSeconds: 0 }), 60);
  // 新会话学习 100s 后：可计入至 100+100+60 上限
  assert.equal(creditableSeconds({ requestedDelta: 100, prevSeconds: 160, sessionBaseSeconds: 100, sessionElapsedSeconds: 100 }), 100);
});

test('单次计入受 deltaCap 限制（视频 30 分钟、文章应学+60s），非法增量安全处理', () => {
  const { creditableSeconds, deltaCapSeconds } = require('../src/services/studyDuration');
  assert.equal(deltaCapSeconds({ contentType: 'video' }), 1800);
  assert.equal(deltaCapSeconds({ contentType: 'article', requiredSeconds: 300 }), 360);
  // 长时间挂起后会话经过 3600s，单次也最多计入 deltaCap
  assert.equal(creditableSeconds({ requestedDelta: 1900, prevSeconds: 0, sessionElapsedSeconds: 3600, deltaCapSeconds: 1800 }), 1800);
  assert.equal(creditableSeconds({ requestedDelta: 500, prevSeconds: 0, sessionElapsedSeconds: 3600, deltaCapSeconds: 360 }), 360);
  // 非法增量安全处理
  assert.equal(creditableSeconds({ requestedDelta: -5, prevSeconds: 0 }), 0);
  assert.equal(creditableSeconds({ requestedDelta: 'abc', prevSeconds: 0 }), 0);
});

/** 事务连接 mock：query 走统一分发，事务方法空实现 */
function makeFakeConn(dispatch) {
  return {
    query: dispatch,
    beginTransaction: async () => {},
    commit: async () => {},
    rollback: async () => {},
    release: () => {},
  };
}

function mockTaskQueries(t, state, taskRow) {
  t.mock.method(db, 'query', async (sql) => {
    if (sql.includes('FROM learning_tasks')) return [[taskRow]];
    if (sql.includes('FROM users WHERE id')) return [[{ organizationId: 4 }]];
    if (sql.includes('SELECT id, parentId FROM organizations')) return [[{ id: 4, parentId: null }]];
    throw new Error('意外 SQL: ' + sql.slice(0, 60));
  });
  t.mock.method(db, 'getConnection', async () => makeFakeConn(async (sql, params) => {
    if (sql.includes('FROM learning_records WHERE')) return [state.rows];
    if (/^UPDATE learning_records/.test(sql)) {
      state.writes.push(params);
      state.rows = [{ id: 1, status: params[4], studySeconds: params[0], lastActiveAt: params[1], sessionStartedAt: params[2], sessionBaseSeconds: params[3] }];
      return [{ affectedRows: 1 }];
    }
    if (/^INSERT INTO learning_records/.test(sql)) {
      state.writes.push(params);
      state.rows = [{ id: 1, status: params[6], studySeconds: params[2], lastActiveAt: params[3], sessionStartedAt: params[4], sessionBaseSeconds: params[5] }];
      return [{ insertId: 1 }];
    }
    throw new Error('意外 SQL: ' + sql.slice(0, 60));
  }));
}

test('提交学习记录：首次刷满只计宽限，快速二连发不再领取宽限', async t => {
  const LearningRecordService = require('../src/services/learningRecordService');
  const state = { rows: [], writes: [] };
  mockTaskQueries(t, state, { organizationId: 4, taskStatus: 'published', contentType: 'article', title: 'x', summary: '', bodyOrVideoUrl: 'x'.repeat(2000) });

  // 首次直接上报 300s（应学约 400s）：只计入 60s 宽限，不得完成
  const first = await LearningRecordService.submit(3, { taskId: 5, studySeconds: 300, completed: true });
  assert.equal(first.creditedSeconds, 60);
  assert.notEqual(first.status, 'completed', '首次上报不允许直接学完');

  // 紧接着第二次请求仍报 300s：会话经过 ≈0s，宽限已一次性发放 -> 几乎不再计入
  const second = await LearningRecordService.submit(3, { taskId: 5, studySeconds: 300, completed: true });
  assert.ok(second.creditedSeconds <= 1, `快速二连发不应再领取宽限（实际计入 ${second.creditedSeconds}s）`);
  assert.notEqual(second.status, 'completed');
});

test('视频任务：首次上报 1 秒 + completed=true，不能标记学完', async t => {
  const LearningRecordService = require('../src/services/learningRecordService');
  const state2 = { rows: [], writes: [] };
  mockTaskQueries(t, state2, { organizationId: 4, taskStatus: 'published', contentType: 'video', durationSeconds: null, title: 'v', summary: '', bodyOrVideoUrl: '/v.mp4' });
  const video = await LearningRecordService.submit(3, { taskId: 6, studySeconds: 1, completed: true });
  assert.notEqual(video.status, 'completed', '视频 1 秒不允许标记学完');
});

test('视频完成门槛关联真实时长：10 分钟视频首次报 60s+completed 不能完成', async t => {
  const { videoRequiredSeconds } = require('../src/services/studyDuration');
  assert.equal(videoRequiredSeconds({ durationSeconds: 600 }), 540);
  assert.equal(videoRequiredSeconds({ durationSeconds: null }), 60, '未知时长走保守回退');

  const LearningRecordService = require('../src/services/learningRecordService');
  const state = { rows: [], writes: [] };
  mockTaskQueries(t, state, { organizationId: 4, taskStatus: 'published', contentType: 'video', durationSeconds: 600, title: 'v', summary: '', bodyOrVideoUrl: '/v.mp4' });
  const first = await LearningRecordService.submit(3, { taskId: 7, studySeconds: 60, completed: true });
  assert.notEqual(first.status, 'completed', '首次请求伪造 completed 不能完成 10 分钟视频');
  assert.equal(first.creditedSeconds, 60);

  // 短视频（30s）真实看完：计入达标后可正常完成
  const state3 = { rows: [], writes: [] };
  db.getConnection.mock.restore();
  db.query.mock.restore();
  mockTaskQueries(t, state3, { organizationId: 4, taskStatus: 'published', contentType: 'video', durationSeconds: 30, title: 'v', summary: '', bodyOrVideoUrl: '/v.mp4' });
  const done = await LearningRecordService.submit(3, { taskId: 8, studySeconds: 60, completed: true });
  assert.equal(done.status, 'completed', '短视频看完后应正常完成');
});

test('会话闲置超时：隔天回来建立新会话，离线墙钟时间不计入上限', async t => {
  const { SESSION_IDLE_TIMEOUT_SECONDS } = require('../src/services/studyDuration');
  assert.equal(SESSION_IDLE_TIMEOUT_SECONDS, 300);
  const LearningRecordService = require('../src/services/learningRecordService');
  const HOUR = 3600 * 1000;
  const state = {
    rows: [{
      id: 9,
      status: 'inProgress',
      studySeconds: 120,
      lastActiveAt: new Date(Date.now() - HOUR),          // 1 小时前最后心跳
      sessionStartedAt: new Date(Date.now() - 24 * HOUR), // 昨天建立的会话
    }],
    writes: [],
  };
  mockTaskQueries(t, state, { organizationId: 4, taskStatus: 'published', contentType: 'article', title: 'x', summary: '', bodyOrVideoUrl: 'x'.repeat(2000) });

  const result = await LearningRecordService.submit(3, { taskId: 5, studySeconds: 300, completed: false });
  // 新会话：离线的 1 小时不可计入，仅发放一次性宽限 60s
  assert.equal(result.creditedSeconds, 60, '闲置超时后应建立新会话，只发一次性宽限');
  assert.equal(result.studySeconds, 180, '已获合法累计时长应保留');
  assert.notEqual(result.status, 'completed');
  // sessionStartedAt 已重置为当前时间（UPDATE params[2]）
  const writtenStart = new Date(state.writes[0][2]).getTime();
  assert.ok(Math.abs(Date.now() - writtenStart) < 5000, '新会话开始时间应为提交时刻');
});

test('旧数据无 sessionStartedAt 时回溯最近心跳重建会话（每行一次性）', async t => {
  const LearningRecordService = require('../src/services/learningRecordService');
  const state = {
    rows: [{
      id: 10,
      status: 'inProgress',
      studySeconds: 60,
      lastActiveAt: new Date(Date.now() - 10 * 1000), // 10 秒前心跳
      sessionStartedAt: null,                          // 旧数据无会话列
      sessionBaseSeconds: null,
    }],
    writes: [],
  };
  mockTaskQueries(t, state, { organizationId: 4, taskStatus: 'published', contentType: 'article', title: 'x', summary: '', bodyOrVideoUrl: 'x'.repeat(2000) });

  const result = await LearningRecordService.submit(3, { taskId: 5, studySeconds: 300, completed: false });
  // 重建会话：基线=60、起点=10s 前心跳，上限 60+10+60=130 -> 计入 70（重建宽限仅此一次）
  assert.equal(result.creditedSeconds, 70);
  assert.equal(result.studySeconds, 130);
  // 重建后基线与开始时间已持久化，之后走正常会话判定
  assert.equal(state.writes[0][3], 60);
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
