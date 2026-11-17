// HR Requests UI states against a self-contained MOCK API (documents-mock.mjs; the shell/auth mock is mock-api.mjs).
// Covers: landing links, my cases, the HR queue with filters and quick controls, new request validation and server
// rejections, the case thread with attachments, owner/HR controls driven only by the server's allowed actions,
// the owner-reply behaviour note, close with confirmation, stale 409s and the error/empty/not-found states.
// Gated: RUN_BROWSER_TESTS=1 (use `npm run test:browser`). Fictional mock data only.
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { ANNA, BEN, CARLA, enabled, launchBrowser, opts, text, withMockApp } from './mock-helpers.mjs'
import { createState, installModuleMock } from './documents-mock.mjs'

let browser
before(async () => {
  if (enabled) browser = await launchBrowser()
})
after(async () => {
  await browser?.close()
})

function app(email, fn, options = {}) {
  return withMockApp(
    browser,
    async (ctx) => {
      const state = options.state ?? createState()
      await installModuleMock(ctx.page, state)
      await fn({ ...ctx, state })
    },
    { signInAs: email, ...options },
  )
}
const go = async (page, mock, path, ready = '[data-testid=hr-requests-page]') => {
  await page.goto(`${mock.origin}${path}`)
  await page.waitForSelector(ready)
}
const waitCases = (page) => page.waitForSelector('[data-testid=case-rows], [data-testid=empty-state], [data-testid=cases-error]')
const subjects = (page) => page.$$eval('[data-testid=case-open]', (els) => els.map((e) => e.textContent.trim()))
const caseRow = (page, id) => page.locator(`[data-testid=case-row][data-case-id="${id}"]`)
const detail = async (page, mock, id) => go(page, mock, `/hr-requests/cases/${id}`, '[data-testid=thread], [data-testid=case-missing], [data-testid=case-error]')
const statusOf = (page) => page.locator('[data-testid=case-summary] [data-testid=status-pill]').getAttribute('data-kind')
const upload = (name, body = '%PDF-1.4 x', mimeType = 'application/pdf') => ({ name, mimeType, buffer: Buffer.from(body) })

// ------------------------------------------------------------------------------------------------ landing
test('landing: keeps the Reimbursements and directory links, shows My requests newest activity first with status and priority pills', opts, () =>
  app(CARLA, async ({ page, mock, errors }) => {
    await go(page, mock, '/hr-requests')
    await waitCases(page)
    assert.equal(await page.getAttribute('[data-testid=request-reimbursements]', 'href'), '/reimbursements')
    assert.equal(await page.getAttribute('[data-testid=browse-directory]', 'href'), '/directory')
    assert.equal(await page.getAttribute('[data-testid=new-request]', 'href'), '/hr-requests/new')
    assert.equal(await page.locator('[data-testid=tab-queue]').count(), 0)
    assert.match(await text(page, '[data-testid=privacy-note]'), /Managers - including your own manager - cannot/)
    assert.ok((await page.getAttribute('[data-nav-id=hr-requests]', 'class')).includes('active'))
    assert.deepEqual(await subjects(page), ['Replacement laptop charger', 'Certificate of employment for a visa application', 'Question about the office opening hours', 'Old question'], 'newest activity first')
    const laptop = caseRow(page, 'c-laptop')
    assert.equal(await laptop.locator('[data-testid=status-pill]').getAttribute('data-kind'), 'in_progress')
    assert.equal(await laptop.locator('[data-testid=priority-pill]').getAttribute('data-kind'), 'high')
    assert.match(await laptop.innerText(), /Equipment[\s\S]*Last reply from HR[\s\S]*handled by Anna Reyes/)
    assert.equal(await laptop.locator('[data-testid=case-controls]').count(), 0, 'no inline controls in My requests')
    assert.match(await text(page, '[data-testid=cases-total]'), /4 requests/)
    // another employee's request is never listed
    assert.ok(!(await subjects(page)).includes('Benefit statement line'))
    assert.deepEqual(errors, [])
  }))

