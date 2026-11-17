// REAL-BACKEND end-to-end suite for Settings and the HR dashboard (always live data, no source switch).
// Starts the real backend (in-memory DB, demo auth, demo OCR, random port 8101-8199) plus the proxy that serves frontend/dist,
// and drives system Chrome as the six fictional demo people. Gated: RUN_BROWSER_TESTS=1. Never leaves 127.0.0.1; Gemini OFF.
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { launchBrowser } from './browser-env.mjs'
import { PEOPLE, startRealStack } from './real-backend.mjs'
import { actor, apiCall, apiLogin, pageApi, seedSubmitted, text } from './e2e-helpers.mjs'

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
const until = async (fn, ms = 10000) => {
  const end = Date.now() + ms
  let last
  while (Date.now() < end) {
    last = await fn()
    if (last) return last
    await new Promise((r) => setTimeout(r, 120))
  }
  throw new Error('timed out waiting for condition')
}
const tabsOf = (page) => page.$$eval('[data-testid=settings-tabs] [role=tab]', (els) => els.map((e) => e.textContent.trim()))
const notifications = async (email) => (await apiCall(origin, await apiLogin(origin, email), 'GET', '/notifications?limit=50')).json

// ------------------------------------------------------------------------------------------------ permissions
test('E2E settings: Employee, Manager and Finance see no HR tabs and every HR route answers 403 (including writes)', opts, async () => {
  for (const email of [PEOPLE.jamie, PEOPLE.miguel, PEOPLE.paolo]) {
    const a = await as(email)
    await a.page.goto(`${origin}/settings`)
    await a.page.waitForSelector('[data-testid=pref-switch-leave]')
    assert.deepEqual(await tabsOf(a.page), ['My preferences', 'Account'], email)
    // Forced HR links fall back to My preferences.
    for (const tab of ['hr', 'users', 'catalogs']) {
      await a.page.goto(`${origin}/settings?tab=${tab}`)
      await a.page.waitForSelector('[data-testid=pref-switch-leave]')
      assert.deepEqual(await tabsOf(a.page), ['My preferences', 'Account'])
    }
    // The server is the control: direct calls with this person's own session.
    for (const [method, path, body] of [
      ['GET', '/settings'],
      ['GET', '/settings/overview'],
      ['GET', '/settings/users'],
      ['PUT', '/settings', { hr_can_see_mood: true }],
      ['GET', '/hr/dashboard'],
    ]) {
      const r = await pageApi(a.page, origin, method, path, body)
      assert.equal(r.status, 403, `${email} ${method} ${path}`)
    }
    assert.equal((await pageApi(a.page, origin, 'GET', '/preferences/me')).status, 200)
    // And nothing changed.
    const anna = await apiLogin(origin, PEOPLE.anna)
    const s = (await apiCall(origin, anna, 'GET', '/settings')).json
    assert.equal(s.hr_can_see_mood, false)
    assert.ok(!('dashboard_source' in s), 'the data-source setting is gone')
    // The old HR address lands on the personal dashboard: never the HR dashboard, never a switch.
    await a.page.goto(`${origin}/hr-administration`)
    await a.page.waitForSelector('[data-testid=home-my-reimbursements]')
    assert.equal(new URL(a.page.url()).pathname, '/')
    assert.equal(await a.page.locator('[data-testid=sum-headcount], [data-testid=source-switch]').count(), 0)
    await done(a)
  }
})

