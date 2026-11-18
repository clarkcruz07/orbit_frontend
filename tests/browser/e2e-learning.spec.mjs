// REAL-BACKEND end-to-end suite for Learning & Development. Starts the real backend (in-memory DB, demo auth, temp
// storage, random port) behind a node server that serves frontend/dist and proxies /api, then drives real system Chrome
// through the catalog, self-enrolment, manager assignment with a due date, completion and confirmation, certificate
// upload (valid and rejected) with authorised download, the HR compliance overview and course admin.
// Demo people (all fictional): Anna = HR, Miguel = Jamie's manager, Carla = Lia's manager, Jamie, Lia, Paolo.
// The real backend's clock cannot be injected from a browser run, so an OVERDUE enrolment cannot be created here
// (assignments refuse past due dates): overdue flags are covered by learning-ui.spec.mjs against the mock API.
// Gated: RUN_BROWSER_TESTS=1 (use `npm run test:browser`). No external service is contacted.
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { launchBrowser } from './browser-env.mjs'
import { PEOPLE, receiptPath, startRealStack } from './real-backend.mjs'
import { actor, apiCall, apiLogin, pageApi, text, waitGone } from './e2e-helpers.mjs'

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
  await ensureCatalog()
})
after(async () => {
  for (const a of open.splice(0)) await a.close().catch(() => undefined)
  await browser?.close()
  await stack?.close()
})

// The backend seeds six placeholder courses unless PEOPLE_SEED_SAMPLE_CONTENT is off. The harness child still reads backend/.env
// (this suite never opens it), so a local .env that turns sample content off would leave the catalog empty. Whatever is missing is
// created here through the HR API with the same titles, so the suite does not depend on the owner's local .env.
const SIX = [
  ['Workplace Health and Safety Basics', 'Compliance', 2, 'online', true],
  ['Data Privacy Essentials', 'Compliance', 1.5, 'online', true],
  ['Code of Conduct Refresher', 'Compliance', 1, 'self_paced', true],
  ['Effective Communication Skills', 'Soft skills', 4, 'classroom', false],
  ['Introduction to Project Planning', 'Professional skills', 3, 'self_paced', false],
  ['Leading Your First Team', 'Leadership', 6, 'classroom', false],
]
let seededByBackend = 0
async function ensureCatalog() {
  const t = await apiLogin(origin, PEOPLE.anna)
  const have = (await apiCall(origin, t, 'GET', '/learning/courses?active=all&page_size=50')).json.items
  seededByBackend = have.filter((c) => c.placeholder).length
  for (const [title, category, hours, delivery, mandatory] of SIX) {
    if (have.some((c) => c.title === title)) continue
    const r = await apiCall(origin, t, 'POST', '/learning/courses', { title, category, duration_hours: hours, delivery, mandatory_default: mandatory, description: 'Fictional course created by the test suite.' })
    assert.equal(r.status, 201, JSON.stringify(r.json))
  }
}

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

const goto = async (page, path, ready) => {
  await page.goto(`${origin}${path}`)
  await page.waitForSelector(ready)
}
const learn = (page, qs = '') => goto(page, `/learning${qs}`, '[data-testid=learning-page]')
const idFromUrl = (page) => new URL(page.url()).pathname.split('/').pop()
const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)
const card = (page, title) => page.locator('[data-testid=course-card]', { has: page.locator('[data-testid=course-title]', { hasText: title }) })
const banner = (page, re) => page.waitForFunction((src) => new RegExp(src, 'i').test(document.querySelector('[data-testid=enrolment-banner]')?.textContent || ''), re.source)

async function courseId(email, title) {
  const t = await apiLogin(origin, email)
  const r = await apiCall(origin, t, 'GET', '/learning/courses?page_size=50&active=true')
  const c = r.json.items.find((x) => x.title === title)
  assert.ok(c, `course ${title}`)
  return c.course_id
}
async function apiAssign(by, to, courseTitle, extra = {}) {
  const t = await apiLogin(origin, by)
  const cid = await courseId(by, courseTitle)
  const r = await apiCall(origin, t, 'POST', '/learning/assignments', { course_id: cid, employee_id: to, ...extra })
  assert.equal(r.status, 201, JSON.stringify(r.json))
  return r.json
}

const JAMIE = 'EMP-0005'
const LIA = 'EMP-0008'

