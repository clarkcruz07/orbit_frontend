import test from 'node:test'
import assert from 'node:assert/strict'
import { loadTs } from './helpers/load-ts.mjs'

const { safeNextPath } = await loadTs('lib/safeNext.ts')

test('accepts same-origin relative paths, keeping query and hash', () => {
  assert.equal(safeNextPath('/hr-administration'), '/hr-administration')
  assert.equal(safeNextPath('/reimbursements/abc?tab=audit#x'), '/reimbursements/abc?tab=audit#x')
  assert.equal(safeNextPath('/'), '/')
})

test('rejects absolute, protocol-relative and scheme URLs', () => {
  for (const bad of ['https://evil.example/', 'http://evil.example', '//evil.example', '///evil.example', 'javascript:alert(1)', 'data:text/html,x', 'evil.example/path', 'hr-administration']) {
    assert.equal(safeNextPath(bad), '/', bad)
  }
})

test('rejects backslash and control-character tricks', () => {
  for (const bad of ['/\\evil.example', '/\\/evil.example', '/\t/evil.example', '/\n/evil.example', '/a\\b', '/%0d%0a']) {
    const out = safeNextPath(bad)
    assert.ok(out === '/' || !out.includes('\\'), bad)
  }
  assert.equal(safeNextPath('/\t/evil.example'), '/')
  assert.equal(safeNextPath('/\\evil.example'), '/')
})

test('rejects missing/empty/oversized values and the login page itself', () => {
  assert.equal(safeNextPath(null), '/')
  assert.equal(safeNextPath(undefined), '/')
  assert.equal(safeNextPath(''), '/')
  assert.equal(safeNextPath('   '), '/')
  assert.equal(safeNextPath('/' + 'a'.repeat(2500)), '/')
  assert.equal(safeNextPath('/login'), '/')
  assert.equal(safeNextPath('/login?next=/x'), '/')
})

test('uses the supplied fallback', () => {
  assert.equal(safeNextPath('https://evil.example', '/hr-administration'), '/hr-administration')
  assert.equal(safeNextPath(null, '/hr-administration'), '/hr-administration')
})