test('landing: filters live in the URL, narrow the list, and clear', opts, () =>
  app(CARLA, async ({ page, mock }) => {
    await go(page, mock, '/hr-requests')
    await waitCases(page)
    await page.selectOption('[data-testid=filter-status]', 'active')
    await page.waitForFunction(() => [...document.querySelectorAll('[data-testid=case-row]')].every((r) => !['resolved', 'closed'].includes(r.dataset.status)))
    assert.equal(new URL(page.url()).searchParams.get('status'), 'active')
    assert.equal((await subjects(page)).length, 2)
    await page.selectOption('[data-testid=filter-type]', 'ct-equip')
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=case-row]').length === 1)
    assert.deepEqual(await subjects(page), ['Replacement laptop charger'])
    assert.equal(await page.locator('[data-testid=filter-priority]').count(), 0, 'priority and assignee filters are HR-queue only')
    await page.click('[data-testid=filters-clear]')
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=case-row]').length === 4)
    // junk in the URL is ignored
    await go(page, mock, '/hr-requests?status=bogus&page=-3&tab=queue')
    await waitCases(page)
    assert.equal(await page.getAttribute('[data-testid=hr-requests-page]', 'data-tab'), 'mine')
    assert.equal(await page.inputValue('[data-testid=filter-status]'), '')
    // a filter with no match says so
    await page.selectOption('[data-testid=filter-status]', 'open')
    await page.waitForSelector('[data-testid=empty-state]')
    assert.match(await text(page, '[data-testid=empty-state]'), /No requests match these filters/)
  }))

test('landing: loading skeleton, empty state, error with retry', opts, async () => {
  const state = createState()
  state.delay['GET /hrcases/cases'] = 700
  await app(CARLA, async ({ page, mock }) => {
    await page.goto(`${mock.origin}/hr-requests`)
    await page.waitForSelector('[data-testid=cases-loading]')
    await waitCases(page)
    state.delay = {}
    state.forced['GET /hrcases/cases'] = { status: 500, body: { detail: 'Server error' } }
    await go(page, mock, '/hr-requests')
    await page.waitForSelector('[data-testid=cases-error]')
    assert.match(await text(page, '[data-testid=cases-error]'), /Server error/)
    state.forced = {}
    await page.click('[data-testid=cases-error] button')
    await page.waitForSelector('[data-testid=case-rows]')
    state.cases.length = 0
    await go(page, mock, '/hr-requests')
    await page.waitForSelector('[data-testid=empty-state]')
    assert.match(await text(page, '[data-testid=empty-state]'), /No requests yet[\s\S]*New request/)
  }, { state })
})

test('landing: a manager sees the same personal view - no queue tab, no cases of others, a forced ?tab=queue falls back without calling the queue', opts, async () => {
  const state = createState()
  await app(BEN, async ({ page, mock }) => {
    await go(page, mock, '/hr-requests?tab=queue')
    await page.waitForSelector('[data-testid=empty-state]')
    assert.equal(await page.getAttribute('[data-testid=hr-requests-page]', 'data-tab'), 'mine')
    assert.equal(await page.locator('[data-testid=tab-queue]').count(), 0)
    assert.equal(state.log.filter((l) => /scope=queue/.test(l)).length, 0)
  }, { state })
})

