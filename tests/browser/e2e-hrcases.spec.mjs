// REAL-BACKEND end-to-end suite for HR Requests / cases (docs/api/hrcases.md).
// Starts the real backend (in-memory DB, demo auth, random port 8101-8199) plus the proxy that serves frontend/dist and
// drives system Chrome as the fictional demo people: Jamie and Lia (employees), Miguel (Jamie's manager), Anna (HR).
// Gated: RUN_BROWSER_TESTS=1. Never contacts anything outside 127.0.0.1. Fictional, in-memory files only.
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { launchBrowser } from './browser-env.mjs'
import { PEOPLE, startRealStack } from './real-backend.mjs'
import { actor, apiLogin, pageApi, text } from './e2e-helpers.mjs'
import { MIME, notAllowed, pdf, upload } from './documents-fixtures.mjs'
import { jsonCall, multipart, readDownload } from './documents-helpers.mjs'

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

const landing = async (page, query = '') => {
  await page.goto(`${origin}/hr-requests${query}`)
  await page.waitForSelector('[data-testid=hr-requests-page]')
}
const detail = async (page, id) => {
  await page.goto(`${origin}/hr-requests/cases/${id}`)
  await page.waitForSelector('[data-testid=case-detail] [data-testid=thread], [data-testid=case-missing], [data-testid=case-error]')
}
async function waitCases(page) {
  await page.waitForFunction(() => document.querySelector('[data-testid=case-rows], [data-testid=empty-state], [data-testid=cases-error]'))
}
async function optionValue(page, selector, startsWith) {
  const v = await page.$$eval(`${selector} option`, (os, s) => os.find((o) => o.textContent.trim().startsWith(s))?.value ?? null, startsWith)
  assert.ok(v, `no <option> starting with "${startsWith}" in ${selector}`)
  return v
}
async function clickDownload(page, locator) {
  const [dl] = await Promise.all([page.waitForEvent('download'), locator.click()])
  return readDownload(dl)
}
const statusOf = (page) => page.locator('[data-testid=case-summary] [data-testid=status-pill]').getAttribute('data-kind')
const kinds = async (email) => {
  const token = await apiLogin(origin, email)
  return (await jsonCall(origin, token, 'GET', '/notifications?limit=50')).json.items.filter((n) => n.kind.startsWith('case.'))
}

/** Creates a case through the API as `email` (multipart, like the browser). Returns the case detail JSON. */
async function apiCase(email, { type = 'General inquiry', subject, description = 'Details (fictional).', priority, file }) {
  const token = await apiLogin(origin, email)
  const types = (await jsonCall(origin, token, 'GET', '/hrcases/types')).json.items
  const type_id = types.find((t) => t.name === type).type_id
  const res = await multipart(origin, token, 'POST', '/hrcases/cases', { type_id, subject, description, priority, file })
  assert.equal(res.status, 201, JSON.stringify(res.json))
  return res.json
}

const S = {}

// ------------------------------------------------------------------------------------------------ landing + new request
test('E2E cases: the landing keeps the Reimbursements and directory links, and an employee starts with an empty "My requests" and no HR queue', opts, async () => {
  const jamie = await as(PEOPLE.jamie)
  await landing(jamie.page)
  assert.equal(await jamie.page.getAttribute('[data-testid=request-reimbursements]', 'href'), '/reimbursements')
  assert.equal(await jamie.page.getAttribute('[data-testid=browse-directory]', 'href'), '/directory')
  assert.equal(await jamie.page.locator('[data-testid=tab-queue]').count(), 0)
  await jamie.page.waitForSelector('[data-testid=empty-state]')
  assert.match(await text(jamie.page, '[data-testid=empty-state]'), /No requests yet/)
  assert.match(await text(jamie.page, '[data-testid=privacy-note]'), /Managers - including your own manager - cannot/)
  assert.ok((await jamie.page.getAttribute('[data-nav-id=hr-requests]', 'class')).includes('active'))
  await jamie.page.click('[data-testid=request-reimbursements]')
  await jamie.page.waitForURL('**/reimbursements')
  await done(jamie)
})

