// Payday cutoff notices and badges: reimbursements and attendance corrections, against the deterministic mocks.
// Rule (server side): paydays are the Friday on or before the 15th and before month-end; the cutoff is 5 days earlier; a submission after
// the cutoff falls to the NEXT payday. The UI only shows what the server reports. Gated: RUN_BROWSER_TESTS=1.
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { distDir, launchBrowser, signIn } from './browser-env.mjs'
import { startMock } from './mock-api.mjs'
import { makeRequest, blankFields } from './mock-reimbursements.mjs'
import { EMAIL, seedDemoData, startTimesheetMock } from './timesheet-mock-api.mjs'
import { PAY_DEFERRED, PAY_LAST_DAY, PAY_NORMAL } from './mock-payday.mjs'
import { AUDIT } from './peoplemgmt-helpers.mjs'

const enabled = process.env.RUN_BROWSER_TESTS === '1'
const opts = { skip: enabled ? false : 'set RUN_BROWSER_TESTS=1 to run real-browser tests' }
let browser
before(async () => {
  if (enabled) browser = await launchBrowser()
})
after(async () => {
  await browser?.close()
})

const CARLA = 'carla.dizon@example.test' // Employee (owner of makeRequest rows)
const text = (page, sel) => page.locator(sel).first().innerText()
const count = (page, sel) => page.locator(sel).count()

const NORMAL_TEXT = 'Submit by Sun, 22 Nov to be handled on the Fri, 27 Nov payday. Later requests go to the Fri, 11 Dec payday.'
const NORMAL_CORR = 'Submit by Sun, 22 Nov to be handled on the Fri, 27 Nov payday. Later corrections go to the Fri, 11 Dec payday.'
const DEFERRED_TEXT = 'The cutoff for the nearest payday has passed. A request submitted today goes to the Fri, 11 Dec payday.'

async function withReimb(fn, { calendar = PAY_NORMAL, viewport = { width: 1448, height: 1000 } } = {}) {
  const mock = await startMock({ distDir })
  mock.state.reimb.config.pay_calendar = calendar
  const ctx = await browser.newContext({ viewport })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  try {
    await signIn(page, mock.origin, CARLA)
    await page.waitForSelector('.app-content')
    await fn({ page, mock, rs: mock.state.reimb })
    assert.deepEqual(errors, [], 'no uncaught page errors')
  } finally {
    await ctx.close()
    await mock.close()
  }
}

async function withTs(fn, { as = 'jamie', calendar = PAY_NORMAL, viewport = { width: 1448, height: 1000 }, seed = false } = {}) {
  const mock = await startTimesheetMock()
  if (seed) seedDemoData(mock)
  mock.state.payCalendar = calendar
  const ctx = await browser.newContext({ viewport })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  try {
    await signIn(page, mock.origin, EMAIL[as])
    await page.waitForSelector('.app-content')
    await fn({ page, mock, state: mock.state, origin: mock.origin })
    assert.deepEqual(errors, [], 'no uncaught page errors')
  } finally {
    await ctx.close()
    await mock.close()
  }
}

const submittedRequest = (over = {}) =>
  makeRequest({
    status: 'pending_manager',
    stage: 'manager',
    submitted_at: '2026-11-16T02:00:00.000Z',
    payday: { date: '2026-11-27', cutoff: '2026-11-22', deferred: false, submitted_on: '2026-11-16' },
    ...over,
  })

function draftWithReceipt() {
  const fields = blankFields()
  const set = (k, value) => (fields[k] = { value, source: 'extracted', extracted_value: value, confidence: 0.97, flag: null })
  set('merchant', 'Cafe Lumina (SYNTHETIC)')
  set('receipt_date', '2026-10-12')
  set('currency', 'PHP')
  set('total_amount', '1250.00')
  return makeRequest({
    fields,
    receipts: [
      { receipt_id: 'rc-1', filename: 'receipt-1.png', content_type: 'image/png', size_bytes: 70, sha256: 'a'.repeat(64), uploaded_at: new Date().toISOString(), uploaded_by: 'u-carla', is_current: true },
    ],
    extraction: { status: 'ok', provider: 'demo', model_label: 'demo-deterministic', error_code: null, receipt_id: 'rc-1', completed_at: new Date().toISOString() },
  })
}

