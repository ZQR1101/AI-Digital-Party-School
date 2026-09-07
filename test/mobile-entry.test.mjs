import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function resolveLocalImport(fromFile, specifier) {
  const base = resolve(dirname(fromFile), specifier)
  const candidates = [base, `${base}.js`, `${base}.vue`, `${base}.css`, join(base, 'index.js')]
  return candidates.find(candidate => existsSync(candidate) && statSync(candidate).isFile())
}

test('移动端 HTML 入口指向存在的源码文件', () => {
  const html = readFileSync(join(projectRoot, 'index.html'), 'utf8')
  const source = html.match(/<script[^>]+type="module"[^>]+src="([^"]+)"/)?.[1]
  assert.ok(source, 'index.html 缺少模块入口')
  assert.ok(existsSync(join(projectRoot, source.replace(/^\//, ''))), `移动端入口不存在: ${source}`)
})

test('移动端入口的本地依赖均可解析', () => {
  const entry = join(projectRoot, 'src-qianduan', 'main.js')
  const source = readFileSync(entry, 'utf8')
  const imports = [...source.matchAll(/from\s+['"](\.[^'"]+)['"]|import\s+['"](\.[^'"]+)['"]/g)]
    .map(match => match[1] || match[2])
  const missing = imports.filter(specifier => !resolveLocalImport(entry, specifier))
  assert.deepEqual(missing, [], `入口存在无法解析的本地依赖: ${missing.join(', ')}`)
})