test('E2E cases: Jamie opens a request with an attachment; validation runs first; a rejected attachment creates nothing', opts, async () => {
  const jamie = await as(PEOPLE.jamie)
  const posts = []
  jamie.page.on('request', (r) => r.method() === 'POST' && /hrcases\/cases$/.test(r.url()) && posts.push(r.url()))
  await landing(jamie.page)
  await jamie.page.click('[data-testid=new-request]')
  await jamie.page.waitForURL('**/hr-requests/new')
  await jamie.page.waitForSelector('[data-testid=new-case-form]')

  // the type catalog comes from HR; the inquiry-only type says so
  const options = await jamie.page.$$eval('[data-testid=case-type-select] option', (os) => os.map((o) => o.textContent.trim()))
  for (const name of ['Certificate of employment', 'Profile change', 'Equipment', 'Payslip / benefit question', 'General inquiry']) assert.ok(options.includes(name), name)
  await jamie.page.selectOption('[data-testid=case-type-select]', await optionValue(jamie.page, '[data-testid=case-type-select]', 'Payslip'))
  assert.match(await text(jamie.page, '[data-testid=case-type-help]'), /inquiry only/i)
  assert.doesNotMatch(await text(jamie.page, '[data-testid=case-type-help]'), /Placeholder/)
  assert.equal(await jamie.page.inputValue('[data-testid=case-priority-select]'), 'medium', "the type's default priority is suggested")

  // empty submit: inline errors, nothing sent
  await jamie.page.click('[data-testid=case-submit]')
  await jamie.page.waitForSelector('text=Enter a subject.')
  await jamie.page.waitForSelector('text=Describe your request.')
  assert.equal(posts.length, 0)

  // a rejected attachment: the whole request is refused and nothing is created
  await jamie.page.fill('[data-testid=case-subject]', 'Question about my benefits statement')
  await jamie.page.fill('[data-testid=case-description]', 'I would like to understand a line on my benefits summary. Fictional text.')
  await jamie.page.setInputFiles('[data-testid=case-file]', upload('statement.exe', notAllowed(), 'application/x-msdownload'))
  assert.match(await text(jamie.page, '[data-testid=case-file-hint]'), /not one of the accepted types/)
  await jamie.page.click('[data-testid=case-submit]')
  await jamie.page.waitForSelector('[data-testid=case-error]')
  assert.match(await text(jamie.page, '[data-testid=case-error]'), /Unsupported file[\s\S]*Nothing was stored/)
  assert.equal(new URL(jamie.page.url()).pathname, '/hr-requests/new', 'stays on the form')
  const jt = await apiLogin(origin, PEOPLE.jamie)
  assert.equal((await jsonCall(origin, jt, 'GET', '/hrcases/cases')).json.total, 0)

  // a good attachment
  S.attachment = pdf('benefit-statement')
  await jamie.page.setInputFiles('[data-testid=case-file]', upload('statement.pdf', S.attachment, MIME.pdf))
  await jamie.page.click('[data-testid=case-submit]')
  await jamie.page.waitForURL(/\/hr-requests\/cases\/[0-9a-f-]{36}$/)
  S.caseId = jamie.page.url().split('/').pop()
  await jamie.page.waitForSelector('[data-testid=thread]')
  assert.equal(await statusOf(jamie.page), 'open')
  assert.match(await text(jamie.page, '[data-testid=case-summary]'), /Unassigned/)
  const first = jamie.page.locator('[data-testid=message]').first()
  assert.equal(await first.getAttribute('data-description'), 'yes')
  assert.match(await first.innerText(), /Original request[\s\S]*benefits summary/)
  assert.ok((await clickDownload(jamie.page, first.locator('[data-testid=attachment-download]'))).equals(S.attachment), 'the attachment downloads byte for byte')
  assert.equal(await jamie.page.locator('[data-testid=case-controls]').count(), 0, 'an owner of an open request has no status/priority/assignment controls')
  assert.equal(await jamie.page.locator('[data-testid=reply-form]').count(), 1)

  // it shows in My requests
  await landing(jamie.page)
  await jamie.page.waitForSelector('[data-testid=case-row]')
  assert.match(await text(jamie.page, '[data-testid=case-row]'), /Question about my benefits statement/)
  await done(jamie)
})

