// Leave module, part 2 (mock API): the team calendar and the HR catalog admin, plus resilience when pieces fail.
// Gated: RUN_BROWSER_TESTS=1 (use `npm run test:browser`). Fictional data only.
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { seedRequest } from './mock-leave.mjs'
import { ANNA, BEN, CARLA, EMP, count, enabled, launchBrowser, noOverflow, opts, text, until, visit, withLeave } from './leave-helpers.mjs'

let browser
before(async () => {
  if (enabled) browser = await launchBrowser()
})
after(async () => {
  await browser?.close()
})

const CAL = '[data-testid=tab-panel-calendar] [data-testid=lcal-cell]'
const month = (page) => page.getAttribute('[data-testid=lcal-month]', 'data-month')
const chipsOn = (page, date) => page.$$eval(`[data-testid=lcal-cell][data-date="${date}"] [data-testid=lcal-chip]`, (els) => els.map((e) => e.textContent.trim()))

// ------------------------------------------------------------------------------------------------ team calendar
test('calendar (employee): own approved leave only, chips with "You", today marked, previous/next/today navigation', opts, () =>
  withLeave(browser, async ({ page, mock }) => {
    await visit(page, mock, '/leave?tab=calendar', CAL)
    assert.equal(await month(page), '2026-11')
    assert.match(await text(page, '[data-testid=lcal-month]'), /November 2026/)
    assert.equal(await page.getAttribute('[data-testid=lcal-cell][data-date="2026-11-16"]', 'aria-current'), 'date')
    assert.equal(await count(page, '[data-testid=lcal-chip]'), 0, 'Dan\'s sick leave is not visible to Carla')
    assert.ok(await page.isVisible('[data-testid=lcal-empty-grid]'))
    assert.ok(await page.isDisabled('[data-testid=lcal-today]'), 'already on the current month')
    await page.click('[data-testid=lcal-next]')
    await page.waitForFunction(() => document.querySelector('[data-testid=lcal-month]')?.dataset.month === '2026-12')
    assert.match(page.url(), /month=2026-12/)
    await page.waitForSelector('[data-testid=lcal-cell][data-date="2026-12-07"] [data-testid=lcal-chip]')
    for (const d of ['2026-12-07', '2026-12-08', '2026-12-09']) assert.deepEqual(await chipsOn(page, d), ['You - Vacation'])
    assert.equal(await page.getAttribute('[data-testid=lcal-cell][data-date="2026-12-07"] [data-testid=lcal-chip]', 'data-own'), 'true')
    assert.deepEqual(await chipsOn(page, '2026-12-10'), [])
    assert.match(await text(page, '.lcal-legend'), /Vacation/)
    await page.click('[data-testid=lcal-today]')
    await page.waitForFunction(() => document.querySelector('[data-testid=lcal-month]')?.dataset.month === '2026-11')
    assert.doesNotMatch(page.url(), /month=/)
    await page.click('[data-testid=lcal-prev]')
    await page.waitForFunction(() => document.querySelector('[data-testid=lcal-month]')?.dataset.month === '2026-10')
    await until(() => mock.state.log.some((l) => l === 'GET /team?month=2026-10'))
  }))

test('calendar (manager): own + direct reports; entries that span months show in both; never reasons or comments', opts, () =>
  withLeave(browser, async ({ page, mock }) => {
    seedRequest(mock.state, { employee_id: EMP.carla, start_date: '2026-11-30', end_date: '2026-12-02', status: 'approved', reason: 'SECRET-REASON-XYZ' })
    await visit(page, mock, '/leave?tab=calendar', CAL)
    assert.deepEqual(await chipsOn(page, '2026-11-18'), ['Dan Ocampo - Sick'])
    assert.deepEqual(await chipsOn(page, '2026-11-30'), ['Carla Dizon - Vacation'])
    await page.click('[data-testid=lcal-next]')
    await page.waitForFunction(() => document.querySelector('[data-testid=lcal-month]')?.dataset.month === '2026-12')
    assert.deepEqual(await chipsOn(page, '2026-12-01'), ['Carla Dizon - Vacation'])
    assert.deepEqual(await chipsOn(page, '2026-12-02'), ['Carla Dizon - Vacation'])
    const html = await page.content()
    assert.ok(!html.includes('SECRET-REASON-XYZ') && !html.includes('Enjoy the break'), 'reasons and comments never reach the calendar')
  }, { as: BEN }))

