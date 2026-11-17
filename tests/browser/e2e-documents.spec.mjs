// REAL-BACKEND end-to-end suite for the Documents module (docs/api/documents.md).
// Starts the real backend (in-memory DB, demo auth, random port 8101-8199) plus the proxy that serves frontend/dist and
// drives system Chrome as the fictional demo people: Jamie and Lia (employees), Miguel (a manager), Anna (HR).
// Gated: RUN_BROWSER_TESTS=1. Never contacts anything outside 127.0.0.1. Fictional, in-memory files only.
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { launchBrowser } from './browser-env.mjs'
import { PEOPLE, startRealStack } from './real-backend.mjs'
import { actor, apiLogin, pageApi, text } from './e2e-helpers.mjs'
import { MIME, asPdf, docx, isoDaysFromToday, jpeg, notAllowed, pdf, png, upload, xlsx } from './documents-fixtures.mjs'
import { apiUploadDocument, employeeIdOf, jsonCall, multipart, rawGet, readDownload } from './documents-helpers.mjs'

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

const gotoDocs = async (page, query = '') => {
  await page.goto(`${origin}/documents${query}`)
  await page.waitForSelector('[data-testid=documents-page]')
}
const rowByTitle = (page, title) => page.locator('[data-testid=doc-row]', { hasText: title })
async function optionValue(page, selector, startsWith) {
  const v = await page.$$eval(`${selector} option`, (os, s) => os.find((o) => o.textContent.trim().startsWith(s))?.value ?? null, startsWith)
  assert.ok(v, `no <option> starting with "${startsWith}" in ${selector}`)
  return v
}
async function waitList(page) {
  await page.waitForFunction(() => document.querySelector('[data-testid=doc-rows], [data-testid=empty-state], [data-testid=list-error]'))
}
async function fillUpload(page, { type, title, expires, file }) {
  await page.click('[data-testid=upload-open]')
  await page.waitForSelector('[data-testid=upload-form]')
  await page.selectOption('[data-testid=upload-type]', await optionValue(page, '[data-testid=upload-type]', type))
  await page.fill('[data-testid=upload-title]', title)
  if (expires) await page.fill('[data-testid=upload-expiry]', expires)
  if (file) await page.setInputFiles('[data-testid=file-input]', file)
}
/** Fills and submits the upload form; resolves with the HTTP status of the upload request. */
async function uiUploadDoc(page, args) {
  await fillUpload(page, args)
  const resp = page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/documents/employee')
  await page.click('[data-testid=upload-submit]')
  return (await resp).status()
}
async function clickDownload(page, locator) {
  const [dl] = await Promise.all([page.waitForEvent('download'), locator.click()])
  return readDownload(dl)
}
const total = async (page, path) => (await pageApi(page, origin, 'GET', path)).json.total

// shared state across the ordered tests
const S = {}

// ------------------------------------------------------------------------------------------------ upload / download
test('E2E documents: Jamie uploads a PDF through the UI, sees version 1 and downloads exactly the same bytes (token in a header, never a URL)', opts, async () => {
  const jamie = await as(PEOPLE.jamie)
  const urls = []
  jamie.page.on('request', (r) => urls.push(r.url()))
  await gotoDocs(jamie.page)
  await jamie.page.waitForSelector('[data-testid=empty-state]')
  assert.match(await text(jamie.page, '[data-testid=privacy-note]'), /Managers do not see them/)
  assert.equal(await jamie.page.locator('[data-testid=tab-hr]').count(), 0, 'Jamie has no HR tab')

  S.contract = pdf('contract-v1')
  const status = await uiUploadDoc(jamie.page, { type: 'Contract', title: 'Employment contract (fictional)', file: upload('contract.pdf', S.contract, MIME.pdf) })
  assert.equal(status, 201)
  await jamie.page.waitForSelector('[data-testid=upload-done]')
  const row = rowByTitle(jamie.page, 'Employment contract (fictional)')
  await row.waitFor()
  assert.match(await row.locator('[data-testid=doc-version]').innerText(), /Version 1/)
  assert.equal(await row.getAttribute('data-expiry'), 'none')
  assert.equal(await row.locator('[data-testid=expiry-badge]').getAttribute('data-kind'), 'none')

  const bytes = await clickDownload(jamie.page, row.locator('[data-testid=doc-download]'))
  assert.ok(bytes.equals(S.contract), 'the download is byte-identical to the upload')
  assert.ok(urls.every((u) => !/token|access_token|Bearer/i.test(u)), 'no token in any URL')
  S.contractDocId = await row.getAttribute('data-doc-id')
  await done(jamie)
})