// ------------------------------------------------------------------------------------------------ reimbursements
test('reimbursement form: the cutoff notice says where the cutoff is and which payday it lands on, with a countdown', opts, () =>
  withReimb(async ({ page, mock }) => {
    await page.goto(`${mock.origin}/reimbursements/new`)
    await page.waitForSelector('[data-testid=payday-notice]')
    assert.equal(await text(page, '[data-testid=payday-notice-text]'), NORMAL_TEXT)
    assert.equal(await page.getAttribute('[data-testid=payday-notice]', 'data-variant'), 'normal')
    assert.equal(await text(page, '[data-testid=payday-countdown]'), '6 days left to make the Fri, 27 Nov payday.')
    // informational only: the form still works
    await page.fill('[data-testid=purpose-input]', 'Taxi')
    assert.equal(await page.locator('[data-testid=create-draft]').isDisabled(), false)
  }))

test('reimbursement form: on the last day the notice says so; after the cutoff it says the request goes to the next payday', opts, async () => {
  await withReimb(
    async ({ page, mock }) => {
      await page.goto(`${mock.origin}/reimbursements/new`)
      await page.waitForSelector('[data-testid=payday-notice]')
      assert.equal(await text(page, '[data-testid=payday-countdown]'), 'Today is the last day to make the Fri, 27 Nov payday.')
    },
    { calendar: PAY_LAST_DAY },
  )
  await withReimb(
    async ({ page, mock }) => {
      await page.goto(`${mock.origin}/reimbursements/new`)
      await page.waitForSelector('[data-testid=payday-notice]')
      assert.equal(await page.getAttribute('[data-testid=payday-notice]', 'data-variant'), 'deferred')
      assert.equal(await text(page, '[data-testid=payday-notice-text]'), DEFERRED_TEXT)
      assert.equal(await count(page, '[data-testid=payday-countdown]'), 0)
      assert.equal(await page.locator('[data-testid=create-draft]').isDisabled(), true, 'still just needs a purpose: nothing is blocked')
    },
    { calendar: PAY_DEFERRED },
  )
})

test('reimbursement form: without pay calendar data there is no notice and nothing breaks', opts, () =>
  withReimb(
    async ({ page, mock }) => {
      await page.goto(`${mock.origin}/reimbursements/new`)
      await page.waitForSelector('[data-testid=purpose-input]')
      assert.equal(await count(page, '[data-testid=payday-notice]'), 0)
    },
    { calendar: null },
  ))

test('reimbursement submit: the notice shows before submitting; after submitting the page says which payday it landed on', opts, () =>
  withReimb(async ({ page, mock, rs }) => {
    const r = draftWithReceipt()
    rs.requests.push(r)
    await page.goto(`${mock.origin}/reimbursements/${r.request_id}`)
    await page.waitForSelector('[data-testid=submit-card]')
    assert.equal(await text(page, '[data-testid=submit-card] [data-testid=payday-notice-text]'), NORMAL_TEXT)
    assert.equal(await count(page, '[data-testid=detail-payday]'), 0, 'a draft has no payday yet')
    await page.check('[data-testid=confirm-check]')
    await page.click('[data-testid=submit-request]')
    await page.waitForSelector('[data-testid=reimb-detail][data-mode=readonly]')
    assert.match(await text(page, '[data-testid=detail-notice]'), /Submitted\. Your request is now with the reviewer\..*This request will be handled on the Fri, 27 Nov payday\./)
    assert.equal(await text(page, '[data-testid=detail-payday] .payday-pill'), 'Payday: Fri, 27 Nov')
    assert.equal(await count(page, '[data-testid=payday-deferred]'), 0)
  }))