test('calendar (HR): everyone; a crowded day collapses to "+N more" and opens the full list for that day', opts, () =>
  withLeave(browser, async ({ page, mock }) => {
    for (const emp of [EMP.anna, EMP.ben, EMP.carla, EMP.dan]) seedRequest(mock.state, { employee_id: emp, type_id: 'unpaid', start_date: '2026-11-25', status: 'approved' })
    await visit(page, mock, '/leave?tab=calendar', CAL)
    const chips = await chipsOn(page, '2026-11-25')
    assert.equal(chips.length, 2, 'two chips + a "+N more" button on a day with four people')
    assert.ok(chips.every((c) => /Unpaid|Vacation/.test(c)))
    const more = page.locator('[data-testid=lcal-cell][data-date="2026-11-25"] [data-testid=lcal-more]')
    assert.match(await more.innerText(), /\+3 more|\+2 more/)
    await more.click()
    await page.waitForSelector('[data-testid=lcal-day-panel]')
    const names = await page.$$eval('[data-testid=lcal-day-panel] li', (els) => els.map((e) => e.textContent.trim()))
    assert.ok(names.length >= 4)
    assert.ok(names.some((n) => n.includes('You - Unpaid')) && names.some((n) => n.includes('Dan Ocampo - Unpaid')) && names.some((n) => n.includes('Ben Cruz - Unpaid')))
    await page.click('[data-testid=lcal-day-close]')
    assert.equal(await count(page, '[data-testid=lcal-day-panel]'), 0)
  }, { as: ANNA }))

test('calendar: the range is current month +/-12; out-of-range URLs are clamped before any request; edges disable the arrows', opts, () =>
  withLeave(browser, async ({ page, mock }) => {
    await visit(page, mock, '/leave?tab=calendar&month=2020-01', CAL)
    assert.equal(await month(page), '2025-11')
    assert.ok(await page.isDisabled('[data-testid=lcal-prev]'))
    assert.ok(await page.isEnabled('[data-testid=lcal-next]'))
    await visit(page, mock, '/leave?tab=calendar&month=2031-05', CAL)
    assert.equal(await month(page), '2027-11')
    assert.ok(await page.isDisabled('[data-testid=lcal-next]'))
    await visit(page, mock, '/leave?tab=calendar&month=garbage', CAL)
    assert.equal(await month(page), '2026-11')
    assert.ok(!mock.state.log.some((l) => /month=(2020|2031|garbage)/.test(l)), 'the server never sees an invalid month')
  }))

