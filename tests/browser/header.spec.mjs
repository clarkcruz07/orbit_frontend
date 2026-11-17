// Mock-API browser tests (addendum 2): header search combobox, notification bell, mobile search, nav drawer a11y.
// Gated: RUN_BROWSER_TESTS=1 (use `npm run test:browser`).
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { ANNA, BEN, CARLA, enabled, launchBrowser, minutesAgo, noOverflow, opts, text, until, visit, withMockApp } from './mock-helpers.mjs'
import { addNotification } from './mock-new-endpoints.mjs'
import { makeRequest } from './mock-reimbursements.mjs'

let browser
before(async () => {
  if (enabled) browser = await launchBrowser()
})
after(async () => {
  await browser?.close()
})
const app = (fn, o) => withMockApp(browser, fn, o)

const INPUT = '[data-testid=search-input]'
const PANEL = '[data-testid=search-panel]'
const optionLabels = (page) => page.$$eval('[data-testid=search-option] .search-option-label', (els) => els.map((e) => e.textContent.trim()))
const groupIds = (page) => page.$$eval('[role=group]', (els) => els.map((e) => e.dataset.testid.replace('search-group-', '')))

function seedRequests(mock) {
  // Carla's own submitted request, and Carla's private draft (never visible to anyone else).
  const submitted = makeRequest({ purpose: 'Client lunch with Ben', status: 'pending_manager', stage: 'manager', allowed: { 'u-ben': ['approve', 'reject', 'clarify'] } })
  const draft = makeRequest({ purpose: 'Client lunch draft only for me', status: 'draft' })
  mock.state.reimb.requests.push(submitted, draft)
  return { submitted, draft }
}

// ------------------------------------------------------------------------------------------------ search
test('search: needs 2 characters, shows a hint for one, then People and Pages groups; opens a person on Enter', opts, () =>
  app(async ({ page, mock, errors }) => {
    await visit(page, mock, '/', '.topbar')
    await page.click(INPUT)
    await page.keyboard.type('b')
    await page.waitForSelector('[data-testid=search-hint]')
    assert.match(await text(page, '[data-testid=search-hint]'), /at least 2 characters/)
    assert.equal(mock.state.newApi.searchCalls.length, 0, 'no request for a 1-character query')
    await page.keyboard.type('en')
    await page.waitForSelector('[data-testid=search-group-people]')
    assert.deepEqual(await groupIds(page), ['people'])
    assert.deepEqual(await optionLabels(page), ['Ben Cruz'])
    assert.equal(await page.getAttribute(INPUT, 'aria-expanded'), 'true')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await page.waitForURL('**/directory/EMP-0002')
    assert.equal(await page.inputValue(INPUT), '', 'the box is cleared after opening a result')
    assert.equal(await page.locator(PANEL).count(), 0)
    assert.deepEqual(errors, [])
  }, { signInAs: CARLA }))

test('search: ARIA combobox wiring, arrow keys wrap, aria-activedescendant follows, Escape closes then clears', opts, () =>
  app(async ({ page, mock }) => {
    await visit(page, mock, '/', '.topbar')
    assert.equal(await page.getAttribute(INPUT, 'role'), 'combobox')
    assert.equal(await page.getAttribute(INPUT, 'aria-autocomplete'), 'list')
    await page.click(INPUT)
    await page.keyboard.type('an')
    await page.waitForSelector('[data-testid=search-option]')
    const count = await page.locator('[data-testid=search-option]').count()
    assert.ok(count >= 2, `expected several options for "an", got ${count}`)
    const listId = await page.getAttribute(INPUT, 'aria-controls')
    assert.equal(await page.getAttribute(`[id="${listId}"]`, 'role'), 'listbox')
    assert.equal(await page.getAttribute(INPUT, 'aria-activedescendant'), null)
    const activeId = () => page.getAttribute(INPUT, 'aria-activedescendant')
    const selectedIds = () => page.$$eval('[role=option][aria-selected=true]', (els) => els.map((e) => e.id))
    await page.keyboard.press('ArrowDown')
    const first = await activeId()
    assert.deepEqual(await selectedIds(), [first])
    await page.keyboard.press('ArrowDown')
    assert.notEqual(await activeId(), first)
    await page.keyboard.press('ArrowUp')
    assert.equal(await activeId(), first)
    await page.keyboard.press('ArrowUp') // wraps to the last option
    const last = await activeId()
    assert.equal(await page.$$eval('[role=option]', (els, id) => els.findIndex((e) => e.id === id), last), count - 1)
    await page.keyboard.press('ArrowDown') // and back to the first
    assert.equal(await activeId(), first)
    await page.keyboard.press('Escape')
    assert.equal(await page.locator(PANEL).count(), 0, 'first Escape closes the popup')
    assert.equal(await page.inputValue(INPUT), 'an', 'and keeps the text')
    assert.equal(await page.getAttribute(INPUT, 'aria-expanded'), 'false')
    await page.keyboard.press('Escape')
    assert.equal(await page.inputValue(INPUT), '', 'second Escape clears')
  }, { signInAs: CARLA }))