test('E2E documents: an expiry-required type refuses an empty date without sending anything, then accepts a date', opts, async () => {
  const jamie = await as(PEOPLE.jamie)
  const posts = []
  jamie.page.on('request', (r) => r.method() === 'POST' && posts.push(r.url()))
  await gotoDocs(jamie.page)
  await waitList(jamie.page)
  await fillUpload(jamie.page, { type: 'Identification', title: 'Passport copy (fictional)', file: upload('passport.png', png(), MIME.png) })
  assert.doesNotMatch(await text(jamie.page, '[data-testid=upload-type-help]'), /Placeholder/)
  await jamie.page.click('[data-testid=upload-submit]')
  await jamie.page.waitForSelector('text=This type needs an expiry date')
  assert.equal(posts.length, 0, 'a client-side check failure sends no request')
  await jamie.page.fill('[data-testid=upload-expiry]', isoDaysFromToday(300))
  const resp = jamie.page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/documents/employee')
  await jamie.page.click('[data-testid=upload-submit]')
  assert.equal((await resp).status(), 201)
  const row = rowByTitle(jamie.page, 'Passport copy (fictional)')
  await row.waitFor()
  assert.equal(await row.getAttribute('data-expiry'), 'valid')
  assert.match(await row.innerText(), /PNG/)
  await done(jamie)
})

test('E2E documents: every accepted file type uploads (PDF, PNG, JPEG, DOCX, XLSX) and a ~600 KB file is not blocked by the body-size middleware', opts, async () => {
  const jamie = await as(PEOPLE.jamie)
  await gotoDocs(jamie.page)
  await waitList(jamie.page)
  const cases = [
    ['Cert JPEG (fictional)', upload('cert.jpg', jpeg(), MIME.jpg), 'JPEG'],
    ['Letter DOCX (fictional)', upload('letter.docx', docx('letter'), MIME.docx), 'DOCX'],
    ['Sheet XLSX (fictional)', upload('sheet.xlsx', xlsx('sheet'), MIME.xlsx), 'XLSX'],
    ['Large PDF (fictional)', upload('large.pdf', pdf('large', 600), MIME.pdf), 'PDF'],
  ]
  for (const [title, file, label] of cases) {
    const status = await uiUploadDoc(jamie.page, { type: 'Other', title, file })
    assert.equal(status, 201, `${label} upload`)
    const row = rowByTitle(jamie.page, title)
    await row.waitFor()
    assert.match(await row.innerText(), new RegExp(label))
  }
  assert.match(await rowByTitle(jamie.page, 'Large PDF (fictional)').innerText(), /\b6\d\d(\.\d)? KB\b/)
  await done(jamie)
})

// ------------------------------------------------------------------------------------------------ versions
test('E2E documents: a new version keeps the original (version history, original still downloadable byte for byte)', opts, async () => {
  const jamie = await as(PEOPLE.jamie)
  await gotoDocs(jamie.page)
  await waitList(jamie.page)
  const row = rowByTitle(jamie.page, 'Employment contract (fictional)')
  await row.locator('[data-testid=doc-details]').click()
  await row.locator('[data-testid=version-list]').waitFor()
  assert.equal(await row.locator('[data-testid=version-row]').count(), 1)

  await row.locator('[data-testid=doc-new-version]').click()
  const v2 = pdf('contract-v2')
  await row.locator('[data-testid=version-file]').setInputFiles(upload('contract-v2.pdf', v2, MIME.pdf))
  const resp = jamie.page.waitForResponse((r) => r.request().method() === 'POST' && /\/versions$/.test(new URL(r.url()).pathname))
  await row.locator('[data-testid=version-submit]').click()
  assert.equal((await resp).status(), 201)
  await jamie.page.waitForFunction(() => document.querySelectorAll('[data-testid=version-row]').length === 2)

  assert.match(await row.locator('[data-testid=doc-version]').innerText(), /Version 2/)
  const rows = row.locator('[data-testid=version-row]')
  assert.match(await rows.nth(0).innerText(), /Version 2[\s\S]*Current/)
  assert.match(await rows.nth(1).innerText(), /Version 1[\s\S]*Superseded/)

  assert.ok((await clickDownload(jamie.page, row.locator('[data-testid=version-download-1]'))).equals(S.contract), 'version 1 is preserved byte for byte')
  assert.ok((await clickDownload(jamie.page, row.locator('[data-testid=version-download-2]'))).equals(v2), 'version 2 downloads as uploaded')
  assert.ok((await clickDownload(jamie.page, row.locator('[data-testid=doc-download]'))).equals(v2), 'the main download is the current version')
  await done(jamie)
})

