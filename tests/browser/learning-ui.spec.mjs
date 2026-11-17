// Learning & Development UI states against a self-contained MOCK of /learning (learning-mock.mjs): loading, error +
// retry, empty, server-driven allowed_actions, OVERDUE and due-soon flags (the mock keeps an injectable "today", which
// the real browser run cannot), compliance with names (HR only), certificate error wording, conflicts and validation.
// The real-backend flows live in e2e-learning.spec.mjs.
// Gated: RUN_BROWSER_TESTS=1 (use `npm run test:browser`). Fictional mock data only.
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { ANNA, BEN, CARLA, enabled, launchBrowser, noOverflow, opts, text, until, visit, withLearnMock } from './performance-learning-helpers.mjs'
import { makeEnrolment } from './learning-mock.mjs'

let browser
before(async () => {
  if (enabled) browser = await launchBrowser()
})
after(async () => {
  await browser?.close()
})

const LEARN = '[data-testid=learning-page]'
const cid = (state, title) => state.courses.find((c) => c.title === title).course_id
/** Carla's work: one overdue, one due soon, one plain, one completed waiting for Ben, one voluntary self-enrolment. */
function seedMine(state) {
  const wh = cid(state, 'Workplace Health and Safety Basics')
  const dp = cid(state, 'Data Privacy Essentials')
  const ec = cid(state, 'Effective Communication Skills')
  const ip = cid(state, 'Introduction to Project Planning')
  state.enrolments.push(
    makeEnrolment({ course_id: wh, due_date: '2026-11-10', status: 'in_progress', progress: 30 }), // 6 days overdue
    makeEnrolment({ course_id: dp, due_date: '2026-11-18', status: 'assigned' }), // due in 2 days
    makeEnrolment({ course_id: ip, due_date: '2027-02-01', status: 'assigned', mandatory: false }),
    makeEnrolment({ course_id: ec, source: 'self', assigned_by: null, assigned_at: null, mandatory: false, status: 'completed', progress: 100, confirmation_status: 'not_required', completed_at: '2026-11-01T00:00:00.000Z' }),
  )
}

test('catalog: cards, actions from the server, filters, enrol, the open link afterwards, and a refused enrolment shows the server message', opts, async () => {
  await withLearnMock(
    browser,
    async ({ page, mock, state }) => {
      await visit(page, mock, '/learning', '[data-testid=course-card]')
      assert.equal(await page.locator('[data-testid=course-card]').count(), 4)
      assert.equal(await page.locator('[data-testid=course-placeholder]').count(), 0)
      assert.equal(await page.locator('[data-testid=course-assign]').count(), 0)
      assert.equal(await page.locator('[data-testid=placeholder-notice]').count(), 0)
      await page.fill('[data-testid=catalog-search]', 'privacy')
      await page.waitForFunction(() => document.querySelectorAll('[data-testid=course-card]').length === 1)
      await page.fill('[data-testid=catalog-search]', '')
      await page.selectOption('[data-testid=catalog-delivery]', 'classroom')
      await page.waitForFunction(() => document.querySelectorAll('[data-testid=course-card]').length === 1)
      await page.selectOption('[data-testid=catalog-delivery]', '')
      await page.waitForFunction(() => document.querySelectorAll('[data-testid=course-card]').length === 4)
      const before = state.enrolments.length
      await page.locator('[data-testid=course-card]', { hasText: 'Effective Communication Skills' }).locator('[data-testid=course-enrol]').click()
      await page.waitForSelector('[data-testid=catalog-flash]')
      assert.equal(state.enrolments.length, before + 1)
      await page.waitForSelector('[data-testid=course-open]')
      // a second enrol attempt (stale page): the server says 409, the UI shows it and refreshes
      state.failures.set('/learning/enrolments', { status: 409, times: 1, body: { detail: 'You already have this course open' } })
      await page.locator('[data-testid=course-card]', { hasText: 'Introduction to Project Planning' }).locator('[data-testid=course-enrol]').click()
      await page.waitForSelector('[data-testid=catalog-action-error]')
      assert.match(await text(page, '[data-testid=catalog-action-error]'), /already have this course open/)
    },
    { signInAs: CARLA },
  )
})

