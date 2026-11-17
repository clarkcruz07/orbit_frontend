// REAL-BACKEND end-to-end suite. Starts the real backend (backend/.venv python + uvicorn, in-memory DB, demo auth ON,
// demo OCR provider, temp storage, random port) and a tiny node server that serves frontend/dist and proxies /api,
// then drives real system Chrome through the reimbursement workflow with the synthetic receipts only.
// Gated: RUN_BROWSER_TESTS=1 (use `npm run test:browser`). No external service is contacted; Gemini stays OFF.
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { launchBrowser } from './browser-env.mjs'
import { PEOPLE, receiptPath, startRealStack } from './real-backend.mjs'
import {
  actor,
  apiCall,
  apiDecide,
  apiLogin,
  openRequest,
  pageApi,
  seedDraft,
  seedSubmitted,
  text,
  uiCreate,
  uiDecide,
  uiSubmit,
  uiSubmitFull,
  uiUpload,
  waitGone,
  waitText,
  waitValue,
} from './e2e-helpers.mjs'
import { captureReimbursementScreenshots, SCREENSHOT_FILES } from './reimb-screenshots.mjs'

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

/** Signs an actor in and registers it for cleanup even when the test fails half-way. */
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

const F = (k) => `[data-testid=field-${k}]`
const prov = (page, k) => text(page, `[data-testid=prov-${k}]`)

