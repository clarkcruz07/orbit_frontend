// Leave module against the self-contained leave mock (mock-leave.mjs): overview, balances, list filters and paging, the
// request form with the live day count, validation and server errors, the detail screen for the owner and the approver.
// Gated: RUN_BROWSER_TESTS=1 (use `npm run test:browser`). Fictional data only.
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { seedRequest } from './mock-leave.mjs'
import { ANNA, BEN, CARLA, DAN, EMP, count, enabled, fillForm, launchBrowser, noOverflow, opts, previewState, seedBasic, text, until, visit, waitGone, withLeave } from './leave-helpers.mjs'

let browser
before(async () => {
  if (enabled) browser = await launchBrowser()
})
after(async () => {
  await browser?.close()
})

const LEAVE_READY = '[data-testid=tab-panel-my] [data-testid=balance-card]'
const TAB_TITLES = (page) => page.$$eval('[role=tab]', (els) => els.map((e) => e.textContent.trim()))

// ------------------------------------------------------------------------------------------------ overview
test('overview: an employee sees My leave + Team calendar only, no console errors', opts, () =>
  withLeave(browser, async ({ page, mock, errors }) => {
    await visit(page, mock, '/leave', LEAVE_READY)
    assert.deepEqual(await TAB_TITLES(page), ['My leave', 'Team calendar'])
    assert.equal(await count(page, '[data-testid=leave-tab-approvals]'), 0)
    assert.equal(await count(page, '[data-testid=leave-tab-settings]'), 0)
    assert.equal(await page.getAttribute('[data-testid=leave-tab-my]', 'aria-selected'), 'true')
    assert.ok(await page.isVisible('[data-testid=leave-new-link]'))
    assert.equal(await page.title().then((t) => typeof t), 'string')
    assert.deepEqual(errors, [])
  }))

test('balances: entitlement / used / pending / remaining per type', opts, () =>
  withLeave(browser, async ({ page, mock }) => {
    await visit(page, mock, '/leave', LEAVE_READY)
    const vac = page.locator('[data-testid=balance-card][data-type=vacation]')
    assert.equal((await vac.locator('[data-testid=balance-entitlement]').innerText()).trim(), '15')
    assert.equal((await vac.locator('[data-testid=balance-used]').innerText()).trim(), '3', 'approved 7-9 Dec counts as used')
    assert.equal((await vac.locator('[data-testid=balance-pending]').innerText()).trim(), '3', 'pending 23-25 Nov counts as pending')
    assert.match(await vac.locator('[data-testid=balance-remaining]').innerText(), /9\s*days remaining/)
    const unpaid = page.locator('[data-testid=balance-card][data-type=unpaid]')
    assert.match(await unpaid.locator('[data-testid=balance-remaining]').innerText(), /No limit/)
    const cards = await count(page, '[data-testid=balance-card]')
    assert.equal(cards, 4)
  }))

test('balances: the year selector reloads other years; an HR override is shown as "Set by HR for you"', opts, () =>
  withLeave(browser, async ({ page, mock }) => {
    mock.state.entitlements.push({ employee_id: EMP.carla, type_id: 'vacation', year: 2026, days: 20 })
    await visit(page, mock, '/leave', LEAVE_READY)
    assert.match(await text(page, '[data-testid=balance-card][data-type=vacation]'), /Set by HR for you/)
    assert.equal((await page.locator('[data-testid=balance-card][data-type=vacation] [data-testid=balance-entitlement]').innerText()).trim(), '20')
    await page.selectOption('[data-testid=balance-year]', '2027')
    await page.waitForSelector('[data-testid=balance-cards][data-year="2027"]')
    assert.equal((await page.locator('[data-testid=balance-card][data-type=vacation] [data-testid=balance-entitlement]').innerText()).trim(), '15')
    assert.ok(mock.state.log.some((l) => l.startsWith('GET /balances?year=2027')))
    assert.match(page.url(), /by=2027/)
  }))

test('my requests: table with status pills, newest start first; a row opens its detail', opts, () =>
  withLeave(browser, async ({ page, mock, ids }) => {
    await visit(page, mock, '/leave', '[data-testid=leave-row]')
    const rows = await page.$$eval('[data-testid=leave-row]', (els) => els.map((e) => [e.dataset.status, e.dataset.id]))
    assert.deepEqual(rows.map((r) => r[0]), ['clarification_requested', 'approved', 'pending', 'rejected', 'cancelled'])
    assert.equal(rows[2][1], ids.pending)
    assert.match(await text(page, '[data-testid=leave-row][data-status=pending]'), /23 to 25 Nov 2026/)
    assert.match(await text(page, '[data-testid=leave-row][data-status=pending]'), /Waiting|Ben Cruz/)
    await page.click(`[data-testid=leave-row][data-id="${ids.pending}"] [data-testid=leave-open]`)
    await page.waitForSelector('[data-testid=leave-detail]')
    assert.equal(new URL(page.url()).pathname, `/leave/${ids.pending}`)
  }))

test('my requests: status filter narrows the list, lives in the URL, can be cleared; empty filter result is honest', opts, () =>
  withLeave(browser, async ({ page, mock }) => {
    await visit(page, mock, '/leave', '[data-testid=leave-row]')
    await page.selectOption('[data-testid=leave-status-filter]', 'approved')
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=leave-row]').length === 1)
    assert.match(page.url(), /status=approved/)
    assert.ok(mock.state.log.some((l) => /GET \/requests\?.*status=approved/.test(l)))
    await page.selectOption('[data-testid=leave-type-filter]', 'unpaid')
    await page.waitForSelector('[data-testid=leave-list-error], [data-testid=empty-state]')
    assert.match(await text(page, '[data-testid=empty-state]'), /No requests match these filters/)
    await page.click('[data-testid=leave-clear-filters]')
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=leave-row]').length === 5)
    assert.doesNotMatch(page.url(), /status=|type=/)
  }))

