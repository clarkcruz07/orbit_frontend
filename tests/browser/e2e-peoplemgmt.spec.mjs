// REAL-BACKEND end-to-end for People management and Holidays admin: the real backend (in-memory DB, demo auth) on a random port in
// 8101-8199 plus the built app, driven through system Chrome. Fictional demo data only. Gated: RUN_BROWSER_TESTS=1.
//   * HR adds a person (the account has NO password), edits them, sets roles (and the change reaches a live session);
//   * an HR administrator cannot change their own roles, the last one cannot be deactivated (the server's reason is shown);
//   * deactivating someone with direct reports needs a new manager;
//   * a deactivated person's existing session stops working, reactivation restores them;
//   * CSV import: dry run vs real run with good and bad rows (including formula-like cells);
//   * employee / manager / finance get 403 from the API and "not available" on the pages;
//   * holidays CRUD and its effect on the calendar and on the leave day-count preview, duplicate 409.
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { launchBrowser } from './browser-env.mjs'
import { PEOPLE, demoPassword } from './real-backend.mjs'
import { apiCall, apiLogin, actor, pageApi, text, waitText } from './e2e-helpers.mjs'
import { startPeopleStack } from './peoplemgmt-real-stack.mjs'
import { enabled, opts } from './peoplemgmt-helpers.mjs'

let stack
let browser
let anna
before(async () => {
  if (!enabled) return
  browser = await launchBrowser()
  stack = await startPeopleStack()
  anna = await actor(browser, stack.origin, PEOPLE.anna)
})
after(async () => {
  await anna?.close().catch(() => undefined)
  await browser?.close()
  await stack?.close()
})

const HEAD = 'name,email,job_title,department,employment_type,manager_email,start_date,birthday,roles,can_sign_in\n'
const csv = (name, body) => ({ name, mimeType: 'text/csv', buffer: Buffer.from(body, 'utf8') })