// ------------------------------------------------------------------------------------------------ the main journey
test('E2E: Jamie creates, uploads, reviews, saves and submits; Miguel (manager) approves; Paolo (finance) approves; audit trail shows every step', opts, async () => {
  const purpose = 'E2E happy path lunch'
  const jamie = await as(PEOPLE.jamie)
  const jp = jamie.page
  // Employees land on the personal Dashboard, with their own card and no review card.
  await jp.waitForSelector('[data-testid=home-my-reimbursements]')
  assert.equal(new URL(jp.url()).pathname, '/')
  assert.equal(await jp.locator('[data-testid=home-awaiting-review]').count(), 0, 'no review queue, no review card')
  await jp.click('[data-nav-id=reimbursements]')
  await jp.waitForSelector('[data-testid=reimb-list]')
  assert.equal(await jp.locator('[data-testid=placeholder-notice]').count(), 0)
  assert.equal(await jp.locator('[data-testid^=tab-]').count(), 1, 'an employee has one tab')
  await jp.click('[data-testid=new-reimbursement]')
  await jp.waitForURL('**/reimbursements/new')

  const id = await uiCreate(jp, origin, purpose)
  assert.match(await prov(jp, 'merchant'), /Not entered/, 'before any extraction nothing claims to be "not found"')
  assert.equal(await jp.inputValue(F('merchant')), '')

  assert.equal(await uiUpload(jp, 'receipt_full.png'), 201)
  await jp.waitForSelector('[data-testid=extraction-banner][data-kind=ok]')
  assert.equal(await jp.inputValue(F('merchant')), 'Cafe Lumina (SYNTHETIC)')
  assert.equal(await jp.inputValue(F('receipt_date')), '2026-10-12')
  assert.equal(await jp.inputValue(F('currency')), 'PHP')
  assert.equal(await jp.inputValue(F('total_amount')), '1250.00')
  assert.equal(await jp.inputValue(F('tax_amount')), '133.93')
  assert.equal(await jp.inputValue(F('receipt_reference')), 'SYN-0001')
  for (const k of ['merchant', 'receipt_date', 'currency', 'total_amount', 'tax_amount', 'receipt_reference']) assert.match(await prov(jp, k), /^Extracted$/, k)
  await jp.waitForSelector('[data-testid=receipt-preview] img')
  assert.ok(await jp.$eval('[data-testid=receipt-preview] img', (img) => img.complete && img.naturalWidth > 0), 'the receipt image really renders (authorised blob fetch)')
  assert.match(await text(jp, '[data-testid=extraction-line]'), /demo-deterministic \(demo\)/)

  // Correct a value and add a note, then save.
  await jp.fill(F('total_amount'), '1,300')
  await jp.fill('[data-testid=field-notes]', 'Lunch with a client (synthetic).')
  assert.match(await prov(jp, 'total_amount'), /Edited by you/)
  await jp.click('[data-testid=save-draft]')
  await waitText(jp, '[data-testid=detail-notice]', /Draft saved/)
  await waitValue(jp, F('total_amount'), '1300.00')
  assert.match(await text(jp, '[data-testid=orig-total_amount]'), /Extracted:\s*1250\.00/)
  // Persisted on the server: a full reload shows the same thing.
  await jp.reload()
  await jp.waitForSelector(F('total_amount'))
  await waitValue(jp, F('total_amount'), '1300.00')
  assert.match(await prov(jp, 'total_amount'), /Edited by you/)
  assert.match(await text(jp, '[data-testid=orig-total_amount]'), /1250\.00/)
  assert.equal(await jp.inputValue('[data-testid=field-notes]'), 'Lunch with a client (synthetic).')

  // Submit needs the explicit confirmation.
  assert.equal(await jp.locator('[data-testid=submit-request]').isDisabled(), true)
  await uiSubmit(jp)
  assert.match(await text(jp, '[data-testid=status-pill]'), /Pending manager/)
  assert.equal(await jp.locator('[data-testid=save-draft], [data-testid=receipt-dropzone], [data-testid=submit-request]').count(), 0, 'read-only after submit')
  await done(jamie)

  // Manager Miguel sees it on Home and in the review tab, and sees extracted vs edited.
  const miguel = await as(PEOPLE.miguel)
  const mp = miguel.page
  await mp.waitForSelector('[data-testid=home-review-count]')
  assert.ok(Number(await mp.getAttribute('[data-testid=home-review-count]', 'data-count')) >= 1)
  assert.match(await text(mp, '[data-testid=home-awaiting-review]'), /Jamie Dela Cruz/)
  await mp.click('[data-testid=home-view-review]')
  await mp.waitForSelector('[data-testid=tab-review][aria-selected=true]')
  const row = mp.locator('[data-testid=reimb-row]', { hasText: purpose })
  await row.waitFor()
  assert.match(await row.innerText(), /Jamie Dela Cruz/)
  await row.locator('[data-testid=reimb-open]').click()
  await mp.waitForSelector('[data-testid=reviewer-panel]')
  assert.equal(new URL(mp.url()).pathname, `/reimbursements/${id}`)
  assert.match(await text(mp, '[data-testid=ro-source-total_amount]'), /Edited by employee/)
  assert.match(await text(mp, '[data-testid=ro-value-total_amount]'), /PHP 1,300\.00/)
  assert.match(await text(mp, '[data-testid=ro-orig-total_amount]'), /PHP 1,250\.00/)
  assert.match(await text(mp, '[data-testid=ro-source-merchant]'), /^Extracted$/)
  assert.match(await text(mp, '[data-testid=ro-notes]'), /Lunch with a client/)
  assert.match(await text(mp, '[data-testid=readonly-fields]'), /demo-deterministic/)
  assert.equal(await mp.locator('[data-testid=field-merchant]').count(), 0, 'a reviewer cannot edit')
  assert.match(await text(mp, '[data-testid=no-payment-note]'), /Approving does not trigger any payment/)
  await uiDecide(mp, 'approve')
  await waitText(mp, '[data-testid=status-pill]', /Pending finance/)
  assert.match(await text(mp, '[data-testid=decision-timeline]'), /Approved/)
  assert.match(await text(mp, '[data-testid=decision-timeline]'), /Miguel Santos/)
  await done(miguel)

  // Finance Paolo approves.
  const paolo = await as(PEOPLE.paolo)
  const pp = paolo.page
  await pp.goto(`${origin}/reimbursements?tab=review`)
  const prow = pp.locator('[data-testid=reimb-row]', { hasText: purpose })
  await prow.waitFor()
  await prow.locator('[data-testid=reimb-open]').click()
  await pp.waitForSelector('[data-testid=reviewer-panel]')
  assert.match(await text(pp, '[data-testid=reviewer-panel]'), /Finance review/)
  await uiDecide(pp, 'approve')
  await waitText(pp, '[data-testid=status-pill]', /Approved/)
  assert.equal(await pp.locator('[data-testid=reviewer-panel]').count(), 0)
  assert.equal(await pp.locator('[data-testid=decision-item]').count(), 2)
  // The audit trail shows each step, in order, with who did it.
  await waitText(pp, '[data-testid=audit-trail]', /Approved \(Finance review\)/)
  const events = await pp.$$eval('[data-testid=audit-item]', (els) => els.map((e) => ({ action: e.dataset.action, text: e.textContent })))
  const significant = events.filter((e) => e.action !== 'reimbursement.receipt_downloaded')
  assert.deepEqual(
    significant.map((e) => e.action),
    ['reimbursement.created', 'reimbursement.receipt_uploaded', 'reimbursement.extraction_completed', 'reimbursement.updated', 'reimbursement.submitted', 'reimbursement.decided', 'reimbursement.decided'],
  )
  assert.match(significant[4].text, /Submitted - now pending manager/)
  assert.match(significant[4].text, /Jamie Dela Cruz/)
  assert.match(significant[5].text, /Approved \(Manager review\).*Miguel Santos/)
  assert.match(significant[6].text, /Approved \(Finance review\).*You/)
  await done(paolo)

  // Jamie sees the outcome on the request, in the list and on Home.
  const jamie2 = await as(PEOPLE.jamie)
  await openRequest(jamie2.page, origin, id)
  await jamie2.page.waitForSelector('[data-testid=reimb-detail][data-mode=readonly]')
  assert.match(await text(jamie2.page, '[data-testid=status-pill]'), /Approved/)
  assert.equal(await jamie2.page.locator('[data-testid=decision-item]').count(), 2)
  assert.equal(await jamie2.page.locator('[data-testid=reviewer-panel]').count(), 0)
  assert.equal(await jamie2.page.locator('[data-testid=placeholder-notice]').count(), 0)
  await jamie2.page.goto(`${origin}/`)
  await jamie2.page.waitForSelector('[data-testid=home-counts]')
  assert.ok(Number(await jamie2.page.getAttribute('[data-testid=home-counts] li[data-status=approved]', 'data-count')) >= 1)
  await done(jamie2)

  // HR Admin Anna can look but has no controls at all.
  const anna = await as(PEOPLE.anna)
  await anna.page.waitForSelector('[data-testid=card-upcoming]')
  await anna.page.goto(`${origin}/reimbursements?tab=all`)
  const arow = anna.page.locator('[data-testid=reimb-row]', { hasText: purpose })
  await arow.waitFor()
  await arow.locator('[data-testid=reimb-open]').click()
  await anna.page.waitForSelector('[data-testid=reimb-detail][data-mode=readonly]')
  assert.equal(await anna.page.locator('[data-testid=reviewer-panel], [data-testid^=review-], [data-testid=save-draft], [data-testid=receipt-dropzone], [data-testid=submit-request]').count(), 0)
  await anna.page.waitForSelector('[data-testid=audit-item]')
  assert.ok((await anna.page.locator('[data-testid=audit-item]').count()) >= 7, 'HR oversight includes the audit trail')
  await done(anna)
})

