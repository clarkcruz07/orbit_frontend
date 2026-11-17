// REAL-BACKEND end-to-end suite for Attendance & Timesheet. Starts the real backend (in-memory DB, demo auth, random port
// 8101-8199) through timesheet-real-stack.mjs - which wires the backend's injectable clock (docs/api/timesheet.md) to a file
// so this suite can move "now" without sleeping - plus the proxy that serves the built frontend, and drives system Chrome as
// the fictional demo people: Jamie (employee), Miguel (Jamie's manager), Carla (another manager), Lia (employee under
// Carla), Anna (HR admin) and Paolo (finance). Everything stays on 127.0.0.1; Gemini is off. Gated: RUN_BROWSER_TESTS=1.
//
// The tests run in order and share one backend: the flagged-session test is LAST because it moves the clock by 25 h.
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { launchBrowser } from './browser-env.mjs'
import { PEOPLE } from './real-backend.mjs'
import { startTimesheetStack } from './timesheet-real-stack.mjs'
import { actor, apiCall, apiLogin, text } from './e2e-helpers.mjs'

const enabled = process.env.RUN_BROWSER_TESTS === '1'
const opts = { skip: enabled ? false : 'set RUN_BROWSER_TESTS=1 to run real-browser tests' }

let browser
let stack
let origin
let cfg
const tokens = {}
const open = []

const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
const count = (page, sel) => page.locator(sel).count()
const cell = (code, day) => `[data-testid=cell-${code}-${day}]`

before(async () => {
  if (!enabled) return
  stack = await startTimesheetStack()
  origin = stack.origin
  browser = await launchBrowser()
  for (const k of Object.keys(PEOPLE)) tokens[k] = await apiLogin(origin, PEOPLE[k])
  cfg = (await call('jamie', 'GET', '/timesheet/config')).json
})
after(async () => {
  for (const a of open.splice(0)) await a.close().catch(() => undefined)
  await browser?.close()
  await stack?.close()
})

const call = (who, method, path, body) => apiCall(origin, tokens[who], method, path, body)
async function as(who, viewport) {
  const a = await actor(browser, origin, PEOPLE[who], viewport)
  open.push(a)
  return a
}
async function done(...actors) {
  for (const a of actors) {
    assert.deepEqual(a.pageErrors, [], 'no uncaught page errors')
    await a.close()
    open.splice(open.indexOf(a), 1)
  }
}
const W0 = () => cfg.current_week_start
const Wm = (n) => addDays(W0(), -7 * n)
const days = (monday) => Array.from({ length: 7 }, (_, i) => addDays(monday, i))
const sheetId = (emp, monday) => `${emp}_${monday}`
const JAMIE = 'EMP-0005'

async function gotoTab(page, query, ready) {
  await page.goto(`${origin}/attendance${query}`)
  await page.waitForSelector(ready ?? '[data-testid=ts-tabs]')
}

async function addCode(page, id) {
  await page.selectOption('[data-testid=add-code]', id)
  await page.waitForSelector(`[data-testid=grid-row][data-code=${id}]`)
}

async function jamieSubmitsViaApi(monday, hours = 8) {
  const d = days(monday)
  const save = await call('jamie', 'PATCH', `/timesheet/sheets/${sheetId(JAMIE, monday)}`, { rows: [{ code_id: 'TC-GENERAL', hours: { [d[0]]: hours } }] })
  assert.equal(save.status, 200, JSON.stringify(save.json))
  const sub = await call('jamie', 'POST', `/timesheet/sheets/${sheetId(JAMIE, monday)}/submit`, { version: save.json.version })
  assert.equal(sub.status, 200, JSON.stringify(sub.json))
  return sub.json
}

