// Real-browser UI-state tests for Attendance & Timesheet against a self-contained MOCK API (timesheet-mock-api.mjs).
// The mock lets each test script exactly what "the server" says (state, errors, delays). The REAL backend is covered by
// e2e-timesheet.spec.mjs. Fictional people only. Gated: RUN_BROWSER_TESTS=1 (use `npm run test:browser`).
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { launchBrowser, signIn } from './browser-env.mjs'
import { EMAIL, startTimesheetMock } from './timesheet-mock-api.mjs'

const enabled = process.env.RUN_BROWSER_TESTS === '1'
const opts = { skip: enabled ? false : 'set RUN_BROWSER_TESTS=1 to run real-browser tests' }
let browser
before(async () => {
  if (enabled) browser = await launchBrowser()
})
after(async () => {
  await browser?.close()
})

const MON = '2026-11-16' // the mock's "today" is Mon 16 Nov 2026 (10:00 in Manila)
const text = (page, sel) => page.locator(sel).innerText()
const count = (page, sel) => page.locator(sel).count()
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)

/** Runs fn against a fresh mock + browser context, signed in as `as` (a key of EMAIL), at `path`. */
async function withApp(fn, { as = 'jamie', path = '/attendance', viewport = { width: 1448, height: 1000 }, setup, ready = '[data-testid=ts-tabs]' } = {}) {
  const mock = await startTimesheetMock()
  const ctx = await browser.newContext({ viewport })
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e)))
  try {
    setup?.(mock)
    await signIn(page, mock.origin, EMAIL[as])
    await page.waitForSelector('.app-content')
    if (path) {
      await page.goto(`${mock.origin}${path}`)
      if (ready) await page.waitForSelector(ready)
    }
    await fn({ page, mock, state: mock.state, origin: mock.origin })
    assert.deepEqual(pageErrors, [], 'no uncaught page errors')
  } finally {
    await ctx.close()
    await mock.close()
  }
}

const closed = (state, user, day, inUtc, outUtc, extra = {}) =>
  state.sessions.push({ session_id: `s-${state.seq++}`, user_id: user, day, clock_in: `${day}T${inUtc}:00.000+00:00`, clock_out: `${day}T${outUtc}:00.000+00:00`, status: 'closed', correction_id: null, ...extra })

async function openTab(page, tab) {
  await page.click(`[data-testid=tab-btn-${tab}]`)
  await page.waitForSelector(`[data-testid=tab-${tab === 'today' ? 'today' : tab}]`)
}

// ------------------------------------------------------------------------------------------------ page shell
test('the page offers an employee the right tabs', opts, () =>
  withApp(async ({ page }) => {
    assert.match(await text(page, 'h1'), /Attendance & Timesheet/)
    assert.deepEqual(await page.locator('[data-testid=ts-tabs] button').allInnerTexts(), ['Attendance', 'Timesheet', 'Corrections'])
    for (const t of ['timesheet', 'corrections', 'today']) {
      await openTab(page, t)
    }
  }))

test('tabs are URL-synced: ?tab= is honoured on load, tab clicks change it, Back works', opts, () =>
  withApp(async ({ page, origin }) => {
    await page.goto(`${origin}/attendance?tab=corrections`)
    await page.waitForSelector('[data-testid=tab-corrections]')
    assert.equal(await page.getAttribute('[data-testid=tab-btn-corrections]', 'aria-selected'), 'true')
    await page.click('[data-testid=tab-btn-timesheet]')
    await page.waitForSelector('[data-testid=tab-timesheet]')
    assert.match(page.url(), /tab=timesheet/)
    await page.click('[data-testid=tab-btn-today]')
    await page.waitForSelector('[data-testid=tab-today]')
    assert.ok(!page.url().includes('tab='), 'the default tab keeps the URL clean')
    await page.goBack()
    await page.waitForSelector('[data-testid=tab-timesheet]')
    await page.goto(`${origin}/attendance?tab=nonsense`)
    await page.waitForSelector('[data-testid=tab-today]')
  }))

test('config failure shows an honest error with a working retry; loading shows a skeleton first', opts, () =>
  withApp(
    async ({ page, state, origin }) => {
      state.force['GET /timesheet/config'] = { status: 500, body: { detail: 'boom' }, once: true }
      state.delay['GET /timesheet/config'] = 400
      await page.goto(`${origin}/attendance`)
      await page.waitForSelector('[data-testid=page-loading]')
      await page.waitForSelector('[data-testid=config-retry]')
      assert.match(await text(page, '.app-content'), /could not be loaded/i)
      assert.doesNotMatch(await text(page, '.app-content'), /boom/, 'raw server text is not shown')
      await page.click('[data-testid=config-retry]')
      await page.waitForSelector('[data-testid=ts-tabs]')
    },
    { path: null },
  ))

// ------------------------------------------------------------------------------------------------ clock
test('clock in and out: button states come from allowed_actions; the card shows time-in and time-out stamps, no running timer', opts, () =>
  withApp(async ({ page, state }) => {
    await page.waitForSelector('[data-testid=clock-card][data-state=out]')
    assert.equal(await count(page, '[data-testid=clock-out]'), 0)
    assert.match(await text(page, '[data-testid=clock-idle]'), /Nothing is stamped yet/)
    await page.click('[data-testid=clock-in]')
    await page.waitForSelector('[data-testid=clock-card][data-state=in]')
    assert.match(await text(page, '[data-testid=clock-done]'), /Clocked in at 10:00/)
    assert.equal(await count(page, '[data-testid=clock-in]'), 0)
    // A stamp of the time in, "Not yet" for the time out; nothing counts up.
    assert.match(await text(page, '[data-testid=stamp-in]'), /10:00/)
    assert.match(await text(page, '[data-testid=stamp-out]'), /Not yet/)
    assert.equal(await count(page, '[data-testid=clock-timer]'), 0)
    assert.equal(await page.locator('[role=timer]').count(), 0)
    // The server moves 2h05m on; the stamp does not change (it is a record, not a stopwatch).
    state.now = '2026-11-16T04:05:03.000+00:00'
    await page.reload()
    await page.waitForSelector('[data-testid=clock-stamps]')
    assert.match(await text(page, '[data-testid=stamp-in]'), /10:00/)
    // the day row shows the running session
    assert.match(await text(page, '[data-testid=day-row][data-today="1"]'), /running/)
    await page.click('[data-testid=clock-out]')
    await page.waitForSelector('[data-testid=clock-card][data-state=out]')
    assert.match(await text(page, '[data-testid=clock-done]'), /^Clocked out at 12:05\.$/)
    assert.match(await text(page, '[data-testid=stamp-in]'), /10:00/)
    assert.match(await text(page, '[data-testid=stamp-out]'), /12:05/)
    // the month view refreshed: 2.08 hours today
    await page.waitForFunction(() => /2\.08/.test(document.querySelector('[data-testid=day-row][data-today="1"] [data-testid=day-hours]')?.textContent ?? ''))
    assert.match(await text(page, '[data-testid=month-totals]'), /2\.08/)
  }))

