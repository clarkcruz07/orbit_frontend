// Mock-API browser tests for Holidays admin (settings/holidays): add / edit / delete, duplicate 409, validation, year selector,
// empty states, the automatic AI fill-in (no button: the server does it). The mock plays the server (docs/api/holidays.md "the rule"). Gated: RUN_BROWSER_TESTS=1.
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { launchBrowser } from './browser-env.mjs'
import { U } from './peoplemgmt-mock.mjs'
import { callsTo, enabled, hasText, noOverflow, opts, text, withApp } from './peoplemgmt-helpers.mjs'

let browser
before(async () => {
  if (enabled) browser = await launchBrowser()
})
after(async () => {
  await browser?.close()
})
const app = (user, fn, o) => withApp(browser, user, fn, o)

async function addOneOff(page, name, date, { type = 'company' } = {}) {
  await page.click('[data-testid=add-holiday]')
  await page.waitForSelector('[data-testid=holiday-form]')
  await page.fill('[data-testid=holiday-name]', name)
  await page.selectOption('[data-testid=holiday-type]', type)
  await page.fill('[data-testid=holiday-date]', date)
  await page.click('[data-testid=save-holiday]')
}

test('holidays: an empty list says so honestly (no demo list); the usage note says leave is not recalculated', opts, () =>
  app(U.anna, async ({ page, mock, errors, go }) => {
    await go('/settings/holidays?year=2026', '[data-testid=holidays-empty-note]')
    assert.match(await text(page, '[data-testid=holidays-usage-note]'), /Calendar and leave day-counting both use this list/)
    assert.match(await text(page, '[data-testid=holidays-usage-note]'), /NOT recalculated/)
    assert.match(await text(page, '[data-testid=holidays-empty-note]'), /no day is treated as a holiday/)
    assert.equal(await page.locator('[data-testid=holidays-table]').count(), 0)
    assert.ok(await page.locator('[data-testid=add-first-holiday]').isVisible())
    assert.ok(await page.locator('[data-testid=add-holiday]').isVisible())
    assert.equal(await page.locator('[data-testid=suggest-holidays]').count(), 0, 'there is no manual "suggest" button: the server fills holidays in by itself')
    await page.selectOption('[data-testid=year-select]', '2027')
    await page.waitForFunction(() => document.querySelector('[data-testid=holidays-page]')?.getAttribute('data-year') === '2027')
    assert.equal(new URL(page.url()).searchParams.get('year'), '2027')
    assert.equal(mock.state.holidays.length, 0)
    assert.deepEqual(errors, [])
  }))