// ------------------------------------------------------------------------------------------------ catalog and self-enrolment
test('E2E catalog: six placeholder courses, filters, self-enrol in a voluntary course, start, progress, complete (self-attested)', opts, async () => {
  const jamie = await as(PEOPLE.jamie)
  const p = jamie.page
  await learn(p)
  assert.equal(await p.locator('[data-testid=placeholder-notice]').count(), 0)
  await p.waitForSelector('[data-testid=course-card]')
  assert.equal(await p.locator('[data-testid=course-card]').count(), 6)
  assert.equal(await p.locator('[data-testid=course-placeholder]').count(), 0, 'no course is labelled as a placeholder')
  assert.equal(await p.locator('[data-testid^=tab-]').count(), 2, 'an employee has Catalog and My learning only')
  assert.equal(await p.locator('[data-testid=course-assign]').count(), 0, 'an employee cannot assign')
  assert.equal(await p.locator('[data-testid=course-enrol]').count(), 6)

  // filters (server-side)
  await p.fill('[data-testid=catalog-search]', 'communication')
  await p.waitForFunction(() => document.querySelectorAll('[data-testid=course-card]').length === 1)
  assert.match(await text(p, '[data-testid=course-title]'), /Effective Communication Skills/)
  await p.fill('[data-testid=catalog-search]', 'zzzz-nothing')
  await p.waitForSelector('[data-testid=catalog] [data-testid=empty-state]')
  assert.match(await text(p, '[data-testid=catalog] [data-testid=empty-state]'), /No courses match/)
  await p.fill('[data-testid=catalog-search]', '')
  await p.waitForFunction(() => document.querySelectorAll('[data-testid=course-card]').length === 6)
  await p.selectOption('[data-testid=catalog-category]', 'Compliance')
  await p.waitForFunction(() => document.querySelectorAll('[data-testid=course-card]').length === 3)
  await p.selectOption('[data-testid=catalog-category]', '')
  await p.selectOption('[data-testid=catalog-delivery]', 'classroom')
  await p.waitForFunction(() => document.querySelectorAll('[data-testid=course-card]').length === 2)
  await p.selectOption('[data-testid=catalog-delivery]', '')
  await p.waitForFunction(() => document.querySelectorAll('[data-testid=course-card]').length === 6)

  // self-enrol
  const c = card(p, 'Effective Communication Skills')
  await c.locator('[data-testid=course-enrol]').click()
  await p.waitForSelector('[data-testid=catalog-flash]')
  assert.match(await text(p, '[data-testid=catalog-flash]'), /You are enrolled in Effective Communication Skills/)
  await p.waitForFunction(() => !!document.querySelector('[data-testid=course-open]'))
  assert.equal(await card(p, 'Effective Communication Skills').locator('[data-testid=course-enrol]').count(), 0, 'no second enrolment offered')
  assert.match(await card(p, 'Effective Communication Skills').locator('[data-testid=course-open]').innerText(), /Enrolled/)

  await p.click('[data-testid=flash-open]')
  await p.waitForSelector('[data-testid=enrolment-detail]')
  const id = idFromUrl(p)
  assert.match(await text(p, '[data-testid=enrolment-status]'), /Enrolled/)
  assert.match(await text(p, '[data-testid=enrolment-source]'), /Self-enrolled/)
  await p.click('[data-testid=start-course]')
  await banner(p, /Course started/)
  assert.match(await text(p, '[data-testid=enrolment-status]'), /In progress/)
  assert.equal(await p.locator('[data-testid=start-course]').count(), 0)
  await p.fill('[data-testid=progress-slider]', '60')
  await p.click('[data-testid=progress-save]')
  await banner(p, /Progress saved: 60%/)
  assert.match(await text(p, '[data-testid=enrolment-progress]'), /60%/)
  assert.match(await text(p, '[data-testid=complete-hint]'), /self-attested/)
  // too-long note is stopped locally
  await p.fill('[data-testid=completion-note-input]', 'n'.repeat(1001))
  await p.click('[data-testid=complete-course]')
  assert.match(await text(p, '#completion-note-error'), /at most 1000/)
  await p.fill('[data-testid=completion-note-input]', 'Finished all the exercises (fictional).')
  await p.click('[data-testid=complete-course]')
  await banner(p, /Marked complete\./)
  assert.match(await text(p, '[data-testid=enrolment-status]'), /Completed/)
  assert.match(await text(p, '[data-testid=confirmation-status]'), /Self-attested/)
  assert.match(await text(p, '[data-testid=completion-note]'), /Finished all the exercises/)
  assert.equal(await p.locator('[data-testid=owner-actions]').count(), 0, 'nothing more to do on a finished voluntary course')
  assert.equal((await pageApi(p, origin, 'GET', `/learning/enrolments/${id}`)).json.counts_as_complete, true)
  await done(jamie)
})