test('clock errors map to plain words and the page refreshes itself', opts, () =>
  withApp(async ({ page, state }) => {
    state.force['POST /attendance/clock-in'] = { status: 409, body: { detail: 'x', code: 'already_clocked_in' }, once: true }
    await page.click('[data-testid=clock-in]')
    await page.waitForSelector('[data-testid=clock-error]')
    assert.match(await text(page, '[data-testid=clock-error]'), /already clocked in/i)
    state.force['POST /attendance/clock-in'] = { status: 403, body: { detail: 'Your account has no employee record' }, once: true }
    await page.click('[data-testid=clock-in]')
    await page.waitForFunction(() => /no employee record/.test(document.querySelector('[data-testid=clock-error]')?.textContent ?? ''))
    state.force['POST /attendance/clock-in'] = { status: 500, body: { detail: 'Traceback secret' }, once: true }
    await page.click('[data-testid=clock-in]')
    await page.waitForFunction(() => /server had a problem/.test(document.querySelector('[data-testid=clock-error]')?.textContent ?? ''))
    assert.doesNotMatch(await text(page, '[data-testid=clock-card]'), /Traceback/)
    // and it still works afterwards
    await page.click('[data-testid=clock-in]')
    await page.waitForSelector('[data-testid=clock-card][data-state=in]')
    assert.equal(await count(page, '[data-testid=clock-error]'), 0)
  }))

test('a double click on Clock in sends one request', opts, () =>
  withApp(async ({ page, state }) => {
    state.delay['POST /attendance/clock-in'] = 300
    await page.dblclick('[data-testid=clock-in]')
    await page.waitForSelector('[data-testid=clock-card][data-state=in]')
    assert.equal(state.log.filter((l) => l === 'POST /attendance/clock-in').length, 1)
  }))

test('flagged session: plain-words explanation, no clock buttons, a path to a prefilled, linked correction request', opts, () =>
  withApp(
    async ({ page, state }) => {
      await page.waitForSelector('[data-testid=clock-card][data-state=flagged]')
      const box = await text(page, '[data-testid=flagged-explainer]')
      assert.match(box, /never clocked out/)
      assert.match(box, /at most 16 hours/)
      assert.match(box, /original punch is kept/)
      assert.match(box, /Once the correction is approved you can clock in again/)
      assert.equal(await count(page, '[data-testid=clock-in]'), 0)
      assert.equal(await count(page, '[data-testid=clock-out]'), 0)
      assert.equal(await count(page, '[data-testid=clock-timer]'), 0)
      assert.match(await text(page, '[data-testid=month-totals]'), /1 day needs correction/)
      assert.match(await text(page, '[data-testid=flag-needs_correction]'), /Needs correction/)
      await page.click('[data-testid=flagged-request-correction]')
      await page.waitForSelector('[data-testid=correction-form]')
      assert.match(page.url(), /tab=corrections/)
      assert.equal(await page.inputValue('[data-testid=corr-day]'), '2026-11-14')
      assert.equal(await count(page, '[data-testid=correction-linked]'), 1)
      await page.fill('[data-testid=corr-in]', '09:00')
      await page.fill('[data-testid=corr-out]', '17:00')
      await page.fill('[data-testid=corr-reason]', 'Forgot to clock out on Saturday')
      await page.click('[data-testid=corr-submit]')
      await page.waitForSelector('[data-testid=correction-detail]')
      assert.equal(state.corrections.length, 1)
      assert.equal(state.corrections[0].session_id, state.sessions[0].session_id, 'the open punch is linked')
      assert.equal(state.corrections[0].day, '2026-11-14')
      assert.match(await text(page, '[data-testid=correction-status]'), /Pending review/)
    },
    {
      setup: (mock) => {
        // Clocked in Sat 14 Nov 09:00 Manila and never out; it is now Mon 10:00 = 49 hours later.
        mock.state.sessions.push({ session_id: '5f1a2b3c-0000-4000-8000-000000000001', user_id: 'u-jamie', day: '2026-11-14', clock_in: '2026-11-14T01:00:00.000+00:00', clock_out: null, status: 'open', correction_id: null })
      },
    },
  ))

// ------------------------------------------------------------------------------------------------ month view
const monthSetup = (mock) => {
  const s = mock.state
  closed(s, 'u-jamie', '2026-11-12', '01:00', '09:30') // Thu 12: 09:00-17:30 = 8.5 h
  closed(s, 'u-jamie', '2026-11-13', '01:02', '08:59') // Fri 13
  s.attendance['u-jamie'] = {
    '2026-11-11': {
      sessions: [],
      effective: { source: 'correction', first_in: '2026-11-11T01:00:00.000+00:00', last_out: '2026-11-11T09:00:00.000+00:00', hours: 8 },
      correction: { correction_id: 'c-old', status: 'approved', clock_in: '2026-11-11T01:00:00.000+00:00', clock_out: '2026-11-11T09:00:00.000+00:00', hours: 8, decided_at: '2026-11-12T03:00:00.000+00:00' },
    },
    '2026-11-10': {
      can_request_correction: false,
      pending_correction: { correction_id: 'c-pend', status: 'pending', clock_in: '2026-11-10T01:00:00.000+00:00', clock_out: '2026-11-10T09:00:00.000+00:00', hours: 8, decided_at: null },
    },
  }
}

test('month view: totals, effective hours, original punches kept visible, flags, and correction links only where allowed', opts, () =>
  withApp(
    async ({ page }) => {
      await page.waitForSelector('[data-testid=month-view]')
      assert.match(await text(page, '[data-testid=month-label]'), /November 2026/)
      assert.match(await text(page, '[data-testid=month-totals]'), /24\.4[0-9]? hours|24\.\d+ hours/)
      assert.match(await text(page, '[data-testid=month-totals]'), /3 days worked/)
      const row12 = '[data-testid=day-row][data-date="2026-11-12"]'
      assert.match(await text(page, row12), /09:00/)
      assert.match(await text(page, row12), /17:30/)
      assert.equal((await text(page, `${row12} [data-testid=day-hours]`)).trim(), '8.5')
      const row11 = '[data-testid=day-row][data-date="2026-11-11"]'
      assert.match(await text(page, `${row11} [data-testid=flag-corrected]`), /Corrected/)
      assert.match(await text(page, row11), /Original punches: none/)
      const row10 = '[data-testid=day-row][data-date="2026-11-10"]'
      assert.match(await text(page, `${row10} [data-testid=flag-pending]`), /Correction pending/)
      assert.equal(await count(page, `${row10} [data-testid=request-correction-link]`), 0, 'no second request while one is pending')
      assert.equal(await count(page, `${row12} [data-testid=request-correction-link]`), 1)
      assert.equal(await count(page, '[data-testid=day-row][data-today="1"] [data-testid=request-correction-link]'), 0, 'today cannot be corrected')
      assert.equal(await count(page, '[data-testid=day-row][data-date="2026-11-20"] [data-testid=request-correction-link]'), 0, 'future days cannot')
      // the link opens the form prefilled with that day
      await page.click(`${row12} [data-testid=request-correction-link]`)
      await page.waitForSelector('[data-testid=correction-form]')
      assert.equal(await page.inputValue('[data-testid=corr-day]'), '2026-11-12')
    },
    { setup: monthSetup },
  ))

test('month navigation: previous/next, back to this month, next disabled on the current month, 24-month limit', opts, () =>
  withApp(async ({ page, state }) => {
    await page.waitForSelector('[data-testid=month-view]')
    assert.equal(await page.isDisabled('[data-testid=month-next]'), true)
    await page.click('[data-testid=month-prev]')
    await page.waitForFunction(() => /October 2026/.test(document.querySelector('[data-testid=month-label]').textContent))
    assert.match(page.url(), /month=2026-10/)
    assert.equal(await page.isDisabled('[data-testid=month-next]'), false)
    await page.click('[data-testid=month-current]')
    await page.waitForFunction(() => /November 2026/.test(document.querySelector('[data-testid=month-label]').textContent))
    assert.ok(!page.url().includes('month='))
    // 24 months back is the last allowed month
    await page.goto(`${page.url().split('?')[0]}?month=2024-11`)
    await page.waitForSelector('[data-testid=month-view]')
    assert.equal(await page.isDisabled('[data-testid=month-prev]'), true)
    // a future month in the URL is ignored
    await page.goto(`${page.url().split('?')[0]}?month=2027-05`)
    await page.waitForSelector('[data-testid=month-view]')
    assert.match(await text(page, '[data-testid=month-label]'), /November 2026/)
    assert.ok(!state.log.some((l) => l.includes('month=2027-05')))
  }))

