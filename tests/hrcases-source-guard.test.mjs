import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { listSrc, readSrc } from './helpers/load-ts.mjs'

const root = path.join(process.cwd(), 'src')
const rel = (f) => path.relative(root, f).replace(/\\/g, '/')
const files = listSrc('modules/hrcases', ['.tsx', '.ts']).map(rel)
const tsx = files.filter((f) => f.endsWith('.tsx'))
const ROLE_LITERAL = /['"`](Employee|Manager|HRAdmin|Finance)['"`]/

test('the HR Requests module has its pages, API and routes (landing, new request, case detail deep link)', () => {
  for (const f of ['api.ts', 'logic.ts', 'routes.tsx', 'HrRequestsLanding.tsx', 'NewCase.tsx', 'CaseDetail.tsx', 'CaseControls.tsx', 'CaseList.tsx']) {
    assert.ok(files.includes(`modules/hrcases/${f}`), f)
  }
  const routes = readSrc('modules/hrcases/routes.tsx')
  assert.ok(/path: 'hr-requests'/.test(routes))
  assert.ok(/path: 'hr-requests\/new'/.test(routes))
  assert.ok(/path: 'hr-requests\/cases\/:id'/.test(routes), 'the case notification link has a route')
})

test('the landing keeps exactly the two required links and nothing leaks from the old card grid', () => {
  const src = readSrc('modules/hrcases/HrRequestsLanding.tsx')
  assert.ok(src.includes('to="/reimbursements"') && src.includes('data-testid="request-reimbursements"'))
  assert.ok(src.includes('to="/directory"') && src.includes('data-testid="browse-directory"'))
  assert.ok(src.includes('to="/hr-requests/new"'))
  assert.ok(!/Coming soon|request-soon/i.test(src))
})

test('no role name drives any control: role literals live only in logic.ts showQueueTab (a tab-offering hint); only the landing reads user roles', () => {
  const offenders = tsx.filter((f) => ROLE_LITERAL.test(readSrc(f)))
  assert.deepEqual(offenders, [])
  const logic = readSrc('modules/hrcases/logic.ts')
  // roleLabel returns the display word "Employee" for a message speaker: wording, not a permission
  const outside = logic.replace(/export function showQueueTab[\s\S]*?\n}\n/, '').replace(/export function roleLabel[\s\S]*?\n}\n/, '')
  assert.ok(!ROLE_LITERAL.test(outside), 'role names in logic.ts are confined to showQueueTab (and the roleLabel display word)')
  const readers = tsx.filter((f) => /\.roles\b|hasAnyRole|roleLabel\(user/.test(readSrc(f)))
  assert.deepEqual(readers, ['modules/hrcases/HrRequestsLanding.tsx'])
  assert.ok(/showQueueTab\(user\?\.roles\)/.test(readSrc('modules/hrcases/HrRequestsLanding.tsx')))
})

test('controls come from the server: allowed_actions and allowed_statuses gate every status / priority / assign / close / reply control', () => {
  const c = readSrc('modules/hrcases/CaseControls.tsx')
  for (const a of ['set_status', 'set_priority', 'assign', 'close']) assert.ok(new RegExp(`hasAction\\(c\\.allowed_actions, '${a}'\\)`).test(c), a)
  assert.ok(/c\.allowed_statuses\.map\(/.test(c), 'the status choices are exactly the server-allowed ones')
  assert.ok(/\{canStatus \? \(/.test(c) && /\{canPriority \? \(/.test(c) && /\{canAssign \? \(/.test(c) && /\{canClose \? \(/.test(c))
  assert.ok(/version/.test(c) && /c\.version/.test(c), 'every change sends the case version')
  const d = readSrc('modules/hrcases/CaseDetail.tsx')
  assert.ok(/hasAction\(c\.allowed_actions, 'reply'\)/.test(d))
  assert.ok(/hasAction\(c\.allowed_actions, 'set_status'\)/.test(d))
  assert.ok(/c\.allowed_statuses\.map\(/.test(d))
  const list = readSrc('modules/hrcases/CaseList.tsx')
  assert.ok(/\{queue \? \(\s*<CaseControls/.test(list), 'inline controls only in the HR queue, and still gated per row by the server')
})

test('the owner-reply behaviour is explained from the server data (status), never from a role name', () => {
  const d = readSrc('modules/hrcases/CaseDetail.tsx')
  assert.ok(/replyNote\(c\.status, isOwner\)/.test(d))
  assert.ok(/isOwner=\{Boolean\(me\?\.employee_id && c\.employee\?\.employee_id === me\.employee_id\)\}/.test(d))
  assert.ok(!/roles/.test(d))
})

test('attachments are authorised blob downloads: no token or file URL is ever built in the UI', () => {
  const api = readSrc('modules/hrcases/api.ts')
  assert.equal((api.match(/responseType: 'blob'/g) || []).length, 1)
  for (const f of files) {
    const src = readSrc(f)
    assert.ok(!/access_token|accessToken|[?&]token=|localStorage|sessionStorage/.test(src.replace(/^\s*\/\*[\s\S]*?\*\//, '').replace(/\/\/.*$/gm, '')), `${f} touches tokens or storage`)
    assert.ok(!/window\.open\(|location\.href\s*=|<iframe|<embed|<object/.test(src), `${f} opens a file by URL`)
  }
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

test('the privacy notice is on every page of the module and no placeholder badge is shown', () => {
  for (const f of ['HrRequestsLanding.tsx', 'NewCase.tsx', 'CaseDetail.tsx']) assert.ok(/PRIVACY_NOTE/.test(readSrc(`modules/hrcases/${f}`)), f)
  assert.ok(!/PLACEHOLDER_LABEL/.test(readSrc('modules/hrcases/NewCase.tsx')))
  assert.ok(/Managers - including your own manager - cannot/.test(readSrc('modules/hrcases/logic.ts')))
})
