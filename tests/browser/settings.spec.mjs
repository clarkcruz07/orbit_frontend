// Mock-API browser tests for Settings (preferences, account, HR settings, users and roles, catalogs) and the HR dashboard
// (always live data, no source switch). The mock (settings-mock.mjs) plays the server: HR-only routes answer 403 to other accounts.
// Gated: RUN_BROWSER_TESTS=1 (use `npm run test:browser`). Fictional data only. SETTINGS_DIST can point at another build.
import path from 'node:path'
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { distDir, launchBrowser } from './browser-env.mjs'
import { U, liveDashboard, liveDegraded, liveTiny, startSettingsMock } from './settings-mock.mjs'

const enabled = process.env.RUN_BROWSER_TESTS === '1'
const opts = { skip: enabled ? false : 'set RUN_BROWSER_TESTS=1 to run real-browser tests' }
const dist = process.env.SETTINGS_DIST ? path.resolve(process.env.SETTINGS_DIST) : distDir

let browser
before(async () => {
  if (enabled) browser = await launchBrowser()
})
after(async () => {
  await browser?.close()
})

/** Runs fn({page, mock, errors}) against a fresh mock, signed in as `user` (token seeded; the app restores the session via /auth/me). */
async function withApp(user, fn, { viewport = { width: 1448, height: 1000 }, setup } = {}) {
  const mock = await startSettingsMock({ distDir: dist })
  setup?.(mock)
  const ctx = await browser.newContext({ viewport })
  await ctx.addInitScript((t) => localStorage.setItem('people.accessToken', t), `acc-${user.user_id}`)
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text())
  })
  try {
    await fn({ page, mock, errors, go: (p, ready) => page.goto(`${mock.origin}${p}`).then(() => page.waitForSelector(ready ?? '[data-testid=settings-page]')) })
  } finally {
    await ctx.close()
    await mock.close()
  }
}

const text = (page, sel) => page.locator(sel).innerText()
const tabsOf = (page) => page.$$eval('[data-testid=settings-tabs] [role=tab]', (els) => els.map((e) => e.textContent.trim()))
const count = (mock, key) => mock.state.log.filter((l) => l === key).length
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)

// ------------------------------------------------------------------------------------------------ preferences
test('preferences: an employee sees the seven groups with descriptions, the honest in-app note and NO HR tabs', opts, () =>
  withApp(U.carla, async ({ page, mock, errors, go }) => {
    await go('/settings', '[data-testid=pref-switch-leave]')
    assert.deepEqual(await tabsOf(page), ['My preferences', 'Account'])
    const labels = await page.$$eval('[data-testid=prefs-list] li strong', (els) => els.map((e) => e.textContent.trim()))
    assert.deepEqual(labels, ['Reimbursements', 'Leave', 'Attendance and timesheets', 'Performance and check-ins', 'Learning and development', 'Documents and policies', 'HR requests'])
    const descs = await page.$$eval('[data-testid=prefs-list] li span[id$=-desc]', (els) => els.map((e) => e.textContent.trim()))
    assert.equal(descs.length, 7)
    assert.ok(descs.every((d) => d.length > 20))
    const body = await text(page, '[data-testid=settings-page]')
    assert.match(body, /in-app notifications only/)
    assert.match(body, /does not send e-mail, push or Teams messages/)
    assert.match(body, /Nothing saved yet: every group is on/)
    // Every switch is a labelled, described, on-by-default switch.
    const sw = await page.$$eval('[data-testid^=pref-switch-]', (els) => els.map((e) => [e.getAttribute('role'), e.getAttribute('aria-checked'), !!e.getAttribute('aria-labelledby'), !!e.getAttribute('aria-describedby')]))
    assert.equal(sw.length, 7)
    assert.ok(sw.every((s) => s[0] === 'switch' && s[1] === 'true' && s[2] && s[3]))
    // One refused probe (the employee is not HR) and no HR-only reads.
    assert.equal(count(mock, 'GET /settings'), 1)
    assert.equal(count(mock, 'GET /settings/users'), 0)
    assert.equal(count(mock, 'GET /settings/overview'), 0)
    assert.deepEqual(errors, [])
  }))

