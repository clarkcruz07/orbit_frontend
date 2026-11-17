// Real-browser tests: built app + deterministic mock API, driven through system Chrome (playwright-core).
// Gated: RUN_BROWSER_TESTS=1 (use `npm run test:browser`).
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { distDir, launchBrowser, signIn } from './browser-env.mjs'
import { startMock, DASHBOARD } from './mock-api.mjs'

const enabled = process.env.RUN_BROWSER_TESTS === '1'
const opts = { skip: enabled ? false : 'set RUN_BROWSER_TESTS=1 to run real-browser tests' }

let browser
before(async () => {
  if (enabled) browser = await launchBrowser()
})
after(async () => {
  await browser?.close()
})

const ANNA = 'anna.reyes@example.test'
const CARLA = 'carla.dizon@example.test'

async function withApp(fn, { viewport = { width: 1448, height: 1086 }, demoAuth = true } = {}) {
  const mock = await startMock({ distDir, demoAuth })
  const ctx = await browser.newContext({ viewport })
  const page = await ctx.newPage()
  const consoleErrors = []
  page.on('pageerror', (e) => consoleErrors.push(String(e)))
  try {
    await fn({ page, mock, ctx, consoleErrors })
  } finally {
    await ctx.close()
    await mock.close()
  }
}

const text = (page, sel) => page.locator(sel).innerText()
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)

test('login: wrong password shows a generic error and stays on /login', opts, () =>
  withApp(async ({ page, mock }) => {
    await signIn(page, mock.origin, ANNA, 'wrong-password')
    await page.waitForSelector('[role=alert]')
    assert.match(await text(page, '[role=alert]'), /Invalid email or password/)
    assert.match(page.url(), /\/login$/)
    assert.equal(await page.evaluate(() => localStorage.getItem('people.accessToken')), null)
  }))

test('login: HRAdmin lands on the HR dashboard at / and tokens are stored', opts, () =>
  withApp(async ({ page, mock }) => {
    await signIn(page, mock.origin, ANNA)
    await page.waitForSelector('[data-testid=card-upcoming]')
    assert.equal(new URL(page.url()).pathname, '/')
    assert.equal(await page.evaluate(() => localStorage.getItem('people.accessToken')), 'acc-u-anna')
    assert.equal(await page.evaluate(() => localStorage.getItem('people.refreshToken')), 'ref-u-anna')
    assert.match(await text(page, '.profile-name'), /Anna Reyes/)
    assert.match(await text(page, '.profile-role'), /HR Administrator/)
  }))

test('login: other roles land on the personal Dashboard (/) with honest empty cards', opts, () =>
  withApp(async ({ page, mock }) => {
    await signIn(page, mock.origin, CARLA)
    await page.waitForSelector('[data-testid=home-my-reimbursements]')
    assert.equal(new URL(page.url()).pathname, '/')
    assert.match(await text(page, 'h1'), /Welcome, Carla/)
    assert.equal(await page.locator('[data-testid=home-awaiting-review]').count(), 0, 'an Employee has no review queue, so there is no review card')
    assert.equal(await page.locator('[data-testid=home-sum-review]').count(), 0)
    assert.equal(await page.locator('[data-testid=summary-cards] > *').count(), 4)
    assert.equal(await page.locator('[data-testid=sum-headcount]').count(), 0, 'no HR blocks for non-HR personnel')
    await page.waitForSelector('[data-testid=clock-card]')
    assert.deepEqual(await page.$$eval('.app-content button', (els) => els.map((e) => e.getAttribute('data-testid'))), ['clock-in'], 'the only button is Clock in')
  }))

test('the login page never shows a demo-accounts panel and never asks for the demo user list', opts, async () => {
  await withApp(async ({ page, mock }) => {
    await page.goto(`${mock.origin}/login`)
    await page.waitForSelector('#email')
    await page.waitForTimeout(400)
    assert.equal(await page.locator('[data-testid=demo-panel]').count(), 0)
    assert.ok(!(await text(page, 'body')).includes('Demo accounts'))
    assert.ok(!mock.state.log.some((l) => l.includes('/auth/demo-users')), 'demo users are not requested')
  })
})


