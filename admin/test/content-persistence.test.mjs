import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { clearContentDraft, loadContentDraft, saveContentDraft } from '../src/utils/contentDraft.js'
import { formatBeijingDateTime } from '../src/utils/dateTime.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

test('管理后台使用真实登录接口', () => {
  const source = readFileSync(join(root, 'src/views/LoginView.vue'), 'utf8')
  assert.match(source, /request\.post\(['"]\/auth\/login['"]/, '登录页仍未调用真实后端')
  assert.doesNotMatch(source, /mock-token/, '登录页仍在写入Mock token')
})

test('学习内容发布写入后端并包含公共内容字段', () => {
  const source = readFileSync(join(root, 'src/views/ContentsView.vue'), 'utf8')
  assert.match(source, /request\.post\(['"]\/admin\/contents['"]/, '发布内容仍未调用后端')
  assert.match(source, /isPublic\s*:/, '发布内容没有提交isPublic')
  assert.match(source, /bodyOrVideoUrl\s*:/, '正文或视频地址没有映射到后端字段')
  assert.doesNotMatch(source, /rows\.value\.unshift/, '发布内容仍在写入Mock列表')
})

test('选择封面后上传、显示反馈并随内容保存', () => {
  const source = readFileSync(join(root, 'src/views/ContentsView.vue'), 'utf8')
  assert.match(source, /@change=["']handleCoverChange["']/, '封面控件没有处理文件选择事件')
  assert.match(source, /request\.post\(['"]\/admin\/contents\/upload['"]/, '选择封面后没有调用上传接口')
  assert.match(source, /coverUrl\s*:/, '发布内容时没有提交封面地址')
  assert.match(source, /form\.coverUrl/, '页面没有保存或展示已上传的封面')
})

test('未发布内容会自动暂存、恢复并在发布后清理', () => {
  const storage = new Map()
  const localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: key => storage.delete(key),
  }
  const draft = { title: '尚未发布的学习内容', body: '正文', tags: ['党纪学习教育'] }

  saveContentDraft(localStorage, draft)
  assert.deepEqual(loadContentDraft(localStorage), draft, '关闭后无法恢复未发布内容')
  clearContentDraft(localStorage)
  assert.equal(loadContentDraft(localStorage), null, '正式发布后仍残留旧暂存')

  const source = readFileSync(join(root, 'src/views/ContentsView.vue'), 'utf8')
  assert.match(source, /watch\(form/, '表单输入变化时没有自动暂存')
  assert.match(source, /loadContentDraft\(localStorage\)/, '再次打开发布弹窗时没有恢复暂存')
  assert.match(source, /clearContentDraft\(localStorage\)/, '发布成功后没有清理暂存')
})

test('进入内容详情会打开真实详情页而不是只记录预览', () => {
  const source = readFileSync(join(root, 'src/views/ContentsView.vue'), 'utf8')
  const routerSource = readFileSync(join(root, 'src/router/index.js'), 'utf8')

  assert.doesNotMatch(source, /已记录本次预览/, '进入详情仍然只是显示演示提示')
  assert.match(source, /router\.push\(`\/contents\/\$\{previewItem\.value\.id\}`\)/, '进入详情没有执行页面跳转')
  assert.match(routerSource, /path:\s*['"]contents\/:id['"]/, '管理后台缺少内容详情路由')
})

test('管理后台把上传文件地址代理到后端', () => {
  const viteConfig = readFileSync(join(root, 'vite.config.js'), 'utf8')
  assert.match(viteConfig, /['"]\/uploads['"]\s*:/, '管理后台没有代理/uploads，封面请求会返回网页而不是图片')
})

test('更新时间按北京时间显示为易读格式', () => {
  assert.equal(formatBeijingDateTime('2026-08-20T23:52:24.000Z'), '2026-08-21 07:52')
  assert.equal(formatBeijingDateTime('invalid-date'), '--')

  const source = readFileSync(join(root, 'src/views/ContentsView.vue'), 'utf8')
  assert.match(source, /updatedAt:\s*formatBeijingDateTime\(row\.updatedAt/, '内容列表仍在直接显示API原始时间')
  assert.doesNotMatch(source, /数据更新于今天 16:30/, '页面仍在显示固定的演示更新时间')
})