test('month view errors and loading are honest, with a retry', opts, () =>
  withApp(async ({ page, state, origin }) => {
    state.force['GET /attendance/me'] = { status: 500, body: { detail: 'x' }, once: true }
    state.delay['GET /attendance/me'] = 300
    await page.goto(`${origin}/attendance`)
    await page.waitForSelector('[data-testid=month-loading]')
    await page.waitForSelector('[data-testid=ts-error]')
    assert.match(await text(page, '[data-testid=ts-error]'), /server had a problem/)
    await page.click('[data-testid=ts-error] button')
    await page.waitForSelector('[data-testid=month-view]')
  }))

// ------------------------------------------------------------------------------------------------ corrections
test('correction form: early validation mirrors the server, a valid request is sent and appears in the list', opts, () =>
  withApp(
    async ({ page, state }) => {
      await openTab(page, 'corrections')
      assert.equal(await count(page, '[data-testid=empty-state]'), 1)
      assert.match(await text(page, '[data-testid=empty-state]'), /No correction requests yet/)
      await page.click('[data-testid=open-correction-form]')
      await page.waitForSelector('[data-testid=correction-form]')
      await page.click('[data-testid=corr-submit]')
      assert.match(await text(page, '[data-testid=corr-day-error]'), /Pick the day/)
      assert.match(await text(page, '[data-testid=corr-reason-error]'), /Say why/)
      assert.equal(state.corrections.length, 0, 'nothing was sent')
      await page.fill('[data-testid=corr-day]', '2026-11-16') // today
      await page.fill('[data-testid=corr-in]', '17:00')
      await page.fill('[data-testid=corr-out]', '09:00')
      await page.fill('[data-testid=corr-reason]', 'x')
      await page.click('[data-testid=corr-submit]')
      assert.match(await text(page, '[data-testid=corr-day-error]'), /past/)
      assert.match(await text(page, '[data-testid=corr-out-error]'), /after the clock-in/)
      // next day fixes the order
      await page.fill('[data-testid=corr-day]', '2026-11-12')
      await page.fill('[data-testid=corr-in]', '22:00')
      await page.fill('[data-testid=corr-out]', '06:00')
      await page.check('[data-testid=corr-next-day]')
      assert.match(await text(page, '[data-testid=corr-length]'), /8h/)
      await page.fill('[data-testid=corr-reason]', 'Night shift, forgot to clock out')
      await page.click('[data-testid=corr-submit]')
      await page.waitForSelector('[data-testid=correction-detail]')
      assert.deepEqual(
        [state.corrections[0].local_clock_in, state.corrections[0].local_clock_out, state.corrections[0].clock_out_next_day, state.corrections[0].reason],
        ['22:00', '06:00', true, 'Night shift, forgot to clock out'],
      )
      assert.match(await text(page, '[data-testid=correction-times]'), /22:00 - 06:00 \(next day\)/)
      await page.click('[data-testid=correction-close]')
      await page.waitForSelector('[data-testid=corr-row]')
      assert.match(await text(page, '[data-testid=corr-row]'), /Thu 12 Nov/)
      assert.match(await text(page, '[data-testid=corr-row]'), /Pending review/)
    },
    { path: '/attendance?tab=corrections' },
  ))

test('correction form: server-side refusals land next to the field or as a general message', opts, () =>
  withApp(
    async ({ page, state }) => {
      const fill = async (day) => {
        await page.fill('[data-testid=corr-day]', day)
        await page.fill('[data-testid=corr-in]', '09:00')
        await page.fill('[data-testid=corr-out]', '17:00')
        await page.fill('[data-testid=corr-reason]', 'Forgot')
      }
      await page.click('[data-testid=open-correction-form]')
      await fill('2026-11-12')
      state.force['POST /attendance/corrections'] = { status: 422, body: { detail: 'x', code: 'day_too_old' }, once: true }
      await page.click('[data-testid=corr-submit]')
      await page.waitForSelector('[data-testid=corr-day-error]')
      assert.match(await text(page, '[data-testid=corr-day-error]'), /last 60 days/)
      state.force['POST /attendance/corrections'] = { status: 409, body: { detail: 'x', code: 'correction_pending' }, once: true }
      await page.click('[data-testid=corr-submit]')
      await page.waitForSelector('[data-testid=corr-error]')
      assert.match(await text(page, '[data-testid=corr-error]'), /already have a correction waiting/)
      assert.equal(await count(page, '[data-testid=correction-detail]'), 0)
      // the typed values were kept
      assert.equal(await page.inputValue('[data-testid=corr-reason]'), 'Forgot')
    },
    { path: '/attendance?tab=corrections' },
  ))

test('a pending correction can be withdrawn after an inline confirmation; decided ones cannot', opts, () =>
  withApp(
    async ({ page, state }) => {
      await page.waitForSelector('[data-testid=corr-row]')
      assert.equal(await count(page, '[data-testid=corr-row]'), 2)
      await page.click('[data-testid=corr-row][data-status=pending] [data-testid=corr-open]')
      await page.waitForSelector('[data-testid=correction-detail][data-status=pending]')
      assert.equal(await count(page, '[data-testid=decision-panel]'), 0, 'the owner never sees decision buttons')
      await page.click('[data-testid=withdraw]')
      await page.waitForSelector('[data-testid=withdraw-confirm-box]')
      assert.equal(state.corrections.find((c) => c.status === 'cancelled'), undefined, 'asking is not doing')
      await page.click('[data-testid=withdraw-confirm]')
      await page.waitForSelector('[data-testid=correction-detail][data-status=cancelled]')
      assert.match(await text(page, '[data-testid=correction-status]'), /Withdrawn/)
      assert.equal(await count(page, '[data-testid=withdraw]'), 0)
      // the rejected one shows its reason and has no withdraw
      await page.click('[data-testid=correction-close]')
      await page.click('[data-testid=corr-row][data-status=rejected] [data-testid=corr-open]')
      await page.waitForSelector('[data-testid=correction-detail][data-status=rejected]')
      assert.match(await text(page, '[data-testid=correction-decision]'), /Rejected by Miguel Santos/)
      assert.match(await text(page, '[data-testid=correction-decision]'), /Times do not match the door log/)
      assert.equal(await count(page, '[data-testid=withdraw]'), 0)
      // list filter
      await page.click('[data-testid=correction-close]')
      await page.selectOption('[data-testid=corr-filter]', 'rejected')
      await page.waitForFunction(() => document.querySelectorAll('[data-testid=corr-row]').length === 1)
      assert.match(page.url(), /status=rejected/)
    },
    {
      path: '/attendance?tab=corrections',
      setup: ({ state }) => {
        const base = { employee: { employee_id: 'EMP-0005', name: 'Jamie Dela Cruz' }, clock_in: '', clock_out: '', local_clock_in: '09:00', local_clock_out: '17:00', clock_out_next_day: false, hours: 8, timezone: 'Asia/Manila', session_id: null, version: 1, decided_at: null, decision: null }
        state.corrections.push(
          { ...base, correction_id: 'c-9001', day: '2026-11-10', reason: 'Forgot', status: 'pending', submitted_at: '2026-11-11T01:00:00.000+00:00' },
          { ...base, correction_id: 'c-9002', day: '2026-11-05', reason: 'Wrong day', status: 'rejected', submitted_at: '2026-11-06T01:00:00.000+00:00', decided_at: '2026-11-07T01:00:00.000+00:00', decision: { action: 'reject', by: { name: 'Miguel Santos' }, at: '2026-11-07T01:00:00.000+00:00', comment: 'Times do not match the door log', approver_kind: 'manager' } },
        )
      },
    },
  ))