async function loginStatus(email, password = demoPassword()) {
  const r = await fetch(`${stack.origin}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })
  return r.status
}
const annaApi = (method, path, body) => pageApi(anna.page, stack.origin, method, path, body)
const openAs = async (page, p, ready) => {
  await page.goto(`${stack.origin}${p}`)
  await page.waitForSelector(ready)
}
const personByEmail = async (email) => (await annaApi('GET', `/people/employees?q=${encodeURIComponent(email)}`)).json.items.find((x) => x.employee.email === email.toLowerCase())

test('Anna adds a person: the account has no password, then edits them and sets roles', opts, async () => {
  const email = 'nina.valdez@newhire.bluedge-people.test'
  const p = anna.page
  await openAs(p, '/people/new', '[data-testid=person-form]')
  assert.match(await text(p, '[data-testid=sign-in-explain]'), /No password is created or stored/)
  await p.fill('[data-testid=input-name]', 'Nina Valdez')
  await p.fill('[data-testid=input-email]', email)
  await p.fill('[data-testid=input-job_title]', 'Analyst')
  await p.fill('[data-testid=input-department]', 'Operations')
  await p.fill('[data-testid=input-start_date]', '2026-12-01')
  await p.fill('[data-testid=input-birthday]', '03-27')
  await p.fill('[data-testid=manager-input]', 'Miguel')
  await p.click('[data-testid=manager-option]')
  assert.equal(await text(p, '[data-testid=manager-chosen-name]'), 'Miguel Santos')
  await p.check('[data-testid=role-Manager]')
  await p.click('[data-testid=create-person]')
  await p.waitForSelector('[data-testid=person-detail]')
  const id = p.url().split('/').pop()
  assert.match(id, /^EMP-/)
  assert.match(await text(p, '[data-testid=detail-notice]'), /Person added/)
  assert.match(await text(p, '[data-testid=account-source]'), /Microsoft work account \(created by HR\)/)
  assert.match(await text(p, '[data-testid=account-roles]'), /Employee, Manager/)
  assert.match(await text(p, '[data-testid=no-password-note]'), /No password is created or stored/)
  assert.match(await text(p, '[data-testid=fact-manager]'), /Miguel Santos/)
  assert.match(await text(p, '[data-testid=fact-birthday]'), /27 Mar/)
  // The account has no password: a password sign-in fails (generic 401), with the demo password and with an empty-ish one.
  assert.equal(await loginStatus(email), 401)
  assert.equal(await loginStatus(email, 'password123'), 401)
  // The server's view matches.
  const saved = (await annaApi('GET', `/people/employees/${id}`)).json
  assert.equal(saved.employee.email, email)
  assert.equal(saved.employee.manager_id, 'EMP-0002')
  assert.equal(saved.employee.birthday, '03-27')
  assert.equal(saved.account.source, 'hr_created')
  assert.deepEqual(saved.account.roles, ['Employee', 'Manager'])
  // A second person with the same e-mail (other letter case): 409 on the e-mail field.
  await openAs(p, '/people/new', '[data-testid=person-form]')
  await p.fill('[data-testid=input-name]', 'Nina Again')
  await p.fill('[data-testid=input-email]', email.toUpperCase())
  await p.fill('[data-testid=input-job_title]', 'Analyst')
  await p.fill('[data-testid=input-department]', 'Operations')
  await p.click('[data-testid=create-person]')
  await p.waitForSelector('[data-testid=field-email-error]')
  assert.match(await text(p, '[data-testid=field-email-error]'), /already used by another person or account/)
  // Edit: title, department, employment type, clear the manager.
  await openAs(p, `/people/${id}`, '[data-testid=person-detail]')
  await p.click('[data-testid=edit-details]')
  await p.fill('[data-testid=input-job_title]', 'Senior Analyst')
  await p.fill('[data-testid=input-department]', 'Finance')
  await p.selectOption('[data-testid=input-employment_type]', 'contractor')
  await p.click('[data-testid=manager-clear]')
  await p.click('[data-testid=save-details]')
  await waitText(p, '[data-testid=detail-notice]', /Details saved/)
  const edited = (await annaApi('GET', `/people/employees/${id}`)).json.employee
  assert.equal(edited.job_title, 'Senior Analyst')
  assert.equal(edited.department, 'Finance')
  assert.equal(edited.employment_type, 'contractor')
  assert.equal(edited.manager_id, null)
  assert.match(await text(p, '[data-testid=fact-manager]'), /No manager/)
  // Roles: add Finance.
  await p.check('[data-testid=role-Finance]')
  await p.click('[data-testid=save-roles]')
  await waitText(p, '[data-testid=detail-notice]', /Roles saved/)
  assert.match(await text(p, '[data-testid=account-roles]'), /Employee, Manager, Finance/)
  assert.deepEqual((await annaApi('GET', `/people/employees/${id}`)).json.account.roles, ['Employee', 'Manager', 'Finance'])
  // The list shows them (search is literal on the server).
  await openAs(p, '/people?q=nina.valdez', '[data-testid=people-row]')
  assert.equal(await p.locator('[data-testid=people-row]').count(), 1)
  assert.match(await text(p, '[data-testid=people-row]'), /Can sign in/)
  assert.deepEqual(anna.pageErrors, [])
})

test('a role change reaches a live session on its next request (Jamie becomes a manager and back)', opts, async () => {
  const jamie = await actor(browser, stack.origin, PEOPLE.jamie)
  try {
    assert.equal((await pageApi(jamie.page, stack.origin, 'GET', '/reimbursements?scope=review')).status, 403)
    const p = anna.page
    await openAs(p, '/people/EMP-0005', '[data-testid=account-card]')
    assert.match(await text(p, '[data-testid=account-source]'), /Local account/)
    await p.check('[data-testid=role-Manager]')
    await p.click('[data-testid=save-roles]')
    await waitText(p, '[data-testid=detail-notice]', /Roles saved/)
    assert.equal((await pageApi(jamie.page, stack.origin, 'GET', '/reimbursements?scope=review')).status, 200, 'same session, next request: the new role applies')
    await p.uncheck('[data-testid=role-Manager]')
    await p.click('[data-testid=save-roles]')
    await waitText(p, '[data-testid=account-roles]', /^Employee$/)
    assert.equal((await pageApi(jamie.page, stack.origin, 'GET', '/reimbursements?scope=review')).status, 403)
  } finally {
    await jamie.close()
  }
})

test('an HR Administrator cannot change their OWN roles, and the last HR Administrator cannot be deactivated: the server reason is shown', opts, async () => {
  const p = anna.page
  await openAs(p, '/people/EMP-0001', '[data-testid=account-card]')
  await p.check('[data-testid=role-Finance]')
  await p.click('[data-testid=save-roles]')
  await p.waitForSelector('[data-testid=account-error]')
  assert.equal((await text(p, '[data-testid=account-error]')).trim(), 'You cannot change your own roles')
  const roles = (await annaApi('GET', '/people/employees/EMP-0001')).json.account.roles
  assert.ok(roles.includes('HRAdmin') && !roles.includes('Finance'), `Anna's roles are unchanged: ${roles}`)
  // Deactivate herself (she is the only HR administrator).
  await openAs(p, '/people/EMP-0001', '[data-testid=person-detail]')
  await p.click('[data-testid=deactivate]')
  await p.click('[data-testid=deactivate-confirm]')
  await p.waitForSelector('[data-testid=dialog-error]')
  assert.match(await text(p, '[data-testid=dialog-error]'), /last active HR administrator/i)
  assert.ok(await p.locator('[data-testid=deactivate-dialog]').isVisible())
  await p.click('[data-testid=dialog-cancel]')
  const me = (await annaApi('GET', '/people/employees/EMP-0001')).json
  assert.equal(me.employee.status, 'active')
  assert.equal(me.account.can_sign_in, true)
  // Switching off her own sign-in is refused the same way.
  await p.click('[data-testid=turn-off-sign-in]')
  await p.click('[data-testid=signin-off-confirm]')
  await p.waitForSelector('[data-testid=dialog-error]')
  assert.match(await text(p, '[data-testid=dialog-error]'), /last active HR administrator/i)
  await p.click('[data-testid=dialog-cancel]')
  assert.equal((await annaApi('GET', '/auth/me')).status, 200)
})