test('E2E documents: edit the title; a stale save is refused with a clear message and the row reloads; an expiry-required type insists on a date for a new version', opts, async () => {
  const jamie = await as(PEOPLE.jamie)
  await gotoDocs(jamie.page)
  await waitList(jamie.page)
  const row = rowByTitle(jamie.page, 'Passport copy (fictional)')
  await row.locator('[data-testid=doc-details]').click()
  await row.locator('[data-testid=doc-edit]').click()
  await row.locator('[data-testid=edit-title]').fill('Passport copy renewed (fictional)')
  const resp = jamie.page.waitForResponse((r) => r.request().method() === 'PATCH')
  await row.locator('[data-testid=edit-submit]').click()
  assert.equal((await resp).status(), 200)
  const row2 = rowByTitle(jamie.page, 'Passport copy renewed (fictional)')
  await row2.waitFor()

  // stale: somebody (here: the API) adds version 2 while the edit form is open with version 1 in hand
  const docId = await row2.getAttribute('data-doc-id')
  await row2.locator('[data-testid=doc-edit]').click()
  await row2.locator('[data-testid=edit-title]').fill('Passport copy stale save')
  const jt = await apiLogin(origin, PEOPLE.jamie)
  const added = await multipart(origin, jt, 'POST', `/documents/employee/${docId}/versions`, { file: upload('p2.png', png(), MIME.png), expires_on: isoDaysFromToday(500) })
  assert.equal(added.status, 201)
  const stale = jamie.page.waitForResponse((r) => r.request().method() === 'PATCH')
  await row2.locator('[data-testid=edit-submit]').click()
  assert.equal((await stale).status(), 409)
  await row2.locator('[data-testid=edit-error]').waitFor()
  assert.match(await row2.locator('[data-testid=edit-error]').innerText(), /changed by someone else/)
  await jamie.page.waitForFunction((id) => /Version 2/.test(document.querySelector(`[data-doc-id="${id}"] [data-testid=doc-version]`)?.textContent || ''), docId)
  assert.match(await row2.locator('[data-testid=doc-version]').innerText(), /Version 2/, 'the row now shows the latest version')

  // a new version of an expiry-required type needs its own date (no request until it has one)
  await row2.locator('[data-testid=doc-new-version]').click()
  await row2.locator('[data-testid=version-file]').setInputFiles(upload('passport3.png', png(), MIME.png))
  await row2.locator('[data-testid=version-submit]').click()
  await jamie.page.waitForSelector('text=needs an expiry date for the new version')
  await done(jamie)
})

// ------------------------------------------------------------------------------------------------ rejected files
test('E2E documents: rejected files say "Nothing was stored" and leave the list unchanged (wrong bytes, wrong type, empty)', opts, async () => {
  const jamie = await as(PEOPLE.jamie)
  await gotoDocs(jamie.page)
  await waitList(jamie.page)
  const eid = await employeeIdOf(origin, await apiLogin(origin, PEOPLE.jamie))
  const before = await total(jamie.page, `/documents/employee?employee_id=${eid}`)

  // 1) a text file pretending to be a PDF: the extension and header agree, the bytes do not
  let status = await uiUploadDoc(jamie.page, { type: 'Other', title: 'Fake pdf', file: upload('fake.pdf', Buffer.from('this is not a pdf'), MIME.pdf) })
  assert.equal(status, 415)
  await jamie.page.waitForSelector('[data-testid=upload-error]')
  assert.match(await text(jamie.page, '[data-testid=upload-error]'), /Unsupported file[\s\S]*Nothing was stored/)

  // 2) a Windows executable: the client hint warns first, the service still decides
  await jamie.page.setInputFiles('[data-testid=file-input]', upload('tool.exe', notAllowed(), 'application/x-msdownload'))
  assert.match(await text(jamie.page, '[data-testid=file-input-hint]'), /not one of the accepted types/)
  let resp = jamie.page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/documents/employee')
  await jamie.page.click('[data-testid=upload-submit]')
  assert.equal((await resp).status(), 415)
  await jamie.page.waitForFunction(() => /Nothing was stored/.test(document.querySelector('[data-testid=upload-error]')?.textContent || ''))

  // 3) an empty file
  await jamie.page.setInputFiles('[data-testid=file-input]', upload('empty.pdf', Buffer.alloc(0), MIME.pdf))
  assert.match(await text(jamie.page, '[data-testid=file-input-hint]'), /looks empty/)
  resp = jamie.page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/documents/employee')
  await jamie.page.click('[data-testid=upload-submit]')
  assert.equal((await resp).status(), 400)
  await jamie.page.waitForFunction(() => /empty[\s\S]*Nothing was stored/i.test(document.querySelector('[data-testid=upload-error]')?.textContent || ''))

  assert.equal(await total(jamie.page, `/documents/employee?employee_id=${eid}`), before, 'nothing was stored by any of the three')
  await done(jamie)
})

