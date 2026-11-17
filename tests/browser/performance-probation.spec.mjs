// Probation Evaluation tab (Performance & Check-ins) against the self-contained mock (performance-mock.mjs): who sees the tab, the manager's
// flow (start, rate, development rows, save draft, reload), the submit checklist (client and server), the complete + extend branch, locking,
// the PDF download, HR reopen and delete, the empty / forbidden / unsaved states. The responsive sweep lives in performance-learning-responsive.
// Gated: RUN_BROWSER_TESTS=1. Fictional data only.
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { ANNA, BEN, CARLA, enabled, launchBrowser, noOverflow, opts, text, until, withPerfMock } from './performance-learning-helpers.mjs'
import { PROBATION_KEYS, completeRatings, makeEvaluation } from './performance-mock.mjs'

let browser
before(async () => {
  if (enabled) browser = await launchBrowser()
})
after(async () => {
  await browser?.close()
})

const TAB = '[data-testid=probation-tab]'
const FORM = '[data-testid=eval-form]'
const posts = (state, re) => state.log.filter((l) => re.test(l))
const rateAll = async (page, n = 4) => {
  for (const k of PROBATION_KEYS) await page.check(`[data-testid=rating-${k}-${n}]`)
}

test('the tab sits right after HR overview for HR, after Team for a manager, and is absent for an employee', opts, async () => {
  await withPerfMock(browser, async ({ page, mock }) => {
    await page.goto(`${mock.origin}/performance`)
    await page.waitForSelector('[data-testid=tab-goals]')
    const ids = await page.$$eval('[role=tab]', (els) => els.map((e) => e.getAttribute('data-testid')))
    assert.deepEqual(ids, ['tab-goals', 'tab-checkins', 'tab-team', 'tab-overview', 'tab-probation'])
    assert.equal((await text(page, '[data-testid=tab-probation]')).trim(), 'Probation Evaluation')
    await page.click('[data-testid=tab-probation]')
    await page.waitForSelector(TAB)
    assert.match(page.url(), /tab=probation/)
    assert.match(await text(page, '[data-testid=probation-confidential]'), /confidential to the evaluating manager and HR/)
  }, { signInAs: ANNA })
  await withPerfMock(browser, async ({ page, mock }) => {
    await page.goto(`${mock.origin}/performance`)
    await page.waitForSelector('[data-testid=tab-goals]')
    const ids = await page.$$eval('[role=tab]', (els) => els.map((e) => e.getAttribute('data-testid')))
    assert.deepEqual(ids, ['tab-goals', 'tab-checkins', 'tab-team', 'tab-probation'])
  }, { signInAs: BEN })
  await withPerfMock(browser, async ({ page, mock }) => {
    await page.goto(`${mock.origin}/performance?tab=probation`)
    await page.waitForSelector('[data-testid=tab-goals]')
    assert.equal(await page.locator('[data-testid=tab-probation]').count(), 0)
    assert.equal(await page.getAttribute('[data-testid=performance-page]', 'data-tab'), 'goals', 'a forced tab falls back for an employee')
  }, { signInAs: CARLA })
})