// ------------------------------------------------------------------------------------------------ receipt variants
test('E2E receipts: no tax / no reference -> partial extraction leaves those fields empty and the request still submits', opts, async () => {
  const jamie = await as(PEOPLE.jamie)
  const p = jamie.page
  for (const [fixture, empty, filled] of [
    ['receipt_no_tax.png', 'tax_amount', 'receipt_reference'],
    ['receipt_no_reference.png', 'receipt_reference', 'tax_amount'],
  ]) {
    const id = await uiCreate(p, origin, `E2E partial ${fixture}`)
    assert.equal(await uiUpload(p, fixture), 201)
    await p.waitForSelector('[data-testid=extraction-banner][data-kind=partial]')
    assert.equal(await p.inputValue(F(empty)), '', `${empty} is left empty, never guessed`)
    assert.match(await prov(p, empty), /Not found/)
    assert.match(await text(p, `[data-testid=hint-${empty}]`), /Not found on receipt - please enter/)
    assert.notEqual(await p.inputValue(F(filled)), '')
    assert.match(await text(p, '[data-testid=extraction-banner]'), /left empty rather than guessed/)
    await uiSubmit(p) // tax and reference are optional
    assert.match(await text(p, '[data-testid=status-pill]'), /Pending manager/)
    assert.match(await text(p, `[data-testid=ro-value-${empty}]`), /Not provided/)
    assert.match(await text(p, `[data-testid=ro-orig-${empty}]`), /Not found/)
    assert.ok(id)
  }
  await done(jamie)
})

test('E2E receipts: no date -> the date stays empty, submit is blocked until it is entered, and it shows as entered by the employee', opts, async () => {
  const jamie = await as(PEOPLE.jamie)
  const p = jamie.page
  const id = await uiCreate(p, origin, 'E2E no date')
  assert.equal(await uiUpload(p, 'receipt_no_date.png'), 201)
  await p.waitForSelector('[data-testid=extraction-banner][data-kind=partial]')
  assert.equal(await p.inputValue(F('receipt_date')), '')
  assert.match(await text(p, '[data-testid=hint-receipt_date]'), /Not found on receipt - please enter/)
  await p.check('[data-testid=confirm-check]')
  await p.click('[data-testid=submit-request]')
  await p.waitForSelector('[data-testid=err-receipt_date]')
  assert.match(await text(p, '[data-testid=err-receipt_date]'), /Required before you can submit/)
  const token = await apiLogin(origin, PEOPLE.jamie)
  assert.equal((await apiCall(origin, token, 'GET', `/reimbursements/${id}`)).json.status, 'draft', 'nothing was submitted')
  // A date from the future is refused by the real validator and shown next to the field.
  await p.fill(F('receipt_date'), '2999-01-01')
  assert.match(await text(p, '[data-testid=err-receipt_date]'), /cannot be in the future/)
  await p.fill(F('receipt_date'), '2026-10-14')
  assert.match(await prov(p, 'receipt_date'), /Entered by you/)
  await p.click('[data-testid=submit-request]')
  await p.waitForSelector('[data-testid=reimb-detail][data-mode=readonly]')
  assert.match(await text(p, '[data-testid=ro-source-receipt_date]'), /Entered by employee/)
  assert.match(await text(p, '[data-testid=ro-value-receipt_date]'), /14 Oct 2026/)
  await done(jamie)
})