test('search: Pages are filtered on the client and open the target; groups are ordered People / Requests / Pages', opts, () =>
  app(async ({ page, mock }) => {
    seedRequests(mock)
    await visit(page, mock, '/', '.topbar')
    await page.click(INPUT)
    await page.keyboard.type('cal')
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=search-option][data-kind=page]').length > 0)
    assert.ok((await optionLabels(page)).includes('Company Calendar'))
    await page.click('[data-testid=search-option][data-kind=page]')
    await page.waitForURL('**/company-calendar')
    // A query that matches a person, a request and a page: all three groups, in order.
    await page.click(INPUT)
    await page.keyboard.type('client')
    await page.waitForSelector('[data-testid=search-group-requests]')
    assert.deepEqual((await groupIds(page)).filter((g) => g !== 'pages'), ['requests'])
    await page.fill(INPUT, '')
    await page.keyboard.type('re')
    await page.waitForSelector('[data-testid=search-group-people]')
    const order = await groupIds(page)
    assert.deepEqual(order, ['people', 'requests', 'pages'].filter((g) => order.includes(g)))
    assert.ok(order.includes('people') && order.includes('pages'))
  }, { signInAs: CARLA }))

test('search: requests are the ones the server allows - the manager finds the submitted one, nobody else sees the draft', opts, () =>
  app(async ({ page, mock }) => {
    const { submitted } = seedRequests(mock)
    await visit(page, mock, '/', '.topbar')
    await page.click(INPUT)
    await page.keyboard.type('lunch')
    await page.waitForSelector('[data-testid=search-group-requests]')
    assert.deepEqual(await page.$$eval('[data-testid=search-option][data-kind=request] .search-option-label', (els) => els.map((e) => e.textContent.trim())).then((l) => l.sort()), ['Client lunch draft only for me', 'Client lunch with Ben'])
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await page.waitForURL(`**/reimbursements/${submitted.request_id}`)
  }, { signInAs: CARLA }))

test('search: another user only gets the requests they may see', opts, () =>
  app(async ({ page, mock }) => {
    seedRequests(mock)
    await visit(page, mock, '/', '.topbar')
    await page.click(INPUT)
    await page.keyboard.type('lunch')
    await page.waitForSelector('[data-testid=search-group-requests]')
    assert.deepEqual(await page.$$eval('[data-testid=search-option][data-kind=request] .search-option-label', (els) => els.map((e) => e.textContent.trim())), ['Client lunch with Ben'])
  }, { signInAs: BEN }))

test('search: debounced (one request for fast typing) and shows no-results; Enter with nothing highlighted opens the first result', opts, () =>
  app(async ({ page, mock }) => {
    await visit(page, mock, '/', '.topbar')
    await page.click(INPUT)
    await page.keyboard.type('ocampo', { delay: 30 })
    await page.waitForSelector('[data-testid=search-group-people]')
    assert.equal(mock.state.newApi.searchCalls.length, 1)
    assert.deepEqual(mock.state.newApi.searchCalls, ['ocampo'])
    await page.keyboard.press('Enter')
    await page.waitForURL('**/directory/EMP-0004')
    await page.click(INPUT)
    await page.keyboard.type('zzqqxx')
    await page.waitForSelector('[data-testid=search-empty]')
    assert.match(await text(page, '[data-testid=search-empty]'), /No results for "zzqqxx"/)
    assert.equal(await page.getAttribute(INPUT, 'aria-expanded'), 'false')
  }, { signInAs: CARLA }))