// ------------------------------------------------------------------------------------------------ assignment, due date, certificate, confirmation
test('E2E assignment: Miguel assigns with a due date (mandatory), the picker refuses a non-report and a duplicate; Jamie sees due-soon and is notified', opts, async () => {
  const due = inDays(3)
  const miguel = await as(PEOPLE.miguel)
  const m = miguel.page
  await learn(m)
  assert.equal(await m.locator('[data-testid^=tab-]').count(), 3, 'a manager also has Team')
  const wh = card(m, 'Workplace Health and Safety Basics')
  await wh.locator('[data-testid=course-assign]').click()
  await m.waitForSelector('[data-testid=assign-panel]')
  assert.match(await text(m, '[data-testid=assign-panel] h3'), /Assign: Workplace Health and Safety Basics/)
  assert.equal(await m.locator('[data-testid=assign-mandatory]').isChecked(), true, 'mandatory defaults from the course')

  // validation: person required, due date not clearly in the past
  await m.click('[data-testid=assign-submit]')
  assert.match(await text(m, '[data-testid=assign-panel]'), /Choose a person/)
  // a person who is not a direct report: the directory finds them, the server refuses
  await m.fill('[data-testid=assign-search]', 'Lia')
  await m.waitForSelector('[data-testid=assign-results]')
  await m.click('[data-testid=assign-pick-EMP-0008]')
  await m.click('[data-testid=assign-submit]')
  await m.waitForSelector('[data-testid=assign-error]')
  assert.match(await text(m, '[data-testid=assign-error]'), /not allowed to assign/)
  await m.click('[data-testid=assign-person-clear]')

  // a direct report via the quick pick, with a past date refused locally and a good date accepted
  assert.ok((await m.locator('[data-testid=assign-reports] button').allInnerTexts()).includes('Jamie Dela Cruz'))
  await m.click(`[data-testid=assign-pick-${JAMIE}]`)
  await m.fill('[data-testid=assign-due]', '2020-01-01')
  await m.click('[data-testid=assign-submit]')
  assert.match(await text(m, '[data-testid=assign-panel]'), /cannot be in the past/)
  await m.fill('[data-testid=assign-due]', due)
  await m.click('[data-testid=assign-submit]')
  await m.waitForSelector('[data-testid=catalog-flash]')
  assert.match(await text(m, '[data-testid=catalog-flash]'), /Assigned Workplace Health and Safety Basics to Jamie Dela Cruz/)
  assert.equal(await m.locator('[data-testid=assign-panel]').count(), 0)

  // assigning the same course again is a conflict, with a link to the open enrolment
  await wh.locator('[data-testid=course-assign]').click()
  await m.click(`[data-testid=assign-pick-${JAMIE}]`)
  await m.click('[data-testid=assign-submit]')
  await m.waitForSelector('[data-testid=assign-error]')
  assert.match(await text(m, '[data-testid=assign-error]'), /Open the existing enrolment/)
  await done(miguel)

  // Jamie: My learning loads the summary (server creates due-soon notices), shows the flags
  const jamie = await as(PEOPLE.jamie)
  const j = jamie.page
  const summaryCall = j.waitForResponse((r) => new URL(r.url()).pathname.endsWith('/learning/my/summary'))
  await learn(j, '?tab=mine')
  await summaryCall
  await j.waitForSelector('[data-testid=enrolment-row]')
  const row = j.locator('[data-testid=enrolment-row]', { hasText: 'Workplace Health and Safety Basics' })
  assert.equal(await row.count(), 1)
  const rt = await row.innerText()
  assert.match(rt, /Assigned/)
  assert.match(rt, /Mandatory/)
  assert.match(rt, /Due soon/)
  assert.match(rt, /Assigned by Miguel Santos/)
  assert.match(await row.locator('[data-testid=due-text]').innerText(), /in 3 days/)
  assert.equal(await row.getAttribute('data-overdue'), 'false')
  assert.match(await text(j, '[data-testid=count-due-soon]'), /^1$/)
  assert.match(await text(j, '[data-testid=count-open]'), /^1$/)
  assert.match(await text(j, '[data-testid=count-completed]'), /^1$/)
  const kinds = (await pageApi(j, origin, 'GET', '/notifications?limit=30')).json.items.map((n) => n.kind)
  assert.ok(kinds.includes('learning.assigned'), kinds.join())
  assert.ok(kinds.includes('learning.due_soon'), kinds.join())
  // filters: overdue-only is empty, mandatory-only keeps it
  await j.check('[data-testid=mine-overdue]')
  await j.waitForSelector('[data-testid=my-learning] [data-testid=empty-state]')
  assert.match(await text(j, '[data-testid=my-learning] [data-testid=empty-state]'), /Nothing matches these filters/)
  await j.uncheck('[data-testid=mine-overdue]')
  await j.check('[data-testid=mine-mandatory]')
  await j.waitForFunction(() => document.querySelectorAll('[data-testid=enrolment-row]').length === 1)
  assert.equal(await j.locator('[data-testid=enrolment-row]').count(), 1)
  await done(jamie)
})