// ------------------------------------------------------------------------------------------------ attendance
test('Jamie clocks in and out; the live timer runs on the server clock and the month view records the session', opts, async () => {
  const jamie = await as('jamie')
  const { page } = jamie
  await gotoTab(page, '', '[data-testid=clock-card][data-state=out]')
  await page.click('[data-testid=clock-in]')
  await page.waitForSelector('[data-testid=clock-card][data-state=in]')
  assert.match(await text(page, '[data-testid=clock-done]'), /Clocked in at \d\d:\d\d/)
  let status = (await call('jamie', 'GET', '/attendance/status')).json
  assert.ok(status.open_session, 'the server holds the open session')
  assert.deepEqual(status.allowed_actions, ['clock_out'])
  assert.equal(await count(page, '[data-testid=clock-in]'), 0)
  // The card shows stamps, not a running clock: the time in is recorded, the time out is "Not yet".
  await page.waitForSelector('[data-testid=clock-stamps]')
  assert.equal(await count(page, '[data-testid=clock-timer]'), 0)
  assert.match(await text(page, '[data-testid=stamp-in]'), /\d\d:\d\d/)
  assert.match(await text(page, '[data-testid=stamp-out]'), /Not yet/)
  // The backend clock moves 2 h 1 min on, so the clock-out stamp is later than the clock-in stamp.
  stack.setClockOffset(2 * 3600 + 60)
  await page.reload()
  await page.waitForSelector('[data-testid=clock-stamps]')
  await page.click('[data-testid=clock-out]')
  await page.waitForSelector('[data-testid=clock-card][data-state=out]')
  assert.match(await text(page, '[data-testid=clock-done]'), /^Clocked out at \d\d:\d\d\.$/)
  await page.waitForFunction(() => /\d\d:\d\d/.test(document.querySelector('[data-testid=stamp-out]')?.textContent ?? ''))
  status = (await call('jamie', 'GET', '/attendance/status')).json
  assert.equal(status.open_session, null)
  assert.deepEqual(status.allowed_actions, ['clock_in'])
  await page.waitForSelector('[data-testid=day-row][data-today="1"] [data-testid=day-hours]')
  await page.waitForFunction(() => /^2\.0\d$/.test(document.querySelector('[data-testid=day-row][data-today="1"] [data-testid=day-hours]')?.innerText.trim() ?? ''))
  assert.match(await text(page, '[data-testid=month-totals]'), /1 day worked/)
  // The server agrees with what the page shows.
  const month = (await call('jamie', 'GET', '/attendance/me')).json
  const today = month.days.find((d) => d.is_today)
  assert.equal(today.sessions.length, 1)
  assert.ok(today.worked_hours >= 2 && today.worked_hours < 2.1)
  await done(jamie)
})

// ------------------------------------------------------------------------------------------------ timesheet: submit and approve
test('Jamie fills in this week\'s timesheet, saves and submits it; Miguel is notified', opts, async () => {
  const jamie = await as('jamie')
  const { page } = jamie
  const d = days(W0())
  await gotoTab(page, '?tab=timesheet', '[data-testid=sheet]')
  assert.match(await text(page, '[data-testid=sheet-status]'), /Open/)
  await addCode(page, 'TC-GENERAL')
  await addCode(page, 'TC-TRAINING')
  for (let i = 0; i < 4; i++) await page.fill(cell('TC-GENERAL', d[i]), '8')
  await page.fill(cell('TC-TRAINING', d[4]), '4,25')
  assert.equal(await text(page, '[data-testid=week-total]'), '36.25')
  // server limits are mirrored: 7.3 is refused locally, with nothing sent
  await page.fill(cell('TC-TRAINING', d[4]), '4.3')
  assert.match(await text(page, '[data-testid=grid-issues]'), /quarter-hour/)
  assert.equal(await page.isDisabled('[data-testid=sheet-submit]'), true)
  await page.fill(cell('TC-TRAINING', d[4]), '4.25')
  await page.click('[data-testid=sheet-save]')
  await page.waitForFunction(() => /Saved/.test(document.querySelector('[data-testid=sheet-message]')?.textContent ?? ''))
  let sheet = (await call('jamie', 'GET', `/timesheet/sheets/${sheetId(JAMIE, W0())}`)).json
  assert.equal(sheet.total_hours, 36.25)
  assert.equal(sheet.version, 1)
  assert.equal(sheet.status, 'open')
  await page.click('[data-testid=sheet-submit]')
  await page.waitForSelector('[data-testid=sheet][data-status=submitted]')
  assert.match(await text(page, '[data-testid=status-submitted]'), /Waiting for Miguel Santos/)
  assert.equal(await page.locator('input[data-testid^=cell-]').count(), 0, 'read-only once submitted')
  sheet = (await call('jamie', 'GET', `/timesheet/sheets/${sheetId(JAMIE, W0())}`)).json
  assert.equal(sheet.status, 'submitted')
  const notes = (await call('miguel', 'GET', '/notifications?limit=50')).json.items
  const note = notes.find((n) => n.kind === 'timesheet.review_needed')
  assert.ok(note, 'Miguel was told')
  assert.match(note.link, new RegExp(`tab=timesheet&week=${W0()}&employee_id=${JAMIE}`))
  assert.doesNotMatch(JSON.stringify(note), /Training|4\.25|36/, 'no hours or comments in a notification')
  await done(jamie)
})