test('E2E cases: HR is notified of the new request, nobody else is (not the manager, not another employee, not the sender)', opts, async () => {
  const anna = (await kinds(PEOPLE.anna)).filter((n) => n.kind === 'case.created')
  assert.equal(anna.length, 1)
  assert.equal(anna[0].link, `/hr-requests/cases/${S.caseId}`)
  assert.match(anna[0].body, /Payslip \/ benefit question from Jamie Dela Cruz/)
  assert.doesNotMatch(JSON.stringify(anna[0]), /benefits statement|benefits summary/, 'a notification never carries the subject or description')
  assert.deepEqual(await kinds(PEOPLE.miguel), [])
  assert.deepEqual(await kinds(PEOPLE.lia), [])
  assert.deepEqual(await kinds(PEOPLE.paolo), [])
  assert.deepEqual(await kinds(PEOPLE.jamie), [])
})

// ------------------------------------------------------------------------------------------------ HR works the case
test('E2E cases: Anna sees it in the HR queue, assigns it to herself, replies and asks the employee for more (waiting on employee)', opts, async () => {
  const anna = await as(PEOPLE.anna)
  await landing(anna.page, '?tab=queue')
  await anna.page.waitForSelector('[data-testid=queue-panel] [data-testid=case-row]')
  const row = anna.page.locator(`[data-testid=case-row][data-case-id="${S.caseId}"]`)
  assert.match(await row.innerText(), /from Jamie Dela Cruz[\s\S]*Unassigned/)
  await row.locator('[data-testid=assign-me]').click()
  await anna.page.waitForFunction((id) => /Assigned to you/.test(document.querySelector(`[data-case-id="${id}"] [data-testid=assignee-text]`)?.textContent || ''), S.caseId)
  assert.equal(await row.locator('[data-testid=assign-me]').count(), 0)
  assert.equal(await row.locator('[data-testid=unassign]').count(), 1)

  await row.locator('[data-testid=case-open]').click()
  await anna.page.waitForURL(`**/hr-requests/cases/${S.caseId}`)
  await anna.page.waitForSelector('[data-testid=thread]')
  assert.match(await text(anna.page, '[data-testid=case-employee]'), /Jamie Dela Cruz/)
  assert.match(await text(anna.page, '[data-testid=reply-note]'), /does not change the status unless you choose one/)
  // only the statuses the server allows from "open" are offered
  const allowed = await anna.page.$$eval('[data-testid=reply-status] option', (os) => os.map((o) => o.value).filter(Boolean))
  assert.deepEqual(allowed.sort(), ['in_progress', 'resolved', 'waiting_on_employee'])

  await anna.page.fill('[data-testid=reply-text]', 'Thanks Jamie - which month is the line from?')
  await anna.page.selectOption('[data-testid=reply-status]', 'waiting_on_employee')
  const resp = anna.page.waitForResponse((r) => r.request().method() === 'POST' && /\/messages$/.test(new URL(r.url()).pathname))
  await anna.page.click('[data-testid=reply-submit]')
  assert.equal((await resp).status(), 201)
  await anna.page.waitForFunction(() => document.querySelectorAll('[data-testid=message]').length === 2)
  assert.equal(await statusOf(anna.page), 'waiting_on_employee')
  assert.equal(await anna.page.locator('[data-testid=message]').nth(1).getAttribute('data-role'), 'hr')
  assert.equal(await anna.page.inputValue('[data-testid=reply-text]'), '', 'the box is cleared after sending')

  // Jamie hears about it (reply + status change), and nobody else does
  const jk = (await kinds(PEOPLE.jamie)).map((n) => n.kind).sort()
  assert.deepEqual(jk, ['case.replied', 'case.status_changed'])
  assert.deepEqual(await kinds(PEOPLE.miguel), [])
  await done(anna)
})

