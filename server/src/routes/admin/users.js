const express = require('express');
const router = express.Router();
const multer = require('multer');
const XLSX = require('xlsx');
const UserService = require('../../services/userService');
const ResponseHelper = require('../../utils/response');
const { sheetFileFilter, assertFileSignature } = require('../../utils/uploadSecurity');
const { authenticate, loadCurrentUser, requireAdmin, requireManager } = require('../../middleware/auth');

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: sheetFileFilter,
  limits: { fileSize: 10 * 1024 * 1024, files: 1 }
});

router.use(authenticate, loadCurrentUser, requireAdmin);

function normalizeImportedRole(role) {
  const raw = String(role || 'member').trim();
  const map = {
    member: 'member',
    secretary: 'secretary',
    admin: 'admin',
    党员: 'member',
    支部书记: 'secretary',
    书记: 'secretary',
    系统管理员: 'admin',
    管理员: 'admin',
  };
  return map[raw] || map[raw.toLowerCase()] || 'member';
}

/**
 * GET /api/admin/users
 * 分页查询人员列表，支持按组织筛选
 */
router.get('/', async (req, res) => {
  try {
    const { page = 1, pageSize = 10, keyword, organizationId, role } = req.query;
    const result = await UserService.list({
      page: Number(page), pageSize: Number(pageSize), keyword, organizationId, role
    });
    return ResponseHelper.page(res, result.list, result.total);
  } catch (err) {
    console.error('List users error:', err);
    return ResponseHelper.error(res);
  }
});

/**
 * POST /api/admin/users/import
 * 批量导入（Excel/CSV）
 */
router.post('/import', (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) return ResponseHelper.badRequest(res, err.message || '文件上传失败');
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) return ResponseHelper.badRequest(res, '请上传文件');
    // 魔数校验：拒绝把脚本/可执行文件伪装成表格上传
    try {
      assertFileSignature(req.file.buffer, req.file.originalname);
    } catch (sigErr) {
      const statusCode = sigErr && sigErr.statusCode ? sigErr.statusCode : 400;
      return ResponseHelper.error(res, sigErr.message || '文件内容校验失败', statusCode, statusCode);
    }

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(sheet);

    const users = data.map(row => ({
      username: String(row['用户名'] || row['username'] || '').trim(),
      realName: String(row['姓名'] || row['realName'] || '').trim(),
      role: normalizeImportedRole(row['角色'] || row['role'] || 'member'),
      organizationId: row['组织ID'] || row['organizationId'] || null,
      phone: String(row['手机号'] || row['phone'] || '').trim() || null,
      email: String(row['邮箱'] || row['email'] || '').trim() || null,
    })).filter(u => u.username && u.realName);

    if (users.length === 0) {
      return ResponseHelper.badRequest(res, '未解析到有效数据，请检查文件格式');
    }

    const result = await UserService.batchImport(users);
    return ResponseHelper.success(res, result, `导入完成：成功 ${result.success} 条，失败 ${result.fail} 条`);
  } catch (err) {
    console.error('Import users error:', err);
    return ResponseHelper.error(res);
  }
});

/**
 * GET /api/admin/users/:id
 */
router.get('/:id', async (req, res) => {
  try {
    const user = await UserService.getById(req.params.id);
    if (!user) return ResponseHelper.notFound(res, '用户不存在');
    return ResponseHelper.success(res, user);
  } catch (err) {
    return ResponseHelper.error(res);
  }
});

/**
 * POST /api/admin/users
 * 新增党员账号
 */
router.post('/', async (req, res) => {
  try {
    const { username, password, realName, role, organizationId, phone, email } = req.body;
    if (!username || !realName) {
      return ResponseHelper.badRequest(res, '用户名和姓名为必填项');
    }
    const id = await UserService.create({ username, password, realName, role, organizationId, phone, email });
    return ResponseHelper.success(res, { id }, '创建成功');
  } catch (err) {
    console.error('Create user error:', err);
    if (err.code === 'ER_DUP_ENTRY') {
      return ResponseHelper.badRequest(res, '用户名已存在');
    }
    return ResponseHelper.error(res);
  }
});

/**
 * PUT /api/admin/users/:id
 * 编辑人员信息
 */
router.put('/:id', async (req, res) => {
  try {
    const user = await UserService.getById(req.params.id);
    if (!user) return ResponseHelper.notFound(res, '用户不存在');
    await UserService.update(req.params.id, req.body);
    return ResponseHelper.success(res, null, '更新成功');
  } catch (err) {
    console.error('Update user error:', err);
    return ResponseHelper.error(res);
  }
});

/**
 * DELETE /api/admin/users/:id
 * 删除人员
 */
router.delete('/:id', async (req, res) => {
  try {
    const user = await UserService.getById(req.params.id);
    if (!user) return ResponseHelper.notFound(res, '用户不存在');
    await UserService.delete(req.params.id);
    return ResponseHelper.success(res, null, '删除成功');
  } catch (err) {
    return ResponseHelper.error(res);
  }
});

module.exports = router;