test('Miguel reviews the queue, opens Jamie\'s sheet read-only and approves it; Jamie sees it through the bell link', opts, async () => {
  const miguel = await as('miguel')
  const { page } = miguel
  await gotoTab(page, '?tab=approvals', '[data-testid=queue-row]')
  assert.equal(await count(page, '[data-testid=tab-btn-approvals]'), 1, 'the manager is offered Approvals')
  assert.equal(await count(page, '[data-testid=queue-row][data-type=timesheet]'), 1)
  assert.match(await text(page, '[data-testid=queue-row]'), /Jamie Dela Cruz/)
  assert.match(await text(page, '[data-testid=queue-row]'), /36\.25 h/)
  await page.click('[data-testid=queue-open]')
  await page.waitForSelector('[data-testid=sheet][data-status=submitted]')
  assert.equal(await page.locator('input[data-testid^=cell-]').count(), 0, 'the approver cannot edit')
  assert.equal(await text(page, '[data-testid=week-total]'), '36.25')
  assert.equal(await count(page, '[data-testid=sheet-submit]'), 0)
  assert.match(await text(page, '[data-testid=decision-panel]'), /no effect on pay/)
  await page.fill('[data-testid=decision-comment]', 'Looks right')
  await page.click('[data-testid=decision-approve]')
  await page.waitForSelector('[data-testid=sheet][data-status=approved]')
  assert.equal((await call('jamie', 'GET', `/timesheet/sheets/${sheetId(JAMIE, W0())}`)).json.status, 'approved')
  // the queue is empty again
  await page.click('[data-testid=sheet-back]')
  await page.waitForSelector('[data-testid=empty-state]')
  await done(miguel)

  const jamie = await as('jamie')
  await jamie.page.click('[data-testid=bell]')
  await jamie.page.waitForSelector('[data-testid=bell-item]')
  const item = jamie.page.locator('[data-testid=bell-item]', { hasText: 'Timesheet approved' }).first()
  assert.equal(await item.count(), 1)
  await item.click()
  await jamie.page.waitForSelector('[data-testid=sheet][data-status=approved]')
  assert.match(jamie.page.url(), /tab=timesheet/)
  assert.match(await text(jamie.page, '[data-testid=sheet-title]'), /My timesheet/, 'the owner\'s own link opens her own sheet')
  assert.match(await text(jamie.page, '[data-testid=status-approved]'), /Approved by Miguel Santos/)
  assert.match(await text(jamie.page, '[data-testid=status-approved]'), /Looks right/)
  assert.match(await text(jamie.page, '[data-testid=status-approved]'), /no effect on pay/)
  assert.equal(await count(jamie.page, '[data-testid=sheet-save]'), 0)
  await done(jamie)
})

test('rejection needs a comment; Jamie sees it, fixes the hours and resubmits; the history keeps both decisions', opts, async () => {
  const wk = Wm(1)
  const d = days(wk)
  const jamie = await as('jamie')
  await gotoTab(jamie.page, `?tab=timesheet&week=${wk}`, `[data-testid=sheet][data-week="${wk}"]`)
  await addCode(jamie.page, 'TC-PROJECT')
  await jamie.page.fill(cell('TC-PROJECT', d[0]), '8')
  await jamie.page.fill(cell('TC-PROJECT', d[1]), '8')
  await jamie.page.click('[data-testid=sheet-submit]')
  await jamie.page.waitForSelector('[data-testid=sheet][data-status=submitted]')

  const miguel = await as('miguel')
  await gotoTab(miguel.page, `?tab=timesheet&week=${wk}&employee_id=${JAMIE}`, '[data-testid=decision-panel]')
  await miguel.page.click('[data-testid=decision-reject]')
  await miguel.page.waitForSelector('[data-testid=decision-comment-required]')
  assert.equal((await call('jamie', 'GET', `/timesheet/sheets/${sheetId(JAMIE, wk)}`)).json.status, 'submitted', 'no comment, no decision')
  await miguel.page.fill('[data-testid=decision-comment]', 'Tuesday was a holiday, please remove it')
  await miguel.page.click('[data-testid=decision-reject]')
  await miguel.page.waitForSelector('[data-testid=sheet][data-status=rejected]')
  await done(miguel)

  await jamie.page.reload()
  await jamie.page.waitForSelector('[data-testid=sheet][data-status=rejected]')
  assert.match(await text(jamie.page, '[data-testid=status-rejected]'), /Rejected by Miguel Santos/)
  assert.match(await text(jamie.page, '[data-testid=rejection-comment]'), /Tuesday was a holiday, please remove it/)
  await jamie.page.fill(cell('TC-PROJECT', d[1]), '0')
  assert.match(await text(jamie.page, '[data-testid=sheet-submit]'), /Submit again/)
  await jamie.page.click('[data-testid=sheet-submit]')
  await jamie.page.waitForSelector('[data-testid=sheet][data-status=submitted]')
  const afterResubmit = (await call('jamie', 'GET', `/timesheet/sheets/${sheetId(JAMIE, wk)}`)).json
  assert.equal(afterResubmit.total_hours, 8)
  assert.equal(afterResubmit.decisions.length, 1, 'the first rejection is kept in the history')

  const miguel2 = await as('miguel')
  await gotoTab(miguel2.page, `?tab=timesheet&week=${wk}&employee_id=${JAMIE}`, '[data-testid=decision-panel]')
  await miguel2.page.click('[data-testid=decision-approve]')
  await miguel2.page.waitForSelector('[data-testid=sheet][data-status=approved]')
  await done(miguel2)

  await jamie.page.reload()
  await jamie.page.waitForSelector('[data-testid=sheet][data-status=approved]')
  await jamie.page.click('[data-testid=sheet-history] summary')
  assert.equal(await count(jamie.page, '[data-testid=history-item]'), 2)
  assert.match(await text(jamie.page, '[data-testid=sheet-history]'), /Tuesday was a holiday/)
  await done(jamie)
})

