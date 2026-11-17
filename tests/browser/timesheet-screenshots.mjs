// Screenshots for the Attendance & Timesheet module -> docs/screenshots/timesheet-*.png (run: node tests/browser/timesheet-screenshots.mjs).
// Uses the self-contained mock API (timesheet-mock-api.mjs) with a fixed "now" (Wed 18 Nov 2026) and FICTIONAL people, so the
// shots are reproducible. Three widths: desktop 1448, tablet 768, mobile 390. Tall pages are captured by stretching the viewport.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchBrowser, signIn } from './browser-env.mjs'
import { EMAIL, seedDemoData, startTimesheetMock } from './timesheet-mock-api.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const outDir = path.resolve(here, '../../../docs/screenshots')
const WIDTHS = [
  ['desktop-1448', 1448, 1000],
  ['tablet-768', 768, 1100],
  ['mobile-390', 390, 844],
]
const MON = '2026-11-16'

async function shot(page, file, { selector, maxHeight = 2600 } = {}) {
  const vw = page.viewportSize().width
  if (selector) {
    const box = await page.locator(selector).first().boundingBox()
    const top = Math.max(0, box.y + (await page.evaluate(() => window.scrollY)))
    const h = Math.min(Math.ceil(box.height) + 24, maxHeight)
    await page.setViewportSize({ width: vw, height: Math.max(900, Math.ceil(top + h)) })
    await page.waitForTimeout(250)
    await page.screenshot({ path: path.join(outDir, file), clip: { x: 0, y: Math.max(0, top - 12), width: vw, height: h } })
    return
  }
  const height = Math.min(await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)), maxHeight)
  await page.setViewportSize({ width: vw, height: Math.max(700, height) })
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(250)
  await page.screenshot({ path: path.join(outDir, file) })
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true })
  const browser = await launchBrowser()
  const mock = await startTimesheetMock()
  seedDemoData(mock)
  try {
    for (const [label, width, height] of WIDTHS) {
      const as = async (who, url, ready) => {
        const ctx = await browser.newContext({ viewport: { width, height } })
        const page = await ctx.newPage()
        await signIn(page, mock.origin, EMAIL[who])
        await page.waitForSelector('.app-content')
        await page.goto(`${mock.origin}${url}`)
        await page.waitForSelector(ready)
        await page.waitForTimeout(400)
        return { ctx, page }
      }
      // 1. Today: clocked in with the live timer, then the month view.
      {
        const { ctx, page } = await as('jamie', '/attendance', '[data-testid=month-view]')
        await shot(page, `timesheet-today-${label}.png`, { maxHeight: width > 700 ? 1250 : 1500 })
        await page.setViewportSize({ width, height })
        await page.evaluate(() => window.scrollTo(0, 0))
        await shot(page, `timesheet-month-${label}.png`, { selector: '[data-testid=month-view]', maxHeight: width > 700 ? 1500 : 2300 })
        await ctx.close()
      }
      // 2. Timesheet grid (rows, totals, one validation message shown on desktop/tablet).
      {
        const { ctx, page } = await as('jamie', `/attendance?tab=timesheet&week=${MON}`, '[data-testid=sheet]')
        await page.fill('[data-testid=cell-TC-TRAINING-2026-11-19]', '2.3')
        await page.waitForTimeout(150)
        await shot(page, `timesheet-grid-${label}.png`, { maxHeight: width > 700 ? 1900 : 3300 })
        await ctx.close()
      }
      // 3. Approvals (the manager's queue).
      {
        const { ctx, page } = await as('miguel', '/attendance?tab=approvals', '[data-testid=queue-row], [data-testid=queue-card]')
        await shot(page, `timesheet-approvals-${label}.png`, { maxHeight: 1500 })
        await ctx.close()
      }
    }
    console.log(`screenshots written to ${outDir}`)
  } finally {
    await mock.close()
    await browser.close()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