// ------------------------------------------------------------------------------------------------ expiry badges
test('E2E documents: expiry badges - expired, expiring within 30 days, valid and none - and the summary line', opts, async () => {
  const jt = await apiLogin(origin, PEOPLE.jamie)
  await apiUploadDocument(origin, jt, { type: 'Certification', title: 'Badge expired', file: upload('a.pdf', pdf('expired'), MIME.pdf), expires: isoDaysFromToday(-400) })
  await apiUploadDocument(origin, jt, { type: 'Certification', title: 'Badge expiring', file: upload('b.pdf', pdf('expiring'), MIME.pdf), expires: isoDaysFromToday(10) })
  await apiUploadDocument(origin, jt, { type: 'Certification', title: 'Badge valid', file: upload('c.pdf', pdf('valid'), MIME.pdf), expires: isoDaysFromToday(200) })

  const jamie = await as(PEOPLE.jamie)
  await gotoDocs(jamie.page)
  await waitList(jamie.page)
  const kindOf = async (title) => rowByTitle(jamie.page, title).locator('[data-testid=expiry-badge]').getAttribute('data-kind')
  assert.equal(await kindOf('Badge expired'), 'expired')
  assert.equal(await kindOf('Badge expiring'), 'expiring')
  assert.equal(await kindOf('Badge valid'), 'valid')
  assert.equal(await kindOf('Employment contract'), 'none')
  assert.match(await rowByTitle(jamie.page, 'Badge expired').locator('[data-testid=expiry-badge]').innerText(), /Expired \d+ days ago/)
  assert.match(await rowByTitle(jamie.page, 'Badge expiring').locator('[data-testid=expiry-badge]').innerText(), /Expires in (9|10|11) days/)
  const summary = await text(jamie.page, '[data-testid=expiry-summary]')
  assert.match(summary, /1 document expired/)
  assert.match(summary, /1 document expiring within 30 days/)

  // the type filter narrows the list
  await jamie.page.selectOption('[data-testid=type-filter]', await optionValue(jamie.page, '[data-testid=type-filter]', 'Certification'))
  await jamie.page.waitForFunction(() => [...document.querySelectorAll('[data-testid=doc-row]')].every((r) => /Certification/.test(r.textContent)))
  assert.equal(await jamie.page.locator('[data-testid=doc-row]').count(), 3)
  await done(jamie)
})

test('E2E documents: HR sees who is expiring (names), and can hide the already expired', opts, async () => {
  const anna = await as(PEOPLE.anna)
  await gotoDocs(anna.page, '?tab=hr&section=expiring')
  await anna.page.waitForSelector('[data-testid=expiring-rows]')
  let titles = await anna.page.$$eval('[data-testid=expiring-rows] [data-testid=doc-title]', (els) => els.map((e) => e.textContent.trim()))
  assert.ok(titles.includes('Badge expired') && titles.includes('Badge expiring'))
  assert.ok(!titles.includes('Badge valid'), 'valid for 200 days is outside the 30-day window')
  assert.match(await anna.page.locator('[data-testid=expiring-rows] [data-testid=doc-row]').first().innerText(), /Jamie Dela Cruz/)
  assert.match(await text(anna.page, '[data-testid=expiring-today]'), /Today is/)
  await anna.page.uncheck('[data-testid=expiring-include-expired]')
  await anna.page.waitForFunction(() => ![...document.querySelectorAll('[data-testid=doc-title]')].some((e) => e.textContent.trim() === 'Badge expired'))
  titles = await anna.page.$$eval('[data-testid=expiring-rows] [data-testid=doc-title]', (els) => els.map((e) => e.textContent.trim()))
  assert.ok(titles.includes('Badge expiring'))
  // a wider window brings the 200-day document in
  await anna.page.selectOption('[data-testid=expiring-days]', '365')
  await anna.page.waitForFunction(() => [...document.querySelectorAll('[data-testid=doc-title]')].some((e) => e.textContent.trim() === 'Badge valid'))
  await done(anna)
})