test('manager flow: start an evaluation, rate, add a development row, save the draft (right PATCH body), reload keeps it', opts, async () => {
  await withPerfMock(browser, async ({ page, mock, state, errors }) => {
    await page.goto(`${mock.origin}/performance?tab=probation`)
    await page.waitForSelector(TAB)
    await page.waitForSelector('[data-testid=empty-state], .empty-state')
    await page.click('[data-testid=new-evaluation]')
    await page.waitForSelector('[data-testid=eligible-list]')
    const names = await page.$$eval('[data-testid=eligible-list] .pb-eligible-name', (els) => els.map((e) => e.textContent))
    assert.deepEqual(names, ['Carla Dizon', 'Dan Ocampo'], 'a manager can evaluate their direct reports')
    assert.ok(await page.isDisabled('[data-testid=new-evaluation-start]'), 'nobody chosen yet')
    await page.fill('[data-testid=eligible-search]', 'carla')
    assert.equal(await page.locator('[data-testid=eligible-list] .pb-eligible-item').count(), 1)
    await page.check('[data-testid=eligible-EMP-0003]')
    await page.click('[data-testid=new-evaluation-start]')
    await page.waitForSelector('[data-testid=probation-detail]')
    assert.match(page.url(), /\/performance\/probation\//)
    const facts = await text(page, '[data-testid=eval-facts]')
    assert.match(facts, /Carla Dizon/)
    assert.match(facts, /Compliance Analyst/)
    assert.match(facts, /Compliance/)
    assert.match(facts, /Ben Cruz/)
    assert.equal(await page.locator(`${FORM} [data-testid^=criterion-]`).count(), 9)
    assert.ok(await page.isVisible('[data-testid=rating-guide-body]'), 'the guide is open the first time')

    await page.check('[data-testid=rating-quality-5]')
    await page.check('[data-testid=rating-role-4]')
    await page.fill('[data-testid=comments-quality]', 'Very accurate work.')
    await page.click('[data-testid=dev-add]')
    await page.fill('[data-testid=dev-area-0]', 'Reporting')
    await page.fill('[data-testid=dev-actions-0]', 'Shadow the monthly report')
    await page.fill('[data-testid=dev-target_completion-0]', '2027-01-31')
    assert.match(await text(page, '[data-testid=eval-progress]'), /2 of 9 rated\. Average 4\.5/)
    assert.match(await text(page, '[data-testid=eval-bar-status]'), /unsaved changes/)
    await page.click('[data-testid=save-draft]')
    await page.waitForSelector('[data-testid=probation-flash]')
    assert.match(await text(page, '[data-testid=probation-flash]'), /Draft saved/)
    assert.match(await text(page, '[data-testid=eval-bar-status]'), /all changes saved/)

    const patch = state.probationBodies.filter((b) => b.method === 'PATCH').at(-1)
    assert.deepEqual(patch.body, {
      ratings: { role: { rating: 4, comments: '' }, quality: { rating: 5, comments: 'Very accurate work.' } },
      development_rows: [{ area: 'Reporting', actions: 'Shadow the monthly report', target_completion: '2027-01-31' }],
    })

    await page.reload()
    await page.waitForSelector('[data-testid=probation-detail]')
    assert.ok(await page.isChecked('[data-testid=rating-quality-5]'))
    assert.ok(await page.isChecked('[data-testid=rating-role-4]'))
    assert.equal(await page.inputValue('[data-testid=comments-quality]'), 'Very accurate work.')
    assert.equal(await page.inputValue('[data-testid=dev-area-0]'), 'Reporting')
    assert.equal(await page.getAttribute('[data-testid=probation-detail]', 'data-status'), 'draft')
    assert.deepEqual(errors, [])
  }, { signInAs: BEN })
})

test('submit with things missing shows the checklist, focuses the first item and sends nothing final', opts, async () => {
  await withPerfMock(browser, async ({ page, mock, state }) => {
    const ev = state.probation[0]
    await page.goto(`${mock.origin}/performance/probation/${ev.evaluation_id}`)
    await page.waitForSelector('[data-testid=probation-detail]')
    await page.check('[data-testid=rating-quality-4]')
    await page.click('[data-testid=submit-evaluation]')
    await page.waitForSelector('[data-testid=missing-list]')
    const list = await text(page, '[data-testid=missing-list]')
    assert.match(list, /1\. Understanding of the Role: rating/)
    assert.match(list, /Overall performance summary/)
    assert.match(list, /Recommendation/)
    assert.ok(!/2\. Quality of Work/.test(list), 'what is rated is not listed')
    assert.equal(await page.locator('[data-testid=submit-dialog]').count(), 0, 'no confirm dialog while things are missing')
    const focused = await page.evaluate(() => document.activeElement?.closest('#eval-rating-role') !== null)
    assert.ok(focused, 'focus moved to the first missing rating')
    assert.equal(posts(state, /POST \/performance\/probation\/.+\/submit/).length, 0)
    assert.equal(state.probation[0].status, 'draft')
    // the checklist shrinks as it is filled in
    await page.check('[data-testid=rating-role-3]')
    await page.waitForFunction(() => !/Understanding of the Role: rating/.test(document.querySelector('[data-testid=missing-list]')?.textContent || ''))
  }, { signInAs: BEN, seed: (s) => s.probation.push(makeEvaluation()) })
})

test('complete + extend: the extension fields are required, then submit confirms, locks, notifies and offers the PDF', opts, async () => {
  await withPerfMock(browser, async ({ page, mock, state, errors }) => {
    const ev = state.probation[0]
    await page.goto(`${mock.origin}/performance/probation/${ev.evaluation_id}`)
    await page.waitForSelector('[data-testid=probation-detail]')
    await rateAll(page, 4)
    await page.fill('[data-testid=strengths]', 'Reliable and curious.')
    await page.fill('[data-testid=summary]', 'Good progress; needs a little longer on quality.')
    await page.check('[data-testid=recommendation-extend]')
    await page.waitForSelector('[data-testid=extension-block]')
    assert.match(await text(page, '[data-testid=recommendation-note]'), /does not change the employee's status/)
    await page.click('[data-testid=submit-evaluation]')
    await page.waitForSelector('[data-testid=missing-list]')
    const list = await text(page, '[data-testid=missing-list]')
    assert.match(list, /Extension: reasons/)
    assert.match(list, /Extension: improvement objectives/)
    assert.match(list, /Extension: proposed review date/)
    assert.equal(posts(state, /\/submit/).length, 0)

    await page.fill('[data-testid=ext-reasons]', 'Quality dipped in October.')
    await page.fill('[data-testid=ext-objectives]', 'Zero rework for a month.')
    await page.fill('[data-testid=ext-review-date]', '2027-02-01')
    await page.click('[data-testid=submit-evaluation]')
    await page.waitForSelector('[data-testid=submit-dialog]')
    assert.match(await text(page, '[data-testid=submit-dialog]'), /locks the evaluation .* notifies HR/s)
    await page.click('[data-testid=submit-confirm]')
    await page.waitForFunction(() => document.querySelector('[data-testid=probation-detail]')?.getAttribute('data-mode') === 'read')
    assert.equal(state.probation[0].status, 'submitted')
    assert.deepEqual(state.probation[0].extension, { reasons: 'Quality dipped in October.', objectives: 'Zero rework for a month.', review_date: '2027-02-01' })
    assert.match(await text(page, '[data-testid=eval-status]'), /Submitted/)
    assert.match(await text(page, '[data-testid=eval-recommendation-pill]'), /Extend probation/)
    assert.equal(await page.locator('[data-testid=probation-detail] textarea').count(), 0, 'read-only: no inputs left')
    assert.equal(await page.locator('[data-testid=save-draft], [data-testid=submit-evaluation]').count(), 0)
    assert.match(await text(page, '[data-testid=rating-read-quality]'), /4 - Meets Expectations/)

    const [download] = await Promise.all([page.waitForEvent('download'), page.click('[data-testid=download-pdf]')])
    assert.equal(download.suggestedFilename(), 'Probation Evaluation - Carla Dizon.pdf')
    assert.equal(state.pdfCalls.length, 1)
    assert.deepEqual(errors, [])
  }, { signInAs: BEN, seed: (s) => s.probation.push(makeEvaluation()) })
})

test('the server can still say "incomplete": its list is shown, nothing is locked', opts, async () => {
  await withPerfMock(browser, async ({ page, mock, state }) => {
    state.probationForceMissing = ['development_comments']
    const ev = state.probation[0]
    await page.goto(`${mock.origin}/performance/probation/${ev.evaluation_id}`)
    await page.waitForSelector('[data-testid=probation-detail]')
    await page.click('[data-testid=submit-evaluation]')
    await page.click('[data-testid=submit-confirm]')
    await page.waitForSelector('[data-testid=missing-list]')
    assert.match(await text(page, '[data-testid=missing-list]'), /Areas for development/)
    assert.equal(await page.locator('[data-testid=submit-dialog]').count(), 0)
    assert.equal(state.probation[0].status, 'draft')
    assert.equal(await page.getAttribute('[data-testid=probation-detail]', 'data-mode'), 'edit')
    // filling the field removes it from the checklist
    await page.fill('[data-testid=development-comments]', 'More practice with the reporting tools.')
    await page.waitForFunction(() => !document.querySelector('[data-testid=missing-list]'))
  }, {
    signInAs: BEN,
    seed: (s) => {
      const e = makeEvaluation({ ratings: completeRatings(4), strengths: 'Solid.', summary: 'Done.', recommendation: 'confirm' })
      s.probation.push(e)
    },
  })
})

test('HR: sees every evaluation, filters and searches, opens a submitted one read-only, reopens it, deletes a draft', opts, async () => {
  await withPerfMock(browser, async ({ page, mock, state }) => {
    await page.goto(`${mock.origin}/performance?tab=probation`)
    await page.waitForSelector('[data-testid=probation-row]')
    assert.equal(await page.locator('[data-testid=probation-row]').count(), 2)
    const rows = await page.$$eval('[data-testid=probation-row]', (els) => els.map((e) => e.innerText))
    const submitted = rows.find((r) => /Carla Dizon/.test(r))
    assert.match(submitted, /Submitted/)
    assert.match(submitted, /Confirm employment/)
    assert.match(submitted, /Average 4\.0/)
    assert.match(submitted, /Evaluator: Ben Cruz/)

    await page.click('[data-testid=filter-draft]')
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=probation-row]').length === 1)
    assert.match(await text(page, '[data-testid=probation-row]'), /Dan Ocampo/)
    assert.equal(await page.getAttribute('[data-testid=filter-draft]', 'aria-pressed'), 'true')
    await page.click('[data-testid=filter-submitted]')
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=probation-row]').length === 1 && /Carla/.test(document.querySelector('[data-testid=probation-row]').textContent))
    await page.click('[data-testid=filter-all]')
    await page.fill('[data-testid=probation-search]', 'dan')
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=probation-row]').length === 1)
    await page.fill('[data-testid=probation-search]', 'nobody-by-this-name')
    await page.waitForSelector('.empty-state, [data-testid=empty-state]')
    assert.match(await text(page, '[data-testid=probation-tab]'), /No evaluations match/)
    await page.fill('[data-testid=probation-search]', '')
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=probation-row]').length === 2)

    // open the submitted evaluation: read-only for HR, with Reopen
    await page.locator('[data-testid=probation-row]', { hasText: 'Carla Dizon' }).locator('[data-testid=probation-open]').click()
    await page.waitForSelector('[data-testid=probation-detail]')
    assert.equal(await page.getAttribute('[data-testid=probation-detail]', 'data-mode'), 'read')
    await page.click('[data-testid=reopen]')
    await page.waitForSelector('[data-testid=reopen-dialog]')
    await page.click('[data-testid=reopen-cancel]')
    assert.equal(state.probation[0].status, 'submitted')
    await page.click('[data-testid=reopen]')
    await page.click('[data-testid=reopen-confirm]')
    await page.waitForFunction(() => /Draft/.test(document.querySelector('[data-testid=eval-status]')?.textContent || ''))
    assert.equal(state.probation[0].status, 'draft')
    assert.equal(await page.locator('[data-testid=reopen]').count(), 0)

    // HR can delete a draft
    await page.click('[data-testid=delete]')
    await page.waitForSelector('[data-testid=delete-dialog]')
    await page.click('[data-testid=delete-confirm]')
    await page.waitForSelector(TAB)
    assert.equal(state.probation.length, 1)
    assert.match(page.url(), /tab=probation/)
  }, {
    signInAs: ANNA,
    seed: (s) => {
      s.probation.push(makeEvaluation({ status: 'submitted', ratings: completeRatings(4), summary: 'Ready.', recommendation: 'confirm', submitted_at: '2026-11-15T09:00:00.000Z', submitted_by_name: 'Ben Cruz', updated_at: '2026-11-15T09:00:00.000Z' }))
      s.probation.push(makeEvaluation({ employee_id: 'EMP-0004', updated_at: '2026-11-14T09:00:00.000Z' }))
    },
  })
})