test('E2E certificate: invalid type and oversize are rejected inline, a valid PNG is stored and downloads with the Bearer token (never a URL token); completion waits for the manager; Miguel confirms', opts, async () => {
  const jamie = await as(PEOPLE.jamie)
  const j = jamie.page
  await learn(j, '?tab=mine')
  await j.locator('[data-testid=enrolment-row]', { hasText: 'Workplace Health and Safety Basics' }).click()
  await j.waitForSelector('[data-testid=enrolment-detail]')
  const id = idFromUrl(j)
  assert.match(await text(j, '[data-testid=certificate-hint]'), /PDF, PNG or JPEG, up to 10 MB/)
  assert.match(await text(j, '[data-testid=no-certificates]'), /No certificate/)
  assert.equal(await j.locator('[data-testid=manage-card]').count(), 0, 'the employee cannot change the due date or cancel an assignment')
  assert.match(await text(j, '[data-testid=complete-hint]'), /needs confirmation/)

  // 1. a text file: refused by the server (415), nothing stored
  await j.setInputFiles('[data-testid=certificate-input]', { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not a certificate') })
  assert.match(await text(j, '[data-testid=certificate-chosen]'), /notes\.txt/)
  await j.click('[data-testid=certificate-upload-btn]')
  await j.waitForSelector('[data-testid=certificate-error]')
  assert.match(await text(j, '[data-testid=certificate-error]'), /not accepted\. Use a PDF, PNG or JPEG\. Nothing was stored/)
  // 2. PNG bytes with a .pdf name: extension, declared type and magic bytes must agree (415)
  await j.setInputFiles('[data-testid=certificate-input]', { name: 'fake.pdf', mimeType: 'application/pdf', buffer: fs.readFileSync(receiptPath('receipt_full.png')) })
  await j.click('[data-testid=certificate-upload-btn]')
  await j.waitForFunction(() => /not accepted/.test(document.querySelector('[data-testid=certificate-error]')?.textContent || ''))
  // 3. a 10.4 MB PDF: over the module's 10 MB limit (413). Kept below the shared 11 MB request cap on purpose: a larger body is cut off by the middleware before it is read, and the harness proxy then never delivers that early 413 to the browser.
  const big = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(Math.round(10.4 * 1024 * 1024), 0x20)])
  await j.setInputFiles('[data-testid=certificate-input]', { name: 'huge.pdf', mimeType: 'application/pdf', buffer: big })
  await j.click('[data-testid=certificate-upload-btn]')
  await j.waitForFunction(() => /too large \(limit 10 MB\)\. Nothing was stored/.test(document.querySelector('[data-testid=certificate-error]')?.textContent || ''), null, { timeout: 60000 })
  assert.equal(await j.locator('[data-testid=certificate-row]').count(), 0, 'nothing was stored by the rejected uploads')
  assert.equal((await pageApi(j, origin, 'GET', `/learning/enrolments/${id}`)).json.certificates.length, 0)

  // 4. a valid PNG
  const png = fs.readFileSync(receiptPath('receipt_full.png'))
  await j.setInputFiles('[data-testid=certificate-input]', { name: 'my-first-aid-certificate.png', mimeType: 'image/png', buffer: png })
  await j.click('[data-testid=certificate-upload-btn]')
  await j.waitForSelector('[data-testid=certificate-row]')
  assert.match(await text(j, '[data-testid=enrolment-banner]'), /Certificate uploaded/)
  assert.match(await text(j, '[data-testid=certificate-name]'), /my-first-aid-certificate\.png/)
  assert.equal(await j.locator('[data-testid=certificate-error]').count(), 0, 'the earlier error is cleared')

  // authorised download: bytes identical, saved under the server-chosen name, the request carries the Bearer header and no token in the URL
  const requests = []
  j.on('request', (r) => {
    if (/certificates\/.+\/file/.test(r.url())) requests.push({ url: r.url(), auth: r.headers()['authorization'] })
  })
  const [dl] = await Promise.all([j.waitForEvent('download'), j.click('[data-testid=certificate-download]')])
  const saved = fs.readFileSync(await dl.path())
  assert.ok(saved.equals(png), 'the downloaded bytes equal the uploaded file')
  assert.match(dl.suggestedFilename(), /^certificate-[0-9a-f]{8}\.png$/, 'the server chooses the name, not the uploaded one')
  assert.equal(requests.length, 1)
  assert.match(requests[0].auth, /^Bearer /)
  assert.ok(!/token|access/i.test(new URL(requests[0].url).search), 'no token in the URL')
  // the same file without a token is refused
  const bare = await fetch(`${origin}/api/learning/enrolments/${id}/certificates/${(await pageApi(j, origin, 'GET', `/learning/enrolments/${id}`)).json.certificates[0].certificate_id}/file`)
  assert.equal(bare.status, 401)

  // complete: needs confirmation
  await j.fill('[data-testid=completion-note-input]', 'Completed the module, certificate attached.')
  await j.click('[data-testid=complete-course]')
  await banner(j, /waiting for confirmation/)
  assert.match(await text(j, '[data-testid=confirmation-status]'), /Waiting for confirmation/)
  assert.equal(await j.locator('[data-testid=confirm-card]').count(), 0, 'nobody confirms their own completion')
  await done(jamie)

  const miguel = await as(PEOPLE.miguel)
  const m = miguel.page
  const mn = (await pageApi(m, origin, 'GET', '/notifications?limit=30')).json.items.filter((n) => n.kind === 'learning.completion_review_needed')
  assert.equal(mn.length, 1)
  assert.equal(mn[0].link, `/learning/enrolments/${id}`)
  assert.ok(!/certificate|first-aid|Completed the module/.test(JSON.stringify(mn)), 'no note or file name in the notification')
  await learn(m)
  assert.match(await text(m, '[data-testid=tab-team]'), /\b1\b/, 'Team tab badge shows the completion waiting for confirmation')
  await m.click('[data-testid=tab-team]')
  await m.waitForSelector('[data-testid=review-queue] [data-testid=enrolment-row]')
  assert.match(await text(m, '[data-testid=review-queue] h3'), /\(1\)/)
  await m.locator('[data-testid=review-queue] [data-testid=enrolment-row]').click()
  await m.waitForSelector('[data-testid=confirm-card]')
  assert.equal(idFromUrl(m), id)
  assert.match(await text(m, '[data-testid=completion-note]'), /certificate attached/)
  // the manager can download the proof
  const [dl2] = await Promise.all([m.waitForEvent('download'), m.click('[data-testid=certificate-download]')])
  assert.ok(fs.readFileSync(await dl2.path()).equals(png))
  assert.equal(await m.locator('[data-testid=certificate-upload]').count(), 0, 'only the owner can upload')
  assert.equal(await m.locator('[data-testid=manage-card]').count(), 0, 'a finished enrolment has no due date or cancel to manage')
  await m.click('[data-testid=confirm-completion]')
  await m.waitForFunction(() => /Updated\./.test(document.querySelector('[data-testid=enrolment-banner]')?.textContent || ''))
  await m.waitForFunction(() => /Confirmed/.test(document.querySelector('[data-testid=confirmation-status]')?.textContent || ''))
  assert.equal(await m.locator('[data-testid=confirm-card]').count(), 0)
  await m.waitForSelector('[data-testid=enrolment-confirmed]')
  assert.match(await text(m, '[data-testid=enrolment-confirmed]'), /by Miguel Santos/)
  assert.equal((await pageApi(m, origin, 'POST', `/learning/enrolments/${id}/confirm`)).status, 409, 'confirming twice is a server conflict')
  await done(miguel)

  const jamie2 = await as(PEOPLE.jamie)
  await goto(jamie2.page, `/learning/enrolments/${id}`, '[data-testid=enrolment-detail]')
  assert.match(await text(jamie2.page, '[data-testid=confirmation-status]'), /Confirmed/)
  assert.equal(await jamie2.page.locator('[data-testid=certificate-upload]').count(), 0, 'a confirmed record is locked')
  const n = (await pageApi(jamie2.page, origin, 'GET', '/notifications?limit=30')).json.items.filter((x) => x.kind === 'learning.completion_confirmed')
  assert.equal(n.length, 1)
  await done(jamie2)
})