test('preferences: toggling a group saves a PARTIAL update, shows feedback, and the choice survives a reload', opts, () =>
  withApp(U.carla, async ({ page, mock, go }) => {
    await go('/settings', '[data-testid=pref-switch-leave]')
    await page.click('[data-testid=pref-switch-leave]')
    await page.waitForFunction(() => /Leave notifications are off\./.test(document.querySelector('[data-testid=prefs-status]')?.textContent || ''))
    assert.equal(await page.getAttribute('[data-testid=pref-switch-leave]', 'aria-checked'), 'false')
    assert.equal(await page.getAttribute('[data-testid=pref-switch-cases]', 'aria-checked'), 'true')
    const put = mock.state.calls.filter((c) => c.method === 'PUT' && c.route === '/preferences/me')
    assert.equal(put.length, 1)
    assert.deepEqual(put[0].body, { groups: { leave: false } })
    assert.match(await text(page, '[data-testid=prefs-panel]'), /Last saved \d{1,2} [A-Z][a-z]{2} \d{4}/)
    // Toggle it back on: also a partial body.
    await page.click('[data-testid=pref-switch-leave]')
    await page.waitForFunction(() => /Leave notifications are on\./.test(document.querySelector('[data-testid=prefs-status]')?.textContent || ''))
    assert.deepEqual(mock.state.calls.filter((c) => c.method === 'PUT').pop().body, { groups: { leave: true } })
    await page.click('[data-testid=pref-switch-timesheet]')
    await page.waitForFunction(() => document.querySelector('[data-testid=pref-switch-timesheet]')?.getAttribute('aria-checked') === 'false')
    await page.reload()
    await page.waitForSelector('[data-testid=pref-switch-timesheet]')
    assert.equal(await page.getAttribute('[data-testid=pref-switch-timesheet]', 'aria-checked'), 'false')
    assert.equal(await page.getAttribute('[data-testid=pref-switch-leave]', 'aria-checked'), 'true')
  }))

test('preferences: the switch is optimistic, busy while saving, and other groups stay usable', opts, () =>
  withApp(U.carla, async ({ page, mock, go }) => {
    mock.state.delay['PUT /preferences/me'] = 700
    await go('/settings', '[data-testid=pref-switch-leave]')
    await page.click('[data-testid=pref-switch-leave]')
    // Immediately off (optimistic), busy and disabled until the server answers.
    assert.equal(await page.getAttribute('[data-testid=pref-switch-leave]', 'aria-checked'), 'false')
    assert.equal(await page.getAttribute('[data-testid=pref-switch-leave]', 'aria-busy'), 'true')
    assert.equal(await page.locator('[data-testid=pref-switch-leave]').isDisabled(), true)
    assert.equal(await page.locator('[data-testid=pref-switch-cases]').isDisabled(), false)
    await page.waitForFunction(() => document.querySelector('[data-testid=pref-switch-leave]')?.getAttribute('aria-busy') === null)
    assert.equal(await page.getAttribute('[data-testid=pref-switch-leave]', 'aria-checked'), 'false')
  }))