test('holidays: add a one-off and a yearly holiday, edit, deactivate, delete (after a confirmation); the empty note returns when none is left', opts, () =>
  app(U.anna, async ({ page, mock, errors, go }) => {
    await go('/settings/holidays?year=2026', '[data-testid=holidays-empty-note]')
    // One-off, public.
    await addOneOff(page, '  Founders   Day ', '2026-12-24', { type: 'public' })
    await hasText(page, '[data-testid=holiday-notice]', /Holiday added/)
    const post = callsTo(mock, 'POST', '/holidays')
    assert.deepEqual(post[0].body, { name: 'Founders Day', type: 'public', active: true, date: '2026-12-24' })
    await page.waitForSelector('[data-testid=holiday-row]')
    assert.equal(await page.locator('[data-testid=holidays-empty-note]').count(), 0, 'with a holiday on the list the empty note is gone')
    const row = page.locator('[data-testid=holiday-row]').first()
    assert.match(await row.innerText(), /Thu, 24 Dec 2026/)
    assert.match(await row.innerText(), /Founders Day/)
    assert.match(await row.innerText(), /Public holiday/)
    assert.match(await row.innerText(), /One date only/)
    assert.match(await row.innerText(), /Active/)
    // Yearly company holiday, 29 February.
    await page.click('[data-testid=add-holiday]')
    await page.fill('[data-testid=holiday-name]', 'Leap Day Lunch')
    await page.check('[data-testid=holiday-yearly]')
    await page.selectOption('[data-testid=holiday-month]', '2')
    assert.equal(await page.locator('[data-testid=holiday-day] option').count(), 29)
    await page.selectOption('[data-testid=holiday-day]', '29')
    await page.click('[data-testid=save-holiday]')
    await hasText(page, '[data-testid=holiday-notice]', /Holiday added/)
    assert.deepEqual(callsTo(mock, 'POST', '/holidays')[1].body, { name: 'Leap Day Lunch', type: 'company', active: true, month: 2, day: 29 })
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=holiday-row]').length === 2)
    const rows = await page.$$eval('[data-testid=holiday-row]', (els) => els.map((e) => e.textContent))
    assert.equal(rows.length, 2)
    assert.match(rows[0], /Sat, 28 Feb 2026.*Leap Day Lunch.*Every year \(29 Feb\)/, '29 February falls on the 28th in a non-leap year')
    // Edit: change the one-off to a yearly holiday (only the changed fields are sent).
    await page.locator('[data-testid=holiday-row]', { hasText: 'Founders Day' }).locator('[data-testid=edit-holiday]').click()
    await page.waitForSelector('[data-testid=holiday-form]')
    assert.equal(await page.inputValue('[data-testid=holiday-name]'), 'Founders Day')
    assert.equal(await page.isChecked('[data-testid=holiday-once]'), true)
    await page.check('[data-testid=holiday-yearly]')
    await page.selectOption('[data-testid=holiday-month]', '12')
    await page.selectOption('[data-testid=holiday-day]', '24')
    await page.click('[data-testid=save-holiday]')
    await hasText(page, '[data-testid=holiday-notice]', /Holiday saved/)
    const patch = callsTo(mock, 'PATCH', `/holidays/${mock.state.holidays[0].holiday_id}`)
    assert.deepEqual(patch[0].body, { month: 12, day: 24 })
    await hasText(page, '[data-testid=holidays-table]', /Every year \(24 Dec\)/)
    // Edit with nothing changed closes without a request.
    await page.locator('[data-testid=holiday-row]', { hasText: 'Founders Day' }).locator('[data-testid=edit-holiday]').click()
    await page.click('[data-testid=save-holiday]')
    await page.waitForFunction(() => !document.querySelector('[data-testid=holiday-form]'))
    assert.equal(callsTo(mock, 'PATCH', `/holidays/${mock.state.holidays[0].holiday_id}`).length, 1)
    // Deactivate (Active is a checkbox in the form).
    await page.locator('[data-testid=holiday-row]', { hasText: 'Leap Day Lunch' }).locator('[data-testid=edit-holiday]').click()
    await page.uncheck('[data-testid=holiday-active]')
    await page.click('[data-testid=save-holiday]')
    await hasText(page, '[data-testid=holiday-notice]', /Holiday saved/)
    await page.waitForSelector('[data-testid=holiday-row][data-active=false]')
    assert.equal(await page.locator('[data-testid=holiday-row][data-active=false]').count(), 1)
    assert.match(await text(page, '[data-testid=holiday-row][data-active=false]'), /Inactive/)
    // Delete: a confirmation first.
    await page.locator('[data-testid=holiday-row]', { hasText: 'Leap Day Lunch' }).locator('[data-testid=delete-holiday]').click()
    await page.waitForSelector('[data-testid=delete-dialog]')
    assert.match(await text(page, '[data-testid=delete-dialog]'), /Leave requests that already exist are not recalculated/)
    assert.match(await text(page, '[data-testid=delete-dialog]'), /untick Active/)
    await page.click('[data-testid=dialog-cancel]')
    assert.equal(mock.state.holidays.length, 2)
    await page.locator('[data-testid=holiday-row]', { hasText: 'Leap Day Lunch' }).locator('[data-testid=delete-holiday]').click()
    await page.click('[data-testid=delete-confirm]')
    await hasText(page, '[data-testid=holiday-notice]', /Leap Day Lunch was deleted/)
    assert.equal(mock.state.holidays.length, 1)
    await page.locator('[data-testid=holiday-row]', { hasText: 'Founders Day' }).locator('[data-testid=delete-holiday]').click()
    await page.click('[data-testid=delete-confirm]')
    // Nothing is left: the empty note is back.
    await page.waitForSelector('[data-testid=holidays-empty-note]')
    assert.equal(mock.state.holidays.length, 0)
    assert.deepEqual(errors, [])
  }))

