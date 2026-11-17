// Captures the documented Reimbursements screenshots from a REAL backend run (fictional data, synthetic receipts).
//   * imported by e2e-real.spec.mjs (the "screenshots" test), or run on its own:
//       node tests/browser/reimb-screenshots.mjs [outDir]        (default ../docs/screenshots)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchBrowser, frontendDir } from './browser-env.mjs'
import { PEOPLE, startRealStack } from './real-backend.mjs'
import { actor, apiCall, apiCreate, apiDecide, apiLogin, apiSubmit, apiUpload, openRequest, seedDraft, seedSubmitted, uiUpload, waitText, waitValue } from './e2e-helpers.mjs'

export const SCREENSHOT_FILES = [
  'reimb-list-desktop.png',
  'reimb-editor-extracted-desktop.png',
  'reimb-extraction-failed-manual-desktop.png',
  'reimb-review-desktop.png',
  'reimb-list-tablet-768.png',
  'reimb-list-mobile-390.png',
  'reimb-editor-tablet-768.png',
  'reimb-editor-mobile-390.png',
  'reimb-review-tablet-768.png',
  'reimb-review-mobile-390.png',
  'home-desktop.png',
]

const F = (k) => `[data-testid=field-${k}]`

async function settle(page) {
  await page.evaluate(() => document.fonts?.ready)
  await page.waitForFunction(() => [...document.images].every((i) => i.complete))
  await page.waitForTimeout(450)
}

