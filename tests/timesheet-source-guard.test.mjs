// Source guards for the Attendance & Timesheet module: no dead buttons, no role-name permission checks,
// controls gated by the server's allowed_actions, no placeholder text, every in-app link points at a real tab.
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { listSrc, readSrc } from './helpers/load-ts.mjs'

const root = path.join(process.cwd(), 'src')
const rel = (f) => path.relative(root, f).replace(/\\/g, '/')
const files = listSrc('modules/timesheet', ['.tsx', '.ts']).map(rel)
const tsx = files.filter((f) => f.endsWith('.tsx'))
const ROLE_LITERAL = /['"`](Employee|Manager|HRAdmin|Finance)['"`]/

test('the module has its pages and the route is registered for `attendance`', () => {
  for (const f of ['AttendancePage', 'TodayTab', 'TimesheetTab', 'CorrectionsTab', 'ApprovalsTab', 'TeamTab', 'HrTab', 'SheetGrid', 'MonthView', 'DecisionPanel', 'routes']) {
    assert.ok(files.includes(`modules/timesheet/${f}.tsx`), f)
  }
  for (const f of ['api', 'logic', 'hooks']) assert.ok(files.includes(`modules/timesheet/${f}.ts`), f)
  assert.match(readSrc('modules/timesheet/routes.tsx'), /path:\s*'attendance'/)
})

test('role names appear only in logic.ts availableTabs (a navigation hint); no component reads roles to gate a control', () => {
  const offenders = tsx.filter((f) => ROLE_LITERAL.test(readSrc(f)))
  assert.deepEqual(offenders, [])
  const logic = readSrc('modules/timesheet/logic.ts')
  const outside = logic.replace(/export function availableTabs[\s\S]*?\n}\n/, '')
  assert.ok(!ROLE_LITERAL.test(outside), 'role names in logic.ts are confined to availableTabs')
  // The only component that touches roles passes them straight to availableTabs.
  const readers = tsx.filter((f) => /\.roles\b|roles\s*=\s*useAuthStore|hasAnyRole|roleLabel|\bisHR\b|\bisManager\b/.test(readSrc(f)))
  assert.deepEqual(readers, ['modules/timesheet/AttendancePage.tsx'])
  assert.match(readSrc('modules/timesheet/AttendancePage.tsx'), /availableTabs\(roles, canManageCodes\)/)
})

test('the HR tab is offered from the server flag can_manage, not from a role', () => {
  const page = readSrc('modules/timesheet/AttendancePage.tsx')
  assert.match(page, /codes\.data\?\.can_manage/)
  assert.match(readSrc('modules/timesheet/HrTab.tsx'), /q\.data\.can_manage/)
})

test('controls are driven by the server allowed_actions', () => {
  const clock = readSrc('modules/timesheet/TodayTab.tsx')
  for (const a of ['clock_in', 'clock_out', 'request_correction']) assert.ok(new RegExp(`allowed\\.includes\\('${a}'\\)`).test(clock), `${a} button is gated`)
  const sheet = readSrc('modules/timesheet/TimesheetTab.tsx')
  assert.match(sheet, /allowed_actions\.includes\('edit'\)/)
  for (const a of ['submit', 'recall']) assert.ok(new RegExp(`can\\('${a}'\\)`).test(sheet), `${a} is gated`)
  assert.match(sheet, /\{!own \? <DecisionPanel subject="timesheet" allowed=\{sheet\.allowed_actions\}/)
  const panel = readSrc('modules/timesheet/DecisionPanel.tsx')
  for (const a of ['approve', 'reject']) assert.ok(new RegExp(`allowed\\.includes\\('${a}'\\)`).test(panel), `${a} is gated`)
  const corr = readSrc('modules/timesheet/CorrectionsTab.tsx')
  assert.match(corr, /allowed\.includes\('cancel'\)/)
  assert.match(corr, /<DecisionPanel subject="correction" allowed=\{allowed\}/)
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
    if (/\bTODO\b|coming soon|lorem ipsum/i.test(src)) bad.push(`${f}: TODO / coming soon text`)
  }
  assert.deepEqual(bad, [])
})

test('every in-app Link goes to a query on the attendance page with a known tab', () => {
  const known = new Set(['today', 'timesheet', 'corrections', 'approvals', 'team', 'hr'])
  const bad = []
  let seen = 0
  for (const f of tsx) {
    const src = readSrc(f)
    for (const m of src.matchAll(/<Link[^>]*\sto=(?:"([^"]*)"|\{([^}]+)\})/g)) {
      seen += 1
      const literal = m[1]
      if (literal !== undefined) {
        const tab = /^\?tab=(\w+)/.exec(literal)?.[1]
        if (!tab || !known.has(tab)) bad.push(`${f}: ${literal}`)
      } else if (!/(timesheetLink|correctionLink|requestLink|correctionLinkTo|target|personLink|backTo)\b/.test(m[2])) bad.push(`${f}: {${m[2]}}`)
    }
  }
  assert.ok(seen >= 6, `found ${seen} links`)
  assert.deepEqual(bad, [])
  // The helpers build only known tabs.
  const logic = readSrc('modules/timesheet/logic.ts')
  assert.match(logic, /tab: 'timesheet'/)
  assert.match(logic, /tab: 'corrections'/)
})

test('the module never calls PUT or DELETE and never reads tokens or storage itself', () => {
  for (const f of files) {
    const src = readSrc(f)
    assert.ok(!/\.(put|delete)\(/.test(src.replace(/p\.delete\(|params\.delete\(|\.delete\('/g, '')), `${f} uses a forbidden verb`)
    assert.ok(!/localStorage|sessionStorage|accessToken|dangerouslySetInnerHTML|innerHTML/.test(src), `${f} touches storage, tokens or raw HTML`)
  }
})

test('no placeholder notice is shown; the decision panel still says approval has no pay effect', () => {
  assert.doesNotMatch(readSrc('modules/timesheet/AttendancePage.tsx'), /PlaceholderNotice/)
  assert.doesNotMatch(readSrc('modules/timesheet/HrTab.tsx'), /placeholders set by HR/)
  assert.match(readSrc('modules/timesheet/DecisionPanel.tsx'), /no effect on pay/)
})

test('the weekly grid becomes stacked day cards on phones (one structure rendered at a time) and cells carry labels', () => {
  const grid = readSrc('modules/timesheet/SheetGrid.tsx')
  assert.match(grid, /data-layout="stacked"/)
  assert.match(grid, /data-layout="table"/)
  assert.match(grid, /if \(phone\)/)
  assert.match(grid, /aria-label=\{`\$\{row\.code_name\}, \$\{formatDayLabel\(day\)\}, hours`\}/)
  assert.match(readSrc('modules/timesheet/TimesheetTab.tsx'), /useMediaQuery\('\(max-width: 640px\)'\)/)
})

test('the old Attendance placeholder is replaced, not edited: ComingSoon.tsx still exports it for the registry fallback', () => {
  assert.match(readSrc('pages/ComingSoon.tsx'), /export const AttendancePage/)
  assert.match(readSrc('App.tsx'), /placeholder\("attendance"/)
})