test('Jamie recalls a submitted sheet before it is decided; it leaves Miguel\'s queue and can be edited again', opts, async () => {
  const wk = Wm(2)
  const d = days(wk)
  const jamie = await as('jamie')
  await gotoTab(jamie.page, `?tab=timesheet&week=${wk}`, `[data-testid=sheet][data-week="${wk}"]`)
  await addCode(jamie.page, 'TC-ADMIN')
  await jamie.page.fill(cell('TC-ADMIN', d[2]), '5')
  await jamie.page.click('[data-testid=sheet-submit]')
  await jamie.page.waitForSelector('[data-testid=sheet][data-status=submitted]')
  let queue = (await call('miguel', 'GET', '/timesheet/review?kind=sheets')).json
  assert.ok(queue.items.some((i) => i.id === sheetId(JAMIE, wk)))
  await jamie.page.click('[data-testid=sheet-recall]')
  await jamie.page.waitForSelector('[data-testid=sheet][data-status=open]')
  assert.match(await text(jamie.page, '[data-testid=sheet-message]'), /Recalled/)
  queue = (await call('miguel', 'GET', '/timesheet/review?kind=sheets')).json
  assert.ok(!queue.items.some((i) => i.id === sheetId(JAMIE, wk)))
  await jamie.page.fill(cell('TC-ADMIN', d[2]), '6')
  await jamie.page.click('[data-testid=sheet-save]')
  await jamie.page.waitForFunction(() => /Saved/.test(document.querySelector('[data-testid=sheet-message]')?.textContent ?? ''))
  assert.equal((await call('jamie', 'GET', `/timesheet/sheets/${sheetId(JAMIE, wk)}`)).json.total_hours, 6)
  await done(jamie)
})

test('a stale save (another tab changed the sheet) reloads the latest and says edits were discarded', opts, async () => {
  const wk = Wm(4)
  const d = days(wk)
  const jamie = await as('jamie')
  await gotoTab(jamie.page, `?tab=timesheet&week=${wk}`, `[data-testid=sheet][data-week="${wk}"]`)
  await addCode(jamie.page, 'TC-GENERAL')
  await jamie.page.fill(cell('TC-GENERAL', d[0]), '3')
  await jamie.page.click('[data-testid=sheet-save]')
  await jamie.page.waitForFunction(() => /Saved/.test(document.querySelector('[data-testid=sheet-message]')?.textContent ?? ''))
  // "another tab" saves a different version of the same week
  const other = await call('jamie', 'PATCH', `/timesheet/sheets/${sheetId(JAMIE, wk)}`, { rows: [{ code_id: 'TC-ADMIN', hours: { [d[1]]: 2 } }], version: 1 })
  assert.equal(other.status, 200)
  await jamie.page.fill(cell('TC-GENERAL', d[0]), '4')
  await jamie.page.click('[data-testid=sheet-save]')
  await jamie.page.waitForFunction(() => /changed elsewhere/.test(document.querySelector('[data-testid=sheet-error]')?.textContent ?? ''))
  await jamie.page.waitForSelector('[data-testid=grid-row][data-code=TC-ADMIN]')
  assert.equal(await count(jamie.page, '[data-testid=grid-row][data-code=TC-GENERAL]'), 0)
  await done(jamie)
})

