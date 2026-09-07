import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = readFileSync(join(root, 'src/views/QuestionsView.vue'), 'utf8')

test('题库页面使用真实题目接口完成增删改查', () => {
  assert.match(source, /request\.get\(['"]\/admin\/questions['"]/, '没有加载真实题库')
  assert.match(source, /request\.post\(['"]\/admin\/questions['"]/, '新增题目没有写入后端')
  assert.match(source, /request\.put\(`\/admin\/questions\/\$\{/, '编辑题目没有写入后端')
  assert.match(source, /request\.delete\(`\/admin\/questions\/\$\{/, '删除题目没有写入后端')
  assert.doesNotMatch(source, /Mock/, '题库页面仍包含Mock动作')
})

test('试卷页面使用真实试卷接口并支持选题与发布', () => {
  assert.match(source, /request\.get\(['"]\/admin\/papers['"]/, '没有加载真实试卷')
  assert.match(source, /request\.post\(['"]\/admin\/papers['"]/, '新增试卷没有写入后端')
  assert.match(source, /questionIds\s*:/, '创建试卷没有提交题目关联')
  assert.match(source, /request\.put\(`\/admin\/papers\/\$\{/, '试卷编辑或发布没有写入后端')
  assert.match(source, /request\.delete\(`\/admin\/papers\/\$\{/, '删除试卷没有写入后端')
})