// ------------------------------------------------------------------------------------------------ HR queue
test('HR queue: everyone\'s requests with names and assignee, filters (status, priority, assignee, type), quick assign / status / priority', opts, async () => {
  const state = createState()
  await app(ANNA, async ({ page, mock, errors }) => {
    await go(page, mock, '/hr-requests')
    await page.click('[data-testid=tab-queue]')
    await page.waitForSelector('[data-testid=queue-panel] [data-testid=case-row]')
    assert.equal(new URL(page.url()).searchParams.get('tab'), 'queue')
    const subs = await subjects(page)
    assert.ok(subs.includes('Benefit statement line') && subs.includes('Replacement laptop charger'))
    assert.match(await caseRow(page, 'c-dan').innerText(), /from Dan Ocampo \(Finance\)[\s\S]*Unassigned/)
    assert.match(await caseRow(page, 'c-laptop').innerText(), /from Carla Dizon[\s\S]*Assigned to you/)

    // controls come from the server per row: a closed request has none
    assert.equal(await caseRow(page, 'c-closed').locator('[data-testid=case-controls]').count(), 0)
    const statusOptions = (id) => caseRow(page, id).locator('[data-testid=status-select] option').evaluateAll((os) => os.map((o) => o.value).filter(Boolean))
    assert.deepEqual(await statusOptions('c-dan'), ['in_progress', 'waiting_on_employee', 'resolved'])
    assert.deepEqual(await statusOptions('c-done'), ['in_progress', 'closed'])

    // filters
    await page.selectOption('[data-testid=filter-priority]', 'high')
    await page.waitForFunction(() => [...document.querySelectorAll('[data-testid=case-row]')].every((r) => r.dataset.priority === 'high'))
    assert.deepEqual(await subjects(page), ['Replacement laptop charger'])
    await page.click('[data-testid=filters-clear]')
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=case-row]').length === 5)
    await page.selectOption('[data-testid=filter-assignee]', 'unassigned')
    await page.waitForFunction(() => [...document.querySelectorAll('[data-testid=case-row]')].every((r) => /Unassigned/.test(r.textContent)))
    assert.ok(!(await subjects(page)).includes('Replacement laptop charger'))
    await page.selectOption('[data-testid=filter-assignee]', 'me')
    await page.waitForFunction(() => [...document.querySelectorAll('[data-testid=case-row]')].every((r) => /Assigned to you/.test(r.textContent)))
    assert.equal((await subjects(page)).length, 2)
    await page.click('[data-testid=filters-clear]')
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=case-row]').length === 5)
    await page.selectOption('[data-testid=filter-type]', 'ct-pay')
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=case-row]').length === 1)
    await page.click('[data-testid=filters-clear]')
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=case-row]').length === 5)

    // quick controls act in place
    const dan = caseRow(page, 'c-dan')
    await dan.locator('[data-testid=assign-me]').click()
    await page.waitForFunction(() => /Assigned to you/.test(document.querySelector('[data-case-id=c-dan] [data-testid=assignee-text]')?.textContent || ''))
    assert.equal(state.cases.find((c) => c.case_id === 'c-dan').assignee.user_id, 'u-anna')
    await dan.locator('[data-testid=status-select]').selectOption('resolved')
    await dan.locator('[data-testid=status-apply]').click()
    await page.waitForFunction(() => document.querySelector('[data-case-id=c-dan]')?.dataset.status === 'resolved')
    await dan.locator('[data-testid=priority-select]').selectOption('high')
    await dan.locator('[data-testid=priority-apply]').click()
    await page.waitForFunction(() => document.querySelector('[data-case-id=c-dan]')?.dataset.priority === 'high')
    await dan.locator('[data-testid=unassign]').click()
    await page.waitForFunction(() => /Unassigned/.test(document.querySelector('[data-case-id=c-dan] [data-testid=assignee-text]')?.textContent || ''))
    assert.deepEqual(errors, [])
  }, { state })
})

test('HR queue: a stale change (409) explains itself and refreshes; a 403 on the queue is stated, not hidden', opts, async () => {
  const state = createState()
  await app(ANNA, async ({ page, mock }) => {
    await go(page, mock, '/hr-requests?tab=queue')
    await page.waitForSelector('[data-testid=case-row]')
    const dan = caseRow(page, 'c-dan')
    await dan.locator('[data-testid=status-select]').selectOption('resolved')
    state.cases.find((c) => c.case_id === 'c-dan').version += 1 // someone else changed it first
    await dan.locator('[data-testid=status-apply]').click()
    await dan.locator('[data-testid=controls-error]').waitFor()
    assert.match(await dan.locator('[data-testid=controls-error]').innerText(), /changed by someone else/)
    state.forced['GET /hrcases/cases'] = { status: 403, body: { detail: 'You do not have access to this resource' } }
    await go(page, mock, '/hr-requests?tab=queue')
    await page.waitForSelector('[data-testid=cases-error]')
    assert.match(await text(page, '[data-testid=cases-error]'), /HR queue is for HR only/)
  }, { state })
})