test('preferences: a failed save rolls the switch back and says so clearly (500 and 422)', opts, () =>
  withApp(U.carla, async ({ page, mock, go }) => {
    await go('/settings', '[data-testid=pref-switch-leave]')
    for (const [status, re] of [
      [500, /Leave is still on\./],
      [422, /not accepted.*Leave is still on\./],
    ]) {
      mock.state.force['PUT /preferences/me'] = status
      await page.click('[data-testid=pref-switch-leave]')
      await page.waitForSelector('[data-testid=prefs-save-error]')
      assert.match(await text(page, '[data-testid=prefs-save-error]'), re)
      assert.equal(await page.getAttribute('[data-testid=pref-switch-leave]', 'aria-checked'), 'true', 'rolled back')
      assert.equal(await page.locator('[data-testid=prefs-status]').innerText(), '', 'no success message')
      // The next click clears the old error.
      delete mock.state.force['PUT /preferences/me']
      await page.click('[data-testid=pref-switch-cases]')
      await page.waitForFunction(() => !document.querySelector('[data-testid=prefs-save-error]'))
      await page.click('[data-testid=pref-switch-cases]')
      await page.waitForFunction(() => document.querySelector('[data-testid=pref-switch-cases]')?.getAttribute('aria-checked') === 'true' && !document.querySelector('[data-testid=pref-switch-cases]')?.getAttribute('aria-busy'))
    }
  }))

test('preferences: a load error shows a retry that works', opts, () =>
  withApp(U.carla, async ({ page, mock, go }) => {
    mock.state.force['GET /preferences/me'] = 500
    await go('/settings', '[data-testid=prefs-error]')
    assert.match(await text(page, '[data-testid=prefs-error]'), /could not be loaded/)
    assert.equal(await page.locator('[data-testid^=pref-switch-]').count(), 0)
    delete mock.state.force['GET /preferences/me']
    await page.click('[data-testid=prefs-error] button')
    await page.waitForSelector('[data-testid=pref-switch-leave]')
  }))

// ------------------------------------------------------------------------------------------------ access
test('access: Employee, Manager and Finance never get HR tabs; forced HR links fall back and the URL is cleaned', opts, async () => {
  for (const user of [U.carla, U.ben, U.dan]) {
    await withApp(user, async ({ page, mock, go }) => {
      for (const tab of ['hr', 'users', 'catalogs']) {
        await go(`/settings?tab=${tab}`, '[data-testid=pref-switch-leave]')
        assert.deepEqual(await tabsOf(page), ['My preferences', 'Account'], `${user.name} ${tab}`)
        await page.waitForFunction(() => !new URL(location.href).searchParams.has('tab'))
        assert.equal(await page.locator('[data-testid=tab-hr], [data-testid=tab-users], [data-testid=tab-catalogs]').count(), 0)
      }
      // The HR-only routes were never requested for them beyond the single refused probe per page load.
      assert.equal(count(mock, 'GET /settings/users'), 0)
      assert.equal(count(mock, 'GET /hr/dashboard/source'), 0)
    })
  }
})

test('access: a probe that fails (not 403) says so with a retry and keeps preferences usable', opts, () =>
  withApp(U.anna, async ({ page, mock, go }) => {
    mock.state.force['GET /settings'] = 500
    await go('/settings', '[data-testid=settings-probe-error]')
    assert.deepEqual(await tabsOf(page), ['My preferences', 'Account'])
    assert.match(await text(page, '[data-testid=settings-probe-error]'), /couldn't check whether HR settings are available/)
    await page.waitForSelector('[data-testid=pref-switch-leave]')
    delete mock.state.force['GET /settings']
    await page.click('[data-testid=settings-probe-error] button')
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=settings-tabs] [role=tab]').length === 5)
  }))

test('tabs: keyboard arrows move between tabs, the URL follows (?tab=), Back works', opts, () =>
  withApp(U.anna, async ({ page, go }) => {
    await go('/settings', '[data-testid=pref-switch-leave]')
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=settings-tabs] [role=tab]').length === 5)
    assert.deepEqual(await tabsOf(page), ['My preferences', 'Account', 'HR settings', 'Users and roles', 'Catalogs'])
    await page.focus('[data-testid=settings-tab-preferences]')
    await page.keyboard.press('ArrowRight')
    await page.waitForSelector('[data-testid=tab-account]')
    assert.equal(new URL(page.url()).searchParams.get('tab'), 'account')
    await page.click('[data-testid=settings-tab-catalogs]')
    await page.waitForSelector('[data-testid=tab-catalogs]')
    assert.equal(new URL(page.url()).searchParams.get('tab'), 'catalogs')
    assert.equal(await page.getAttribute('[data-testid=settings-tab-catalogs]', 'aria-selected'), 'true')
    await page.goBack()
    await page.waitForSelector('[data-testid=tab-account]')
  }))