test('E2E cases: Jamie follows the notification link, sees the status and the auto-move note, replies and the case goes back to In progress', opts, async () => {
  const jt = await apiLogin(origin, PEOPLE.jamie)
  const reply = (await jsonCall(origin, jt, 'GET', '/notifications?limit=50')).json.items.find((n) => n.kind === 'case.replied')
  assert.equal(reply.link, `/hr-requests/cases/${S.caseId}`)
  const jamie = await as(PEOPLE.jamie)
  await jamie.page.goto(`${origin}${reply.link}`)
  await jamie.page.waitForSelector('[data-testid=thread]')
  assert.equal(await statusOf(jamie.page), 'waiting_on_employee')
  assert.match(await text(jamie.page, '[data-testid=case-assignee]'), /Anna Reyes/)
  assert.match(await text(jamie.page, '[data-testid=reply-note]'), /Replying moves this request back to In progress/)
  assert.equal(await jamie.page.locator('[data-testid=reply-status]').count(), 0, 'the owner cannot choose a status')
  assert.equal(await jamie.page.locator('[data-testid=status-select]').count(), 0)

  await jamie.page.fill('[data-testid=reply-text]', 'It is the September statement.')
  await jamie.page.setInputFiles('[data-testid=reply-file]', upload('line.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'), MIME.png))
  await jamie.page.click('[data-testid=reply-submit]')
  await jamie.page.waitForFunction(() => document.querySelectorAll('[data-testid=message]').length === 3)
  assert.equal(await statusOf(jamie.page), 'in_progress', 'an owner reply on a waiting case moves it back to In progress')
  assert.equal(await jamie.page.locator('[data-testid=message]').nth(2).locator('[data-testid=attachment-download]').count(), 1)
  assert.match(await jamie.page.locator('[data-testid=message]').nth(2).innerText(), /You/)

  // Anna (the assignee) is told; the manager is not
  const ak = (await kinds(PEOPLE.anna)).filter((n) => n.kind === 'case.replied')
  assert.equal(ak.length, 1)
  assert.match(ak[0].body, /Jamie Dela Cruz replied/)
  assert.deepEqual(await kinds(PEOPLE.miguel), [])
  await done(jamie)
})

test('E2E cases: Anna changes priority, resolves it; Jamie sees Resolved, may reopen by replying or close it; a closed case is final', opts, async () => {
  const anna = await as(PEOPLE.anna)
  await detail(anna.page, S.caseId)
  await anna.page.selectOption('[data-testid=priority-select]', 'high')
  await anna.page.click('[data-testid=priority-apply]')
  await anna.page.waitForFunction(() => document.querySelector('[data-testid=case-summary] [data-testid=priority-pill]')?.getAttribute('data-kind') === 'high')
  await anna.page.selectOption('[data-testid=status-select]', 'resolved')
  await anna.page.click('[data-testid=status-apply]')
  await anna.page.waitForFunction(() => document.querySelector('[data-testid=case-summary] [data-testid=status-pill]')?.getAttribute('data-kind') === 'resolved')
  const statusOptions = await anna.page.$$eval('[data-testid=status-select] option', (os) => os.map((o) => o.value).filter(Boolean))
  assert.deepEqual(statusOptions.sort(), ['closed', 'in_progress'], 'from resolved HR may reopen or close')

  const jamie = await as(PEOPLE.jamie)
  await detail(jamie.page, S.caseId)
  assert.equal(await statusOf(jamie.page), 'resolved')
  assert.match(await text(jamie.page, '[data-testid=reply-note]'), /reopen this request/)
  assert.equal(await jamie.page.locator('[data-testid=priority-select]').count(), 0, 'the owner cannot change the priority')
  assert.equal(await jamie.page.locator('[data-testid=assign-me]').count(), 0)
  // close: confirm first, then final
  await jamie.page.click('[data-testid=close-case]')
  assert.match(await text(jamie.page, '[data-testid=close-confirm-box]'), /closed request is final/)
  await jamie.page.click('[data-testid=close-confirm]')
  await jamie.page.waitForSelector('[data-testid=closed-note]')
  assert.equal(await statusOf(jamie.page), 'closed')
  assert.equal(await jamie.page.locator('[data-testid=reply-form]').count(), 0)
  assert.equal(await jamie.page.locator('[data-testid=case-controls]').count(), 0)

  // Anna sees it closed too: no reply form, no controls; the API refuses a late reply
  await detail(anna.page, S.caseId)
  assert.equal(await statusOf(anna.page), 'closed')
  assert.equal(await anna.page.locator('[data-testid=reply-form]').count(), 0)
  const at = await apiLogin(origin, PEOPLE.anna)
  const late = await multipart(origin, at, 'POST', `/hrcases/cases/${S.caseId}/messages`, { text: 'too late' })
  assert.equal(late.status, 409)
  await done(anna, jamie)
})