// ------------------------------------------------------------------------------------------------ new request
test('new request: types from the catalog, the type explains itself, priority follows the type, validation sends nothing, the server can refuse', opts, async () => {
  const state = createState()
  await app(CARLA, async ({ page, mock, errors }) => {
    await go(page, mock, '/hr-requests/new', '[data-testid=new-case-form]')
    const names = (await page.$$eval('[data-testid=case-type-select] option', (os) => os.map((o) => o.textContent.trim()))).slice(1)
    assert.deepEqual(names, ['Certificate of employment', 'Equipment', 'Payslip / benefit question', 'General inquiry'])
    assert.match(await text(page, '[data-testid=privacy-note]'), /only you and HR/i)
    const posts = () => state.log.filter((l) => l === 'POST /hrcases/cases').length

    await page.click('[data-testid=case-submit]')
    for (const s of ['Choose a request type.', 'Enter a subject.', 'Describe your request.']) await page.waitForSelector(`text=${s}`)
    assert.equal(posts(), 0)

    await page.selectOption('[data-testid=case-type-select]', 'ct-pay')
    assert.match(await text(page, '[data-testid=case-type-help]'), /Inquiry only - no pay data in this system/)
    assert.doesNotMatch(await text(page, '[data-testid=case-type-help]'), /Placeholder/)
    assert.equal(await page.inputValue('[data-testid=case-priority-select]'), 'medium')
    await page.selectOption('[data-testid=case-type-select]', 'ct-coe')
    assert.equal(await page.inputValue('[data-testid=case-priority-select]'), 'low', 'the suggestion follows the type until the person chooses')
    await page.selectOption('[data-testid=case-priority-select]', 'high')
    await page.selectOption('[data-testid=case-type-select]', 'ct-gen')
    assert.equal(await page.inputValue('[data-testid=case-priority-select]'), 'high', 'a chosen priority is kept')

    await page.fill('[data-testid=case-subject]', 'Need a certificate')
    assert.equal(await text(page, '#hc-subject ~ .hc-counter'), '18/120')
    await page.fill('[data-testid=case-description]', 'For my bank, fictional.')
    await page.setInputFiles('[data-testid=case-file]', upload('run.exe', 'MZ', 'application/x-msdownload'))
    assert.match(await text(page, '[data-testid=case-file-hint]'), /not one of the accepted types/)
    state.forced.nextUpload = { status: 415, detail: 'Unsupported file. Upload a PDF, PNG, JPEG, DOCX or XLSX file.' }
    await page.click('[data-testid=case-submit]')
    await page.waitForSelector('[data-testid=case-error]')
    assert.match(await text(page, '[data-testid=case-error]'), /Nothing was stored/)
    assert.equal(new URL(page.url()).pathname, '/hr-requests/new')
    assert.equal(await page.inputValue('[data-testid=case-subject]'), 'Need a certificate', 'the form keeps what was typed')

    await page.setInputFiles('[data-testid=case-file]', upload('proof.pdf'))
    await page.click('[data-testid=case-submit]')
    await page.waitForURL(/\/hr-requests\/cases\/c-\d+$/)
    await page.waitForSelector('[data-testid=thread]')
    assert.equal(await statusOf(page), 'open')
    assert.equal(await page.locator('[data-testid=priority-pill]').first().getAttribute('data-kind'), 'high')
    assert.match(await text(page, '[data-testid=message]'), /Original request[\s\S]*For my bank, fictional\.[\s\S]*proof\.pdf/)
    assert.deepEqual(errors, [])
  }, { state })
})

test('new request: no types available and a failing types call are explained', opts, async () => {
  const state = createState()
  state.caseTypes.forEach((t) => (t.active = false))
  await app(CARLA, async ({ page, mock }) => {
    await go(page, mock, '/hr-requests/new', '[data-testid=new-case-page]')
    await page.waitForSelector('text=No request types are available right now')
    state.forced['GET /hrcases/types'] = { status: 500, body: { detail: 'Server error' } }
    await go(page, mock, '/hr-requests/new', '[data-testid=new-case-page]')
    await page.waitForSelector('[data-testid=types-error]')
    state.forced = {}
    state.caseTypes.forEach((t) => (t.active = true))
    await page.click('[data-testid=types-error] button')
    await page.waitForSelector('[data-testid=new-case-form]')
  }, { state })
})

