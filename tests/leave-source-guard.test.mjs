// Source guards for the Leave module: no role-name permission checks, controls follow the server's allowed_actions,
// no dead buttons, honest wording, and the module stays inside its own folder.
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { listSrc, readSrc } from './helpers/load-ts.mjs'

const root = path.join(process.cwd(), 'src')
const rel = (f) => path.relative(root, f).replace(/\\/g, '/')
const files = listSrc('modules/leave', ['.tsx', '.ts']).map(rel)
const tsx = files.filter((f) => f.endsWith('.tsx'))
const ROLE_LITERAL = /['"`](Employee|Manager|HRAdmin|Finance)['"`]/

test('the module has the pages, the form, the panels and routes for leave, leave/new and leave/:id', () => {
  for (const f of ['api.ts', 'logic.ts', 'LeavePage.tsx', 'LeaveNew.tsx', 'LeaveDetail.tsx', 'LeaveForm.tsx', 'DetailPanels.tsx', 'MyLeaveTab.tsx', 'ApprovalsTab.tsx', 'TeamCalendarTab.tsx', 'SettingsTab.tsx', 'routes.tsx', 'leave.css']) {
    assert.ok(files.includes(`modules/leave/${f}`) || f === 'leave.css', f)
  }
  const routes = readSrc('modules/leave/routes.tsx')
  for (const p of ["'leave'", "'leave/new'", "'leave/:id'"]) assert.ok(routes.includes(`path: ${p}`), `route ${p}`)
  assert.ok(/export default/.test(routes))
})

test('role names appear only in logic.ts (navigation hint), never in a component', () => {
  const offenders = tsx.filter((f) => ROLE_LITERAL.test(readSrc(f)))
  assert.deepEqual(offenders, [])
  const api = readSrc('modules/leave/api.ts')
  assert.ok(!ROLE_LITERAL.test(api))
  const logic = readSrc('modules/leave/logic.ts')
  const outside = logic.replace(/export function listScopesFor[\s\S]*?\n}\n/, '').replace(/export function availableTabs[\s\S]*?\n}\n/, '')
  assert.ok(!ROLE_LITERAL.test(outside), 'role names in logic.ts are confined to listScopesFor and availableTabs')
})

test('components read roles only to pick tabs; detail, form and panels never look at roles or user names', () => {
  for (const f of ['LeaveDetail', 'LeaveForm', 'DetailPanels', 'LeaveNew', 'MyLeaveTab', 'ApprovalsTab', 'TeamCalendarTab', 'SettingsTab', 'RequestsPanel', 'EmployeePicker']) {
    const src = readSrc(`modules/leave/${f}.tsx`)
    assert.ok(!/\.roles\b|\broles\s*[:=]|hasAnyRole|roleLabel/.test(src), `${f} must not look at roles`)
  }
  const page = readSrc('modules/leave/LeavePage.tsx')
  assert.ok(/availableTabs\(roles\)/.test(page) && /listScopesFor\(roles\)/.test(page))
  assert.ok(/Navigation hint ONLY/.test(readSrc('modules/leave/logic.ts')), 'the hint is documented as navigation only')
})