test('E2E cases: an employee reply on a resolved case reopens it (and HR is told); HR "Unassign" works', opts, async () => {
  const c = await apiCase(PEOPLE.jamie, { type: 'Equipment', subject: 'Second monitor', description: 'Please a second monitor (fictional).' })
  const at = await apiLogin(origin, PEOPLE.anna)
  assert.equal((await jsonCall(origin, at, 'POST', `/hrcases/cases/${c.case_id}/status`, { status: 'resolved' })).status, 200)
  const jamie = await as(PEOPLE.jamie)
  await detail(jamie.page, c.case_id)
  await jamie.page.fill('[data-testid=reply-text]', 'Actually it is still broken.')
  await jamie.page.click('[data-testid=reply-submit]')
  await jamie.page.waitForFunction(() => document.querySelectorAll('[data-testid=message]').length === 2)
  assert.equal(await statusOf(jamie.page), 'in_progress')

  const anna = await as(PEOPLE.anna)
  await detail(anna.page, c.case_id)
  await anna.page.click('[data-testid=assign-me]')
  await anna.page.waitForSelector('[data-testid=unassign]')
  await anna.page.click('[data-testid=unassign]')
  await anna.page.waitForFunction(() => /Unassigned/.test(document.querySelector('[data-testid=assignee-text]')?.textContent || ''))
  await done(jamie, anna)
})

// ------------------------------------------------------------------------------------------------ privacy
test('E2E cases: Miguel (Jamie\'s manager) sees no cases - no queue tab, an empty list, "not found" on a direct link, 403 on the queue API', opts, async () => {
  const miguel = await as(PEOPLE.miguel)
  await landing(miguel.page)
  await miguel.page.waitForSelector('[data-testid=empty-state]')
  assert.equal(await miguel.page.locator('[data-testid=tab-queue]').count(), 0)
  await landing(miguel.page, '?tab=queue')
  assert.equal(await miguel.page.getAttribute('[data-testid=hr-requests-page]', 'data-tab'), 'mine', 'a forced ?tab=queue falls back to My requests')
  await detail(miguel.page, S.caseId)
  assert.match(await text(miguel.page, '[data-testid=case-missing]'), /Request not found/)
  assert.equal(await miguel.page.locator('[data-testid=message]').count(), 0, 'no part of the conversation is rendered')
  assert.equal((await pageApi(miguel.page, origin, 'GET', '/hrcases/cases?scope=queue')).status, 403)
  assert.equal((await pageApi(miguel.page, origin, 'GET', `/hrcases/cases/${S.caseId}`)).status, 404)
  assert.equal((await pageApi(miguel.page, origin, 'GET', '/hrcases/cases')).json.total, 0)
  await done(miguel)
})

test("E2E cases: Lia cannot open Jamie's case: the UI and API answer exactly as for an unknown id, and she cannot reply or download", opts, async () => {
  const lia = await as(PEOPLE.lia)
  await detail(lia.page, S.caseId)
  assert.match(await text(lia.page, '[data-testid=case-missing]'), /Request not found/)
  const real = await pageApi(lia.page, origin, 'GET', `/hrcases/cases/${S.caseId}`)
  const unknown = await pageApi(lia.page, origin, 'GET', '/hrcases/cases/00000000-0000-4000-8000-000000000000')
  assert.equal(real.status, 404)
  assert.deepEqual(real.json, unknown.json)
  const lt = await apiLogin(origin, PEOPLE.lia)
  assert.equal((await multipart(origin, lt, 'POST', `/hrcases/cases/${S.caseId}/messages`, { text: 'hello' })).status, 404)
  assert.equal((await jsonCall(origin, lt, 'POST', `/hrcases/cases/${S.caseId}/status`, { status: 'closed' })).status, 404)
  assert.equal((await pageApi(lia.page, origin, 'GET', '/hrcases/cases?scope=queue')).status, 403)
  await done(lia)
})