test('holidays: a duplicate is a 409 with a clear message; validation happens before sending; a server 422 lands on its field', opts, () =>
  app(U.anna, async ({ page, mock, go }) => {
    await go('/settings/holidays?year=2026', '[data-testid=holidays-page]')
    await addOneOff(page, 'Founders Day', '2026-12-24')
    await page.waitForSelector('[data-testid=holiday-row]')
    await addOneOff(page, 'founders day', '2026-12-24')
    await page.waitForSelector('[data-testid=holiday-form-error]')
    assert.equal((await text(page, '[data-testid=holiday-form-error]')).trim(), 'A holiday with this name already exists on that day.')
    assert.equal(mock.state.holidays.length, 1)
    assert.ok(await page.locator('[data-testid=holiday-form]').isVisible(), 'the form stays open')
    // Same name on another day is fine.
    await page.fill('[data-testid=holiday-date]', '2026-12-26')
    await page.click('[data-testid=save-holiday]')
    await hasText(page, '[data-testid=holiday-notice]', /Holiday added/)
    assert.equal(mock.state.holidays.length, 2)
    // Validation first: nothing is sent.
    const posts = callsTo(mock, 'POST', '/holidays').length
    await page.click('[data-testid=add-holiday]')
    await page.fill('[data-testid=holiday-name]', '')
    await page.click('[data-testid=save-holiday]')
    assert.equal((await text(page, '[data-testid=field-holiday-name-error]')).trim(), 'Name is required')
    await page.fill('[data-testid=holiday-name]', '=SUM(A1)')
    await page.fill('[data-testid=holiday-date]', '2026-02-30')
    await page.click('[data-testid=save-holiday]')
    assert.match(await text(page, '[data-testid=field-holiday-name-error]'), /must not start with = \+ - or @/)
    assert.match(await text(page, '[data-testid=field-holiday-date-error]'), /real date/)
    assert.equal(callsTo(mock, 'POST', '/holidays').length, posts)
    // A server answer for a field the page could not foresee.
    mock.state.respondOnce['POST /holidays'] = { status: 422, body: { detail: 'name contains control characters', code: 'validation', field: 'name' } }
    await page.fill('[data-testid=holiday-name]', 'Fine Name')
    await page.fill('[data-testid=holiday-date]', '2026-12-30')
    await page.click('[data-testid=save-holiday]')
    await hasText(page, '[data-testid=field-holiday-name-error]', /control characters/)
    // A server failure: honest message, the typed values stay.
    mock.state.force['POST /holidays'] = 500
    await page.click('[data-testid=save-holiday]')
    await hasText(page, '[data-testid=holiday-form-error]', /Something went wrong on our side/)
    assert.equal(await page.inputValue('[data-testid=holiday-name]'), 'Fine Name')
  }))