test('catalog: loading skeleton, error with Try again that recovers, and an honest empty catalog', opts, async () => {
  await withLearnMock(
    browser,
    async ({ page, mock, state }) => {
      state.delayMs = 400
      state.failures.set('/learning/courses', { status: 500, times: 1 })
      await page.goto(`${mock.origin}/learning`)
      await page.waitForSelector('[data-testid=loading]')
      await page.waitForSelector('[data-testid=load-error]')
      state.delayMs = 0
      await page.click('[data-testid=load-error] button')
      await page.waitForSelector('[data-testid=course-card]')
      state.courses.length = 0
      await page.reload()
      await page.waitForSelector('[data-testid=catalog] [data-testid=empty-state]')
      assert.match(await text(page, '[data-testid=empty-state]'), /No courses are available yet/)
    },
    { signInAs: CARLA },
  )
})

test('my learning: calls the summary, shows overdue (red, days late) and due-soon from the SERVER flags, counts and filters', opts, async () => {
  await withLearnMock(
    browser,
    async ({ page, mock, state, errors }) => {
      await visit(page, mock, '/learning?tab=mine', '[data-testid=enrolment-row]')
      assert.ok(state.summaryCalls >= 1, 'GET /learning/my/summary is called when My learning loads')
      assert.equal(await page.locator('[data-testid=enrolment-row]').count(), 4)
      const overdue = page.locator('[data-testid=enrolment-row][data-overdue=true]')
      assert.equal(await overdue.count(), 1)
      assert.match(await overdue.innerText(), /Workplace Health and Safety Basics/)
      assert.match(await overdue.locator('[data-testid=due-text]').innerText(), /Due 10 Nov 2026 - 6 days overdue/)
      assert.equal(await overdue.locator('[data-testid=overdue-pill]').count(), 1)
      const soon = page.locator('[data-testid=enrolment-row]', { hasText: 'Data Privacy Essentials' })
      assert.match(await soon.locator('[data-testid=due-text]').innerText(), /in 2 days/)
      assert.equal(await soon.locator('[data-testid=due-soon-pill]').count(), 1)
      assert.equal(await soon.locator('[data-testid=overdue-pill]').count(), 0)
      const plain = page.locator('[data-testid=enrolment-row]', { hasText: 'Introduction to Project Planning' })
      assert.equal(await plain.locator('[data-testid=due-soon-pill]').count(), 0)
      assert.equal(await plain.locator('[data-testid=mandatory-pill]').count(), 0, 'voluntary: not mandatory')
      assert.match(await text(page, '[data-testid=count-overdue]'), /^1$/)
      assert.match(await text(page, '[data-testid=count-due-soon]'), /^1$/)
      assert.match(await text(page, '[data-testid=count-open]'), /^3$/)
      assert.match(await text(page, '[data-testid=count-completed]'), /^1$/)
      // moving the server clock moves the flags (nothing is computed in the browser)
      state.today = '2026-11-25'
      await page.reload()
      await page.waitForSelector('[data-testid=enrolment-row]')
      assert.equal(await page.locator('[data-testid=enrolment-row][data-overdue=true]').count(), 2)
      // filters
      await page.check('[data-testid=mine-overdue]')
      await page.waitForFunction(() => document.querySelectorAll('[data-testid=enrolment-row]').length === 2)
      await page.uncheck('[data-testid=mine-overdue]')
      await page.selectOption('[data-testid=mine-status]', 'completed')
      await page.waitForFunction(() => document.querySelectorAll('[data-testid=enrolment-row]').length === 1)
      assert.match(await text(page, '[data-testid=enrolment-row]'), /Self-attested/)
      assert.deepEqual(errors, [])
    },
    { signInAs: CARLA, seed: seedMine },
  )
})