// ------------------------------------------------------------------------------------------------ case detail
test('case detail (employee): the thread with the original request and attachments, the owner-reply note, no HR controls', opts, async () => {
  const state = createState()
  await app(CARLA, async ({ page, mock, errors }) => {
    const authed = []
    page.on('request', (r) => /\/attachment$/.test(r.url()) && authed.push(r.headers().authorization))
    await detail(page, mock, 'c-laptop')
    assert.equal(await statusOf(page), 'in_progress')
    const msgs = page.locator('[data-testid=message]')
    assert.equal(await msgs.count(), 2)
    assert.match(await msgs.nth(0).innerText(), /You[\s\S]*Employee[\s\S]*Original request[\s\S]*charger stopped working[\s\S]*charger-photo\.png/)
    assert.equal(await msgs.nth(0).getAttribute('data-role'), 'employee')
    assert.match(await msgs.nth(1).innerText(), /Anna Reyes[\s\S]*HR[\s\S]*ordered one/)
    assert.equal(await msgs.nth(1).getAttribute('data-role'), 'hr')
    assert.match(await text(page, '[data-testid=case-assignee]'), /Anna Reyes/)
    await msgs.nth(0).locator('[data-testid=attachment-download]').click()
    await page.waitForTimeout(300)
    assert.ok(state.log.some((l) => l === 'GET /hrcases/cases/c-laptop/messages/m1/attachment'))
    assert.ok(authed.every((a) => a === 'Bearer acc-u-carla'), 'attachments are fetched with the Bearer header')
    for (const sel of ['[data-testid=case-controls]', '[data-testid=reply-status]', '[data-testid=assign-me]', '[data-testid=priority-select]']) assert.equal(await page.locator(sel).count(), 0, sel)
    assert.equal(await page.locator('[data-testid=reply-note]').count(), 0, 'no note on an in-progress case')

    await detail(page, mock, 'c-coe')
    assert.equal(await statusOf(page), 'waiting_on_employee')
    assert.match(await text(page, '[data-testid=reply-note]'), /Replying moves this request back to In progress/)
    assert.equal(await page.locator('[data-testid=case-employee]').count(), 1, 'the summary names who raised it')
    assert.deepEqual(errors, [])
  }, { state })
})

test('case detail (employee): reply validates, sends text + attachment, the status moves back to In progress, the box clears', opts, async () => {
  const state = createState()
  await app(CARLA, async ({ page, mock }) => {
    await detail(page, mock, 'c-coe')
    await page.click('[data-testid=reply-submit]')
    await page.waitForSelector('text=Write a reply first.')
    assert.equal(state.log.filter((l) => /\/messages$/.test(l)).length, 0)
    await page.fill('[data-testid=reply-text]', 'It is for Japan, needed by December.')
    assert.equal(await text(page, '#hc-reply ~ .hc-counter'), '36/2000')
    await page.setInputFiles('[data-testid=reply-file]', upload('visa-form.pdf'))
    await page.click('[data-testid=reply-submit]')
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=message]').length === 3)
    assert.equal(await statusOf(page), 'in_progress')
    assert.equal(await page.inputValue('[data-testid=reply-text]'), '')
    assert.match(await page.locator('[data-testid=message]').nth(2).innerText(), /You[\s\S]*Japan[\s\S]*visa-form\.pdf/)
    assert.equal(await page.locator('[data-testid=reply-note]').count(), 0)
    assert.equal(await page.locator('[data-testid=reply-file-name]').innerText(), 'No file chosen', 'the file chooser is reset too')
  }, { state })
})

test('case detail (employee): a resolved request can be closed after a confirmation, and a closed one is final', opts, async () => {
  const state = createState()
  await app(CARLA, async ({ page, mock }) => {
    await detail(page, mock, 'c-done')
    assert.equal(await statusOf(page), 'resolved')
    assert.match(await text(page, '[data-testid=reply-note]'), /reopen this request/)
    assert.equal(await page.locator('[data-testid=status-select]').count(), 0, 'the owner has no status picker')
    await page.click('[data-testid=close-case]')
    assert.match(await text(page, '[data-testid=close-confirm-box]'), /closed request is final/)
    await page.click('text=Keep it open')
    assert.equal(await page.locator('[data-testid=close-confirm-box]').count(), 0)
    assert.equal(state.log.filter((l) => /\/status$/.test(l)).length, 0, 'nothing is sent before the confirmation')
    await page.click('[data-testid=close-case]')
    await page.click('[data-testid=close-confirm]')
    await page.waitForSelector('[data-testid=closed-note]')
    assert.equal(await statusOf(page), 'closed')
    assert.equal(await page.locator('[data-testid=reply-form]').count(), 0)
    assert.equal(await page.locator('[data-testid=case-controls]').count(), 0)
    assert.match(await text(page, '[data-testid=case-summary]'), /Closed/)

    await detail(page, mock, 'c-closed')
    assert.equal(await page.locator('[data-testid=reply-form]').count(), 0)
    assert.equal(await page.locator('[data-testid=closed-note]').count(), 1)
  }, { state })
})