test('my requests: paging 10 per page with Previous/Next and a range text; a stale page falls back to the last page', opts, () =>
  withLeave(browser, async ({ page, mock }) => {
    for (let i = 0; i < 18; i++) seedRequest(mock.state, { employee_id: EMP.carla, type_id: 'unpaid', start_date: `2027-01-${String(4 + i).padStart(2, '0')}`, status: 'cancelled' })
    await visit(page, mock, '/leave', '[data-testid=leave-row]')
    assert.equal(await count(page, '[data-testid=leave-row]'), 10)
    assert.match(await text(page, '[data-testid=leave-range]'), /1-10 of 23/)
    assert.ok(await page.isDisabled('[data-testid=leave-prev]'))
    await page.click('[data-testid=leave-next]')
    await page.waitForFunction(() => /11-20 of 23/.test(document.querySelector('[data-testid=leave-range]')?.textContent || ''))
    assert.match(page.url(), /page=2/)
    await page.click('[data-testid=leave-next]')
    await page.waitForFunction(() => /21-23 of 23/.test(document.querySelector('[data-testid=leave-range]')?.textContent || ''))
    assert.equal(await count(page, '[data-testid=leave-row]'), 3)
    assert.ok(await page.isDisabled('[data-testid=leave-next]'))
    await visit(page, mock, '/leave?page=9', '[data-testid=leave-row]')
    assert.match(await text(page, '[data-testid=leave-range]'), /21-23 of 23/, 'a stale page number lands on the last real page')
    await visit(page, mock, '/leave?page=abc', '[data-testid=leave-row]')
    assert.match(await text(page, '[data-testid=leave-range]'), /1-10 of 23/)
  }))

test('my requests: honest empty state with a working "New leave request" action when there are none', opts, () =>
  withLeave(browser, async ({ page, mock }) => {
    await visit(page, mock, '/leave', '[data-testid=requests-panel] [data-testid=empty-state]')
    assert.match(await text(page, '[data-testid=requests-panel] [data-testid=empty-state]'), /No leave requests yet/)
    await page.click('[data-testid=leave-new-empty]')
    await page.waitForSelector('[data-testid=leave-new]')
    assert.equal(new URL(page.url()).pathname, '/leave/new')
  }, { seed: false }))

test('my requests: a failed load shows a message with "Try again" that recovers; a slow load shows a skeleton', opts, () =>
  withLeave(browser, async ({ page, mock }) => {
    mock.state.force['GET /requests'] = 500
    mock.state.delay['GET /requests'] = 400
    await page.goto(`${mock.origin}/leave`)
    await page.waitForSelector('[data-testid=leave-list-loading]')
    await page.waitForSelector('[data-testid=leave-list-error]')
    assert.match(await text(page, '[data-testid=leave-list-error]'), /service had a problem/)
    delete mock.state.force['GET /requests']
    await page.click('[data-testid=leave-list-error] button')
    await page.waitForSelector('[data-testid=leave-row]')
  }))

test('a failed balances call is reported and retried without hiding the requests', opts, () =>
  withLeave(browser, async ({ page, mock }) => {
    mock.state.force['GET /balances'] = 500
    await visit(page, mock, '/leave', '[data-testid=balances-error]')
    assert.ok(await page.isVisible('[data-testid=leave-row]'))
    delete mock.state.force['GET /balances']
    await page.click('[data-testid=balances-error] button')
    await page.waitForSelector('[data-testid=balance-card]')
  }))

test('forced ?tab=approvals / ?tab=settings for an employee fall back to My leave (no calls made to those lists)', opts, () =>
  withLeave(browser, async ({ page, mock }) => {
    for (const t of ['approvals', 'settings']) {
      await visit(page, mock, `/leave?tab=${t}`, LEAVE_READY)
      assert.equal(await page.getAttribute('[data-testid=leave-tab-my]', 'aria-selected'), 'true')
    }
    assert.ok(!mock.state.log.some((l) => /scope=review|scope=all|include_inactive/.test(l)))
  }))

test('deep link /leave?request=<id> (the notification link) opens that request', opts, () =>
  withLeave(browser, async ({ page, mock, ids }) => {
    await page.goto(`${mock.origin}/leave?request=${ids.pending}`)
    await page.waitForSelector('[data-testid=leave-detail]')
    assert.equal(new URL(page.url()).pathname, `/leave/${ids.pending}`)
    assert.equal(await page.getAttribute('[data-testid=leave-detail]', 'data-id'), ids.pending)
    // a malformed id is not followed blindly: the overview shows instead
    await page.goto(`${mock.origin}/leave?request=../../etc`)
    await page.waitForSelector('[data-testid=leave-page]')
    assert.equal(new URL(page.url()).pathname, '/leave')
  }))

test('keyboard: arrow keys move between tabs and the selected tab is the only tab stop', opts, () =>
  withLeave(browser, async ({ page, mock }) => {
    await visit(page, mock, '/leave', LEAVE_READY)
    await page.focus('[data-testid=leave-tab-my]')
    await page.keyboard.press('ArrowRight')
    await page.waitForSelector('[data-testid=tab-panel-calendar]')
    assert.equal(await page.getAttribute('[data-testid=leave-tab-calendar]', 'aria-selected'), 'true')
    assert.equal(await page.getAttribute('[data-testid=leave-tab-my]', 'tabindex'), '-1')
    assert.match(page.url(), /tab=calendar/)
  }))

// ------------------------------------------------------------------------------------------------ new request
test('new request: half-day options are disabled until start == end, and reset when the range grows', opts, () =>
  withLeave(browser, async ({ page, mock }) => {
    await visit(page, mock, '/leave/new', '[data-testid=leave-form]')
    assert.ok(await page.isDisabled('[data-testid=leave-half-am]'))
    assert.ok(await page.isDisabled('[data-testid=leave-half-pm]'))
    assert.match(await text(page, '[data-testid=half-help]'), /only for a single day/)
    await page.selectOption('[data-testid=leave-type]', 'vacation')
    await page.fill('[data-testid=leave-start]', '2026-11-19')
    assert.equal(await page.inputValue('[data-testid=leave-end]'), '2026-11-19', 'end follows the start date')
    assert.ok(await page.isEnabled('[data-testid=leave-half-am]'))
    await page.check('[data-testid=leave-half-pm]')
    await previewState(page, 'valid')
    assert.equal(await page.getAttribute('[data-testid=preview-days]', 'data-days'), '0.5')
    assert.match(await text(page, '[data-testid=preview-days]'), /0\.5 days of leave/)
    await page.fill('[data-testid=leave-end]', '2026-11-20')
    assert.ok(await page.isDisabled('[data-testid=leave-half-am]'))
    assert.ok(await page.isChecked('[data-testid=leave-half-none]'), 'a range cannot stay a half day')
    await previewState(page, 'valid')
    assert.equal(await page.getAttribute('[data-testid=preview-days]', 'data-days'), '2')
  }))