test('deactivating someone with direct reports needs a new manager; the reports move and the leaver is signed out of history, not deleted', opts, async () => {
  const mk = async (body) => (await annaApi('POST', '/people/employees', body))
  const boss = await mk({ name: 'Manny Boss', email: 'manny.boss@newhire.bluedge-people.test', job_title: 'Team Lead', department: 'Operations', employment_type: 'full_time', roles: ['Manager'], can_sign_in: true })
  assert.equal(boss.status, 201)
  const bossId = boss.json.employee.employee_id
  const rita = await mk({ name: 'Rita Vega', email: 'rita.vega@newhire.bluedge-people.test', job_title: 'Coordinator', department: 'Operations', employment_type: 'full_time', manager_id: bossId, can_sign_in: false })
  assert.equal(rita.status, 201)
  const p = anna.page
  await openAs(p, `/people/${bossId}`, '[data-testid=person-detail]')
  await p.click('[data-testid=deactivate]')
  await p.waitForSelector('[data-testid=deactivate-dialog]')
  await p.click('[data-testid=deactivate-confirm]')
  await p.waitForSelector('[data-testid=reassign-step]')
  assert.match(await text(p, '[data-testid=reassign-step]'), /1 active person reports to Manny Boss/)
  assert.equal(await p.isDisabled('[data-testid=deactivate-confirm]'), true)
  // Nothing happened yet.
  assert.equal((await annaApi('GET', `/people/employees/${bossId}`)).json.employee.status, 'active')
  await p.fill('[data-testid=reassign-input]', 'Carla')
  await p.click('[data-testid=reassign-option]')
  await p.click('[data-testid=deactivate-confirm]')
  await waitText(p, '[data-testid=detail-notice]', /1 person now reports to Carla Mendoza/)
  const left = (await annaApi('GET', `/people/employees/${bossId}`)).json
  assert.equal(left.employee.status, 'left')
  assert.ok(left.employee.end_date)
  assert.equal(left.account.can_sign_in, false)
  assert.equal(left.account.disabled_reason, 'deactivated')
  assert.equal((await annaApi('GET', `/people/employees/${rita.json.employee.employee_id}`)).json.employee.manager_id, 'EMP-0003')
  // Still in the HR list (never deleted), marked as left.
  await openAs(p, '/people?q=manny.boss&status=left', '[data-testid=people-row]')
  assert.match(await text(p, '[data-testid=people-row]'), /Left/)
  assert.match(await text(p, '[data-testid=people-row]'), /Deactivated/)
})