// ------------------------------------------------------------------------------------------------ notifications
test('E2E settings: an employee switches Reimbursements off; the action that would notify them creates no bell item, while others still get theirs', opts, async () => {
  const lia = await as(PEOPLE.lia)
  const jamie = await as(PEOPLE.jamie)
  const miguel = await as(PEOPLE.miguel)

  // Control: Lia (nothing switched off) submits and is told, and so is her manager.
  const liaId = await seedSubmitted(origin, PEOPLE.lia, 'Settings E2E control claim')
  const liaNotes = await notifications(PEOPLE.lia)
  assert.ok(liaNotes.items.some((n) => n.link === `/reimbursements/${liaId}`), 'Lia gets her confirmation')

  // Jamie turns the group off through the real UI.
  await jamie.page.goto(`${origin}/settings`)
  await jamie.page.waitForSelector('[data-testid=pref-switch-reimbursements]')
  assert.equal(await jamie.page.getAttribute('[data-testid=pref-switch-reimbursements]', 'aria-checked'), 'true')
  await jamie.page.click('[data-testid=pref-switch-reimbursements]')
  await jamie.page.waitForFunction(() => /Reimbursements notifications are off\./.test(document.querySelector('[data-testid=prefs-status]')?.textContent || ''))
  const saved = (await pageApi(jamie.page, origin, 'GET', '/preferences/me')).json
  assert.equal(saved.groups.reimbursements, false)
  assert.equal(saved.groups.leave, true, 'other groups untouched')
  assert.ok(saved.updated_at)

  // The action that would notify him: Jamie submits a claim. He gets NOTHING; his manager still does.
  const before = (await notifications(PEOPLE.jamie)).items.length
  const id = await seedSubmitted(origin, PEOPLE.jamie, 'Settings E2E claim with switch off')
  const jamieNotes = await notifications(PEOPLE.jamie)
  assert.equal(jamieNotes.items.length, before)
  assert.ok(!jamieNotes.items.some((n) => n.link === `/reimbursements/${id}`), 'no confirmation for the person who switched the group off')
  const miguelNotes = await until(async () => {
    const n = await notifications(PEOPLE.miguel)
    return n.items.some((x) => x.link === `/reimbursements/${id}`) ? n : null
  })
  assert.ok(miguelNotes.unread_count >= 1)

  // In the browser: Jamie's bell stays quiet, Miguel's shows the item.
  await jamie.page.goto(`${origin}/`)
  await jamie.page.waitForSelector('.app-content')
  assert.equal(await jamie.page.locator('[data-testid=bell-dot]').count(), 0)
  await jamie.page.click('[data-testid=bell]')
  await jamie.page.waitForSelector('[data-testid=bell-empty]')
  await miguel.page.goto(`${origin}/`)
  await miguel.page.waitForSelector('[data-testid=bell-dot]')
  await miguel.page.click('[data-testid=bell]')
  await miguel.page.waitForSelector('[data-testid=bell-item]')
  assert.match(await text(miguel.page, '[data-testid=bell-list]'), /Settings E2E claim with switch off/)

  // Switch it back on: the next event reaches him (nothing is back-filled for the one he missed).
  await jamie.page.goto(`${origin}/settings`)
  await jamie.page.waitForSelector('[data-testid=pref-switch-reimbursements]')
  assert.equal(await jamie.page.getAttribute('[data-testid=pref-switch-reimbursements]', 'aria-checked'), 'false', 'the choice persisted')
  await jamie.page.click('[data-testid=pref-switch-reimbursements]')
  await jamie.page.waitForFunction(() => /Reimbursements notifications are on\./.test(document.querySelector('[data-testid=prefs-status]')?.textContent || ''))
  const id2 = await seedSubmitted(origin, PEOPLE.jamie, 'Settings E2E claim with switch on')
  const after = await notifications(PEOPLE.jamie)
  assert.ok(after.items.some((n) => n.link === `/reimbursements/${id2}`))
  assert.ok(!after.items.some((n) => n.link === `/reimbursements/${id}`), 'the missed one is not back-filled')
  await done(lia, jamie, miguel)
})