test('my learning: empty state links to the catalog; a failed load can be retried', opts, async () => {
  await withLearnMock(
    browser,
    async ({ page, mock, state }) => {
      state.failures.set('/learning/enrolments', { status: 500, times: 1 })
      await visit(page, mock, '/learning?tab=mine', '[data-testid=load-error]')
      await page.click('[data-testid=load-error] button')
      await page.waitForSelector('[data-testid=my-learning] [data-testid=empty-state]')
      assert.match(await text(page, '[data-testid=empty-state]'), /not enrolled in anything yet/)
      await page.click('[data-testid=browse-catalog]')
      await page.waitForSelector('[data-testid=catalog]')
    },
    { signInAs: CARLA },
  )
})

test('enrolment detail: owner actions come from allowed_actions only (forced [] means read-only, forced "confirm" shows the confirm card)', opts, async () => {
  await withLearnMock(
    browser,
    async ({ page, mock, state }) => {
      const id = state.enrolments[0].enrolment_id
      await visit(page, mock, `/learning/enrolments/${id}`, '[data-testid=enrolment-detail]')
      assert.equal(await page.locator('[data-testid=owner-actions]').count(), 1)
      assert.equal(await page.locator('[data-testid=progress-slider]').count(), 1)
      assert.equal(await page.locator('[data-testid=certificate-upload]').count(), 1)
      assert.match(await text(page, '[data-testid=enrolment-due]'), /6 days overdue/)
      assert.equal(await page.locator('[data-testid=overdue-pill]').count(), 1)
      state.forceEnrolmentActions = []
      await page.reload()
      await page.waitForSelector('[data-testid=enrolment-readonly]')
      for (const t of ['owner-actions', 'manage-card', 'confirm-card', 'certificate-upload']) assert.equal(await page.locator(`[data-testid=${t}]`).count(), 0, t)
      state.forceEnrolmentActions = ['confirm', 'return']
      await page.reload()
      await page.waitForSelector('[data-testid=confirm-card]')
      assert.equal(await page.locator('[data-testid=owner-actions]').count(), 0)
      state.forceEnrolmentActions = ['update_due_date', 'cancel']
      await page.reload()
      await page.waitForSelector('[data-testid=manage-card]')
      assert.equal(await page.locator('[data-testid=confirm-card]').count(), 0)
    },
    { signInAs: CARLA, seed: seedMine },
  )
})

test('enrolment detail: progress saves, completion with the right hint, stale version (409) reloads with a banner', opts, async () => {
  await withLearnMock(
    browser,
    async ({ page, mock, state }) => {
      const e = state.enrolments[0]
      await visit(page, mock, `/learning/enrolments/${e.enrolment_id}`, '[data-testid=enrolment-detail]')
      assert.equal(await page.locator('[data-testid=progress-save]').isDisabled(), true)
      await page.fill('[data-testid=progress-slider]', '65')
      await page.click('[data-testid=progress-save]')
      await page.waitForFunction(() => /Progress saved: 65%/.test(document.querySelector('[data-testid=enrolment-banner]')?.textContent || ''))
      assert.equal(e.progress, 65)
      assert.match(await text(page, '[data-testid=complete-hint]'), /needs confirmation/)
      // stale: someone changed it meanwhile
      e.version += 4
      e.progress = 80
      await page.fill('[data-testid=progress-slider]', '70')
      await page.click('[data-testid=progress-save]')
      await page.waitForFunction(() => /latest version has been loaded/.test(document.querySelector('[data-testid=enrolment-banner]')?.textContent || ''))
      await page.waitForFunction(() => /80%/.test(document.querySelector('[data-testid=enrolment-progress]')?.textContent || ''))
      // complete
      await page.fill('[data-testid=completion-note-input]', 'All done (fictional).')
      await page.click('[data-testid=complete-course]')
      await page.waitForFunction(() => /waiting for confirmation/.test(document.querySelector('[data-testid=enrolment-banner]')?.textContent || ''))
      assert.equal(e.confirmation_status, 'pending')
      assert.equal(await page.locator('[data-testid=owner-actions]').count(), 0)
    },
    { signInAs: CARLA, seed: seedMine },
  )
})