test('delete a draft as the evaluator, and the list shows an empty state afterwards', opts, async () => {
  await withPerfMock(browser, async ({ page, mock, state }) => {
    await page.goto(`${mock.origin}/performance/probation/${state.probation[0].evaluation_id}`)
    await page.waitForSelector('[data-testid=probation-detail]')
    await page.click('[data-testid=delete]')
    await page.waitForSelector('[data-testid=delete-dialog]')
    assert.match(await text(page, '[data-testid=delete-dialog]'), /removed for good/)
    await page.click('[data-testid=delete-confirm]')
    await page.waitForSelector(TAB)
    await page.waitForSelector('.empty-state, [data-testid=empty-state]')
    assert.equal(state.probation.length, 0)
    assert.equal(state.probationBodies.filter((b) => b.method === 'DELETE').length, 1)
  }, { signInAs: BEN, seed: (s) => s.probation.push(makeEvaluation()) })
})

test('nobody to evaluate: the picker explains why; a second draft for the same person is refused with the server reason', opts, async () => {
  await withPerfMock(browser, async ({ page, mock, state }) => {
    state.probationEligible = []
    await page.goto(`${mock.origin}/performance?tab=probation`)
    await page.waitForSelector(TAB)
    await page.click('[data-testid=new-evaluation]')
    await page.waitForSelector('[data-testid=eligible-empty]')
    assert.match(await text(page, '[data-testid=eligible-empty]'), /direct reports need to be on file/)
    assert.ok(await page.isDisabled('[data-testid=new-evaluation-start]'))
  }, { signInAs: BEN })
  await withPerfMock(browser, async ({ page, mock }) => {
    await page.goto(`${mock.origin}/performance?tab=probation`)
    await page.waitForSelector('[data-testid=probation-row]')
    await page.click('[data-testid=new-evaluation]')
    await page.check('[data-testid=eligible-EMP-0003]')
    await page.click('[data-testid=new-evaluation-start]')
    await page.waitForSelector('[data-testid=new-evaluation-error]')
    assert.match(await text(page, '[data-testid=new-evaluation-error]'), /already have a draft evaluation for this person/)
    assert.match(await text(page, '[data-testid=new-evaluation-error]'), /Open the existing draft/)
  }, { signInAs: BEN, seed: (s) => s.probation.push(makeEvaluation()) })
})

