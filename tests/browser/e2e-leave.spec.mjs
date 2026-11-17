// REAL-BACKEND end-to-end suite for Leave. Starts the real backend (in-memory DB, demo auth, random port 8101-8199) and the
// proxy that serves frontend/dist, then drives system Chrome as the fictional demo people:
//   Jamie (employee, reports to Miguel), Miguel (manager), Anna (HR admin), Lia (employee, reports to Carla), Carla (manager),
//   Paolo (finance, reports to Miguel).
// All scenarios share one backend, so each uses its own weeks (relative to the SERVER's "today") and cancels what it books.
// Gated: RUN_BROWSER_TESTS=1 (use `npm run test:browser`). Nothing outside 127.0.0.1 is contacted.
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { launchBrowser } from './browser-env.mjs'
import { PEOPLE, startRealStack } from './real-backend.mjs'
import { actor, apiCall, apiLogin, pageApi, text, waitGone } from './e2e-helpers.mjs'
import { HOLIDAYS } from './mock-leave.mjs'

const enabled = process.env.RUN_BROWSER_TESTS === '1'
const opts = { skip: enabled ? false : 'set RUN_BROWSER_TESTS=1 to run real-browser tests' }

let browser
let stack
let origin
let today // the server's date (YYYY-MM-DD), from /leave/config
const open = []

before(async () => {
  if (!enabled) return
  stack = await startRealStack()
  origin = stack.origin
  browser = await launchBrowser()
  const token = await apiLogin(origin, PEOPLE.jamie)
  const cfg = await apiCall(origin, token, 'GET', '/leave/config')
  today = cfg.json.today
})
after(async () => {
  for (const a of open.splice(0)) await a.close().catch(() => undefined)
  await browser?.close()
  await stack?.close()
})