test('certificate: server 415 and 413 are shown inline with "Nothing was stored", a valid file is listed and downloads through the authorised client', opts, async () => {
  await withLearnMock(
    browser,
    async ({ page, mock, state }) => {
      const e = state.enrolments[0]
      await visit(page, mock, `/learning/enrolments/${e.enrolment_id}`, '[data-testid=certificate-upload]')
      assert.match(await text(page, '[data-testid=certificate-hint]'), /PDF, PNG or JPEG, up to 10 MB, at most 5 files/)
      assert.equal(await page.locator('[data-testid=certificate-upload-btn]').isDisabled(), true, 'nothing selected yet')
      await page.setInputFiles('[data-testid=certificate-input]', { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') })
      await page.click('[data-testid=certificate-upload-btn]')
      await page.waitForSelector('[data-testid=certificate-error]')
      assert.match(await text(page, '[data-testid=certificate-error]'), /not accepted\. Use a PDF, PNG or JPEG\. Nothing was stored/)
      state.failures.set('/learning/enrolments', { status: 413, times: 1, body: { detail: 'The request is too large' } })
      await page.setInputFiles('[data-testid=certificate-input]', { name: 'big.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 small') })
      await page.click('[data-testid=certificate-upload-btn]')
      await page.waitForFunction(() => /too large \(limit 10 MB\)/.test(document.querySelector('[data-testid=certificate-error]')?.textContent || ''))
      assert.equal(await page.locator('[data-testid=certificate-row]').count(), 0)

      await page.setInputFiles('[data-testid=certificate-input]', { name: 'first-aid.png', mimeType: 'image/png', buffer: Buffer.from('89504e47', 'hex') })
      await page.click('[data-testid=certificate-upload-btn]')
      await page.waitForSelector('[data-testid=certificate-row]')
      assert.equal(await page.locator('[data-testid=certificate-error]').count(), 0)
      assert.match(await text(page, '[data-testid=certificate-name]'), /first-aid\.png/)
      const reqs = []
      page.on('request', (r) => {
        if (/\/file$/.test(r.url())) reqs.push(r.headers().authorization)
      })
      const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-testid=certificate-download]')])
      assert.match(dl.suggestedFilename(), /^certificate-[0-9a-f-]{8}\.png$/)
      assert.match(reqs[0] ?? '', /^Bearer acc-/)
      // a certificate that has gone missing on the server is reported, not silently ignored
      e.certificates.length = 0
      e.certificates.push({ certificate_id: 'ghost', filename: 'gone.png', content_type: 'image/png', size_bytes: 10, uploaded_at: '2026-11-01T00:00:00.000Z', is_current: true, missing: true })
      await page.reload()
      await page.waitForSelector('[data-testid=certificate-download]')
      await page.click('[data-testid=certificate-download]')
      await page.waitForSelector('[data-testid=certificate-download-error]')
      assert.match(await text(page, '[data-testid=certificate-download-error]'), /not available/)
    },
    { signInAs: CARLA, seed: seedMine },
  )
})