test('an employee gets "not available" for the form and the list; a missing evaluation says so', opts, async () => {
  await withPerfMock(browser, async ({ page, mock, state }) => {
    await page.goto(`${mock.origin}/performance/probation/${state.probation[0].evaluation_id}`)
    await page.waitForSelector('[data-testid=probation-detail-error]')
    assert.match(await text(page, '[data-testid=probation-detail-error]'), /Not available/)
    assert.equal(await page.locator('[data-testid=eval-form]').count(), 0)
  }, { signInAs: CARLA, seed: (s) => s.probation.push(makeEvaluation()) })
  await withPerfMock(browser, async ({ page, mock }) => {
    await page.goto(`${mock.origin}/performance/probation/does-not-exist`)
    await page.waitForSelector('[data-testid=probation-detail-error]')
    assert.match(await text(page, '[data-testid=probation-detail-error]'), /Evaluation not found/)
  }, { signInAs: BEN })
})

test('unsaved changes: Back asks first; Keep editing stays, Leave goes back to the list', opts, async () => {
  await withPerfMock(browser, async ({ page, mock, state }) => {
    await page.goto(`${mock.origin}/performance/probation/${state.probation[0].evaluation_id}`)
    await page.waitForSelector('[data-testid=probation-detail]')
    await page.click('[data-testid=back-link]')
    await page.waitForSelector(TAB) // nothing typed: leaves straight away
    await page.goBack()
    await page.waitForSelector('[data-testid=probation-detail]')
    await page.fill('[data-testid=summary]', 'Typed but not saved')
    await page.click('[data-testid=back-link]')
    await page.waitForSelector('[data-testid=leave-dialog]')
    await page.click('[data-testid=leave-stay]')
    assert.equal(await page.inputValue('[data-testid=summary]'), 'Typed but not saved')
    await page.click('[data-testid=back-link]')
    await page.click('[data-testid=leave-confirm]')
    await page.waitForSelector(TAB)
    assert.equal(state.probationBodies.filter((b) => b.method === 'PATCH').length, 0, 'nothing was saved behind the user\'s back')
  }, { signInAs: BEN, seed: (s) => s.probation.push(makeEvaluation()) })
})

