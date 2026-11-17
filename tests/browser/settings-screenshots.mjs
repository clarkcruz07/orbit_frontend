// Screenshots for the Settings page and the HR dashboard (fictional mock data only).
//   node tests/browser/settings-screenshots.mjs            (in frontend/; needs a built dist/)
// Environment: SETTINGS_DIST (use another build folder), SHOT_DIR (output folder, default docs/screenshots).
// Output: settings-preferences-*, settings-hr-*, settings-users-*, hr-admin-live-* at 1448 / 768 / 390.
import path from 'node:path'
import { distDir, frontendDir, launchBrowser } from './browser-env.mjs'
import { U, startSettingsMock } from './settings-mock.mjs'

const dist = process.env.SETTINGS_DIST ? path.resolve(process.env.SETTINGS_DIST) : distDir
const out = process.env.SHOT_DIR ? path.resolve(process.env.SHOT_DIR) : path.resolve(frontendDir, '..', 'docs', 'screenshots')
const WIDTHS = [
  [1448, 'desktop-1448'],
  [768, 'tablet-768'],
  [390, 'mobile-390'],
]

async function shoot(page, name) {
  // The sidebar is fixed and the header sticky: stretch the viewport to the document height instead of fullPage.
  const h = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight))
  const size = page.viewportSize()
  await page.setViewportSize({ width: size.width, height: Math.min(Math.max(h, 600), 2400) })
  await page.waitForTimeout(250)
  await page.screenshot({ path: path.join(out, name) })
  await page.setViewportSize(size)
}

async function open(browser, mock, user, p, width, ready) {
  const ctx = await browser.newContext({ viewport: { width, height: 1000 } })
  await ctx.addInitScript((t) => localStorage.setItem('people.accessToken', t), `acc-${user.user_id}`)
  const page = await ctx.newPage()
  await page.goto(`${mock.origin}${p}`)
  await page.waitForSelector(ready, { state: 'attached' })
  await page.waitForTimeout(400)
  return { ctx, page }
}

const browser = await launchBrowser()
try {
  for (const [width, label] of WIDTHS) {
    const mock = await startSettingsMock({ distDir: dist })
    mock.state.prefs[U.anna.user_id] = { leave: false, learning: false }
    mock.state.prefsUpdatedAt[U.anna.user_id] = '2026-11-16T02:00:00Z'
    mock.state.settings.hr_can_see_mood = false
    try {
      let s = await open(browser, mock, U.anna, '/settings', width, '[data-testid=pref-switch-leave]')
      await shoot(s.page, `settings-preferences-${label}.png`)
      await s.ctx.close()

      s = await open(browser, mock, U.anna, '/settings?tab=hr', width, '[data-testid=mood-switch]')
      await shoot(s.page, `settings-hr-${label}.png`)
      await s.ctx.close()

      s = await open(browser, mock, U.anna, '/settings?tab=users', width, '[data-testid=user-row], [data-testid=user-card]')
      await shoot(s.page, `settings-users-${label}.png`)
      await s.ctx.close()

      s = await open(browser, mock, U.anna, '/settings?tab=catalogs', width, '[data-testid=catalog-leave]')
      await shoot(s.page, `settings-catalogs-${label}.png`)
      await s.ctx.close()

      // The HR dashboard (always live data; no source switch any more)
      s = await open(browser, mock, U.anna, '/', width, '[data-testid=card-upcoming]')
      await s.page.waitForTimeout(500)
      await shoot(s.page, `hr-admin-live-${label}.png`)
      await s.ctx.close()
    } finally {
      await mock.close()
    }
  }
  console.log(`screenshots written to ${out}`)
} finally {
  await browser.close()
}