test('search: loading indicator while the server answers; stale answers never replace newer ones', opts, () =>
  app(async ({ page, mock }) => {
    await visit(page, mock, '/', '.topbar')
    mock.state.newApi.searchDelayMs = 600
    await page.click(INPUT)
    await page.keyboard.type('ben')
    await page.waitForSelector('[data-testid=search-loading]')
    mock.state.newApi.searchDelayMs = 0
    await page.keyboard.type('x') // "benx": a newer query, answered first
    await page.waitForSelector('[data-testid=search-empty]')
    await page.waitForTimeout(900)
    assert.equal(await page.locator('[data-testid=search-option][data-kind=person]').count(), 0, 'the old "ben" answer was dropped')
  }, { signInAs: CARLA }))

test('search: 429 and server errors are polite, never raw; typing again recovers', opts, () =>
  app(async ({ page, mock }) => {
    await visit(page, mock, '/', '.topbar')
    mock.state.newApi.forceStatus.search = 429
    await page.click(INPUT)
    await page.keyboard.type('ben')
    await page.waitForSelector('[data-testid=search-error]')
    assert.match(await text(page, '[data-testid=search-error]'), /searching too fast/)
    assert.ok(!(await text(page, PANEL)).includes('Too many requests'), 'the raw server detail is never shown')
    mock.state.newApi.forceStatus.search = 500
    await page.keyboard.type('c')
    await page.waitForFunction(() => /unavailable/.test(document.querySelector('[data-testid=search-error]')?.textContent || ''))
    delete mock.state.newApi.forceStatus.search
    await page.keyboard.press('Backspace')
    await page.waitForSelector('[data-testid=search-option][data-kind=person]')
    mock.state.newApi.forceStatus.search = 400
    await page.keyboard.type('zz')
    await page.waitForFunction(() => /between 2 and 64/.test(document.querySelector('[data-testid=search-error]')?.textContent || ''))
  }, { signInAs: CARLA }))

test('search: over-long input is not sent', opts, () =>
  app(async ({ page, mock }) => {
    await visit(page, mock, '/', '.topbar')
    await page.click(INPUT)
    await page.fill(INPUT, 'a'.repeat(65))
    await page.waitForSelector('[data-testid=search-hint]')
    assert.match(await text(page, '[data-testid=search-hint]'), /limited to 64/)
    await page.waitForTimeout(400)
    assert.equal(mock.state.newApi.searchCalls.length, 0)
  }, { signInAs: CARLA }))

test('search on a phone: icon expands to a full-width field, closes again, works with the keyboard', opts, () =>
  app(async ({ page, mock }) => {
    await visit(page, mock, '/', '.topbar')
    assert.equal(await page.locator('[data-testid=search-field]').isVisible(), false)
    const toggle = page.locator('[data-testid=search-toggle]')
    const box = await toggle.boundingBox()
    assert.ok(box.width >= 43.5 && box.height >= 43.5, `search icon is ${box.width}x${box.height}`)
    await toggle.click()
    await page.waitForSelector('[data-testid=search-field]', { state: 'visible' })
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-testid')), 'search-input')
    const field = await page.locator('[data-testid=search-field]').boundingBox()
    assert.ok(field.width >= 390 - 40, `field is ${field.width}px wide`)
    assert.equal(await page.locator('.topbar-menu').isVisible(), false, 'the rest of the header yields')
    await page.keyboard.type('ben')
    await page.waitForSelector('[data-testid=search-option]')
    const panel = await page.locator(PANEL).boundingBox()
    assert.ok(panel.x >= 0 && panel.x + panel.width <= 390, 'results fit the screen')
    assert.ok(await noOverflow(page))
    await page.click('[data-testid=search-option]')
    await page.waitForURL('**/directory/EMP-0002')
    assert.equal(await page.locator('[data-testid=search-field]').isVisible(), false, 'collapses after opening a result')
    assert.equal(await page.locator('.topbar-menu').isVisible(), true)
    await page.click('[data-testid=search-toggle]')
    await page.click('[data-testid=search-close]')
    assert.equal(await page.locator('[data-testid=search-field]').isVisible(), false)
    await page.click('[data-testid=search-toggle]')
    await page.keyboard.press('Escape')
    assert.equal(await page.locator('[data-testid=search-field]').isVisible(), false, 'Escape on an empty field collapses it')
  }, { signInAs: CARLA, viewport: { width: 390, height: 844 } }))