// ------------------------------------------------------------------------------------------------ corrections
test('a correction request: Jamie asks, Miguel approves through the link, the month view shows the layered times and keeps the punches', opts, async () => {
  const day = addDays(cfg.today, -1)
  const jamie = await as('jamie')
  await gotoTab(jamie.page, '?tab=corrections', '[data-testid=tab-corrections]')
  await jamie.page.click('[data-testid=open-correction-form]')
  await jamie.page.fill('[data-testid=corr-day]', day)
  await jamie.page.fill('[data-testid=corr-in]', '09:00')
  await jamie.page.fill('[data-testid=corr-out]', '17:30')
  await jamie.page.fill('[data-testid=corr-reason]', 'Forgot to clock in, I was in a client meeting')
  await jamie.page.click('[data-testid=corr-submit]')
  await jamie.page.waitForSelector('[data-testid=correction-detail][data-status=pending]')
  assert.match(await text(jamie.page, '[data-testid=correction-times]'), /09:00 - 17:30/)
  assert.equal(await count(jamie.page, '[data-testid=decision-panel]'), 0, 'the owner never sees decision buttons')
  const mine = (await call('jamie', 'GET', '/attendance/corrections?scope=mine')).json.items
  assert.equal(mine.length, 1)
  const id = mine[0].correction_id
  // a second request for the same day is refused by the server and explained
  await jamie.page.click('[data-testid=correction-close]')
  await jamie.page.click('[data-testid=open-correction-form]')
  await jamie.page.fill('[data-testid=corr-day]', day)
  await jamie.page.fill('[data-testid=corr-in]', '08:00')
  await jamie.page.fill('[data-testid=corr-out]', '12:00')
  await jamie.page.fill('[data-testid=corr-reason]', 'again')
  await jamie.page.click('[data-testid=corr-submit]')
  await jamie.page.waitForSelector('[data-testid=corr-error]')
  assert.match(await text(jamie.page, '[data-testid=corr-error]'), /already have a correction waiting/)

  const note = (await call('miguel', 'GET', '/notifications?limit=50')).json.items.find((n) => n.kind === 'attendance.correction_review_needed')
  assert.ok(note)
  assert.match(note.link, new RegExp(`tab=corrections&id=${id}`))
  const miguel = await as('miguel')
  await miguel.page.goto(`${origin}${note.link}`)
  await miguel.page.waitForSelector('[data-testid=correction-detail][data-status=pending]')
  assert.match(await text(miguel.page, '[data-testid=correction-detail]'), /client meeting/)
  assert.equal(await count(miguel.page, '[data-testid=withdraw]'), 0)
  await miguel.page.fill('[data-testid=decision-comment]', 'Confirmed with the client')
  await miguel.page.click('[data-testid=decision-approve]')
  await miguel.page.waitForSelector('[data-testid=correction-detail][data-status=approved]')
  await done(miguel)

  await jamie.page.goto(`${origin}/attendance?month=${day.slice(0, 7)}`)
  await jamie.page.waitForSelector(`[data-testid=day-row][data-date="${day}"]`)
  const row = `[data-testid=day-row][data-date="${day}"]`
  assert.match(await text(jamie.page, `${row} [data-testid=flag-corrected]`), /Corrected/)
  assert.equal((await text(jamie.page, `${row} [data-testid=day-hours]`)).trim(), '8.5')
  assert.match(await text(jamie.page, row), /09:00/)
  assert.match(await text(jamie.page, row), /Original punches: none/)
  assert.equal(await count(jamie.page, `${row} [data-testid=request-correction-link]`), 1, 'a day can be corrected again after a decision')
  const dayRec = (await call('jamie', 'GET', `/attendance/me?month=${day.slice(0, 7)}`)).json.days.find((x) => x.date === day)
  assert.equal(dayRec.effective.source, 'correction')
  assert.equal(dayRec.sessions.length, 0, 'the original punches are untouched (there were none)')
  const decided = (await call('jamie', 'GET', '/notifications?limit=50')).json.items.find((n) => n.kind === 'attendance.correction_decided')
  assert.ok(decided)
  await done(jamie)
})

test('a rejected correction shows Miguel\'s reason; a pending one can be withdrawn', opts, async () => {
  const dayA = addDays(cfg.today, -2)
  const dayB = addDays(cfg.today, -3)
  const create = async (day, reason) => {
    const r = await call('jamie', 'POST', '/attendance/corrections', { day, clock_in: '09:00', clock_out: '17:00', clock_out_next_day: false, reason })
    assert.equal(r.status, 201, JSON.stringify(r.json))
    return r.json.correction_id
  }
  const idA = await create(dayA, 'Wrong day entered')
  const idB = await create(dayB, 'Please withdraw this one')
  const miguel = await as('miguel')
  await gotoTab(miguel.page, `?tab=corrections&id=${idA}`, '[data-testid=correction-detail]')
  await miguel.page.click('[data-testid=decision-reject]')
  await miguel.page.waitForSelector('[data-testid=decision-comment-required]')
  await miguel.page.fill('[data-testid=decision-comment]', 'The door log shows you left at noon')
  await miguel.page.click('[data-testid=decision-reject]')
  await miguel.page.waitForSelector('[data-testid=correction-detail][data-status=rejected]')
  await done(miguel)

  const jamie = await as('jamie')
  await gotoTab(jamie.page, `?tab=corrections&id=${idA}`, '[data-testid=correction-detail]')
  assert.match(await text(jamie.page, '[data-testid=correction-decision]'), /Rejected by Miguel Santos/)
  assert.match(await text(jamie.page, '[data-testid=correction-decision]'), /door log shows you left at noon/)
  assert.equal(await count(jamie.page, '[data-testid=withdraw]'), 0)
  await jamie.page.goto(`${origin}/attendance?tab=corrections&id=${idB}`)
  await jamie.page.waitForSelector('[data-testid=correction-detail][data-status=pending]')
  await jamie.page.click('[data-testid=withdraw]')
  await jamie.page.click('[data-testid=withdraw-confirm]')
  await jamie.page.waitForSelector('[data-testid=correction-detail][data-status=cancelled]')
  assert.equal((await call('jamie', 'GET', `/attendance/corrections/${idB}`)).json.status, 'cancelled')
  assert.equal((await call('miguel', 'GET', '/attendance/corrections?scope=review')).json.items.length, 0, 'a withdrawn request leaves the queue')
  await done(jamie)
})

