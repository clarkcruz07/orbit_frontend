// Mock-API browser tests for People management (list, new, detail, deactivate/reactivate, account card, CSV import).
// The mock (peoplemgmt-mock.mjs) plays "the server": every people route is HR only (403 for others) and the guard rails answer
// like the real backend. Gated: RUN_BROWSER_TESTS=1 (use `npm run test:browser`). PEOPLEMGMT_DIST can point at another build.
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { launchBrowser } from './browser-env.mjs'
import { U } from './peoplemgmt-mock.mjs'
import { callsTo, count, hasText, noOverflow, opts, text, withApp, enabled } from './peoplemgmt-helpers.mjs'

let browser
before(async () => {
  if (enabled) browser = await launchBrowser()
})
after(async () => {
  await browser?.close()
})
const app = (user, fn, o) => withApp(browser, user, fn, o)
const csv = (name, body) => ({ name, mimeType: 'text/csv', buffer: Buffer.from(body, 'utf8') })
const HEAD = 'name,email,job_title,department,employment_type,manager_email,start_date,birthday,roles,can_sign_in\n'

// ------------------------------------------------------------------------------------------------ list
test('list: HR sees the table with every column, badges, sorted by name, with Add person and Import CSV', opts, () =>
  app(U.anna, async ({ page, mock, errors, go }) => {
    await go('/people', '[data-testid=people-row]')
    assert.equal(await page.locator('[data-testid=people-row]').count(), 20)
    assert.match(await text(page, '[data-testid=people-count]'), /Showing 1-20 of 30 people/)
    const heads = await page.$$eval('[data-testid=people-table] thead th', (els) => els.map((e) => e.textContent.trim()))
    assert.deepEqual(heads, ['Name', 'Job title and department', 'Employment', 'Status', 'Roles', 'Sign-in', 'Delete'])
    const names = await page.$$eval('[data-testid=people-row] [data-testid=people-open]', (els) => els.map((e) => e.textContent.trim()))
    assert.deepEqual(names, [...names].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())))
    assert.equal(await page.getAttribute('[data-testid=add-person]', 'href'), '/people/new')
    assert.equal(await page.getAttribute('[data-testid=import-csv]', 'href'), '/people/import')
    const anna = page.locator('[data-testid=people-row][data-id=EMP-0001]')
    assert.match(await anna.innerText(), /Anna Reyes/)
    assert.match(await anna.innerText(), /anna\.reyes@example\.test/)
    assert.match(await anna.innerText(), /HR Administrator/)
    assert.match(await anna.innerText(), /Can sign in/)
    assert.match(await anna.innerText(), /Microsoft \(config\)/)
    assert.equal(await page.locator('[data-testid=people-card]').first().isVisible(), false, 'cards are for narrow screens')
    // Paging.
    await page.click('[data-testid=people-next]')
    await hasText(page, '[data-testid=people-page-label]', /Page 2 of 2/)
    assert.equal(new URL(page.url()).searchParams.get('page'), '2')
    assert.equal(await page.locator('[data-testid=people-row]').count(), 10)
    await page.click('[data-testid=people-prev]')
    await hasText(page, '[data-testid=people-page-label]', /Page 1 of 2/)
    assert.equal(new URL(page.url()).searchParams.has('page'), false)
    assert.ok(await noOverflow(page))
    assert.deepEqual(errors, [])
    assert.equal(callsTo(mock, 'GET', '/people/employees').length >= 3, true)
  }))

test('list: a literal search, the status filter and the department filter; clearing filters; an empty result is honest', opts, () =>
  app(U.anna, async ({ page, mock, go }) => {
    await go('/people', '[data-testid=people-row]')
    await page.fill('[data-testid=people-search]', 'garcia')
    await hasText(page, '[data-testid=people-count]', /of 3 people/)
    assert.equal(new URL(page.url()).searchParams.get('q'), 'garcia')
    const rows = await page.$$eval('[data-testid=people-row]', (els) => els.map((e) => e.textContent.toLowerCase()))
    assert.ok(rows.every((r) => r.includes('garcia')))
    // Regex-looking text is literal: nobody matches ".*".
    await page.fill('[data-testid=people-search]', '.*')
    await page.waitForSelector('[data-testid=empty-state]')
    assert.match(await text(page, '[data-testid=empty-state]'), /No one matches your search/)
    await page.click('[data-testid=people-clear]')
    await page.waitForSelector('[data-testid=people-row]')
    assert.equal(await page.inputValue('[data-testid=people-search]'), '')
    // Status filter.
    await page.selectOption('[data-testid=people-status]', 'left')
    await hasText(page, '[data-testid=people-count]', /of 1 person/)
    const left = page.locator('[data-testid=people-row]').first()
    assert.match(await left.innerText(), /Left/)
    assert.match(await left.innerText(), /Deactivated/)
    assert.match(await left.innerText(), /Until 31 Oct 2026/)
    await page.selectOption('[data-testid=people-status]', '')
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=people-row]').length > 1)
    // Department filter: no server parameter exists, so the page asks for the department text and keeps exact matches.
    const finance = mock.state.people.filter((p) => p.employee.department === 'Finance').length
    mock.state.calls.length = 0
    await page.selectOption('[data-testid=people-department]', 'Finance')
    await hasText(page, '[data-testid=people-count]', new RegExp(`of ${finance} people`))
    const depts = await page.$$eval('[data-testid=people-row] td:nth-child(2)', (els) => els.map((e) => e.textContent))
    assert.ok(depts.every((d) => d.includes('Finance')))
    assert.ok(callsTo(mock, 'GET', '/people/employees').some((c) => c.query.q === 'Finance' && c.query.page_size === '50'))
    // Department + search narrows further (exact department AND literal text).
    await page.fill('[data-testid=people-search]', 'dan')
    await hasText(page, '[data-testid=people-count]', /of 1 person/)
  }))