test("a deactivated person's existing session stops working and the app returns them to sign-in; reactivation restores them", opts, async () => {
  const liaEmail = PEOPLE.lia
  const lia = await actor(browser, stack.origin, liaEmail)
  try {
    assert.equal((await pageApi(lia.page, stack.origin, 'GET', '/auth/me')).status, 200)
    const p = anna.page
    await openAs(p, '/people/EMP-0008', '[data-testid=person-detail]')
    await p.click('[data-testid=deactivate]')
    const t = await text(p, '[data-testid=deactivate-consequences]')
    assert.match(t, /signed out immediately/)
    await p.click('[data-testid=deactivate-confirm]')
    await waitText(p, '[data-testid=detail-notice]', /was deactivated and signed out/)
    // Lia's next request is refused (token and refresh both stop working) ...
    assert.equal((await pageApi(lia.page, stack.origin, 'GET', '/auth/me')).status, 401)
    assert.equal(await loginStatus(liaEmail), 401)
    // ... and the app sends her back to sign-in.
    await lia.page.goto(`${stack.origin}/company-calendar`)
    await lia.page.waitForURL(/\/login/)
    await lia.page.waitForSelector('#email')
    assert.equal(await lia.page.evaluate(() => localStorage.getItem('people.accessToken')), null)
    // Reactivate: she can sign in again with her own password.
    assert.equal((await annaApi('GET', '/people/employees/EMP-0008')).json.account.disabled_reason, 'deactivated')
    await p.click('[data-testid=reactivate]')
    await p.waitForSelector('[data-testid=reactivate-dialog]')
    await p.click('[data-testid=reactivate-confirm]')
    await waitText(p, '[data-testid=detail-notice]', /is active again/)
    assert.equal(await p.getAttribute('[data-testid=person-detail]', 'data-status'), 'active')
    assert.equal(await loginStatus(liaEmail), 200)
    const again = await actor(browser, stack.origin, liaEmail)
    assert.equal((await pageApi(again.page, stack.origin, 'GET', '/auth/me')).status, 200)
    await again.close()
  } finally {
    await lia.close()
  }
})