test('E2E receipts: mismatching synthetic receipt shows low confidence, and edits keep the original extracted value for the reviewer', opts, async () => {
  const jamie = await as(PEOPLE.jamie)
  const p = jamie.page
  const id = await uiCreate(p, origin, 'E2E low confidence')
  assert.equal(await uiUpload(p, 'receipt_mismatch.png'), 201)
  await p.waitForSelector('[data-testid=low-total_amount]')
  assert.match(await p.getAttribute('[data-testid=low-total_amount]', 'title'), /41%/)
  await p.fill(F('total_amount'), '990')
  assert.match(await text(p, '[data-testid=orig-total_amount]'), /Extracted:\s*980\.00 \(low confidence\)/)
  await uiSubmit(p)
  await done(jamie)
  const miguel = await as(PEOPLE.miguel)
  await openRequest(miguel.page, origin, id)
  await miguel.page.waitForSelector('[data-testid=ro-low-total_amount]')
  assert.match(await text(miguel.page, '[data-testid=ro-orig-total_amount]'), /PHP 980\.00/)
  assert.match(await text(miguel.page, '[data-testid=ro-value-total_amount]'), /PHP 990\.00/)
  await done(miguel)
})

test('E2E receipts: unreadable receipt -> clear failure banner, receipt kept, manual entry path submits and reads as "entered by employee"', opts, async () => {
  const jamie = await as(PEOPLE.jamie)
  const p = jamie.page
  const id = await uiCreate(p, origin, 'E2E manual entry')
  assert.equal(await uiUpload(p, 'receipt_unreadable.png'), 201, 'the file is stored even though it cannot be read')
  await p.waitForSelector('[data-testid=extraction-banner][data-kind=failed]')
  const banner = await text(p, '[data-testid=extraction-banner]')
  assert.match(banner, /couldn't read this receipt/i)
  assert.match(banner, /type the details yourself/i)
  assert.ok(!banner.includes('unreadable_receipt'))
  assert.match(await text(p, '[data-testid=receipt-name]'), /receipt_unreadable\.png/)
  for (const k of ['merchant', 'receipt_date', 'total_amount']) assert.equal(await p.inputValue(F(k)), '')
  assert.match(await text(p, '[data-testid=hint-merchant]'), /Couldn't be read from the receipt - please enter/)
  await p.fill(F('merchant'), 'Fictional Ride Co')
  await p.fill(F('receipt_date'), '2026-10-15')
  await p.selectOption(F('currency'), 'USD')
  await p.fill(F('total_amount'), '42.50')
  await p.click('[data-testid=save-draft]')
  await waitText(p, '[data-testid=detail-notice]', /Draft saved/)
  await waitValue(p, F('total_amount'), '42.50')
  for (const k of ['merchant', 'receipt_date', 'currency', 'total_amount']) assert.match(await prov(p, k), /Entered by you/, k)
  // Re-running extraction on an unreadable file fails again but never wipes what was typed.
  await p.click('[data-testid=rerun-extraction]')
  await p.waitForFunction(() => document.querySelector('[data-testid=rerun-extraction]')?.textContent.includes('Re-run extraction'))
  assert.equal(await p.inputValue(F('merchant')), 'Fictional Ride Co')
  assert.equal(await p.getAttribute('[data-testid=extraction-banner]', 'data-kind'), 'failed')
  await uiSubmit(p)
  for (const k of ['merchant', 'receipt_date', 'currency', 'total_amount']) assert.match(await text(p, `[data-testid=ro-source-${k}]`), /Entered by employee/, k)
  assert.ok(id)
  await done(jamie)
})

test('E2E receipts: wrong file types and fake images are rejected by the server inline and nothing is stored', opts, async () => {
  const jamie = await as(PEOPLE.jamie)
  const p = jamie.page
  const id = await uiCreate(p, origin, 'E2E rejected files')
  const bad = [
    { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not a receipt') },
    { name: 'fake.png', mimeType: 'image/png', buffer: Buffer.from('this is text pretending to be a png') },
    { name: 'empty.png', mimeType: 'image/png', buffer: Buffer.alloc(0) },
    { name: 'macro.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('MZ') },
  ]
  for (const file of bad) {
    const status = await uiUpload(p, file)
    assert.ok([400, 415].includes(status), `${file.name} -> ${status}`)
    await p.waitForSelector('[data-testid=upload-error]')
    assert.match(await text(p, '[data-testid=upload-error]'), /Nothing was stored/)
    assert.equal(await p.locator('[data-testid=receipt-current]').count(), 0, `${file.name} must not become the receipt`)
  }
  assert.match(await text(p, '[data-testid=upload-error]'), /empty|Unsupported/i)
  const token = await apiLogin(origin, PEOPLE.jamie)
  const stored = await apiCall(origin, token, 'GET', `/reimbursements/${id}`)
  assert.deepEqual(stored.json.receipts, [], 'the server stored nothing')
  assert.equal(stored.json.extraction, null)
  // The page is still usable: a real receipt works afterwards, and the error is gone.
  assert.equal(await uiUpload(p, 'receipt_usd.png'), 201)
  await waitGone(p, '[data-testid=upload-error]')
  await p.waitForSelector('[data-testid=receipt-current]')
  assert.equal(await p.inputValue(F('currency')), 'USD')
  await done(jamie)
})

test('E2E receipts: a PDF receipt is extracted, shown as a PDF tile, and downloaded through the authorised fetch', opts, async () => {
  const jamie = await as(PEOPLE.jamie)
  const p = jamie.page
  await uiCreate(p, origin, 'E2E pdf receipt')
  assert.equal(await uiUpload(p, 'receipt_full.pdf'), 201)
  await p.waitForSelector('[data-testid=extraction-banner][data-kind=ok]')
  assert.equal(await p.inputValue(F('merchant')), 'Harbour View Hotel (SYNTHETIC)')
  assert.match(await text(p, '[data-testid=receipt-preview]'), /PDF/)
  assert.equal(await p.locator('[data-testid=receipt-preview] img').count(), 0)
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('[data-testid=receipt-download]')])
  assert.equal(dl.suggestedFilename(), 'receipt_full.pdf')
  const file = await dl.path()
  assert.ok(fs.readFileSync(file).subarray(0, 5).toString() === '%PDF-', 'the downloaded bytes are the stored PDF')
  await done(jamie)
})

test('E2E receipts: re-run extraction only suggests values: edits survive and the original extracted value is still shown', opts, async () => {
  const jamie = await as(PEOPLE.jamie)
  const p = jamie.page
  await uiCreate(p, origin, 'E2E rerun')
  await uiUpload(p, 'receipt_full.png')
  await p.waitForSelector('[data-testid=extraction-banner][data-kind=ok]')
  await p.fill(F('merchant'), 'Cafe Edited By Me')
  await p.click('[data-testid=rerun-extraction]') // unsaved edits are saved first, then extraction re-runs
  await p.waitForFunction(() => document.querySelector('[data-testid=rerun-extraction]')?.textContent.includes('Re-run extraction'))
  await waitValue(p, F('merchant'), 'Cafe Edited By Me')
  assert.match(await prov(p, 'merchant'), /Edited by you/)
  assert.match(await text(p, '[data-testid=orig-merchant]'), /Cafe Lumina \(SYNTHETIC\)/)
  assert.match(await prov(p, 'total_amount'), /^Extracted$/)
  assert.match(await text(p, '.r-rerun'), /Only suggests values/)
  await done(jamie)
})

// ------------------------------------------------------------------------------------------------ permissions
test('E2E permissions: other employees and managers cannot even see a request; employees cannot decide or reach the review list', opts, async () => {
  const submitted = await seedSubmitted(origin, PEOPLE.jamie, 'E2E perms submitted')
  const draft = await seedDraft(origin, PEOPLE.jamie, 'E2E perms private draft', 'receipt_full.png')

  // Lia reports to a different manager: the request does not exist for her (404 view, 404 from the API).
  const lia = await as(PEOPLE.lia)
  await openRequest(lia.page, origin, submitted)
  await lia.page.waitForSelector('[data-testid=detail-missing]')
  assert.match(await text(lia.page, '[data-testid=detail-missing]'), /can't find that request/)
  assert.equal((await pageApi(lia.page, origin, 'GET', `/reimbursements/${submitted}`)).status, 404)
  assert.equal((await pageApi(lia.page, origin, 'POST', `/reimbursements/${submitted}/decision`, { action: 'approve' })).status, 404)
  await lia.page.goto(`${origin}/reimbursements`)
  await lia.page.waitForSelector('[data-testid=empty-state], [data-testid=reimb-row]')
  assert.equal(await lia.page.locator('[data-testid=reimb-row]', { hasText: 'E2E perms' }).count(), 0)
  await done(lia)

  // Carla is a manager, but not Jamie's.
  const carla = await as(PEOPLE.carla)
  await openRequest(carla.page, origin, submitted)
  await carla.page.waitForSelector('[data-testid=detail-missing]')
  assert.equal((await pageApi(carla.page, origin, 'GET', `/reimbursements/${submitted}`)).status, 404)
  assert.equal((await pageApi(carla.page, origin, 'POST', `/reimbursements/${submitted}/decision`, { action: 'approve' })).status, 404)
  await carla.page.goto(`${origin}/reimbursements?tab=review`)
  await carla.page.waitForSelector('[data-testid=tab-review][aria-selected=true]')
  await carla.page.waitForSelector('[data-testid=empty-state], [data-testid=reimb-row]')
  assert.equal(await carla.page.locator('[data-testid=reimb-row]', { hasText: 'E2E perms' }).count(), 0)
  await carla.page.click('[data-testid=tab-all]')
  await carla.page.waitForSelector('[data-testid=empty-state], [data-testid=reimb-row]')
  assert.equal(await carla.page.locator('[data-testid=reimb-row]', { hasText: 'E2E perms' }).count(), 0)
  await done(carla)

  // Jamie (employee): no review tab, a forced ?tab=review falls back, server refuses scopes and decisions.
  const jamie = await as(PEOPLE.jamie)
  const jp = jamie.page
  await jp.goto(`${origin}/reimbursements?tab=review`)
  await jp.waitForSelector('[data-testid=reimb-list]')
  assert.equal(await jp.locator('[data-testid=tab-review], [data-testid=tab-all]').count(), 0)
  assert.equal(await jp.locator('[data-testid=tab-mine]').getAttribute('aria-selected'), 'true')
  assert.equal((await pageApi(jp, origin, 'GET', '/reimbursements?scope=review')).status, 403)
  assert.equal((await pageApi(jp, origin, 'GET', '/reimbursements?scope=all')).status, 403)
  const own = await pageApi(jp, origin, 'POST', `/reimbursements/${submitted}/decision`, { action: 'approve' })
  assert.equal(own.status, 403, 'an employee cannot approve (not even their own request)')
  assert.equal((await pageApi(jp, origin, 'GET', `/reimbursements/${submitted}`)).json.status, 'pending_manager', 'nothing changed')
  await openRequest(jp, origin, submitted)
  assert.equal(await jp.locator('[data-testid=reviewer-panel]').count(), 0)
  assert.equal(await jp.locator('[data-testid=reimb-detail]').getAttribute('data-mode'), 'readonly')
  assert.equal((await pageApi(jp, origin, 'PATCH', `/reimbursements/${submitted}`, { purpose: 'sneaky edit' })).status, 409, 'a submitted request cannot be edited')
  await done(jamie)

  // A never-submitted draft is private to its owner: manager and HR get the 404 view.
  for (const who of [PEOPLE.miguel, PEOPLE.anna]) {
    const a = await as(who)
    await openRequest(a.page, origin, draft)
    await a.page.waitForSelector('[data-testid=detail-missing]')
    assert.equal((await pageApi(a.page, origin, 'GET', `/reimbursements/${draft}`)).status, 404)
    await done(a)
  }

  // Finance cannot see a request that has not reached the Finance stage.
  const paolo = await as(PEOPLE.paolo)
  await openRequest(paolo.page, origin, submitted)
  await paolo.page.waitForSelector('[data-testid=detail-missing]')
  assert.equal((await pageApi(paolo.page, origin, 'POST', `/reimbursements/${submitted}/decision`, { action: 'approve' })).status, 404)
  await done(paolo)
})

test('E2E permissions: HR Admin can view but has no decision or edit controls, and the server refuses both', opts, async () => {
  const id = await seedSubmitted(origin, PEOPLE.jamie, 'E2E perms HR oversight')
  const anna = await as(PEOPLE.anna)
  await openRequest(anna.page, origin, id)
  await anna.page.waitForSelector('[data-testid=reimb-detail]')
  assert.equal(await anna.page.locator('[data-testid=reimb-detail]').getAttribute('data-mode'), 'readonly')
  assert.equal(await anna.page.locator('[data-testid=reviewer-panel], [data-testid^=review-], [data-testid=save-draft], [data-testid=receipt-dropzone], [data-testid=submit-request]').count(), 0)
  await anna.page.waitForSelector('[data-testid=readonly-fields]')
  assert.equal((await pageApi(anna.page, origin, 'POST', `/reimbursements/${id}/decision`, { action: 'approve' })).status, 403)
  assert.equal((await pageApi(anna.page, origin, 'PATCH', `/reimbursements/${id}`, { purpose: 'HR edit' })).status, 403)
  assert.equal((await pageApi(anna.page, origin, 'POST', `/reimbursements/${id}/submit`, { confirm_fields: true })).status, 403)
  assert.equal((await pageApi(anna.page, origin, 'GET', '/reimbursements?scope=review')).status, 403, 'HR has no review queue')
  await anna.page.goto(`${origin}/reimbursements`)
  await anna.page.waitForSelector('[data-testid=tab-all]')
  assert.equal(await anna.page.locator('[data-testid=tab-review]').count(), 0)
  await done(anna)
})

test('E2E permissions: nobody decides their own request (manager and finance included)', opts, async () => {
  // Miguel (Manager) files his own request and gets no decision controls on it.
  const miguel = await as(PEOPLE.miguel)
  const mp = miguel.page
  const own = await uiSubmitFull(mp, origin, 'E2E manager own request')
  assert.equal(await mp.locator('[data-testid=reviewer-panel]').count(), 0)
  assert.equal((await pageApi(mp, origin, 'POST', `/reimbursements/${own}/decision`, { action: 'approve' })).status, 403)
  await mp.goto(`${origin}/reimbursements?tab=review`)
  await mp.waitForSelector('[data-testid=tab-review][aria-selected=true]')
  await mp.waitForSelector('[data-testid=empty-state], [data-testid=reimb-row]')
  assert.equal(await mp.locator('[data-testid=reimb-row]', { hasText: 'E2E manager own request' }).count(), 0, 'own request is not in the review queue')
  await mp.click('[data-testid=tab-all]')
  await mp.locator('[data-testid=reimb-row]', { hasText: 'E2E manager own request' }).waitFor()
  await done(miguel)

  // Paolo (Finance) files his own request; his manager approves it; at the Finance stage he still cannot decide it.
  const paolo = await as(PEOPLE.paolo)
  const pp = paolo.page
  const paolos = await uiSubmitFull(pp, origin, 'E2E finance own request')
  const miguel2 = await as(PEOPLE.miguel)
  await openRequest(miguel2.page, origin, paolos)
  await uiDecide(miguel2.page, 'approve')
  await waitText(miguel2.page, '[data-testid=status-pill]', /Pending finance/)
  await done(miguel2)
  await openRequest(pp, origin, paolos)
  await waitText(pp, '[data-testid=status-pill]', /Pending finance/)
  assert.equal(await pp.locator('[data-testid=reviewer-panel]').count(), 0, 'no decision controls on his own request')
  assert.equal((await pageApi(pp, origin, 'POST', `/reimbursements/${paolos}/decision`, { action: 'approve' })).status, 403)
  await pp.goto(`${origin}/reimbursements?tab=review`)
  await pp.waitForSelector('[data-testid=tab-review][aria-selected=true]')
  await pp.waitForSelector('[data-testid=empty-state], [data-testid=reimb-row]')
  assert.equal(await pp.locator('[data-testid=reimb-row]', { hasText: 'E2E finance own request' }).count(), 0)
  await done(paolo)
})

// ------------------------------------------------------------------------------------------------ clarification + rejection
test('E2E clarification round trip: manager asks, employee edits and resubmits to the same stage; finance asks, resubmit returns to Finance; then approved', opts, async () => {
  const purpose = 'E2E clarification round trip'
  const jamie = await as(PEOPLE.jamie)
  const jp = jamie.page
  const id = await uiSubmitFull(jp, origin, purpose)
  await done(jamie)

  // Manager asks for clarification; a comment is required.
  const miguel = await as(PEOPLE.miguel)
  const mp = miguel.page
  await openRequest(mp, origin, id)
  await mp.waitForSelector('[data-testid=reviewer-panel]')
  assert.equal(await mp.locator('[data-testid=review-clarify]').isDisabled(), true, 'a comment is required to ask for clarification')
  assert.equal(await mp.locator('[data-testid=review-reject]').isDisabled(), true)
  await uiDecide(mp, 'clarify', 'Please double check the tax amount.')
  await waitText(mp, '[data-testid=status-pill]', /Clarification requested/)
  assert.match(await text(mp, '[data-testid=decision-timeline]'), /Please double check the tax amount/)
  await done(miguel)

  // Jamie sees the comment and can edit again; the resubmission returns to the manager stage.
  const jamie2 = await as(PEOPLE.jamie)
  const j2 = jamie2.page
  await openRequest(j2, origin, id)
  await j2.waitForSelector('[data-testid=reimb-detail][data-mode=editor]')
  assert.match(await text(j2, '[data-testid=clarification-card]'), /Please double check the tax amount/)
  assert.match(await text(j2, '[data-testid=clarification-card]'), /Miguel Santos/)
  await j2.fill(F('tax_amount'), '120')
  await j2.fill('[data-testid=field-notes]', 'Checked: the tax was corrected.')
  await j2.click('[data-testid=save-draft]')
  await waitValue(j2, F('tax_amount'), '120.00')
  assert.match(await prov(j2, 'tax_amount'), /Edited by you/)
  await uiSubmit(j2)
  assert.match(await text(j2, '[data-testid=status-pill]'), /Pending manager/)
  await done(jamie2)

  // Manager approves (-> Finance), Finance asks for clarification.
  const miguel2 = await as(PEOPLE.miguel)
  await openRequest(miguel2.page, origin, id)
  assert.match(await text(miguel2.page, '[data-testid=ro-source-tax_amount]'), /Edited by employee/)
  assert.match(await text(miguel2.page, '[data-testid=ro-orig-tax_amount]'), /133\.93/)
  await uiDecide(miguel2.page, 'approve')
  await done(miguel2)
  const paolo = await as(PEOPLE.paolo)
  await openRequest(paolo.page, origin, id)
  await uiDecide(paolo.page, 'clarify', 'Receipt reference missing from notes.')
  await waitText(paolo.page, '[data-testid=status-pill]', /Clarification requested/)
  await done(paolo)

  // Resubmission after a Finance clarification returns to FINANCE, not to the manager.
  const jamie3 = await as(PEOPLE.jamie)
  const j3 = jamie3.page
  await openRequest(j3, origin, id)
  await j3.waitForSelector('[data-testid=reimb-detail][data-mode=editor]')
  assert.match(await text(j3, '[data-testid=clarification-card]'), /Paolo Cruz/)
  assert.match(await text(j3, '[data-testid=clarification-card]'), /Receipt reference missing/)
  await j3.fill('[data-testid=field-notes]', 'Reference SYN-0001 is on the receipt.')
  await uiSubmit(j3)
  assert.match(await text(j3, '[data-testid=status-pill]'), /Pending finance/)
  await done(jamie3)

  const miguel3 = await as(PEOPLE.miguel)
  await miguel3.page.goto(`${origin}/reimbursements?tab=review`)
  await miguel3.page.waitForSelector('[data-testid=tab-review][aria-selected=true]')
  await miguel3.page.waitForSelector('[data-testid=empty-state], [data-testid=reimb-row]')
  assert.equal(await miguel3.page.locator('[data-testid=reimb-row]', { hasText: purpose }).count(), 0, 'it is back with Finance, not with the manager')
  await done(miguel3)

  const paolo2 = await as(PEOPLE.paolo)
  await openRequest(paolo2.page, origin, id)
  await uiDecide(paolo2.page, 'approve')
  await waitText(paolo2.page, '[data-testid=status-pill]', /Approved/)
  assert.deepEqual(
    await paolo2.page.$$eval('[data-testid=decision-item]', (els) => els.map((e) => e.dataset.action)),
    ['clarify', 'approve', 'clarify', 'approve'],
  )
  await paolo2.page.waitForFunction(() => document.querySelectorAll('[data-testid=audit-item][data-action="reimbursement.submitted"]').length === 3)
  await done(paolo2)
})

test('E2E rejection: manager rejects with a comment; the employee sees it read-only and cannot edit or resubmit', opts, async () => {
  const purpose = 'E2E rejection'
  const id = await seedSubmitted(origin, PEOPLE.jamie, purpose)
  const miguel = await as(PEOPLE.miguel)
  await openRequest(miguel.page, origin, id)
  await uiDecide(miguel.page, 'reject', 'Not an approved expense type (synthetic reason).')
  await waitText(miguel.page, '[data-testid=status-pill]', /Rejected/)
  await done(miguel)

  const jamie = await as(PEOPLE.jamie)
  await openRequest(jamie.page, origin, id)
  await jamie.page.waitForSelector('[data-testid=reimb-detail][data-mode=readonly]')
  assert.match(await text(jamie.page, '[data-testid=status-pill]'), /Rejected/)
  assert.match(await text(jamie.page, '[data-testid=decision-timeline]'), /Not an approved expense type/)
  assert.equal(await jamie.page.locator('[data-testid=save-draft], [data-testid=submit-request], [data-testid=receipt-dropzone]').count(), 0)
  assert.equal((await pageApi(jamie.page, origin, 'POST', `/reimbursements/${id}/submit`, { confirm_fields: true })).status, 409)
  assert.equal((await pageApi(jamie.page, origin, 'PATCH', `/reimbursements/${id}`, { purpose: 'retry' })).status, 409)
  await done(jamie)

  // Rejected at the manager stage means it never reached Finance, who therefore cannot see it.
  const paolo = await as(PEOPLE.paolo)
  await openRequest(paolo.page, origin, id)
  await paolo.page.waitForSelector('[data-testid=detail-missing]')
  await done(paolo)
})

test('E2E concurrency: a stale version is refused (409), the UI reloads the latest and says so', opts, async () => {
  const jamie = await as(PEOPLE.jamie)
  const p = jamie.page
  const id = await uiCreate(p, origin, 'E2E stale save')
  await uiUpload(p, 'receipt_full.png')
  await p.waitForSelector('[data-testid=extraction-banner]')
  // Someone else (the same account in another tab/API client) changes the request after this page loaded it.
  const token = await apiLogin(origin, PEOPLE.jamie)
  const other = await apiCall(origin, token, 'PATCH', `/reimbursements/${id}`, { purpose: 'E2E stale save (changed elsewhere)' })
  assert.equal(other.status, 200)
  await p.fill(F('merchant'), 'My unsaved merchant')
  await p.click('[data-testid=save-draft]')
  await p.waitForSelector('[data-testid=conflict-banner]')
  assert.match(await text(p, '[data-testid=conflict-banner]'), /changed by someone else/i)
  assert.match(await text(p, '[data-testid=conflict-banner]'), /unsaved edits .* discarded/i)
  assert.match(await text(p, '[data-testid=detail-title]'), /changed elsewhere/)
  assert.equal(await p.inputValue(F('merchant')), 'Cafe Lumina (SYNTHETIC)')
  await done(jamie)
})

// ------------------------------------------------------------------------------------------------ screenshots
test('E2E screenshots: the documented screens are captured from the real backend run (fictional data)', opts, async () => {
  const outDir = path.resolve(process.cwd(), '..', 'docs', 'screenshots')
  // A second, empty stack so the screenshots show only the curated demo data, not the other tests' leftovers.
  const clean = await startRealStack()
  let written
  try {
    written = await captureReimbursementScreenshots({ browser, origin: clean.origin, outDir })
  } finally {
    await clean.close()
  }
  assert.deepEqual([...written].sort(), [...SCREENSHOT_FILES].sort())
  for (const f of SCREENSHOT_FILES) {
    const stat = fs.statSync(path.join(outDir, f))
    assert.ok(stat.size > 20000, `${f} looks empty (${stat.size} bytes)`)
  }
  // The receipt fixtures are synthetic: assert the harness only ever points at them.
  assert.ok(receiptPath('receipt_full.png').includes(path.join('tests', 'fixtures', 'receipts')))
})