test('list: a row opens the person; on a phone the table becomes cards', opts, () =>
  app(
    U.anna,
    async ({ page, go }) => {
      await go('/people', '[data-testid=people-card]')
      assert.equal(await page.locator('[data-testid=people-table]').isVisible(), false)
      assert.equal(await page.locator('[data-testid=people-card]').first().isVisible(), true)
      assert.ok(await noOverflow(page))
      await page.click('[data-testid=people-card]')
      await page.waitForSelector('[data-testid=person-detail]')
      assert.match(new URL(page.url()).pathname, /^\/people\/EMP-/)
    },
    { viewport: { width: 390, height: 800 } },
  ))

test('list: clicking a table row (not only the name) opens the person', opts, () =>
  app(U.anna, async ({ page, go }) => {
    await go('/people', '[data-testid=people-row]')
    await page.click('[data-testid=people-row][data-id=EMP-0003] td:nth-child(3)')
    await page.waitForSelector('[data-testid=person-detail]')
    assert.equal(new URL(page.url()).pathname, '/people/EMP-0003')
  }))

test('list: loading, error with Try again, and the empty directory are honest states', opts, () =>
  app(
    U.anna,
    async ({ page, mock, go }) => {
      mock.state.delay['GET /people/employees'] = 600
      await page.goto(`${mock.origin}/people`)
      await page.waitForSelector('[data-testid=people-loading]')
      await page.waitForSelector('[data-testid=people-row]')
      mock.state.force['GET /people/employees'] = 500
      await page.selectOption('[data-testid=people-status]', 'active')
      await page.waitForSelector('[data-testid=people-error]')
      assert.match(await text(page, '[data-testid=people-error]'), /Something went wrong on our side/)
      delete mock.state.force['GET /people/employees']
      await page.click('[data-testid=people-error] button')
      await page.waitForSelector('[data-testid=people-row]')
      mock.state.people.length = 0
      await page.goto(`${mock.origin}/people`)
      await page.waitForSelector('[data-testid=empty-state]')
      assert.match(await text(page, '[data-testid=empty-state]'), /No people yet/)
      void go
    },
    { extraPeople: 25 },
  ))

test('not available: a manager, an employee and finance get the API 403 and "not available" on every People page', opts, async () => {
  for (const user of [U.ben, U.carla, U.dan]) {
    await app(user, async ({ page, mock, errors, go }) => {
      await go('/people', '[data-testid=people-denied]')
      assert.match(await text(page, '[data-testid=people-denied]'), /People management is not available/)
      assert.equal(await page.locator('[data-testid=add-person]').count(), 0)
      assert.equal(callsTo(mock, 'GET', '/people/employees').length, 1)
      await go('/people/new', '[data-testid=new-denied]')
      assert.equal(await page.locator('[data-testid=person-form]').count(), 0)
      await go('/people/import', '[data-testid=import-denied]')
      assert.equal(await page.locator('[data-testid=choose-file]').count(), 0)
      await go('/people/EMP-0003', '[data-testid=person-denied]')
      await go('/settings/holidays', '[data-testid=holidays-denied]')
      assert.match(await text(page, '[data-testid=holidays-denied]'), /not available/)
      assert.deepEqual(errors, [])
    })
  }
})