test('new request: live day count excludes weekends and the company holiday, shows the balance after the request', opts, () =>
  withLeave(browser, async ({ page, mock }) => {
    await visit(page, mock, '/leave/new', '[data-testid=leave-form]')
    await previewState(page, 'idle')
    assert.match(await text(page, '[data-testid=leave-preview]'), /Choose a leave type and dates/)
    await fillForm(page, { type: 'vacation', start: '2026-11-27', end: '2026-12-01' })
    await previewState(page, 'valid')
    assert.equal(await page.getAttribute('[data-testid=preview-days]', 'data-days'), '2')
    const notes = await text(page, '[data-testid=preview-notes]')
    assert.match(notes, /2 weekend days are not counted/)
    assert.match(notes, /Mon 30 Nov 2026 is a company holiday \(Bonifacio Day\)/)
    // balance before: 15 - 3 used - 3 pending = 9; after this request: 7
    assert.match(await text(page, '[data-testid=preview-balance]'), /2026: 7 days left after this request/)
    assert.match(await text(page, '[data-testid=form-balance]'), /Vacation 2026: 9 days left of 15, 3 used, 3 pending/)
    assert.ok(await page.isVisible('[data-testid=preview-ok]'))
    const q = mock.state.log.filter((l) => l.startsWith('GET /preview')).pop()
    assert.match(q, /type_id=vacation&start_date=2026-11-27&end_date=2026-12-01&half_day=none/)
  }))

test('new request: a range across the year end is counted per calendar year', opts, () =>
  withLeave(browser, async ({ page, mock }) => {
    await visit(page, mock, '/leave/new', '[data-testid=leave-form]')
    await fillForm(page, { type: 'vacation', start: '2026-12-28', end: '2027-01-05' })
    await previewState(page, 'valid')
    assert.match(await text(page, '[data-testid=preview-notes]'), /per calendar year: 2026: 3 days, 2027: 2 days/)
    assert.equal(await count(page, '[data-testid=preview-balance] li'), 2)
  }))

test('new request: submit sends exactly the form, lands on the detail with a confirmation, and the list shows it', opts, () =>
  withLeave(browser, async ({ page, mock }) => {
    await visit(page, mock, '/leave/new', '[data-testid=leave-form]')
    await fillForm(page, { type: 'sick', start: '2026-12-02', end: '2026-12-02', half: 'am', reason: '  Dentist  ' })
    await previewState(page, 'valid')
    await page.click('[data-testid=leave-submit]')
    await page.waitForSelector('[data-testid=leave-detail]')
    assert.match(await text(page, '[data-testid=leave-flash]'), /Leave request sent/)
    const post = mock.state.bodies.find((b) => b.route === 'POST /requests')
    assert.deepEqual(post.body, { type_id: 'sick', start_date: '2026-12-02', end_date: '2026-12-02', half_day: 'am', reason: 'Dentist' })
    assert.equal(await page.getAttribute('[data-testid=leave-detail]', 'data-status'), 'pending')
    assert.match(await text(page, '[data-testid=fact-days]'), /0\.5 days/)
    assert.match(await text(page, '[data-testid=fact-days]'), /Morning \(am\)/)
    await page.click('[data-testid=leave-back]')
    await page.waitForSelector('[data-testid=leave-row]')
    assert.ok((await text(page, '[data-testid=requests-panel]')).includes('2 Dec 2026 (am)'))
  }))

test('new request: submitting an empty or invalid form shows field errors, moves focus, and sends nothing', opts, () =>
  withLeave(browser, async ({ page, mock }) => {
    await visit(page, mock, '/leave/new', '[data-testid=leave-form]')
    await page.click('[data-testid=leave-submit]')
    assert.match(await text(page, '[data-testid=error-type]'), /Choose a leave type/)
    assert.match(await text(page, '[data-testid=error-start]'), /Choose a start date/)
    assert.match(await text(page, '[data-testid=error-end]'), /Choose an end date/)
    assert.match(await text(page, '[data-testid=form-error]'), /Some values need attention/)
    assert.equal(await page.evaluate(() => document.activeElement?.dataset?.testid), 'leave-type', 'focus goes to the first invalid field')
    assert.ok(!mock.state.bodies.some((b) => b.route === 'POST /requests'))
    await page.selectOption('[data-testid=leave-type]', 'vacation')
    await page.fill('[data-testid=leave-start]', '2026-11-25')
    await page.fill('[data-testid=leave-end]', '2026-11-23')
    await page.click('[data-testid=leave-submit]')
    assert.match(await text(page, '[data-testid=error-end]'), /end date cannot be before the start date/)
    assert.equal(await page.getAttribute('[data-testid=leave-end]', 'aria-invalid'), 'true')
    assert.ok(!mock.state.bodies.some((b) => b.route === 'POST /requests'))
    // the preview is not asked for an invalid range
    assert.ok(!mock.state.log.some((l) => /GET \/preview.*start_date=2026-11-25&end_date=2026-11-23/.test(l)))
  }))

test('new request: a type that needs a reason says so and blocks the empty reason', opts, () =>
  withLeave(browser, async ({ page, mock }) => {
    mock.state.types.find((t) => t.type_id === 'personal').requires_reason = true
    await visit(page, mock, '/leave/new', '[data-testid=leave-form]')
    await fillForm(page, { type: 'personal', start: '2026-11-19' })
    assert.match(await text(page, '[data-testid=type-help]'), /reason required/)
    await page.click('[data-testid=leave-submit]')
    assert.match(await text(page, '[data-testid=error-reason]'), /needs a reason/)
    assert.ok(!mock.state.bodies.some((b) => b.route === 'POST /requests'))
    await page.fill('[data-testid=leave-reason]', 'Family matter')
    await page.click('[data-testid=leave-submit]')
    await page.waitForSelector('[data-testid=leave-detail]')
  }))