test('calendar (phone): agenda list instead of the grid, entries clipped to the month, own entry marked "(you)"', opts, () =>
  withLeave(browser, async ({ page, mock }) => {
    seedRequest(mock.state, { employee_id: EMP.carla, start_date: '2026-11-30', end_date: '2026-12-02', status: 'approved' })
    await visit(page, mock, '/leave?tab=calendar&month=2026-12', '[data-testid=lcal-agenda-item]')
    assert.equal(await page.isVisible('[data-testid=lcal-grid]'), false)
    const items = await page.$$eval('[data-testid=lcal-agenda-item]', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ')))
    assert.equal(items.length, 2)
    assert.match(items[0], /Carla Dizon \(you\) Vacation - 1 to 2 Dec 2026 \(this month; 30 Nov to 2 Dec 2026 in all\)/)
    assert.match(items[1], /Carla Dizon \(you\)\s+Vacation - 7 to 9 Dec 2026/)
    assert.ok(await noOverflow(page))
  }, { viewport: { width: 390, height: 800 } }))

test('calendar: an empty month says so on the phone agenda too; a failing month shows an error with retry; 400 is explained', opts, () =>
  withLeave(browser, async ({ page, mock }) => {
    await visit(page, mock, '/leave?tab=calendar&month=2027-03', '[data-testid=lcal-agenda] [data-testid=empty-state]')
    assert.match(await text(page, '[data-testid=lcal-agenda]'), /Nobody is away this month/)
    mock.state.force['GET /team'] = 500
    await page.click('[data-testid=lcal-next]')
    await page.waitForSelector('[data-testid=lcal-error]')
    assert.match(await text(page, '[data-testid=lcal-error]'), /could not be loaded/)
    delete mock.state.force['GET /team']
    await page.click('[data-testid=lcal-error] button')
    await page.waitForSelector('[data-testid=lcal-grid]', { state: 'attached' })
    mock.state.force['GET /team'] = { status: 400, body: { detail: 'month is outside the allowed range' } }
    await page.click('[data-testid=lcal-next]')
    await page.waitForSelector('[data-testid=lcal-error]')
    assert.match(await text(page, '[data-testid=lcal-error]'), /not available/)
  }, { viewport: { width: 390, height: 800 } }))

test('calendar: the notice says approved leave only and reasons are never shown', opts, () =>
  withLeave(browser, async ({ page, mock }) => {
    await visit(page, mock, '/leave?tab=calendar', CAL)
    assert.match(await text(page, '[data-testid=tab-panel-calendar]'), /Approved leave you are allowed to see\. Reasons and comments are never shown here\./)
  }))

// ------------------------------------------------------------------------------------------------ HR settings
const TYPES = '[data-testid=settings-types] [data-testid=type-row]'

test('settings (HR): catalog lists the four default types with their rules; employees never get this tab', opts, () =>
  withLeave(browser, async ({ page, mock }) => {
    await visit(page, mock, '/leave?tab=settings', TYPES)
    const rows = await page.$$eval(TYPES, (els) => els.map((e) => e.dataset.type))
    assert.deepEqual(rows, ['vacation', 'sick', 'personal', 'unpaid'])
    assert.match(await text(page, `${TYPES}[data-type=vacation]`), /15 days a year/)
    assert.match(await text(page, `${TYPES}[data-type=unpaid]`), /Unpaid, no balance limit/)
    assert.ok(mock.state.log.includes('GET /types?include_inactive=true'))
    assert.equal(await count(page, `${TYPES}[data-type=vacation] [data-testid=type-delete]`), 0, 'defaults are never deletable')
  }, { as: ANNA }))

test('settings (HR): add a type - local validation first (name, duplicate, days), then it is created and listed', opts, () =>
  withLeave(browser, async ({ page, mock }) => {
    await visit(page, mock, '/leave?tab=settings', TYPES)
    await page.click('[data-testid=type-add]')
    await page.waitForSelector('[data-testid=type-add-form]')
    await page.click('[data-testid=type-save]')
    assert.match(await text(page, '[data-testid=type-name-error]'), /A name is required/)
    await page.fill('[data-testid=type-name]', 'vacation')
    await page.fill('[data-testid=type-days]', '1.3')
    await page.click('[data-testid=type-save]')
    assert.match(await text(page, '[data-testid=type-name-error]'), /already exists/)
    assert.match(await text(page, '[data-testid=type-days-error]'), /steps of 0\.5/)
    assert.ok(!mock.state.bodies.some((b) => b.route === 'POST /types'))
    await page.fill('[data-testid=type-name]', 'Study leave')
    await page.fill('[data-testid=type-days]', '5.5')
    await page.check('[data-testid=type-reason]')
    await page.click('[data-testid=type-save]')
    await page.waitForSelector(`${TYPES}[data-type^=custom-]`)
    assert.deepEqual(mock.state.bodies.find((b) => b.route === 'POST /types').body, { name: 'Study leave', paid: true, annual_days: 5.5, requires_reason: true })
    assert.match(await text(page, '[data-testid=settings-flash]'), /Added "Study leave"/)
    assert.match(await text(page, `${TYPES}[data-type^=custom-]`), /5\.5 days a year, reason required/)
    assert.equal(await count(page, '[data-testid=type-add-form]'), 0)
    assert.equal(await count(page, `${TYPES}[data-type^=custom-] [data-testid=type-delete]`), 1, 'an unused custom type can be deleted')
    // and an employee can now pick it (reason required is honoured on the form)
  }, { as: ANNA }))

test('settings (HR): a server-side duplicate name (409) is shown on the name field', opts, () =>
  withLeave(browser, async ({ page, mock }) => {
    await visit(page, mock, '/leave?tab=settings', TYPES)
    await page.click('[data-testid=type-add]')
    await page.fill('[data-testid=type-name]', 'Fresh name')
    mock.state.force['POST /types'] = { status: 409, body: { detail: 'A leave type with this name already exists' } }
    await page.click('[data-testid=type-save]')
    await page.waitForSelector('[data-testid=type-error]')
    assert.match(await text(page, '[data-testid=type-name-error]'), /already exists/)
  }, { as: ANNA }))

test('settings (HR): edit a default type - the values change', opts, () =>
  withLeave(browser, async ({ page, mock }) => {
    await visit(page, mock, '/leave?tab=settings', TYPES)
    await page.click(`${TYPES}[data-type=sick] [data-testid=type-edit]`)
    await page.waitForSelector('[data-testid=type-edit-form]')
    assert.equal(await page.inputValue('[data-testid=type-edit-form] [data-testid=type-name]'), 'Sick')
    assert.equal(await page.inputValue('[data-testid=type-edit-form] [data-testid=type-days]'), '10')
    await page.fill('[data-testid=type-edit-form] [data-testid=type-days]', '12')
    await page.click('[data-testid=type-edit-form] [data-testid=type-save]')
    await page.waitForFunction(() => /12 days a year/.test(document.querySelector('[data-testid=type-row][data-type=sick]')?.textContent || ''))
    assert.deepEqual(mock.state.bodies.find((b) => b.route === 'PATCH /types/sick').body, { name: 'Sick', paid: true, annual_days: 12, requires_reason: false })
    assert.doesNotMatch(await text(page, `${TYPES}[data-type=sick]`), /Placeholder/)
    assert.doesNotMatch(await text(page, `${TYPES}[data-type=vacation]`), /Placeholder/, 'no placeholder mark on any type')
  }, { as: ANNA }))

test('settings (HR): deactivate asks for confirmation, keeps existing requests, then Activate brings it back; the request form stops offering it', opts, () =>
  withLeave(browser, async ({ page, mock }) => {
    await visit(page, mock, '/leave?tab=settings', TYPES)
    await page.click(`${TYPES}[data-type=personal] [data-testid=type-deactivate]`)
    await page.waitForSelector('[data-testid=type-confirm-box]:visible')
    assert.match(await text(page, '[data-testid=type-confirm-box]:visible'), /Existing requests keep working/)
    await page.click('[data-testid=type-confirm-cancel]:visible')
    assert.equal(mock.state.types.find((t) => t.type_id === 'personal').active, true)
    await page.click(`${TYPES}[data-type=personal] [data-testid=type-deactivate]`)
    await page.click('[data-testid=type-confirm]:visible')
    await page.waitForSelector(`${TYPES}[data-type=personal][data-active=false]`)
    assert.match(await text(page, '[data-testid=settings-flash]'), /"Personal" is now inactive/)
    assert.deepEqual(mock.state.bodies.find((b) => b.route === 'PATCH /types/personal').body, { active: false })
    await visit(page, mock, '/leave/new', '[data-testid=leave-form]')
    assert.deepEqual(await page.$$eval('[data-testid=leave-type] option', (els) => els.map((e) => e.value)), ['', 'vacation', 'sick', 'unpaid'])
    await visit(page, mock, '/leave?tab=settings', TYPES)
    await page.click(`${TYPES}[data-type=personal] [data-testid=type-activate]`)
    await page.waitForSelector(`${TYPES}[data-type=personal][data-active=true]`)
  }, { as: ANNA }))

test('settings (HR): delete is offered only for unused custom types; a type with requests cannot be deleted from the UI', opts, () =>
  withLeave(browser, async ({ page, mock }) => {
    mock.state.types.push({ type_id: 'custom-a', name: 'Unused custom', paid: true, annual_days: 2, requires_reason: false, active: true, placeholder: false, sort_order: 50 })
    mock.state.types.push({ type_id: 'custom-b', name: 'Used custom', paid: true, annual_days: 2, requires_reason: false, active: true, placeholder: false, sort_order: 51 })
    seedRequest(mock.state, { employee_id: EMP.carla, type_id: 'custom-b', start_date: '2026-11-19', status: 'cancelled' })
    await visit(page, mock, '/leave?tab=settings', TYPES)
    assert.equal(await count(page, `${TYPES}[data-type=custom-b] [data-testid=type-delete]`), 0)
    await page.click(`${TYPES}[data-type=custom-a] [data-testid=type-delete]`)
    assert.match(await text(page, '[data-testid=type-confirm-box]:visible'), /Delete "Unused custom" for good/)
    await page.click('[data-testid=type-confirm]:visible')
    await page.waitForFunction(() => !document.querySelector('[data-testid=type-row][data-type=custom-a]'))
    assert.match(await text(page, '[data-testid=settings-flash]'), /Deleted "Unused custom"/)
  }, { as: ANNA }))

test('settings (HR): a refused change (server 409) is shown on that row', opts, () =>
  withLeave(browser, async ({ page, mock }) => {
    await visit(page, mock, '/leave?tab=settings', TYPES)
    mock.state.force['PATCH /types/:id'] = { status: 409, body: { detail: 'Could not update the type right now' } }
    mock.state.force['PATCH /types/sick'] = { status: 409, body: { detail: 'Could not update the type right now' } }
    await page.click(`${TYPES}[data-type=sick] [data-testid=type-deactivate]`)
    await page.click('[data-testid=type-confirm]:visible')
    await page.waitForSelector('[data-testid=type-row-error]:visible')
    assert.match(await text(page, '[data-testid=type-row-error]:visible'), /Could not update the type/)
  }, { as: ANNA }))

test('settings (HR): entitlement override - search a person, validation, save, list with the placeholder mark, remove with confirmation', opts, () =>
  withLeave(browser, async ({ page, mock }) => {
    await visit(page, mock, '/leave?tab=settings', '[data-testid=override-form]')
    assert.match(await text(page, '[data-testid=settings-overrides]'), /No overrides/)
    await page.click('[data-testid=override-save]')
    assert.equal(await count(page, '[data-testid=override-flash]'), 0)
    assert.ok(!mock.state.bodies.some((b) => b.route === 'POST /entitlements'), 'invalid form sends nothing')
    await page.fill('[data-testid=picker-input]', 'carla')
    await page.waitForSelector('[data-testid=picker-option]')
    await page.click('[data-testid=picker-option]')
    assert.match(await text(page, '[data-testid=picked-employee]'), /Carla Dizon \(EMP-0003\)/)
    await page.selectOption('[data-testid=override-type]', 'vacation')
    await page.fill('[data-testid=override-year]', '2026')
    await page.fill('[data-testid=override-days]', '7.25')
    await page.click('[data-testid=override-save]')
    assert.equal(await count(page, '[data-testid=override-row]'), 0)
    await page.fill('[data-testid=override-days]', '20')
    await page.click('[data-testid=override-save]')
    await page.waitForSelector('[data-testid=override-row]')
    assert.deepEqual(mock.state.bodies.find((b) => b.route === 'POST /entitlements').body, { employee_id: 'EMP-0003', type_id: 'vacation', year: 2026, days: 20 })
    assert.match(await text(page, '[data-testid=override-flash]'), /Carla Dizon now has 20 days of Vacation for 2026/)
    assert.match(await text(page, '[data-testid=override-row]'), /Carla Dizon/)
    assert.equal(await count(page, '[data-testid=picked-employee]'), 0, 'the form is ready for the next person')
    await page.click('[data-testid=override-remove]')
    assert.match(await text(page, '[data-testid=override-confirm-box]'), /default entitlement of the leave type applies again/)
    await page.click('[data-testid=override-remove-cancel]')
    assert.equal(mock.state.entitlements.length, 1)
    await page.click('[data-testid=override-remove]')
    await page.click('[data-testid=override-remove-confirm]')
    await page.waitForFunction(() => !document.querySelector('[data-testid=override-row]'))
    assert.equal(mock.state.entitlements.length, 0)
    assert.ok(mock.state.log.some((l) => /DELETE \/entitlements\?employee_id=EMP-0003&type_id=vacation&year=2026/.test(l)))
  }, { as: ANNA }))

test('settings (HR): the override year filter narrows the list; the people search needs 2 letters and says when nobody matches', opts, () =>
  withLeave(browser, async ({ page, mock }) => {
    mock.state.entitlements.push({ employee_id: EMP.carla, type_id: 'vacation', year: 2026, days: 20 }, { employee_id: EMP.dan, type_id: 'sick', year: 2025, days: 12 })
    await visit(page, mock, '/leave?tab=settings', '[data-testid=override-row]')
    assert.equal(await count(page, '[data-testid=override-row]'), 2)
    await page.selectOption('[data-testid=override-year-filter]', '2025')
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=override-row]').length === 1)
    assert.match(await text(page, '[data-testid=override-row]'), /Dan Ocampo/)
    await page.fill('[data-testid=picker-input]', 'c')
    await page.waitForTimeout(400)
    assert.equal(await count(page, '[data-testid=picker-results]'), 0)
    await page.fill('[data-testid=picker-input]', 'zzzzqq')
    await page.waitForSelector('[data-testid=picker-empty]')
  }, { as: ANNA }))