test('holidays: the year selector (select and arrows), one-offs of other years are counted not listed, saving into another year jumps there', opts, () =>
  app(U.anna, async ({ page, mock, go }) => {
    mock.state.holidays.push({ holiday_id: 'h-a', name: 'Alpha Day', type: 'company', date: '2026-03-03', month: null, day: null, active: true })
    mock.state.holidays.push({ holiday_id: 'h-b', name: 'Beta Day', type: 'public', date: '2027-04-04', month: null, day: null, active: true })
    mock.state.holidays.push({ holiday_id: 'h-c', name: 'Gamma Yearly', type: 'company', date: null, month: 5, day: 5, active: true })
    await go('/settings/holidays?year=2026', '[data-testid=holiday-row]')
    assert.deepEqual(await page.$$eval('[data-testid=holiday-row] strong', (els) => els.map((e) => e.textContent)), ['Alpha Day', 'Gamma Yearly'])
    assert.match(await text(page, '[data-testid=holidays-count]'), /2 holidays in 2026/)
    assert.match(await text(page, '[data-testid=other-years]'), /1 one-off holiday falls in other years/)
    await page.click('[data-testid=year-next]')
    await hasText(page, '[data-testid=holidays-count]', /2 holidays in 2027/)
    assert.equal(new URL(page.url()).searchParams.get('year'), '2027')
    assert.deepEqual(await page.$$eval('[data-testid=holiday-row] strong', (els) => els.map((e) => e.textContent)), ['Beta Day', 'Gamma Yearly'])
    await page.click('[data-testid=year-prev]')
    await page.click('[data-testid=year-prev]')
    await hasText(page, '[data-testid=holidays-count]', /1 holiday in 2025/)
    // Add a one-off in 2031 while looking at 2025: the page jumps to that year and shows it.
    await addOneOff(page, 'Future Day', '2031-01-01')
    await hasText(page, '[data-testid=holiday-notice]', /It falls in 2031/)
    await page.waitForFunction(() => document.querySelector('[data-testid=holidays-page]')?.getAttribute('data-year') === '2031')
    assert.match(await text(page, '[data-testid=holidays-table]'), /Future Day/)
    // A bad ?year= falls back to the current year.
    await page.goto(`${mock.origin}/settings/holidays?year=1999`)
    await page.waitForSelector('[data-testid=holidays-page]')
    assert.equal(await page.getAttribute('[data-testid=holidays-page]', 'data-year'), String(new Date().getFullYear()))
  }))

test('holidays: an empty list means NO holidays - the first-holiday button opens the form', opts, () =>
  app(
    U.anna,
    async ({ page, mock, go }) => {
      await go('/settings/holidays?year=2026', '[data-testid=holidays-empty-note]')
      assert.match(await text(page, '[data-testid=holidays-empty-note]'), /no day is treated as a holiday/)
      assert.ok(await page.locator('[data-testid=add-first-holiday]').isVisible())
      await page.click('[data-testid=add-first-holiday]')
      await page.waitForSelector('[data-testid=holiday-form]')
      await page.click('[data-testid=cancel-holiday]')
      await page.waitForFunction(() => !document.querySelector('[data-testid=holiday-form]'))
      assert.equal(mock.state.holidays.length, 0)
    },
  ))

test('holidays: loading and a failed load with Try again; the back link goes to Settings', opts, () =>
  app(U.anna, async ({ page, mock, go }) => {
    mock.state.delay['GET /holidays'] = 500
    await page.goto(`${mock.origin}/settings/holidays?year=2026`)
    await page.waitForSelector('[data-testid=holidays-loading]')
    await page.waitForSelector('[data-testid=holidays-empty-note]')
    mock.state.force['GET /holidays'] = 500
    await page.selectOption('[data-testid=year-select]', '2027')
    await page.waitForSelector('[data-testid=holidays-error]')
    delete mock.state.force['GET /holidays']
    await page.click('[data-testid=holidays-error] button')
    await page.waitForSelector('[data-testid=holidays-empty-note]')
    assert.equal(await page.getAttribute('[data-testid=back-to-settings]', 'href'), '/settings?tab=catalogs')
    void go
  }))

test('holidays: on a phone the list becomes cards with Edit and Delete, and the form fits', opts, () =>
  app(
    U.anna,
    async ({ page, mock, go }) => {
      mock.state.holidays.push({ holiday_id: 'h-a', name: 'A very long holiday name that keeps going and going to test wrapping on narrow screens', type: 'company', date: '2026-03-03', month: null, day: null, active: true })
      await go('/settings/holidays?year=2026', '[data-testid=holiday-card]')
      assert.equal(await page.locator('[data-testid=holidays-table]').isVisible(), false)
      assert.ok(await noOverflow(page))
      await page.click('[data-testid=holiday-card] button:has-text("Edit")')
      await page.waitForSelector('[data-testid=holiday-form]')
      assert.ok(await noOverflow(page))
      await page.click('[data-testid=cancel-holiday]')
      await page.click('[data-testid=holiday-card] button:has-text("Delete")')
      await page.waitForSelector('[data-testid=delete-dialog]')
      assert.ok(await noOverflow(page))
    },
    { viewport: { width: 390, height: 800 } },
  ))