test('validation and server errors keep what was typed: too long is caught before a request; a stale draft says so', opts, async () => {
  await withPerfMock(browser, async ({ page, mock, state }) => {
    await page.goto(`${mock.origin}/performance/probation/${state.probation[0].evaluation_id}`)
    await page.waitForSelector('[data-testid=probation-detail]')
    await page.fill('[data-testid=summary]', 'x'.repeat(2001))
    await page.click('[data-testid=save-draft]')
    await page.waitForSelector('#eval-summary-error')
    assert.match(await text(page, '#eval-summary-error'), /at most 2000/)
    assert.equal(state.probationBodies.filter((b) => b.method === 'PATCH').length, 0)
    await page.fill('[data-testid=summary]', 'Short and fine.')
    // someone else submitted it meanwhile: the server answers 409
    state.probation[0].status = 'submitted'
    await page.click('[data-testid=save-draft]')
    await page.waitForSelector('[data-testid=probation-banner]')
    assert.match(await text(page, '[data-testid=probation-banner]'), /no longer a draft/)
    assert.equal(await page.inputValue('[data-testid=summary]'), 'Short and fine.', 'typed text is kept')
    assert.ok(await page.isVisible('[data-testid=probation-reload]'))
  }, { signInAs: BEN, seed: (s) => s.probation.push(makeEvaluation()) })
})

