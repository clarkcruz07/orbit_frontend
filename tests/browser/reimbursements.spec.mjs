// Real-browser UI-state tests for the Reimbursements module against the deterministic MOCK API.
// The mock lets each test force exactly what the "server" says (allowed_actions, errors, extraction results).
// Gated: RUN_BROWSER_TESTS=1 (use `npm run test:browser`).
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { distDir, launchBrowser, signIn } from './browser-env.mjs'
import { startMock } from './mock-api.mjs'
import { TINY_PNG, auditEvent, makeRequest, receiptMeta, blankFields } from './mock-reimbursements.mjs'

const enabled = process.env.RUN_BROWSER_TESTS === '1'
const opts = { skip: enabled ? false : 'set RUN_BROWSER_TESTS=1 to run real-browser tests' }

let browser
before(async () => {
  if (enabled) browser = await launchBrowser()
})
after(async () => {
  await browser?.close()
})

const ANNA = 'anna.reyes@example.test' // HRAdmin
const BEN = 'ben.cruz@example.test' // Manager
const CARLA = 'carla.dizon@example.test' // Employee
const DAN = 'dan.ocampo@example.test' // Finance

async function withApp(fn, { viewport = { width: 1448, height: 1000 } } = {}) {
  const mock = await startMock({ distDir })
  const ctx = await browser.newContext({ viewport })
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e)))
  try {
    await fn({ page, mock, ctx, rs: mock.state.reimb, pageErrors })
    assert.deepEqual(pageErrors, [], 'no uncaught page errors')
  } finally {
    await ctx.close()
    await mock.close()
  }
}

/** Sign in through the real form and wait until the shell is up (so a following goto cannot race the login). */
async function login(page, mock, email) {
  await signIn(page, mock.origin, email)
  await page.waitForSelector('.app-content')
}

/** A second signed-in browser context (for tests that need two users at once). */
async function otherUser(mock, email, viewport = { width: 1448, height: 900 }) {
  const ctx = await browser.newContext({ viewport })
  const page = await ctx.newPage()
  await login(page, mock, email)
  await page.waitForSelector('.app-content')
  return { ctx, page }
}

const text = (page, sel) => page.locator(sel).innerText()
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)
const png = (name = 'receipt.png') => ({ name, mimeType: 'image/png', buffer: TINY_PNG })

/** An own draft with a current receipt and extracted fields. */
function draftWithReceipt(over = {}) {
  const receipt = receiptMeta()
  const fields = blankFields()
  const set = (k, value, confidence) => (fields[k] = { value, source: 'extracted', extracted_value: value, confidence, flag: null })
  set('merchant', 'Cafe Lumina (SYNTHETIC)', 0.97)
  set('receipt_date', '2026-10-12', 0.95)
  set('currency', 'PHP', 0.99)
  set('total_amount', '1250.00', 0.98)
  return makeRequest({
    fields,
    receipts: [receipt],
    extraction: { status: 'partial', provider: 'demo', model_label: 'demo-deterministic', error_code: null, receipt_id: receipt.receipt_id, completed_at: new Date().toISOString() },
    ...over,
  })
}

function reviewable(over = {}) {
  return draftWithReceipt({
    status: 'pending_manager',
    stage: 'manager',
    submitted_at: new Date().toISOString(),
    allowed: { 'u-ben': ['approve', 'reject', 'clarify'], 'u-carla': [] },
    audit: [],
    ...over,
  })
}

async function openDetail(page, mock, id) {
  await page.goto(`${mock.origin}/reimbursements/${id}`)
  await page.waitForSelector('[data-testid=reimb-detail]')
}

// ------------------------------------------------------------------------------------------------ list
test('list: employee sees only "My requests", status pills, merchant/amount/date and New button, without any placeholder notice', opts, () =>
  withApp(async ({ page, mock, rs }) => {
    rs.requests.push(
      draftWithReceipt({ purpose: 'Client lunch' }),
      draftWithReceipt({ purpose: 'Taxi fare', status: 'pending_manager', stage: 'manager', submitted_at: new Date().toISOString(), allowed: { 'u-carla': [] } }),
      makeRequest({ purpose: 'Printing', status: 'clarification_requested', stage: 'manager', submitted_at: new Date().toISOString() }),
      makeRequest({ purpose: 'Someone else', employee_id: 'EMP-0099', employee: { employee_id: 'EMP-0099', name: 'Other Person', department: 'X', job_title: 'Y' } }),
    )
    await login(page, mock, CARLA)
    await page.goto(`${mock.origin}/reimbursements`)
    await page.waitForSelector('[data-testid=reimb-row]')
    assert.equal(await page.locator('[data-testid^=tab-]').count(), 1)
    assert.match(await text(page, '[data-testid=tab-mine]'), /My requests/)
    assert.equal(await page.locator('[data-testid=reimb-row]').count(), 3, 'own requests only')
    assert.equal(await page.locator('[data-testid=placeholder-notice]').count(), 0, 'no placeholder notice')
    const pills = await page.$$eval('[data-testid=reimb-row] [data-testid=status-pill]', (els) => els.map((e) => e.textContent.trim()).sort())
    assert.deepEqual(pills, ['Clarification requested', 'Draft', 'Pending manager'])
    const lunch = page.locator('[data-testid=reimb-row]', { hasText: 'Client lunch' })
    const t = await lunch.innerText()
    assert.ok(t.includes('Cafe Lumina (SYNTHETIC)') && t.includes('12 Oct 2026') && t.includes('PHP 1,250.00'), t)
    assert.equal(await page.locator('[data-testid=new-reimbursement]').count(), 1)
    // status filter narrows the list through the server
    await page.selectOption('[data-testid=status-filter]', 'draft')
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=reimb-row]').length === 1)
    assert.equal(await page.locator('[data-testid=reimb-row] [data-testid=status-pill]').getAttribute('data-status'), 'draft')
    // opening a row goes to its detail
    await page.click('[data-testid=reimb-open]')
    await page.waitForURL(/\/reimbursements\/[0-9a-f-]{36}$/)
  }))