test('a correction link for someone else (or an unknown id) is "not available", not a crash', opts, () =>
  withApp(
    async ({ page }) => {
      await page.waitForSelector('[data-testid=ts-not-available]')
      assert.match(await text(page, '[data-testid=ts-not-available]'), /not available/i)
      assert.equal(await count(page, '[data-testid=decision-panel]'), 0)
    },
    { path: '/attendance?tab=corrections&id=c-does-not-exist', ready: '[data-testid=tab-corrections]' },
  ))

// ------------------------------------------------------------------------------------------------ timesheet grid
const ts = (page, code, day) => `[data-testid=cell-${code}-${day}]`
async function addCode(page, id) {
  await page.selectOption('[data-testid=add-code]', id)
  await page.waitForSelector(`[data-testid=grid-row][data-code=${id}]`)
}

test('weekly grid: add codes, type quarter hours, live totals, save (PATCH body), submit, recall', opts, () =>
  withApp(
    async ({ page, state }) => {
      await page.waitForSelector('[data-testid=sheet][data-status=open]')
      assert.match(await text(page, '[data-testid=grid-empty]'), /No rows yet/)
      assert.equal(await page.isDisabled('[data-testid=sheet-save]'), true, 'nothing to save yet')
      await addCode(page, 'TC-GENERAL')
      await addCode(page, 'TC-PROJECT')
      assert.equal(await count(page, '[data-testid=add-code] option[value=TC-GENERAL]'), 0, 'a code can only be on the sheet once')
      await page.fill(ts(page, 'TC-GENERAL', MON), '8')
      await page.fill(ts(page, 'TC-GENERAL', '2026-11-17'), '7,5')
      await page.fill(ts(page, 'TC-PROJECT', '2026-11-17'), '0.25')
      assert.equal(await text(page, '[data-testid=day-total-2026-11-16]'), '8')
      assert.equal(await text(page, '[data-testid=day-total-2026-11-17]'), '7.75')
      assert.equal(await text(page, '[data-testid=row-total-TC-GENERAL]'), '15.5')
      assert.equal(await text(page, '[data-testid=week-total]'), '15.75')
      assert.match(await text(page, '[data-testid=sheet-total]'), /15\.75/)
      assert.match(await text(page, '[data-testid=unsaved-note]'), /Unsaved/)
      await page.click('[data-testid=sheet-save]')
      await page.waitForFunction(() => /Saved/.test(document.querySelector('[data-testid=sheet-message]')?.textContent ?? ''))
      const saved = state.sheets[`EMP-0005_${MON}`]
      assert.equal(saved.version, 1)
      assert.deepEqual(saved.rows, [
        { code_id: 'TC-GENERAL', hours: { '2026-11-16': 8, '2026-11-17': 7.5 } },
        { code_id: 'TC-PROJECT', hours: { '2026-11-17': 0.25 } },
      ])
      assert.equal(await count(page, '[data-testid=unsaved-note]'), 0)
      assert.equal(await page.isDisabled('[data-testid=sheet-save]'), true)
      await page.click('[data-testid=sheet-submit]')
      await page.waitForSelector('[data-testid=sheet][data-status=submitted]')
      assert.match(await text(page, '[data-testid=status-submitted]'), /Waiting for Miguel Santos/)
      assert.equal(await page.locator('input[data-testid^=cell-]').count(), 0, 'submitted sheets are read-only')
      assert.equal(await count(page, '[data-testid=sheet-submit]'), 0)
      assert.equal(await count(page, '[data-testid=add-code]'), 0)
      await page.click('[data-testid=sheet-recall]')
      await page.waitForSelector('[data-testid=sheet][data-status=open]')
      assert.equal(await page.locator('input[data-testid^=cell-]').count(), 14)
      assert.equal(await text(page, '[data-testid=week-total]'), '15.75')
    },
    { path: '/attendance?tab=timesheet' },
  ))