test('reimbursement submit after the cutoff: the next payday, with a word marker and not colour alone', opts, () =>
  withReimb(
    async ({ page, mock, rs }) => {
      const r = draftWithReceipt()
      rs.requests.push(r)
      await page.goto(`${mock.origin}/reimbursements/${r.request_id}`)
      await page.waitForSelector('[data-testid=submit-card]')
      assert.equal(await page.getAttribute('[data-testid=submit-card] [data-testid=payday-notice]', 'data-variant'), 'deferred')
      await page.check('[data-testid=confirm-check]')
      await page.click('[data-testid=submit-request]')
      await page.waitForSelector('[data-testid=reimb-detail][data-mode=readonly]')
      assert.match(await text(page, '[data-testid=detail-notice]'), /Submitted after the cutoff, so this request goes to the next payday: Fri, 11 Dec\./)
      assert.equal(await text(page, '[data-testid=detail-payday] .payday-pill'), 'Payday: Fri, 11 Dec')
      assert.equal(await text(page, '[data-testid=payday-deferred]'), 'Next payday (submitted after the cutoff)')
    },
    { calendar: PAY_DEFERRED },
  ))

test('reimbursement list: submitted rows carry the payday (and the deferred marker); drafts carry none; cards on a phone too', opts, async () => {
  const seed = (rs) => {
    rs.requests.push(
      submittedRequest({ purpose: 'On time' }),
      submittedRequest({ purpose: 'Late one', payday: { date: '2026-12-11', cutoff: '2026-12-06', deferred: true, submitted_on: '2026-11-23' } }),
      makeRequest({ purpose: 'Still a draft' }),
    )
  }
  await withReimb(async ({ page, mock, rs }) => {
    seed(rs)
    await page.goto(`${mock.origin}/reimbursements`)
    await page.waitForSelector('[data-testid=reimb-row]')
    const onTime = page.locator('[data-testid=reimb-row]', { hasText: 'On time' })
    const late = page.locator('[data-testid=reimb-row]', { hasText: 'Late one' })
    const draft = page.locator('[data-testid=reimb-row]', { hasText: 'Still a draft' })
    assert.match(await onTime.innerText(), /Payday: Fri, 27 Nov/)
    assert.doesNotMatch(await onTime.innerText(), /Next payday/)
    assert.match(await late.innerText(), /Payday: Fri, 11 Dec/)
    assert.match(await late.innerText(), /Next payday \(submitted after the cutoff\)/)
    assert.doesNotMatch(await draft.innerText(), /Payday/)
  })
  await withReimb(
    async ({ page, mock, rs }) => {
      seed(rs)
      await page.goto(`${mock.origin}/reimbursements`)
      await page.waitForSelector('[data-testid=reimb-card]')
      const late = page.locator('[data-testid=reimb-card]', { hasText: 'Late one' })
      assert.match(await late.innerText(), /Payday: Fri, 11 Dec/)
      assert.match(await late.innerText(), /Next payday \(submitted after the cutoff\)/)
    },
    { viewport: { width: 390, height: 844 } },
  )
})

test('reimbursement detail of an older request without payday data shows no payday and no error', opts, () =>
  withReimb(async ({ page, mock, rs }) => {
    const r = submittedRequest({ payday: undefined })
    delete r.payday
    rs.requests.push(r)
    await page.goto(`${mock.origin}/reimbursements/${r.request_id}`)
    await page.waitForSelector('[data-testid=reimb-detail]')
    assert.equal(await count(page, '[data-testid=detail-payday]'), 0)
  }))

// ------------------------------------------------------------------------------------------------ attendance corrections
test('correction form: the same cutoff notice, worded for a correction', opts, async () => {
  await withTs(async ({ page, origin }) => {
    await page.goto(`${origin}/attendance?tab=corrections&new=1`)
    await page.waitForSelector('[data-testid=correction-form] [data-testid=payday-notice]')
    assert.equal(await text(page, '[data-testid=correction-form] [data-testid=payday-notice-text]'), NORMAL_CORR)
    assert.equal(await text(page, '[data-testid=correction-form] [data-testid=payday-countdown]'), '6 days left to make the Fri, 27 Nov payday.')
  })
  await withTs(
    async ({ page, origin }) => {
      await page.goto(`${origin}/attendance?tab=corrections&new=1`)
      await page.waitForSelector('[data-testid=correction-form] [data-testid=payday-notice]')
      assert.equal(await page.getAttribute('[data-testid=correction-form] [data-testid=payday-notice]', 'data-variant'), 'deferred')
      assert.equal(await text(page, '[data-testid=correction-form] [data-testid=payday-notice-text]'), 'The cutoff for the nearest payday has passed. A correction submitted today goes to the Fri, 11 Dec payday.')
    },
    { calendar: PAY_DEFERRED },
  )
  await withTs(
    async ({ page, origin }) => {
      await page.goto(`${origin}/attendance?tab=corrections&new=1`)
      await page.waitForSelector('[data-testid=correction-form]')
      assert.equal(await count(page, '[data-testid=payday-notice]'), 0)
    },
    { calendar: null },
  )
})