test('E2E return: Miguel sends a completion back, Jamie completes again, Miguel confirms; due date change and cancel with confirmation', opts, async () => {
  const e = await apiAssign(PEOPLE.miguel, JAMIE, 'Data Privacy Essentials', { due_date: inDays(30) })
  const jt = await apiLogin(origin, PEOPLE.jamie)
  assert.equal((await apiCall(origin, jt, 'POST', `/learning/enrolments/${e.enrolment_id}/complete`, { completion_note: 'Read the slides.' })).status, 200)

  const miguel = await as(PEOPLE.miguel)
  const m = miguel.page
  await goto(m, `/learning/enrolments/${e.enrolment_id}`, '[data-testid=confirm-card]')
  await m.click('[data-testid=return-completion]')
  await m.waitForFunction(() => /In progress/.test(document.querySelector('[data-testid=enrolment-status]')?.textContent || ''))
  assert.equal(await m.locator('[data-testid=confirm-card]').count(), 0)
  // due date change (assigner) and clearing it
  const newDue = inDays(45)
  await m.fill('[data-testid=due-input]', newDue)
  await m.click('[data-testid=due-save]')
  await banner(m, /Due date saved/)
  assert.match(await text(m, '[data-testid=enrolment-due]'), /^Due /)
  await m.fill('[data-testid=due-input]', '')
  await m.click('[data-testid=due-save]')
  await banner(m, /Due date cleared/)
  assert.match(await text(m, '[data-testid=enrolment-due]'), /No due date/)
  await m.fill('[data-testid=due-input]', '2020-01-01')
  await m.click('[data-testid=due-save]')
  assert.match(await text(m, '#due-input-error'), /cannot be in the past/)
  await done(miguel)

  const jamie = await as(PEOPLE.jamie)
  const j = jamie.page
  await goto(j, `/learning/enrolments/${e.enrolment_id}`, '[data-testid=enrolment-detail]')
  assert.match(await text(j, '[data-testid=enrolment-status]'), /In progress/)
  assert.ok((await pageApi(j, origin, 'GET', '/notifications?limit=30')).json.items.some((n) => n.kind === 'learning.completion_returned'))
  await j.click('[data-testid=complete-course]')
  await banner(j, /waiting for confirmation/)
  await done(jamie)

  const miguel2 = await as(PEOPLE.miguel)
  const m2 = miguel2.page
  await goto(m2, `/learning/enrolments/${e.enrolment_id}`, '[data-testid=confirm-card]')
  // a stale queue: Jamie's row is also confirmable from the Team list; confirm there
  await learn(m2, '?tab=team')
  await m2.waitForSelector('[data-testid=review-queue] [data-testid=confirm-completion]')
  await m2.click('[data-testid=review-queue] [data-testid=confirm-completion]')
  await m2.waitForSelector('[data-testid=review-queue] [data-testid=empty-state]')
  assert.match(await text(m2, '[data-testid=team-summary] [data-id=EMP-0005]'), /Jamie Dela Cruz/)
  assert.match(await text(m2, '[data-testid=team-summary] [data-id=EMP-0005]'), /completed/)

  // cancel an assignment: confirmation box first, the employee is told
  const e2 = await apiAssign(PEOPLE.miguel, JAMIE, 'Code of Conduct Refresher')
  await goto(m2, `/learning/enrolments/${e2.enrolment_id}`, '[data-testid=manage-card]')
  await m2.click('[data-testid=cancel-enrolment]')
  await m2.waitForSelector('[data-testid=cancel-confirm-box]')
  await m2.click('[data-testid=cancel-keep]')
  assert.equal(await m2.locator('[data-testid=cancel-confirm-box]').count(), 0)
  assert.match(await text(m2, '[data-testid=enrolment-status]'), /Assigned/)
  await m2.click('[data-testid=cancel-enrolment]')
  await m2.click('[data-testid=cancel-confirm]')
  await banner(m2, /Enrolment cancelled/)
  assert.match(await text(m2, '[data-testid=enrolment-status]'), /Cancelled/)
  assert.equal(await m2.locator('[data-testid=manage-card]').count(), 0, 'nothing to manage once cancelled')
  assert.ok((await apiCall(origin, await apiLogin(origin, PEOPLE.jamie), 'GET', '/notifications?limit=40')).json.items.some((n) => n.kind === 'learning.assignment_cancelled'))
  await done(miguel2)
})