test('Submit saves unsaved edits first, then submits (one click, two calls in order)', opts, () =>
  withApp(
    async ({ page, state }) => {
      await page.waitForSelector('[data-testid=sheet]')
      await addCode(page, 'TC-ADMIN')
      await page.fill(ts(page, 'TC-ADMIN', MON), '4')
      await page.click('[data-testid=sheet-submit]')
      await page.waitForSelector('[data-testid=sheet][data-status=submitted]')
      const calls = state.log.filter((l) => /\/timesheet\/sheets\//.test(l))
      assert.deepEqual(calls, [`PATCH /timesheet/sheets/EMP-0005_${MON}`, `POST /timesheet/sheets/EMP-0005_${MON}/submit`])
    },
    { path: '/attendance?tab=timesheet' },
  ))

test('cell validation mirrors the server: step, range, text and a 24 h day block Save and Submit and say why', opts, () =>
  withApp(
    async ({ page, state }) => {
      await page.waitForSelector('[data-testid=sheet]')
      await addCode(page, 'TC-GENERAL')
      await addCode(page, 'TC-PROJECT')
      const cell = ts(page, 'TC-GENERAL', MON)
      await page.fill(cell, '7.3')
      assert.match(await text(page, '[data-testid=grid-issues]'), /quarter-hour/)
      assert.equal(await page.getAttribute(cell, 'aria-invalid'), 'true')
      assert.equal(await page.isDisabled('[data-testid=sheet-save]'), true)
      assert.equal(await page.isDisabled('[data-testid=sheet-submit]'), true)
      await page.fill(cell, '25')
      assert.match(await text(page, '[data-testid=grid-issues]'), /between 0 and 24/)
      await page.fill(cell, 'abc')
      assert.match(await text(page, '[data-testid=grid-issues]'), /as a number/)
      await page.fill(cell, '16')
      await page.fill(ts(page, 'TC-PROJECT', MON), '8.25')
      assert.match(await text(page, '[data-testid=grid-issues]'), /Mon 16 Nov adds up to 24\.25 hours/)
      assert.equal(await page.isDisabled('[data-testid=sheet-submit]'), true)
      await page.fill(ts(page, 'TC-PROJECT', MON), '8')
      assert.equal(await count(page, '[data-testid=grid-issues]'), 0, 'exactly 24 hours is allowed')
      assert.equal(await page.isDisabled('[data-testid=sheet-save]'), false)
      assert.equal(state.log.filter((l) => l.startsWith('PATCH')).length, 0, 'nothing was sent while invalid')
    },
    { path: '/attendance?tab=timesheet' },
  ))

test('submit with no hours is refused locally; removing a row and the row limit', opts, () =>
  withApp(
    async ({ page, state }) => {
      await page.waitForSelector('[data-testid=sheet]')
      await addCode(page, 'TC-GENERAL')
      await page.click('[data-testid=sheet-submit]')
      assert.match(await text(page, '[data-testid=sheet-error]'), /Add some hours before submitting/)
      assert.equal(state.log.filter((l) => /submit$/.test(l)).length, 0)
      await page.click('[data-testid=remove-TC-GENERAL]')
      assert.equal(await count(page, '[data-testid=grid-row]'), 0)
      // fill the sheet up to the 20-row limit with extra codes
      for (let i = 0; i < 17; i++) state.codes.push({ code_id: `TC-X${i}`, name: `Extra ${String(i).padStart(2, '0')}`, billable: false, active: true, version: 1, placeholder: true })
      await page.reload()
      await page.waitForSelector('[data-testid=sheet]')
      for (const id of ['TC-ADMIN', 'TC-GENERAL', 'TC-PROJECT', 'TC-TRAINING', ...Array.from({ length: 16 }, (_, i) => `TC-X${i}`)]) await addCode(page, id)
      assert.equal(await count(page, '[data-testid=grid-row]'), 20)
      assert.equal(await page.isDisabled('[data-testid=add-code]'), true)
      assert.match(await text(page, '[data-testid=add-code]'), /Row limit reached/)
    },
    { path: '/attendance?tab=timesheet' },
  ))

test('server refusals on save are shown in words; a stale version reloads the latest and says edits were discarded', opts, () =>
  withApp(
    async ({ page, state }) => {
      await page.waitForSelector('[data-testid=sheet]')
      await addCode(page, 'TC-GENERAL')
      await page.fill(ts(page, 'TC-GENERAL', MON), '8')
      state.force['PATCH /timesheet/sheets/:id'] = { status: 422, body: { detail: 'x', code: 'code_invalid' }, once: true }
      await page.click('[data-testid=sheet-save]')
      await page.waitForSelector('[data-testid=sheet-error]')
      assert.match(await text(page, '[data-testid=sheet-error]'), /unknown or no longer active/)
      assert.equal(await page.inputValue(ts(page, 'TC-GENERAL', MON)), '8', 'edits are kept after a refusal')
      await page.click('[data-testid=sheet-save]') // a retry works
      await page.waitForFunction(() => /Saved/.test(document.querySelector('[data-testid=sheet-message]')?.textContent ?? ''))
      // someone else changed it meanwhile (the version moves on)
      state.sheets[`EMP-0005_${MON}`] = { status: 'open', rows: [{ code_id: 'TC-ADMIN', hours: { '2026-11-18': 3 } }], version: 7, decisions: [], submitted_at: null }
      await page.fill(ts(page, 'TC-GENERAL', '2026-11-17'), '2')
      await page.click('[data-testid=sheet-save]')
      await page.waitForFunction(() => /changed elsewhere/.test(document.querySelector('[data-testid=sheet-error]')?.textContent ?? ''))
      await page.waitForSelector('[data-testid=grid-row][data-code=TC-ADMIN]')
      assert.equal(await count(page, '[data-testid=grid-row][data-code=TC-GENERAL]'), 0, 'the latest version replaced the discarded edits')
      assert.equal(await page.inputValue(ts(page, 'TC-ADMIN', '2026-11-18')), '3')
    },
    { path: '/attendance?tab=timesheet' },
  ))

const rejectedSetup = ({ state }) => {
  state.sheets[`EMP-0005_${MON}`] = {
    status: 'rejected',
    version: 4,
    submitted_at: '2026-11-15T01:00:00.000+00:00',
    rows: [{ code_id: 'TC-GENERAL', hours: { '2026-11-16': 8, '2026-11-17': 8 } }],
    decisions: [{ decision_id: 'd-1', action: 'reject', by: { name: 'Miguel Santos' }, at: '2026-11-15T03:00:00.000+00:00', comment: 'Tuesday was a public holiday', approver_kind: 'manager', submission_no: 1 }],
  }
}

test('rejected sheet: the reason is shown, the grid is editable, resubmitting works and the history keeps the first decision', opts, () =>
  withApp(
    async ({ page, state }) => {
      await page.waitForSelector('[data-testid=sheet][data-status=rejected]')
      assert.match(await text(page, '[data-testid=status-rejected]'), /Rejected by Miguel Santos/)
      assert.match(await text(page, '[data-testid=rejection-comment]'), /Tuesday was a public holiday/)
      assert.match(await text(page, '[data-testid=status-rejected]'), /submit again/i)
      assert.equal(await page.inputValue(ts(page, 'TC-GENERAL', '2026-11-17')), '8')
      await page.fill(ts(page, 'TC-GENERAL', '2026-11-17'), '0')
      assert.match(await text(page, '[data-testid=sheet-submit]'), /Submit again/)
      await page.click('[data-testid=sheet-submit]')
      await page.waitForSelector('[data-testid=sheet][data-status=submitted]')
      assert.equal(state.sheets[`EMP-0005_${MON}`].decisions.length, 1, 'history is kept')
      await page.click('[data-testid=sheet-history] summary')
      assert.match(await text(page, '[data-testid=history-item]'), /Rejected by Miguel Santos/)
      assert.match(await text(page, '[data-testid=history-item]'), /Tuesday was a public holiday/)
    },
    { path: '/attendance?tab=timesheet', setup: rejectedSetup },
  ))

test('approved sheet is read-only with the no-pay-effect line; future weeks can be saved but not submitted', opts, () =>
  withApp(
    async ({ page, state }) => {
      await page.waitForSelector('[data-testid=sheet][data-status=approved]')
      assert.match(await text(page, '[data-testid=status-approved]'), /Approved by Miguel Santos/)
      assert.match(await text(page, '[data-testid=status-approved]'), /no effect on pay/)
      assert.equal(await page.locator('input[data-testid^=cell-]').count(), 0)
      assert.equal(await count(page, '[data-testid=sheet-save]'), 0)
      assert.equal(await count(page, '[data-testid=sheet-recall]'), 0)
      assert.equal(await count(page, '[data-testid=decision-panel]'), 0)
      // next week
      await page.click('[data-testid=week-next]')
      await page.waitForSelector('[data-testid=sheet][data-week="2026-11-23"]')
      assert.match(await text(page, '[data-testid=future-week-hint]'), /has not started/)
      assert.equal(await count(page, '[data-testid=sheet-submit]'), 0)
      await addCode(page, 'TC-TRAINING')
      await page.fill(ts(page, 'TC-TRAINING', '2026-11-24'), '4')
      await page.click('[data-testid=sheet-save]')
      await page.waitForFunction(() => /Saved/.test(document.querySelector('[data-testid=sheet-message]')?.textContent ?? ''))
      assert.equal(state.sheets['EMP-0005_2026-11-23'].version, 1)
    },
    {
      path: '/attendance?tab=timesheet',
      setup: ({ state }) => {
        state.sheets[`EMP-0005_${MON}`] = { status: 'approved', version: 5, submitted_at: '2026-11-15T01:00:00.000+00:00', rows: [{ code_id: 'TC-GENERAL', hours: { '2026-11-16': 8 } }], decisions: [{ decision_id: 'd-1', action: 'approve', by: { name: 'Miguel Santos' }, at: '2026-11-15T03:00:00.000+00:00', comment: null, approver_kind: 'manager', submission_no: 1 }] }
      },
    },
  ))

test('week navigation: prev/next/current, URL week param, limits (53 back, 4 ahead), and a discard confirmation for unsaved hours', opts, () =>
  withApp(
    async ({ page }) => {
      await page.waitForSelector('[data-testid=sheet]')
      assert.match(await text(page, '[data-testid=week-label]'), /16 - 22 Nov 2026/)
      assert.equal(await count(page, '[data-testid=week-current]'), 0)
      await page.click('[data-testid=week-prev]')
      await page.waitForSelector('[data-testid=sheet][data-week="2026-11-09"]')
      assert.match(page.url(), /week=2026-11-09/)
      assert.match(await text(page, '[data-testid=week-label]'), /9 - 15 Nov 2026/)
      await page.click('[data-testid=week-current]')
      await page.waitForSelector('[data-testid=sheet][data-week="2026-11-16"]')
      assert.ok(!page.url().includes('week='))
      // unsaved hours: navigation asks first
      await addCode(page, 'TC-GENERAL')
      await page.fill(ts(page, 'TC-GENERAL', MON), '8')
      await page.click('[data-testid=week-next]')
      await page.waitForSelector('[data-testid=discard-confirm-box]')
      assert.match(await text(page, '[data-testid=week-label]'), /16 - 22 Nov 2026/, 'still on the same week')
      await page.click('[data-testid=discard-stay]')
      assert.equal(await count(page, '[data-testid=discard-confirm-box]'), 0)
      assert.equal(await page.inputValue(ts(page, 'TC-GENERAL', MON)), '8')
      await page.click('[data-testid=week-next]')
      await page.click('[data-testid=discard-confirm]')
      await page.waitForSelector('[data-testid=sheet][data-week="2026-11-23"]')
      // upper limit: 4 weeks ahead
      await page.goto(page.url().split('?')[0] + '?tab=timesheet&week=2026-12-14')
      await page.waitForSelector('[data-testid=sheet][data-week="2026-12-14"]')
      assert.equal(await page.isDisabled('[data-testid=week-next]'), true)
      // beyond the readable range: the server's 422 is shown, the nav still works
      await page.goto(page.url().split('?')[0] + '?tab=timesheet&week=2024-01-01')
      await page.waitForSelector('[data-testid=ts-error]')
      assert.match(await text(page, '[data-testid=ts-error]'), /outside the range/)
      assert.equal(await page.isDisabled('[data-testid=week-prev]'), true)
      await page.click('[data-testid=week-current]')
      await page.waitForSelector('[data-testid=sheet]')
    },
    { path: '/attendance?tab=timesheet' },
  ))

// ------------------------------------------------------------------------------------------------ approvals
const submittedSetup = ({ state }) => {
  state.sheets[`EMP-0005_${MON}`] = { status: 'submitted', version: 2, submitted_at: '2026-11-16T01:00:00.000+00:00', rows: [{ code_id: 'TC-GENERAL', hours: { '2026-11-16': 8, '2026-11-17': 8 } }, { code_id: 'TC-PROJECT', hours: { '2026-11-18': 6.5 } }], decisions: [] }
  const base = { employee: { employee_id: 'EMP-0005', name: 'Jamie Dela Cruz' }, clock_in: '', clock_out: '', local_clock_in: '09:00', local_clock_out: '17:30', clock_out_next_day: false, hours: 8.5, timezone: 'Asia/Manila', session_id: null, version: 1, decided_at: null, decision: null, status: 'pending' }
  state.corrections.push({ ...base, correction_id: 'c-5001', day: '2026-11-12', reason: 'Forgot to clock out', submitted_at: '2026-11-13T01:00:00.000+00:00' })
}

test('employees are not offered Approvals/Team; a forced URL is answered "not available" by the server (403)', opts, () =>
  withApp(
    async ({ page, origin }) => {
      assert.equal(await count(page, '[data-testid=tab-btn-approvals]'), 0)
      assert.equal(await count(page, '[data-testid=tab-btn-team]'), 0)
      assert.equal(await count(page, '[data-testid=tab-btn-hr]'), 0)
      await page.goto(`${origin}/attendance?tab=approvals`)
      await page.waitForSelector('[data-testid=ts-not-available]')
      assert.equal(await count(page, '[data-testid=queue-row]'), 0)
      await page.goto(`${origin}/attendance?tab=hr`)
      await page.waitForSelector('[data-testid=tab-hr]')
      await page.waitForSelector('[data-testid=ts-not-available]')
      await page.goto(`${origin}/attendance?tab=team`)
      await page.waitForSelector('[data-testid=ts-not-available]')
    },
  ))

test('Approvals: queue of sheets and corrections, filters with counts, open a sheet read-only and approve it', opts, () =>
  withApp(
    async ({ page, state }) => {
      await openTab(page, 'approvals')
      await page.waitForSelector('[data-testid=queue-row]')
      assert.equal(await count(page, '[data-testid=queue-row]'), 2)
      assert.match(await text(page, '[data-testid=kind-all]'), /All\s*2/)
      assert.match(await text(page, '[data-testid=kind-sheets]'), /Timesheets\s*1/)
      assert.match(await text(page, '[data-testid=kind-corrections]'), /Corrections\s*1/)
      await page.click('[data-testid=kind-corrections]')
      await page.waitForFunction(() => document.querySelectorAll('[data-testid=queue-row]').length === 1)
      assert.match(await text(page, '[data-testid=queue-row]'), /Thu 12 Nov, 09:00 - 17:30/)
      await page.click('[data-testid=kind-sheets]')
      await page.waitForFunction(() => document.querySelectorAll('[data-testid=queue-row][data-type=timesheet]').length === 1)
      assert.match(await text(page, '[data-testid=queue-row]'), /Jamie Dela Cruz/)
      assert.match(await text(page, '[data-testid=queue-row]'), /22\.5 h/)
      await page.click('[data-testid=queue-open]')
      await page.waitForSelector('[data-testid=sheet][data-status=submitted]')
      assert.match(await text(page, '[data-testid=sheet-title]'), /Timesheet of Jamie Dela Cruz/)
      assert.match(page.url(), /employee_id=EMP-0005/)
      assert.equal(await page.locator('input[data-testid^=cell-]').count(), 0, 'read-only for the approver')
      assert.equal(await text(page, '[data-testid=week-total]'), '22.5')
      assert.equal(await count(page, '[data-testid=sheet-submit]'), 0)
      assert.match(await text(page, '[data-testid=decision-panel]'), /no effect on pay/)
      await page.click('[data-testid=decision-approve]')
      await page.waitForSelector('[data-testid=sheet][data-status=approved]')
      assert.equal(state.sheets[`EMP-0005_${MON}`].status, 'approved')
      assert.equal(await count(page, '[data-testid=decision-panel]'), 0)
      await page.click('[data-testid=sheet-back]')
      await page.waitForSelector('[data-testid=tab-approvals]')
      await page.waitForFunction(() => document.querySelectorAll('[data-testid=queue-row]').length === 1)
    },
    { as: 'miguel', path: '/attendance?tab=approvals', setup: submittedSetup },
  ))

test('rejecting needs a comment; the comment travels to the server; the owner sees it', opts, () =>
  withApp(
    async ({ page, state, origin }) => {
      await page.waitForSelector('[data-testid=sheet][data-status=submitted]')
      await page.click('[data-testid=decision-reject]')
      await page.waitForSelector('[data-testid=decision-comment-required]')
      assert.equal(state.sheets[`EMP-0005_${MON}`].status, 'submitted', 'nothing was sent without a comment')
      await page.fill('[data-testid=decision-comment]', 'Please split the project hours')
      await page.click('[data-testid=decision-reject]')
      await page.waitForSelector('[data-testid=sheet][data-status=rejected]')
      assert.match(await text(page, '[data-testid=rejection-comment]'), /Please split the project hours/)
      assert.equal(state.sheets[`EMP-0005_${MON}`].decisions[0].comment, 'Please split the project hours')
      // 409 on a stale decision reloads
      void origin
    },
    { as: 'miguel', path: `/attendance?tab=timesheet&week=${MON}&employee_id=EMP-0005`, ready: '[data-testid=tab-timesheet]', setup: submittedSetup },
  ))

test('a decision refused by the server (409 already decided) is explained and the sheet reloads', opts, () =>
  withApp(
    async ({ page, state }) => {
      await page.waitForSelector('[data-testid=decision-panel]')
      state.sheets[`EMP-0005_${MON}`].status = 'approved' // decided by someone else meanwhile
      state.sheets[`EMP-0005_${MON}`].version = 9
      await page.click('[data-testid=decision-approve]')
      await page.waitForSelector('[data-testid=sheet-error]')
      assert.match(await text(page, '[data-testid=sheet-error]'), /no longer waiting for a decision. The latest version is shown/)
      await page.waitForSelector('[data-testid=sheet][data-status=approved]')
      assert.equal(await count(page, '[data-testid=decision-panel]'), 0)
    },
    { as: 'miguel', path: `/attendance?tab=timesheet&week=${MON}&employee_id=EMP-0005`, ready: '[data-testid=tab-timesheet]', setup: submittedSetup },
  ))

test('correction approvals: Miguel opens the notification link, approves; rejecting needs a comment', opts, () =>
  withApp(
    async ({ page, state }) => {
      await page.waitForSelector('[data-testid=correction-detail][data-status=pending]')
      assert.match(await text(page, '[data-testid=correction-detail]'), /Forgot to clock out/)
      assert.equal(await count(page, '[data-testid=withdraw]'), 0, 'the reviewer cannot withdraw')
      await page.click('[data-testid=decision-reject]')
      await page.waitForSelector('[data-testid=decision-comment-required]')
      await page.fill('[data-testid=decision-comment]', 'Not matching the rota')
      await page.click('[data-testid=decision-reject]')
      await page.waitForSelector('[data-testid=correction-detail][data-status=rejected]')
      assert.equal(state.corrections[0].decision.comment, 'Not matching the rota')
      assert.equal(await count(page, '[data-testid=decision-panel]'), 0)
    },
    { as: 'miguel', path: '/attendance?tab=corrections&id=c-5001', ready: '[data-testid=tab-corrections]', setup: submittedSetup },
  ))

test('Approvals: empty and error states are honest; a user with the review scope but nothing waiting sees an empty state', opts, () =>
  withApp(
    async ({ page, state }) => {
      await page.waitForSelector('[data-testid=empty-state]')
      assert.match(await text(page, '[data-testid=empty-state]'), /Nothing is waiting for your decision/)
      state.force['GET /timesheet/review'] = { status: 500, body: { detail: 'x' }, once: true }
      await page.click('[data-testid=kind-sheets]')
      await page.waitForSelector('[data-testid=ts-error]')
      await page.click('[data-testid=ts-error] button')
      await page.waitForSelector('[data-testid=empty-state]')
    },
    { as: 'miguel', path: '/attendance?tab=approvals' },
  ))

// ------------------------------------------------------------------------------------------------ team
test('Team: hours per direct report, open a report timesheet read-only, attendance by day and a report month', opts, () =>
  withApp(
    async ({ page, state }) => {
      await page.waitForSelector('[data-testid=team-row]')
      assert.equal(await count(page, '[data-testid=team-row]'), 2)
      assert.match(await text(page, '[data-testid=team-row][data-employee=EMP-0005]'), /22\.5/)
      assert.match(await text(page, '[data-testid=team-row][data-employee=EMP-0005]'), /Submitted/)
      assert.match(await text(page, '[data-testid=team-row][data-employee=EMP-0004]'), /not started/)
      assert.match(await text(page, '[data-testid=team-total]'), /22\.5/)
      await page.click('[data-testid=team-row][data-employee=EMP-0005] [data-testid=team-open-sheet]')
      await page.waitForSelector('[data-testid=sheet][data-status=submitted]')
      assert.match(page.url(), /from=team/)
      await page.click('[data-testid=sheet-back]')
      await page.waitForSelector('[data-testid=tab-team]')
      // attendance view
      state.teamDay[MON] = [
        { employee_id: 'EMP-0004', name: 'Paolo Cruz', job_title: 'Finance Officer', state: 'out', first_in: '2026-11-16T00:55:00.000+00:00', last_out: '2026-11-16T01:50:00.000+00:00', hours: 0.92 },
        { employee_id: 'EMP-0005', name: 'Jamie Dela Cruz', job_title: 'Operations Coordinator', state: 'needs_correction', first_in: '2026-11-14T01:00:00.000+00:00', last_out: null, hours: 0 },
      ]
      await page.click('[data-testid=team-view-attendance]')
      await page.waitForSelector('[data-testid=team-att-row]')
      assert.match(await text(page, '[data-testid=team-att-row][data-employee=EMP-0004]'), /Clocked out/)
      assert.match(await text(page, '[data-testid=team-att-row][data-employee=EMP-0004]'), /08:55 - 09:50/)
      assert.match(await text(page, '[data-testid=team-att-row][data-employee=EMP-0005]'), /Needs correction/)
      assert.equal(await page.isDisabled('[data-testid=day-next]'), true, 'no future days')
      await page.click('[data-testid=day-prev]')
      await page.waitForFunction(() => /Sun 15 Nov 2026/.test(document.querySelector('[data-testid=day-label]').textContent))
      await page.click('[data-testid=day-today]')
      await page.waitForSelector('[data-testid=team-att-row]')
      await page.click('[data-testid=team-att-row][data-employee=EMP-0005] [data-testid=team-att-month]')
      await page.waitForSelector('[data-testid=person-month] [data-testid=month-view]')
      assert.match(await text(page, '[data-testid=person-month]'), /Attendance of Jamie Dela Cruz/)
      assert.equal(await count(page, '[data-testid=request-correction-link]'), 0, 'a manager cannot request corrections for others')
      assert.ok(state.log.some((l) => l.startsWith('GET /attendance/employees/EMP-0005')))
      await page.click('[data-testid=person-back]')
      await page.waitForSelector('[data-testid=team-att-row]')
    },
    { as: 'miguel', path: '/attendance?tab=team', setup: submittedSetup },
  ))

// ------------------------------------------------------------------------------------------------ HR
test('HR: week overview with counts only, and the code catalog (create, rename, deactivate), driven by can_manage', opts, () =>
  withApp(
    async ({ page, state }) => {
      assert.equal(await count(page, '[data-testid=tab-btn-hr]'), 1, 'offered from the server can_manage flag')
      assert.equal(await count(page, '[data-testid=tab-btn-team]'), 0)
      await page.waitForSelector('[data-testid=stat-submitted]')
      assert.match(await text(page, '[data-testid=stat-submitted]'), /^1\s/)
      assert.match(await text(page, '[data-testid=stat-pending_corrections]'), /^1\s/)
      assert.match(await text(page, '[data-testid=stat-no_sheet]'), /^4\s/)
      assert.doesNotMatch(await text(page, '[data-testid=hr-overview]'), /Jamie/, 'counts only, no names')
      assert.equal(await count(page, '[data-testid=sheet]'), 0)
      // catalog
      await page.waitForSelector('[data-testid=code-row]')
      assert.equal(await count(page, '[data-testid=code-row]'), 4)
      await page.fill('[data-testid=new-code-name]', '  Field   visit ')
      await page.check('[data-testid=new-code-billable]')
      await page.click('[data-testid=new-code-submit]')
      await page.waitForFunction(() => document.querySelectorAll('[data-testid=code-row]').length === 5)
      assert.deepEqual(state.codes.find((c) => c.name === 'Field visit') && { b: state.codes.find((c) => c.name === 'Field visit').billable }, { b: true })
      // duplicate name -> server message in words
      await page.fill('[data-testid=new-code-name]', 'field VISIT')
      await page.click('[data-testid=new-code-submit]')
      await page.waitForSelector('[data-testid=new-code-error]')
      assert.match(await text(page, '[data-testid=new-code-error]'), /already exists/)
      // empty name is caught locally
      await page.fill('[data-testid=new-code-name]', '   ')
      await page.click('[data-testid=new-code-submit]')
      assert.match(await text(page, '[data-testid=new-code-error]'), /Enter a name/)
      // rename + deactivate
      const row = '[data-testid=code-row][data-code=TC-TRAINING]'
      assert.equal(await page.isDisabled(`${row} [data-testid=code-save]`), true, 'nothing changed yet')
      await page.fill(`${row} [data-testid=code-name]`, 'Training and courses')
      await page.uncheck(`${row} [data-testid=code-active]`)
      await page.click(`${row} [data-testid=code-save]`)
      await page.waitForFunction(() => /Saved/.test(document.querySelector('[data-testid=code-row][data-code=TC-TRAINING]')?.textContent ?? ''))
      const trg = state.codes.find((c) => c.code_id === 'TC-TRAINING')
      assert.deepEqual([trg.name, trg.active, trg.version], ['Training and courses', false, 2])
      // the employee-facing catalog no longer offers the inactive code
      assert.equal(state.codes.filter((c) => c.active).some((c) => c.code_id === 'TC-TRAINING'), false)
    },
    {
      as: 'anna',
      path: '/attendance?tab=hr',
      setup: ({ state }) => {
        state.sheets[`EMP-0005_${MON}`] = { status: 'submitted', version: 2, submitted_at: '2026-11-16T01:00:00.000+00:00', rows: [{ code_id: 'TC-GENERAL', hours: { '2026-11-16': 8 } }], decisions: [] }
        state.corrections.push({ correction_id: 'c-7001', employee: { employee_id: 'EMP-0005', name: 'Jamie Dela Cruz' }, day: '2026-11-12', clock_in: '', clock_out: '', local_clock_in: '09:00', local_clock_out: '17:00', clock_out_next_day: false, hours: 8, timezone: 'Asia/Manila', session_id: null, reason: 'x', status: 'pending', submitted_at: '2026-11-13T01:00:00.000+00:00', decided_at: null, decision: null, version: 1 })
      },
    },
  ))

test('HR overview week navigation reloads counts for that week', opts, () =>
  withApp(
    async ({ page, state }) => {
      await page.waitForSelector('[data-testid=stat-approved]')
      assert.match(await text(page, '[data-testid=stat-approved]'), /^0\s/)
      await page.click('[data-testid=week-prev]')
      await page.waitForFunction(() => /^1\s/.test(document.querySelector('[data-testid=stat-approved]')?.innerText ?? ''))
      assert.ok(state.log.some((l) => l.includes('/timesheet/overview?week=2026-11-09')))
    },
    {
      as: 'anna',
      path: '/attendance?tab=hr',
      setup: ({ state }) => {
        state.sheets['EMP-0005_2026-11-09'] = { status: 'approved', version: 3, submitted_at: null, rows: [], decisions: [] }
      },
    },
  ))

test('deep link from a notification opens another person\'s timesheet in review mode (and "back" goes to approvals)', opts, () =>
  withApp(
    async ({ page }) => {
      await page.waitForSelector('[data-testid=sheet][data-status=submitted]')
      assert.match(await text(page, '[data-testid=sheet-title]'), /Timesheet of Jamie Dela Cruz/)
      assert.equal(await page.getAttribute('[data-testid=tab-btn-timesheet]', 'aria-selected'), 'true')
      assert.equal(await count(page, '[data-testid=decision-panel]'), 1)
      await page.click('[data-testid=sheet-back]')
      await page.waitForSelector('[data-testid=tab-approvals]')
    },
    { as: 'miguel', path: `/attendance?tab=timesheet&week=${MON}&employee_id=EMP-0005`, ready: '[data-testid=tab-timesheet]', setup: submittedSetup },
  ))

test('someone else\'s timesheet that the server hides (404) says "not available" and never shows data; Lia cannot read Jamie', opts, () =>
  withApp(
    async ({ page }) => {
      await page.waitForSelector('[data-testid=ts-not-available]')
      assert.equal(await count(page, '[data-testid=sheet]'), 0)
      assert.equal(await count(page, '[data-testid=decision-panel]'), 0)
    },
    { as: 'lia', path: `/attendance?tab=timesheet&week=${MON}&employee_id=EMP-0005`, ready: '[data-testid=tab-timesheet]', setup: submittedSetup },
  ))

// ------------------------------------------------------------------------------------------------ phone layout
test('phone: weekly grid becomes stacked day cards, editing works, totals stay right, nothing overflows, controls are 44px', opts, () =>
  withApp(
    async ({ page, state }) => {
      await page.waitForSelector('[data-testid=sheet]')
      assert.equal(await page.getAttribute('[data-testid=sheet-grid]', 'data-layout'), 'stacked')
      assert.equal(await count(page, 'table.ts-grid'), 0)
      assert.equal(await count(page, '[data-testid=day-stack]'), 7)
      await page.selectOption('[data-testid=add-code]', 'TC-GENERAL')
      await page.waitForSelector(ts(page, 'TC-GENERAL', MON))
      await page.fill(ts(page, 'TC-GENERAL', MON), '8')
      await page.fill(ts(page, 'TC-GENERAL', '2026-11-18'), '7.25')
      assert.equal((await text(page, '[data-testid=week-total]')).trim(), '15.25')
      assert.match(await text(page, '[data-testid=day-total-2026-11-18]'), /7\.25 h/)
      await page.fill(ts(page, 'TC-GENERAL', '2026-11-19'), '7.3')
      assert.match(await text(page, '[data-testid=grid-issues]'), /quarter-hour/)
      await page.fill(ts(page, 'TC-GENERAL', '2026-11-19'), '')
      assert.ok(await noOverflow(page))
      const small = await page.evaluate(() =>
        [...document.querySelectorAll('.app-content .btn, .app-content input:not([type=checkbox]), .app-content select, .app-content .ts-tab, .app-content .ts-icon-btn')]
          .filter((el) => el.getBoundingClientRect().width > 0)
          .map((el) => [el.className || el.tagName, Math.round(el.getBoundingClientRect().height)])
          .filter(([, h]) => h < 44),
      )
      assert.deepEqual(small, [])
      await page.click('[data-testid=sheet-save]')
      await page.waitForFunction(() => /Saved/.test(document.querySelector('[data-testid=sheet-message]')?.textContent ?? ''))
      assert.equal(state.sheets[`EMP-0005_${MON}`].rows[0].hours['2026-11-18'], 7.25)
      // and back to the table when the window grows
      await page.setViewportSize({ width: 1024, height: 900 })
      await page.waitForSelector('[data-testid=sheet-grid][data-layout=table]')
      assert.equal(await page.inputValue(ts(page, 'TC-GENERAL', '2026-11-18')), '7.25')
    },
    { path: '/attendance?tab=timesheet', viewport: { width: 390, height: 844 } },
  ))

test('phone: month days become cards with correction links; tabs wrap; the clock button is full width', opts, () =>
  withApp(
    async ({ page }) => {
      await page.waitForSelector('[data-testid=month-cards]')
      assert.equal(await count(page, '[data-testid=day-card]'), 30)
      assert.equal(await count(page, '[data-testid=month-table]'), 0)
      assert.ok((await count(page, '[data-testid=day-card] [data-testid=request-correction-link]')) > 5)
      const clock = await page.locator('[data-testid=clock-in]').boundingBox()
      assert.ok(clock.width > 300, `clock button is wide (${clock.width})`)
      assert.ok(clock.height >= 44)
      assert.ok(await noOverflow(page))
      const tabs = await page.locator('[data-testid=ts-tabs] button').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))
      assert.ok(tabs.every((h) => h >= 44), `tab heights ${tabs}`)
    },
    { viewport: { width: 390, height: 844 }, setup: monthSetup },
  ))
