// Source guards for the Settings module and the dashboard source switch: no dead buttons, no role-name permission checks,
// no dead links, no secrets in URLs, HR controls driven by the server's answers.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { listSrc, readSrc } from './helpers/load-ts.mjs'

const root = path.join(process.cwd(), 'src')
const settingsFiles = listSrc('modules/settings', ['.tsx', '.ts']).map((f) => path.relative(root, f).replace(/\\/g, '/'))
const ROLE_LITERAL = /['"`](Employee|Manager|HRAdmin|Finance)['"`]/

function deadButtons(source) {
  const bad = []
  const re = /<button\b([\s\S]*?)>/g
  let m
  while ((m = re.exec(source))) if (!/onClick\s*=|type=["']submit["']|\bdisabled\b/.test(m[1])) bad.push(m[1].trim().slice(0, 80))
  return bad
}

test('settings module has the expected files and exactly one route (settings)', () => {
  for (const f of ['SettingsPage.tsx', 'PreferencesTab.tsx', 'AccountTab.tsx', 'HrSettingsTab.tsx', 'UsersTab.tsx', 'CatalogsTab.tsx', 'api.ts', 'logic.ts', 'routes.tsx']) {
    assert.ok(settingsFiles.includes(`modules/settings/${f}`), f)
  }
  const routes = readSrc('modules/settings/routes.tsx')
  assert.equal((routes.match(/path:/g) || []).length, 1)
  assert.ok(/path: 'settings'/.test(routes))
})

test('no dead buttons in the settings module or the dashboard', () => {
  for (const f of [...settingsFiles, 'pages/hr/HrAdministration.tsx']) assert.deepEqual(deadButtons(readSrc(f)), [], f)
})

test('permissions come from the server: no role-name literals and no roles read for decisions in the settings module', () => {
  for (const f of settingsFiles) {
    const src = readSrc(f)
    // (The display-label map inside rolesText() names roles to print them; it decides nothing.)
    assert.ok(!ROLE_LITERAL.test(src.replace(/const label: Record<string, string> = \{[^}]*\}/, '')), `${f} uses a role-name literal`)
    assert.ok(!/hasAnyRole|includes\(['"]HRAdmin/.test(src), `${f} checks a role`)
  }
  // The dashboard page asks the server too (403 -> restricted state).
  const dash = readSrc('pages/hr/HrAdministration.tsx')
  assert.ok(!ROLE_LITERAL.test(dash) && !/\.roles\b/.test(dash))
})

test('roles are only ever DISPLAYED: every .roles read in a component is an argument of rolesText()', () => {
  for (const f of settingsFiles.filter((x) => x.endsWith('.tsx'))) {
    const src = readSrc(f)
    for (const m of src.matchAll(/[\w?.]*\.roles\b/g)) {
      const before = src.slice(Math.max(0, m.index - 12), m.index)
      assert.ok(/rolesText\($/.test(before), `${f}: roles used outside rolesText(): ${m[0]}`)
    }
  }
})

test('HR tabs are offered from the server answer to GET /settings, and the users table has no edit controls', () => {
  const page = readSrc('modules/settings/SettingsPage.tsx')
  assert.ok(/settingsApi[\s\S]{0,20}\.settings\(\)/.test(page))
  assert.ok(/availableTabs\(access\)/.test(page))
  const users = readSrc('modules/settings/UsersTab.tsx')
  assert.ok(!/api\.(put|post|patch|delete)|settingsApi\.save|<select|contentEditable/i.test(users), 'users tab is read-only')
  assert.ok(!/(put|post|patch|delete)\(/i.test(readSrc('modules/settings/CatalogsTab.tsx')), 'catalogs tab only links')
  // The API module has no call that creates, edits or deletes users or roles.
  const api = readSrc('modules/settings/api.ts')
  assert.ok(!/['"`]\/settings\/users['"`][^\n]*\b(put|post|patch|delete)\b/i.test(api))
  assert.ok(!/\bdelete\(/.test(api))
})

test('every link has a real in-app destination (no #, no empty, no javascript:), catalog links match the catalog list', () => {
  for (const f of settingsFiles) {
    const src = readSrc(f)
    assert.ok(!/href=["']#["']|href=["']["']|javascript:/i.test(src), f)
    assert.ok(!/<a\b/.test(src), `${f} should use router Links`)
    for (const m of src.matchAll(/<Link[^>]*\bto="([^"]*)"/g)) assert.ok(m[1].startsWith('/'), `${f}: ${m[1]}`)
  }
  const tab = readSrc('modules/settings/CatalogsTab.tsx')
  assert.ok(/<Link to=\{c\.to\}/.test(tab))
})

test('the dashboard has no data-source switch, ribbon or demo notice; its one directory link is wired', () => {
  const dash = readSrc('pages/hr/HrAdministration.tsx')
  assert.ok(!/SourceSwitch|setDashboardSource|demo-ribbon|live-ribbon|demoNotice/.test(dash))
  assert.ok(!fs.existsSync(path.join(root, 'modules/settings/SourceSwitch.tsx')))
  assert.ok(/action="Go to Directory" actionTo="\/directory"/.test(dash))
})

test('settings API: PUT calls exist only for the three documented writes; nothing puts credentials in a URL or storage', () => {
  const api = readSrc('modules/settings/api.ts')
  const puts = [...api.matchAll(/api\.put<[^>]*>\('([^']+)'/g)].map((m) => m[1]).sort()
  assert.deepEqual(puts, ['/preferences/me', '/settings', '/settings/work-schedule']) // my preferences, the HR mood switch, the HR work schedule
  for (const f of settingsFiles) {
    const src = readSrc(f)
    assert.ok(!/localStorage|sessionStorage|document\.cookie/.test(src), `${f} touches storage`)
    assert.ok(!/access_token|refresh_token|\?token=/.test(src), `${f} mentions a token`)
  }
})

test('the settings module imports no other module and edits no shared file (it only reads shared api/ui)', () => {
  for (const f of settingsFiles) {
    const src = readSrc(f)
    for (const m of src.matchAll(/from '(@\/modules\/[^']+|\.\.\/(?!registry)[^']+)'/g)) assert.fail(`${f} imports another module: ${m[1]}`)
  }
})