async function as(email, viewport) {
  const a = await actor(browser, origin, email, viewport)
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

// ------------------------------------------------------------------------------------------------ dates (server "today")
const D = (iso) => new Date(`${iso}T00:00:00Z`)
const iso = (d) => d.toISOString().slice(0, 10)
const addDays = (iso0, n) => iso(new Date(D(iso0).getTime() + n * 86_400_000))
const isHoliday = (d) => HOLIDAYS.some(([m, day]) => m === d.getUTCMonth() + 1 && day === d.getUTCDate())
const isWorkday = (isoDate) => {
  const d = D(isoDate)
  return d.getUTCDay() >= 1 && d.getUTCDay() <= 5 && !isHoliday(d)
}
/** First run of `n` consecutive working days (Mon-Fri, no holiday) on or after `today + offsetDays`, all inside one calendar year. */
function run(offsetDays, n) {
  for (let i = 0; i < 400; i++) {
    const start = addDays(today, offsetDays + i)
    const days = Array.from({ length: n }, (_, k) => addDays(start, k))
    if (days.every(isWorkday) && days[0].slice(0, 4) === days[n - 1].slice(0, 4)) return { start, end: days[n - 1], year: Number(start.slice(0, 4)) }
  }
  throw new Error('no free run found')
}
/** Working days in a calendar range (Mon-Fri minus holidays). */
function workingDays(start, end) {
  let n = 0
  for (let d = start; d <= end; d = addDays(d, 1)) if (isWorkday(d)) n++
  return n
}

// ------------------------------------------------------------------------------------------------ UI helpers
const LEAVE_READY = '[data-testid=tab-panel-my] [data-testid=balance-card]'

async function openLeave(page, query = '') {
  await page.goto(`${origin}/leave${query}`)
  await page.waitForSelector('[data-testid=leave-page]')
}

/** Balance card of one leave type for one calendar year (default: the server's current year). */
async function balance(page, typeId, year = Number(today.slice(0, 4))) {
  await openLeave(page, year === Number(today.slice(0, 4)) ? '' : `?by=${year}`)
  await page.waitForSelector(`[data-testid=balance-cards][data-year="${year}"] [data-testid=balance-card][data-type=${typeId}]`)
  const card = page.locator(`[data-testid=balance-card][data-type=${typeId}]`)
  const n = async (id) => Number((await card.locator(`[data-testid=${id}]`).innerText()).trim())
  return { entitlement: await n('balance-entitlement'), used: await n('balance-used'), pending: await n('balance-pending'), text: await card.innerText() }
}

/** Fills the form through the real UI and waits for the day-count preview. */
async function fill(page, { type = 'vacation', start, end = start, half = null, reason = null }) {
  await page.goto(`${origin}/leave/new`)
  await page.waitForSelector('[data-testid=leave-form]')
  await page.selectOption('[data-testid=leave-type]', type)
  await page.fill('[data-testid=leave-start]', start)
  if (end !== start) await page.fill('[data-testid=leave-end]', end)
  if (half) await page.check(`[data-testid=leave-half-${half}]`)
  if (reason !== null) await page.fill('[data-testid=leave-reason]', reason)
  await page.waitForSelector('[data-testid=leave-preview][data-state=valid], [data-testid=leave-preview][data-state=issues], [data-testid=leave-preview][data-state=error]')
}

async function submitNew(page, spec) {
  await fill(page, spec)
  await page.click('[data-testid=leave-submit]')
  await page.waitForSelector('[data-testid=leave-detail]')
  return page.url().split('/').pop()
}

async function openRequest(page, id) {
  await page.goto(`${origin}/leave/${id}`)
  await page.waitForSelector('[data-testid=leave-detail], [data-testid=leave-missing]')
}

const status = (page) => page.getAttribute('[data-testid=leave-detail]', 'data-status')
async function waitStatus(page, s) {
  await page.waitForFunction((x) => document.querySelector('[data-testid=leave-detail]')?.dataset.status === x, s, { timeout: 15000 })
}

async function decide(page, action, comment) {
  await page.waitForSelector('[data-testid=decision-panel]')
  if (comment) await page.fill('[data-testid=leave-comment]', comment)
  await page.click(`[data-testid=leave-${action}]`)
  await page.waitForSelector('[data-testid=decision-confirm-box]')
  await page.click('[data-testid=decision-confirm]')
  await waitGone(page, '[data-testid=decision-panel]')
}

async function cancel(page) {
  await page.click('[data-testid=leave-cancel]')
  await page.waitForSelector('[data-testid=cancel-confirm-box]')
  await page.click('[data-testid=cancel-confirm]')
  await waitStatus(page, 'cancelled')
}

const jamieToken = () => apiLogin(origin, PEOPLE.jamie)

// ------------------------------------------------------------------------------------------------ the main journey
test('E2E: Jamie requests (day count + balance), Miguel approves, Jamie sees approved with the balance reduced; the bell opens the request', opts, async () => {
  const w = run(14, 3)
  const secret = 'ZZ-PRIVATE-REASON-1'
  const jamie = await as(PEOPLE.jamie)
  const jp = jamie.page
  await openLeave(jp)
  // starts with the default balances: Vacation 15 entitlement, nothing used or pending
  const before = await balance(jp, 'vacation', w.year)
  assert.equal(before.entitlement, 15)
  assert.equal(before.used + before.pending, 0)
  assert.deepEqual(await jp.$$eval('[role=tab]', (els) => els.map((e) => e.textContent.trim())), ['My leave', 'Team calendar'])

  // the form: live day count and the balance after
  await jp.click('[data-testid=leave-new-link]')
  await jp.waitForSelector('[data-testid=leave-form]')
  await jp.selectOption('[data-testid=leave-type]', 'vacation')
  await jp.fill('[data-testid=leave-start]', w.start)
  await jp.fill('[data-testid=leave-end]', w.end)
  await jp.fill('[data-testid=leave-reason]', secret)
  await jp.waitForSelector('[data-testid=leave-preview][data-state=valid]')
  assert.equal(await jp.getAttribute('[data-testid=preview-days]', 'data-days'), '3')
  assert.match(await text(jp, '[data-testid=preview-balance]'), new RegExp(`${w.year}: 12 days left after this request`))
  assert.match(await text(jp, '[data-testid=form-balance]'), /Vacation \d{4}: 15 days left of 15/)
  await jp.click('[data-testid=leave-submit]')
  await jp.waitForSelector('[data-testid=leave-detail]')
  const id = jp.url().split('/').pop()
  assert.match(await text(jp, '[data-testid=leave-flash]'), /Leave request sent/)
  assert.equal(await status(jp), 'pending')
  assert.match(await text(jp, '[data-testid=fact-approver]'), /Waiting for Miguel Santos/)
  assert.match(await text(jp, '[data-testid=fact-reason]'), new RegExp(secret))
  assert.equal(await jp.locator('[data-testid=decision-panel]').count(), 0, 'the owner cannot decide')
  assert.equal(await jp.locator('[data-testid=leave-detail] [data-testid=leave-cancel]').count(), 1)
  const mid = await balance(jp, 'vacation', w.year)
  assert.equal(mid.pending, 3, 'a pending request is reserved')
  assert.equal(mid.used, 0)

  // Miguel: review queue, then approve through the confirmation step
  const miguel = await as(PEOPLE.miguel)
  const mp = miguel.page
  assert.deepEqual(await mp.$$eval('[role=tab]', (els) => els.map((e) => e.textContent.trim())).catch(() => []), [], 'not on the Leave page yet')
  await openLeave(mp, '?tab=approvals')
  await mp.waitForSelector('[data-testid=requests-panel][data-scope=review] [data-testid=leave-row]')
  assert.deepEqual(await mp.$$eval('[role=tab]', (els) => els.map((e) => e.textContent.trim())), ['My leave', 'Approvals', 'Team calendar'])
  const queued = await mp.$$eval('[data-testid=leave-row]', (els) => els.map((e) => e.dataset.id))
  assert.ok(queued.includes(id), 'the request is in Miguel\'s queue')
  await mp.click(`[data-testid=leave-row][data-id="${id}"] [data-testid=leave-open]`)
  await mp.waitForSelector('[data-testid=decision-panel]')
  assert.match(await text(mp, '[data-testid=fact-employee]'), /Jamie Dela Cruz/)
  assert.match(await text(mp, '[data-testid=fact-reason]'), new RegExp(secret), 'the deciding manager can read the reason')
  await decide(mp, 'approve', 'Enjoy the break')
  assert.equal(await status(mp), 'approved')
  assert.match(await text(mp, '[data-testid=timeline-item][data-kind=approve]'), /Miguel Santos \(Manager\)/)

  // Jamie: approved, balance reduced, history with the manager's comment
  await openRequest(jp, id)
  assert.equal(await status(jp), 'approved')
  assert.match(await text(jp, '[data-testid=timeline-comment]'), /Enjoy the break/)
  const after = await balance(jp, 'vacation', w.year)
  assert.equal(after.used, 3)
  assert.equal(after.pending, 0)
  assert.match(after.text, /12\s*days remaining/)

  // notifications carry no reason; the bell opens the request through /leave?request=<id>
  const token = await jamieToken()
  const notes = await apiCall(origin, token, 'GET', '/notifications?limit=30')
  const decided = notes.json.items.find((n) => n.kind === 'leave.decided_approved')
  assert.ok(decided, 'Jamie was notified')
  assert.equal(decided.link, `/leave?request=${id}`)
  assert.ok(!JSON.stringify(notes.json).includes(secret) && !JSON.stringify(notes.json).includes('Enjoy the break'), 'no reason or comment in notifications')
  await jp.goto(`${origin}/`)
  await jp.waitForSelector('.app-content')
  await jp.click('[data-testid=bell]')
  await jp.waitForSelector('[data-testid=bell-item]')
  await jp.click('[data-testid=bell-item]:has-text("Leave request approved")')
  await jp.waitForSelector('[data-testid=leave-detail]')
  assert.equal(new URL(jp.url()).pathname, `/leave/${id}`)

  // the team calendar shows the approved leave to Jamie (own), Miguel (direct report) and Anna (everyone), never to Lia
  const month = w.start.slice(0, 7)
  for (const [who, expect] of [[jp, 'You - Vacation'], [mp, 'Jamie Dela Cruz - Vacation']]) {
    await who.goto(`${origin}/leave?tab=calendar&month=${month}`)
    await who.waitForSelector(`[data-testid=lcal-cell][data-date="${w.start}"]`)
    assert.ok((await who.locator(`[data-testid=lcal-cell][data-date="${w.start}"] [data-testid=lcal-chip]`).allInnerTexts()).some((t) => t.includes(expect)), expect)
  }
  const lia = await as(PEOPLE.lia)
  await lia.page.goto(`${origin}/leave?tab=calendar&month=${month}`)
  await lia.page.waitForSelector('[data-testid=lcal-cell]')
  assert.equal(await lia.page.locator('[data-testid=lcal-chip]').count(), 0, 'colleagues\' leave is not shown to Lia')
  const anna = await as(PEOPLE.anna)
  await anna.page.goto(`${origin}/leave?tab=calendar&month=${month}`)
  await anna.page.waitForSelector(`[data-testid=lcal-cell][data-date="${w.start}"]`)
  assert.ok((await anna.page.locator(`[data-testid=lcal-cell][data-date="${w.start}"] [data-testid=lcal-chip]`).allInnerTexts()).some((t) => t.includes('Jamie Dela Cruz - Vacation')))

  // tidy: cancel the approved (future) leave: the balance comes back and Miguel is told
  await openRequest(jp, id)
  assert.match(await text(jp, '[data-testid=cancel-panel]'), /approver will be told/)
  await cancel(jp)
  const freed = await balance(jp, 'vacation', w.year)
  assert.equal(freed.used + freed.pending, 0, 'cancelling frees the balance')
  const mtoken = await apiLogin(origin, PEOPLE.miguel)
  const mnotes = await apiCall(origin, mtoken, 'GET', '/notifications?limit=30')
  assert.ok(mnotes.json.items.some((n) => n.kind === 'leave.cancelled'), 'cancelling approved leave notifies the approver')
  await done(jamie, miguel, lia, anna)
})

test('E2E: rejection needs a comment, Jamie sees it; the balance is untouched and the request is terminal', opts, async () => {
  const w = run(70, 2)
  const jamie = await as(PEOPLE.jamie)
  const id = await submitNew(jamie.page, { type: 'sick', start: w.start, end: w.end })
  const miguel = await as(PEOPLE.miguel)
  const mp = miguel.page
  await openRequest(mp, id)
  await mp.waitForSelector('[data-testid=decision-panel]')
  assert.ok(await mp.isDisabled('[data-testid=leave-reject]'), 'no comment, no reject')
  assert.ok(await mp.isDisabled('[data-testid=leave-clarify]'))
  await decide(mp, 'reject', 'Month-end close, please pick another week')
  assert.equal(await status(mp), 'rejected')
  await openRequest(jamie.page, id)
  assert.equal(await status(jamie.page), 'rejected')
  assert.match(await text(jamie.page, '[data-testid=timeline-comment]'), /Month-end close/)
  assert.equal(await jamie.page.locator('[data-testid=cancel-panel], [data-testid=edit-panel]').count(), 0, 'rejected is terminal')
  const sick = await balance(jamie.page, 'sick', w.year)
  assert.equal(sick.used + sick.pending, 0, 'a rejected request reserves nothing')
  await done(jamie, miguel)
})

test('E2E: clarification round trip: Miguel asks (comment required), Jamie edits and resubmits, Miguel approves', opts, async () => {
  const w = run(91, 3)
  const jamie = await as(PEOPLE.jamie)
  const jp = jamie.page
  const id = await submitNew(jp, { type: 'vacation', start: w.start, end: w.end, reason: 'Trip' })
  const miguel = await as(PEOPLE.miguel)
  const mp = miguel.page
  await openRequest(mp, id)
  await decide(mp, 'clarify', 'Is the trip on those exact dates?')
  assert.equal(await status(mp), 'clarification_requested')

  await openRequest(jp, id)
  assert.equal(await status(jp), 'clarification_requested')
  assert.equal(await jp.getAttribute('[data-testid=leave-detail]', 'data-mode'), 'editor')
  assert.match(await text(jp, '[data-testid=clarify-note]'), /Is the trip on those exact dates\?/)
  const held = await balance(jp, 'vacation', w.year)
  assert.equal(held.pending, 0, 'a clarification reserves nothing until resubmitted')
  await openRequest(jp, id)
  // shorten to two days and explain
  const shorter = addDays(w.end, -1)
  await jp.fill('[data-testid=edit-panel] [data-testid=leave-end]', shorter)
  await jp.fill('[data-testid=edit-panel] [data-testid=leave-reason]', 'Trip confirmed, two days only')
  await jp.waitForSelector('[data-testid=edit-panel] [data-testid=leave-preview][data-state=valid]')
  await jp.click('[data-testid=leave-resubmit]')
  await waitStatus(jp, 'pending')
  assert.match(await text(jp, '[data-testid=leave-flash]'), /sent again for approval/)
  assert.match(await text(jp, '[data-testid=fact-days]'), /2 days/)
  assert.equal((await balance(jp, 'vacation', w.year)).pending, 2)

  await openRequest(mp, id)
  await decide(mp, 'approve', null)
  assert.equal(await status(mp), 'approved')
  await openRequest(jp, id)
  const kinds = await jp.$$eval('[data-testid=timeline-item]', (els) => els.map((e) => e.dataset.kind))
  assert.deepEqual(kinds, ['submitted', 'clarify', 'resubmitted', 'approve'])
  assert.match(await text(jp, '[data-testid=leave-timeline]'), /Is the trip on those exact dates\?/)
  await cancel(jp)
  await done(jamie, miguel)
})

test('E2E: cancel a pending request (nobody is notified) and the owner can no longer edit it', opts, async () => {
  const w = run(112, 2)
  const jamie = await as(PEOPLE.jamie)
  const jp = jamie.page
  const id = await submitNew(jp, { type: 'personal', start: w.start, end: w.start })
  assert.equal((await balance(jp, 'personal', w.year)).pending, 1)
  await openRequest(jp, id)
  await jp.click('[data-testid=leave-cancel]')
  await jp.click('[data-testid=cancel-keep]')
  assert.equal(await status(jp), 'pending')
  await cancel(jp)
  assert.match(await text(jp, '[data-testid=leave-flash]'), /Request cancelled/)
  assert.equal((await balance(jp, 'personal', w.year)).pending, 0)
  const mtoken = await apiLogin(origin, PEOPLE.miguel)
  const notes = await apiCall(origin, mtoken, 'GET', '/notifications?limit=50')
  assert.ok(!notes.json.items.some((n) => n.kind === 'leave.cancelled' && n.link.includes(id)), 'cancelling a pending request notifies nobody')
  // the server refuses a second cancel with 409, whatever the UI shows
  const again = await pageApi(jp, origin, 'POST', `/leave/requests/${id}/cancel`)
  assert.equal(again.status, 409)
  await done(jamie)
})

test('E2E: overlap 409 and insufficient-balance 422 show clear messages in the form and store nothing', opts, async () => {
  const w = run(133, 3)
  const jamie = await as(PEOPLE.jamie)
  const jp = jamie.page
  const id = await submitNew(jp, { type: 'vacation', start: w.start, end: w.end })

  // overlap: one day inside the booked run
  await fill(jp, { type: 'vacation', start: w.start, end: w.start })
  assert.match(await jp.getAttribute('[data-testid=leave-preview]', 'data-state'), /issues/)
  assert.match(await text(jp, '[data-testid=preview-issue][data-code=overlap]'), /overlaps/)
  await jp.click('[data-testid=leave-submit]')
  await jp.waitForSelector('[data-testid=form-error]')
  assert.match(await text(jp, '[data-testid=form-error]'), /already have a pending or approved leave request that overlaps/)
  await jp.click('[data-testid=conflict-link]')
  await jp.waitForSelector('[data-testid=leave-detail]')
  assert.equal(jp.url().split('/').pop(), id, 'the link points at the person\'s own conflicting request')

  // balance: a 4-week run is more than the 15 placeholder days (and Jamie already has 3 pending)
  const long = run(160, 1)
  const end = addDays(long.start, 27)
  const needed = workingDays(long.start, end)
  assert.ok(needed > 15, 'precondition: more working days than the entitlement')
  await fill(jp, { type: 'vacation', start: long.start, end })
  assert.match(await jp.getAttribute('[data-testid=leave-preview]', 'data-state'), /issues|error/)
  await jp.click('[data-testid=leave-submit]')
  await jp.waitForSelector('[data-testid=form-error]')
  const msg = (await text(jp, '[data-testid=form-error]')).trim()
  const wantRemaining = 12 // 15 entitlement - 3 pending
  const asked = Number(long.start.slice(0, 4)) === Number(end.slice(0, 4)) ? needed : null
  if (asked !== null) assert.equal(msg, `Not enough leave balance: you have ${wantRemaining} days left for ${long.start.slice(0, 4)} and this request needs ${asked} days.`)
  else assert.match(msg, /Not enough leave balance: you have .* left for \d{4} and this request needs/)
  const list = await apiCall(origin, await jamieToken(), 'GET', '/leave/requests?scope=mine&page_size=50')
  assert.ok(!list.json.items.some((r) => r.start_date === long.start), 'the refused request was not stored')

  // unpaid has no limit: the same run is accepted
  const unpaid = await submitNew(jp, { type: 'unpaid', start: long.start, end })
  assert.equal(await jp.getAttribute('[data-testid=leave-detail]', 'data-status'), 'pending')
  await cancel(jp)
  await openRequest(jp, id)
  await cancel(jp)
  assert.ok(unpaid)
  await done(jamie)
})

test('E2E: weekend-only dates are refused with a clear message', opts, async () => {
  const jamie = await as(PEOPLE.jamie)
  const jp = jamie.page
  // the first Saturday at least 30 days out
  let sat = addDays(today, 30)
  while (D(sat).getUTCDay() !== 6) sat = addDays(sat, 1)
  await fill(jp, { type: 'vacation', start: sat, end: addDays(sat, 1) })
  assert.match(await text(jp, '[data-testid=preview-issue][data-code=no_working_days]'), /no working days/)
  await jp.click('[data-testid=leave-submit]')
  await jp.waitForSelector('[data-testid=form-error]')
  assert.match(await text(jp, '[data-testid=form-error]'), /no working days/)
  await done(jamie)
})

// ------------------------------------------------------------------------------------------------ visibility
test('E2E: Lia, Carla and Paolo get the same "not found" for Jamie\'s request; Jamie\'s other people\'s ids give the same answer; HR can read but not decide', opts, async () => {
  const w = run(182, 2)
  const jamie = await as(PEOPLE.jamie)
  const id = await submitNew(jamie.page, { type: 'vacation', start: w.start, end: w.end, reason: 'Only my manager and HR may read this' })
  const bodies = []
  for (const who of [PEOPLE.lia, PEOPLE.carla, PEOPLE.paolo]) {
    const a = await as(who)
    await openRequest(a.page, id)
    assert.equal(await a.page.locator('[data-testid=leave-detail]').count(), 0, `${who} sees no details`)
    assert.match(await text(a.page, '[data-testid=leave-missing]'), /does not exist, or you do not have access/)
    assert.ok(!(await a.page.content()).includes('Only my manager and HR may read this'))
    const api = await pageApi(a.page, origin, 'GET', `/leave/requests/${id}`)
    assert.equal(api.status, 404)
    bodies.push(JSON.stringify(api.json))
    // and a random id gives the identical body
    const ghost = await pageApi(a.page, origin, 'GET', '/leave/requests/00000000-0000-4000-8000-0000000000aa')
    assert.equal(JSON.stringify(ghost.json), bodies[bodies.length - 1])
    // their own lists do not include it
    const mine = await pageApi(a.page, origin, 'GET', '/leave/requests?scope=mine&page_size=50')
    assert.ok(!mine.json.items.some((r) => r.request_id === id))
    await done(a)
  }
  assert.equal(new Set(bodies).size, 1)

  // HR (Anna): sees it under Approvals -> All requests, reads reason and history, has NO decision or cancel controls
  const anna = await as(PEOPLE.anna)
  const ap = anna.page
  await openLeave(ap, '?tab=approvals')
  assert.deepEqual(await ap.$$eval('[role=tab]', (els) => els.map((e) => e.textContent.trim())), ['My leave', 'Approvals', 'Team calendar', 'Leave settings'])
  await ap.click('[data-testid=approvals-scope-all]')
  await ap.waitForSelector(`[data-testid=requests-panel][data-scope=all] [data-testid=leave-row][data-id="${id}"]`)
  const review = await apiCall(origin, await apiLogin(origin, PEOPLE.anna), 'GET', '/leave/requests?scope=review&page_size=50')
  assert.ok(!review.json.items.some((r) => r.request_id === id), 'HR does not get it in the decision queue while a manager can decide')
  await ap.click(`[data-testid=leave-row][data-id="${id}"] [data-testid=leave-open]`)
  await ap.waitForSelector('[data-testid=leave-detail]')
  assert.match(await text(ap, '[data-testid=fact-reason]'), /Only my manager and HR may read this/)
  assert.equal(await ap.getAttribute('[data-testid=leave-detail]', 'data-mode'), 'readonly')
  assert.equal(await ap.locator('[data-testid=decision-panel], [data-testid=cancel-panel], [data-testid=edit-panel]').count(), 0)
  assert.match(await text(ap, '[data-testid=no-actions]'), /No actions are available to you/)
  const hrDecide = await pageApi(ap, origin, 'POST', `/leave/requests/${id}/decision`, { action: 'approve' })
  assert.equal(hrDecide.status, 403, 'the server, not the hidden button, refuses HR')
  // tidy
  await openRequest(jamie.page, id)
  await cancel(jamie.page)
  await done(jamie, anna)
})

test('E2E: an employee cannot reach Approvals or Leave settings, and the server refuses their direct calls', opts, async () => {
  const jamie = await as(PEOPLE.jamie)
  const jp = jamie.page
  for (const t of ['approvals', 'settings']) {
    await openLeave(jp, `?tab=${t}`)
    await jp.waitForSelector(LEAVE_READY)
    assert.equal(await jp.getAttribute('[data-testid=leave-tab-my]', 'aria-selected'), 'true')
  }
  assert.equal(await jp.locator('[data-testid=leave-tab-approvals], [data-testid=leave-tab-settings]').count(), 0)
  for (const [method, path, body] of [
    ['GET', '/leave/requests?scope=review', null],
    ['GET', '/leave/requests?scope=all', null],
    ['GET', '/leave/requests?scope=team', null],
    ['GET', '/leave/types?include_inactive=true', null],
    ['POST', '/leave/types', { name: 'Sneaky', paid: true, annual_days: 99, requires_reason: false }],
    ['PATCH', '/leave/types/vacation', { annual_days: 365 }],
    ['GET', '/leave/entitlements', null],
    ['POST', '/leave/entitlements', { employee_id: 'EMP-0005', type_id: 'vacation', year: 2026, days: 300 }],
  ]) {
    const r = await pageApi(jp, origin, method, path, body)
    assert.equal(r.status, 403, `${method} ${path}`)
  }
  // Finance and an unrelated manager see only their own lists too
  const paolo = await as(PEOPLE.paolo)
  assert.equal((await pageApi(paolo.page, origin, 'GET', '/leave/requests?scope=review')).status, 403)
  await openLeave(paolo.page, '?tab=approvals')
  await paolo.page.waitForSelector(LEAVE_READY)
  assert.equal(await paolo.page.locator('[data-testid=leave-tab-approvals]').count(), 0)
  await done(jamie, paolo)
})

// ------------------------------------------------------------------------------------------------ HR catalog + overrides
test('E2E: HR (Anna) adds a type that needs a reason, sets a per-employee override, deactivates; Jamie sees each effect', opts, async () => {
  const w = run(210, 2)
  const anna = await as(PEOPLE.anna)
  const ap = anna.page
  await openLeave(ap, '?tab=settings')
  await ap.waitForSelector('[data-testid=type-row]')
  assert.deepEqual(await ap.$$eval('[data-testid=type-row]', (els) => els.map((e) => e.dataset.type)), ['vacation', 'sick', 'personal', 'unpaid'])
  assert.match(await text(ap, '[data-testid=type-row][data-type=vacation]'), /15 days a year/)

  // add "Study leave": 2 days a year, reason required
  await ap.click('[data-testid=type-add]')
  await ap.fill('[data-testid=type-name]', 'Study leave')
  await ap.fill('[data-testid=type-days]', '2')
  await ap.check('[data-testid=type-reason]')
  await ap.click('[data-testid=type-save]')
  await ap.waitForSelector('[data-testid=type-row][data-type]:has-text("Study leave")')
  assert.match(await text(ap, '[data-testid=settings-flash]'), /Added "Study leave"/)
  const studyId = await ap.getAttribute('[data-testid=type-row]:has-text("Study leave")', 'data-type')

  // Jamie: the new type is offered, its reason is required, 3 days > 2 entitlement is refused with the days left
  const jamie = await as(PEOPLE.jamie)
  const jp = jamie.page
  await fill(jp, { type: studyId, start: w.start, end: w.start })
  assert.match(await text(jp, '[data-testid=type-help]'), /2 days a year, reason required/)
  await jp.click('[data-testid=leave-submit]')
  assert.match(await text(jp, '[data-testid=error-reason]'), /needs a reason/)
  await jp.fill('[data-testid=leave-reason]', 'Exam')
  const w3 = run(230, 3)
  await jp.fill('[data-testid=leave-start]', w3.start)
  await jp.fill('[data-testid=leave-end]', w3.end)
  await jp.waitForSelector('[data-testid=leave-preview][data-state=issues]')
  await jp.click('[data-testid=leave-submit]')
  await jp.waitForSelector('[data-testid=form-error]')
  assert.match(await text(jp, '[data-testid=form-error]'), /you have 2 days left for \d{4} and this request needs 3 days/)

  // per-employee override: Anna gives Jamie 3 days of Study leave for that year
  await ap.fill('[data-testid=picker-input]', 'jamie')
  await ap.waitForSelector('[data-testid=picker-option]')
  await ap.click('[data-testid=picker-option]')
  await ap.selectOption('[data-testid=override-type]', studyId)
  await ap.fill('[data-testid=override-year]', String(w3.year))
  await ap.fill('[data-testid=override-days]', '3')
  await ap.click('[data-testid=override-save]')
  await ap.waitForSelector('[data-testid=override-row]')
  assert.match(await text(ap, '[data-testid=override-row]'), /Jamie Dela Cruz/)
  await jp.click('[data-testid=leave-submit]')
  await jp.waitForSelector('[data-testid=leave-detail]')
  const bid = jp.url().split('/').pop()
  await openLeave(jp)
  await jp.waitForSelector('[data-testid=balance-card][data-type]')
  const card = jp.locator(`[data-testid=balance-card][data-type="${studyId}"]`)
  // the override applies to the year of the request, which is the current year here
  if (w3.year === Number(today.slice(0, 4))) assert.match(await card.innerText(), /Set by HR for you/)

  // remove the override (confirmation first) and deactivate the type; Jamie can no longer pick it
  await openRequest(jp, bid)
  await cancel(jp)
  await ap.click('[data-testid=override-remove]')
  await ap.click('[data-testid=override-remove-confirm]')
  await waitGone(ap, '[data-testid=override-row]')
  await ap.click(`[data-testid=type-row][data-type="${studyId}"] [data-testid=type-deactivate]`)
  await ap.click('[data-testid=type-confirm]')
  await ap.waitForSelector(`[data-testid=type-row][data-type="${studyId}"][data-active=false]`)
  await jp.goto(`${origin}/leave/new`)
  await jp.waitForSelector('[data-testid=leave-form]')
  const options = await jp.$$eval('[data-testid=leave-type] option', (els) => els.map((e) => e.value))
  assert.ok(!options.includes(studyId), 'an inactive type is not offered')
  // the type has requests now (cancelled), so the UI offers no delete for it
  assert.equal(await ap.locator(`[data-testid=type-row][data-type="${studyId}"] [data-testid=type-delete]`).count(), 0)
  await done(jamie, anna)
})

// ------------------------------------------------------------------------------------------------ HR fallback approver
test('E2E: Miguel and Anna have no manager who can decide: HR is the approver for Miguel; nobody decides their own request; Miguel cannot see Anna\'s', opts, async () => {
  const w = run(252, 2)
  const miguel = await as(PEOPLE.miguel)
  const mp = miguel.page
  const id = await submitNew(mp, { type: 'vacation', start: w.start, end: w.end })
  assert.match(await text(mp, '[data-testid=fact-approver]'), /Waiting for HR/)
  assert.equal(await mp.locator('[data-testid=decision-panel]').count(), 0, 'Miguel cannot decide his own request')
  const own = await pageApi(mp, origin, 'POST', `/leave/requests/${id}/decision`, { action: 'approve' })
  assert.equal(own.status, 403)

  const anna = await as(PEOPLE.anna)
  const ap = anna.page
  await openLeave(ap, '?tab=approvals')
  await ap.waitForSelector(`[data-testid=requests-panel][data-scope=review] [data-testid=leave-row][data-id="${id}"]`)
  await ap.click(`[data-testid=leave-row][data-id="${id}"] [data-testid=leave-open]`)
  await ap.waitForSelector('[data-testid=decision-panel]')
  await decide(ap, 'approve', 'Approved by HR')
  assert.equal(await status(ap), 'approved')
  assert.match(await text(ap, '[data-testid=timeline-item][data-kind=approve]'), /Anna Reyes \(HRAdmin\)/)

  // Anna's own request: her manager has no account, she is the only HR admin -> nobody can decide it; she can still cancel it
  const mine = await submitNew(ap, { type: 'sick', start: run(280, 1).start })
  assert.match(await text(ap, '[data-testid=fact-approver]'), /Waiting for HR/)
  assert.equal(await ap.locator('[data-testid=decision-panel]').count(), 0)
  assert.equal(await ap.locator('[data-testid=cancel-panel]').count(), 1)
  await openRequest(mp, mine)
  assert.equal(await mp.locator('[data-testid=leave-detail]').count(), 0, 'Miguel (a manager, not her manager) cannot see Anna\'s request')
  await cancel(ap).catch(async () => {
    await openRequest(ap, mine)
    await cancel(ap)
  })
  await openRequest(mp, id)
  await cancel(mp)
  await done(miguel, anna)
})

// ------------------------------------------------------------------------------------------------ phone + deep link + approver 409
test('E2E (phone 390px): Jamie asks for leave through the cards layout and sees the detail; no horizontal overflow', opts, async () => {
  const w = run(300, 2)
  const jamie = await as(PEOPLE.jamie, { width: 390, height: 800 })
  const jp = jamie.page
  await openLeave(jp)
  await jp.waitForSelector('[data-testid=balance-card]')
  assert.ok(await jp.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1))
  await jp.click('[data-testid=leave-new-link]')
  await jp.waitForSelector('[data-testid=leave-form]')
  await jp.selectOption('[data-testid=leave-type]', 'vacation')
  await jp.fill('[data-testid=leave-start]', w.start)
  await jp.fill('[data-testid=leave-end]', w.end)
  await jp.waitForSelector('[data-testid=leave-preview][data-state=valid]')
  assert.ok(await jp.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1))
  await jp.click('[data-testid=leave-submit]')
  await jp.waitForSelector('[data-testid=leave-detail]')
  const id = jp.url().split('/').pop()
  await jp.click('[data-testid=leave-back]')
  await jp.waitForSelector('[data-testid=leave-card]')
  assert.equal(await jp.locator('[data-testid=leave-table]').isVisible(), false, 'the table becomes cards on a phone')
  assert.ok(await jp.locator(`[data-testid=leave-card]`).first().isVisible())
  await openRequest(jp, id)
  assert.ok(await jp.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1))
  await cancel(jp)
  await done(jamie)
})