// ------------------------------------------------------------------------------------------------ isolation
test('E2E isolation: Lia (another manager\'s report) cannot see Jamie\'s learning by id, list or deep link; employees see no Team/HR tabs; HR-only endpoints refuse', opts, async () => {
  const t = await apiLogin(origin, PEOPLE.jamie)
  const mine = (await apiCall(origin, t, 'GET', '/learning/enrolments?scope=mine&page_size=50')).json.items
  assert.ok(mine.length >= 3)
  const target = mine[0].enrolment_id

  const lia = await as(PEOPLE.lia)
  const l = lia.page
  assert.equal((await pageApi(l, origin, 'GET', `/learning/enrolments/${target}`)).status, 404)
  assert.equal((await pageApi(l, origin, 'GET', `/learning/enrolments/${target}/certificates/00000000-0000-4000-8000-000000000000/file`)).status, 404)
  await goto(l, `/learning/enrolments/${target}`, '[data-testid=enrolment-detail-error]')
  assert.match(await text(l, '[data-testid=enrolment-detail-error] [data-testid=empty-state]'), /Enrolment not found/)
  await learn(l, '?tab=mine')
  await l.waitForSelector('[data-testid=my-learning] [data-testid=empty-state]')
  assert.match(await text(l, '[data-testid=my-learning] [data-testid=empty-state]'), /not enrolled in anything yet/)
  assert.equal(await l.locator('[data-testid^=tab-]').count(), 2)
  // forced tabs fall back to the catalog; the server refuses the scopes and HR endpoints
  await l.goto(`${origin}/learning?tab=hr`)
  await l.waitForSelector('[data-testid=learning-page][data-tab=catalog]')
  assert.equal((await pageApi(l, origin, 'GET', '/learning/enrolments?scope=team')).status, 403)
  assert.equal((await pageApi(l, origin, 'GET', '/learning/enrolments?scope=all')).status, 403)
  assert.equal((await pageApi(l, origin, 'GET', '/learning/compliance')).status, 403)
  assert.equal((await pageApi(l, origin, 'GET', '/learning/team/summary')).status, 403)
  assert.equal((await pageApi(l, origin, 'GET', '/learning/courses?active=all')).status, 403)
  // Carla (Lia's manager) cannot read or assign Jamie either
  const carla = await as(PEOPLE.carla)
  assert.equal((await pageApi(carla.page, origin, 'GET', `/learning/enrolments/${target}`)).status, 404)
  const cid = await courseId(PEOPLE.carla, 'Leading Your First Team')
  assert.equal((await pageApi(carla.page, origin, 'POST', '/learning/assignments', { course_id: cid, employee_id: JAMIE })).status, 403)
  // Miguel cannot read the HR compliance overview
  const miguel = await as(PEOPLE.miguel)
  assert.equal((await pageApi(miguel.page, origin, 'GET', '/learning/compliance')).status, 403)
  await done(lia, carla, miguel)
})