test('list: Export to Excel downloads what the tab and status filter show, and an error is said in plain words', opts, () =>
  withApp(async ({ page, mock, rs }) => {
    rs.requests.push(draftWithReceipt({ purpose: 'Client lunch' }), makeRequest({ purpose: 'Printing', status: 'clarification_requested', stage: 'manager', submitted_at: new Date().toISOString() }))
    await login(page, mock, CARLA)
    await page.goto(`${mock.origin}/reimbursements`)
    await page.waitForSelector('[data-testid=reimb-row]')

    const [download] = await Promise.all([page.waitForEvent('download'), page.click('[data-testid=export-xlsx]')])
    assert.match(download.suggestedFilename(), /^reimbursements-mine-\d{4}-\d{2}-\d{2}\.xlsx$/)
    assert.deepEqual(rs.exports, [{ scope: 'mine', status: null }])

    // the status filter goes into the request and the file name
    await page.selectOption('[data-testid=status-filter]', 'draft')
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=reimb-row]').length === 1)
    const [second] = await Promise.all([page.waitForEvent('download'), page.click('[data-testid=export-xlsx]')])
    assert.match(second.suggestedFilename(), /^reimbursements-mine-draft-\d{4}-\d{2}-\d{2}\.xlsx$/)
    assert.deepEqual(rs.exports[1], { scope: 'mine', status: 'draft' })

    // a server failure is shown, and the button works again afterwards
    rs.exportError = 500
    await page.click('[data-testid=export-xlsx]')
    await page.waitForSelector('[data-testid=export-error]')
    assert.match(await text(page, '[data-testid=export-error]'), /Excel file could not be created/)
    assert.equal(await page.isEnabled('[data-testid=export-xlsx]'), true)
  }))

test('list: the export button is off when there is nothing to export', opts, () =>
  withApp(async ({ page, mock }) => {
    await login(page, mock, CARLA)
    await page.goto(`${mock.origin}/reimbursements`)
    await page.waitForSelector('[data-testid=new-reimbursement]')
    await page.waitForFunction(() => document.querySelector('[data-testid=export-xlsx]')?.disabled === true)
  }))

test('list: tabs depend on the account (Manager: 3 incl. review; HR: mine + all; Finance: 3) and review lists only decidable items', opts, () =>
  withApp(async ({ page, mock, rs }) => {
    rs.requests.push(
      reviewable({ purpose: 'Needs Ben', visibleTo: ['u-anna'] }),
      draftWithReceipt({ purpose: 'Already with finance', status: 'pending_finance', stage: 'finance', submitted_at: new Date().toISOString(), allowed: { 'u-dan': ['approve', 'reject', 'clarify'], 'u-carla': [] }, visibleTo: ['u-ben', 'u-anna'] }),
    )
    await login(page, mock, BEN)
    await page.goto(`${mock.origin}/reimbursements`)
    await page.waitForSelector('[data-testid=tab-review]')
    assert.deepEqual(await page.$$eval('[data-testid^=tab-]', (els) => els.map((e) => e.dataset.testid)), ['tab-mine', 'tab-review', 'tab-all'])
    await page.click('[data-testid=tab-review]')
    await page.waitForSelector('[data-testid=reimb-row]')
    assert.deepEqual(await page.$$eval('[data-testid=reimb-open]', (els) => els.map((e) => e.textContent.trim())), ['Needs Ben'])
    assert.match(await text(page, '[data-testid=reimb-row]'), /Carla Dizon/, 'reviewers see whose request it is')
    await page.click('[data-testid=tab-all]')
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=reimb-row]').length === 2)

    const hr = await otherUser(mock, ANNA)
    await hr.page.goto(`${mock.origin}/reimbursements`)
    await hr.page.waitForSelector('[data-testid=tab-all]')
    assert.deepEqual(await hr.page.$$eval('[data-testid^=tab-]', (els) => els.map((e) => e.dataset.testid)), ['tab-mine', 'tab-all'])
    await hr.page.click('[data-testid=tab-all]')
    await hr.page.waitForFunction(() => document.querySelectorAll('[data-testid=reimb-row]').length === 2)
    await hr.ctx.close()

    const fin = await otherUser(mock, DAN)
    await fin.page.goto(`${mock.origin}/reimbursements`)
    await fin.page.waitForSelector('[data-testid=tab-review]')
    assert.equal(await fin.page.locator('[data-testid^=tab-]').count(), 3)
    await fin.ctx.close()
  }))

test('list: empty states per tab and an honest error state with a working retry', opts, () =>
  withApp(async ({ page, mock, rs }) => {
    await login(page, mock, BEN)
    await page.goto(`${mock.origin}/reimbursements`)
    await page.waitForSelector('[data-testid=empty-state]')
    assert.match(await text(page, '[data-testid=empty-state]'), /No reimbursement requests yet/)
    await page.click('[data-testid=tab-review]')
    await page.waitForFunction(() => /Nothing is waiting for your review/.test(document.querySelector('[data-testid=empty-state]')?.textContent || ''))
    rs.listError = 500
    await page.click('[data-testid=tab-all]')
    await page.waitForSelector('[data-testid=list-error]')
    rs.listError = null
    await page.click('[data-testid=list-error] button')
    await page.waitForSelector('[data-testid=empty-state]')
  }))

test('list: at 390px the table collapses to cards and nothing overflows sideways', opts, () =>
  withApp(
    async ({ page, mock, rs }) => {
      rs.requests.push(draftWithReceipt({ purpose: 'A very long purpose title that should wrap inside the card without pushing the page sideways at all' }))
      await login(page, mock, CARLA)
      await page.goto(`${mock.origin}/reimbursements`)
      await page.waitForSelector('[data-testid=reimb-card]')
      assert.equal(await page.locator('[data-testid=reimb-table]').isVisible(), false)
      assert.equal(await page.locator('[data-testid=reimb-card]').isVisible(), true)
      assert.ok(await noOverflow(page))
      await page.click('[data-testid=reimb-card]')
      await page.waitForSelector('[data-testid=reimb-detail]')
      assert.ok(await noOverflow(page))
    },
    { viewport: { width: 390, height: 844 } },
  ))