test('CSV import: the dry run writes nothing, the real run creates exactly what was reported; formula-like cells are rejected; no cell is echoed', opts, async () => {
  const D = 'import.bluedge-people.test'
  const rows = [
    `Pat One,pat.one@${D},Analyst,Operations,full_time,miguel.santos@demo.bluedge-people.test,2026-12-01,03-27,Manager;Finance,true`,
    `Pat Two,pat.two@${D},Analyst,Operations,intern,pat.one@${D},,,,false`,
    `=HYPERLINK("http://evil.test"),pat.three@${D},Analyst,Operations,full_time,,,,,`,
    `Pat Four,pat.four@${D},+cmd|calc,Operations,full_time,,,,,`,
    `Pat Five,not-an-email,Analyst,Operations,full_time,,,,,`,
    `Pat Six,pat.six@${D},Analyst,Operations,full_time,nobody@${D},,,,`,
    `Already Here,anna.reyes@demo.bluedge-people.test,Analyst,Operations,full_time,,,,,`,
    `Pat Dup,pat.one@${D},Analyst,Operations,full_time,,,,,`,
    `Pat Seven,pat.seven@${D},Analyst,Operations,bogus,,,,,`,
  ]
  const p = anna.page
  await openAs(p, '/people/import', '[data-testid=import-page]')
  await p.setInputFiles('[data-testid=import-file]', csv('people.csv', HEAD + rows.join('\n') + '\n'))
  await p.click('[data-testid=check-file]')
  await p.waitForSelector('[data-testid=import-report]')
  assert.equal(await p.getAttribute('[data-testid=import-report]', 'data-dry-run'), 'true')
  const dry = await text(p, '[data-testid=report-summary]')
  assert.match(dry, /9 rows read: 2 would be created, 2 skipped, 5 invalid\./)
  // Nothing was written by the dry run.
  assert.equal((await annaApi('GET', `/people/employees?q=${D}`)).json.total, 0)
  await p.click('[data-testid=report-filter-all]')
  const statuses = await p.$$eval('[data-testid=report-row]', (els) => els.map((e) => `${e.getAttribute('data-status')}:${e.getAttribute('data-reason')}`))
  assert.deepEqual(statuses, ['created:', 'created:', 'invalid:validation', 'invalid:validation', 'invalid:validation', 'invalid:manager_not_found', 'skipped:email_exists', 'skipped:duplicate_in_file', 'invalid:validation'])
  const report = await text(p, '[data-testid=import-report]')
  assert.match(report, /Name must not start with = \+ - or @/)
  assert.match(report, /Job title must not start with = \+ - or @/)
  assert.ok(!/HYPERLINK|evil\.test|cmd\|calc|pat\.one@|pat\.five|not-an-email|nobody@/i.test(report), 'no cell value is echoed')
  assert.equal((await text(p, '[data-testid=run-import]')).trim(), 'Import 2 people')
  // Real run.
  await p.click('[data-testid=run-import]')
  await p.waitForSelector('[data-testid=import-done]')
  assert.equal(await p.getAttribute('[data-testid=import-report]', 'data-dry-run'), 'false')
  assert.match(await text(p, '[data-testid=report-summary]'), /9 rows read: 2 created, 2 skipped, 5 invalid\./)
  const list = (await annaApi('GET', `/people/employees?q=${D}`)).json
  assert.equal(list.total, 2, 'exactly the two reported people exist')
  const one = list.items.find((x) => x.employee.email === `pat.one@${D}`)
  const two = list.items.find((x) => x.employee.email === `pat.two@${D}`)
  assert.deepEqual(one.account.roles, ['Employee', 'Manager', 'Finance'])
  assert.equal(one.employee.manager_id, 'EMP-0002')
  assert.equal(two.account.has_account, false)
  assert.equal(two.employee.manager_id, one.employee.employee_id, 'a manager can be another row of the same file')
  assert.equal(await loginStatus(`pat.one@${D}`), 401, 'imported accounts have no password')
  await p.click('[data-testid=report-filter-created]')
  assert.equal(await p.locator('[data-testid=report-open]').count(), 2)
  await p.click('[data-testid=report-open]')
  await p.waitForSelector('[data-testid=person-detail]')
  // Whole-file errors from the real service.
  await openAs(p, '/people/import', '[data-testid=import-page]')
  await p.setInputFiles('[data-testid=import-file]', csv('cols.csv', 'name,email\nA,a@example.test\n'))
  await p.click('[data-testid=check-file]')
  await p.waitForSelector('[data-testid=import-error]')
  assert.match(await text(p, '[data-testid=import-error]'), /header row is missing: job_title, department, employment_type/)
  await p.setInputFiles('[data-testid=import-file]', csv('empty.csv', ''))
  assert.match(await text(p, '[data-testid=file-hint]'), /empty/)
  assert.equal(await p.isDisabled('[data-testid=check-file]'), true)
  await p.setInputFiles('[data-testid=import-file]', csv('nothing.csv', HEAD))
  await p.click('[data-testid=check-file]')
  await waitText(p, '[data-testid=import-error]', /no people in it|empty/i)
})