// ------------------------------------------------------------------------------------------------ HR
test('E2E HR: compliance overview matches the API, names are HR-only, HR assigns to anyone; course admin creates, edits and deactivates (catalog follows)', opts, async () => {
  const anna = await as(PEOPLE.anna)
  const a = anna.page
  await learn(a, '?tab=hr')
  assert.equal(await a.locator('[data-testid^=tab-]').count(), 3, 'HR has Catalog, My learning and HR')
  await a.waitForSelector('[data-testid=compliance-totals]')
  const api = (await pageApi(a, origin, 'GET', '/learning/compliance')).json
  assert.ok(api.totals.assigned >= 2, 'earlier tests created mandatory enrolments')
  assert.equal(await text(a, '[data-testid=totals-assigned]'), String(api.totals.assigned))
  assert.equal(await text(a, '[data-testid=totals-completed]'), String(api.totals.completed))
  assert.equal(await text(a, '[data-testid=totals-overdue]'), String(api.totals.overdue))
  assert.equal(await text(a, '[data-testid=totals-pending]'), String(api.totals.pending_confirmation))
  assert.match(await text(a, '[data-testid=totals-pct]'), new RegExp(`^${api.totals.completion_pct}% complete`))
  assert.equal(await a.locator('[data-testid=compliance-course-card]').count(), api.courses.length)
  const whCard = a.locator('[data-testid=compliance-course-card]', { hasText: 'Workplace Health and Safety Basics' })
  assert.equal(await whCard.locator('[data-testid=course-completed]').innerText(), '1', 'Jamie\'s confirmed completion counts')
  assert.match(await text(a, '[data-testid=compliance-note]'), /waits for confirmation does not count as complete/)
  assert.match(await text(a, '[data-testid=no-overdue]'), /Nobody has an overdue mandatory course/)
  // filter by course narrows server-side
  await a.selectOption('[data-testid=compliance-course]', { label: 'Data Privacy Essentials' })
  await a.waitForFunction(() => document.querySelectorAll('[data-testid=compliance-course-card]').length === 1)
  await a.selectOption('[data-testid=compliance-course]', '')
  await a.waitForFunction(() => document.querySelectorAll('[data-testid=compliance-course-card]').length >= 2)

  // HR assigns to anyone (Lia, who is not their report) and is told what the server decides
  await a.click('[data-testid=hr-assign]')
  await a.waitForSelector('[data-testid=assign-panel]')
  await a.selectOption('[data-testid=assign-course]', { label: 'Leading Your First Team' })
  assert.equal(await a.locator('[data-testid=assign-mandatory]').isChecked(), false)
  await a.fill('[data-testid=assign-search]', 'Ramos')
  await a.waitForSelector('[data-testid=assign-results]')
  await a.click(`[data-testid=assign-pick-${LIA}]`)
  await a.fill('[data-testid=assign-due]', inDays(20))
  await a.click('[data-testid=assign-submit]')
  await a.waitForSelector('[data-testid=hr-flash]')
  assert.match(await text(a, '[data-testid=hr-flash]'), /Assigned Leading Your First Team to Lia Ramos/)
  // all enrolments (names are visible to HR)
  await a.click('[data-testid=hr-section-enrolments]')
  await a.waitForSelector('[data-testid=scoped-all] [data-testid=enrolment-row]')
  const all = await text(a, '[data-testid=scoped-all]')
  assert.ok(all.includes('Lia Ramos') && all.includes('Jamie Dela Cruz'))
  assert.match(new URL(a.url()).search, /tab=hr&section=enrolments/)

  // course admin: validation, create, edit, deactivate
  await a.click('[data-testid=hr-section-courses]')
  await a.waitForSelector('[data-testid=course-admin] [data-testid=admin-course-row]')
  assert.equal(await a.locator('[data-testid=admin-course-row]').count(), 6)
  await a.click('[data-testid=admin-new-course]')
  await a.click('[data-testid=course-save]')
  const formText = await text(a, '[data-testid=course-form-card]')
  assert.match(formText, /Give the course a title/)
  assert.match(formText, /Give the course a category/)
  assert.match(formText, /Enter hours above 0/)
  await a.fill('[data-testid=course-title-input]', 'Fire Drill Practice (E2E)')
  await a.fill('[data-testid=course-category-input]', 'Safety')
  await a.fill('[data-testid=course-description-input]', 'Fictional placeholder course.')
  await a.fill('[data-testid=course-duration-input]', '0.75')
  await a.selectOption('[data-testid=course-delivery-input]', 'classroom')
  await a.click('[data-testid=course-save]')
  await a.waitForSelector('[data-testid=admin-flash]')
  assert.match(await text(a, '[data-testid=admin-flash]'), /Course created: Fire Drill Practice \(E2E\)/)
  await a.waitForFunction(() => document.querySelectorAll('[data-testid=admin-course-row]').length === 7)
  assert.equal(await a.locator('[data-testid=admin-course-row]').count(), 7)
  // a duplicate title is refused by the server and shown inline
  await a.click('[data-testid=admin-new-course]')
  await a.fill('[data-testid=course-title-input]', ' fire drill  practice (e2e) ')
  await a.fill('[data-testid=course-category-input]', 'Safety')
  await a.fill('[data-testid=course-duration-input]', '1')
  await a.click('[data-testid=course-save]')
  await a.waitForSelector('[data-testid=course-form-error]')
  await a.click('[data-testid=course-cancel]')
  // edit
  const rowFd = a.locator('[data-testid=admin-course-row]', { hasText: 'Fire Drill Practice (E2E)' })
  await rowFd.locator('[data-testid=admin-edit-course]').click()
  await a.fill('[data-testid=course-title-input]', 'Fire Drill Practice v2 (E2E)')
  await a.check('[data-testid=course-mandatory-input]')
  await a.click('[data-testid=course-save]')
  await a.waitForFunction(() => /Course saved: Fire Drill Practice v2/.test(document.querySelector('[data-testid=admin-flash]')?.textContent || ''))
  const rowV2 = a.locator('[data-testid=admin-course-row]', { hasText: 'Fire Drill Practice v2 (E2E)' })
  assert.match(await rowV2.innerText(), /Mandatory by default/)
  assert.match(await rowV2.innerText(), /Active/)
  assert.doesNotMatch(await rowV2.innerText(), /Placeholder - set by HR/, 'a course HR created is not a placeholder')

  // Jamie sees it in the catalog; after HR deactivates it, Jamie no longer does
  const jamie = await as(PEOPLE.jamie)
  await learn(jamie.page)
  await jamie.page.waitForSelector('[data-testid=course-card]')
  assert.equal(await card(jamie.page, 'Fire Drill Practice v2 (E2E)').count(), 1)
  await rowV2.locator('[data-testid=admin-toggle-course]').click()
  await a.waitForFunction(() => /is deactivated/.test(document.querySelector('[data-testid=admin-flash]')?.textContent || ''))
  assert.match(await text(a, '[data-testid=admin-course-row][data-active=false]'), /Inactive/)
  await a.selectOption('[data-testid=admin-active-filter]', 'false')
  await a.waitForFunction(() => document.querySelectorAll('[data-testid=admin-course-row]').length === 1)
  await jamie.page.reload()
  await jamie.page.waitForSelector('[data-testid=course-card]')
  assert.equal(await card(jamie.page, 'Fire Drill Practice v2 (E2E)').count(), 0, 'inactive courses leave the catalog')
  assert.equal((await pageApi(jamie.page, origin, 'GET', '/learning/courses?active=false')).status, 403)
  // reactivate
  await a.locator('[data-testid=admin-course-row]').locator('[data-testid=admin-toggle-course]').click()
  await a.waitForFunction(() => /is active again/.test(document.querySelector('[data-testid=admin-flash]')?.textContent || ''))
  await done(jamie, anna)

  // Lia sees the HR assignment
  const lia = await as(PEOPLE.lia)
  await learn(lia.page, '?tab=mine')
  await lia.page.waitForSelector('[data-testid=enrolment-row]')
  assert.match(await text(lia.page, '[data-testid=enrolment-row]'), /Leading Your First Team[\s\S]*Assigned by Anna Reyes/)
  await done(lia)
})