test('search works at 320px', opts, () =>
  app(async ({ page, mock }) => {
    await visit(page, mock, '/', '.topbar')
    await page.click('[data-testid=search-toggle]')
    await page.keyboard.type('ocampo')
    await page.waitForSelector('[data-testid=search-option]')
    const panel = await page.locator(PANEL).boundingBox()
    assert.ok(panel.x >= 0 && panel.x + panel.width <= 320)
    assert.ok(await noOverflow(page))
  }, { signInAs: CARLA, viewport: { width: 320, height: 640 } }))

// ------------------------------------------------------------------------------------------------ bell
const BELL = '[data-testid=bell]'

test('bell: no dot and an honest empty state when nothing has arrived', opts, () =>
  app(async ({ page, mock, errors }) => {
    await visit(page, mock, '/', '.topbar')
    await page.waitForFunction(() => document.querySelector('[data-testid=bell]'))
    assert.equal(await page.locator('[data-testid=bell-dot]').count(), 0)
    assert.equal(await page.getAttribute(BELL, 'aria-label'), 'Notifications')
    await page.click(BELL)
    await page.waitForSelector('[data-testid=bell-empty]')
    assert.match(await text(page, '[data-testid=bell-popover]'), /all caught up/)
    assert.equal(await page.locator('[data-testid=mark-all-read]').count(), 0, 'nothing to mark')
    await page.keyboard.press('Escape')
    assert.equal(await page.locator('[data-testid=bell-popover]').count(), 0)
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-testid')), 'bell', 'focus returns to the bell')
    assert.deepEqual(errors, [])
  }, { signInAs: CARLA }))

test('bell: unread dot only when unread > 0; list with relative times; click opens the link and marks it read', opts, () =>
  app(async ({ page, mock }) => {
    const n1 = addNotification(mock.state, 'u-ben', { title: 'Review needed', body: 'Client lunch from Carla Dizon is waiting for your decision.', link: '/reimbursements', created_at: minutesAgo(5) })
    const n2 = addNotification(mock.state, 'u-ben', { title: 'Approved', body: 'Taxi was approved.', kind: 'reimbursement.decided_approved', link: '/leave', created_at: minutesAgo(180) })
    addNotification(mock.state, 'u-ben', { title: 'Already seen', body: 'Old news', link: null, created_at: minutesAgo(60 * 50), read: true })
    await visit(page, mock, '/', '.topbar')
    await page.waitForSelector('[data-testid=bell-dot]')
    assert.equal(await page.getAttribute(BELL, 'data-unread'), '2')
    assert.equal(await page.getAttribute(BELL, 'aria-label'), 'Notifications, 2 unread')
    await page.click(BELL)
    await page.waitForSelector('[data-testid=bell-list]')
    const rows = await page.$$eval('[data-testid=bell-item]', (els) => els.map((e) => ({ read: e.dataset.read, t: e.textContent })))
    assert.equal(rows.length, 3)
    assert.deepEqual(rows.map((r) => r.read), ['false', 'false', 'true'], 'newest first, unread flagged')
    assert.match(rows[0].t, /Review needed/)
    assert.match(rows[0].t, /5 minutes ago/)
    assert.match(rows[1].t, /3 hours ago/)
    assert.match(rows[2].t, /2 days ago/)
    // Click the first: opens its link, marks it read (server saw the call), the dot count drops to 1 and the popover closes.
    await page.click('[data-testid=bell-item] >> nth=0')
    await page.waitForURL('**/reimbursements')
    await page.waitForFunction(() => document.querySelector('[data-testid=bell]')?.dataset.unread === '1')
    await until(() => mock.state.newApi.readCalls.length === 1)
    assert.deepEqual(mock.state.newApi.readCalls, [n1.notification_id])
    assert.equal(await page.locator('[data-testid=bell-popover]').count(), 0)
    // Mark all as read: dot disappears, server told once.
    await page.click(BELL)
    await page.click('[data-testid=mark-all-read]')
    await page.waitForFunction(() => !document.querySelector('[data-testid=bell-dot]'))
    await until(() => mock.state.newApi.readAllCalls === 1)
    assert.equal(mock.state.newApi.readAllCalls, 1)
    assert.ok(mock.state.newApi.notifications['u-ben'].every((n) => n.read))
    assert.equal(await page.locator('[data-testid=mark-all-read]').count(), 0)
    assert.equal(await page.getAttribute(BELL, 'aria-label'), 'Notifications')
    // The reload agrees with the server.
    await page.reload()
    await page.waitForSelector('.topbar')
    await page.waitForTimeout(300)
    assert.equal(await page.locator('[data-testid=bell-dot]').count(), 0)
    assert.ok(n2.read)
  }, { signInAs: BEN }))