// ------------------------------------------------------------------------------------------------ new person
test('new person: the form explains Microsoft sign-in, validates before sending, and maps server errors to fields', opts, () =>
  app(U.anna, async ({ page, mock, go }) => {
    await go('/people/new', '[data-testid=person-form]')
    assert.match(await text(page, '[data-testid=sign-in-explain]'), /No password is created or stored/)
    assert.match(await text(page, '[data-testid=sign-in-explain]'), /Microsoft work account/)
    assert.match(await text(page, '[data-testid=field-birthday]'), /No year is stored/)
    assert.equal(await page.isChecked('[data-testid=input-can-sign-in]'), true)
    assert.equal(await page.isDisabled('[data-testid=role-Employee]'), true)
    assert.equal(await page.isChecked('[data-testid=role-Employee]'), true)
    // Empty submit: every required field is flagged and nothing is sent.
    await page.click('[data-testid=create-person]')
    await page.waitForSelector('[data-testid=form-error]')
    for (const f of ['name', 'email', 'job_title', 'department']) assert.ok(await page.locator(`[data-testid=field-${f}-error]`).isVisible(), f)
    assert.equal(callsTo(mock, 'POST', '/people/employees').length, 0)
    assert.match(await text(page, '[data-testid=field-name-error]'), /^Name is required/)
    // Bad values (the same rules as the server).
    await page.fill('[data-testid=input-name]', '=HYPERLINK("x")')
    await page.fill('[data-testid=input-email]', 'not-an-email')
    await page.fill('[data-testid=input-job_title]', 'Analyst')
    await page.fill('[data-testid=input-department]', 'Operations')
    await page.fill('[data-testid=input-birthday]', '02-30')
    await page.click('[data-testid=create-person]')
    assert.match(await text(page, '[data-testid=field-name-error]'), /must not start with = \+ - or @/)
    assert.match(await text(page, '[data-testid=field-email-error]'), /valid e-mail/)
    assert.match(await text(page, '[data-testid=field-birthday-error]'), /MM-DD/)
    assert.equal(callsTo(mock, 'POST', '/people/employees').length, 0)
    // A duplicate e-mail comes back as 409 and lands on the e-mail field.
    await page.fill('[data-testid=input-name]', 'Nina Valdez')
    await page.fill('[data-testid=input-email]', 'ANNA.REYES@example.test')
    await page.fill('[data-testid=input-birthday]', '')
    await page.click('[data-testid=create-person]')
    await page.waitForSelector('[data-testid=field-email-error]')
    assert.match(await text(page, '[data-testid=field-email-error]'), /already used by another person or account/)
    assert.equal(callsTo(mock, 'POST', '/people/employees').length, 1)
    // A 422 with per-field messages from the server is shown next to the fields (never echoing values).
    mock.state.respondOnce['POST /people/employees'] = { status: 422, body: { detail: 'Invalid employee details', code: 'validation', field_errors: { department: 'must be at most 120 characters', manager_id: 'must be an active employee' } } }
    await page.fill('[data-testid=input-email]', 'nina.valdez@example.test')
    await page.click('[data-testid=create-person]')
    await page.waitForSelector('[data-testid=field-department-error]')
    assert.match(await text(page, '[data-testid=field-department-error]'), /^Department must be at most 120 characters/)
    assert.match(await text(page, '[data-testid=field-manager-error]'), /^Manager must be an active employee/)
    assert.match(await text(page, '[data-testid=form-error]'), /did not accept some values/)
    // A network-level failure: honest message, the form keeps what was typed.
    mock.state.force['POST /people/employees'] = 500
    await page.click('[data-testid=create-person]')
    await hasText(page, '[data-testid=form-error]', /Something went wrong on our side/)
    assert.equal(await page.inputValue('[data-testid=input-name]'), 'Nina Valdez')
  }))

test('new person: the manager type-ahead offers only ACTIVE people, picks one, can clear; creating sends the exact body and opens the person', opts, () =>
  app(U.anna, async ({ page, mock, errors, go }) => {
    await go('/people/new', '[data-testid=person-form]')
    await page.fill('[data-testid=input-name]', 'Nina  Valdez')
    await page.fill('[data-testid=input-email]', 'Nina.Valdez@Example.test')
    await page.fill('[data-testid=input-job_title]', 'Analyst')
    await page.fill('[data-testid=input-department]', 'Operations')
    await page.selectOption('[data-testid=input-employment_type]', 'part_time')
    await page.fill('[data-testid=input-start_date]', '2026-12-01')
    await page.fill('[data-testid=input-birthday]', '03-27')
    // The left person (Ted? the mock's person #7) must not be offered even when the text matches.
    const leaver = mock.state.people.find((p) => p.employee.status === 'left').employee
    const needle = leaver.name.split(' ')[0].toLowerCase()
    await page.fill('[data-testid=manager-input]', needle)
    await page.waitForSelector('[data-testid=manager-list]')
    await page.waitForFunction(() => !/Searching/.test(document.querySelector('[data-testid=manager-list]')?.textContent || ''))
    const offered = await page.$$eval('[data-testid=manager-option] strong', (els) => els.map((e) => e.textContent))
    assert.ok(!offered.includes(leaver.name), `the person who left (${leaver.name}) is not offered`)
    // Search the real manager and pick with the keyboard.
    await page.fill('[data-testid=manager-input]', 'ben cruz')
    await page.waitForSelector('[data-testid=manager-option]')
    assert.equal(await page.locator('[data-testid=manager-option]').count(), 1)
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    assert.equal(await text(page, '[data-testid=manager-chosen-name]'), 'Ben Cruz')
    await page.click('[data-testid=manager-clear]')
    assert.equal(await page.locator('[data-testid=manager-chosen]').count(), 0)
    await page.fill('[data-testid=manager-input]', 'ben cruz')
    await page.click('[data-testid=manager-option]')
    assert.equal(await text(page, '[data-testid=manager-chosen-name]'), 'Ben Cruz')
    await page.check('[data-testid=role-Manager]')
    await page.check('[data-testid=role-Finance]')
    await page.click('[data-testid=create-person]')
    await page.waitForSelector('[data-testid=person-detail]')
    const post = callsTo(mock, 'POST', '/people/employees')
    assert.equal(post.length, 1)
    assert.deepEqual(post[0].body, {
      name: 'Nina Valdez',
      email: 'nina.valdez@example.test',
      job_title: 'Analyst',
      department: 'Operations',
      employment_type: 'part_time',
      manager_id: 'EMP-0002',
      start_date: '2026-12-01',
      birthday: '03-27',
      roles: ['Employee', 'Manager', 'Finance'],
      can_sign_in: true,
    })
    assert.match(await text(page, '[data-testid=detail-notice]'), /Person added/)
    assert.match(await text(page, '[data-testid=fact-manager]'), /Ben Cruz/)
    assert.match(await text(page, '[data-testid=account-roles]'), /Employee, Manager, Finance/)
    assert.match(await text(page, '[data-testid=fact-birthday]'), /27 Mar/)
    assert.deepEqual(errors, [])
  }))