// ------------------------------------------------------------------------------------------------ new request
test('new request: purpose is required, create goes to the editor with nothing prefilled', opts, () =>
  withApp(async ({ page, mock, rs }) => {
    await login(page, mock, CARLA)
    await page.goto(`${mock.origin}/reimbursements/new`)
    await page.waitForSelector('[data-testid=purpose-input]')
    assert.equal(await page.locator('[data-testid=create-draft]').isDisabled(), true)
    await page.fill('[data-testid=purpose-input]', 'Taxi to the venue')
    assert.equal(await page.locator('[data-testid=create-draft]').isDisabled(), false)
    await page.click('[data-testid=create-draft]')
    await page.waitForURL(/\/reimbursements\/[0-9a-f-]{36}$/)
    await page.waitForSelector('[data-testid=reimb-detail][data-mode=editor]')
    assert.match(await text(page, '[data-testid=detail-title]'), /Taxi to the venue/)
    assert.equal(rs.requests.length, 1)
    for (const k of ['merchant', 'receipt_date', 'total_amount', 'tax_amount', 'receipt_reference']) assert.equal(await page.inputValue(`[data-testid=field-${k}]`), '')
    assert.equal(await page.inputValue('[data-testid=field-currency]'), '')
  }))

// ------------------------------------------------------------------------------------------------ editor: upload + provenance
test('editor: upload shows an uploading/extracting state, then the review form with provenance badges', opts, () =>
  withApp(async ({ page, mock, rs }) => {
    const r = makeRequest({ purpose: 'Client lunch' })
    rs.requests.push(r)
    rs.uploadDelayMs = 1200
    rs.uploadScenario = 'full'
    await login(page, mock, CARLA)
    await openDetail(page, mock, r.request_id)
    assert.match(await text(page, '[data-testid=receipt-dropzone]'), /PNG, JPEG, WebP or PDF, up to 10 MB/)
    await page.setInputFiles('[data-testid=receipt-input]', png('lunch.png'))
    await page.waitForSelector('[data-testid=upload-status]')
    assert.match(await text(page, '[data-testid=upload-status]'), /Uploading|Reading the receipt/)
    assert.equal(await page.locator('[data-testid=receipt-input]').isDisabled(), true, 'cannot start a second upload')
    await page.waitForSelector('[data-testid=upload-status]', { state: 'detached' })
    assert.equal(rs.uploads.length, 1)
    assert.equal(rs.uploads[0].filename, 'lunch.png')
    assert.equal(await page.inputValue('[data-testid=field-merchant]'), 'Cafe Lumina (SYNTHETIC)')
    assert.equal(await page.inputValue('[data-testid=field-total_amount]'), '1250.00')
    assert.equal(await page.inputValue('[data-testid=field-currency]'), 'PHP')
    for (const k of ['merchant', 'receipt_date', 'currency', 'total_amount', 'tax_amount', 'receipt_reference']) assert.match(await text(page, `[data-testid=prov-${k}]`), /^Extracted$/)
    assert.equal(await page.getAttribute('[data-testid=extraction-banner]', 'data-kind'), 'ok')
    assert.match(await text(page, '[data-testid=extraction-banner]'), /suggestions only/i)
    assert.match(await text(page, '[data-testid=receipt-name]'), /lunch\.png/)
    await page.waitForSelector('[data-testid=receipt-preview] img')
  }))

test('editor: editing flips the badge to "Edited by you" and keeps the original; typing into an empty field is "Entered by you"', opts, () =>
  withApp(async ({ page, mock, rs }) => {
    const r = draftWithReceipt()
    rs.requests.push(r)
    await login(page, mock, CARLA)
    await openDetail(page, mock, r.request_id)
    assert.equal(await page.locator('[data-testid=orig-total_amount]').count(), 0)
    await page.fill('[data-testid=field-total_amount]', '1,300')
    assert.match(await text(page, '[data-testid=prov-total_amount]'), /Edited by you/)
    assert.match(await text(page, '[data-testid=orig-total_amount]'), /Extracted:\s*1250\.00/)
    await page.fill('[data-testid=field-tax_amount]', '100')
    assert.match(await text(page, '[data-testid=prov-tax_amount]'), /Entered by you/)
    await page.click('[data-testid=save-draft]')
    await page.waitForSelector('[data-testid=detail-notice]')
    assert.match(await text(page, '[data-testid=detail-notice]'), /Draft saved/)
    // after save the server's normalised value and provenance are shown
    assert.equal(await page.inputValue('[data-testid=field-total_amount]'), '1300.00')
    assert.match(await text(page, '[data-testid=prov-total_amount]'), /Edited by you/)
    assert.match(await text(page, '[data-testid=orig-total_amount]'), /Extracted:\s*1250\.00/)
    assert.equal(await page.inputValue('[data-testid=field-tax_amount]'), '100.00')
    assert.deepEqual(Object.keys(rs.patches.at(-1).fields).sort(), ['tax_amount', 'total_amount'], 'only changed fields are sent')
    assert.equal(rs.patches.at(-1).version, 1, 'the version is sent for conflict detection')
    assert.equal(await page.locator('[data-testid=save-draft]').isDisabled(), true, 'nothing left to save')
  }))

test('editor: partial extraction leaves missing values EMPTY with "Not found on receipt - please enter"', opts, () =>
  withApp(async ({ page, mock, rs }) => {
    const r = makeRequest({ purpose: 'Printing' })
    rs.requests.push(r)
    rs.uploadScenario = 'partial'
    await login(page, mock, CARLA)
    await openDetail(page, mock, r.request_id)
    await page.setInputFiles('[data-testid=receipt-input]', png())
    await page.waitForSelector('[data-testid=extraction-banner][data-kind=partial]')
    for (const k of ['receipt_date', 'receipt_reference']) {
      assert.equal(await page.inputValue(`[data-testid=field-${k}]`), '', `${k} stays empty`)
      assert.match(await text(page, `[data-testid=prov-${k}]`), /Not found/)
      assert.match(await text(page, `[data-testid=hint-${k}]`), /Not found on receipt - please enter/)
    }
    assert.equal(await page.locator('[data-testid=hint-merchant]').count(), 0)
    await page.fill('[data-testid=field-receipt_date]', '2026-10-10')
    assert.match(await text(page, '[data-testid=prov-receipt_date]'), /Entered by you/)
  }))

test('editor: low-confidence extracted values carry a "Low confidence" badge', opts, () =>
  withApp(async ({ page, mock, rs }) => {
    const r = makeRequest({ purpose: 'Hardware' })
    rs.requests.push(r)
    rs.uploadScenario = 'lowconf'
    await login(page, mock, CARLA)
    await openDetail(page, mock, r.request_id)
    await page.setInputFiles('[data-testid=receipt-input]', png())
    await page.waitForSelector('[data-testid=low-total_amount]')
    assert.match(await text(page, '[data-testid=low-total_amount]'), /Low confidence/)
    assert.equal(await page.locator('[data-testid=low-merchant]').count(), 0)
    assert.match(await page.getAttribute('[data-testid=low-total_amount]', 'title'), /41%/)
  }))