test('bell: a notification without a link is marked read but goes nowhere', opts, () =>
  app(async ({ page, mock }) => {
    const n = addNotification(mock.state, 'u-carla', { title: 'FYI', body: 'No page for this one', link: null, created_at: minutesAgo(1) })
    await visit(page, mock, '/', '.topbar')
    await page.waitForSelector('[data-testid=bell-dot]')
    await page.click(BELL)
    await page.click('[data-testid=bell-item]')
    await page.waitForFunction(() => !document.querySelector('[data-testid=bell-dot]'))
    await until(() => mock.state.newApi.readCalls.length === 1)
    assert.deepEqual(mock.state.newApi.readCalls, [n.notification_id])
    assert.equal(new URL(page.url()).pathname, '/')
  }, { signInAs: CARLA }))

test('bell: unsafe links are never followed', opts, () =>
  app(async ({ page, mock }) => {
    addNotification(mock.state, 'u-carla', { title: 'Phish', body: 'x', link: 'https://evil.example/steal', created_at: minutesAgo(1) })
    await visit(page, mock, '/', '.topbar')
    await page.waitForSelector('[data-testid=bell-dot]')
    await page.click(BELL)
    await page.click('[data-testid=bell-item]')
    await page.waitForFunction(() => !document.querySelector('[data-testid=bell-dot]'))
    assert.equal(new URL(page.url()).origin, mock.origin)
    assert.equal(new URL(page.url()).pathname, '/')
  }, { signInAs: CARLA }))

test('bell: polls every 60 s while visible, refreshes on focus, and pauses while the tab is hidden', opts, () =>
  app(async ({ page, mock }) => {
    await visit(page, mock, '/', '.topbar')
    await page.waitForFunction(() => document.querySelector('[data-testid=bell]'))
    await page.waitForTimeout(300)
    const polled = () => mock.state.newApi.notifCalls
    const start = polled()
    // Fake only the page's timers from here on, so the 60 s interval can be fast-forwarded.
    await page.clock.install({ time: new Date('2026-11-16T10:00:00') })
    await page.evaluate(() => undefined)
    await page.reload()
    await page.waitForSelector('[data-testid=bell]')
    await page.waitForFunction(() => document.querySelector('[data-testid=bell]'))
    await page.waitForTimeout(300)
    const base = polled()
    assert.ok(base > start)
    await page.clock.runFor(30_000)
    await page.waitForTimeout(150)
    assert.equal(polled(), base, 'nothing before 60 s')
    addNotification(mock.state, 'u-carla', { title: 'Arrived by polling', link: '/reimbursements', created_at: minutesAgo(0) })
    await page.clock.runFor(31_000)
    await page.waitForFunction(() => document.querySelector('[data-testid=bell]')?.dataset.unread === '1')
    assert.ok(polled() > base)
    // Hidden tab: the interval fires but does not call the server.
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    })
    const beforeHidden = polled()
    await page.clock.runFor(125_000)
    await page.waitForTimeout(150)
    assert.equal(polled(), beforeHidden, 'no polling while hidden')
    // Becoming visible refreshes at once.
    addNotification(mock.state, 'u-carla', { title: 'Second', link: '/reimbursements', created_at: minutesAgo(0) })
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await page.waitForFunction(() => document.querySelector('[data-testid=bell]')?.dataset.unread === '2')
    // Window focus refreshes too.
    addNotification(mock.state, 'u-carla', { title: 'Third', link: '/reimbursements', created_at: minutesAgo(0) })
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await page.waitForFunction(() => document.querySelector('[data-testid=bell]')?.dataset.unread === '3')
  }, { signInAs: CARLA }))