test('new person: turning sign-in off disables the roles and creates a person on file with no account', opts, () =>
  app(U.anna, async ({ page, mock, go }) => {
    await go('/people/new', '[data-testid=person-form]')
    await page.check('[data-testid=role-HRAdmin]')
    await page.uncheck('[data-testid=input-can-sign-in]')
    assert.equal(await page.locator('[data-testid=roles-fieldset]').count(), 0)
    assert.match(await text(page, '[data-testid=no-account-note]'), /on file only/)
    await page.fill('[data-testid=input-name]', 'Gus Ferrer')
    await page.fill('[data-testid=input-email]', 'gus.ferrer@example.test')
    await page.fill('[data-testid=input-job_title]', 'Contractor')
    await page.fill('[data-testid=input-department]', 'Operations')
    await page.click('[data-testid=create-person]')
    await page.waitForSelector('[data-testid=person-detail]')
    const body = callsTo(mock, 'POST', '/people/employees')[0].body
    assert.equal(body.can_sign_in, false)
    assert.deepEqual(body.roles, ['Employee'])
    assert.equal(await page.getAttribute('[data-testid=account-card]', 'data-account'), 'no_account')
    assert.ok(await page.locator('[data-testid=allow-sign-in]').isVisible())
  }))

// ------------------------------------------------------------------------------------------------ detail + edit
test('detail: facts, account card with source and roles, a missing person and a failed load', opts, () =>
  app(U.anna, async ({ page, mock, go }) => {
    await go('/people/EMP-0002', '[data-testid=person-detail]')
    assert.match(await text(page, '[data-testid=details-facts]'), /ben\.cruz@example\.test/)
    assert.match(await text(page, '[data-testid=account-source]'), /Local account/)
    assert.match(await text(page, '[data-testid=account-roles]'), /Employee, Manager/)
    assert.match(await text(page, '[data-testid=fact-manager]'), /Anna Reyes/)
    assert.equal(await page.locator('[data-testid=person-detail]').getAttribute('data-status'), 'active')
    await go('/people/EMP-9999', '[data-testid=person-missing]')
    assert.match(await text(page, '[data-testid=person-missing]'), /can't find that person/)
    mock.state.force['GET /people/employees/EMP-0003'] = 500
    await go('/people/EMP-0003', '[data-testid=person-error]')
    delete mock.state.force['GET /people/employees/EMP-0003']
    await page.click('[data-testid=person-error] button')
    await page.waitForSelector('[data-testid=person-detail]')
  }))

test('edit: only changed fields are sent; the e-mail of a configured account is locked; a duplicate e-mail lands on the field', opts, () =>
  app(U.anna, async ({ page, mock, go }) => {
    await go('/people/EMP-0100', '[data-testid=person-detail]')
    await page.click('[data-testid=edit-details]')
    await page.waitForSelector('[data-testid=edit-form]')
    assert.equal(await page.inputValue('[data-testid=input-email]'), mock.state.people.find((p) => p.employee.employee_id === 'EMP-0100').employee.email)
    // Nothing changed -> no request.
    await page.click('[data-testid=save-details]')
    await page.waitForSelector('[data-testid=detail-notice]')
    assert.match(await text(page, '[data-testid=detail-notice]'), /No changes to save/)
    assert.equal(callsTo(mock, 'PATCH', '/people/employees/EMP-0100').length, 0)
    // Change the title, clear the birthday and the manager.
    await page.click('[data-testid=edit-details]')
    await page.fill('[data-testid=input-job_title]', 'Senior  Analyst')
    await page.click('[data-testid=manager-clear]')
    await page.click('[data-testid=save-details]')
    await hasText(page, '[data-testid=detail-notice]', /Details saved/)
    const patch = callsTo(mock, 'PATCH', '/people/employees/EMP-0100')
    assert.equal(patch.length, 1)
    assert.deepEqual(patch[0].body, { job_title: 'Senior Analyst', manager_id: null })
    assert.match(await text(page, '[data-testid=fact-job_title]'), /Senior Analyst/)
    assert.match(await text(page, '[data-testid=fact-manager]'), /No manager/)
    // Duplicate e-mail -> 409 on the e-mail field, form stays open.
    await page.click('[data-testid=edit-details]')
    await page.fill('[data-testid=input-email]', 'ben.cruz@example.test')
    await page.click('[data-testid=save-details]')
    await page.waitForSelector('[data-testid=field-email-error]')
    assert.match(await text(page, '[data-testid=field-email-error]'), /already used/)
    assert.ok(await page.locator('[data-testid=edit-form]').isVisible())
    await page.click('[data-testid=cancel-edit]')
    // A configured (Microsoft user list / demo) account's e-mail is locked, with the reason.
    await go('/people/EMP-0002', '[data-testid=person-detail]')
    await page.click('[data-testid=edit-details]')
    assert.equal(await page.isDisabled('[data-testid=input-email]'), true)
    assert.match(await text(page, '[data-testid=field-email]'), /set by configuration/)
    // A server-side email_managed refusal is shown too (the lock is a convenience, the server decides).
    mock.state.respondOnce['PATCH /people/employees/EMP-0002'] = { status: 409, body: { detail: 'managed', code: 'email_managed' } }
    await page.fill('[data-testid=input-job_title]', 'Operations Lead')
    await page.click('[data-testid=save-details]')
    await page.waitForSelector('[data-testid=field-email-error]')
    assert.match(await text(page, '[data-testid=field-email-error]'), /managed|configuration/)
  }))

// ------------------------------------------------------------------------------------------------ account card
test('account: HR cannot change their OWN roles - the server message is shown; other people\'s roles save', opts, () =>
  app(U.anna, async ({ page, mock, go }) => {
    await go('/people/EMP-0001', '[data-testid=account-card]')
    assert.equal(await page.isDisabled('[data-testid=save-roles]'), true, 'nothing changed yet')
    await page.check('[data-testid=role-Finance]')
    // The button is NOT pre-disabled for yourself: the server decides and its reason is shown.
    await page.click('[data-testid=save-roles]')
    await page.waitForSelector('[data-testid=account-error]')
    assert.equal((await text(page, '[data-testid=account-error]')).trim(), 'You cannot change your own roles')
    assert.deepEqual(mock.state.people.find((p) => p.employee.employee_id === 'EMP-0001').account.roles, ['Employee', 'HRAdmin'])
    // Someone else: saved, shown, applies from the next request.
    await go('/people/EMP-0003', '[data-testid=account-card]')
    await page.check('[data-testid=role-Manager]')
    await page.click('[data-testid=save-roles]')
    await hasText(page, '[data-testid=detail-notice]', /Roles saved/)
    assert.match(await text(page, '[data-testid=account-roles]'), /Employee, Manager/)
    assert.deepEqual(callsTo(mock, 'PUT', '/people/employees/EMP-0003/roles')[0].body, { roles: ['Employee', 'Manager'] })
    assert.equal(await page.isDisabled('[data-testid=save-roles]'), true)
    // Employee is always on and cannot be switched off.
    assert.equal(await page.isDisabled('[data-testid=role-Employee]'), true)
  }))

test('account: the last active HR Administrator cannot lose the role or be deactivated - the server reason is shown', opts, () =>
  app(
    U.anna,
    async ({ page, mock, go }) => {
      await go('/people/EMP-0005', '[data-testid=account-card]') // Bea, the other HR admin: Anna may demote her while two admins exist
      await page.uncheck('[data-testid=role-HRAdmin]')
      await page.click('[data-testid=save-roles]')
      await hasText(page, '[data-testid=detail-notice]', /Roles saved/)
      // Now Anna is the last one. Demoting Anna is refused for "own roles" first (403), so exercise the dialog guard rail.
      await go('/people/EMP-0001', '[data-testid=person-detail]')
      await page.click('[data-testid=deactivate]')
      await page.waitForSelector('[data-testid=deactivate-dialog]')
      await page.click('[data-testid=deactivate-confirm]')
      await page.waitForSelector('[data-testid=dialog-error]')
      assert.match(await text(page, '[data-testid=dialog-error]'), /last active HR Administrator/)
      assert.match(await text(page, '[data-testid=dialog-error]'), /Promote someone else/)
      assert.ok(await page.locator('[data-testid=deactivate-dialog]').isVisible(), 'the dialog stays open with the reason')
      assert.equal(mock.state.people.find((p) => p.employee.employee_id === 'EMP-0001').employee.status, 'active')
    },
  ))

test('account: turn sign-in off (with a confirmation), switch it back on; a person with no account can be allowed to sign in', opts, () =>
  app(U.anna, async ({ page, mock, go }) => {
    await go('/people/EMP-0003', '[data-testid=account-card]')
    await page.click('[data-testid=turn-off-sign-in]')
    await page.waitForSelector('[data-testid=signin-off-dialog]')
    assert.match(await text(page, '[data-testid=signin-off-dialog]'), /signed out immediately/)
    await page.click('[data-testid=dialog-cancel]')
    await page.waitForFunction(() => !document.querySelector('[data-testid=signin-off-dialog]'))
    assert.equal(callsTo(mock, 'PATCH', '/people/employees/EMP-0003').length, 0)
    await page.click('[data-testid=turn-off-sign-in]')
    await page.click('[data-testid=signin-off-confirm]')
    await hasText(page, '[data-testid=account-state]', /Sign-in off/)
    assert.match(await text(page, '[data-testid=disabled-note]'), /switched off by HR/)
    assert.deepEqual(callsTo(mock, 'PATCH', '/people/employees/EMP-0003')[0].body, { can_sign_in: false })
    await page.click('[data-testid=allow-sign-in]')
    await hasText(page, '[data-testid=account-state]', /Can sign in/)
    // A person with no account (generated #5 has none).
    await go('/people/EMP-0105', '[data-testid=no-account-block]')
    assert.match(await text(page, '[data-testid=no-account-block]'), /No password is created or stored/)
    await page.click('[data-testid=allow-sign-in]')
    await hasText(page, '[data-testid=account-state]', /Can sign in/)
    assert.match(await text(page, '[data-testid=account-roles]'), /Employee/)
  }))

// ------------------------------------------------------------------------------------------------ deactivate / reactivate
test('deactivate: a dialog spells out the consequences, Escape/Cancel close it, confirming signs the person out; reactivate restores them', opts, () =>
  app(U.anna, async ({ page, mock, go }) => {
    await go('/people/EMP-0101', '[data-testid=person-detail]')
    await page.click('[data-testid=deactivate]')
    await page.waitForSelector('[data-testid=deactivate-dialog]')
    const t = await text(page, '[data-testid=deactivate-consequences]')
    assert.match(t, /signed out immediately/)
    assert.match(t, /history stays/)
    assert.match(t, /Nothing is deleted/)
    // Focus is inside the dialog; Escape closes it and focus returns to the button.
    assert.equal(await page.evaluate(() => !!document.activeElement?.closest('[data-testid=deactivate-dialog]')), true)
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => !document.querySelector('[data-testid=deactivate-dialog]'))
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-testid')), 'deactivate')
    assert.equal(callsTo(mock, 'POST', '/people/employees/EMP-0101/deactivate').length, 0)
    // Confirm with a leaving date.
    await page.click('[data-testid=deactivate]')
    await page.fill('[data-testid=input-end-date]', '2026-11-30')
    await page.click('[data-testid=deactivate-confirm]')
    await hasText(page, '[data-testid=detail-notice]', /was deactivated and signed out/)
    assert.deepEqual(callsTo(mock, 'POST', '/people/employees/EMP-0101/deactivate')[0].body, { end_date: '2026-11-30' })
    assert.equal(await page.getAttribute('[data-testid=person-detail]', 'data-status'), 'left')
    assert.match(await text(page, '[data-testid=fact-end-date]'), /30 Nov 2026/)
    assert.match(await text(page, '[data-testid=account-state]'), /Deactivated/)
    assert.match(await text(page, '[data-testid=disabled-note]'), /deactivated/)
    assert.equal(await page.locator('[data-testid=allow-sign-in], [data-testid=turn-off-sign-in]').count(), 0, 'no sign-in switch for a deactivated account')
    assert.ok(await page.locator('[data-testid=reactivate-to-sign-in]').isVisible())
    // Reactivate.
    await page.click('[data-testid=reactivate]')
    await page.waitForSelector('[data-testid=reactivate-dialog]')
    assert.match(await text(page, '[data-testid=reactivate-dialog]'), /Manager links are not restored/)
    await page.click('[data-testid=reactivate-confirm]')
    await hasText(page, '[data-testid=detail-notice]', /is active again/)
    assert.equal(await page.getAttribute('[data-testid=person-detail]', 'data-status'), 'active')
    assert.match(await text(page, '[data-testid=account-state]'), /Can sign in/)
  }))