test('settings (HR): a server refusal on the override (422 unknown employee) is shown; a failing list has a retry', opts, () =>
  withLeave(browser, async ({ page, mock }) => {
    await visit(page, mock, '/leave?tab=settings', '[data-testid=override-form]')
    await page.fill('[data-testid=picker-input]', 'carla')
    await page.click('[data-testid=picker-option]')
    await page.selectOption('[data-testid=override-type]', 'sick')
    await page.fill('[data-testid=override-days]', '8')
    mock.state.force['POST /entitlements'] = { status: 422, body: { detail: 'Unknown employee', code: 'unknown_employee' } }
    await page.click('[data-testid=override-save]')
    await page.waitForSelector('[data-testid=override-error]')
    assert.match(await text(page, '[data-testid=override-error]'), /Unknown employee/)
    delete mock.state.force['POST /entitlements']
    mock.state.force['GET /entitlements'] = 500
    await page.selectOption('[data-testid=override-year-filter]', '2026')
    await page.waitForSelector('[data-testid=override-load-error]')
    delete mock.state.force['GET /entitlements']
    await page.click('[data-testid=override-load-error] button')
    await page.waitForFunction(() => !document.querySelector('[data-testid=override-load-error]'))
  }, { as: ANNA }))

test('settings: if the server refuses the catalog (403) the tab explains instead of showing broken controls', opts, () =>
  withLeave(browser, async ({ page, mock }) => {
    mock.state.force['GET /types'] = { status: 403, body: { detail: 'Not allowed' } }
    await visit(page, mock, '/leave?tab=settings', '[data-testid=settings-error]')
    assert.match(await text(page, '[data-testid=settings-error]'), /not available to you/)
    assert.equal(await count(page, '[data-testid=type-add]'), 0)
  }, { as: ANNA }))

