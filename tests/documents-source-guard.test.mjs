import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { listSrc, readSrc } from './helpers/load-ts.mjs'

const root = path.join(process.cwd(), 'src')
const rel = (f) => path.relative(root, f).replace(/\\/g, '/')
const files = listSrc('modules/documents', ['.tsx', '.ts']).map(rel)
const tsx = files.filter((f) => f.endsWith('.tsx'))
const ROLE_LITERAL = /['"`](Employee|Manager|HRAdmin|Finance)['"`]/

test('the Documents module has its pages, API and routes', () => {
  for (const f of ['api.ts', 'logic.ts', 'routes.tsx', 'DocumentsPage.tsx', 'DocumentList.tsx', 'DocumentRow.tsx', 'UploadForm.tsx', 'PoliciesTab.tsx', 'HrTab.tsx', 'HrEmployees.tsx', 'HrExpiring.tsx', 'HrPublish.tsx', 'HrCoverage.tsx', 'HrTypes.tsx']) {
    assert.ok(files.includes(`modules/documents/${f}`), f)
  }
  const routes = readSrc('modules/documents/routes.tsx')
  assert.ok(/path: 'documents'/.test(routes))
  assert.ok(/path: 'documents\/policies\/:policyId'/.test(routes), 'the policy.published notification link has a route')
})

test('no role name drives any control: role literals live only in logic.ts visibleTabs (a tab-offering hint), and only DocumentsPage reads user roles', () => {
  const offenders = tsx.filter((f) => ROLE_LITERAL.test(readSrc(f)))
  assert.deepEqual(offenders, [])
  const logic = readSrc('modules/documents/logic.ts')
  const outside = logic.replace(/export function visibleTabs[\s\S]*?\n}\n/, '')
  assert.ok(!ROLE_LITERAL.test(outside), 'role names in logic.ts are confined to visibleTabs')
  const readers = tsx.filter((f) => /\.roles\b|hasAnyRole|roleLabel/.test(readSrc(f)))
  assert.deepEqual(readers, ['modules/documents/DocumentsPage.tsx'])
  assert.ok(/visibleTabs\(user\?\.roles\)/.test(readSrc('modules/documents/DocumentsPage.tsx')))
})

test('buttons come from the server allowed_actions (documents and policies)', () => {
  const row = readSrc('modules/documents/DocumentRow.tsx')
  assert.ok(/hasAction\(doc\.allowed_actions, 'download'\)/.test(row))
  assert.ok(/hasAction\(current\.allowed_actions, 'add_version'\)/.test(row))
  assert.ok(/hasAction\(current\.allowed_actions, 'edit'\)/.test(row))
  assert.ok(/\{canAdd \? \(/.test(row) && /\{canEdit \? \(/.test(row))
  const pol = readSrc('modules/documents/PoliciesTab.tsx')
  assert.ok(/hasAction\(policy\.allowed_actions, 'download'\)/.test(pol))
  assert.ok(/hasAction\(policy\.allowed_actions, 'acknowledge'\)/.test(pol))
  assert.ok(/hasAction\(policy\.allowed_actions, 'publish_version'\)/.test(pol))
  const pub = readSrc('modules/documents/HrPublish.tsx')
  assert.ok(/policy\.allowed_actions\.includes\('publish_version'\)/.test(pub))
})

test('downloads are authorised blob requests: no token or file URL is ever built in the UI', () => {
  const api = readSrc('modules/documents/api.ts')
  assert.equal((api.match(/responseType: 'blob'/g) || []).length, 2, 'fileBlob and policyBlob')
  for (const f of files) {
    const src = readSrc(f)
    assert.ok(!/access_token|accessToken|[?&]token=|localStorage|sessionStorage/.test(src.replace(/^\s*\/\*[\s\S]*?\*\//, '').replace(/\/\/.*$/gm, '')), `${f} touches tokens or storage`)
    assert.ok(!/window\.open\(|location\.href\s*=|<iframe|<embed|<object/.test(src), `${f} opens a file by URL`)
  }
  const hooks = readSrc('modules/documents/hooks.ts')
  assert.ok(/URL\.createObjectURL/.test(hooks) && /revokeObjectURL/.test(hooks))
})

test('no dead controls: every <button> has a handler, a submit type or is disabled; every one declares its type; no raw anchors, empty handlers, TODOs', () => {
  const bad = []
  for (const f of tsx) {
    const src = readSrc(f)
    let m
    const re = /<button\b([\s\S]*?)>/g
    while ((m = re.exec(src))) {
      const attrs = m[1]
      if (!/onClick\s*=|type=["']submit["']|\bdisabled\b/.test(attrs)) bad.push(`${f}: no action: ${attrs.trim().slice(0, 60)}`)
      if (!/type=["'](button|submit)["']/.test(attrs)) bad.push(`${f}: no type: ${attrs.trim().slice(0, 60)}`)
    }
    if (/<a\b/.test(src)) bad.push(`${f}: raw <a>`)
    if (/onClick=\{\s*\(\)\s*=>\s*(\{\s*\}|undefined|null)\s*\}/.test(src)) bad.push(`${f}: empty onClick`)
    if (/onClick=\{undefined\}|href=["']#["']|to=["']#["']/.test(src)) bad.push(`${f}: dead link`)
    if (/\bTODO\b|coming soon/i.test(src)) bad.push(`${f}: TODO / coming soon text`)
  }
  assert.deepEqual(bad, [])
})

test('the privacy notices are on the pages that need them', () => {
  const page = readSrc('modules/documents/DocumentsPage.tsx')
  assert.ok(/PRIVACY_NOTE/.test(page) && /HR_ONLY_NOTE/.test(page))
  assert.ok(!/Placeholder|PLACEHOLDER_LABEL/.test(readSrc('modules/documents/HrTypes.tsx')))
  const logic = readSrc('modules/documents/logic.ts')
  assert.ok(/Managers do not see them/.test(logic))
})

test('client file checks are hints only: the upload form never blocks on fileHint', () => {
  for (const f of ['UploadForm.tsx', 'DocumentRow.tsx', 'HrPublish.tsx']) {
    assert.ok(!/fileHint\(/.test(readSrc(`modules/documents/${f}`)), `${f} must not call fileHint (only the FileField shows it)`)
  }
  assert.ok(/fileHint\(file\)/.test(readSrc('modules/documents/parts.tsx')))
  assert.ok(/Only a hint/.test(readSrc('modules/documents/parts.tsx')))
})