test('bell: load errors are honest and retryable; a failed mark-read says so and re-syncs', opts, () =>
  app(async ({ page, mock }) => {
    mock.state.newApi.forceStatus.notifications = 500
    await visit(page, mock, '/', '.topbar')
    await page.click(BELL)
    await page.waitForSelector('[data-testid=bell-error]')
    assert.match(await text(page, '[data-testid=bell-error]'), /couldn't be loaded/)
    addNotification(mock.state, 'u-carla', { title: 'Hello', link: '/leave', created_at: minutesAgo(2) })
    delete mock.state.newApi.forceStatus.notifications
    // (A focus event may already have re-synced; clicking Try again must work either way.)
    await page.evaluate(() => document.querySelector('[data-testid=bell-error] button')?.click())
    await page.waitForSelector('[data-testid=bell-list]')
    assert.equal(await page.getAttribute(BELL, 'data-unread'), '1')
    mock.state.newApi.forceStatus.markRead = 500
    await page.click('[data-testid=bell-item]')
    await page.waitForURL('**/leave')
    await page.click(BELL)
    await page.waitForSelector('[data-testid=bell-action-error]')
    assert.match(await text(page, '[data-testid=bell-action-error]'), /couldn't be marked as read/)
    assert.equal(await page.getAttribute(BELL, 'data-unread'), '1', 'the server still says unread, so the dot is back')
  }, { signInAs: CARLA }))

test('bell on a phone: 44px tap target, popover fits the screen at 390 and 320', opts, async () => {
  for (const width of [390, 320]) {
    await app(async ({ page, mock }) => {
      for (let i = 0; i < 6; i++) addNotification(mock.state, 'u-carla', { title: `Update number ${i} with a fairly long title to wrap`, body: 'A body that is long enough to need wrapping on a very narrow screen without overflowing.', link: '/reimbursements', created_at: minutesAgo(i + 1) })
      await visit(page, mock, '/', '.topbar')
      await page.waitForSelector('[data-testid=bell-dot]')
      const b = await page.locator(BELL).boundingBox()
      assert.ok(b.width >= 43.5 && b.height >= 43.5, `bell ${b.width}x${b.height}`)
      await page.click(BELL)
      await page.waitForSelector('[data-testid=bell-list]')
      const pop = await page.locator('[data-testid=bell-popover]').boundingBox()
      assert.ok(pop.x >= 0 && pop.x + pop.width <= width + 0.5, `popover x=${pop.x} w=${pop.width} at ${width}`)
      assert.ok(await noOverflow(page))
      const item = await page.locator('[data-testid=bell-item]').first().boundingBox()
      assert.ok(item.height >= 43.5)
    }, { signInAs: CARLA, viewport: { width, height: 700 } })
  }
})

test('bell and search coexist: opening one does not leave the other open', opts, () =>
  app(async ({ page, mock }) => {
    addNotification(mock.state, 'u-carla', { title: 'One', link: '/leave', created_at: minutesAgo(2) })
    await visit(page, mock, '/', '.topbar')
    await page.click(BELL)
    await page.waitForSelector('[data-testid=bell-popover]')
    await page.click(INPUT)
    await page.keyboard.type('ben')
    await page.waitForSelector(PANEL)
    assert.equal(await page.locator('[data-testid=bell-popover]').count(), 0, 'clicking elsewhere closes the bell')
    await page.click(BELL)
    assert.equal(await page.locator(PANEL).count(), 0, 'and opening the bell closes search')
  }, { signInAs: CARLA }))

// ------------------------------------------------------------------------------------------------ drawer a11y
const activeInside = (page, sel) => page.evaluate((s) => Boolean(document.activeElement && document.querySelector(s)?.contains(document.activeElement)), sel)

test('drawer: closed links are not focusable; opening moves focus in, Tab/Shift+Tab are trapped, Escape restores focus', opts, () =>
  app(async ({ page, mock }) => {
    await visit(page, mock, '/', '.topbar')
    assert.equal(await page.$eval('.sidebar', (e) => getComputedStyle(e).visibility), 'hidden', 'a closed drawer is hidden from tab order')
    await page.click('.topbar-menu')
    await page.waitForFunction(() => document.querySelector('.sidebar').getBoundingClientRect().left >= -1)
    assert.equal(await page.$eval('.sidebar', (e) => getComputedStyle(e).visibility), 'visible')
    assert.equal(await page.getAttribute('.topbar-menu', 'aria-expanded'), 'true')
    assert.ok(await activeInside(page, '.sidebar'), 'focus moved into the drawer')
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-nav-id')), 'dashboard')
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press('Tab')
      assert.ok(await activeInside(page, '.sidebar'), `Tab ${i} stayed in the drawer`)
    }
    await page.keyboard.press('Shift+Tab')
    assert.ok(await activeInside(page, '.sidebar'))
    // Shift+Tab from the first link wraps to the last.
    await page.focus('[data-nav-id=dashboard]')
    await page.keyboard.press('Shift+Tab')
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-nav-id')), 'settings')
    await page.keyboard.press('Tab')
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-nav-id')), 'dashboard')
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => document.querySelector('.sidebar').getBoundingClientRect().right <= 1)
    assert.equal(await page.evaluate(() => document.activeElement?.className), 'topbar-menu', 'focus returns to the hamburger')
  }, { signInAs: CARLA, viewport: { width: 390, height: 844 } }))