// ------------------------------------------------------------------------------------------------ resilience
test('if /leave/config fails the pages still work', opts, () =>
  withLeave(browser, async ({ page, mock, errors }) => {
    mock.state.force['GET /config'] = 500
    await visit(page, mock, '/leave', '[data-testid=balance-card]')
    await visit(page, mock, '/leave/new', '[data-testid=leave-form]')
    assert.deepEqual(errors, [])
  }))

test('a 401 from the Leave API signs the user out (shared client behaviour), no raw error is shown', opts, () =>
  withLeave(browser, async ({ page, mock }) => {
    mock.state.force['GET /balances'] = { status: 401, body: { detail: 'Not authenticated' } }
    await page.goto(`${mock.origin}/leave`)
    await page.waitForURL(/\/login/)
  }))

test('no horizontal overflow on the calendar and settings at desktop width, even with long names', opts, () =>
  withLeave(browser, async ({ page, mock }) => {
    mock.state.types.push({ type_id: 'custom-long', name: 'A very long leave type name that keeps going and going without any spaces: Supercalifragilisticexpialidocious0123456789', paid: true, annual_days: 2, requires_reason: false, active: true, placeholder: false, sort_order: 60 })
    await visit(page, mock, '/leave?tab=settings', TYPES)
    assert.ok(await noOverflow(page))
    await visit(page, mock, '/leave?tab=calendar', CAL)
    assert.ok(await noOverflow(page))
  }, { as: ANNA }))

test('an employee cannot reach the catalog or the approvals lists, and the UI never calls them', opts, () =>
  withLeave(browser, async ({ page, mock }) => {
    await visit(page, mock, '/leave?tab=settings', '[data-testid=balance-card]')
    await visit(page, mock, '/leave?tab=approvals', '[data-testid=balance-card]')
    assert.ok(!mock.state.log.some((l) => /include_inactive|\/entitlements|scope=(review|all|team)/.test(l)))
  }, { as: CARLA }))