test('case detail (HR): status choices are exactly the allowed ones, reply + status in one step, priority and assignment; the thread keeps speaking roles', opts, async () => {
  const state = createState()
  await app(ANNA, async ({ page, mock, errors }) => {
    await detail(page, mock, 'c-dan')
    assert.equal(await statusOf(page), 'open')
    assert.match(await text(page, '[data-testid=case-employee]'), /Dan Ocampo \(Finance\)/)
    assert.match(await text(page, '[data-testid=reply-note]'), /does not change the status unless you choose one/)
    assert.deepEqual(await page.$$eval('[data-testid=status-select] option', (os) => os.map((o) => o.value).filter(Boolean)), ['in_progress', 'waiting_on_employee', 'resolved'])
    assert.deepEqual(await page.$$eval('[data-testid=reply-status] option', (os) => os.map((o) => o.value).filter(Boolean)), ['in_progress', 'waiting_on_employee', 'resolved'])

    await page.fill('[data-testid=reply-text]', 'Which line, Dan?')
    await page.selectOption('[data-testid=reply-status]', 'waiting_on_employee')
    await page.click('[data-testid=reply-submit]')
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=message]').length === 2)
    assert.equal(await statusOf(page), 'waiting_on_employee')
    assert.equal(await page.locator('[data-testid=message]').nth(1).getAttribute('data-role'), 'hr')
    assert.match(await page.locator('[data-testid=message]').nth(1).innerText(), /You[\s\S]*HR/)
    // the status picker now offers the transitions from waiting_on_employee
    assert.deepEqual(await page.$$eval('[data-testid=status-select] option', (os) => os.map((o) => o.value).filter(Boolean)), ['in_progress', 'resolved'])

    await page.selectOption('[data-testid=priority-select]', 'high')
    await page.click('[data-testid=priority-apply]')
    await page.waitForFunction(() => document.querySelector('[data-testid=case-summary] [data-testid=priority-pill]')?.getAttribute('data-kind') === 'high')
    await page.click('[data-testid=assign-me]')
    await page.waitForFunction(() => /Assigned to you/.test(document.querySelector('[data-testid=case-assignee]')?.textContent || ''))
    await page.selectOption('[data-testid=status-select]', 'resolved')
    await page.click('[data-testid=status-apply]')
    await page.waitForFunction(() => document.querySelector('[data-testid=case-summary] [data-testid=status-pill]')?.getAttribute('data-kind') === 'resolved')
    assert.match(await text(page, '[data-testid=case-summary]'), /Resolved/)
    assert.deepEqual(await page.$$eval('[data-testid=status-select] option', (os) => os.map((o) => o.value).filter(Boolean)), ['in_progress', 'closed'])
    assert.deepEqual(errors, [])
  }, { state })
})

test('case detail: a reply refused with 409 keeps the text and says it was not sent; "not found" and server errors are different states', opts, async () => {
  const state = createState()
  await app(CARLA, async ({ page, mock }) => {
    await detail(page, mock, 'c-laptop')
    await page.fill('[data-testid=reply-text]', 'Please also a cable.')
    state.cases.find((c) => c.case_id === 'c-laptop').status = 'closed' // closed meanwhile
    await page.click('[data-testid=reply-submit]')
    await page.waitForSelector('[data-testid=case-notice]')
    assert.match(await text(page, '[data-testid=case-notice]'), /changed[\s\S]*your reply was not sent/)
    await page.waitForSelector('[data-testid=closed-note]')

    await detail(page, mock, 'c-dan') // someone else's case: the same page as an unknown id
    assert.match(await text(page, '[data-testid=case-missing]'), /Request not found[\s\S]*Only the person who raised a request and HR/)
    await detail(page, mock, 'c-nope')
    assert.match(await text(page, '[data-testid=case-missing]'), /Request not found/)
    state.forced['GET /hrcases/cases/c-laptop'] = { status: 500, body: { detail: 'Server error' } }
    await detail(page, mock, 'c-laptop')
    await page.waitForSelector('[data-testid=case-error]')
    assert.equal(await page.locator('[data-testid=case-missing]').count(), 0)
    state.forced = {}
    await page.click('[data-testid=case-error] button')
    await page.waitForSelector('[data-testid=thread]')
  }, { state })
})