test('the detail screen is driven by allowed_actions: decider / editor / cancel each gated, every button follows its own action', () => {
  const detail = readSrc('modules/leave/LeaveDetail.tsx')
  assert.ok(/isDeciderMode\(req\.allowed_actions\)/.test(detail))
  assert.ok(/isEditorMode\(req\.allowed_actions\)/.test(detail))
  assert.ok(/hasAction\(req\.allowed_actions, 'cancel'\)/.test(detail))
  assert.ok(/\{decider \? \(?\s*<DecisionPanel/.test(detail), 'DecisionPanel renders only inside the decider condition')
  assert.ok(/\{canCancel \? <CancelPanel/.test(detail), 'CancelPanel renders only when cancel is allowed')
  const panels = readSrc('modules/leave/DetailPanels.tsx')
  for (const a of ['approve', 'reject', 'clarify']) assert.ok(new RegExp(`can\\('${a}'\\)`).test(panels), `${a} button is gated by allowed_actions`)
  assert.ok(/canEdit \? \(/.test(panels) && /hasAction\(req\.allowed_actions, 'edit'\)/.test(panels))
  assert.ok(/canResubmit \? \(/.test(panels) && /hasAction\(req\.allowed_actions, 'resubmit'\)/.test(panels))
})

test('reject and clarify cannot be sent without a comment (button disabled + server code handled)', () => {
  const panels = readSrc('modules/leave/DetailPanels.tsx')
  assert.ok(/blocked = \(a: DecisionAction\) => a !== 'approve' && !trimmed/.test(panels))
  assert.ok(/disabled=\{blocked\('clarify'\)\}/.test(panels))
  assert.ok(/disabled=\{blocked\('reject'\)\}/.test(panels))
  assert.ok(/comment_required/.test(readSrc('modules/leave/logic.ts')))
})

test('every button has a handler, a submit type or a disabled state; no raw anchors, empty handlers or dead links', () => {
  const bad = []
  for (const f of tsx) {
    const src = readSrc(f)
    let m
    const re = /<button\b([\s\S]*?)>/g
    while ((m = re.exec(src))) if (!/onClick\s*=|type=["']submit["']|\bdisabled\b/.test(m[1])) bad.push(`${f}: ${m[1].trim().slice(0, 60)}`)
    if (/<a\b/.test(src)) bad.push(`${f}: raw <a>`)
    if (/onClick=\{\s*\(\)\s*=>\s*(\{\s*\}|undefined|null)\s*\}/.test(src)) bad.push(`${f}: empty onClick`)
    if (/onClick=\{undefined\}|href=["']#["']|to=["']#["']/.test(src)) bad.push(`${f}: dead link`)
    if (/\bTODO\b|coming soon/i.test(src)) bad.push(`${f}: TODO / coming soon text`)
  }
  assert.deepEqual(bad, [])
})

test('every Link points at a real leave route', () => {
  const targets = new Set()
  for (const f of tsx) {
    const src = readSrc(f)
    for (const m of src.matchAll(/<Link\b[^>]*\bto=(?:"([^"]+)"|\{`([^`]+)`\})/g)) targets.add(m[1] ?? m[2])
  }
  for (const t of targets) assert.ok(/^\/leave($|\/|\?|\$\{)/.test(t), `unexpected Link target ${t}`)
})

test('no placeholder or no-pay disclaimers are shown, and the module has no pay vocabulary', () => {
  for (const f of ['parts', 'LeavePage', 'LeaveNew', 'LeaveDetail', 'MyLeaveTab', 'SettingsTab', 'LeaveForm', 'DetailPanels']) {
    const src = readSrc(`modules/leave/${f}.tsx`)
    assert.ok(!/LeaveNotice|PLACEHOLDER_|NO_PAY_NOTE|tone="amber"[^>]*>Placeholder/.test(src), `${f} shows no placeholder notice or badge`)
  }
  assert.ok(!/payroll|salary|payslip|bank/i.test(readSrc('modules/leave/logic.ts')), 'no pay vocabulary')
})

test('no tokens or secrets are handled by the module; it only uses the shared client', () => {
  for (const f of files) {
    const src = readSrc(f)
    assert.ok(!/localStorage|sessionStorage|accessToken|refreshToken|Authorization/.test(src), `${f} must not touch tokens`)
    assert.ok(!/dangerouslySetInnerHTML|innerHTML|eval\(/.test(src), `${f} must not inject HTML`)
    assert.ok(!/axios\.create|from 'axios'/.test(src), `${f} must use @/api/client`)
  }
  assert.ok(/from '@\/api\/client'/.test(readSrc('modules/leave/api.ts')))
})

test('the module imports nothing from other modules and edits no shared file (it only reads shared libs and ui)', () => {
  for (const f of files) {
    const src = readSrc(f)
    for (const m of src.matchAll(/from '(@\/[^']+)'/g)) {
      assert.ok(!/^@\/modules\/(?!leave)/.test(m[1]), `${f} imports another module: ${m[1]}`)
      assert.ok(!/^@\/pages\/reimbursements/.test(m[1]), `${f} must not depend on the reimbursements pages`)
    }
  }
})
