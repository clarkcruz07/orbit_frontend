// REAL-BACKEND end-to-end suite for addendum 2: Directory, Search, Calendar, Notifications, My Profile.
// Starts the real backend (in-memory DB, demo auth, demo OCR, random port 8101-8199) plus the proxy that serves
// frontend/dist, and drives system Chrome as the six fictional demo people. Gated: RUN_BROWSER_TESTS=1.
// Never contacts anything outside 127.0.0.1; Gemini stays OFF.
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { launchBrowser } from './browser-env.mjs'
import { PEOPLE, startRealStack } from './real-backend.mjs'
import { actor, apiCall, apiCreate, apiDecide, apiLogin, pageApi, seedSubmitted, text } from './e2e-helpers.mjs'

const enabled = process.env.RUN_BROWSER_TESTS === '1'
const opts = { skip: enabled ? false : 'set RUN_BROWSER_TESTS=1 to run real-browser tests' }

let browser
let stack
let origin
const open = []

before(async () => {
  if (!enabled) return
  stack = await startRealStack()
  origin = stack.origin
  browser = await launchBrowser()
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

/** The month key of the given calendar month (1-12) that lies within +/-12 months of today (the server's rule). */
function nearestMonth(m) {
  const now = new Date()
  const here = now.getFullYear() * 12 + now.getMonth()
  let best = null
  for (const y of [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1]) {
    const diff = Math.abs(y * 12 + (m - 1) - here)
    if (diff <= 12 && (!best || diff < best.diff)) best = { key: `${y}-${String(m).padStart(2, '0')}`, diff }
  }
  return best.key
}

const INPUT = '[data-testid=search-input]'
const optionLabels = (page) => page.$$eval('[data-testid=search-option] .search-option-label', (els) => els.map((e) => e.textContent.trim()))
const until = async (fn, ms = 10000) => {
  const end = Date.now() + ms
  let last
  while (Date.now() < end) {
    last = await fn()
    if (last) return last
    await new Promise((r) => setTimeout(r, 150))
  }
  throw new Error('timed out waiting for condition')
}

// ------------------------------------------------------------------------------------------------ directory
test('E2E directory: every signed-in user sees the basic fields; HR-only fields and the filter exist only for Anna', opts, async () => {
  const jamie = await as(PEOPLE.jamie)
  const anna = await as(PEOPLE.anna)

  // Jamie (employee): table with basic columns, no HR columns, no employment filter, and the raw API has no HR keys.
  await jamie.page.goto(`${origin}/directory`)
  await jamie.page.waitForSelector('[data-testid=dir-row]')
  assert.match(await text(jamie.page, '[data-testid=dir-count]'), /Showing 1-14 of 14 people/)
  const heads = await jamie.page.$$eval('.dir-table thead th', (els) => els.map((e) => e.textContent.trim()))
  assert.deepEqual(heads, ['Name', 'Department', 'Email', 'Manager'])
  assert.equal(await jamie.page.locator('[data-testid=dir-type]').count(), 0)
  assert.equal(await jamie.page.locator('[data-testid=dir-hr-fields]').count(), 0)
  const jl = await pageApi(jamie.page, origin, 'GET', '/directory/employees?page_size=50')
  assert.equal(jl.status, 200)
  for (const item of jl.json.items) {
    for (const k of ['employment_type', 'start_date', 'status', 'birthday']) assert.ok(!(k in item), `${k} must not reach a non-HR caller (${item.name})`)
    assert.ok(item.employee_id && item.name && 'email' in item)
  }
  assert.equal((await pageApi(jamie.page, origin, 'GET', '/directory/employees?employment_type=intern')).status, 403)

  // Anna (HRAdmin): HR column and the employment-type filter, which really narrows the list.
  await anna.page.goto(`${origin}/directory`)
  await anna.page.waitForSelector('[data-testid=dir-row]')
  await anna.page.waitForSelector('[data-testid=dir-type]')
  const aheads = await anna.page.$$eval('.dir-table thead th', (els) => els.map((e) => e.textContent.trim()))
  assert.deepEqual(aheads, ['Name', 'Department', 'Email', 'Manager', 'Employment'])
  assert.ok((await anna.page.locator('[data-testid=dir-hr-fields]').count()) >= 14)
  await anna.page.selectOption('[data-testid=dir-type]', 'intern')
  await anna.page.waitForFunction(() => document.querySelectorAll('[data-testid=dir-row]').length === 1)
  assert.match(await text(anna.page, '[data-testid=dir-row]'), /Bea Flores/)
  const al = await pageApi(anna.page, origin, 'GET', '/directory/employees?page_size=50')
  assert.ok(al.json.items.every((i) => 'employment_type' in i && 'start_date' in i && 'status' in i))
  assert.ok(al.json.items.every((i) => !('birthday' in i)), 'birthdays are never in the directory payload')
  await done(jamie, anna)
})

test('E2E directory: search, department filter, pagination-free list, profile with manager and direct reports; unknown id is a clean 404', opts, async () => {
  const lia = await as(PEOPLE.lia)
  await lia.page.goto(`${origin}/directory`)
  await lia.page.waitForSelector('[data-testid=dir-row]')
  await lia.page.type('[data-testid=dir-search]', 'finance', { delay: 20 })
  await lia.page.waitForFunction(() => document.querySelectorAll('[data-testid=dir-row]').length >= 1 && document.querySelectorAll('[data-testid=dir-row]').length < 14)
  const names = await lia.page.$$eval('[data-testid=dir-row] [data-testid=dir-open]', (els) => els.map((e) => e.textContent.trim()))
  assert.ok(names.includes('Paolo Cruz') && names.includes('Dan Navarro'))
  await lia.page.click('[data-testid=dir-clear]')
  await lia.page.selectOption('[data-testid=dir-department]', 'Operations')
  await lia.page.waitForFunction(() => [...document.querySelectorAll('[data-testid=dir-row] td:nth-child(2)')].every((e) => e.textContent.trim() === 'Operations'))
  // Open Miguel: manager Elena, direct reports include Jamie; no HR facts for Lia.
  await lia.page.click('[data-testid=dir-open]:text-is("Miguel Santos")')
  await lia.page.waitForSelector('[data-testid=dir-profile]')
  const facts = await text(lia.page, '[data-testid=dir-facts]')
  assert.ok(facts.includes('Elena Marquez') && facts.includes('Operations Manager'), facts)
  assert.ok(!/Employment type|Start date/.test(facts))
  const reports = await lia.page.$$eval('[data-testid=dir-report] strong', (els) => els.map((e) => e.textContent.trim()))
  assert.ok(reports.includes('Jamie Dela Cruz'))
  await lia.page.click('[data-testid=dir-report]:has-text("Jamie Dela Cruz")')
  await lia.page.waitForSelector('[data-testid=dir-profile]')
  assert.match(await text(lia.page, 'h1'), /Jamie Dela Cruz/)
  assert.equal((await pageApi(lia.page, origin, 'GET', '/directory/employees/EMP-9999')).status, 404)
  await lia.page.goto(`${origin}/directory/EMP-9999`)
  await lia.page.waitForSelector('[data-testid=empty-state]')
  assert.match(await text(lia.page, '[data-testid=empty-state]'), /can't find that person/)
  await done(lia)
})

test('E2E my profile: real record, own birthday, sign-in source, manager and reports', opts, async () => {
  const miguel = await as(PEOPLE.miguel)
  await miguel.page.goto(`${origin}/my-profile`)
  await miguel.page.waitForSelector('[data-testid=profile-card]')
  assert.match(await text(miguel.page, '[data-testid=profile-card] h2'), /Miguel Santos/)
  const facts = (await text(miguel.page, '[data-testid=profile-facts]')).replace(/\n+/g, ' ')
  for (const s of ['Operations Manager', 'Operations', 'Elena Marquez', 'Full-time', '15 Jul 2019']) assert.ok(facts.includes(s), s)
  assert.match(await text(miguel.page, '[data-testid=profile-birthday]'), /2 Sep/)
  assert.match(await text(miguel.page, '[data-testid=profile-signin]'), /Local account/)
  assert.match(await text(miguel.page, '[data-testid=profile-roles]'), /Manager/)
  const reports = await miguel.page.$$eval('[data-testid=profile-reports] strong', (els) => els.map((e) => e.textContent.trim()))
  assert.ok(reports.includes('Jamie Dela Cruz') && reports.includes('Paolo Cruz'))
  assert.match(await text(miguel.page, '.app-content'), /Ask HR to change this/)
  await miguel.page.click('[data-testid=browse-directory]')
  await miguel.page.waitForURL('**/directory')
  await done(miguel)
})

// ------------------------------------------------------------------------------------------------ search
test('E2E search: finds people; finds only the requests the role may see (Lia cannot find Jamie\'s, Miguel and Anna can, drafts stay private)', opts, async () => {
  const purpose = 'Zebra offsite lunch'
  const id = await seedSubmitted(origin, PEOPLE.jamie, purpose)
  const jt = await apiLogin(origin, PEOPLE.jamie)
  const draftId = await apiCreate(origin, jt, 'Zebra private draft')

  const lia = await as(PEOPLE.lia)
  await lia.page.goto(`${origin}/`)
  await lia.page.waitForSelector('.topbar')
  await lia.page.click(INPUT)
  await lia.page.keyboard.type('zebra')
  await lia.page.waitForSelector('[data-testid=search-empty]')
  assert.equal(await lia.page.locator('[data-testid=search-group-requests]').count(), 0, "Lia must not find Jamie's request")
  // ...but she finds people, and the server never returned the request to her.
  const lr = await pageApi(lia.page, origin, 'GET', '/search?q=zebra')
  assert.deepEqual(lr.json.requests, [])
  await lia.page.fill(INPUT, '')
  await lia.page.keyboard.type('ramos')
  await lia.page.waitForSelector('[data-testid=search-group-people]')
  assert.ok((await optionLabels(lia.page)).includes('Lia Ramos'))
  await done(lia)

  const miguel = await as(PEOPLE.miguel)
  await miguel.page.goto(`${origin}/`)
  await miguel.page.waitForSelector('.topbar')
  await miguel.page.click(INPUT)
  await miguel.page.keyboard.type('zebra')
  await miguel.page.waitForSelector('[data-testid=search-group-requests]')
  const found = await miguel.page.$$eval('[data-testid=search-option][data-kind=request] .search-option-label', (els) => els.map((e) => e.textContent.trim()))
  assert.deepEqual(found, [purpose], "Miguel finds Jamie's submitted request but not the private draft")
  const mr = await pageApi(miguel.page, origin, 'GET', '/search?q=zebra')
  assert.deepEqual(mr.json.requests.map((r) => r.request_id), [id])
  assert.ok(!mr.json.requests.some((r) => r.request_id === draftId))
  await miguel.page.keyboard.press('ArrowDown')
  await miguel.page.keyboard.press('Enter')
  await miguel.page.waitForURL(`**/reimbursements/${id}`)
  await miguel.page.waitForSelector('[data-testid=reviewer-panel]')
  await done(miguel)

  const anna = await as(PEOPLE.anna)
  const ar = await pageApi(anna.page, origin, 'GET', '/search?q=zebra')
  assert.deepEqual(ar.json.requests.map((r) => r.request_id), [id], 'HR has read-only oversight of submitted requests, never drafts')
  const paolo = await as(PEOPLE.paolo)
  const pr = await pageApi(paolo.page, origin, 'GET', '/search?q=zebra')
  assert.deepEqual(pr.json.requests, [], 'Finance only sees requests that reached its stage')
  const jamie = await as(PEOPLE.jamie)
  const jr = await pageApi(jamie.page, origin, 'GET', '/search?q=zebra')
  assert.equal(jr.json.requests.length, 2, 'the owner finds both, including the draft')
  // Contract edges through the real server: too short / too long.
  assert.equal((await pageApi(jamie.page, origin, 'GET', '/search?q=a')).status, 400)
  assert.equal((await pageApi(jamie.page, origin, 'GET', `/search?q=${'x'.repeat(65)}`)).status, 400)
  await done(anna, paolo, jamie)
})

test('E2E search: groups and keyboard flow against the real server; Pages are client-side', opts, async () => {
  const paolo = await as(PEOPLE.paolo)
  await paolo.page.goto(`${origin}/`)
  await paolo.page.waitForSelector('.topbar')
  await paolo.page.click(INPUT)
  await paolo.page.keyboard.type('cal')
  await paolo.page.waitForFunction(() => document.querySelector('[data-testid=search-group-pages]'))
  assert.ok((await optionLabels(paolo.page)).includes('Company Calendar'))
  await paolo.page.keyboard.press('ArrowDown')
  await paolo.page.keyboard.press('Enter')
  await paolo.page.waitForURL('**/company-calendar')
  await paolo.page.click(INPUT)
  await paolo.page.keyboard.type('mendoza')
  await paolo.page.waitForSelector('[data-testid=search-group-people]')
  await paolo.page.keyboard.press('ArrowDown')
  await paolo.page.keyboard.press('Enter')
  await paolo.page.waitForSelector('[data-testid=dir-profile]')
  assert.match(await text(paolo.page, 'h1'), /Carla Mendoza/)
  await done(paolo)
})

// ------------------------------------------------------------------------------------------------ calendar
test('E2E calendar: holidays for everyone; birthdays are shared with everyone (only your own is flagged)', opts, async () => {
  const jamie = await as(PEOPLE.jamie) // birthday Jul 19
  const anna = await as(PEOPLE.anna)
  const july = nearestMonth(7)
  const january = nearestMonth(1) // Ria Villanueva Jan 8, New Year's Day
  // There is no built-in demo holiday list any more: HR adds the holiday this test looks for (409 = an earlier run already did).
  const hrToken = await apiLogin(origin, PEOPLE.anna)
  const added = await apiCall(origin, hrToken, 'POST', '/holidays', { name: "New Year's Day", type: 'public', month: 1, day: 1 })
  assert.ok([201, 409].includes(added.status), `holiday seeded (${added.status})`)

  await jamie.page.goto(`${origin}/company-calendar?month=${july}`)
  await jamie.page.waitForSelector('[data-testid=cal-cell]')
  assert.equal(await jamie.page.locator('[data-testid=cal-demo-notice]').count(), 0, 'no demo notice on the calendar')
  const own = jamie.page.locator(`[data-testid=cal-cell][data-date="${july}-19"] [data-testid=cal-chip]`)
  assert.equal(await own.getAttribute('data-kind'), 'own-birthday')
  assert.match(await own.innerText(), /Your birthday/)
  // Birthdays are shared with everyone: Jamie sees January's Ria too (as a plain birthday, not flagged as his own).
  await jamie.page.goto(`${origin}/company-calendar?month=${january}`)
  await jamie.page.waitForSelector('[data-testid=cal-cell]')
  assert.match(await text(jamie.page, `[data-testid=cal-cell][data-date="${january}-01"]`), /New Year's Day/)
  await jamie.page.waitForFunction(() => document.querySelector('[data-testid=cal-chip][data-kind=birthday]'))
  assert.match(await text(jamie.page, `[data-testid=cal-cell][data-date="${january}-08"]`), /Ria Villanueva - birthday/)
  assert.equal(await jamie.page.locator('[data-testid=cal-chip][data-kind=own-birthday]').count(), 0)
  const jm = await pageApi(jamie.page, origin, 'GET', `/calendar?month=${january}`)
  assert.ok(jm.json.events.some((e) => e.type === 'birthday' && e.title === 'Ria Villanueva' && e.own === false), 'the server shares colleagues birthdays with everyone')
  // Out-of-range months are refused by the server.
  const far = (await pageApi(jamie.page, origin, 'GET', '/calendar?month=2099-01')).status
  assert.equal(far, 400)

  await anna.page.goto(`${origin}/company-calendar?month=${january}`)
  await anna.page.waitForSelector('[data-testid=cal-cell]')
  await anna.page.waitForFunction(() => document.querySelector('[data-testid=cal-chip][data-kind=birthday]'))
  assert.match(await text(anna.page, `[data-testid=cal-cell][data-date="${january}-08"]`), /Ria Villanueva - birthday/)
  assert.ok(!(await anna.page.$$eval('[data-testid=cal-chip]', (els) => els.map((e) => e.textContent).join(' '))).match(/\b(19|20)\d{2}\b/), 'no birth year anywhere')

  // Prev / next / Today through the real API.
  await anna.page.click('[data-testid=cal-next]')
  await anna.page.waitForFunction((m) => document.querySelector('[data-testid=cal-month]')?.dataset.month !== m, january)
  await anna.page.click('[data-testid=cal-today]')
  await anna.page.waitForFunction(() => !new URL(location.href).searchParams.has('month'))
  await done(jamie, anna)
})

test('E2E dashboard: upcoming holidays and birthdays come from the real /calendar/upcoming', opts, async () => {
  const jamie = await as(PEOPLE.jamie)
  await jamie.page.goto(`${origin}/`)
  await jamie.page.waitForSelector('[data-testid=card-upcoming]')
  await jamie.page.waitForFunction(() => !document.querySelector('[data-testid=upcoming-loading]'))
  const up = await pageApi(jamie.page, origin, 'GET', '/calendar/upcoming?days=30')
  assert.equal(up.status, 200)
  assert.ok(!('demo' in up.json) && !('demo_notice' in up.json), 'no demo keys any more')
  assert.ok(up.json.birthdays.every((b) => typeof b.own === 'boolean' && b.title), 'birthdays are shared with everyone and flagged only when they are the callers own')
  assert.equal(await jamie.page.locator('[data-testid=card-upcoming] .holiday-list li').count(), up.json.holidays.length)
  assert.equal(await jamie.page.locator('[data-testid=card-upcoming] .birthday-list li').count(), up.json.birthdays.length)
  await done(jamie)
})

// ------------------------------------------------------------------------------------------------ notifications
test('E2E notifications: manager is told when Jamie submits; Jamie is told of the decision; click opens + marks read; mark all works', opts, async () => {
  const purpose = 'Bell test taxi fare'
  const id = await seedSubmitted(origin, PEOPLE.jamie, purpose)

  // Miguel (Jamie's manager) has an unread "awaiting your review" notification.
  const miguel = await as(PEOPLE.miguel)
  await miguel.page.goto(`${origin}/`)
  await miguel.page.waitForSelector('[data-testid=bell-dot]')
  const mn = await pageApi(miguel.page, origin, 'GET', '/notifications')
  assert.equal(mn.json.items.filter((n) => n.kind === 'reimbursement.review_needed' && n.link === `/reimbursements/${id}`).length, 1)
  assert.ok(!JSON.stringify(mn.json).match(/amount|total|receipt/i), 'notification text carries no amounts or receipt data')
  await miguel.page.click('[data-testid=bell]')
  await miguel.page.waitForSelector('[data-testid=bell-list]')
  const row = miguel.page.locator('[data-testid=bell-item]', { hasText: purpose })
  assert.match(await row.innerText(), /Jamie Dela Cruz submitted/)
  assert.match(await row.innerText(), /just now|minute/)
  assert.equal(await row.getAttribute('data-read'), 'false')
  await row.click()
  await miguel.page.waitForURL(`**/reimbursements/${id}`)
  await miguel.page.waitForSelector('[data-testid=reviewer-panel]')
  await until(async () => (await pageApi(miguel.page, origin, 'GET', '/notifications')).json.items.find((n) => n.link === `/reimbursements/${id}`)?.read === true)
  // (Earlier tests may have left other unread items for Miguel, so check this one notification, not the total.)

  // Jamie: the submission confirmation is there; Lia (other team) has nothing.
  const jamie = await as(PEOPLE.jamie)
  await jamie.page.goto(`${origin}/`)
  await jamie.page.waitForSelector('[data-testid=bell-dot]')
  const jn = await pageApi(jamie.page, origin, 'GET', '/notifications')
  assert.ok(jn.json.items.some((n) => n.kind === 'reimbursement.submitted' && n.link === `/reimbursements/${id}`))
  const lia = await as(PEOPLE.lia)
  await lia.page.goto(`${origin}/`)
  await lia.page.waitForSelector('[data-testid=bell]')
  assert.equal((await pageApi(lia.page, origin, 'GET', '/notifications')).json.unread_count, 0)
  assert.equal(await lia.page.locator('[data-testid=bell-dot]').count(), 0)
  await lia.page.click('[data-testid=bell]')
  await lia.page.waitForSelector('[data-testid=bell-empty]')

  // Miguel approves through the API; Jamie gets a decision notification (and Finance a review request).
  const mt = await apiLogin(origin, PEOPLE.miguel)
  assert.equal((await apiDecide(origin, mt, id, 'approve')).status, 200)
  await jamie.page.reload()
  await jamie.page.waitForSelector('[data-testid=bell-dot]')
  await jamie.page.click('[data-testid=bell]')
  await jamie.page.waitForSelector('[data-testid=bell-list]')
  const approved = jamie.page.locator('[data-testid=bell-item]', { hasText: 'Reimbursement approved' })
  assert.match(await approved.innerText(), /Miguel Santos approved/)
  const unreadBefore = Number(await jamie.page.getAttribute('[data-testid=bell]', 'data-unread'))
  assert.ok(unreadBefore >= 2)
  // "Mark all as read" clears the dot, persists on the server, and survives a reload.
  await jamie.page.click('[data-testid=mark-all-read]')
  await jamie.page.waitForFunction(() => !document.querySelector('[data-testid=bell-dot]'))
  await until(async () => (await pageApi(jamie.page, origin, 'GET', '/notifications')).json.unread_count === 0)
  await jamie.page.reload()
  await jamie.page.waitForSelector('[data-testid=bell]')
  await jamie.page.waitForTimeout(400)
  assert.equal(await jamie.page.locator('[data-testid=bell-dot]').count(), 0)

  const paolo = await as(PEOPLE.paolo)
  const pn = await pageApi(paolo.page, origin, 'GET', '/notifications')
  assert.equal(pn.json.items.filter((n) => n.kind === 'reimbursement.review_needed' && n.link === `/reimbursements/${id}`).length, 1, 'Finance is asked to review after the manager approves')
  await done(miguel, jamie, lia, paolo)
})

test('E2E notifications: marking one read is scoped to its owner (404 for someone else), and rejections reach the employee', opts, async () => {
  const id = await seedSubmitted(origin, PEOPLE.jamie, 'Scoped read check')
  const miguel = await as(PEOPLE.miguel)
  const lia = await as(PEOPLE.lia)
  const mn = (await pageApi(miguel.page, origin, 'GET', '/notifications')).json.items.find((n) => n.link === `/reimbursements/${id}`)
  assert.ok(mn)
  assert.equal((await pageApi(lia.page, origin, 'POST', `/notifications/${mn.notification_id}/read`)).status, 404, "Lia cannot touch Miguel's notification")
  assert.equal((await pageApi(miguel.page, origin, 'GET', '/notifications')).json.items.find((n) => n.notification_id === mn.notification_id).read, false)
  assert.equal((await pageApi(miguel.page, origin, 'POST', `/notifications/${mn.notification_id}/read`)).status, 204)
  const mt = await apiLogin(origin, PEOPLE.miguel)
  assert.equal((await apiDecide(origin, mt, id, 'reject', 'Not eligible')).status, 200)
  const jt = await apiLogin(origin, PEOPLE.jamie)
  const jn = await apiCall(origin, jt, 'GET', '/notifications')
  const rejected = jn.json.items.find((n) => n.kind === 'reimbursement.decided_rejected' && n.link === `/reimbursements/${id}`)
  assert.ok(rejected)
  assert.ok(!JSON.stringify(rejected).includes('Not eligible'), 'the reviewer comment is never copied into a notification')
  await done(miguel, lia)
})

test('E2E responsive smoke on a phone against the real server: search icon, bell and directory cards', opts, async () => {
  const miguel = await as(PEOPLE.miguel, { width: 390, height: 844 })
  await miguel.page.goto(`${origin}/directory`)
  await miguel.page.waitForSelector('[data-testid=dir-card]')
  assert.equal(await miguel.page.locator('[data-testid=dir-table]').isVisible(), false)
  await miguel.page.click('[data-testid=search-toggle]')
  await miguel.page.keyboard.type('paolo')
  await miguel.page.waitForSelector('[data-testid=search-option][data-kind=person]')
  await miguel.page.keyboard.press('Enter')
  await miguel.page.waitForSelector('[data-testid=dir-profile]')
  assert.ok(await miguel.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1))
  await done(miguel)
})