test('new request: the reason counter stops at 500 characters', opts, () =>
  withLeave(browser, async ({ page, mock }) => {
    await visit(page, mock, '/leave/new', '[data-testid=leave-form]')
    await page.fill('[data-testid=leave-reason]', 'x'.repeat(700))
    assert.equal((await text(page, '[data-testid=reason-counter]')).trim(), '500/500')
  }))

test('new request: an overlap is flagged by the preview and the 409 message links to the existing request', opts, () =>
  withLeave(browser, async ({ page, mock, ids }) => {
    await visit(page, mock, '/leave/new', '[data-testid=leave-form]')
    await fillForm(page, { type: 'vacation', start: '2026-11-24', end: '2026-11-26' })
    await previewState(page, 'issues')
    assert.match(await text(page, '[data-testid=preview-issue][data-code=overlap]'), /overlaps/)
    await page.click('[data-testid=leave-submit]')
    await page.waitForSelector('[data-testid=form-error]')
    assert.match(await text(page, '[data-testid=form-error]'), /already have a pending or approved leave request that overlaps/)
    await page.click('[data-testid=conflict-link]')
    await page.waitForSelector('[data-testid=leave-detail]')
    assert.equal(await page.getAttribute('[data-testid=leave-detail]', 'data-id'), ids.pending)
  }))

test('new request: not enough balance is flagged by the preview and the 422 message names the days left and needed', opts, () =>
  withLeave(browser, async ({ page, mock }) => {
    await visit(page, mock, '/leave/new', '[data-testid=leave-form]')
    // Personal has 3 days; ask for 5 working days (Mon 2 Feb - Fri 6 Feb 2027)
    await fillForm(page, { type: 'personal', start: '2027-02-01', end: '2027-02-05' })
    await previewState(page, 'issues')
    assert.match(await text(page, '[data-testid=preview-issue][data-code=insufficient_balance]'), /Not enough leave balance: 3 day\(s\) remaining for 2027/)
    await page.click('[data-testid=leave-submit]')
    await page.waitForSelector('[data-testid=form-error]')
    assert.equal((await text(page, '[data-testid=form-error]')).trim(), 'Not enough leave balance: you have 3 days left for 2027 and this request needs 5 days.')
    assert.ok(!mock.state.requests.some((r) => r.start_date === '2027-02-01'), 'nothing was stored')
  }))

test('new request: weekend-only dates are refused with a clear message (no working days)', opts, () =>
  withLeave(browser, async ({ page, mock }) => {
    await visit(page, mock, '/leave/new', '[data-testid=leave-form]')
    await fillForm(page, { type: 'vacation', start: '2026-11-28', end: '2026-11-29' })
    await previewState(page, 'issues')
    assert.match(await text(page, '[data-testid=preview-issue][data-code=no_working_days]'), /no working days/)
    assert.match(await text(page, '[data-testid=preview-days]'), /No working days/)
    await page.click('[data-testid=leave-submit]')
    await page.waitForSelector('[data-testid=form-error]')
    assert.match(await text(page, '[data-testid=form-error]'), /no working days.*Weekends and company holidays are not counted/)
  }))

test('new request: unpaid leave shows "no balance limit" and is accepted beyond any entitlement', opts, () =>
  withLeave(browser, async ({ page, mock }) => {
    await visit(page, mock, '/leave/new', '[data-testid=leave-form]')
    await fillForm(page, { type: 'unpaid', start: '2027-03-01', end: '2027-03-31' })
    await previewState(page, 'valid')
    assert.match(await text(page, '[data-testid=preview-balance]'), /no balance limit for this type/)
    await page.click('[data-testid=leave-submit]')
    await page.waitForSelector('[data-testid=leave-detail]')
  }))

test('new request: the preview answers a 422 (date outside the window) with a readable message, not a crash', opts, () =>
  withLeave(browser, async ({ page, mock, errors }) => {
    mock.state.force['GET /preview'] = { status: 422, body: { detail: 'Mocked', code: 'date_window' } }
    await visit(page, mock, '/leave/new', '[data-testid=leave-form]')
    await fillForm(page, { type: 'vacation', start: '2026-11-19' })
    await previewState(page, 'error')
    assert.match(await text(page, '[data-testid=preview-error]'), /within 365 days of today/)
    delete mock.state.force['GET /preview']
    await page.fill('[data-testid=leave-end]', '2026-11-20')
    await previewState(page, 'valid')
    assert.deepEqual(errors, [])
  }))

test('new request: a server rejection with field errors (422 Invalid request) is shown at the field; a 403 account without an employee record is explained', opts, () =>
  withLeave(browser, async ({ page, mock }) => {
    await visit(page, mock, '/leave/new', '[data-testid=leave-form]')
    await fillForm(page, { type: 'vacation', start: '2026-11-19' })
    mock.state.force['POST /requests'] = { status: 422, body: { detail: 'Invalid request', errors: [{ loc: ['body', 'reason'], msg: 'String should have at most 500 characters' }] } }
    await page.click('[data-testid=leave-submit]')
    await page.waitForSelector('[data-testid=form-error]')
    assert.match(await text(page, '[data-testid=error-reason]'), /at most 500 characters/)
    mock.state.force['POST /requests'] = { status: 403, body: { detail: 'Your account has no employee record' } }
    await page.fill('[data-testid=leave-reason]', 'Now')
    await page.click('[data-testid=leave-submit]')
    await page.waitForFunction(() => /no employee record/.test(document.querySelector('[data-testid=form-error]')?.textContent || ''))
  }))

test('new request: types that cannot load show an error with retry', opts, () =>
  withLeave(browser, async ({ page, mock }) => {
    mock.state.force['GET /types'] = 500
    await visit(page, mock, '/leave/new', '[data-testid=types-error]')
    delete mock.state.force['GET /types']
    await page.click('[data-testid=types-error] button')
    await page.waitForSelector('[data-testid=leave-form]')
  }))