// ------------------------------------------------------------------------------------------------ HR: tabs, users, catalogs
test('E2E settings: HR sees HR settings, the read-only users table, the catalog index and the company time zone', opts, async () => {
  const anna = await as(PEOPLE.anna)
  await anna.page.goto(`${origin}/settings`)
  await anna.page.waitForFunction(() => document.querySelectorAll('[data-testid=settings-tabs] [role=tab]').length === 5)
  assert.deepEqual(await tabsOf(anna.page), ['My preferences', 'Account', 'HR settings', 'Users and roles', 'Catalogs'])

  // Account: facts, source and the time zone (HR only).
  await anna.page.click('[data-testid=settings-tab-account]')
  await anna.page.waitForSelector('[data-testid=fact-timezone]')
  assert.match(await text(anna.page, '[data-testid=fact-timezone]'), /Asia\/Manila/)
  assert.match(await text(anna.page, '[data-testid=fact-name]'), /Anna Reyes/)
  assert.match(await text(anna.page, '[data-testid=fact-source]'), /Local account/)

  // Users and roles: real accounts, read-only, with the statement about configuration.
  await anna.page.click('[data-testid=settings-tab-users]')
  await anna.page.waitForSelector('[data-testid=user-row]')
  const api = (await pageApi(anna.page, origin, 'GET', '/settings/users?page_size=50')).json
  assert.equal(api.roles_editable, false)
  assert.ok(api.total >= 6)
  await anna.page.waitForFunction((n) => new RegExp(`of ${n} people`).test(document.querySelector('[data-testid=users-count]')?.textContent || ''), api.total)
  const body = await text(anna.page, '[data-testid=users-table]')
  for (const name of ['Anna Reyes', 'Miguel Santos', 'Carla Mendoza', 'Paolo Cruz', 'Jamie Dela Cruz', 'Lia Ramos']) assert.ok(body.includes(name), name)
  assert.ok(body.includes('HR Administrator') && body.includes('Finance') && body.includes('Local account'))
  assert.match(await text(anna.page, '[data-testid=roles-note]'), /set by HR on the People pages.*no role edit control/)
  assert.equal(await anna.page.locator('[data-testid=users-table] input, [data-testid=users-table] select, [data-testid=users-table] button').count(), 0)
  await anna.page.fill('[data-testid=users-search]', 'jamie')
  await anna.page.waitForFunction(() => document.querySelectorAll('[data-testid=user-row]').length === 1)
  assert.match(await text(anna.page, '[data-testid=user-row]'), /Jamie Dela Cruz/)
  // A regex-looking search is literal.
  await anna.page.fill('[data-testid=users-search]', '.*')
  await anna.page.waitForSelector('[data-testid=empty-state]')
  // No endpoint edits users or roles.
  for (const [method, path] of [['PUT', '/settings/users'], ['POST', '/settings/users'], ['PATCH', '/settings/users'], ['DELETE', '/settings/users']]) {
    const r = await pageApi(anna.page, origin, method, path, method === 'DELETE' ? undefined : { roles: ['HRAdmin'] })
    assert.ok([404, 405].includes(r.status), `${method} ${path} -> ${r.status}`)
  }

  // Catalogs: real links.
  await anna.page.click('[data-testid=settings-tab-catalogs]')
  await anna.page.waitForSelector('[data-testid=catalogs-list]')
  const links = await anna.page.$$eval('[data-testid^=catalog-link-]', (els) => els.map((e) => e.getAttribute('href')))
  assert.deepEqual(links, ['/leave?tab=settings', '/attendance?tab=hr', '/documents?tab=hr&section=types', '/learning?tab=hr&section=courses', '/hr-requests', '/settings/holidays', '/people', '/knowledge-base'])
  // Each module page behind those links opens for HR (not the "coming soon" page, not a 404).
  for (const href of links) {
    await anna.page.goto(`${origin}${href}`)
    await anna.page.waitForSelector('.app-content h1')
    const t = await text(anna.page, '.app-content')
    assert.ok(!/is coming soon/.test(t), `${href} is a real page`)
    assert.ok(!/Page not found|doesn't exist/i.test(t), `${href} exists`)
  }
  await done(anna)
})

// ------------------------------------------------------------------------------------------------ HR: mood + dashboard
test('E2E settings: the mood switch persists (UI, reload and API agree), and is restored', opts, async () => {
  const anna = await as(PEOPLE.anna)
  await anna.page.goto(`${origin}/settings?tab=hr`)
  await anna.page.waitForSelector('[data-testid=mood-switch]')
  assert.equal(await anna.page.getAttribute('[data-testid=mood-switch]', 'aria-checked'), 'false')
  assert.match(await text(anna.page, '[data-testid=mood-changed]'), /Default in force/)
  await anna.page.click('[data-testid=mood-switch]')
  await anna.page.waitForFunction(() => /can now see check-in mood/.test(document.querySelector('[data-testid=mood-status]')?.textContent || ''))
  assert.equal((await pageApi(anna.page, origin, 'GET', '/settings')).json.hr_can_see_mood, true)
  await anna.page.reload()
  await anna.page.waitForSelector('[data-testid=mood-switch]')
  assert.equal(await anna.page.getAttribute('[data-testid=mood-switch]', 'aria-checked'), 'true')
  assert.match(await text(anna.page, '[data-testid=mood-changed]'), /Last changed/)
  // Another HR session (fresh login through the API) sees the same value.
  const token = await apiLogin(origin, PEOPLE.anna)
  assert.equal((await apiCall(origin, token, 'GET', '/settings')).json.hr_can_see_mood, true)
  // Restore.
  await anna.page.click('[data-testid=mood-switch]')
  await anna.page.waitForFunction(() => /can no longer see check-in mood/.test(document.querySelector('[data-testid=mood-status]')?.textContent || ''))
  assert.equal((await pageApi(anna.page, origin, 'GET', '/settings')).json.hr_can_see_mood, false)
  await done(anna)
})

test('E2E settings: the HR dashboard is computed from live data (numbers, onboarding/offboarding "Not tracked yet"), with no demo ribbon and no source switch', opts, async () => {
  const anna = await as(PEOPLE.anna)
  await anna.page.goto(`${origin}/hr-administration`)
  await anna.page.waitForSelector('[data-testid=card-upcoming]')
  assert.equal(new URL(anna.page.url()).pathname, '/', 'the old address lands on the Dashboard')
  assert.equal(await anna.page.locator('[data-testid=demo-ribbon], [data-testid=live-ribbon], [data-testid=hr-source], [data-testid=source-switch]').count(), 0)
  assert.ok(!(await text(anna.page, '.hr-page')).includes('Fictional demo data'))
  const live = (await pageApi(anna.page, origin, 'GET', '/hr/dashboard')).json
  assert.ok(!('source' in live) && !('demo' in live) && !('demo_notice' in live), 'the payload carries no demo/source keys')
  const headcount = live.summary.headcount.value
  assert.ok(headcount >= 6, 'real employees are counted')
  const sums = await text(anna.page, '[data-testid=summary-cards]')
  assert.ok(sums.includes(String(headcount)) && !sums.includes('1,248'), sums)
  // Onboarding / offboarding are not tracked by any module: honest cards with the server's reason, no numbers.
  for (const id of ['sum-onboarding', 'sum-offboarding', 'card-onboarding', 'card-offboarding']) {
    const t = await text(anna.page, `[data-testid=${id}]`)
    assert.match(t, /Not tracked yet/, id)
    assert.match(t, new RegExp(live.onboarding.reason.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), id)
  }
  assert.ok((await text(anna.page, '[data-testid=card-directory]')).includes(String(live.directory.total)))
  assert.ok(!/NaN|undefined|null/.test(await text(anna.page, '.hr-page')))
  // The clock card sits on top.
  assert.equal(await anna.page.locator('[data-testid=clock-card]').count(), 1)
  // Settings has no data-source panel any more.
  await anna.page.goto(`${origin}/settings?tab=hr`)
  await anna.page.waitForSelector('[data-testid=mood-switch]')
  assert.equal(await anna.page.locator('[data-testid=settings-source-switch]').count(), 0)
  assert.equal((await pageApi(anna.page, origin, 'GET', '/hr/dashboard/source')).status, 404, 'the source endpoint is gone')
  await done(anna)
})

test('E2E settings: Settings and the dashboard fit on a phone (no sideways scroll)', opts, async () => {
  const anna = await as(PEOPLE.anna, { width: 390, height: 800 })
  const fits = () => anna.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)
  for (const tab of ['', '?tab=account', '?tab=hr', '?tab=users', '?tab=catalogs']) {
    await anna.page.goto(`${origin}/settings${tab}`)
    await anna.page.waitForSelector('[data-testid=settings-page]')
    await anna.page.waitForFunction(() => document.querySelectorAll('[data-testid=settings-tabs] [role=tab]').length === 5)
    await anna.page.waitForTimeout(300)
    assert.ok(await fits(), `settings ${tab || 'preferences'} overflows at 390`)
  }
  await anna.page.goto(`${origin}/`)
  await anna.page.waitForSelector('[data-testid=card-upcoming]')
  await anna.page.waitForTimeout(400)
  assert.ok(await fits(), 'dashboard overflows at 390')
  await done(anna)
})