// ------------------------------------------------------------------------------------------------ account
test('account: read-only facts, sign-in source badge, roles-by-configuration note; the zone appears for HR only', opts, async () => {
  await withApp(U.carla, async ({ page, mock, go }) => {
    mock.state.authSource = 'demo'
    await go('/settings?tab=account', '[data-testid=account-facts]')
    await page.waitForFunction(() => /Local account/.test(document.querySelector('[data-testid=fact-source]')?.textContent || ''))
    const facts = await text(page, '[data-testid=account-facts]')
    for (const s of ['Carla Dizon', 'carla.dizon@example.test', 'EMP-0003', 'Compliance Analyst', 'Compliance', 'Employee', 'Local account', '2 May 2023']) assert.ok(facts.includes(s), s)
    assert.equal(await page.locator('[data-testid=fact-timezone]').count(), 0)
    assert.equal(count(mock, 'GET /settings/overview'), 0)
    assert.match(await text(page, '[data-testid=tab-account]'), /set by HR on the People pages/)
    assert.equal(await page.locator('[data-testid=tab-account] input, [data-testid=tab-account] select, [data-testid=tab-account] textarea').count(), 0, 'nothing to edit')
  })
  await withApp(U.anna, async ({ page, go }) => {
    await go('/settings?tab=account', '[data-testid=account-facts]')
    await page.waitForSelector('[data-testid=fact-timezone]')
    assert.match(await text(page, '[data-testid=fact-timezone]'), /Asia\/Manila/)
    assert.match(await text(page, '[data-testid=fact-source]'), /Microsoft sign-in/)
    assert.match(await text(page, '[data-testid=fact-roles]'), /HR Administrator/)
  })
})