// ------------------------------------------------------------------------------------------------ detail: owner
test('detail (owner, pending): facts, history and ONLY the cancel action; cancelling needs a confirmation and frees the balance', opts, () =>
  withLeave(browser, async ({ page, mock, ids }) => {
    await visit(page, mock, `/leave/${ids.pending}`, '[data-testid=leave-detail]')
    assert.equal(await page.getAttribute('[data-testid=leave-detail]', 'data-mode'), 'readonly')
    assert.match(await text(page, '[data-testid=detail-title]'), /Vacation leave/)
    assert.match(await text(page, '[data-testid=fact-dates]'), /Mon 23 Nov 2026 to Wed 25 Nov 2026/)
    assert.match(await text(page, '[data-testid=fact-days]'), /3 days/)
    assert.match(await text(page, '[data-testid=fact-approver]'), /Waiting for Ben Cruz/)
    assert.match(await text(page, '[data-testid=fact-reason]'), /Family trip to Baguio/)
    assert.equal(await count(page, '[data-testid=decision-panel]'), 0)
    assert.equal(await count(page, '[data-testid=edit-panel]'), 0)
    assert.equal(await count(page, '[data-testid=cancel-panel]'), 1)
    await page.click('[data-testid=leave-cancel]')
    await page.waitForSelector('[data-testid=cancel-confirm-box]')
    assert.match(await text(page, '[data-testid=cancel-confirm-box]'), /days will not be used/)
    await page.click('[data-testid=cancel-keep]')
    assert.equal(await count(page, '[data-testid=cancel-confirm-box]'), 0)
    assert.equal(mock.state.requests.find((r) => r.request_id === ids.pending).status, 'pending')
    await page.click('[data-testid=leave-cancel]')
    await page.click('[data-testid=cancel-confirm]')
    await page.waitForFunction(() => document.querySelector('[data-testid=leave-detail]')?.dataset.status === 'cancelled')
    assert.match(await text(page, '[data-testid=leave-flash]'), /Request cancelled/)
    assert.equal(await count(page, '[data-testid=cancel-panel]'), 0, 'a cancelled request has no actions left')
    assert.ok(await page.isVisible('[data-testid=no-actions]'))
    assert.ok((await text(page, '[data-testid=leave-timeline]')).includes('Cancelled'))
    assert.deepEqual(mock.state.bodies.find((b) => b.route.endsWith('/cancel')).body, { version: 1 })
  }))

test('detail (owner, approved in the future): cancel warns that the approver will be told', opts, () =>
  withLeave(browser, async ({ page, mock, ids }) => {
    await visit(page, mock, `/leave/${ids.approved}`, '[data-testid=leave-detail]')
    assert.match(await text(page, '[data-testid=cancel-panel]'), /approver will be told/)
    await page.click('[data-testid=leave-cancel]')
    assert.match(await text(page, '[data-testid=cancel-confirm-box]'), /approver will be notified and the days return to your balance/)
    assert.match(await text(page, '[data-testid=leave-timeline]'), /Approved/)
    assert.match(await text(page, '[data-testid=timeline-comment]'), /Enjoy the break/)
  }))

test('detail (owner, approved and already started): no cancel action is offered', opts, () =>
  withLeave(browser, async ({ page, mock }) => {
    const r = seedRequest(mock.state, { employee_id: EMP.carla, start_date: '2026-11-12', end_date: '2026-11-13', status: 'approved' })
    await visit(page, mock, `/leave/${r.request_id}`, '[data-testid=leave-detail]')
    assert.equal(await count(page, '[data-testid=cancel-panel]'), 0)
    assert.ok(await page.isVisible('[data-testid=no-actions]'))
  }))

test('detail (owner, rejected): terminal, shows the rejection comment, no actions', opts, () =>
  withLeave(browser, async ({ page, mock, ids }) => {
    await visit(page, mock, `/leave/${ids.rejected}`, '[data-testid=leave-detail]')
    assert.match(await text(page, '[data-testid=timeline-comment]'), /medical note/)
    assert.match(await text(page, '[data-testid=fact-status]'), /Rejected/)
    assert.equal(await count(page, '[data-testid=cancel-panel]'), 0)
    assert.equal(await count(page, '[data-testid=edit-panel]'), 0)
  }))

test('detail (owner, clarification requested): shows the question, edit + resubmit work, the approver is asked again', opts, () =>
  withLeave(browser, async ({ page, mock, ids }) => {
    await visit(page, mock, `/leave/${ids.clarify}`, '[data-testid=leave-detail]')
    assert.equal(await page.getAttribute('[data-testid=leave-detail]', 'data-mode'), 'editor')
    assert.match(await text(page, '[data-testid=clarify-note]'), /Which days exactly, and who covers the desk\?/)
    assert.ok(await page.isDisabled('[data-testid=leave-save]'), 'nothing to save yet')
    assert.equal(await page.inputValue('[data-testid=edit-panel] [data-testid=leave-start]'), '2026-12-14')
    await page.fill('[data-testid=edit-panel] [data-testid=leave-end]', '2026-12-16')
    await page.fill('[data-testid=edit-panel] [data-testid=leave-reason]', 'Trip. Ria covers the desk.')
    await page.click('[data-testid=leave-save]')
    await page.waitForFunction(() => /Changes saved/.test(document.querySelector('[data-testid=leave-flash]')?.textContent || ''))
    const patch = mock.state.bodies.find((b) => b.route.startsWith('PATCH'))
    assert.deepEqual(patch.body, { version: 1, end_date: '2026-12-16', reason: 'Trip. Ria covers the desk.' })
    assert.equal(await page.getAttribute('[data-testid=leave-detail]', 'data-status'), 'clarification_requested', 'saving does not resubmit')
    assert.match(await text(page, '[data-testid=fact-days]'), /3 days/)
    await page.click('[data-testid=leave-resubmit]')
    await page.waitForFunction(() => document.querySelector('[data-testid=leave-detail]')?.dataset.status === 'pending')
    assert.match(await text(page, '[data-testid=leave-flash]'), /sent again for approval/)
    assert.deepEqual(mock.state.bodies.find((b) => b.route.endsWith('/resubmit')).body, { version: 2 })
    const kinds = await page.$$eval('[data-testid=timeline-item]', (els) => els.map((e) => e.dataset.kind))
    assert.deepEqual(kinds, ['submitted', 'clarify', 'resubmitted'])
    assert.equal(await count(page, '[data-testid=edit-panel]'), 0)
    assert.equal(await count(page, '[data-testid=cancel-panel]'), 1)
  }))