test('deactivate: a person with direct reports needs a new manager (picker appears after the 409), then the reports move', opts, () =>
  app(U.anna, async ({ page, mock, go }) => {
    await go('/people/EMP-0002', '[data-testid=person-detail]')
    const reports = mock.state.people.filter((p) => p.employee.manager_id === 'EMP-0002' && p.employee.status === 'active').length
    assert.ok(reports > 2)
    await page.click('[data-testid=deactivate]')
    await page.click('[data-testid=deactivate-confirm]')
    await page.waitForSelector('[data-testid=reassign-step]')
    assert.match(await text(page, '[data-testid=reassign-step]'), new RegExp(`${reports} active people report to Ben Cruz`))
    assert.equal(await page.isDisabled('[data-testid=deactivate-confirm]'), true, 'confirm waits for a manager')
    // The leaver is not offered as their own replacement; a left person is not offered either.
    await page.fill('[data-testid=reassign-input]', 'ben')
    await page.waitForFunction(() => /No active person matches/.test(document.querySelector('[data-testid=reassign-list]')?.textContent || ''))
    await page.fill('[data-testid=reassign-input]', 'carla')
    await page.click('[data-testid=reassign-option]')
    assert.equal(await text(page, '[data-testid=reassign-chosen-name]'), 'Carla Dizon')
    assert.equal(await page.isDisabled('[data-testid=deactivate-confirm]'), false)
    await page.click('[data-testid=deactivate-confirm]')
    await hasText(page, '[data-testid=detail-notice]', new RegExp(`${reports} people now report to Carla Dizon`))
    const calls = callsTo(mock, 'POST', '/people/employees/EMP-0002/deactivate')
    assert.equal(calls.length, 2)
    assert.deepEqual(calls[0].body, {})
    assert.deepEqual(calls[1].body, { reassign_reports_to: 'EMP-0003' })
    assert.equal(mock.state.people.filter((p) => p.employee.manager_id === 'EMP-0002' && p.employee.status === 'active').length, 0)
    assert.equal(await page.getAttribute('[data-testid=person-detail]', 'data-status'), 'left')
  }))