// ----------------------------------------------------------------------------- automatic AI fill-in (no button)
test('holidays: while the server fills a year in on its own the page says so, looks again by itself, then shows the AI-marked holidays with a check-the-dates note', opts, () =>
  app(U.anna, async ({ page, mock, errors, go }) => {
    mock.state.autosync = { mode: 'pending', pendingPolls: 1 }
    await go('/settings/holidays?year=2026', '[data-testid=holidays-pending-note]')
    assert.equal(await page.locator('[data-testid=holidays-empty-note]').count(), 0, 'no "no holidays" message while it is being fetched')
    assert.equal(await page.locator('[data-testid=add-first-holiday]').count(), 0)
    await page.waitForSelector('[data-testid=holidays-ai-note]', { timeout: 15000 })
    assert.match(await text(page, '[data-testid=holidays-ai-note]'), /filled in automatically by AI/)
    assert.match(await text(page, '[data-testid=holidays-ai-note]'), /official proclamations/)
    assert.equal(await page.locator('[data-testid=holidays-pending-note]').count(), 0)
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=holiday-row]').length === 4)
    assert.equal(await page.locator('[data-testid=holiday-row] .pm-pill:text-is("AI")').count(), 4, 'every automatically added holiday carries the AI badge')
    assert.equal(callsTo(mock, 'POST', '/holidays').length, 0, 'the browser never creates them: the server did')
    assert.deepEqual(errors, [])
  }))

test('holidays: a holiday HR already entered is not duplicated by the automatic fill-in, and editing an AI holiday removes its AI badge', opts, () =>
  app(U.anna, async ({ page, mock, errors, go }) => {
    mock.state.holidays.push({ holiday_id: 'h-x', name: 'Araw ng Kagitingan', type: 'public', date: '2026-04-09', month: null, day: null, active: true })
    mock.state.autosync = { mode: 'pending', pendingPolls: 0 }
    await go('/settings/holidays?year=2026', '[data-testid=holidays-ai-note]')
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=holiday-row]').length === 4)
    const kagitingan = page.locator('[data-testid=holiday-row]', { hasText: 'Araw ng Kagitingan' })
    assert.equal(await kagitingan.count(), 1, 'one row for that date')
    assert.equal(await kagitingan.locator('.pm-pill:text-is("AI")').count(), 0, 'the one HR typed is not marked AI')
    const christmas = page.locator('[data-testid=holiday-row]', { hasText: 'Christmas Day' })
    await christmas.locator('[data-testid=edit-holiday]').click()
    await page.fill('[data-testid=holiday-name]', 'Christmas Day (checked)')
    await page.click('[data-testid=save-holiday]')
    const edited = page.locator('[data-testid=holiday-row]', { hasText: 'Christmas Day (checked)' })
    await edited.waitFor()
    assert.equal(await edited.locator('.pm-pill:text-is("AI")').count(), 0, 'editing an AI holiday removes the AI badge')
    assert.deepEqual(errors, [])
  }))

test('holidays: when the server could not fetch the year, an empty list says so, and HR can still add by hand', opts, () =>
  app(U.anna, async ({ page, mock, go }) => {
    mock.state.autosync = { mode: 'failed', pendingPolls: 0 }
    await go('/settings/holidays?year=2026', '[data-testid=holidays-failed-note]')
    assert.match(await text(page, '[data-testid=holidays-failed-note]'), /could not be fetched automatically/)
    assert.ok(await page.locator('[data-testid=add-holiday]').isVisible())
    assert.equal(await page.locator('[data-testid=holidays-ai-note]').count(), 0)
  }))
