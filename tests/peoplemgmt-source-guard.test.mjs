import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { listSrc, readSrc } from './helpers/load-ts.mjs'

const root = path.join(process.cwd(), 'src')
const rel = (f) => path.relative(root, f).replace(/\\/g, '/')
const files = listSrc('modules/peoplemgmt', ['.tsx', '.ts']).map(rel)
const tsx = files.filter((f) => f.endsWith('.tsx'))
const ROLE_LITERAL = /['`](Employee|Manager|HRAdmin|Finance)['`]/
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
const noCr = (src) => src.replace(/\r/g, '')
// formFromPerson seeds the checkboxes from the SERVER's account roles (data in, not a decision); it is the one place allowed to look.
const withoutFormFromPerson = (src) => src.replace(/export function formFromPerson[\s\S]*?\n}\n/, '')

test('the module has its pages, API, logic and routes', () => {
  for (const f of ['api.ts', 'logic.ts', 'entraSync.ts', 'EntraSyncCard.tsx', 'routes.tsx', 'parts.tsx', 'PeopleList.tsx', 'PersonNew.tsx', 'PersonDetail.tsx', 'PersonFields.tsx', 'AccountCard.tsx', 'PersonDialogs.tsx', 'ImportPage.tsx', 'ImportReportView.tsx', 'Profile201Page.tsx', 'profile201.ts', 'HolidaysPage.tsx', 'HolidayForm.tsx', 'RolesFields.tsx']) {
    assert.ok(files.includes(`modules/peoplemgmt/${f}`), f)
  }
  const routes = readSrc('modules/peoplemgmt/routes.tsx')
  for (const p of ['people', 'people/new', 'people/import', 'people/import-201', 'people/:employeeId', 'settings/holidays']) assert.ok(routes.includes(`path: '${p}'`), p)
  assert.equal((routes.match(/path: '/g) || []).length, 6, 'exactly the six routes, nothing else is mounted')
})

test('no role name drives anything: the module never reads the signed-in user, and role literals are display data only', () => {
  for (const f of files) {
    const src = withoutFormFromPerson(noCr(strip(readSrc(f))))
    assert.ok(!/useAuthStore|authStore|\buser\??\.roles|hasRole|has_role|\.roles\.includes\(\s*['"]/.test(src), `${f} reads the signed-in user or tests a role name`)
  }
  const offenders = tsx.filter((f) => ROLE_LITERAL.test(strip(readSrc(f))))
  assert.deepEqual(offenders, [], 'component files contain no quoted role names')
  // In logic.ts role names appear only as labels, the grantable list and the display order - never compared or used in a condition.
  const logic = withoutFormFromPerson(noCr(strip(readSrc('modules/peoplemgmt/logic.ts'))))
  for (const l of logic.split('\n')) {
    const bare = l.replace(/'[^']*'|`[^`]*`|"[^"]*"/g, '')
    const condition = /\bif\b|\?|&&|\|\||===|!==/.test(bare)
    assert.ok(!(condition && /\b(HRAdmin|Manager|Finance)\b/.test(bare)), `a role name in a condition: ${l.trim()}`)
    assert.ok(!/(===|!==|includes\()\s*['"`](Employee|Manager|HRAdmin|Finance)['"`]/.test(l), `a role name compared: ${l.trim()}`)
  }
})

test('permissions come from the server: every refusal is a status check on the response, and the buttons are not pre-disabled for "self" or "last admin"', () => {
  const card = readSrc('modules/peoplemgmt/AccountCard.tsx')
  assert.ok(/failureMessage\(parseFailure\(err\)/.test(card), 'the server reason is what is shown')
  assert.ok(!/employee_id\s*===|user_id\s*===|last_hradmin|HRAdmin/.test(strip(card)), 'the card does not pre-judge self / last admin')
  const dialogs = readSrc('modules/peoplemgmt/PersonDialogs.tsx')
  assert.ok(/has_direct_reports/.test(dialogs) && /reassign_reports_to/.test(dialogs))
  for (const f of ['PeopleList.tsx', 'PersonDetail.tsx', 'ImportPage.tsx', 'HolidaysPage.tsx']) assert.ok(/status === 403/.test(readSrc(`modules/peoplemgmt/${f}`)), `${f} turns a 403 into "not available"`)
  assert.ok(/status === 403/.test(readSrc('modules/peoplemgmt/parts.tsx')), 'useHrAccess')
})

test('every API path is one of the documented routes, and the only PUT is the roles route', () => {
  const api = strip(readSrc('modules/peoplemgmt/api.ts'))
  const paths = [...api.matchAll(/api\s*\.(?:get|post|put|patch|delete)(?:<[^>]*>)?\(\s*[`']([^`']+)[`']/g)].map((m) => m[1].replace(/\$\{[^}]*\}/g, '{id}'))
  assert.deepEqual(
    [...new Set(paths)].sort(),
    ['/directory/employees', '/holidays', '/holidays/{id}', '/people/employees', '/people/employees/import', '/people/employees/import/template', '/people/employees/{id}', '/people/employees/{id}/deactivate', '/people/employees/{id}/reactivate', '/people/employees/{id}/roles', '/people/entra-sync/run', '/people/entra-sync/status'].sort(),
  )
  assert.deepEqual([...api.matchAll(/api\s*\.put(?:<[^>]*>)?\(\s*[`']([^`']+)/g)].map((m) => m[1].replace(/\$\{[^}]*\}/g, '{id}')), ['/people/employees/{id}/roles'])
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

test('every in-app link points somewhere real', () => {
  const targets = new Set()
  for (const f of tsx) {
    for (const m of readSrc(f).matchAll(/<Link[^>]*\bto=(?:"([^"]*)"|\{`([^`]*)`\})/g)) targets.add((m[1] ?? m[2]).replace(/\$\{[^}]*\}/g, '{id}'))
  }
  for (const t of targets) assert.ok(/^\/(people|settings|company-calendar)/.test(t), t)
  for (const needed of ['/people/new', '/people/import', '/people', '/settings?tab=catalogs', '/company-calendar']) assert.ok(targets.has(needed) || [...targets].some((x) => x.startsWith(needed)), needed)
})

test('no token, secret or storage anywhere; files go as multipart bodies; the template is a blob (never a URL with a token)', () => {
  for (const f of files) {
    const src = strip(readSrc(f))
    assert.ok(!/access_token|accessToken|refresh_token|refreshToken|[?&]token=|localStorage|sessionStorage|document\.cookie/.test(src), `${f} touches tokens or storage`)
    assert.ok(!/window\.open\(|location\.href\s*=|<iframe|<embed|<object|dangerouslySetInnerHTML|innerHTML/.test(src), `${f} opens something by URL or injects HTML`)
    assert.ok(!/console\.(log|error|warn|debug)/.test(src), `${f} logs`)
  }
  const api = readSrc('modules/peoplemgmt/api.ts')
  assert.ok(/responseType: 'blob'/.test(api) && /new FormData\(\)/.test(api))
  assert.ok(/URL\.createObjectURL/.test(readSrc('modules/peoplemgmt/logic.ts')) && /revokeObjectURL/.test(readSrc('modules/peoplemgmt/logic.ts')))
})

test('the import page never keeps or shows a cell value: the file text is only handed to peekCsv (names and a line count)', () => {
  const page = readSrc('modules/peoplemgmt/ImportPage.tsx')
  assert.equal((page.match(/\.text\(\)/g) || []).length, 1)
  assert.ok(/peekCsv\(await next\.text\(\)\)/.test(page))
  const view = readSrc('modules/peoplemgmt/ImportReportView.tsx')
  assert.ok(!/\bcells?\b|\bvalue\b|file\.text|FileReader/.test(strip(view)), 'the report only renders what the API returned about a row')
  const logic = readSrc('modules/peoplemgmt/logic.ts')
  assert.ok(/IMPORT_FORMULA_NOTE/.test(page) && /rejected/.test(logic))
})

test('the explanations the brief asks for are on the pages', () => {
  const create = readSrc('modules/peoplemgmt/PersonNew.tsx')
  assert.ok(/No password is created or stored/.test(create) && /Microsoft work account/.test(create) && /Can sign in with Microsoft/.test(create))
  const fields = readSrc('modules/peoplemgmt/PersonFields.tsx')
  assert.ok(/No year is stored/.test(fields) && /MM-DD/.test(fields) && /set by configuration/.test(fields))
  const dialogs = readSrc('modules/peoplemgmt/PersonDialogs.tsx')
  assert.ok(/signed out immediately/.test(dialogs) && /history stays/i.test(dialogs))
  const logic = readSrc('modules/peoplemgmt/logic.ts')
  assert.ok(/NOT recalculated/.test(logic) && /leave day-counting/i.test(logic))
})

test('Settings has real links to the new pages and kept its read-only contract', () => {
  const cat = readSrc('modules/settings/CatalogsTab.tsx')
  assert.ok(/to: '\/settings\/holidays'/.test(cat) && /to: '\/people'/.test(cat))
  assert.ok(/<Link to=\{c\.to\}/.test(cat) && !/(put|post|patch|delete)\(/i.test(cat))
  const users = readSrc('modules/settings/UsersTab.tsx')
  assert.ok(/<Link[^>]*to="\/people"[^>]*>\s*Manage people/.test(users))
  assert.ok(!/api\.(put|post|patch|delete)|settingsApi\.save|<select|contentEditable/i.test(users))
})

test('the module changes no shared file: it imports only shared helpers it may use', () => {
  const allowed = [/^react/, /^lucide-react/, /^@\/api\/(client|directory|profile)$/, /^@\/components\/Avatar$/, /^@\/lib\/dates$/, /^@\/pages\/(PageTitle|pages\.css)$/, /^@\/ui\/(Feedback|EmptyState)$/, /^\.\/?/, /^\.\.\/registry$/]
  for (const f of files) {
    for (const m of readSrc(f).matchAll(/from\s+['"]([^'"]+)['"]|import\s+['"]([^'"]+)['"]/g)) {
      const spec = m[1] ?? m[2]
      assert.ok(allowed.some((r) => r.test(spec)), `${f} imports ${spec}`)
    }
  }
})