// ------------------------------------------------------------------------------------------------ HR tools and the HR-only type
test('E2E documents: HR adds an HR-only type, uploads on behalf of Jamie with the directory lookup; Jamie can neither see nor open it', opts, async () => {
  const anna = await as(PEOPLE.anna)
  await gotoDocs(anna.page, '?tab=hr&section=types')
  await anna.page.waitForSelector('[data-testid=type-rows]')
  assert.doesNotMatch(await text(anna.page, '[data-testid=types-note]'), /Placeholder/)
  await anna.page.click('[data-testid=type-new-open]')
  await anna.page.fill('[data-testid=type-name-input]', 'Disciplinary record')
  await anna.page.check('[data-testid=type-hronly-input]')
  await anna.page.click('[data-testid=type-submit]')
  await anna.page.waitForSelector('[data-testid=types-message]')
  assert.match(await text(anna.page, '[data-testid=type-rows]'), /Disciplinary record[\s\S]*HR only/)

  await gotoDocs(anna.page, '?tab=hr')
  await anna.page.fill('[data-testid=employee-search]', 'Jamie')
  await anna.page.click('[data-testid=employee-result]')
  await anna.page.waitForSelector('[data-testid=employee-chip]')
  assert.equal(await anna.page.locator('[data-testid=upload-open]').count(), 1, 'upload on behalf is offered once someone is picked')
  const status = await uiUploadDoc(anna.page, { type: 'Disciplinary record', title: 'HR file note (fictional)', file: upload('note.pdf', pdf('hr-note'), MIME.pdf) })
  assert.equal(status, 201)
  const row = rowByTitle(anna.page, 'HR file note (fictional)')
  await row.waitFor()
  assert.match(await row.innerText(), /HR only/)
  S.hrDocId = await row.getAttribute('data-doc-id')
  // and a normal document uploaded for Jamie, which he does see
  assert.equal(await uiUploadDoc(anna.page, { type: 'Certification', title: 'First aid certificate (fictional)', expires: isoDaysFromToday(150), file: upload('firstaid.pdf', pdf('first-aid'), MIME.pdf) }), 201)
  await rowByTitle(anna.page, 'First aid certificate (fictional)').waitFor()

  const jamie = await as(PEOPLE.jamie)
  await gotoDocs(jamie.page)
  await waitList(jamie.page)
  const mine = await jamie.page.$$eval('[data-testid=doc-title]', (els) => els.map((e) => e.textContent.trim()))
  assert.ok(mine.includes('First aid certificate (fictional)'), 'the on-behalf document is visible to its owner')
  assert.match(await rowByTitle(jamie.page, 'First aid certificate (fictional)').innerText(), /Anna Reyes/, 'shows who uploaded it')
  assert.ok(!mine.includes('HR file note (fictional)'), 'the HR-only document is not in the owner list')
  await jamie.page.click('[data-testid=upload-open]')
  const types = await jamie.page.$$eval('[data-testid=upload-type] option', (os) => os.map((o) => o.textContent))
  assert.ok(!types.some((t) => /Disciplinary/.test(t)), 'the HR-only type is not offered to the owner')
  assert.equal((await pageApi(jamie.page, origin, 'GET', `/documents/employee/${S.hrDocId}`)).status, 404)
  assert.equal((await pageApi(jamie.page, origin, 'GET', `/documents/employee/${S.hrDocId}/file`)).status, 404)
  await done(anna, jamie)
})

test('E2E documents: the document-type catalog - deleting a used type is refused, deactivating hides it from uploads, and it can be activated again', opts, async () => {
  const anna = await as(PEOPLE.anna)
  await gotoDocs(anna.page, '?tab=hr&section=types')
  await anna.page.waitForSelector('[data-testid=type-rows]')
  const typeRow = (name) => anna.page.locator('[data-testid=type-row]', { hasText: name })
  await typeRow('Contract').locator('[data-testid=type-delete]').click()
  await anna.page.waitForSelector('[data-testid=type-error]')
  assert.match(await text(anna.page, '[data-testid=type-error]'), /used by documents[\s\S]*Deactivate/)

  await typeRow('Medical certificate').locator('[data-testid=type-toggle]').click()
  await anna.page.waitForSelector('[data-testid=type-row][data-active=no]')
  const jamie = await as(PEOPLE.jamie)
  await gotoDocs(jamie.page)
  await waitList(jamie.page)
  await jamie.page.click('[data-testid=upload-open]')
  assert.ok(!(await jamie.page.$$eval('[data-testid=upload-type] option', (os) => os.map((o) => o.textContent))).some((t) => /Medical certificate/.test(t)))
  await typeRow('Medical certificate').locator('[data-testid=type-toggle]').click()
  await anna.page.waitForFunction(() => !document.querySelector('[data-testid=type-row][data-active=no]'))

  // a brand-new unused type can be deleted; renaming onto an existing name is a 409 shown in the form
  await anna.page.click('[data-testid=type-new-open]')
  await anna.page.fill('[data-testid=type-name-input]', 'Temporary type')
  await anna.page.click('[data-testid=type-submit]')
  await typeRow('Temporary type').waitFor()
  await typeRow('Temporary type').locator('[data-testid=type-edit]').click()
  await anna.page.fill('[data-testid=type-form] [data-testid=type-name-input]', 'contract')
  await anna.page.click('[data-testid=type-form] [data-testid=type-submit]')
  await anna.page.waitForSelector('text=A type with this name already exists')
  await typeRow('Temporary type').locator('[data-testid=type-delete]').click()
  await anna.page.waitForFunction(() => !/Temporary type/.test(document.querySelector('[data-testid=type-rows]')?.textContent || ''))
  await done(anna, jamie)
})