test('account: a failed sign-in-source read says so with a retry, the other facts still show', opts, () =>
  withApp(U.carla, async ({ page, mock, go }) => {
    mock.state.force['GET /me/profile'] = 500
    await go('/settings?tab=account', '[data-testid=account-facts]')
    await page.waitForSelector('[data-testid=fact-source] [role=alert]')
    assert.match(await text(page, '[data-testid=fact-source]'), /couldn't be loaded/)
    assert.match(await text(page, '[data-testid=fact-name]'), /Carla Dizon/)
    delete mock.state.force['GET /me/profile']
    await page.click('[data-testid=fact-source] button')
    await page.waitForFunction(() => /Microsoft sign-in/.test(document.querySelector('[data-testid=fact-source]')?.textContent || ''))
  }))

// ------------------------------------------------------------------------------------------------ HR settings
test('HR settings: mood switch explains the privacy impact, saves, flips the wording, persists across reload', opts, () =>
  withApp(U.anna, async ({ page, mock, go }) => {
    await go('/settings?tab=hr', '[data-testid=mood-switch]')
    assert.equal(await page.getAttribute('[data-testid=mood-switch]', 'aria-checked'), 'false')
    assert.match(await text(page, '[data-testid=mood-explain]'), /Off \(default\).*do not see the mood score/)
    assert.match(await text(page, '[data-testid=mood-changed]'), /Default in force \(never changed\)/)
    await page.click('[data-testid=mood-switch]')
    await page.waitForFunction(() => /can now see check-in mood/.test(document.querySelector('[data-testid=mood-status]')?.textContent || ''))
    assert.match(await text(page, '[data-testid=mood-explain]'), /can also see the mood score/)
    assert.deepEqual(mock.state.calls.filter((c) => c.method === 'PUT' && c.route === '/settings').pop().body, { hr_can_see_mood: true })
    assert.equal(mock.state.settings.hr_can_see_mood, true)
    assert.match(await text(page, '[data-testid=mood-changed]'), /Last changed/)
    await page.reload()
    await page.waitForSelector('[data-testid=mood-switch]')
    assert.equal(await page.getAttribute('[data-testid=mood-switch]', 'aria-checked'), 'true')
  }))

test('HR settings: a failed mood save rolls back with a clear message', opts, () =>
  withApp(U.anna, async ({ page, mock, go }) => {
    await go('/settings?tab=hr', '[data-testid=mood-switch]')
    mock.state.force['PUT /settings'] = 500
    await page.click('[data-testid=mood-switch]')
    await page.waitForSelector('[data-testid=mood-error]')
    assert.match(await text(page, '[data-testid=mood-error]'), /not saved.*back to Off/)
    assert.equal(await page.getAttribute('[data-testid=mood-switch]', 'aria-checked'), 'false')
    assert.equal(mock.state.settings.hr_can_see_mood, false)
  }))

test('HR settings: only the mood switch is left - there is no dashboard data-source panel and no source endpoint is called', opts, () =>
  withApp(U.anna, async ({ page, mock, go }) => {
    await go('/settings?tab=hr', '[data-testid=mood-switch]')
    assert.equal(await page.locator('[data-testid=hr-source-panel], [data-testid=settings-source-switch], [data-testid=source-explain]').count(), 0)
    assert.equal(await page.locator('[data-testid=hr-mood-panel]').count(), 1)
    assert.ok(!(await text(page, '[data-testid=tab-hr]')).includes('Demo'))
    assert.equal(count(mock, 'GET /hr/dashboard/source'), 0)
  }))

// ------------------------------------------------------------------------------------------------ users and roles
test('users: read-only table with badges, 20 per page, paging, a literal search and no edit controls', opts, () =>
  withApp(U.anna, async ({ page, mock, errors, go }) => {
    await go('/settings?tab=users', '[data-testid=user-row]')
    assert.equal(await page.locator('[data-testid=user-row]').count(), 20)
    assert.match(await text(page, '[data-testid=users-count]'), /Showing 1-20 of 45 people/)
    const heads = await page.$$eval('[data-testid=users-table] thead th', (els) => els.map((e) => e.textContent.trim()))
    assert.deepEqual(heads, ['Name', 'Email', 'Roles', 'Sign-in', 'Department', 'Job title'])
    const body = await text(page, '[data-testid=users-table]')
    assert.ok(body.includes('Anna Reyes') && body.includes('HR Administrator') && body.includes('Microsoft'))
    assert.ok(body.includes('Local account'))
    assert.equal(await page.locator('[data-testid=demo-badge]').count(), 0, 'no Demo badge anywhere')
    assert.match(await text(page, '[data-testid=roles-note]'), /set by HR on the People pages.*no role edit control/)
    // Read-only: the only controls are the search, Previous and Next.
    assert.equal(await page.locator('[data-testid=users-table] input, [data-testid=users-table] select, [data-testid=users-table] button, [data-testid=users-table] a').count(), 0)
    const names = await page.$$eval('[data-testid=user-row] strong', (els) => els.map((e) => e.textContent.trim()))
    assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)))
    // Paging.
    assert.equal(await page.locator('[data-testid=users-prev]').isDisabled(), true)
    await page.click('[data-testid=users-next]')
    await page.waitForFunction(() => /Showing 21-40 of 45/.test(document.querySelector('[data-testid=users-count]')?.textContent || ''))
    assert.equal(new URL(page.url()).searchParams.get('page'), '2')
    assert.match(await text(page, '[data-testid=users-page-label]'), /Page 2 of 3/)
    await page.click('[data-testid=users-next]')
    await page.waitForFunction(() => /Showing 41-45 of 45/.test(document.querySelector('[data-testid=users-count]')?.textContent || ''))
    assert.equal(await page.locator('[data-testid=users-next]').isDisabled(), true)
    // Search: debounced into ONE request, literal (a regex-looking text matches nothing), clear restores.
    await page.fill('[data-testid=users-search]', '')
    const before = mock.state.calls.filter((c) => c.route === '/settings/users').length
    await page.type('[data-testid=users-search]', 'carla', { delay: 30 })
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=user-row]').length === 1)
    assert.equal(mock.state.calls.filter((c) => c.route === '/settings/users' && c.query.q === 'carla').length, 1)
    assert.ok(mock.state.calls.filter((c) => c.route === '/settings/users').length - before <= 3)
    assert.equal(new URL(page.url()).searchParams.get('q'), 'carla')
    assert.equal(new URL(page.url()).searchParams.get('page'), null, 'a new search starts on page 1')
    await page.fill('[data-testid=users-search]', '.*')
    await page.waitForSelector('[data-testid=empty-state]')
    assert.match(await text(page, '[data-testid=empty-state]'), /No one matches your search/)
    assert.deepEqual(mock.state.calls.filter((c) => c.route === '/settings/users').pop().query.q, '.*')
    await page.click('[data-testid=users-clear]')
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=user-row]').length === 20)
    assert.deepEqual(errors, [])
  }))