test('flagged-day flow: "Request a correction" lands on the form with the cutoff notice', opts, () =>
  withTs(
    async ({ page, origin }) => {
      await page.goto(`${origin}/attendance?tab=corrections&new=1&day=2026-11-14&session_id=9d1e0000-0000-4000-8000-0000000000a1`)
      await page.waitForSelector('[data-testid=correction-linked]')
      assert.equal(await text(page, '[data-testid=payday-notice-text]'), NORMAL_CORR)
    },
    { as: 'lia' },
  ))

test('correction submit: the new correction is stamped with its payday and the detail shows it', opts, () =>
  withTs(
    async ({ page, origin, state }) => {
      await page.goto(`${origin}/attendance?tab=corrections&new=1`)
      await page.waitForSelector('[data-testid=correction-form]')
      await page.fill('[data-testid=corr-day]', '2026-11-12')
      await page.fill('[data-testid=corr-in]', '09:00')
      await page.fill('[data-testid=corr-out]', '17:00')
      await page.fill('[data-testid=corr-reason]', 'Forgot to clock in')
      await page.click('[data-testid=corr-submit]')
      await page.waitForSelector('[data-testid=correction-detail]')
      assert.equal(state.corrections[0].payday.date, '2026-12-11')
      assert.equal(await text(page, '[data-testid=correction-payday] .payday-pill'), 'Payday: Fri, 11 Dec')
      assert.equal(await text(page, '[data-testid=payday-deferred]'), 'Next payday (submitted after the cutoff)')
      assert.match(await text(page, '[data-testid=payday-landed]'), /Submitted after the cutoff, so this correction goes to the next payday: Fri, 11 Dec\./)
    },
    { calendar: PAY_DEFERRED },
  ))

test('corrections list and detail: each row shows its payday; a late one carries the marker', opts, () =>
  withTs(
    async ({ page, origin }) => {
      await page.goto(`${origin}/attendance?tab=corrections`)
      await page.waitForSelector('[data-testid=corr-row]')
      const row = page.locator('[data-testid=corr-row][data-id=c-2]')
      assert.match(await row.innerText(), /Payday: Fri, 27 Nov/)
      assert.match(await row.innerText(), /Next payday \(submitted after the cutoff\)/)
      await row.locator('[data-testid=corr-open]').click()
      await page.waitForSelector('[data-testid=correction-detail]')
      assert.equal(await text(page, '[data-testid=correction-payday] .payday-pill'), 'Payday: Fri, 27 Nov')
      assert.match(await text(page, '[data-testid=payday-landed]'), /Submitted after the cutoff, so this correction goes to the next payday: Fri, 27 Nov\./)
    },
    { seed: true },
  ))

test('approvals queue: reviewers see which payday each correction belongs to', opts, () =>
  withTs(
    async ({ page, origin }) => {
      await page.goto(`${origin}/attendance?tab=approvals`)
      await page.waitForSelector('[data-testid=queue-row]')
      const late = page.locator('[data-testid=queue-row][data-id=c-2]')
      const onTime = page.locator('[data-testid=queue-row][data-id=c-3]')
      assert.match(await late.innerText(), /Payday: Fri, 27 Nov/)
      assert.match(await late.innerText(), /Next payday \(submitted after the cutoff\)/)
      assert.match(await onTime.innerText(), /Payday: Fri, 27 Nov/)
      assert.doesNotMatch(await onTime.innerText(), /Next payday/)
      const sheet = page.locator('[data-testid=queue-row][data-type=timesheet]').first()
      assert.doesNotMatch(await sheet.innerText(), /Payday/, 'timesheets are not part of the payday cutoff')
    },
    { as: 'miguel', seed: true },
  ))