test('detail (clarification): "Save and resubmit" saves first then resubmits; a rule failure at resubmit is shown on the form', opts, () =>
  withLeave(browser, async ({ page, mock, ids }) => {
    await visit(page, mock, `/leave/${ids.clarify}`, '[data-testid=edit-panel]')
    // move onto the approved 7-9 Dec request: the resubmit must be refused with an overlap
    await page.fill('[data-testid=edit-panel] [data-testid=leave-start]', '2026-12-08')
    await page.fill('[data-testid=edit-panel] [data-testid=leave-end]', '2026-12-10')
    assert.match(await text(page, '[data-testid=leave-resubmit]'), /Save and resubmit/)
    await page.click('[data-testid=leave-resubmit]')
    await page.waitForSelector('[data-testid=edit-error]')
    assert.match(await text(page, '[data-testid=edit-error]'), /overlaps/)
    assert.ok(await page.isVisible('[data-testid=edit-error] [data-testid=conflict-link]'))
    assert.equal(await page.getAttribute('[data-testid=leave-detail]', 'data-status'), 'clarification_requested')
  }))

test('detail (clarification): editing validates locally (end before start) before anything is sent', opts, () =>
  withLeave(browser, async ({ page, mock, ids }) => {
    await visit(page, mock, `/leave/${ids.clarify}`, '[data-testid=edit-panel]')
    await page.fill('[data-testid=edit-panel] [data-testid=leave-end]', '2026-12-10')
    await page.click('[data-testid=leave-resubmit]')
    await page.waitForFunction(() => /end date cannot be before/.test(document.querySelector('[data-testid=error-end]')?.textContent || ''))
    assert.ok(!mock.state.bodies.some((b) => b.route.startsWith('PATCH') || b.route.endsWith('/resubmit')))
  }))

test('detail: an unknown or invisible request shows the same "not found" view, never details', opts, () =>
  withLeave(browser, async ({ page, mock, ids }) => {
    await visit(page, mock, '/leave/00000000-0000-4000-8000-0000000000ff', '[data-testid=leave-missing]')
    assert.match(await text(page, '[data-testid=leave-missing]'), /does not exist, or you do not have access/)
    // Carla cannot see Ben's request: 404 view
    await visit(page, mock, `/leave/${ids.benPending}`, '[data-testid=leave-missing]')
    assert.equal(await count(page, '[data-testid=leave-detail]'), 0)
    assert.ok(!(await page.content()).includes('Ben Cruz'.concat(' - ', 'Dec')))
    await page.click('[data-testid=leave-missing] a')
    await page.waitForSelector('[data-testid=leave-page]')
  }))

test('detail: a server error shows a message with "Try again"; a slow load shows a skeleton', opts, () =>
  withLeave(browser, async ({ page, mock, ids }) => {
    mock.state.force['GET /requests/:id'] = 500
    mock.state.delay['GET /requests/:id'] = 300
    await page.goto(`${mock.origin}/leave/${ids.pending}`)
    await page.waitForSelector('[data-testid=detail-loading]')
    await page.waitForSelector('[data-testid=detail-error]')
    delete mock.state.force['GET /requests/:id']
    await page.click('[data-testid=detail-error] button')
    await page.waitForSelector('[data-testid=leave-detail]')
  }))

test('detail: a stale write (409) reloads the latest version and says so', opts, () =>
  withLeave(browser, async ({ page, mock, ids }) => {
    await visit(page, mock, `/leave/${ids.pending}`, '[data-testid=leave-detail]')
    // someone else changes the request behind the page's back
    mock.state.requests.find((r) => r.request_id === ids.pending).version = 5
    await page.click('[data-testid=leave-cancel]')
    await page.click('[data-testid=cancel-confirm]')
    await page.waitForSelector('[data-testid=conflict-banner]')
    assert.match(await text(page, '[data-testid=conflict-banner]'), /changed by someone else.*reloaded the latest version/)
    assert.equal(await page.getAttribute('[data-testid=leave-detail]', 'data-status'), 'pending')
    await page.click('[data-testid=leave-cancel]')
    await page.click('[data-testid=cancel-confirm]')
    await page.waitForFunction(() => document.querySelector('[data-testid=leave-detail]')?.dataset.status === 'cancelled')
  }))

// ------------------------------------------------------------------------------------------------ detail: approver
test('detail (approver): decision panel from allowed_actions; reject and clarify need a comment; approve asks for confirmation', opts, () =>
  withLeave(browser, async ({ page, mock, ids }) => {
    await visit(page, mock, `/leave/${ids.pending}`, '[data-testid=leave-detail]')
    assert.equal(await page.getAttribute('[data-testid=leave-detail]', 'data-mode'), 'decider')
    assert.match(await text(page, '[data-testid=fact-employee]'), /Carla Dizon/)
    assert.equal(await count(page, '[data-testid=cancel-panel]'), 0, 'approvers cannot cancel someone else\'s leave')
    assert.ok(await page.isDisabled('[data-testid=leave-reject]'))
    assert.ok(await page.isDisabled('[data-testid=leave-clarify]'))
    assert.ok(await page.isEnabled('[data-testid=leave-approve]'))
    await page.fill('[data-testid=leave-comment]', 'Please confirm cover')
    assert.ok(await page.isEnabled('[data-testid=leave-reject]'))
    assert.match(await text(page, '[data-testid=decision-counter]'), /20\/1000/)
    await page.click('[data-testid=leave-approve]')
    await page.waitForSelector('[data-testid=decision-confirm-box]')
    await page.click('[data-testid=decision-cancel]')
    assert.equal(mock.state.requests.find((r) => r.request_id === ids.pending).status, 'pending')
    await page.click('[data-testid=leave-approve]')
    await page.click('[data-testid=decision-confirm]')
    await page.waitForFunction(() => document.querySelector('[data-testid=leave-detail]')?.dataset.status === 'approved')
    assert.match(await text(page, '[data-testid=leave-flash]'), /Leave approved/)
    assert.equal(await count(page, '[data-testid=decision-panel]'), 0, 'the panel disappears once decided')
    const body = mock.state.bodies.find((b) => b.route.endsWith('/decision')).body
    assert.deepEqual(body, { action: 'approve', comment: 'Please confirm cover', version: 1 })
    assert.match(await text(page, '[data-testid=timeline-comment]'), /Please confirm cover/)
    assert.ok(await page.isVisible('[data-testid=leave-back]'))
    assert.match(await text(page, '[data-testid=leave-back]'), /Back to approvals/)
  }, { as: BEN }))