test('manager: team summary rows, the review queue with Confirm and Send back, assign with validation, a conflict link and a refused person', opts, async () => {
  await withLearnMock(
    browser,
    async ({ page, mock, state }) => {
      await visit(page, mock, '/learning', LEARN)
      assert.equal(await page.locator('[data-testid^=tab-]').count(), 3)
      await page.waitForFunction(() => /\b1\b/.test(document.querySelector('[data-testid=tab-team]')?.innerText || ''))
      await page.click('[data-testid=tab-team]')
      await page.waitForSelector('[data-testid=team-summary]')
      assert.equal(await page.locator('[data-testid=team-row]').count(), 2)
      const carla = page.locator('[data-testid=team-row][data-id=EMP-0003]')
      assert.match(await carla.innerText(), /1 overdue/)
      assert.match(await carla.innerText(), /1 to confirm/)
      // the review queue
      await page.waitForSelector('[data-testid=review-queue] [data-testid=confirm-completion]')
      await page.click('[data-testid=review-queue] [data-testid=return-completion]')
      await page.waitForSelector('[data-testid=review-queue] [data-testid=empty-state]')
      assert.equal(state.enrolments.find((e) => e.status === 'in_progress' && e.course_id === cid(state, 'Data Privacy Essentials')) !== undefined, true)
      // team enrolments list with filters
      await page.waitForSelector('[data-testid=scoped-team] [data-testid=enrolment-row]')
      await page.check('[data-testid=team-overdue]')
      await page.waitForFunction(() => document.querySelectorAll('[data-testid=scoped-team] [data-testid=enrolment-row]').length === 1)
      await page.uncheck('[data-testid=team-overdue]')

      // assign from the Team tab
      await page.click('[data-testid=team-assign]')
      await page.waitForSelector('[data-testid=assign-panel]')
      await page.selectOption('[data-testid=assign-course]', { label: 'Introduction to Project Planning' })
      assert.equal(await page.locator('[data-testid=assign-mandatory]').isChecked(), false, 'follows the chosen course')
      await page.selectOption('[data-testid=assign-course]', { label: 'Data Privacy Essentials' })
      assert.equal(await page.locator('[data-testid=assign-mandatory]').isChecked(), true)
      await page.click('[data-testid=assign-submit]')
      assert.match(await text(page, '[data-testid=assign-panel]'), /Choose a person/)
      await page.click('[data-testid=assign-pick-EMP-0004]')
      await page.fill('[data-testid=assign-due]', '2026-12-01')
      await page.click('[data-testid=assign-submit]')
      await page.waitForSelector('[data-testid=team-flash]')
      assert.match(await text(page, '[data-testid=team-flash]'), /Assigned Data Privacy Essentials to Dan Ocampo/)
      const created = state.enrolments.at(-1)
      assert.equal(created.employee_id, 'EMP-0004')
      assert.equal(created.due_date, '2026-12-01')
      assert.equal(created.mandatory, true)
      // again: conflict with a link
      await page.click('[data-testid=team-assign]')
      await page.selectOption('[data-testid=assign-course]', { label: 'Data Privacy Essentials' })
      await page.click('[data-testid=assign-pick-EMP-0004]')
      await page.click('[data-testid=assign-submit]')
      await page.waitForSelector('[data-testid=assign-error]')
      assert.match(await text(page, '[data-testid=assign-error]'), /Open the existing enrolment/)
      await page.click('[data-testid=assign-close]')
      assert.equal(await page.locator('[data-testid=assign-panel]').count(), 0)
    },
    {
      signInAs: BEN,
      seed: (state) => {
        seedMine(state)
        const dp = state.enrolments.find((e) => e.course_id === cid(state, 'Data Privacy Essentials'))
        Object.assign(dp, { status: 'completed', progress: 100, confirmation_status: 'pending', completed_at: '2026-11-15T00:00:00.000Z', completion_note: 'Done.' })
      },
    },
  )
})