test('CSV import: the downloadable template is the header row only', opts, async () => {
  const p = anna.page
  await openAs(p, '/people/import', '[data-testid=import-page]')
  const [download] = await Promise.all([p.waitForEvent('download'), p.click('[data-testid=download-template]')])
  assert.equal(download.suggestedFilename(), 'employee_import_template.csv')
  let body = ''
  for await (const chunk of await download.createReadStream()) body += chunk
  // The template is the header row only: one line that starts with the original columns (required first) and carries the optional profile columns after them.
  const lines = body.trim().split(/\r?\n/)
  assert.equal(lines.length, 1, 'a single header row, no data')
  const header = lines[0].split(',')
  assert.ok(lines[0].startsWith(HEAD.trim()), `the original columns come first: ${lines[0].slice(0, 120)}`)
  const PROFILE = ['preferred_name', 'gender', 'civil_status', 'nationality', 'birth_year', 'personal_email', 'mobile', 'address_line1', 'address_line2', 'city', 'province', 'postal_code', 'country', 'emergency_name', 'emergency_relationship', 'emergency_phone', 'employee_number', 'company', 'office_location', 'work_arrangement', 'probation_end_date', 'regularization_date', 'tin', 'sss', 'philhealth', 'pagibig']
  for (const c of PROFILE) assert.ok(header.includes(c), `template has the ${c} column`)
  assert.equal(new Set(header).size, header.length, 'no column twice')
  assert.ok(header.indexOf('pagibig') > header.indexOf('can_sign_in'), 'optional profile columns follow the original ones')
})

test('employee, manager and finance: the API answers 403 and every People page says "not available"; reading holidays stays open', opts, async () => {
  for (const [who, email] of [['employee', PEOPLE.jamie], ['manager', PEOPLE.miguel], ['finance', PEOPLE.paolo]]) {
    const a = await actor(browser, stack.origin, email)
    try {
      for (const [method, path, body] of [
        ['GET', '/people/employees'],
        ['GET', '/people/employees/EMP-0001'],
        ['POST', '/people/employees', { name: 'X', email: 'x@x.test', job_title: 'T', department: 'D', employment_type: 'full_time' }],
        ['PATCH', '/people/employees/EMP-0001', { name: 'Hacked' }],
        ['POST', '/people/employees/EMP-0001/deactivate', {}],
        ['PUT', '/people/employees/EMP-0001/roles', { roles: ['HRAdmin'] }],
        ['GET', '/people/employees/import/template'],
        ['POST', '/holidays', { name: 'Nope', date: '2026-12-25' }],
        ['GET', '/holidays?include_inactive=true'],
      ]) {
        const r = await pageApi(a.page, stack.origin, method, path, body)
        assert.equal(r.status, 403, `${who} ${method} ${path} -> ${r.status}`)
      }
      assert.equal((await pageApi(a.page, stack.origin, 'GET', '/holidays')).status, 200, `${who} may read the holidays`)
      for (const [path, ready] of [
        ['/people', '[data-testid=people-denied]'],
        ['/people/new', '[data-testid=new-denied]'],
        ['/people/import', '[data-testid=import-denied]'],
        ['/people/EMP-0001', '[data-testid=person-denied]'],
        ['/settings/holidays', '[data-testid=holidays-denied]'],
      ]) {
        await openAs(a.page, path, ready)
        assert.match(await text(a.page, ready), /not available/i, `${who} ${path}`)
      }
      assert.deepEqual(a.pageErrors, [])
    } finally {
      await a.close()
    }
  }
  // Nothing was changed by those refused calls.
  assert.equal((await annaApi('GET', '/people/employees/EMP-0001')).json.employee.name, 'Anna Reyes')
})