// ------------------------------------------------------------------------------------------------ HR queue
test('E2E cases: the HR queue filters by status, priority, assignee and type; quick controls change status and priority in place', opts, async () => {
  const a = await apiCase(PEOPLE.jamie, { type: 'Equipment', subject: 'Queue A laptop', priority: 'high' })
  const b = await apiCase(PEOPLE.lia, { type: 'Certificate of employment', subject: 'Queue B certificate', priority: 'low' })
  const c = await apiCase(PEOPLE.lia, { type: 'Profile change', subject: 'Queue C address', priority: 'medium' })
  const at = await apiLogin(origin, PEOPLE.anna)
  await jsonCall(origin, at, 'POST', `/hrcases/cases/${c.case_id}/status`, { status: 'resolved' })
  void a
  void b

  const anna = await as(PEOPLE.anna)
  await landing(anna.page, '?tab=queue')
  await waitCases(anna.page)
  const subjects = () => anna.page.$$eval('[data-testid=case-open]', (els) => els.map((e) => e.textContent.trim()))
  const wait = async (fn) => {
    await anna.page.waitForTimeout(150)
    await anna.page.waitForFunction(fn)
  }
  let list = await subjects()
  for (const s of ['Queue A laptop', 'Queue B certificate', 'Queue C address']) assert.ok(list.includes(s), s)

  await anna.page.selectOption('[data-testid=filter-priority]', 'high')
  await wait(() => [...document.querySelectorAll('[data-testid=case-row]')].every((r) => r.dataset.priority === 'high'))
  list = await subjects()
  assert.ok(list.includes('Queue A laptop') && !list.includes('Queue B certificate'))
  assert.match(new URL(anna.page.url()).search, /priority=high/, 'filters live in the URL')
  await anna.page.click('[data-testid=filters-clear]')
  await wait(() => document.querySelectorAll('[data-testid=case-row]').length >= 3)

  await anna.page.selectOption('[data-testid=filter-status]', 'resolved')
  await wait(() => [...document.querySelectorAll('[data-testid=case-row]')].every((r) => r.dataset.status === 'resolved'))
  assert.ok((await subjects()).includes('Queue C address'))
  await anna.page.selectOption('[data-testid=filter-status]', 'active')
  await wait(() => [...document.querySelectorAll('[data-testid=case-row]')].every((r) => r.dataset.status !== 'resolved' && r.dataset.status !== 'closed'))
  assert.ok(!(await subjects()).includes('Queue C address'))

  await anna.page.selectOption('[data-testid=filter-type]', await optionValue(anna.page, '[data-testid=filter-type]', 'Certificate'))
  await wait(() => document.querySelectorAll('[data-testid=case-row]').length === 1)
  assert.deepEqual(await subjects(), ['Queue B certificate'])
  await anna.page.click('[data-testid=filters-clear]')
  await wait(() => document.querySelectorAll('[data-testid=case-row]').length >= 3)

  // assignee filter
  const rowB = anna.page.locator('[data-testid=case-row]', { hasText: 'Queue B certificate' })
  await rowB.locator('[data-testid=assign-me]').click()
  await anna.page.waitForFunction(() => [...document.querySelectorAll('[data-testid=case-row]')].some((r) => /Queue B certificate/.test(r.textContent) && /Assigned to you/.test(r.textContent)))
  await anna.page.selectOption('[data-testid=filter-assignee]', 'me')
  await wait(() => [...document.querySelectorAll('[data-testid=case-row]')].every((r) => /Assigned to you/.test(r.textContent)))
  assert.ok((await subjects()).includes('Queue B certificate'))
  await anna.page.selectOption('[data-testid=filter-assignee]', 'unassigned')
  await wait(() => ![...document.querySelectorAll('[data-testid=case-row]')].some((r) => /Assigned to you/.test(r.textContent)))
  await anna.page.click('[data-testid=filters-clear]')
  await wait(() => document.querySelectorAll('[data-testid=case-row]').length >= 3)

  // quick controls: in-place status and priority
  const rowA = anna.page.locator('[data-testid=case-row]', { hasText: 'Queue A laptop' })
  await rowA.locator('[data-testid=status-select]').selectOption('in_progress')
  await rowA.locator('[data-testid=status-apply]').click()
  await anna.page.waitForFunction(() => [...document.querySelectorAll('[data-testid=case-row]')].some((r) => /Queue A laptop/.test(r.textContent) && r.dataset.status === 'in_progress'))
  await rowA.locator('[data-testid=priority-select]').selectOption('medium')
  await rowA.locator('[data-testid=priority-apply]').click()
  await anna.page.waitForFunction(() => [...document.querySelectorAll('[data-testid=case-row]')].some((r) => /Queue A laptop/.test(r.textContent) && r.dataset.priority === 'medium'))
  await done(anna)
})