test('E2E deep links: unknown and malformed enrolment ids give an honest not-found state; the tab is URL-synced and survives reload and Back', opts, async () => {
  const jamie = await as(PEOPLE.jamie)
  const j = jamie.page
  for (const id of ['00000000-0000-4000-8000-000000000000', 'not-an-id']) {
    await goto(j, `/learning/enrolments/${id}`, '[data-testid=enrolment-detail-error]')
    assert.match(await text(j, '[data-testid=enrolment-detail-error] [data-testid=empty-state]'), /not found/i)
    assert.ok((await j.locator('[data-testid=enrolment-detail-error] a[href^="/learning"]').count()) >= 1)
  }
  await learn(j, '?tab=mine')
  await j.reload()
  await j.waitForSelector('[data-testid=my-learning]')
  assert.equal(new URL(j.url()).search, '?tab=mine')
  await j.click('[data-testid=tab-catalog]')
  await j.waitForSelector('[data-testid=catalog]')
  assert.equal(new URL(j.url()).search, '')
  await j.goBack()
  await j.waitForSelector('[data-testid=my-learning]')
  // the due-soon notification links to the enrolment and the bell opens it
  await j.goto(`${origin}/`)
  await j.waitForSelector('[data-testid=bell]')
  await j.click('[data-testid=bell]')
  await j.waitForSelector('[data-testid=bell-item]')
  await j.click('[data-testid=bell-item]:has-text("assigned you")')
  await j.waitForSelector('[data-testid=enrolment-detail]')
  assert.match(new URL(j.url()).pathname, /^\/learning\/enrolments\/[0-9a-f-]{36}$/)
  await waitGone(j, '[data-testid=enrolment-detail-loading]')
  await done(jamie)
})