test('users: the search input is capped at 64 characters; a stale bookmarked page falls back to page 1; errors retry', opts, () =>
  withApp(U.anna, async ({ page, mock, go }) => {
    await go('/settings?tab=users&page=9', '[data-testid=user-row]')
    await page.waitForFunction(() => /Showing 1-20 of 45/.test(document.querySelector('[data-testid=users-count]')?.textContent || ''))
    assert.equal(await page.getAttribute('[data-testid=users-search]', 'maxlength'), '64')
    mock.state.force['GET /settings/users'] = 500
    await page.fill('[data-testid=users-search]', 'zz')
    await page.waitForSelector('[data-testid=users-error]')
    assert.match(await text(page, '[data-testid=users-error]'), /could not be loaded/)
    delete mock.state.force['GET /settings/users']
    await page.click('[data-testid=users-error] button')
    await page.waitForSelector('[data-testid=empty-state]')
  }))

test('users: on a phone the table becomes cards with the same facts', opts, () =>
  withApp(
    U.anna,
    async ({ page, go }) => {
      await go('/settings?tab=users', '[data-testid=user-card]')
      assert.equal(await page.locator('[data-testid=users-table]').isVisible(), false)
      assert.equal(await page.locator('[data-testid=user-card]:visible').count(), 20)
      const first = await text(page, '[data-testid=user-card] >> nth=0')
      assert.ok(first.includes('Anna Reyes') && first.includes('anna.reyes@example.test') && first.includes('Microsoft sign-in') && first.includes('HR Administrator'))
      assert.ok(await noOverflow(page))
    },
    { viewport: { width: 390, height: 800 } },
  ))

// ------------------------------------------------------------------------------------------------ catalogs
test('catalogs: a read-only index with real links to each module (and an honest note where there is no admin screen)', opts, () =>
  withApp(U.anna, async ({ page, go }) => {
    await go('/settings?tab=catalogs', '[data-testid=catalogs-list]')
    const links = await page.$$eval('[data-testid^=catalog-link-]', (els) => els.map((e) => [e.getAttribute('data-testid'), e.getAttribute('href')]))
    assert.deepEqual(links, [
      ['catalog-link-leave', '/leave?tab=settings'],
      ['catalog-link-timesheet', '/attendance?tab=hr'],
      ['catalog-link-documents', '/documents?tab=hr&section=types'],
      ['catalog-link-learning', '/learning?tab=hr&section=courses'],
      ['catalog-link-hrcases', '/hr-requests'],
      ['catalog-link-holidays', '/settings/holidays'],
      ['catalog-link-people', '/people'],
      ['catalog-link-knowledge', '/knowledge-base'],
    ])
    const body = await text(page, '[data-testid=catalogs-list]')
    for (const s of ['Leave types and entitlements', 'Timesheet codes', 'Document types', 'Learning courses', 'HR request types', 'Holidays', 'People']) assert.ok(body.includes(s), s)
    assert.match(await text(page, '[data-testid=catalog-note-hrcases]'), /no separate screen for editing request types yet/)
    assert.equal(await page.locator('[data-testid=catalogs-list] input, [data-testid=catalogs-list] select, [data-testid=catalogs-list] button').count(), 0)
    await page.click('[data-testid=catalog-link-leave]')
    await page.waitForURL('**/leave?tab=settings')
    assert.match(new URL(page.url()).pathname, /^\/leave$/)
  }))