test('detail (approver): reject and ask-for-clarification record the comment with a confirmation step', opts, () =>
  withLeave(browser, async ({ page, mock, ids }) => {
    await visit(page, mock, `/leave/${ids.pending}`, '[data-testid=decision-panel]')
    await page.fill('[data-testid=leave-comment]', 'Not that week')
    await page.click('[data-testid=leave-reject]')
    assert.match(await text(page, '[data-testid=decision-confirm-box]'), /Reject this leave request\? This ends it/)
    await page.click('[data-testid=decision-confirm]')
    await page.waitForFunction(() => document.querySelector('[data-testid=leave-detail]')?.dataset.status === 'rejected')
    assert.match(await text(page, '[data-testid=timeline-comment]'), /Not that week/)
    await visit(page, mock, `/leave/${ids.danPending}`, '[data-testid=decision-panel]')
    await page.fill('[data-testid=leave-comment]', 'Which dates are firm?')
    await page.click('[data-testid=leave-clarify]')
    assert.match(await text(page, '[data-testid=decision-confirm-box]'), /person can edit the request and send it again/)
    await page.click('[data-testid=decision-confirm]')
    await page.waitForFunction(() => document.querySelector('[data-testid=leave-detail]')?.dataset.status === 'clarification_requested')
    assert.deepEqual(mock.state.bodies.filter((b) => b.route.endsWith('/decision')).map((b) => [b.body.action, b.body.comment]), [['reject', 'Not that week'], ['clarify', 'Which dates are firm?']])
  }, { as: BEN }))

test('detail (approver): a comment containing only spaces does not enable reject; the server code comment_required is also mapped', opts, () =>
  withLeave(browser, async ({ page, mock, ids }) => {
    await visit(page, mock, `/leave/${ids.pending}`, '[data-testid=decision-panel]')
    await page.fill('[data-testid=leave-comment]', '    ')
    assert.ok(await page.isDisabled('[data-testid=leave-reject]'))
    await page.fill('[data-testid=leave-comment]', 'x')
    mock.state.force['POST /requests/:id/decision'] = { status: 422, body: { detail: 'A comment is required to reject or ask for clarification', code: 'comment_required' } }
    await page.click('[data-testid=leave-reject]')
    await page.click('[data-testid=decision-confirm]')
    await page.waitForSelector('[data-testid=decision-error]')
    assert.match(await text(page, '[data-testid=decision-error]'), /comment is required/)
    assert.equal(await page.getAttribute('[data-testid=leave-detail]', 'data-status'), 'pending')
  }, { as: BEN }))

test('detail (approver): a decision that lost the race (409) reloads and explains; a 403 is shown, not hidden', opts, () =>
  withLeave(browser, async ({ page, mock, ids }) => {
    await visit(page, mock, `/leave/${ids.pending}`, '[data-testid=decision-panel]')
    // another approver decided first
    const r = mock.state.requests.find((x) => x.request_id === ids.pending)
    r.status = 'approved'
    r.version = 2
    await page.click('[data-testid=leave-approve]')
    await page.click('[data-testid=decision-confirm]')
    await page.waitForSelector('[data-testid=conflict-banner]')
    assert.match(await text(page, '[data-testid=conflict-banner]'), /changed by someone else/)
    assert.equal(await page.getAttribute('[data-testid=leave-detail]', 'data-status'), 'approved')
    assert.equal(await count(page, '[data-testid=decision-panel]'), 0)
    // 403 (cannot decide)
    await visit(page, mock, `/leave/${ids.danPending}`, '[data-testid=decision-panel]')
    mock.state.force['POST /requests/:id/decision'] = { status: 403, body: { detail: 'You cannot decide this request' } }
    await page.click('[data-testid=leave-approve]')
    await page.click('[data-testid=decision-confirm]')
    await page.waitForSelector('[data-testid=decision-error]')
    assert.match(await text(page, '[data-testid=decision-error]'), /cannot decide this request/)
  }, { as: BEN }))

test('detail: HR can read any request but has no decision buttons while a manager can decide; HR is the fallback approver otherwise', opts, () =>
  withLeave(browser, async ({ page, mock, ids }) => {
    await visit(page, mock, `/leave/${ids.pending}`, '[data-testid=leave-detail]')
    assert.equal(await page.getAttribute('[data-testid=leave-detail]', 'data-mode'), 'readonly')
    assert.equal(await count(page, '[data-testid=decision-panel]'), 0)
    assert.match(await text(page, '[data-testid=no-actions]'), /No actions are available to you/)
    assert.match(await text(page, '[data-testid=leave-back]'), /Back to approvals/)
    // Ben has no manager that can decide: HR decides (the owner is Ben, not Anna)
    await visit(page, mock, `/leave/${ids.benPending}`, '[data-testid=leave-detail]')
    assert.equal(await page.getAttribute('[data-testid=leave-detail]', 'data-mode'), 'decider')
    assert.match(await text(page, '[data-testid=fact-approver]'), /Waiting for HR/)
    await page.click('[data-testid=leave-approve]')
    await page.click('[data-testid=decision-confirm]')
    await page.waitForFunction(() => document.querySelector('[data-testid=leave-detail]')?.dataset.status === 'approved')
    assert.match(await text(page, '[data-testid=timeline-item][data-kind=approve]'), /Anna Reyes \(HRAdmin\)/)
  }, { as: ANNA }))