test('HR: compliance totals, per-course and department counts, the overdue list WITH names, filters; course admin create/edit/deactivate with server conflicts', opts, async () => {
  await withLearnMock(
    browser,
    async ({ page, mock, state }) => {
      await visit(page, mock, '/learning?tab=hr', '[data-testid=compliance-totals]')
      assert.equal(await page.locator('[data-testid^=tab-]').count(), 3)
      assert.match(await text(page, '[data-testid=totals-assigned]'), /^2$/)
      assert.match(await text(page, '[data-testid=totals-overdue]'), /^1$/)
      assert.match(await text(page, '[data-testid=totals-pct]'), /^0% complete/)
      assert.match(await text(page, '[data-testid=compliance-note]'), /does not count as complete/)
      const overdue = page.locator('[data-testid=overdue-row]')
      assert.equal(await overdue.count(), 1)
      assert.match(await overdue.locator('[data-testid=overdue-person]').innerText(), /Carla Dizon/, 'names are visible to HR')
      assert.match(await overdue.innerText(), /6 days overdue/)
      assert.match(await overdue.innerText(), /Workplace Health and Safety Basics/)
      const wh = page.locator('[data-testid=compliance-course-card]', { hasText: 'Workplace Health and Safety Basics' })
      assert.match(await wh.innerText(), /Compliance[\s\S]*0 of 1 complete/)
      await page.selectOption('[data-testid=compliance-course]', { label: 'Data Privacy Essentials' })
      await page.waitForFunction(() => document.querySelectorAll('[data-testid=compliance-course-card]').length === 1)
      await page.waitForSelector('[data-testid=no-overdue]')
      await page.selectOption('[data-testid=compliance-course]', '')
      await page.waitForSelector('[data-testid=overdue-row]')

      // all enrolments
      await page.click('[data-testid=hr-section-enrolments]')
      await page.waitForSelector('[data-testid=scoped-all] [data-testid=enrolment-row]')
      assert.equal(await page.locator('[data-testid=scoped-all] [data-testid=enrolment-row]').count(), 4)

      // course admin
      await page.click('[data-testid=hr-section-courses]')
      await page.waitForSelector('[data-testid=admin-course-row]')
      assert.equal(await page.locator('[data-testid=admin-course-row]').count(), 4)
      await page.click('[data-testid=admin-new-course]')
      await page.fill('[data-testid=course-title-input]', 'data privacy essentials')
      await page.fill('[data-testid=course-category-input]', 'Compliance')
      await page.fill('[data-testid=course-duration-input]', '1.255')
      await page.click('[data-testid=course-save]')
      assert.match(await text(page, '[data-testid=course-form-card]'), /at most 2 decimals/)
      await page.fill('[data-testid=course-duration-input]', '1.25')
      await page.click('[data-testid=course-save]')
      await page.waitForSelector('[data-testid=course-form-error]')
      assert.match(await text(page, '[data-testid=course-form-error]'), /already exists/)
      await page.fill('[data-testid=course-title-input]', 'Fire Drill Practice')
      await page.click('[data-testid=course-save]')
      await page.waitForFunction(() => /Course created: Fire Drill Practice/.test(document.querySelector('[data-testid=admin-flash]')?.textContent || ''))
      assert.equal(state.courses.at(-1).placeholder, false)
      // edit with a stale version
      const fd = page.locator('[data-testid=admin-course-row]', { hasText: 'Fire Drill Practice' })
      await fd.locator('[data-testid=admin-edit-course]').click()
      state.courses.at(-1).version += 3
      await page.fill('[data-testid=course-title-input]', 'Fire Drill Practice v2')
      await page.click('[data-testid=course-save]')
      await page.waitForSelector('[data-testid=course-form-error]')
      assert.match(await text(page, '[data-testid=course-form-error]'), /changed by someone else/)
      await page.click('[data-testid=course-cancel]')
      // deactivate / reactivate
      await page.locator('[data-testid=admin-course-row]', { hasText: 'Fire Drill Practice' }).locator('[data-testid=admin-toggle-course]').click()
      await page.waitForFunction(() => /is deactivated/.test(document.querySelector('[data-testid=admin-flash]')?.textContent || ''))
      assert.equal(state.courses.at(-1).active, false)
      await page.selectOption('[data-testid=admin-active-filter]', 'false')
      await page.waitForFunction(() => document.querySelectorAll('[data-testid=admin-course-row]').length === 1)
      assert.match(await text(page, '[data-testid=admin-course-state]'), /Inactive/)
    },
    {
      signInAs: ANNA,
      seed: (state) => {
        seedMine(state)
        state.enrolments.splice(2, 2) // keep two mandatory enrolments (overdue + due soon) and add two more rows below
        state.enrolments.push(makeEnrolment({ course_id: cid(state, 'Effective Communication Skills'), employee_id: 'EMP-0004', mandatory: false, status: 'enrolled', source: 'self', assigned_by: null }), makeEnrolment({ course_id: cid(state, 'Introduction to Project Planning'), employee_id: 'EMP-0004', mandatory: false, status: 'enrolled', source: 'self', assigned_by: null }))
      },
    },
  )
})