test('login page: logo, show/hide, plain-text forgot password, SSO divider, honest Microsoft message', opts, () =>
  withApp(async ({ page, mock }) => {
    await page.goto(`${mock.origin}/login`)
    await page.waitForSelector('#email')
    assert.match(await text(page, 'h1'), /Sign in/)
    assert.equal(await page.locator('.brand-logo').count(), 1)
    // Forgot password is text, not a link/button.
    assert.equal(await page.locator('.login-forgot').evaluate((e) => e.tagName), 'SPAN')
    await page.fill('#password', 'abc')
    assert.equal(await page.getAttribute('#password', 'type'), 'password')
    await page.click('.password-toggle')
    assert.equal(await page.getAttribute('#password', 'type'), 'text')
    assert.match(await text(page, '.login-divider'), /Or login via SSO/)
    await page.click('text=Microsoft')
    assert.match(await text(page, '.login-sso-note'), /Microsoft sign-in isn't configured in this local build/)
    assert.equal(mock.state.log.filter((l) => l.includes('/auth/entra')).length, 0, 'no tenant/API contacted')
  }))

test('route guard: unauthenticated visit redirects to /login?next= and returns after sign-in', opts, () =>
  withApp(async ({ page, mock }) => {
    await page.goto(`${mock.origin}/leave`)
    await page.waitForURL(/\/login\?next=%2Fleave$/)
    await page.fill('#email', CARLA)
    await page.fill('#password', 'demo-pass-fictional')
    await page.click('button[type=submit]')
    await page.waitForURL('**/leave')
    await page.waitForSelector('[data-testid=leave-page]')  // the real Leave page (no longer a placeholder)
  }))

test('route guard: an off-site ?next= is ignored', opts, () =>
  withApp(async ({ page, mock }) => {
    await page.goto(`${mock.origin}/login?next=${encodeURIComponent('https://evil.example/phish')}`)
    await page.fill('#email', ANNA)
    await page.fill('#password', 'demo-pass-fictional')
    await page.click('button[type=submit]')
    await page.waitForSelector('[data-testid=card-upcoming]')
    assert.equal(new URL(page.url()).origin, mock.origin)
  }))

test('HR Administration renders all seven sections with the contract data', opts, () =>
  withApp(async ({ page, mock, consoleErrors }) => {
    await signIn(page, mock.origin, ANNA)
    await page.waitForSelector('[data-testid=card-upcoming]')
    const sums = await text(page, '[data-testid=summary-cards]')
    for (const s of ['Total Headcount', '1,248', '+3.2%', 'vs. last month', 'Onboarding', '24', 'Offboarding', 'In Progress', 'Expiring Documents', '36', 'Next 30 Days', 'Policy Acknowledgement', '96%', '+2 pp']) {
      assert.ok(sums.includes(s), `summary missing ${s}`)
    }
    const trend = await text(page, '[data-testid=card-headcount-trend]')
    assert.ok(trend.includes('Headcount Trend') && trend.includes('1,300') && trend.includes('1,100') && trend.includes('Aug') && trend.includes('Jan') && trend.includes('1,248'))
    const onb = await text(page, '[data-testid=card-onboarding]')
    for (const s of ['Onboarding Progress', '80%', '24 total', 'Completed', '19', 'In Progress', '5', 'Not Started', '0']) assert.ok(onb.includes(s), `onboarding missing ${s}`)
    const off = await text(page, '[data-testid=card-offboarding]')
    for (const s of ['Offboarding Progress', '71%', '7 total', '5', '2']) assert.ok(off.includes(s), `offboarding missing ${s}`)
    const dir = await text(page, '[data-testid=card-directory]')
    for (const s of ['Employee Directory', '1,248', 'Full-time', '1,158', 'Part-time', '52', 'Contractor', '26', 'Intern', '12']) assert.ok(dir.includes(s), `directory missing ${s}`)
    const cases = await text(page, '[data-testid=card-cases]')
    for (const s of ['Active HR Cases', '42', 'High Priority', '6', 'Medium Priority', '14', 'Low Priority', '22', 'Avg. Resolution Time', '3.4 days', '-18%']) assert.ok(cases.includes(s), `cases missing ${s}`)
    const up = await text(page, '[data-testid=card-upcoming]')
    for (const b of DASHBOARD.birthdays) assert.ok(up.includes(b.name) && up.includes(b.team), b.name)
    for (const s of ['Jan 25', 'Jan 28', 'Jan 31', 'FEB', '10', '25', 'APR', '9', 'Chinese New Year', 'EDSA People Power Day', 'Araw ng Kagitingan (Day of Valor)', 'Public Holiday']) assert.ok(up.includes(s), `upcoming missing ${s}`)
    // No demo ribbon and no data-source switch any more; eyebrow, title and the clock card on top.
    assert.equal(await page.locator('[data-testid=demo-ribbon], [data-testid=live-ribbon], [data-testid=hr-source], [data-testid=source-switch]').count(), 0)
    assert.ok(!(await text(page, '.hr-page')).includes('Fictional demo data'))
    assert.match(await text(page, 'h1'), /Welcome, Anna/)
    await page.waitForSelector('[data-testid=clock-card]')
    // Non-functional "View ..." labels are not buttons or links; "Go to Directory" is the one real link (addendum 2).
    assert.deepEqual(await page.$$eval('.hr-page button', (els) => els.map((e) => e.getAttribute('data-testid'))), ['clock-in'], 'the only button is the clock card')
    assert.equal(await page.locator('.hr-page a').count(), 1)
    assert.equal(await page.getAttribute('.hr-page a', 'href'), '/directory')
    assert.match(await text(page, '.hr-page a'), /Go to Directory/)
    assert.deepEqual(consoleErrors, [])
  }))

test('Dashboard: a non-HR employee gets the personal home, no HR dashboard, and the old /hr-administration address lands there too', opts, () =>
  withApp(async ({ page, mock }) => {
    await signIn(page, mock.origin, CARLA)
    await page.waitForSelector('[data-testid=home-my-reimbursements]')
    assert.equal(await page.locator('[data-nav-id=hr-administration]').count(), 0)
    await page.goto(`${mock.origin}/hr-administration`)
    await page.waitForSelector('[data-testid=home-my-reimbursements]')
    assert.equal(new URL(page.url()).pathname, '/')
    assert.equal(await page.locator('[data-testid=sum-headcount]').count(), 0)
    assert.ok(!mock.state.log.some((l) => l === 'GET /hr/dashboard'))
  }))

test('HR Administration: server error shows an error state with a working retry', opts, () =>
  withApp(async ({ page, mock }) => {
    mock.state.dashboardStatus = 500
    await signIn(page, mock.origin, ANNA)
    await page.waitForSelector('[data-testid=dashboard-error]')
    mock.state.dashboardStatus = 200
    await page.click('[data-testid=dashboard-error] button')
    await page.waitForSelector('[data-testid=card-upcoming]')
  }))

test('session: reload restores via /auth/me; expired access token is refreshed exactly once', opts, () =>
  withApp(async ({ page, mock }) => {
    await signIn(page, mock.origin, ANNA)
    await page.waitForSelector('[data-testid=card-upcoming]')
    mock.state.revokeAccess = true // next call 401s; refresh succeeds and un-revokes
    await page.reload()
    await page.waitForSelector('[data-testid=card-upcoming]')
    assert.equal(mock.state.refreshCalls, 1)
    assert.match(await text(page, '.profile-name'), /Anna Reyes/)
  }))

test('session: a rejected refresh logs the user out to /login', opts, () =>
  withApp(async ({ page, mock }) => {
    await signIn(page, mock.origin, ANNA)
    await page.waitForSelector('[data-testid=card-upcoming]')
    mock.state.revokeAccess = true
    mock.state.revokeRefresh = true
    await page.reload()
    await page.waitForURL(/\/login/)
    await page.waitForSelector('#email')
    assert.equal(await page.evaluate(() => localStorage.getItem('people.accessToken')), null)
  }))

test('session: unreachable API shows a retry screen, and retry recovers', opts, () =>
  withApp(async ({ page, mock }) => {
    await signIn(page, mock.origin, ANNA)
    await page.waitForSelector('[data-testid=card-upcoming]')
    mock.state.apiDown = true
    await page.reload()
    await page.waitForSelector('text=reach the Bluedge People service')
    mock.state.apiDown = false
    await page.click('button:has-text("Try again")')
    await page.waitForSelector('[data-testid=card-upcoming]')
  }))

test('sign out clears the session and returns to /login', opts, () =>
  withApp(async ({ page, mock }) => {
    await signIn(page, mock.origin, ANNA)
    await page.waitForSelector('.profile-button')
    await page.click('.profile-button')
    assert.equal(await page.locator('[role=menuitem]').count(), 1)
    await page.click('[role=menuitem]')
    await page.waitForURL(/\/login/)
    assert.equal(await page.evaluate(() => localStorage.getItem('people.accessToken')), null)
    await page.goto(`${mock.origin}/hr-administration`)
    await page.waitForURL(/\/login\?next=/)
  }))

test('sidebar: exact nav order, Reimbursements indented under HR Requests, divider before Settings', opts, () =>
  withApp(async ({ page, mock }) => {
    await signIn(page, mock.origin, ANNA)
    await page.waitForSelector('.sidebar-nav')
    const labels = await page.$$eval('.sidebar-nav .nav-link', (els) => els.map((e) => e.textContent.trim()))
    assert.deepEqual(labels, ['Dashboard', 'Dashboard', 'My Profile', 'Leave', 'Attendance & Timesheet', 'Performance & Check-ins', 'Learning & Development', 'HR Requests', 'Reimbursements', 'Documents', 'Knowledge Base', 'Company Calendar', 'Settings'])
    const subIndent = await page.$eval('[data-nav-id=reimbursements]', (e) => e.getBoundingClientRect().left)
    const parentIndent = await page.$eval('[data-nav-id=hr-requests]', (e) => e.getBoundingClientRect().left)
    assert.ok(subIndent > parentIndent + 10)
    assert.equal(await page.locator('.nav-divider-before').count(), 1)
    assert.equal(await page.$eval('.nav-divider-before .nav-link', (e) => e.textContent.trim()), 'Settings')
    assert.ok((await page.getAttribute('[data-nav-id=dashboard]', 'class')).includes('active'))
  }))

// Changed with the real HR Requests module (modules/hrcases): the card grid is now a landing page. It keeps the
// Reimbursements card and "Browse the directory" link (same test ids), adds the "New request" link, and the five
// "Coming soon" cards are gone. Cases themselves are covered by hrcases-ui.spec.mjs and e2e-hrcases.spec.mjs.
test('HR Requests: Reimbursements and Browse the directory links remain; Reimbursements opens the real list; no "coming soon" cards', opts, () =>
  withApp(async ({ page, mock }) => {
    await signIn(page, mock.origin, CARLA)
    await page.waitForSelector('[data-testid=home-my-reimbursements]')
    await page.goto(`${mock.origin}/hr-requests`)
    await page.waitForSelector('[data-testid=request-reimbursements]')
    assert.equal(await page.getAttribute('[data-testid=request-reimbursements]', 'href'), '/reimbursements')
    assert.equal(await page.getAttribute('[data-testid=browse-directory]', 'href'), '/directory')
    assert.equal(await page.getAttribute('[data-testid=new-request]', 'href'), '/hr-requests/new')
    assert.equal(await page.locator('[data-testid^=request-soon-]').count(), 0)
    assert.ok((await page.getAttribute('[data-nav-id=hr-requests]', 'class')).includes('active'))
    await page.click('[data-testid=request-reimbursements]')
    await page.waitForURL('**/reimbursements')
    await page.waitForSelector('[data-testid=reimb-list]')
    assert.match(await text(page, 'h1'), /Reimbursements/)
    assert.equal(await page.locator('[data-testid=new-reimbursement]').count(), 1)
  }))

test('every module page mounts at its route (no placeholders left) and 404 renders an honest empty state', opts, () =>
  withApp(async ({ page, mock }) => {
    await signIn(page, mock.origin, CARLA)
    await page.waitForSelector('[data-testid=home-my-reimbursements]')
    // each module is a real page now; the shared mock has no endpoints for them, so only the page shell is asserted here (their own specs cover behaviour)
    for (const [p, testid] of [['/leave', 'leave-page'], ['/attendance', 'attendance-page'], ['/performance', 'performance-page'], ['/learning', 'learning-page'], ['/settings', 'settings-page']]) {
      await page.goto(`${mock.origin}${p}`)
      await page.waitForSelector(`[data-testid=${testid}]`, { state: 'attached' })
      assert.equal(await page.locator('.empty-state-badge', { hasText: /coming soon/i }).count(), 0, `${p} must not be a coming-soon placeholder`)
    }
    await page.goto(`${mock.origin}/my-profile`)
    await page.waitForSelector('[data-testid=profile-card]')
    assert.match(await text(page, '.app-content'), /Ask HR to change this/)
    assert.match(await text(page, '[data-testid=profile-card]'), /Compliance Analyst/)
    await page.goto(`${mock.origin}/does-not-exist`)
    await page.waitForSelector('[data-testid=empty-state]')
    assert.match(await text(page, '.empty-state-title'), /can't find that page/)
  }))

for (const width of [1448, 1024, 768, 390]) {
  test(`no horizontal overflow at ${width}px (login, dashboard, other pages)`, opts, () =>
    withApp(
      async ({ page, mock }) => {
        await page.goto(`${mock.origin}/login`)
        await page.waitForSelector('#email')
        assert.ok(await noOverflow(page), `login overflows at ${width}`)
        await signIn(page, mock.origin, ANNA)
        await page.waitForSelector('[data-testid=card-upcoming]')
        await page.waitForTimeout(300)
        assert.ok(await noOverflow(page), `HR Administration overflows at ${width}`)
        // Every card must sit inside the viewport.
        const clipped = await page.evaluate(() => {
          const vw = document.documentElement.clientWidth
          return [...document.querySelectorAll('.hr-card, .upcoming-card')].filter((e) => e.getBoundingClientRect().right > vw + 1 || e.getBoundingClientRect().left < -1).length
        })
        assert.equal(clipped, 0, `cards clipped at ${width}`)
        for (const p of ['/', '/hr-requests', '/my-profile', '/leave']) {
          await page.goto(`${mock.origin}${p}`)
          await page.waitForSelector('.app-content h1')
          assert.ok(await noOverflow(page), `${p} overflows at ${width}`)
        }
      },
      { viewport: { width, height: 900 } },
    ))
}

test('mobile drawer: hidden at 390px, hamburger opens it, link/Escape/scrim close it', opts, () =>
  withApp(
    async ({ page, mock }) => {
      await signIn(page, mock.origin, ANNA)
      await page.waitForSelector('[data-testid=card-upcoming]')
      const offscreen = () => page.$eval('.sidebar', (e) => e.getBoundingClientRect().right <= 1)
      assert.equal(await offscreen(), true)
      assert.equal(await page.locator('.topbar-menu').isVisible(), true)
      await page.click('.topbar-menu')
      await page.waitForFunction(() => document.querySelector('.sidebar').getBoundingClientRect().left >= -1)
      assert.equal(await page.getAttribute('.topbar-menu', 'aria-expanded'), 'true')
      await page.click('[data-nav-id=leave]')
      await page.waitForURL('**/leave')
      await page.waitForFunction(() => document.querySelector('.sidebar').getBoundingClientRect().right <= 1)
      await page.click('.topbar-menu')
      await page.keyboard.press('Escape')
      await page.waitForFunction(() => document.querySelector('.sidebar').getBoundingClientRect().right <= 1)
      await page.click('.topbar-menu')
      await page.click('[data-testid=drawer-scrim]', { position: { x: 360, y: 400 } })
      await page.waitForFunction(() => document.querySelector('.sidebar').getBoundingClientRect().right <= 1)
    },
    { viewport: { width: 390, height: 844 } },
  ))

test('breakpoint: sidebar is fixed at 1024px and becomes a drawer at 1023px', opts, async () => {
  await withApp(
    async ({ page, mock }) => {
      await signIn(page, mock.origin, ANNA)
      await page.waitForSelector('.sidebar-nav')
      assert.equal(await page.locator('.topbar-menu').isVisible(), false)
      assert.equal(await page.$eval('.sidebar', (e) => e.getBoundingClientRect().left), 0)
    },
    { viewport: { width: 1024, height: 800 } },
  )
  await withApp(
    async ({ page, mock }) => {
      await signIn(page, mock.origin, ANNA)
      await page.waitForSelector('.topbar')
      assert.equal(await page.locator('.topbar-menu').isVisible(), true)
    },
    { viewport: { width: 1023, height: 800 } },
  )
})