test('detail: nobody decides their own request (HR owner with no other approver gets no buttons)', opts, () =>
  withLeave(browser, async ({ page, mock }) => {
    const mine = seedRequest(mock.state, { employee_id: EMP.anna, start_date: '2026-12-10', end_date: '2026-12-10' })
    await visit(page, mock, `/leave/${mine.request_id}`, '[data-testid=leave-detail]')
    assert.equal(await count(page, '[data-testid=decision-panel]'), 0)
    assert.equal(await count(page, '[data-testid=cancel-panel]'), 1, 'the owner can still cancel')
    assert.match(await text(page, '[data-testid=leave-back]'), /Back to leave/)
  }, { as: ANNA }))

// ------------------------------------------------------------------------------------------------ approvals tab
test('approvals (manager): "Waiting for my decision" first, team list second, employee names shown, filters on the team list only', opts, () =>
  withLeave(browser, async ({ page, mock, ids }) => {
    await visit(page, mock, '/leave', LEAVE_READY)
    assert.deepEqual(await TAB_TITLES(page), ['My leave', 'Approvals', 'Team calendar'])
    await page.click('[data-testid=leave-tab-approvals]')
    await page.waitForSelector('[data-testid=requests-panel][data-scope=review] [data-testid=leave-row]')
    const rows = await page.$$eval('[data-testid=leave-row]', (els) => els.map((e) => [e.dataset.id, e.dataset.status]))
    assert.deepEqual(rows.map((r) => r[1]), ['pending', 'pending'], 'only pending requests of direct reports, soonest first')
    assert.deepEqual(rows.map((r) => r[0]), [ids.pending, ids.danPending])
    assert.match(await page.locator('[data-testid=leave-row]').first().innerText(), /Carla Dizon/)
    assert.equal(await count(page, '[data-testid=leave-status-filter]'), 0, 'the review queue is always pending')
    assert.ok(mock.state.log.some((l) => /scope=review/.test(l)))
    await page.click('[data-testid=approvals-scope-team]')
    await page.waitForSelector('[data-testid=requests-panel][data-scope=team] [data-testid=leave-row]')
    assert.ok((await count(page, '[data-testid=leave-row]')) > 2)
    assert.equal(await count(page, '[data-testid=approvals-scope-all]'), 0, 'managers have no "all requests" list')
    await page.selectOption('[data-testid=leave-status-filter]', 'approved')
    await page.waitForFunction(() => [...document.querySelectorAll('[data-testid=leave-row]')].every((r) => r.dataset.status === 'approved'))
    await page.click('[data-testid=leave-row] [data-testid=leave-open]')
    await page.waitForSelector('[data-testid=leave-detail]')
    await page.click('[data-testid=leave-back]')
    await page.waitForSelector('[data-testid=tab-panel-approvals]')
    assert.equal(new URL(page.url()).searchParams.get('tab'), 'approvals')
  }, { as: BEN }))

test('approvals (HR): decision queue (fallback only), plus "All requests" read-only oversight; Leave settings tab is offered', opts, () =>
  withLeave(browser, async ({ page, mock, ids }) => {
    await visit(page, mock, '/leave?tab=approvals', '[data-testid=tab-panel-approvals]')
    assert.deepEqual(await TAB_TITLES(page), ['My leave', 'Approvals', 'Team calendar', 'Leave settings'])
    await page.waitForSelector('[data-testid=requests-panel][data-scope=review] [data-testid=leave-row]')
    const review = await page.$$eval('[data-testid=leave-row]', (els) => els.map((e) => e.dataset.id))
    assert.deepEqual(review, [ids.benPending], 'only the request HR must decide (Ben has no manager)')
    await page.click('[data-testid=approvals-scope-all]')
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=requests-panel][data-scope=all] [data-testid=leave-row]').length >= 8)
    assert.equal(await count(page, '[data-testid=approvals-scope-team]'), 0)
    assert.ok(mock.state.log.some((l) => /scope=all/.test(l)))
  }, { as: ANNA }))

test('approvals: a list the server refuses (403) is explained, not an empty list', opts, () =>
  withLeave(browser, async ({ page, mock }) => {
    mock.state.force['GET /requests'] = { status: 403, body: { detail: 'Not allowed' } }
    await visit(page, mock, '/leave?tab=approvals', '[data-testid=tab-panel-approvals]')
    await page.waitForSelector('[data-testid=leave-list-error]')
    assert.match(await text(page, '[data-testid=leave-list-error]'), /not available to you/)
  }, { as: BEN }))

test('approvals: empty queue is honest', opts, () =>
  withLeave(browser, async ({ page, mock }) => {
    await visit(page, mock, '/leave?tab=approvals', '[data-testid=requests-panel] [data-testid=empty-state]')
    assert.match(await text(page, '[data-testid=requests-panel] [data-testid=empty-state]'), /Nothing is waiting for your decision/)
  }, { as: BEN, seed: false }))

// ------------------------------------------------------------------------------------------------ misc
test('no horizontal overflow on the Leave screens at desktop width; Finance sees the employee tabs only', opts, () =>
  withLeave(browser, async ({ page, mock, ids }) => {
    for (const p of ['/leave', '/leave/new', `/leave/${ids.danPending}`, '/leave?tab=calendar']) {
      await visit(page, mock, p, '.app-content h1, .lv-detail-title')
      assert.ok(await noOverflow(page), p)
    }
    await visit(page, mock, '/leave', LEAVE_READY)
    assert.deepEqual(await TAB_TITLES(page), ['My leave', 'Team calendar'])
  }, { as: DAN }))

test('the Leave sidebar entry opens the real page, not a placeholder', opts, () =>
  withLeave(browser, async ({ page, mock }) => {
    await visit(page, mock, '/', '.app-content')
    await page.click('[data-nav-id=leave]')
    await page.waitForSelector('[data-testid=leave-page]')
    assert.equal(await count(page, '.empty-state-badge'), 0)
  }))

test('seed helper self-check: the basic seed covers every status', opts, async () => {
  const { createLeaveState } = await import('./mock-leave.mjs')
  const state = createLeaveState()
  seedBasic(state)
  assert.deepEqual([...new Set(state.requests.map((r) => r.status))].sort(), ['approved', 'cancelled', 'clarification_requested', 'pending', 'rejected'])
  assert.equal(until.length >= 1, true)
  assert.equal(typeof waitGone, 'function')
})