// ------------------------------------------------------------------------------------------------ team and HR
test('Miguel\'s team views: hours per report and attendance; Carla (a different manager) sees none of Jamie\'s', opts, async () => {
  const miguel = await as('miguel')
  await gotoTab(miguel.page, '?tab=team', '[data-testid=team-row]')
  const jrow = '[data-testid=team-row][data-employee=EMP-0005]'
  assert.match(await text(miguel.page, jrow), /36\.25/)
  assert.match(await text(miguel.page, jrow), /Approved/)
  assert.ok((await count(miguel.page, '[data-testid=team-row]')) >= 2)
  await miguel.page.click('[data-testid=team-view-attendance]')
  await miguel.page.waitForSelector('[data-testid=team-att-row][data-employee=EMP-0005]')
  assert.match(await text(miguel.page, '[data-testid=team-att-row][data-employee=EMP-0005]'), /Clocked out/)
  await miguel.page.click('[data-testid=team-att-row][data-employee=EMP-0005] [data-testid=team-att-month]')
  await miguel.page.waitForSelector('[data-testid=person-month] [data-testid=month-view]')
  assert.match(await text(miguel.page, '[data-testid=person-month]'), /Attendance of Jamie Dela Cruz/)
  assert.equal(await count(miguel.page, '[data-testid=request-correction-link]'), 0)
  await done(miguel)

  const carla = await as('carla')
  await gotoTab(carla.page, '?tab=team', '[data-testid=team-row]')
  assert.equal(await count(carla.page, '[data-testid=team-row][data-employee=EMP-0005]'), 0)
  assert.match(await text(carla.page, '[data-testid=team-table]'), /Lia Ramos/)
  await gotoTab(carla.page, `?tab=timesheet&week=${W0()}&employee_id=${JAMIE}`, '[data-testid=ts-not-available]')
  await gotoTab(carla.page, '?tab=approvals', '[data-testid=empty-state]')
  assert.equal(await count(carla.page, '[data-testid=queue-row]'), 0)
  assert.equal((await call('carla', 'GET', `/attendance/employees/${JAMIE}`)).status, 404)
  assert.equal((await call('carla', 'GET', `/timesheet/sheets/${sheetId(JAMIE, W0())}`)).status, 404)
  await done(carla)
})

test('Lia (another team) cannot see Jamie\'s data through the page or the API', opts, async () => {
  const lia = await as('lia')
  await gotoTab(lia.page, `?tab=timesheet&week=${W0()}&employee_id=${JAMIE}`, '[data-testid=ts-not-available]')
  assert.equal(await count(lia.page, '[data-testid=sheet]'), 0)
  assert.equal(await count(lia.page, '[data-testid=decision-panel]'), 0)
  const corr = (await call('jamie', 'GET', '/attendance/corrections?scope=mine')).json.items[0]
  await gotoTab(lia.page, `?tab=corrections&id=${corr.correction_id}`, '[data-testid=ts-not-available]')
  assert.equal(await count(lia.page, '[data-testid=correction-detail]'), 0)
  for (const path of [`/timesheet/sheets/${sheetId(JAMIE, W0())}`, `/attendance/employees/${JAMIE}`, `/attendance/corrections/${corr.correction_id}`]) {
    assert.equal((await call('lia', 'GET', path)).status, 404, path)
  }
  // identical body to a plain unknown id: nothing about existence leaks
  const hidden = await call('lia', 'GET', `/timesheet/sheets/${sheetId(JAMIE, W0())}`)
  const unknown = await call('lia', 'GET', `/timesheet/sheets/EMP-9999_${W0()}`)
  assert.deepEqual(hidden.json, unknown.json)
  // her own data is untouched and works
  await gotoTab(lia.page, '', '[data-testid=clock-card]')
  assert.match(await text(lia.page, '[data-testid=clock-card]'), /not clocked in/)
  await done(lia)
})