test('E2E: a decision that lost the race (stale version) is explained, and the server refuses a second decision with 409', opts, async () => {
  const w = run(322, 2)
  const jamie = await as(PEOPLE.jamie)
  const id = await submitNew(jamie.page, { type: 'vacation', start: w.start, end: w.end })
  const miguel = await as(PEOPLE.miguel)
  const mp = miguel.page
  await openRequest(mp, id)
  await mp.waitForSelector('[data-testid=decision-panel]')
  // meanwhile Jamie cancels (version moves on); Miguel's page is stale
  await cancelViaApi(jamie.page, id)
  await mp.click('[data-testid=leave-approve]')
  await mp.click('[data-testid=decision-confirm]')
  await mp.waitForSelector('[data-testid=conflict-banner]')
  assert.match(await text(mp, '[data-testid=conflict-banner]'), /reloaded the latest version/)
  assert.equal(await status(mp), 'cancelled')
  assert.equal(await mp.locator('[data-testid=decision-panel]').count(), 0)
  const again = await pageApi(mp, origin, 'POST', `/leave/requests/${id}/decision`, { action: 'approve' })
  assert.equal(again.status, 409)
  await done(jamie, miguel)
})

async function cancelViaApi(page, id) {
  const r = await pageApi(page, origin, 'POST', `/leave/requests/${id}/cancel`)
  assert.equal(r.status, 200)
}