test('PDF problems are shown, not swallowed; the rating guide can be collapsed and reopened', opts, async () => {
  await withPerfMock(browser, async ({ page, mock, state }) => {
    state.probationPdfStatus = 500
    await page.goto(`${mock.origin}/performance/probation/${state.probation[0].evaluation_id}`)
    await page.waitForSelector('[data-testid=probation-detail]')
    assert.ok(!(await page.isVisible('[data-testid=rating-guide-body]')), 'already rated: the guide starts collapsed')
    await page.click('[data-testid=rating-guide-toggle]')
    assert.ok(await page.isVisible('[data-testid=rating-guide-body]'))
    assert.match(await text(page, '[data-testid=rating-guide-body]'), /5 - Exceeds Expectations/)
    assert.equal(await page.getAttribute('[data-testid=rating-guide-toggle]', 'aria-expanded'), 'true')
    await page.click('[data-testid=rating-guide-toggle]')
    assert.ok(!(await page.isVisible('[data-testid=rating-guide-body]')))
    await page.click('[data-testid=download-pdf]')
    await page.waitForSelector('[data-testid=probation-flash]')
    assert.match(await text(page, '[data-testid=probation-flash]'), /could not be downloaded|not available/)
    await until(() => state.pdfCalls.length === 1)
    assert.ok(await noOverflow(page))
  }, { signInAs: BEN, seed: (s) => s.probation.push(makeEvaluation({ ratings: completeRatings(3) })) })
})