test('an employee cannot reach Approvals, Team or the HR overview (server answers 403, the page says not available)', opts, async () => {
  const jamie = await as('jamie')
  const { page } = jamie
  await gotoTab(page, '')
  assert.deepEqual(await page.locator('[data-testid=ts-tabs] button').allInnerTexts(), ['Attendance', 'Timesheet', 'Corrections'])
  for (const t of ['approvals', 'team', 'hr']) {
    await gotoTab(page, `?tab=${t}`, '[data-testid=ts-not-available]')
    assert.equal(await count(page, '[data-testid=queue-row], [data-testid=team-row], [data-testid=hr-overview] .ts-stat'), 0, t)
  }
  assert.equal((await call('jamie', 'GET', '/timesheet/review')).status, 403)
  assert.equal((await call('jamie', 'GET', '/timesheet/team')).status, 403)
  assert.equal((await call('jamie', 'GET', '/timesheet/overview')).status, 403)
  assert.equal((await call('jamie', 'GET', '/attendance/team')).status, 403)
  assert.equal((await call('jamie', 'GET', '/timesheet/codes?include_inactive=true')).status, 403)
  assert.equal((await call('jamie', 'POST', '/timesheet/codes', { name: 'Sneaky' })).status, 403)
  // and the employee cannot decide on her own sheet
  const own = await call('jamie', 'POST', `/timesheet/sheets/${sheetId(JAMIE, Wm(1))}/decision`, { action: 'approve' })
  assert.ok([403, 409].includes(own.status), `own decision refused (${own.status})`)
  await done(jamie)
})

test('HR is read-only on timesheets (no decision while a manager exists) and manages the code catalog', opts, async () => {
  const wk = Wm(3)
  await jamieSubmitsViaApi(wk, 6) // submitted, waiting for Miguel
  const anna = await as('anna')
  const { page } = anna
  await gotoTab(page, `?tab=timesheet&week=${wk}&employee_id=${JAMIE}`, '[data-testid=sheet][data-status=submitted]')
  assert.equal(await page.locator('input[data-testid^=cell-]').count(), 0)
  assert.equal(await count(page, '[data-testid=decision-panel]'), 0, 'HR has no decision buttons: a manager exists')
  assert.equal(await count(page, '[data-testid=sheet-submit], [data-testid=sheet-save], [data-testid=sheet-recall]'), 0)
  const hrView = (await call('anna', 'GET', `/timesheet/sheets/${sheetId(JAMIE, wk)}`)).json
  assert.deepEqual(hrView.allowed_actions, [])
  assert.equal((await call('anna', 'POST', `/timesheet/sheets/${sheetId(JAMIE, wk)}/decision`, { action: 'approve' })).status, 403)
  assert.equal((await call('anna', 'PATCH', `/timesheet/sheets/${sheetId(JAMIE, wk)}`, { rows: [] })).status, 403)
  // her review queue holds nothing of Jamie's
  assert.equal((await call('anna', 'GET', '/timesheet/review')).json.total, 0)

  // overview: counts only
  await gotoTab(page, '?tab=hr', '[data-testid=stat-submitted]')
  assert.equal(await count(page, '[data-testid=tab-btn-team]'), 0)
  assert.match(await text(page, '[data-testid=stat-approved]'), /^1\s/)
  assert.doesNotMatch(await text(page, '[data-testid=hr-overview]'), /Jamie/)
  const overview = (await call('anna', 'GET', `/timesheet/overview?week=${W0()}`)).json
  assert.equal(overview.counts.approved, 1)
  // catalog: create, rename + deactivate, and the employee view follows
  await page.waitForSelector('[data-testid=code-row]')
  await page.fill('[data-testid=new-code-name]', 'Research (fictional)')
  await page.check('[data-testid=new-code-billable]')
  await page.click('[data-testid=new-code-submit]')
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=code-row]').length === 5)
  let codes = (await call('jamie', 'GET', '/timesheet/codes')).json.items
  assert.ok(codes.some((c) => c.name === 'Research (fictional)' && c.billable))
  await page.fill('[data-testid=new-code-name]', 'research (FICTIONAL)')
  await page.click('[data-testid=new-code-submit]')
  await page.waitForSelector('[data-testid=new-code-error]')
  assert.match(await text(page, '[data-testid=new-code-error]'), /already exists/)
  const row = '[data-testid=code-row][data-code=TC-TRAINING]'
  await page.uncheck(`${row} [data-testid=code-active]`)
  await page.click(`${row} [data-testid=code-save]`)
  await page.waitForFunction(() => /Saved/.test(document.querySelector('[data-testid=code-row][data-code=TC-TRAINING]')?.textContent ?? ''))
  codes = (await call('jamie', 'GET', '/timesheet/codes')).json.items
  assert.ok(!codes.some((c) => c.code_id === 'TC-TRAINING'), 'an inactive code is not offered to employees')
  await done(anna)

  // Jamie's old rows with the deactivated code still show; the new code can be added
  const jamie = await as('jamie')
  await gotoTab(jamie.page, `?tab=timesheet&week=${W0()}`, '[data-testid=sheet]')
  assert.equal(await count(jamie.page, '[data-testid=grid-row][data-code=TC-TRAINING]'), 1, 'valid on rows that already have it')
  assert.match(await text(jamie.page, '[data-testid=grid-row][data-code=TC-TRAINING]'), /Inactive/)
  await done(jamie)
})