test('drawer: overlay click closes and restores focus; choosing a link navigates and closes', opts, () =>
  app(async ({ page, mock }) => {
    await visit(page, mock, '/', '.topbar')
    await page.click('.topbar-menu')
    await page.click('[data-testid=drawer-scrim]', { position: { x: 360, y: 400 } })
    await page.waitForFunction(() => document.querySelector('.sidebar').getBoundingClientRect().right <= 1)
    assert.equal(await page.evaluate(() => document.activeElement?.className), 'topbar-menu')
    await page.click('.topbar-menu')
    await page.click('[data-nav-id=my-profile]')
    await page.waitForURL('**/my-profile')
    await page.waitForFunction(() => document.querySelector('.sidebar').getBoundingClientRect().right <= 1)
    assert.equal(await page.locator('.drawer-scrim').count(), 0)
  }, { signInAs: CARLA, viewport: { width: 390, height: 844 } }))

test('drawer works at tablet widths too (768 and 1023)', opts, async () => {
  for (const width of [768, 1023]) {
    await app(async ({ page, mock }) => {
      await visit(page, mock, '/', '.topbar')
      assert.equal(await page.locator('.topbar-menu').isVisible(), true)
      const m = await page.locator('.topbar-menu').boundingBox()
      assert.ok(m.height >= (width <= 768 ? 43.5 : 39.5))
      await page.click('.topbar-menu')
      assert.ok(await activeInside(page, '.sidebar'))
      await page.keyboard.press('Escape')
      await page.waitForFunction(() => document.querySelector('.sidebar').getBoundingClientRect().right <= 1)
    }, { signInAs: CARLA, viewport: { width, height: 800 } })
  }
})

test('anna: header search finds people for HR; the directory is reachable from the dashboard card', opts, () =>
  app(async ({ page, mock }) => {
    await page.waitForSelector('[data-testid=card-directory]')
    await page.click('[data-testid=card-link]')
    await page.waitForURL('**/directory')
    await page.waitForSelector('[data-testid=dir-row]')
    await page.click(INPUT)
    await page.keyboard.type('compliance')
    await page.waitForSelector('[data-testid=search-option][data-kind=person]')
    assert.ok((await optionLabels(page)).includes('Carla Dizon'))
  }, { signInAs: ANNA }))