export async function captureReimbursementScreenshots({ browser, origin, outDir }) {
  fs.mkdirSync(outDir, { recursive: true })
  const written = []
  const actors = []
  const as = async (email, viewport) => {
    const a = await actor(browser, origin, email, viewport)
    actors.push(a)
    return a
  }
  // The sidebar is fixed and the top bar is sticky, so Playwright's fullPage would repeat them. Instead the viewport
  // is stretched to the document height and a normal screenshot is taken.
  const shoot = async (page, name, fullPage = true) => {
    await settle(page)
    const vp = page.viewportSize()
    if (fullPage) {
      const h = await page.evaluate(() => document.documentElement.scrollHeight)
      await page.setViewportSize({ width: vp.width, height: Math.min(Math.max(h, vp.height), 3200) })
      await page.waitForTimeout(300)
    }
    await page.screenshot({ path: path.join(outDir, name) })
    if (fullPage) await page.setViewportSize(vp)
    written.push(name)
  }
  try {
    const jt = await apiLogin(origin, PEOPLE.jamie)
    const mt = await apiLogin(origin, PEOPLE.miguel)
    const pt = await apiLogin(origin, PEOPLE.paolo)

    // ---- a believable list for Jamie: approved, pending finance, pending manager, clarification, draft
    const approved = await seedSubmitted(origin, PEOPLE.jamie, 'Coworking day pass', 'receipt_usd.png')
    await apiDecide(origin, mt, approved, 'approve')
    await apiDecide(origin, pt, approved, 'approve')
    const pendingFinance = await seedSubmitted(origin, PEOPLE.jamie, 'Conference hotel night', 'receipt_full.pdf')
    await apiDecide(origin, mt, pendingFinance, 'approve')
    await seedSubmitted(origin, PEOPLE.jamie, 'Stationery for the workshop', 'receipt_no_tax.png')
    const clarif = await seedSubmitted(origin, PEOPLE.jamie, 'Hardware order', 'receipt_mismatch.png')
    await apiDecide(origin, mt, clarif, 'clarify', 'Please confirm the total against the receipt.')
    await seedDraft(origin, PEOPLE.jamie, 'Team dinner (draft)')

    const jamie = await as(PEOPLE.jamie)
    await jamie.page.goto(`${origin}/reimbursements`)
    await jamie.page.waitForFunction(() => document.querySelectorAll('[data-testid=reimb-row]').length >= 5)
    await shoot(jamie.page, 'reimb-list-desktop.png')
    for (const [w, h, name] of [[768, 1024, 'reimb-list-tablet-768.png'], [390, 844, 'reimb-list-mobile-390.png']]) {
      const jv = await as(PEOPLE.jamie, { width: w, height: h })
      await jv.page.goto(`${origin}/reimbursements`)
      await jv.page.waitForFunction(() => document.querySelectorAll('[data-testid=reimb-row], [data-testid=reimb-card]').length >= 5)
      await shoot(jv.page, name)
    }

    // ---- editor with extracted values + provenance (a partial extraction, then one edit saved)
    const taxi = await seedDraft(origin, PEOPLE.jamie, 'Taxi to the Makati office', 'receipt_no_reference.png')
    await openRequest(jamie.page, origin, taxi)
    await jamie.page.waitForSelector('[data-testid=extraction-banner][data-kind=partial]')
    await jamie.page.waitForSelector('[data-testid=receipt-preview] img')
    await jamie.page.fill(F('total_amount'), '640')
    await jamie.page.click('[data-testid=save-draft]')
    await waitText(jamie.page, '[data-testid=detail-notice]', /Draft saved/)
    await waitValue(jamie.page, F('total_amount'), '640.00')
    await shoot(jamie.page, 'reimb-editor-extracted-desktop.png')

    // ---- extraction failed: banner + manual entry
    const blurry = await seedDraft(origin, PEOPLE.jamie, 'Parking (blurry photo)')
    await openRequest(jamie.page, origin, blurry)
    await uiUpload(jamie.page, 'receipt_unreadable.png')
    await jamie.page.waitForSelector('[data-testid=extraction-banner][data-kind=failed]')
    await jamie.page.waitForSelector('[data-testid=receipt-preview] img')
    await jamie.page.fill(F('merchant'), 'Fictional Parking Co')
    await jamie.page.fill(F('receipt_date'), '2026-10-16')
    await jamie.page.selectOption(F('currency'), 'PHP')
    await jamie.page.fill(F('total_amount'), '150')
    await shoot(jamie.page, 'reimb-extraction-failed-manual-desktop.png')

    // ---- tablet + mobile editor
    const lunch = await seedDraft(origin, PEOPLE.jamie, 'Client lunch', 'receipt_full.png')
    const jt768 = await as(PEOPLE.jamie, { width: 768, height: 1024 })
    await openRequest(jt768.page, origin, lunch)
    await jt768.page.waitForSelector('[data-testid=receipt-preview] img')
    await shoot(jt768.page, 'reimb-editor-tablet-768.png')
    const jm = await as(PEOPLE.jamie, { width: 390, height: 844 })
    await openRequest(jm.page, origin, lunch)
    await jm.page.waitForSelector('[data-testid=receipt-preview] img')
    await jm.page.fill(F('total_amount'), '1300')
    await shoot(jm.page, 'reimb-editor-mobile-390.png')

    // ---- reviewer view: an edited, low-confidence request for Miguel, with the audit trail
    const review = await apiCreate(origin, jt, 'Hardware for the training room')
    await apiUpload(origin, jt, review, 'receipt_mismatch.png')
    await apiCall(origin, jt, 'PATCH', `/reimbursements/${review}`, { fields: { total_amount: '990' }, notes: 'Total corrected after checking the paper receipt.' })
    const sub = await apiSubmit(origin, jt, review)
    if (sub.status !== 200) throw new Error(`seed submit failed: ${sub.status}`)
    const miguel = await as(PEOPLE.miguel)
    await openRequest(miguel.page, origin, review)
    await miguel.page.waitForSelector('[data-testid=reviewer-panel]')
    await miguel.page.waitForSelector('[data-testid=receipt-preview] img')
    await miguel.page.waitForFunction(() => document.querySelectorAll('[data-testid=audit-item]').length >= 5)
    await miguel.page.fill('[data-testid=review-comment]', 'Total checked against the receipt - fine to approve.')
    await shoot(miguel.page, 'reimb-review-desktop.png')

    const mt768 = await as(PEOPLE.miguel, { width: 768, height: 1024 })
    await openRequest(mt768.page, origin, review)
    await mt768.page.waitForSelector('[data-testid=reviewer-panel]')
    await mt768.page.waitForSelector('[data-testid=receipt-preview] img')
    await mt768.page.waitForFunction(() => document.querySelectorAll('[data-testid=audit-item]').length >= 5)
    await shoot(mt768.page, 'reimb-review-tablet-768.png')

    const mm = await as(PEOPLE.miguel, { width: 390, height: 844 })
    await openRequest(mm.page, origin, review)
    await mm.page.waitForSelector('[data-testid=reviewer-panel]')
    await mm.page.waitForSelector('[data-testid=receipt-preview] img')
    await mm.page.waitForFunction(() => document.querySelectorAll('[data-testid=audit-item]').length >= 5)
    await shoot(mm.page, 'reimb-review-mobile-390.png')

    // ---- Home for Miguel: his own reimbursements and the review queue
    await seedSubmitted(origin, PEOPLE.miguel, 'Team offsite snacks', 'receipt_usd.png')
    await seedDraft(origin, PEOPLE.miguel, 'Printer toner (draft)')
    const home = await as(PEOPLE.miguel, { width: 1448, height: 1086 })
    await home.page.goto(`${origin}/`)
    await home.page.waitForSelector('[data-testid=home-counts]')
    await home.page.waitForSelector('[data-testid=home-review-count]')
    await shoot(home.page, 'home-desktop.png', false)
  } finally {
    for (const a of actors) await a.close().catch(() => undefined)
  }
  return written
}

// ---- standalone: node tests/browser/reimb-screenshots.mjs [outDir]
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outDir = path.resolve(process.argv[2] || path.join(frontendDir, '..', 'docs', 'screenshots'))
  const stack = await startRealStack()
  const browser = await launchBrowser()
  try {
    const written = await captureReimbursementScreenshots({ browser, origin: stack.origin, outDir })
    for (const w of written) console.log('wrote', w)
  } finally {
    await browser.close()
    await stack.close()
  }
}