test('editor: failed extraction shows a clear banner and the manual-entry path works', opts, () =>
  withApp(async ({ page, mock, rs }) => {
    const r = makeRequest({ purpose: 'Taxi' })
    rs.requests.push(r)
    rs.uploadScenario = 'failed'
    await login(page, mock, CARLA)
    await openDetail(page, mock, r.request_id)
    await page.setInputFiles('[data-testid=receipt-input]', png('blurry.png'))
    await page.waitForSelector('[data-testid=extraction-banner][data-kind=failed]')
    const banner = await text(page, '[data-testid=extraction-banner]')
    assert.match(banner, /couldn't read this receipt/i)
    assert.match(banner, /type the details yourself/i)
    assert.match(banner, /blurred, cropped or not a receipt/i, 'error_code is turned into friendly text')
    assert.ok(!banner.includes('unreadable_receipt'), 'no raw error code')
    assert.equal(rs.uploads.length, 1, 'the receipt is still stored')
    assert.match(await text(page, '[data-testid=receipt-name]'), /blurry\.png/)
    for (const k of ['merchant', 'receipt_date', 'currency', 'total_amount']) {
      assert.equal(await page.inputValue(`[data-testid=field-${k}]`), '')
      assert.match(await text(page, `[data-testid=hint-${k}]`), /Couldn't be read from the receipt - please enter/)
    }
    await page.fill('[data-testid=field-merchant]', 'Sample Ride Co')
    await page.fill('[data-testid=field-receipt_date]', '2026-10-15')
    await page.selectOption('[data-testid=field-currency]', 'USD')
    await page.fill('[data-testid=field-total_amount]', '680')
    for (const k of ['merchant', 'receipt_date', 'currency', 'total_amount']) assert.match(await text(page, `[data-testid=prov-${k}]`), /Entered by you/)
    // Re-run extraction is honest about what it does, and a failed re-run leaves typed values alone.
    assert.match(await text(page, '.r-rerun'), /Only suggests values/)
    await page.click('[data-testid=rerun-extraction]')
    await page.waitForFunction(() => document.querySelector('[data-testid=rerun-extraction]')?.textContent.includes('Re-run extraction'))
    assert.equal(await page.inputValue('[data-testid=field-merchant]'), 'Sample Ride Co')
  }))

test('editor: the server refuses a file (415/413) -> inline error, nothing stored, form unchanged', opts, () =>
  withApp(async ({ page, mock, rs }) => {
    const r = draftWithReceipt()
    rs.requests.push(r)
    rs.uploadReject = { status: 415, detail: 'Unsupported file. Upload a PDF, PNG or JPEG receipt.' }
    await login(page, mock, CARLA)
    await openDetail(page, mock, r.request_id)
    await page.setInputFiles('[data-testid=receipt-input]', { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') })
    await page.waitForSelector('[data-testid=upload-error]')
    const msg = await text(page, '[data-testid=upload-error]')
    assert.match(msg, /Unsupported file. Upload a PDF, PNG or JPEG receipt/)
    assert.match(msg, /Nothing was stored/)
    assert.equal(rs.uploads.length, 0)
    assert.equal(await page.inputValue('[data-testid=field-merchant]'), 'Cafe Lumina (SYNTHETIC)')
    rs.uploadReject = { status: 413, detail: 'The file is too large (maximum 10 MB)' }
    await page.setInputFiles('[data-testid=receipt-input]', png())
    await page.waitForFunction(() => /too large/.test(document.querySelector('[data-testid=upload-error]')?.textContent || ''))
  }))

test('editor: unsaved edits are saved first when a receipt is uploaded, and typed values survive extraction', opts, () =>
  withApp(async ({ page, mock, rs }) => {
    const r = makeRequest({ purpose: 'Order of events' })
    rs.requests.push(r)
    await login(page, mock, CARLA)
    await openDetail(page, mock, r.request_id)
    await page.fill('[data-testid=field-merchant]', 'Typed first')
    await page.setInputFiles('[data-testid=receipt-input]', png())
    await page.waitForSelector('[data-testid=receipt-name]')
    assert.equal(rs.patches.length, 1, 'draft was saved before upload')
    assert.equal(rs.patches[0].fields.merchant, 'Typed first')
    assert.equal(await page.inputValue('[data-testid=field-merchant]'), 'Typed first')
    assert.match(await text(page, '[data-testid=prov-merchant]'), /Edited by you/)
  }))

test('editor: receipt preview and download use the Bearer token, never a token in the URL', opts, () =>
  withApp(async ({ page, mock, rs }) => {
    const r = draftWithReceipt()
    rs.requests.push(r)
    await login(page, mock, CARLA)
    await openDetail(page, mock, r.request_id)
    await page.waitForSelector('[data-testid=receipt-preview] img')
    assert.equal(rs.fileRequests.length, 1)
    assert.equal(rs.fileRequests[0].authorization, 'Bearer acc-u-carla')
    assert.ok(!/token|acc-u-carla|access/i.test(rs.fileRequests[0].url), rs.fileRequests[0].url)
    assert.match(await page.getAttribute('[data-testid=receipt-preview] img', 'src'), /^blob:/)
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('[data-testid=receipt-download]')])
    assert.equal(download.suggestedFilename(), 'receipt-1.png')
    assert.equal(rs.fileRequests.length, 2)
    assert.equal(rs.fileRequests[1].authorization, 'Bearer acc-u-carla')
  }))

test('editor: a PDF receipt shows a PDF tile and a download button (no inline fetch)', opts, () =>
  withApp(async ({ page, mock, rs }) => {
    const receipt = receiptMeta({ filename: 'hotel.pdf', content_type: 'application/pdf' })
    const r = draftWithReceipt({ receipts: [receipt] })
    rs.requests.push(r)
    await login(page, mock, CARLA)
    await openDetail(page, mock, r.request_id)
    assert.match(await text(page, '[data-testid=receipt-preview]'), /PDF/)
    assert.equal(await page.locator('[data-testid=receipt-preview] img').count(), 0)
    assert.equal(rs.fileRequests.length, 0)
    assert.equal(await page.locator('[data-testid=receipt-download]').count(), 1)
  }))

// ------------------------------------------------------------------------------------------------ editor: save/submit errors
test('editor: 409 on save reloads the latest version and tells the user', opts, () =>
  withApp(async ({ page, mock, rs }) => {
    const r = draftWithReceipt({ purpose: 'Shared draft' })
    rs.requests.push(r)
    await login(page, mock, CARLA)
    await openDetail(page, mock, r.request_id)
    await page.fill('[data-testid=field-merchant]', 'My unsaved merchant')
    rs.patchConflictOnce = true
    await page.click('[data-testid=save-draft]')
    await page.waitForSelector('[data-testid=conflict-banner]')
    const msg = await text(page, '[data-testid=conflict-banner]')
    assert.match(msg, /changed by someone else/i)
    assert.match(msg, /reloaded the latest version/i)
    assert.match(msg, /unsaved edits .* discarded/i)
    assert.match(await text(page, '[data-testid=detail-title]'), /changed elsewhere/, 'the page shows the server version')
    assert.equal(await page.inputValue('[data-testid=field-merchant]'), 'Cafe Lumina (SYNTHETIC)')
  }))

test('editor: 422 field_errors from save appear next to the right fields', opts, () =>
  withApp(async ({ page, mock, rs }) => {
    const r = draftWithReceipt()
    rs.requests.push(r)
    rs.patchFieldErrors = { receipt_date: 'The date is outside the accepted range.', tax_amount: 'The tax amount is larger than the total.' }
    await login(page, mock, CARLA)
    await openDetail(page, mock, r.request_id)
    await page.fill('[data-testid=field-tax_amount]', '50')
    await page.click('[data-testid=save-draft]')
    await page.waitForSelector('[data-testid=err-receipt_date]')
    assert.match(await text(page, '[data-testid=err-receipt_date]'), /outside the accepted range/)
    assert.match(await text(page, '[data-testid=err-tax_amount]'), /larger than the total/)
    assert.equal(await page.locator('[data-testid=err-merchant]').count(), 0)
    assert.match(await text(page, '[data-testid=form-error]'), /need attention/)
    assert.equal(await page.getAttribute('[data-testid=field-receipt_date]', 'aria-invalid'), 'true')
    await page.fill('[data-testid=field-receipt_date]', '2026-10-13')
    assert.equal(await page.locator('[data-testid=err-receipt_date]').count(), 0, 'editing a field clears its server error')
  }))

test('editor: client-side checks flag bad amounts and a tax larger than the total before any request is sent', opts, () =>
  withApp(async ({ page, mock, rs }) => {
    const r = draftWithReceipt()
    rs.requests.push(r)
    await login(page, mock, CARLA)
    await openDetail(page, mock, r.request_id)
    await page.fill('[data-testid=field-total_amount]', '12.345')
    assert.match(await text(page, '[data-testid=err-total_amount]'), /up to 2 decimals/)
    await page.fill('[data-testid=field-total_amount]', '1250')
    await page.fill('[data-testid=field-tax_amount]', '2000')
    assert.match(await text(page, '[data-testid=err-tax_amount]'), /larger than the total/)
    await page.click('[data-testid=save-draft]')
    assert.equal(rs.patches.length, 0, 'invalid values are never sent')
    assert.match(await text(page, '[data-testid=form-error]'), /need attention/)
  }))

test('submit: needs the explicit confirmation checkbox, then POSTs confirm_fields:true and the page turns read-only', opts, () =>
  withApp(async ({ page, mock, rs }) => {
    const r = draftWithReceipt()
    rs.requests.push(r)
    await login(page, mock, CARLA)
    await openDetail(page, mock, r.request_id)
    assert.equal(await page.locator('[data-testid=submit-request]').isDisabled(), true)
    assert.match(await page.getAttribute('[data-testid=submit-request]', 'title'), /confirmation/)
    assert.match(await text(page, '[data-testid=submit-card]'), /I have checked these values against the receipt/)
    assert.match(await text(page, '[data-testid=submit-card]'), /does not pay or post anything/)
    await page.check('[data-testid=confirm-check]')
    assert.equal(await page.locator('[data-testid=submit-request]').isDisabled(), false)
    await page.click('[data-testid=submit-request]')
    await page.waitForSelector('[data-testid=reimb-detail][data-mode=readonly]')
    assert.deepEqual(rs.submits, [{ confirm_fields: true }])
    assert.match(await text(page, '[data-testid=status-pill]'), /Pending manager/)
    assert.match(await text(page, '[data-testid=detail-notice]'), /Submitted/)
    assert.equal(await page.locator('[data-testid=receipt-dropzone], [data-testid=save-draft], [data-testid=submit-request], [data-testid=field-merchant]').count(), 0)
  }))

test('submit: missing required values show next to the fields without a round trip; a missing receipt is flagged on the receipt', opts, () =>
  withApp(async ({ page, mock, rs }) => {
    const r = makeRequest({ purpose: 'Empty' })
    rs.requests.push(r)
    await login(page, mock, CARLA)
    await openDetail(page, mock, r.request_id)
    await page.check('[data-testid=confirm-check]')
    await page.click('[data-testid=submit-request]')
    await page.waitForSelector('[data-testid=receipt-required]')
    assert.match(await text(page, '[data-testid=receipt-required]'), /Upload a receipt/)
    for (const k of ['merchant', 'receipt_date', 'currency', 'total_amount']) assert.match(await text(page, `[data-testid=err-${k}]`), /Required before you can submit/)
    assert.equal(await page.locator('[data-testid=err-tax_amount], [data-testid=err-receipt_reference]').count(), 0, 'optional fields are not required')
    assert.equal(rs.submits.length, 0)
  }))

test('submit: a server 422 with missing_fields/field_errors is mapped onto the fields', opts, () =>
  withApp(async ({ page, mock, rs }) => {
    const r = draftWithReceipt()
    rs.requests.push(r)
    rs.submitError = { status: 422, body: { detail: 'Missing or invalid: receipt_date, total_amount', missing_fields: ['receipt_date', 'total_amount'], field_errors: { merchant: 'Merchant is not acceptable.' } } }
    await login(page, mock, CARLA)
    await openDetail(page, mock, r.request_id)
    await page.check('[data-testid=confirm-check]')
    await page.click('[data-testid=submit-request]')
    await page.waitForSelector('[data-testid=err-receipt_date]')
    assert.match(await text(page, '[data-testid=err-receipt_date]'), /Receipt date is missing or not valid/)
    assert.match(await text(page, '[data-testid=err-total_amount]'), /Total amount is missing or not valid/)
    assert.match(await text(page, '[data-testid=err-merchant]'), /Merchant is not acceptable/)
    assert.match(await text(page, '[data-testid=form-error]'), /Missing or invalid/)
    assert.equal(await page.getAttribute('[data-testid=reimb-detail]', 'data-mode'), 'editor', 'stays editable')
    rs.submitError = { status: 422, body: { detail: 'Please confirm the receipt details before submitting', missing_fields: [], confirm_required: true } }
    await page.click('[data-testid=submit-request]')
    await page.waitForFunction(() => /tick the confirmation/i.test(document.querySelector('[data-testid=form-error]')?.textContent || ''))
  }))

test('clarification requested: the reviewer comment is shown prominently and the employee can edit again', opts, () =>
  withApp(async ({ page, mock, rs }) => {
    const r = draftWithReceipt({
      status: 'clarification_requested',
      stage: 'manager',
      submitted_at: new Date().toISOString(),
      decisions: [{ decision_id: 'd1', by_user_id: 'u-ben', by_name: 'Ben Cruz', by_role: 'Manager', action: 'clarify', comment: 'Please check the total against the receipt.', at: new Date().toISOString(), stage: 'manager' }],
    })
    rs.requests.push(r)
    await login(page, mock, CARLA)
    await openDetail(page, mock, r.request_id)
    assert.equal(await page.getAttribute('[data-testid=reimb-detail]', 'data-mode'), 'editor')
    const card = await text(page, '[data-testid=clarification-card]')
    assert.match(card, /Please check the total against the receipt/)
    assert.match(card, /Ben Cruz/)
    assert.match(card, /same review stage/)
    assert.match(await text(page, '[data-testid=decision-timeline]'), /Asked for clarification/)
  }))

// ------------------------------------------------------------------------------------------------ server-forced modes
test('server-forced read-only: even an own draft is read-only when allowed_actions is empty; no editor controls render', opts, () =>
  withApp(async ({ page, mock, rs }) => {
    const r = draftWithReceipt({ allowed: { 'u-carla': [] } })
    rs.requests.push(r)
    await login(page, mock, CARLA)
    await openDetail(page, mock, r.request_id)
    assert.equal(await page.getAttribute('[data-testid=reimb-detail]', 'data-mode'), 'readonly')
    assert.equal(await page.locator('.app-content input:not([type=hidden]), .app-content textarea, .app-content select').count(), 0, 'no inputs at all')
    assert.equal(await page.locator('[data-testid=receipt-dropzone], [data-testid=save-draft], [data-testid=submit-request], [data-testid=rerun-extraction], [data-testid=reviewer-panel]').count(), 0)
    assert.equal(await page.locator('[data-testid=readonly-fields]').count(), 1)
    assert.equal(await page.locator('[data-testid=receipt-download]').count(), 1, 'download stays available')
  }))

test('server-forced editor: edit/upload/submit in allowed_actions on a non-draft status still renders the editor', opts, () =>
  withApp(async ({ page, mock, rs }) => {
    const r = draftWithReceipt({ status: 'pending_finance', stage: 'finance', submitted_at: new Date().toISOString(), allowed: { 'u-carla': ['edit', 'upload', 'submit'] } })
    rs.requests.push(r)
    await login(page, mock, CARLA)
    await openDetail(page, mock, r.request_id)
    assert.equal(await page.getAttribute('[data-testid=reimb-detail]', 'data-mode'), 'editor')
  }))

test('read-only view: "Extracted vs final" shows the source and original extracted value for edited and entered values', opts, () =>
  withApp(async ({ page, mock, rs }) => {
    const r = draftWithReceipt({ status: 'pending_manager', stage: 'manager', submitted_at: new Date().toISOString(), allowed: { 'u-carla': [] }, notes: 'Team lunch with a client.' })
    r.fields.total_amount = { value: '1300.00', source: 'edited', extracted_value: '1250.00', confidence: 0.41, flag: null }
    r.fields.tax_amount = { value: '100.00', source: 'entered', extracted_value: null, confidence: null, flag: null }
    rs.requests.push(r)
    await login(page, mock, CARLA)
    await openDetail(page, mock, r.request_id)
    assert.equal(await page.locator('[data-testid=ro-merchant]').getAttribute('data-source'), 'extracted')
    assert.match(await text(page, '[data-testid=ro-source-merchant]'), /^Extracted$/)
    assert.match(await text(page, '[data-testid=ro-value-total_amount]'), /PHP 1,300\.00/)
    assert.match(await text(page, '[data-testid=ro-source-total_amount]'), /Edited by employee/)
    assert.match(await text(page, '[data-testid=ro-orig-total_amount]'), /PHP 1,250\.00/)
    assert.match(await text(page, '[data-testid=ro-low-total_amount]'), /Low confidence/)
    assert.match(await text(page, '[data-testid=ro-source-tax_amount]'), /Entered by employee/)
    assert.match(await text(page, '[data-testid=ro-orig-tax_amount]'), /Not found/)
    assert.match(await text(page, '[data-testid=ro-value-receipt_reference]'), /Not provided/)
    assert.match(await text(page, '[data-testid=ro-notes]'), /Team lunch with a client/)
    assert.match(await text(page, '[data-testid=readonly-fields]'), /demo-deterministic/)
  }))

// ------------------------------------------------------------------------------------------------ reviewer panel
test('reviewer panel: only from allowed_actions, shows the no-payment line, and every action needs confirmation', opts, () =>
  withApp(async ({ page, mock, rs }) => {
    const r = reviewable()
    r.audit.push(auditEvent(r, 'reimbursement.created'), auditEvent(r, 'reimbursement.submitted', { details: { to_status: 'pending_manager' } }))
    rs.requests.push(r)
    await login(page, mock, BEN)
    await openDetail(page, mock, r.request_id)
    await page.waitForSelector('[data-testid=reviewer-panel]')
    assert.equal(await page.getAttribute('[data-testid=reimb-detail]', 'data-mode'), 'readonly')
    assert.match(await text(page, '[data-testid=no-payment-note]'), /Approving does not trigger any payment/)
    assert.equal(await page.locator('[data-testid=field-merchant]').count(), 0, 'a reviewer never gets editable fields')
    assert.equal(await page.locator('[data-testid=review-reject]').isDisabled(), true)
    assert.equal(await page.locator('[data-testid=review-clarify]').isDisabled(), true)
    assert.equal(await page.locator('[data-testid=review-approve]').isDisabled(), false)
    await page.fill('[data-testid=review-comment]', 'Receipt is blurry')
    assert.match(await text(page, '[data-testid=review-counter]'), /^17\/2000$/)
    assert.equal(await page.getAttribute('[data-testid=review-comment]', 'maxlength'), '2000')
    await page.click('[data-testid=review-reject]')
    await page.waitForSelector('[data-testid=review-confirm-box]')
    assert.match(await text(page, '[data-testid=review-confirm-box]'), /Reject this request/)
    await page.click('[data-testid=review-cancel]')
    assert.equal(rs.decisions.length, 0)
    assert.equal(await page.locator('[data-testid=review-confirm-box]').count(), 0)
    await page.fill('[data-testid=review-comment]', '')
    await page.click('[data-testid=review-approve]')
    assert.match(await text(page, '[data-testid=review-confirm-box]'), /send it on to Finance/)
    await page.click('[data-testid=review-confirm]')
    await page.waitForFunction(() => !document.querySelector('[data-testid=reviewer-panel]'))
    assert.deepEqual(rs.decisions, [{ action: 'approve', comment: '' }])
    assert.match(await text(page, '[data-testid=status-pill]'), /Pending finance/)
    assert.match(await text(page, '[data-testid=decision-timeline]'), /Approved/)
    assert.match(await text(page, '[data-testid=decision-timeline]'), /Ben Cruz/)
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=audit-item]').length === 3)
    assert.match(await text(page, '[data-testid=audit-trail]'), /Approved \(Manager review\)/)
  }))

test('reviewer panel: reject and clarify send the comment', opts, () =>
  withApp(async ({ page, mock, rs }) => {
    const a = reviewable({ purpose: 'To reject' })
    const b = reviewable({ purpose: 'To clarify' })
    rs.requests.push(a, b)
    await login(page, mock, BEN)
    await openDetail(page, mock, a.request_id)
    await page.fill('[data-testid=review-comment]', 'Not a business expense')
    await page.click('[data-testid=review-reject]')
    await page.click('[data-testid=review-confirm]')
    await page.waitForFunction(() => document.querySelector('[data-testid=status-pill]')?.textContent.includes('Rejected'))
    assert.deepEqual(rs.decisions.at(-1), { action: 'reject', comment: 'Not a business expense' })
    assert.match(await text(page, '[data-testid=decision-timeline]'), /Not a business expense/)
    await openDetail(page, mock, b.request_id)
    await page.fill('[data-testid=review-comment]', 'Please attach the full receipt')
    await page.click('[data-testid=review-clarify]')
    assert.match(await text(page, '[data-testid=review-confirm-box]'), /clarification/)
    await page.click('[data-testid=review-confirm]')
    await page.waitForFunction(() => document.querySelector('[data-testid=status-pill]')?.textContent.includes('Clarification requested'))
    assert.deepEqual(rs.decisions.at(-1), { action: 'clarify', comment: 'Please attach the full receipt' })
  }))

test('reviewer panel: a server 403 is shown; without allowed_actions (own request, HR oversight) no panel or decision controls exist', opts, () =>
  withApp(async ({ page, mock, rs }) => {
    const r = reviewable()
    rs.requests.push(r)
    rs.decisionError = { status: 403, body: { detail: 'You cannot decide this request' } }
    await login(page, mock, BEN)
    await openDetail(page, mock, r.request_id)
    await page.click('[data-testid=review-approve]')
    await page.click('[data-testid=review-confirm]')
    await page.waitForSelector('[data-testid=review-error]')
    assert.match(await text(page, '[data-testid=review-error]'), /You cannot decide this request/)
    assert.equal(await page.locator('[data-testid=reviewer-panel]').count(), 1, 'panel stays, nothing changed')
    const own = reviewable({ purpose: 'Own request of the manager', allowed: { 'u-ben': [] }, visibleTo: ['u-ben'] })
    rs.requests.push(own)
    await openDetail(page, mock, own.request_id)
    assert.equal(await page.locator('[data-testid=reviewer-panel], [data-testid^=review-]').count(), 0)
    const hr = await otherUser(mock, ANNA)
    const seen = reviewable({ purpose: 'HR can look', allowed: { 'u-carla': [] }, visibleTo: ['u-anna'] })
    rs.requests.push(seen)
    await hr.page.goto(`${mock.origin}/reimbursements/${seen.request_id}`)
    await hr.page.waitForSelector('[data-testid=reimb-detail]')
    assert.equal(await hr.page.locator('[data-testid=reviewer-panel], [data-testid^=review-], [data-testid=save-draft], [data-testid=receipt-dropzone]').count(), 0)
    assert.equal(await hr.page.locator('[data-testid=readonly-fields]').count(), 1)
    await hr.ctx.close()
  }))

test('reviewer panel: a 409 (the request moved on) reloads the page and says so', opts, () =>
  withApp(async ({ page, mock, rs }) => {
    const r = reviewable()
    rs.requests.push(r)
    await login(page, mock, BEN)
    await openDetail(page, mock, r.request_id)
    rs.decisionError = { status: 409, body: { detail: 'This request is not awaiting a decision' } }
    r.status = 'approved'
    r.allowed['u-ben'] = []
    await page.click('[data-testid=review-approve]')
    await page.click('[data-testid=review-confirm]')
    await page.waitForSelector('[data-testid=conflict-banner]')
    assert.match(await text(page, '[data-testid=conflict-banner]'), /not awaiting a decision/)
    await page.waitForFunction(() => !document.querySelector('[data-testid=reviewer-panel]'))
    assert.match(await text(page, '[data-testid=status-pill]'), /Approved/)
  }))

test('audit trail: events are listed with who did what; an error shows a retry', opts, () =>
  withApp(async ({ page, mock, rs }) => {
    const r = reviewable({ allowed: { 'u-carla': [], 'u-ben': [] }, visibleTo: ['u-ben'] })
    r.audit.push(
      auditEvent(r, 'reimbursement.created'),
      auditEvent(r, 'reimbursement.receipt_uploaded'),
      auditEvent(r, 'reimbursement.extraction_completed', { details: { status: 'partial' } }),
      auditEvent(r, 'reimbursement.submitted', { details: { to_status: 'pending_manager' } }),
    )
    rs.requests.push(r)
    rs.auditError = true
    await login(page, mock, CARLA)
    await openDetail(page, mock, r.request_id)
    await page.waitForSelector('[data-testid=audit-error]')
    rs.auditError = false
    await page.click('[data-testid=audit-error] button')
    await page.waitForSelector('[data-testid=audit-item]')
    const items = await page.$$eval('[data-testid=audit-item]', (els) => els.map((e) => e.textContent))
    assert.equal(items.length, 4)
    assert.ok(items[0].includes('Draft created') && items[0].includes('You'))
    assert.ok(items[3].includes('Submitted - now pending manager'))
  }))

test('detail: unknown or invisible requests show a "can\'t find" page (the server answers 404)', opts, () =>
  withApp(async ({ page, mock, rs }) => {
    rs.requests.push(draftWithReceipt({ employee_id: 'EMP-0099', employee: { employee_id: 'EMP-0099', name: 'Other', department: 'X', job_title: 'Y' } }))
    await login(page, mock, CARLA)
    await page.goto(`${mock.origin}/reimbursements/${rs.requests[0].request_id}`)
    await page.waitForSelector('[data-testid=detail-missing]')
    assert.match(await text(page, '[data-testid=detail-missing]'), /can't find that request/)
    await page.goto(`${mock.origin}/reimbursements/not-a-real-id`)
    await page.waitForSelector('[data-testid=detail-missing]')
  }))

// ------------------------------------------------------------------------------------------------ Home
test('home: real counts and latest items; an account with no review queue gets no review card', opts, () =>
  withApp(async ({ page, mock, rs }) => {
    await login(page, mock, CARLA)
    await page.waitForSelector('[data-testid=home-my-reimbursements] [data-testid=empty-state]')
    assert.match(await text(page, '[data-testid=home-my-reimbursements]'), /No reimbursements yet/)
    assert.equal(await page.locator('[data-testid=home-awaiting-review]').count(), 0, 'no review queue, no review card')
    assert.equal(await page.locator('[data-testid=home-sum-review]').count(), 0)
    rs.requests.push(
      draftWithReceipt({ purpose: 'Draft one' }),
      draftWithReceipt({ purpose: 'Draft two' }),
      draftWithReceipt({ purpose: 'Pending one', status: 'pending_manager', stage: 'manager', submitted_at: new Date().toISOString(), allowed: { 'u-carla': [] } }),
      draftWithReceipt({ purpose: 'Done one', status: 'approved', submitted_at: new Date().toISOString(), allowed: { 'u-carla': [] } }),
    )
    await page.reload()
    await page.waitForSelector('[data-testid=home-counts]')
    const counts = await page.$$eval('[data-testid=home-counts] li', (els) => Object.fromEntries(els.map((e) => [e.dataset.status, Number(e.dataset.count)])))
    assert.deepEqual(counts, { draft: 2, clarification_requested: 0, pending_manager: 1, pending_finance: 0, approved: 1, rejected: 0 })
    assert.equal(await page.locator('[data-testid=home-item]').count(), 3, 'latest three')
    const sum = (id) => text(page, `[data-testid=${id}] .summary-value`)
    assert.deepEqual([await sum('home-sum-total'), await sum('home-sum-progress'), await sum('home-sum-approved')], ['4', '3', '1'], 'the summary cards count the same requests')
    await page.click('[data-testid=home-view-mine]')
    await page.waitForURL('**/reimbursements')
  }))

test('home: a reviewer sees how many requests wait for them and a link to the review tab', opts, () =>
  withApp(async ({ page, mock, rs }) => {
    rs.requests.push(
      reviewable({ purpose: 'Waiting 1' }),
      reviewable({ purpose: 'Waiting 2' }),
      reviewable({ purpose: 'Not for Ben', allowed: { 'u-dan': ['approve', 'reject', 'clarify'] } }),
    )
    await login(page, mock, BEN)
    await page.waitForSelector('[data-testid=home-review-count]')
    assert.equal(await page.getAttribute('[data-testid=home-review-count]', 'data-count'), '2')
    assert.match(await text(page, '[data-testid=home-awaiting-review]'), /Carla Dizon/)
    assert.equal(await page.locator('[data-testid=home-sum-review] .summary-value').innerText(), '2')
    await page.click('[data-testid=home-view-review]')
    await page.waitForURL('**/reimbursements?tab=review')
    await page.waitForSelector('[data-testid=reimb-row]')
    assert.equal(await page.locator('[data-testid=tab-review]').getAttribute('aria-selected'), 'true')
    assert.equal(await page.locator('[data-testid=reimb-row]').count(), 2)
  }))

test('home: a failing API shows an error with retry instead of a blank card', opts, () =>
  withApp(async ({ page, mock, rs }) => {
    rs.listError = 500
    await login(page, mock, CARLA)
    await page.waitForSelector('[data-testid=home-card-error]')
    rs.listError = null
    await page.click('[data-testid=home-card-error] button')
    await page.waitForSelector('[data-testid=home-my-reimbursements] [data-testid=empty-state]')
  }))

for (const width of [1448, 1024, 768, 390]) {
  test(`reimbursement pages do not overflow horizontally at ${width}px (home, list, new, editor, read-only, reviewer)`, opts, () =>
    withApp(
      async ({ page, mock, rs }) => {
        const editorReq = draftWithReceipt({ purpose: 'Long purpose text to test wrapping across the layout at every width we support here' })
        const roReq = reviewable({ purpose: 'Reviewer view' })
        roReq.audit.push(auditEvent(roReq, 'reimbursement.submitted', { details: { to_status: 'pending_manager' } }))
        rs.requests.push(editorReq, roReq)
        await login(page, mock, CARLA)
        for (const p of ['/', '/reimbursements', '/reimbursements/new', `/reimbursements/${editorReq.request_id}`, `/reimbursements/${roReq.request_id}`]) {
          await page.goto(`${mock.origin}${p}`)
          await page.waitForSelector('.app-content h1')
          await page.waitForTimeout(150)
          assert.ok(await noOverflow(page), `${p} overflows at ${width}`)
        }
        const rev = await otherUser(mock, BEN, { width, height: 900 })
        await rev.page.goto(`${mock.origin}/reimbursements/${roReq.request_id}`)
        await rev.page.waitForSelector('[data-testid=reviewer-panel]')
        assert.ok(await noOverflow(rev.page), `reviewer view overflows at ${width}`)
        await rev.ctx.close()
      },
      { viewport: { width, height: 900 } },
    ))
}