test('no Team/HR tabs for an employee, a forced tab falls back to the catalog, and a 403 from a forced HR call is stated plainly', opts, async () => {
  await withLearnMock(
    browser,
    async ({ page, mock }) => {
      await visit(page, mock, '/learning?tab=hr', LEARN)
      assert.equal(await page.locator('[data-testid^=tab-]').count(), 2)
      assert.equal(await page.getAttribute(LEARN, 'data-tab'), 'catalog')
      await page.goto(`${mock.origin}/learning?tab=team`)
      await page.waitForSelector(LEARN)
      assert.equal(await page.getAttribute(LEARN, 'data-tab'), 'catalog')
      assert.equal(await page.locator('[data-testid=course-assign]').count(), 0)
    },
    { signInAs: CARLA },
  )
  await withLearnMock(
    browser,
    async ({ page, mock, state }) => {
      state.failures.set('/learning/compliance', { status: 403, times: 1, body: { detail: 'You do not have access to this resource' } })
      await visit(page, mock, '/learning?tab=hr', '[data-testid=load-error]')
      assert.match(await text(page, '[data-testid=load-error]'), /only available to HR administrators/)
    },
    { signInAs: ANNA },
  )
})

test('deep links: an enrolment the caller cannot see (404) and a malformed id give an honest not-found; a 500 offers Try again', opts, async () => {
  await withLearnMock(
    browser,
    async ({ page, mock, state }) => {
      await visit(page, mock, '/learning/enrolments/00000000-0000-4000-8000-0000000000ff', '[data-testid=enrolment-detail-error]')
      assert.match(await text(page, '[data-testid=enrolment-detail-error] [data-testid=empty-state]'), /Enrolment not found/)
      state.failures.set('/learning/enrolments/', { status: 500, times: 1 })
      await visit(page, mock, `/learning/enrolments/${state.enrolments[0].enrolment_id}`, '[data-testid=load-error]')
      await page.click('[data-testid=load-error] button')
      await page.waitForSelector('[data-testid=enrolment-detail]')
    },
    { signInAs: CARLA, seed: seedMine },
  )
})

test('responsive: learning pages never scroll sideways with very long course titles and names', opts, async () => {
  const long = 'Supercalifragilisticexpialidocious-Course-Title-Without-Any-Spaces-To-Wrap-0123456789-0123456789'
  for (const width of [1440, 768, 390, 320]) {
    await withLearnMock(
      browser,
      async ({ page, mock, state }) => {
        for (const path of ['/learning', '/learning?tab=mine', `/learning/enrolments/${state.enrolments[0].enrolment_id}`]) {
          await page.goto(`${mock.origin}${path}`)
          await page.waitForSelector('[data-testid=course-card], [data-testid=enrolment-row], [data-testid=enrolment-detail]')
          assert.ok(await noOverflow(page), `${path} @${width}`)
        }
      },
      {
        signInAs: CARLA,
        viewport: { width, height: 900 },
        seed: (state) => {
          seedMine(state)
          state.courses[0].title = long
          state.courses[0].description = long.repeat(3)
          state.courses[0].category = long.slice(0, 55)
        },
      },
    )
  }
  await until(() => true)
})