test('Paolo (finance) uses his own clock and timesheet but sees nobody else\'s', opts, async () => {
  const paolo = await as('paolo')
  await gotoTab(paolo.page, '', '[data-testid=clock-card][data-state=out]')
  assert.equal(await count(paolo.page, '[data-testid=tab-btn-approvals]'), 0)
  await gotoTab(paolo.page, `?tab=timesheet&week=${W0()}&employee_id=${JAMIE}`, '[data-testid=ts-not-available]')
  assert.equal((await call('paolo', 'GET', `/timesheet/sheets/${sheetId(JAMIE, W0())}`)).status, 404)
  assert.equal((await call('paolo', 'GET', '/timesheet/me')).status, 200)
  await done(paolo)
})

// ------------------------------------------------------------------------------------------------ flagged session (moves the clock)
test('flagged session: left open past 16 h, the page explains it, clock actions are refused, a correction naming the punch unblocks it', opts, async () => {
  const jamie = await as('jamie')
  const { page } = jamie
  await gotoTab(page, '', '[data-testid=clock-card][data-state=out]')
  await page.click('[data-testid=clock-in]')
  await page.waitForSelector('[data-testid=clock-card][data-state=in]')
  const sessionDay = (await call('jamie', 'GET', '/attendance/status')).json.open_session.day
  // The backend clock jumps 25 hours: the punch is now older than 16 h (and on a past company day).
  stack.setClockOffset(2 * 3600 + 60 + 25 * 3600)
  await page.reload()
  await page.waitForSelector('[data-testid=clock-card][data-state=flagged]')
  const box = await text(page, '[data-testid=flagged-explainer]')
  assert.match(box, /never clocked out/)
  assert.match(box, /at most 16 hours/)
  assert.match(box, /Once the correction is approved you can clock in again/)
  assert.equal(await count(page, '[data-testid=clock-in]'), 0)
  assert.equal(await count(page, '[data-testid=clock-out]'), 0)
  assert.match(await text(page, '[data-testid=month-totals]'), /1 day needs correction/)
  const status = (await call('jamie', 'GET', '/attendance/status')).json
  assert.equal(status.needs_correction, true)
  assert.deepEqual(status.allowed_actions, ['request_correction'])
  // The server refuses both punches while flagged, with the machine code the page maps to words.
  const out = await call('jamie', 'POST', '/attendance/clock-out')
  assert.deepEqual([out.status, out.json.code], [409, 'needs_correction'])
  const again = await call('jamie', 'POST', '/attendance/clock-in')
  assert.deepEqual([again.status, again.json.code], [409, 'needs_correction'])
  // The page's path out: a prefilled, linked correction request.
  await page.click('[data-testid=flagged-request-correction]')
  await page.waitForSelector('[data-testid=correction-form]')
  assert.equal(await page.inputValue('[data-testid=corr-day]'), sessionDay)
  assert.equal(await count(page, '[data-testid=correction-linked]'), 1)
  await page.fill('[data-testid=corr-in]', '09:00')
  await page.fill('[data-testid=corr-out]', '17:00')
  await page.fill('[data-testid=corr-reason]', 'Forgot to clock out at the end of the day')
  await page.click('[data-testid=corr-submit]')
  await page.waitForSelector('[data-testid=correction-detail][data-status=pending]')
  // still blocked until it is approved
  assert.deepEqual((await call('jamie', 'GET', '/attendance/status')).json.allowed_actions, ['request_correction'])
  const id = (await call('jamie', 'GET', '/attendance/corrections?scope=mine&status=pending')).json.items[0].correction_id
  const miguel = await as('miguel')
  await gotoTab(miguel.page, `?tab=corrections&id=${id}`, '[data-testid=decision-panel]')
  await miguel.page.click('[data-testid=decision-approve]')
  await miguel.page.waitForSelector('[data-testid=correction-detail][data-status=approved]')
  await done(miguel)
  // Jamie can clock in again; the original punch is kept and marked resolved.
  await page.goto(`${origin}/attendance`)
  await page.waitForSelector('[data-testid=clock-card][data-state=out]')
  assert.deepEqual((await call('jamie', 'GET', '/attendance/status')).json.allowed_actions, ['clock_in'])
  const month = (await call('jamie', 'GET', `/attendance/me?month=${sessionDay.slice(0, 7)}`)).json
  const rec = month.days.find((d) => d.date === sessionDay)
  const resolved = rec.sessions.find((x) => x.status === 'resolved_by_correction')
  assert.ok(resolved, 'the flagged punch is marked resolved')
  assert.equal(resolved.clock_out, null, 'the raw punch is preserved, not closed')
  assert.ok(resolved.clock_in)
  assert.equal(rec.effective.source, 'correction')
  await page.click('[data-testid=clock-in]')
  await page.waitForSelector('[data-testid=clock-card][data-state=in]')
  await done(jamie)
})