// ------------------------------------------------------------------------------------------------ privacy
test('E2E documents: a manager sees no personal documents (UI and API); Miguel manages Jamie but still gets 403/404', opts, async () => {
  const miguel = await as(PEOPLE.miguel)
  await gotoDocs(miguel.page)
  await miguel.page.waitForSelector('[data-testid=empty-state]')
  assert.match(await text(miguel.page, '[data-testid=empty-state]'), /No documents yet/)
  assert.equal(await miguel.page.locator('[data-testid=tab-hr]').count(), 0)
  await gotoDocs(miguel.page, '?tab=hr')
  assert.equal(await miguel.page.getAttribute('[data-testid=documents-page]', 'data-tab'), 'mine', 'a forced ?tab=hr falls back to My documents')
  const jamieEid = await employeeIdOf(origin, await apiLogin(origin, PEOPLE.jamie))
  assert.equal((await pageApi(miguel.page, origin, 'GET', `/documents/employee?employee_id=${jamieEid}`)).status, 403)
  assert.equal((await pageApi(miguel.page, origin, 'GET', `/documents/employee/${S.contractDocId}`)).status, 404)
  assert.equal((await pageApi(miguel.page, origin, 'GET', `/documents/employee/${S.contractDocId}/file`)).status, 404)
  assert.equal((await pageApi(miguel.page, origin, 'GET', '/documents/employee')).json.total, 0, 'the list holds only his own (none)')
  const expiring = await pageApi(miguel.page, origin, 'GET', '/documents/expiring?days=366&include_expired=true')
  assert.equal(expiring.json.total, 0, 'the expiring list is limited to his own')
  assert.equal((await pageApi(miguel.page, origin, 'GET', '/documents/policies/coverage')).status, 403)
  assert.equal((await pageApi(miguel.page, origin, 'GET', '/documents/types?include_inactive=true')).status, 403)
  await done(miguel)
})

test("E2E documents: Lia cannot see or open Jamie's documents (404 with the same body as an unknown id)", opts, async () => {
  const lia = await as(PEOPLE.lia)
  await gotoDocs(lia.page)
  await lia.page.waitForSelector('[data-testid=empty-state]')
  const real = await pageApi(lia.page, origin, 'GET', `/documents/employee/${S.contractDocId}`)
  const unknown = await pageApi(lia.page, origin, 'GET', '/documents/employee/00000000-0000-4000-8000-000000000000')
  assert.equal(real.status, 404)
  assert.deepEqual(real.json, unknown.json, 'no way to tell a hidden document from a missing one')
  assert.equal((await pageApi(lia.page, origin, 'GET', `/documents/employee/${S.contractDocId}/versions/1/file`)).status, 404)
  const post = await pageApi(lia.page, origin, 'PATCH', `/documents/employee/${S.contractDocId}`, { title: 'hijack' })
  assert.equal(post.status, 404)
  assert.equal((await pageApi(lia.page, origin, 'GET', '/documents/employee')).json.total, 0)
  await done(lia)
})