test('E2E cases: a stale change from the queue is refused with a clear message and the row refreshes', opts, async () => {
  const c = await apiCase(PEOPLE.jamie, { subject: 'Stale target' })
  const anna = await as(PEOPLE.anna)
  await landing(anna.page, '?tab=queue')
  const row = anna.page.locator(`[data-testid=case-row][data-case-id="${c.case_id}"]`)
  await row.waitFor()
  await row.locator('[data-testid=status-select]').selectOption('in_progress')
  // somebody else moves it first (the API), so the row's version is stale
  const at = await apiLogin(origin, PEOPLE.anna)
  assert.equal((await jsonCall(origin, at, 'POST', `/hrcases/cases/${c.case_id}/status`, { status: 'waiting_on_employee' })).status, 200)
  const resp = anna.page.waitForResponse((r) => r.request().method() === 'POST' && /\/status$/.test(new URL(r.url()).pathname))
  await row.locator('[data-testid=status-apply]').click()
  assert.equal((await resp).status(), 409)
  await row.locator('[data-testid=controls-error]').waitFor()
  assert.match(await row.locator('[data-testid=controls-error]').innerText(), /changed by someone else/)
  await anna.page.waitForFunction((id) => document.querySelector(`[data-case-id="${id}"]`)?.dataset.status === 'waiting_on_employee', c.case_id)
  await done(anna)
})

test('E2E cases: lists paginate, a failing list shows an honest retry, and a failing case shows the error rather than "not found"', opts, async () => {
  for (let i = 1; i <= 21; i++) await apiCase(PEOPLE.lia, { subject: `Bulk case ${i}` })
  const lia = await as(PEOPLE.lia)
  await landing(lia.page)
  await lia.page.waitForSelector('[data-testid=pager]')
  assert.equal(await lia.page.locator('[data-testid=case-row]').count(), 20)
  assert.match(await text(lia.page, '[data-testid=pager-range]'), /1-20 of \d+/)
  await lia.page.click('[data-testid=pager-next]')
  await lia.page.waitForFunction(() => /^2[1-9]-/.test(document.querySelector('[data-testid=pager-range]')?.textContent || ''))
  assert.match(new URL(lia.page.url()).search, /page=2/)

  await lia.page.route('**/api/hrcases/cases?*', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"Server error"}' }))
  await landing(lia.page)
  await lia.page.waitForSelector('[data-testid=cases-error]')
  await lia.page.unroute('**/api/hrcases/cases?*')
  await lia.page.click('[data-testid=cases-error] button')
  await lia.page.waitForSelector('[data-testid=case-rows]')

  await lia.page.route('**/api/hrcases/cases/*', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"Server error"}' }))
  await lia.page.goto(`${origin}/hr-requests/cases/00000000-0000-4000-8000-000000000001`)
  await lia.page.waitForSelector('[data-testid=case-error]')
  assert.equal(await lia.page.locator('[data-testid=case-missing]').count(), 0)
  await done(lia)
})