test('holidays: CRUD, its effect on the calendar and on the leave day-count preview (a holiday weekday is not counted), duplicate 409', opts, async () => {
  // A Wednesday about three weeks ahead (inside the leave date window) and the Wednesday after it.
  const base = new Date()
  base.setDate(base.getDate() + 21)
  while (base.getDay() !== 3) base.setDate(base.getDate() + 1)
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const D = iso(base)
  const next = new Date(base)
  next.setDate(next.getDate() + 7)
  const E = iso(next)
  const year = base.getFullYear()
  const preview = async (who, start, end = start) => (await pageApi(who.page, stack.origin, 'GET', `/leave/preview?type_id=vacation&start_date=${start}&end_date=${end}`)).json
  const calendar = async (who, date) => (await pageApi(who.page, stack.origin, 'GET', `/calendar?month=${date.slice(0, 7)}`)).json
  const NAME = 'Founders Day (test)'
  const jamie = await actor(browser, stack.origin, PEOPLE.jamie)
  try {
    // Before: HR has no holidays yet and D is an ordinary working day.
    const before0 = await preview(jamie, D)
    assert.equal(before0.days, 1)
    assert.deepEqual(before0.holidays, [])
    const cal0 = await calendar(jamie, D)
    assert.ok(!('demo' in cal0) && !('demo_notice' in cal0), 'no demo keys any more')
    assert.ok(!cal0.events.some((e) => e.title === NAME))

    const p = anna.page
    await openAs(p, `/settings/holidays?year=${year}`, '[data-testid=holidays-empty-note]')
    assert.match(await text(p, '[data-testid=holidays-empty-note]'), /no day is treated as a holiday/)
    // Add D as a one-off company holiday.
    await p.click('[data-testid=add-holiday]')
    await p.fill('[data-testid=holiday-name]', NAME)
    await p.fill('[data-testid=holiday-date]', D)
    await p.click('[data-testid=save-holiday]')
    await waitText(p, '[data-testid=holiday-notice]', /Holiday added/)
    await p.waitForSelector('[data-testid=holiday-row]')
    assert.equal(await p.locator('[data-testid=holidays-empty-note]').count(), 0, 'with a holiday on the list the empty note is gone')
    assert.match(await text(p, '[data-testid=holidays-table]'), new RegExp(NAME.replace(/[()]/g, '\\$&')))
    // Effect: the day is no longer counted for leave, and it is on the calendar as a company holiday.
    const after1 = await preview(jamie, D)
    assert.equal(after1.days, 0, 'a weekday made a holiday is not counted')
    assert.deepEqual(after1.holidays.map((h) => [h.date, h.title]), [[D, NAME]])
    assert.ok(after1.issues.some((i) => i.code === 'no_working_days'))
    const span = new Date(base)
    span.setDate(span.getDate() - 1)
    const spanEnd = new Date(base)
    spanEnd.setDate(spanEnd.getDate() + 1)
    const around = await preview(jamie, iso(span), iso(spanEnd))
    assert.equal(around.days, 2, 'Tuesday and Thursday count, the holiday Wednesday does not')
    const cal1 = await calendar(jamie, D)
    assert.ok(!('demo' in cal1), 'no demo keys any more')
    const ev = cal1.events.find((e) => e.title === NAME)
    assert.ok(ev && ev.date === D && ev.type === 'holiday')
    assert.equal(ev.subtitle, 'Company Holiday')
    // The calendar page shows it to a regular employee.
    await jamie.page.goto(`${stack.origin}/company-calendar?month=${D.slice(0, 7)}`)
    await jamie.page.waitForFunction((n) => document.body.textContent.includes(n), NAME)
    // Duplicate: same name (other letter case) on the same day -> 409 with a clear message.
    await p.click('[data-testid=add-holiday]')
    await p.fill('[data-testid=holiday-name]', NAME.toUpperCase())
    await p.fill('[data-testid=holiday-date]', D)
    await p.click('[data-testid=save-holiday]')
    await p.waitForSelector('[data-testid=holiday-form-error]')
    assert.equal((await text(p, '[data-testid=holiday-form-error]')).trim(), 'A holiday with this name already exists on that day.')
    await p.click('[data-testid=cancel-holiday]')
    // Edit: move it to E (the following Wednesday) and make it a public holiday.
    await p.locator('[data-testid=holiday-row]', { hasText: NAME }).locator('[data-testid=edit-holiday]').click()
    await p.fill('[data-testid=holiday-date]', E)
    await p.selectOption('[data-testid=holiday-type]', 'public')
    await p.click('[data-testid=save-holiday]')
    await waitText(p, '[data-testid=holiday-notice]', /Holiday saved/)
    assert.equal((await preview(jamie, D)).days, 1, 'D is a working day again')
    assert.equal((await preview(jamie, E)).days, 0, 'E is the holiday now')
    const cal2 = await calendar(jamie, E)
    assert.equal(cal2.events.find((e) => e.title === NAME)?.subtitle, 'Public Holiday')
    // Deactivate: kept on the list, but not counted.
    await p.locator('[data-testid=holiday-row]', { hasText: NAME }).locator('[data-testid=edit-holiday]').click()
    await p.uncheck('[data-testid=holiday-active]')
    await p.click('[data-testid=save-holiday]')
    await waitText(p, '[data-testid=holiday-notice]', /Holiday saved/)
    assert.equal((await preview(jamie, E)).days, 1)
    await p.waitForSelector('[data-testid=holiday-row][data-active=false]')
    assert.match(await text(p, '[data-testid=holiday-row][data-active=false]'), /Inactive/)
    // Yearly holiday on E's month/day: counted every year.
    await p.click('[data-testid=add-holiday]')
    await p.fill('[data-testid=holiday-name]', 'Yearly Gathering')
    await p.check('[data-testid=holiday-yearly]')
    await p.selectOption('[data-testid=holiday-month]', String(next.getMonth() + 1))
    await p.selectOption('[data-testid=holiday-day]', String(next.getDate()))
    await p.click('[data-testid=save-holiday]')
    await waitText(p, '[data-testid=holiday-notice]', /Holiday added/)
    assert.equal((await preview(jamie, E)).days, 0)
    // Delete both (with the confirmation): the day counts again and the calendar has no holidays again.
    for (const name of ['Yearly Gathering', NAME]) {
      await p.locator('[data-testid=holiday-row]', { hasText: name }).locator('[data-testid=delete-holiday]').click()
      await p.waitForSelector('[data-testid=delete-dialog]')
      assert.match(await text(p, '[data-testid=delete-dialog]'), /not recalculated/)
      await p.click('[data-testid=delete-confirm]')
      await waitText(p, '[data-testid=holiday-notice]', /was deleted/)
    }
    assert.equal((await preview(jamie, E)).days, 1)
    assert.deepEqual((await calendar(jamie, E)).events.filter((e) => e.type === 'holiday'), [], 'with no holiday left the calendar has none (no demo list)')
    await p.waitForSelector('[data-testid=holidays-empty-note]')
    // Existing leave is not recalculated: verified by the contract; here we only assert the page says so.
    assert.match(await text(p, '[data-testid=holidays-usage-note]'), /NOT recalculated/)
    assert.deepEqual(jamie.pageErrors, [])
  } finally {
    await jamie.close()
  }
  void apiCall
  void apiLogin
})