test('deactivate: server refusals (422 on the new manager, 5xx) show inside the dialog and nothing closes', opts, () =>
  app(U.anna, async ({ page, mock, go }) => {
    await go('/people/EMP-0002', '[data-testid=person-detail]')
    await page.click('[data-testid=deactivate]')
    await page.click('[data-testid=deactivate-confirm]')
    await page.waitForSelector('[data-testid=reassign-step]')
    await page.fill('[data-testid=reassign-input]', 'dan')
    await page.click('[data-testid=reassign-option]')
    mock.state.respondOnce['POST /people/employees/EMP-0002/deactivate'] = { status: 422, body: { detail: 'Invalid employee details', code: 'validation', field_errors: { reassign_reports_to: 'must be an active person who is not being moved' } } }
    await page.click('[data-testid=deactivate-confirm]')
    await page.waitForSelector('[data-testid=field-reassign-error]')
    assert.match(await text(page, '[data-testid=field-reassign-error]'), /^New manager must be an active person/)
    mock.state.force['POST /people/employees/EMP-0002/deactivate'] = 500
    await page.click('[data-testid=deactivate-confirm]')
    await hasText(page, '[data-testid=dialog-error]', /Something went wrong on our side/)
    assert.ok(await page.locator('[data-testid=deactivate-dialog]').isVisible())
    assert.equal(mock.state.people.find((p) => p.employee.employee_id === 'EMP-0002').employee.status, 'active')
  }))