// ------------------------------------------------------------------------------------------------ policies
test('E2E documents: HR publishes a policy, Jamie is notified and acknowledges it (immutable), and HR coverage updates with names', opts, async () => {
  const anna = await as(PEOPLE.anna)
  await gotoDocs(anna.page, '?tab=hr&section=publish')
  await anna.page.waitForSelector('[data-testid=publish-note]')
  await anna.page.click('[data-testid=policy-new-open]')
  await anna.page.fill('[data-testid=policy-title-input]', 'Remote work guidelines (fictional)')
  await anna.page.fill('[data-testid=policy-effective-input]', isoDaysFromToday(7))
  await anna.page.fill('[data-testid=policy-summary-input]', 'When and how people may work remotely. Placeholder text.')
  S.policyV1 = pdf('policy-v1')
  await anna.page.setInputFiles('[data-testid=policy-file]', upload('remote-work.pdf', S.policyV1, MIME.pdf))
  const resp = anna.page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/documents/policies')
  await anna.page.click('[data-testid=policy-publish-submit]')
  assert.equal((await resp).status(), 201)
  await anna.page.waitForSelector('[data-testid=publish-done]')

  const jt = await apiLogin(origin, PEOPLE.jamie)
  S.policyId = (await jsonCall(origin, jt, 'GET', '/documents/policies')).json.items.find((p) => p.title.startsWith('Remote work')).policy_id
  const notes = (await jsonCall(origin, jt, 'GET', '/notifications')).json.items.filter((n) => n.kind === 'policy.published')
  assert.equal(notes.length, 1)
  assert.equal(notes[0].link, `/documents/policies/${S.policyId}`)

  const jamie = await as(PEOPLE.jamie)
  await jamie.page.goto(`${origin}${notes[0].link}`)
  await jamie.page.waitForSelector('[data-testid=policy-row]')
  assert.equal(await jamie.page.getAttribute('[data-testid=documents-page]', 'data-tab'), 'policies')
  assert.ok((await jamie.page.getAttribute('[data-testid=policy-row]', 'class')).includes('dc-highlight'), 'the linked policy is highlighted')
  const row = jamie.page.locator(`[data-testid=policy-row][data-policy-id="${S.policyId}"]`)
  assert.match(await row.locator('[data-testid=policy-summary]').innerText(), /work remotely/)
  assert.match(await row.locator('[data-testid=policy-version]').innerText(), /Version 1/)
  assert.match(await row.locator('[data-testid=policy-ack-pill]').innerText(), /Not acknowledged/)
  assert.ok((await clickDownload(jamie.page, row.locator('[data-testid=policy-download]'))).equals(S.policyV1))

  await row.locator('[data-testid=policy-acknowledge]').click()
  assert.match(await text(jamie.page, '[data-testid=ack-confirm-box]'), /cannot be changed or removed/)
  await row.locator('[data-testid=ack-confirm]').click()
  await jamie.page.waitForFunction((id) => /Acknowledged/.test(document.querySelector(`[data-policy-id="${id}"] [data-testid=policy-ack-pill]`)?.textContent || ''), S.policyId)
  assert.equal(await row.locator('[data-testid=policy-acknowledge]').count(), 0, 'no acknowledge button once done')
  assert.match(await row.locator('[data-testid=policy-ack-at]').innerText(), /cannot be changed/)

  // immutable: repeating returns the original record, nothing is rewritten; there is no way to undo it
  const again = await jsonCall(origin, jt, 'POST', `/documents/policies/${S.policyId}/acknowledge`, { version: 1 })
  assert.equal(again.status, 200)
  assert.equal((await jsonCall(origin, jt, 'DELETE', `/documents/policies/${S.policyId}/acknowledge`)).status, 405)

  // HR coverage: counts and names
  await gotoDocs(anna.page, '?tab=hr&section=coverage')
  await anna.page.waitForSelector('[data-testid=coverage-row]')
  const covRow = anna.page.locator(`[data-testid=coverage-row][data-policy-id="${S.policyId}"]`)
  assert.match(await covRow.locator('[data-testid=coverage-counts]').innerText(), /1 acknowledged - \d+ outstanding/)
  assert.match(await text(anna.page, '[data-testid=coverage-eligible]'), /eligible employee/)
  await covRow.locator('[data-testid=coverage-names]').click()
  await anna.page.waitForSelector('[data-testid=outstanding-list]')
  const acked = await anna.page.$$eval('[data-testid=acknowledged-person] strong', (els) => els.map((e) => e.textContent.trim()))
  const missing = await anna.page.$$eval('[data-testid=outstanding-person] strong', (els) => els.map((e) => e.textContent.trim()))
  assert.deepEqual(acked, ['Jamie Dela Cruz'])
  assert.ok(missing.includes('Lia Ramos') && !missing.includes('Jamie Dela Cruz'))
  await done(anna, jamie)
})