// ------------------------------------------------------------------------------------------------ the HR dashboard (always computed from live data)

test('dashboard: shows computed numbers and honest "Not tracked yet" cards, with no demo ribbon and no data-source switch', opts, () =>
  withApp(U.anna, async ({ page, errors, go }) => {
    await go('/hr-administration', '[data-testid=card-upcoming]')
    assert.equal(new URL(page.url()).pathname, '/', 'the old address redirects to the Dashboard')
    assert.equal(await page.locator('[data-testid=demo-ribbon], [data-testid=live-ribbon], [data-testid=hr-source], [data-testid=source-switch]').count(), 0)
    assert.ok(!(await text(page, '.hr-page')).includes('Fictional demo data'))
    // Computed numbers.
    const sums = await text(page, '[data-testid=summary-cards]')
    assert.ok(sums.includes('19') && sums.includes('+11.8%') && sums.includes('vs. last month'), sums)
    assert.ok(sums.includes('50%') && sums.includes('3') && sums.includes('Next 30 Days'))
    assert.ok(!sums.includes('1,248'))
    // Onboarding / offboarding: honest "Not tracked yet" cards (summary + lifecycle), with the reason.
    for (const id of ['sum-onboarding', 'sum-offboarding', 'card-onboarding', 'card-offboarding']) {
      const t = await text(page, `[data-testid=${id}]`)
      assert.match(t, /Not tracked yet/, id)
      assert.match(t, /Not tracked by any module yet/, id)
      assert.ok(!/\d+%/.test(t), `${id} shows no percentage`)
    }
    assert.equal(await page.locator('[data-testid=card-onboarding][data-available=false]').count(), 1)
    // Policy delta_pp is null: no delta shown.
    assert.match(await text(page, '[data-testid=sum-policy]'), /No comparison yet/)
    assert.ok(!/pp/.test(await text(page, '[data-testid=sum-policy]')))
    // Chart, directory, cases, upcoming.
    assert.ok((await page.locator('[data-testid=card-headcount-trend] svg').count()) > 0)
    assert.ok((await text(page, '[data-testid=card-headcount-trend]')).includes('19'))
    const dir = await text(page, '[data-testid=card-directory]')
    for (const s of ['19', 'Full-time', '15', 'Part-time', '2', 'Contractor', '1', 'Intern']) assert.ok(dir.includes(s), s)
    const squash = async (id) => (await text(page, `[data-testid=${id}]`)).replace(/\s+/g, ' ').trim()
    assert.equal(await squash('accounts-synced'), 'Synced from Microsoft19')
    assert.equal(await squash('accounts-active'), 'Active users (Users and roles)12')
    assert.equal(await squash('accounts-waiting'), 'Not signed in yet7')
    assert.equal(await squash('accounts-role-Manager'), 'Manager3')
    const cases = await text(page, '[data-testid=card-cases]')
    assert.ok(cases.includes('4') && cases.includes('High Priority') && cases.includes('0 days') && cases.includes('No comparison yet'))
    const up = await text(page, '[data-testid=card-upcoming]')
    assert.ok(up.includes('Carla Dizon') && up.includes('Nov 23') && up.includes('Bonifacio Day') && up.includes('NOV'))
    assert.ok(!/NaN|undefined|null/.test(await text(page, '.hr-page')))
    assert.equal(await page.locator('[data-testid=clock-card]').count(), 1, 'the clock card sits on top of the dashboard')
    assert.deepEqual(errors, [])
  }))