// ------------------------------------------------------------------------------------------------ import
test('import: template download, limits and the formula warning are explained; nothing can be imported before a check', opts, () =>
  app(U.anna, async ({ page, go }) => {
    await go('/people/import', '[data-testid=import-page]')
    assert.match(await text(page, '[data-testid=import-limits]'), /At most 500 people and 1 MB/)
    assert.match(await text(page, '[data-testid=formula-note]'), /start with = \+ - or @.*rejected/)
    assert.match(await text(page, '[data-testid=import-columns]'), /Required columns: name, email, job_title, department, employment_type/)
    assert.equal(await page.isDisabled('[data-testid=check-file]'), true)
    assert.equal(await page.locator('[data-testid=run-import]').count(), 0)
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('[data-testid=download-template]')])
    assert.equal(download.suggestedFilename(), 'employee_import_template.csv')
    const stream = await download.createReadStream()
    let body = ''
    for await (const chunk of stream) body += chunk
    assert.ok(body.startsWith(HEAD.trim()) && body.trim().split(/\r?\n/).length === 1, "a single header row that starts with the original columns")
    for (const c of ["preferred_name", "birth_year", "tin", "pagibig"]) assert.ok(body.includes(c), c)
  }, { acceptDownloads: true }))

test('import: file hints (over 1 MB blocks the check, not .csv warns), the dry run report, and the real run only after a clean-enough check', opts, () =>
  app(U.anna, async ({ page, mock, errors, go }) => {
    await go('/people/import', '[data-testid=import-page]')
    // Over 1 MB: blocked client-side with the limit named.
    await page.setInputFiles('[data-testid=import-file]', { name: 'big.csv', mimeType: 'text/csv', buffer: Buffer.alloc(1024 * 1024 + 10, 97) })
    assert.match(await text(page, '[data-testid=file-hint]'), /limit is 1 MB/)
    assert.equal(await page.isDisabled('[data-testid=check-file]'), true)
    await page.click('[data-testid=remove-file]')
    // Wrong extension: a warning only.
    await page.setInputFiles('[data-testid=import-file]', csv('people.txt', HEAD))
    assert.match(await text(page, '[data-testid=file-hint]'), /does not end in \.csv/)
    // A mix of good and bad rows, including a formula-like cell.
    const rows = [
      'Good One,good.one@example.test,Analyst,Operations,full_time,,2026-12-01,03-27,Manager;Finance,true',
      'Good Two,good.two@example.test,Analyst,Operations,intern,good.one@example.test,,,,false',
      '=HYPERLINK("http://evil.test"),formula.person@example.test,Analyst,Operations,full_time,,,,,',
      'Bad Email,not-an-email,Analyst,Operations,full_time,,,,,',
      'Already Here,anna.reyes@example.test,Analyst,Operations,full_time,,,,,',
      'Dup Row,good.one@example.test,Analyst,Operations,full_time,,,,,',
    ]
    await page.setInputFiles('[data-testid=import-file]', csv('people.csv', HEAD + rows.join('\n') + '\n'))
    await page.waitForFunction(() => document.querySelector('[data-testid=file-name]')?.textContent === 'people.csv')
    assert.equal(await page.locator('[data-testid=file-hint]').count(), 0)
    const before = mock.state.people.length
    await page.click('[data-testid=check-file]')
    await page.waitForSelector('[data-testid=import-report]')
    assert.equal(await page.getAttribute('[data-testid=import-report]', 'data-dry-run'), 'true')
    assert.equal(mock.state.people.length, before, 'a dry run writes nothing')
    assert.deepEqual(callsTo(mock, 'POST', '/people/employees/import').map((c) => c.query.dry_run), ['true'])
    assert.match(await text(page, '[data-testid=report-summary]'), /6 rows read: 2 would be created, 2 skipped, 2 invalid\./)
    assert.match(await text(page, '[data-testid=check-result]'), /Nothing has been saved yet/)
    // Invalid rows show first (the filter starts on "Invalid"), with their reasons and per-field messages; cell contents never appear.
    await page.click('[data-testid=report-filter-all]')
    const statuses = await page.$$eval('[data-testid=report-row]', (els) => els.map((e) => [e.getAttribute('data-status'), e.getAttribute('data-reason')]))
    assert.deepEqual(statuses, [['created', ''], ['created', ''], ['invalid', 'validation'], ['invalid', 'validation'], ['skipped', 'email_exists'], ['skipped', 'duplicate_in_file']])
    const rep = await text(page, '[data-testid=import-report]')
    assert.match(rep, /Row 4/)
    assert.match(rep, /Name must not start with = \+ - or @/)
    assert.match(rep, /Email must be a valid e-mail address/)
    assert.ok(!/HYPERLINK|evil\.test|formula\.person|good\.one@|not-an-email/.test(rep), 'no cell value is echoed')
    // The import button names the number and appears only now.
    assert.equal((await text(page, '[data-testid=run-import]')).trim(), 'Import 2 people')
    await page.click('[data-testid=run-import]')
    await page.waitForSelector('[data-testid=import-done]')
    assert.deepEqual(callsTo(mock, 'POST', '/people/employees/import').map((c) => c.query.dry_run), ['true', 'false'])
    assert.equal(mock.state.people.length, before + 2)
    assert.equal(await page.getAttribute('[data-testid=import-report]', 'data-dry-run'), 'false')
    assert.match(await text(page, '[data-testid=report-summary]'), /2 created, 2 skipped, 2 invalid/)
    assert.equal(await page.locator('[data-testid=run-import]').count(), 0, 'cannot import the same file twice from here')
    assert.match(await text(page, '[data-testid=import-done]'), /no password/)
    await page.click('[data-testid=report-filter-created]')
    assert.equal(await page.locator('[data-testid=report-open]').count(), 2)
    const two = mock.state.people.find((p) => p.employee.email === 'good.two@example.test')
    assert.equal(two.account.has_account, false, 'can_sign_in=false creates no account')
    assert.equal(two.employee.manager_id, mock.state.people.find((p) => p.employee.email === 'good.one@example.test').employee.employee_id)
    assert.deepEqual(errors, [])
  }))