// ------------------------------------------------------------------------------------------------ responsive
const WIDTHS = [1440, 1024, 768, 390, 320]
const HEIGHT = (w) => (w >= 1024 ? 900 : w >= 768 ? 1024 : 800)

for (const width of WIDTHS) {
  test(`payday notices and badges @${width}px: nothing overflows, text stays readable, targets are tappable`, opts, async () => {
    const problems = []
    const narrow = width <= 768
    const viewport = { width, height: HEIGHT(width) }
    const audit = async (page, name) => {
      await page.waitForTimeout(250)
      for (const p of await page.evaluate(AUDIT, { narrow })) problems.push(`${name}: ${p}`)
    }
    await withReimb(
      async ({ page, mock, rs }) => {
        const draft = draftWithReceipt()
        rs.requests.push(
          draft,
          submittedRequest({ purpose: 'On time' }),
          submittedRequest({ purpose: 'A late request with a rather long purpose title that has to wrap on narrow screens', payday: { date: '2026-12-11', cutoff: '2026-12-06', deferred: true, submitted_on: '2026-11-23' } }),
        )
        await page.goto(`${mock.origin}/reimbursements/new`)
        await page.waitForSelector('[data-testid=payday-notice]')
        await audit(page, 'reimbursement form (normal)')
        await page.goto(`${mock.origin}/reimbursements`)
        await page.waitForSelector('[data-testid=reimb-row], [data-testid=reimb-card]', { state: 'attached' })
        await audit(page, 'reimbursement list')
        await page.goto(`${mock.origin}/reimbursements/${draft.request_id}`)
        await page.waitForSelector('[data-testid=submit-card] [data-testid=payday-notice]')
        await audit(page, 'reimbursement submit card')
      },
      { viewport, calendar: PAY_NORMAL },
    )
    await withReimb(
      async ({ page, mock, rs }) => {
        const r = submittedRequest({ payday: { date: '2026-12-11', cutoff: '2026-12-06', deferred: true, submitted_on: '2026-11-23' } })
        rs.requests.push(r)
        await page.goto(`${mock.origin}/reimbursements/new`)
        await page.waitForSelector('[data-testid=payday-notice][data-variant=deferred]')
        await audit(page, 'reimbursement form (deferred)')
        await page.goto(`${mock.origin}/reimbursements/${r.request_id}`)
        await page.waitForSelector('[data-testid=detail-payday] [data-testid=payday-deferred]')
        await audit(page, 'reimbursement detail (deferred)')
      },
      { viewport, calendar: PAY_DEFERRED },
    )
    await withTs(
      async ({ page, origin }) => {
        await page.goto(`${origin}/attendance?tab=corrections&new=1`)
        await page.waitForSelector('[data-testid=correction-form] [data-testid=payday-notice]')
        await audit(page, 'correction form')
        await page.goto(`${origin}/attendance?tab=corrections`)
        await page.waitForSelector('[data-testid=corr-row], [data-testid=corr-card]', { state: 'attached' })
        await audit(page, 'corrections list')
        await page.goto(`${origin}/attendance?tab=corrections&id=c-2`)
        await page.waitForSelector('[data-testid=correction-detail] [data-testid=correction-payday]')
        await audit(page, 'correction detail')
      },
      { viewport, seed: true },
    )
    await withTs(
      async ({ page, origin }) => {
        await page.goto(`${origin}/attendance?tab=approvals`)
        await page.waitForSelector('[data-testid=queue-row], [data-testid=queue-card]', { state: 'attached' })
        await audit(page, 'approvals queue')
      },
      { as: 'miguel', viewport, seed: true },
    )
    assert.deepEqual(problems, [], `\n${problems.join('\n')}`)
  })
}