test('dashboard: tiny live company (14 people, one trend point, zero cases, nothing expiring, no birthdays) renders cleanly', opts, () =>
  withApp(
    U.anna,
    async ({ page, errors, go }) => {
      await go('/', '[data-testid=card-upcoming]')
      const sums = await text(page, '[data-testid=summary-cards]')
      assert.ok(sums.includes('14'))
      assert.match(await text(page, '[data-testid=sum-headcount]'), /No comparison yet/)
      assert.match(await text(page, '[data-testid=sum-expiring]'), /0\s*Next 30 Days/)
      assert.match(await text(page, '[data-testid=sum-policy]'), /Not tracked yet[\s\S]*No policy to measure yet/)
      // One data point: the chart still renders its dot and the end bubble, nothing breaks.
      assert.ok((await page.locator('[data-testid=card-headcount-trend] svg').count()) > 0)
      assert.ok((await text(page, '[data-testid=card-headcount-trend]')).includes('14'))
      assert.equal(await page.locator('[data-testid=trend-empty]').count(), 0)
      const cases = await text(page, '[data-testid=card-cases]')
      assert.ok(cases.includes('0') && cases.includes('No resolved cases yet'))
      assert.match(await text(page, '[data-testid=birthdays-empty]'), /No birthdays in the next 30 days/)
      assert.match(await text(page, '[data-testid=holidays-empty]'), /No company holidays in the next 30 days/)
      assert.ok(!/NaN|undefined|null|Infinity/.test(await text(page, '.hr-page')))
      assert.ok(await noOverflow(page))
      assert.deepEqual(errors, [])
    },
    { setup: (mock) => (mock.state.liveVariant = liveTiny) },
  ))

test('dashboard: blocks the server could not compute show "Temporarily unavailable" with a note, in the same footprint', opts, () =>
  withApp(
    U.anna,
    async ({ page, errors, go }) => {
      await go('/', '[data-testid=card-upcoming]')
      assert.match(await text(page, '[data-testid=degraded-note]'), /Some blocks could not be computed just now \(head count, head count trend, employee directory, HR cases, birthdays\)/)
      for (const id of ['sum-headcount', 'card-directory', 'card-cases']) {
        const t = await text(page, `[data-testid=${id}]`)
        assert.match(t, /Temporarily unavailable/, id)
        assert.ok(!/NaN|null|undefined/.test(t), id)
      }
      assert.match(await text(page, '[data-testid=trend-empty]'), /Temporarily unavailable/)
      assert.match(await text(page, '[data-testid=birthdays-empty]'), /could not be computed/)
      // Healthy blocks still show their numbers.
      assert.ok((await text(page, '[data-testid=sum-expiring]')).includes('3'))
      assert.ok(await noOverflow(page))
      assert.deepEqual(errors, [])
    },
    { setup: (mock) => (mock.state.liveVariant = liveDegraded) },
  ))

test('dashboard: a non-HR account gets the personal home (never the HR dashboard) and no switch', opts, async () => {
  for (const user of [U.carla, U.ben, U.dan]) {
    await withApp(user, async ({ page, mock, go }) => {
      await go('/hr-administration', '[data-testid=home-my-reimbursements]')
      assert.equal(new URL(page.url()).pathname, '/')
      assert.equal(await page.locator('[data-testid=hr-source], [data-testid=source-switch]').count(), 0)
      assert.equal(count(mock, 'GET /hr/dashboard'), 0)
    })
  }
})