test('import: a file with nothing importable offers no Import button; whole-file errors have clear messages; changing the file clears the report', opts, () =>
  app(U.anna, async ({ page, go }) => {
    await go('/people/import', '[data-testid=import-page]')
    await page.setInputFiles('[data-testid=import-file]', csv('bad.csv', HEAD + 'Only Bad,nope,Analyst,Operations,full_time,,,,,\n'))
    await page.click('[data-testid=check-file]')
    await page.waitForSelector('[data-testid=import-report]')
    assert.match(await text(page, '[data-testid=check-result]'), /Nothing would be created/)
    assert.equal(await page.locator('[data-testid=run-import]').count(), 0)
    // Another file: the old report goes away.
    await page.setInputFiles('[data-testid=import-file]', csv('ok.csv', HEAD + 'Fine Person,fine@example.test,Analyst,Operations,full_time,,,,,\n'))
    await page.waitForFunction(() => !document.querySelector('[data-testid=import-report]'))
    // Missing columns.
    await page.setInputFiles('[data-testid=import-file]', csv('cols.csv', 'name,email\nA,a@example.test\n'))
    assert.match(await text(page, '[data-testid=file-hint]'), /missing: job_title, department, employment_type/)
    await page.click('[data-testid=check-file]')
    await page.waitForSelector('[data-testid=import-error]')
    assert.match(await text(page, '[data-testid=import-error]'), /header row is missing: job_title, department, employment_type/)
    // Empty file.
    await page.setInputFiles('[data-testid=import-file]', csv('empty.csv', '\n'))
    await page.click('[data-testid=check-file]')
    await page.waitForSelector('[data-testid=import-error]')
    // Too many rows (501) from the server.
    const many = HEAD + Array.from({ length: 501 }, (_, i) => `P${i},p${i}@example.test,T,D,full_time,,,,,`).join('\n')
    await page.setInputFiles('[data-testid=import-file]', csv('many.csv', many))
    assert.match(await text(page, '[data-testid=file-hint]'), /limit is 500/)
    await page.click('[data-testid=check-file]')
    await hasText(page, '[data-testid=import-error]', /more than 500 people/)
  }))

test('import: a failed real run keeps the check result and says what went wrong', opts, () =>
  app(U.anna, async ({ page, mock, go }) => {
    await go('/people/import', '[data-testid=import-page]')
    await page.setInputFiles('[data-testid=import-file]', csv('ok.csv', HEAD + 'Fine Person,fine@example.test,Analyst,Operations,full_time,,,,,\n'))
    await page.click('[data-testid=check-file]')
    await page.waitForSelector('[data-testid=run-import]')
    mock.state.force['POST /people/employees/import'] = 500
    await page.click('[data-testid=run-import]')
    await page.waitForSelector('[data-testid=import-error]')
    assert.match(await text(page, '[data-testid=import-error]'), /Something went wrong on our side/)
    assert.ok(await page.locator('[data-testid=run-import]').isVisible(), 'the dry-run result is still there and can be retried')
    assert.equal(mock.state.people.some((p) => p.employee.email === 'fine@example.test'), false)
  }))

// ------------------------------------------------------------------------------------------------ settings links (shared Settings mock)
test('settings: the Users tab has a real "Manage people" link', opts, async () => {
  const { startSettingsMock, U: SU } = await import('./settings-mock.mjs')
  const { dist } = await import('./peoplemgmt-helpers.mjs')
  const mock = await startSettingsMock({ distDir: dist })
  const ctx = await browser.newContext({ viewport: { width: 1448, height: 1000 } })
  await ctx.addInitScript((t) => localStorage.setItem('people.accessToken', t), `acc-${SU.anna.user_id}`)
  const page = await ctx.newPage()
  try {
    await page.goto(`${mock.origin}/settings?tab=users`)
    await page.waitForSelector('[data-testid=manage-people-link]')
    assert.equal(await page.getAttribute('[data-testid=manage-people-link]', 'href'), '/people')
    assert.equal(await page.locator('[data-testid=users-table] a').count(), 0, 'the table itself stays read-only')
    await page.goto(`${mock.origin}/settings?tab=catalogs`)
    await page.waitForSelector('[data-testid=catalog-link-holidays]')
    assert.equal(await page.getAttribute('[data-testid=catalog-link-holidays]', 'href'), '/settings/holidays')
    assert.equal(await page.getAttribute('[data-testid=catalog-link-people]', 'href'), '/people')
  } finally {
    await ctx.close()
    await mock.close()
  }
})

void count
