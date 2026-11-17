// Visual-fidelity helper: serves the built app + mock API and writes screenshots (fictional data).
// Usage: node tests/browser/screenshots.mjs [outDir]    (default ../docs/screenshots)
// Writes desktop (1448), tablet (768) and mobile (390) shots of: login, HR Administration, personal Dashboard,
// Employee Directory (list + profile), My Profile and Company Calendar. The Reimbursements shots come from the
// real-backend script reimb-screenshots.mjs.
import fs from 'node:fs'
import path from 'node:path'
import { distDir, frontendDir, launchBrowser, signIn } from './browser-env.mjs'
import { startMock } from './mock-api.mjs'
import { addNotification } from './mock-new-endpoints.mjs'
import { blankFields, makeRequest, receiptMeta } from './mock-reimbursements.mjs'

const outDir = path.resolve(process.argv[2] || path.join(frontendDir, '..', 'docs', 'screenshots'))
fs.mkdirSync(outDir, { recursive: true })

// A fixed "today" for the page and the mock server so the calendar and upcoming cards are reproducible.
const NOW = new Date('2026-11-16T10:00:00')
const mock = await startMock({ distDir })
mock.state.newApi.now = NOW

// Fictional requests so the personal Dashboard has something to show for the manager (Ben).
{
  const fields = blankFields()
  const set = (k, v) => (fields[k] = { value: v, source: 'extracted', extracted_value: v, confidence: 0.95, flag: null })
  set('merchant', 'Cafe Lumina (SYNTHETIC)')
  set('receipt_date', '2026-11-12')
  set('currency', 'PHP')
  set('total_amount', '1250.00')
  mock.state.reimb.requests.push(
    makeRequest({ purpose: 'Training room hardware', status: 'pending_manager', stage: 'manager', fields: JSON.parse(JSON.stringify(fields)), receipts: [receiptMeta()], allowed: { 'u-ben': ['approve', 'reject', 'clarify'] }, submitted_at: NOW.toISOString() }),
    makeRequest({ purpose: 'Team lunch', status: 'draft', employee_id: 'EMP-0002', employee: { employee_id: 'EMP-0002', name: 'Ben Cruz', department: 'Operations', job_title: 'Operations Manager' }, fields }),
  )
  for (const user of ['u-anna', 'u-ben']) {
    addNotification(mock.state, user, { title: 'Reimbursement awaiting your review', body: 'Carla Dizon submitted "Training room hardware" for your review.', link: '/reimbursements', created_at: new Date(NOW.getTime() - 5 * 60_000).toISOString() })
  }
}

const browser = await launchBrowser()
try {
  const VIEWS = [
    ['desktop-1448', 1448, 1086],
    ['tablet-768', 768, 1024],
    ['mobile-390', 390, 844],
  ]
  const settle = async (page) => {
    await page.evaluate(() => document.fonts?.ready)
    await page.waitForTimeout(500)
  }
  /** The sidebar is fixed and the top bar sticky, so Playwright's fullPage would repeat them: stretch the viewport instead. */
  const shot = async (name, page, { stretch = true, cap = 3000 } = {}) => {
    await settle(page)
    const vp = page.viewportSize()
    if (stretch) {
      const h = await page.evaluate(() => document.documentElement.scrollHeight)
      await page.setViewportSize({ width: vp.width, height: Math.min(Math.max(h, vp.height), cap) })
      await page.waitForTimeout(350)
    }
    await page.screenshot({ path: path.join(outDir, name) })
    if (stretch) await page.setViewportSize(vp)
    console.log('wrote', name)
  }
  const session = async (width, height, email) => {
    const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 })
    const page = await ctx.newPage()
    await page.clock.setFixedTime(NOW)
    if (email) {
      await signIn(page, mock.origin, email)
      await page.waitForSelector('.app-content')
    }
    return { ctx, page }
  }
  const go = async (page, p, ready) => {
    await page.goto(`${mock.origin}${p}`)
    await page.waitForSelector(ready, { state: 'attached' })
  }

  // ---- login (anonymous)
  for (const [tag, w, h] of VIEWS) {
    const { ctx, page } = await session(w, h, null)
    await page.goto(`${mock.origin}/login`)
    await page.waitForSelector('#email')
    const name = tag === 'desktop-1448' ? 'login-desktop.png' : tag === 'mobile-390' ? 'login-mobile.png' : 'login-tablet-768.png'
    await shot(name, page, { stretch: tag !== 'desktop-1448' })
    await ctx.close()
  }

  // ---- HR Administration (HR admin); the bell shows its unread dot
  for (const [tag, w, h] of VIEWS) {
    const { ctx, page } = await session(w, h, 'anna.reyes@example.test')
    await page.waitForSelector('[data-testid=card-upcoming]')
    await page.waitForSelector('[data-testid=bell-dot]')
    await shot(`hr-admin-${tag === 'desktop-1448' ? 'desktop-1448' : tag}.png`, page, { stretch: tag !== 'desktop-1448' })
    await ctx.close()
  }

  // ---- HR admin pages: directory list (HR columns), a profile, calendar
  for (const [tag, w, h] of VIEWS) {
    const { ctx, page } = await session(w, h, 'anna.reyes@example.test')
    await go(page, '/directory', '[data-testid=dir-row], [data-testid=dir-card]')
    await page.waitForSelector('[data-testid=dir-type]')
    await shot(`directory-list-${tag}.png`, page, { cap: 1700 })
    await go(page, '/directory/EMP-0002', '[data-testid=dir-profile]')
    await shot(`directory-profile-${tag}.png`, page)
    await go(page, '/company-calendar', '[data-testid=cal-cell]')
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=cal-chip], [data-testid=cal-agenda-event]').length > 0)
    await shot(`calendar-${tag}.png`, page)
    await ctx.close()
  }

  // ---- personal views (manager Ben for the Dashboard, employee Carla for My Profile)
  for (const [tag, w, h] of VIEWS) {
    const ben = await session(w, h, 'ben.cruz@example.test')
    await go(ben.page, '/', '[data-testid=card-upcoming]')
    await ben.page.waitForSelector('[data-testid=home-review-count]')
    await shot(`home-personal-${tag}.png`, ben.page)
    await ben.ctx.close()
    const carla = await session(w, h, 'carla.dizon@example.test')
    await go(carla.page, '/my-profile', '[data-testid=profile-card]')
    await shot(`my-profile-${tag}.png`, carla.page)
    await carla.ctx.close()
  }
} finally {
  await browser.close()
  await mock.close()
}