test('E2E documents: a new policy version supersedes the old one, asks everyone again, keeps the old file for HR only and resets coverage', opts, async () => {
  const anna = await as(PEOPLE.anna)
  await gotoDocs(anna.page, '?tab=hr&section=publish')
  const pubRow = anna.page.locator(`[data-testid=publish-row][data-policy-id="${S.policyId}"]`)
  await pubRow.waitFor()
  await pubRow.locator('[data-testid=policy-new-version-open]').click()
  assert.match(await text(anna.page, '[data-testid=policy-version-form] h2'), /version 2/)
  await anna.page.fill('[data-testid=policy-version-form] [data-testid=policy-effective-input]', isoDaysFromToday(14))
  const v2 = pdf('policy-v2')
  await anna.page.setInputFiles('[data-testid=policy-version-form] [data-testid=policy-file]', upload('remote-work-v2.pdf', v2, MIME.pdf))
  await anna.page.click('[data-testid=policy-version-form] [data-testid=policy-publish-submit]')
  await anna.page.waitForSelector('[data-testid=publish-done]')

  const jamie = await as(PEOPLE.jamie)
  await jamie.page.goto(`${origin}/documents?tab=policies`)
  const row = jamie.page.locator(`[data-testid=policy-row][data-policy-id="${S.policyId}"]`)
  await row.waitFor()
  assert.match(await row.locator('[data-testid=policy-version]').innerText(), /Version 2/)
  assert.match(await row.locator('[data-testid=policy-ack-pill]').innerText(), /Not acknowledged/)
  assert.equal(await row.locator('[data-testid=policy-acknowledge]').count(), 1, 'must acknowledge the new version')
  assert.equal(await row.locator('[data-testid=policy-versions-toggle]').count(), 0, 'version history is HR-only')
  const jt = await apiLogin(origin, PEOPLE.jamie)
  assert.equal((await rawGet(origin, jt, `/documents/policies/${S.policyId}/versions/1/file`)).status, 404, 'a superseded version is hidden from employees')
  assert.ok((await rawGet(origin, jt, `/documents/policies/${S.policyId}/file`)).bytes.equals(v2))

  await gotoDocs(anna.page, '?tab=hr&section=coverage')
  const covRow = anna.page.locator(`[data-testid=coverage-row][data-policy-id="${S.policyId}"]`)
  await covRow.waitFor()
  assert.match(await covRow.locator('[data-testid=coverage-counts]').innerText(), /0 acknowledged/)

  // HR sees the whole history and can still download version 1, byte for byte
  await gotoDocs(anna.page, '?tab=policies')
  const arow = anna.page.locator(`[data-testid=policy-row][data-policy-id="${S.policyId}"]`)
  await arow.waitFor()
  await arow.locator('[data-testid=policy-versions-toggle]').click()
  await anna.page.waitForFunction(() => document.querySelectorAll('[data-testid=policy-version-row]').length === 2)
  assert.ok((await clickDownload(anna.page, arow.locator('[data-testid=policy-version-download-1]'))).equals(S.policyV1))
  await done(anna, jamie)
})

// ------------------------------------------------------------------------------------------------ states and shapes
test('E2E documents: documents are listed newest first, paginate at 20, and the sidebar item stays active on the policy deep link', opts, async () => {
  const jt = await apiLogin(origin, PEOPLE.jamie)
  for (let i = 1; i <= 12; i++) await apiUploadDocument(origin, jt, { type: 'Other', title: `Bulk item ${String(i).padStart(2, '0')}`, file: upload(`b${i}.pdf`, pdf(`bulk-${i}`), MIME.pdf) })
  const jamie = await as(PEOPLE.jamie)
  await gotoDocs(jamie.page)
  await jamie.page.waitForSelector('[data-testid=pager]')
  assert.equal(await jamie.page.locator('[data-testid=doc-row]').count(), 20)
  assert.match(await text(jamie.page, '[data-testid=pager-range]'), /1-20 of \d+/)
  assert.equal(await jamie.page.locator('[data-testid=pager-prev]').isDisabled(), true)
  const firstTitle = await jamie.page.locator('[data-testid=doc-title]').first().innerText()
  assert.equal(firstTitle, 'Bulk item 12', 'newest update first')
  await jamie.page.click('[data-testid=pager-next]')
  await jamie.page.waitForFunction(() => /21-/.test(document.querySelector('[data-testid=pager-range]')?.textContent || ''))
  assert.equal(await jamie.page.locator('[data-testid=pager-next]').isDisabled(), true)
  await jamie.page.goto(`${origin}/documents/policies/${S.policyId}`)
  await jamie.page.waitForSelector('[data-testid=policy-row]')
  assert.ok((await jamie.page.getAttribute('[data-nav-id=documents]', 'class')).includes('active'))
  await done(jamie)
})

test('E2E documents: an unknown policy link says so, and a failing list shows an honest error with a retry', opts, async () => {
  const jamie = await as(PEOPLE.jamie)
  await jamie.page.goto(`${origin}/documents/policies/00000000-0000-4000-8000-000000000000`)
  await jamie.page.waitForSelector('[data-testid=policy-missing]')
  await jamie.page.route('**/api/documents/employee?*', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"Server error"}' }))
  await jamie.page.goto(`${origin}/documents`)
  await jamie.page.waitForSelector('[data-testid=list-error]')
  await jamie.page.unroute('**/api/documents/employee?*')
  await jamie.page.click('[data-testid=list-error] button')
  await jamie.page.waitForSelector('[data-testid=doc-rows]')
  await done(jamie)
})
