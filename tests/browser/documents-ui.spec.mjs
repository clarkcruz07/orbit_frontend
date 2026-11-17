// Documents module UI states against a self-contained MOCK API (documents-mock.mjs; the shell/auth mock is mock-api.mjs).
// Covers: loading / empty / error / forbidden states, expiry badges, upload validation and hints, server rejections,
// versions and edit (incl. a stale 409), policies and the acknowledge flow, the HR tools, and non-HR gating.
// Gated: RUN_BROWSER_TESTS=1 (use `npm run test:browser`). Fictional mock data only.
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { ANNA, BEN, CARLA, enabled, launchBrowser, opts, text, withMockApp } from './mock-helpers.mjs'
import { createState, installModuleMock, isoDay } from './documents-mock.mjs'

let browser
before(async () => {
  if (enabled) browser = await launchBrowser()
})
after(async () => {
  await browser?.close()
})

/** Runs `fn({page, state, errors, mock})` with the module mock installed for the given mock user. */
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
const go = async (page, mock, path, ready = '[data-testid=documents-page]') => {
  await page.goto(`${mock.origin}${path}`)
  await page.waitForSelector(ready)
}
const waitRows = (page) => page.waitForSelector('[data-testid=doc-rows], [data-testid=empty-state], [data-testid=list-error]')
const row = (page, title) => page.locator('[data-testid=doc-row]', { hasText: title })
const titles = (page) => page.$$eval('[data-testid=doc-title]', (els) => els.map((e) => e.textContent.trim()))
const upload = (name, body = '%PDF-1.4 x', mimeType = 'application/pdf') => ({ name, mimeType, buffer: Buffer.from(body) })

// ------------------------------------------------------------------------------------------------ My documents
test('my documents: only what the server returns (own, not HR-only), with expiry badges, a summary line and the privacy note', opts, () =>
  app(CARLA, async ({ page, mock, errors }) => {
    await go(page, mock, '/documents')
    await waitRows(page)
    assert.deepEqual((await titles(page)).sort(), ['Compliance training certificate', 'Employment contract', 'First aid certificate', 'Passport copy'])
    const kind = (t) => row(page, t).locator('[data-testid=expiry-badge]').getAttribute('data-kind')
    assert.equal(await kind('First aid certificate'), 'expired')
    assert.equal(await kind('Passport copy'), 'expiring')
    assert.equal(await kind('Compliance training certificate'), 'valid')
    assert.equal(await kind('Employment contract'), 'none')
    assert.match(await row(page, 'First aid certificate').locator('[data-testid=expiry-badge]').innerText(), /Expired 40 days ago/)
    assert.match(await row(page, 'Passport copy').locator('[data-testid=expiry-badge]').innerText(), /Expires in 12 days/)
    assert.match(await text(page, '[data-testid=expiry-summary]'), /1 document expired, 1 document expiring within 30 days/)
    assert.match(await row(page, 'Employment contract').locator('[data-testid=doc-version]').innerText(), /Version 2/)
    assert.match(await text(page, '[data-testid=privacy-note]'), /Managers do not see them[\s\S]*HR only/)
    assert.equal(await page.locator('[data-testid=tab-hr]').count(), 0)
    assert.deepEqual(errors, [])
  }))

test('my documents: the list asks for the caller\'s own employee id only, and the type filter narrows it', opts, async () => {
  const state = createState()
  state.types.push({ type_id: 'ty-empty', name: 'Medical certificate', description: '', expiry_required: false, hr_only: false, active: true, placeholder: true })
  await app(CARLA, async ({ page, mock }) => {
    await go(page, mock, '/documents')
    await waitRows(page)
    assert.ok(state.log.some((l) => /GET \/documents\/employee\?.*employee_id=EMP-0003/.test(l)), state.log.join('\n'))
    await page.selectOption('[data-testid=type-filter]', 'ty-cert')
    await page.waitForFunction(() => [...document.querySelectorAll('[data-testid=doc-row]')].every((r) => /Certification/.test(r.textContent)))
    assert.deepEqual((await titles(page)).sort(), ['Compliance training certificate', 'First aid certificate'])
    assert.ok(!(await page.$$eval('[data-testid=type-filter] option', (os) => os.map((o) => o.textContent))).some((t) => /Disciplinary/.test(t)), 'HR-only types are not offered to an employee')
    await page.selectOption('[data-testid=type-filter]', 'ty-empty')
    await page.waitForSelector('[data-testid=empty-state]')
    assert.match(await text(page, '[data-testid=empty-state]'), /No documents of this type/)
  }, { state })
})

test('my documents: loading skeleton, empty state, error with retry, and a 403 explained', opts, async () => {
  const state = createState()
  state.delay['GET /documents/employee'] = 700
  await app(CARLA, async ({ page, mock }) => {
    await page.goto(`${mock.origin}/documents`)
    await page.waitForSelector('[data-testid=list-loading]')
    assert.equal(await page.getAttribute('[data-testid=list-loading]', 'aria-busy'), 'true')
    await waitRows(page)
    state.delay = {}

    state.forced['GET /documents/employee'] = { status: 500, body: { detail: 'Server error' } }
    await go(page, mock, '/documents')
    await page.waitForSelector('[data-testid=list-error]')
    assert.match(await text(page, '[data-testid=list-error]'), /Server error/)
    state.forced = {}
    await page.click('[data-testid=list-error] button')
    await page.waitForSelector('[data-testid=doc-rows]')

    state.forced['GET /documents/employee'] = { status: 403, body: { detail: 'You do not have access to this resource' } }
    await go(page, mock, '/documents')
    await page.waitForSelector('[data-testid=list-error]')
    assert.match(await text(page, '[data-testid=list-error]'), /do not have access to these documents/)
    state.forced = {}

    state.docs.length = 0
    await go(page, mock, '/documents')
    await page.waitForSelector('[data-testid=empty-state]')
    assert.match(await text(page, '[data-testid=empty-state]'), /No documents yet[\s\S]*visible to you and HR only/)
  }, { state })
})

test('upload: client checks run first (nothing is sent), the type explains itself, a bad file is hinted but the server decides', opts, async () => {
  const state = createState()
  await app(CARLA, async ({ page, mock, errors }) => {
    await go(page, mock, '/documents')
    await waitRows(page)
    await page.click('[data-testid=upload-open]')
    await page.waitForSelector('[data-testid=upload-form]')
    const posts = () => state.log.filter((l) => l.startsWith('POST /documents/employee')).length

    await page.click('[data-testid=upload-submit]')
    for (const s of ['Choose a document type.', 'Enter a title.', 'Choose a file to upload.']) await page.waitForSelector(`text=${s}`)
    assert.equal(posts(), 0)

    await page.selectOption('[data-testid=upload-type]', 'ty-id')
    assert.match(await text(page, '[data-testid=upload-type-help]'), /Government-issued ID/)
    assert.doesNotMatch(await text(page, '[data-testid=upload-type-help]'), /Placeholder/)
    assert.match(await text(page, 'label[for=dc-up-expiry]'), /required for this type/)
    await page.fill('[data-testid=upload-title]', 'Driver licence')
    await page.setInputFiles('[data-testid=file-input]', upload('licence.pdf'))
    assert.match(await text(page, '[data-testid=file-input-name]'), /licence\.pdf/)
    await page.click('[data-testid=upload-submit]')
    await page.waitForSelector('text=This type needs an expiry date.')
    assert.equal(posts(), 0)

    // a file the client hints about is still sent: only the server decides
    await page.fill('[data-testid=upload-expiry]', isoDay(400))
    await page.setInputFiles('[data-testid=file-input]', upload('run.exe', 'MZ', 'application/x-msdownload'))
    assert.match(await text(page, '[data-testid=file-input-hint]'), /not one of the accepted types/)
    state.forced.nextUpload = { status: 415, detail: 'Unsupported file. Upload a PDF, PNG, JPEG, DOCX or XLSX file.' }
    await page.click('[data-testid=upload-submit]')
    await page.waitForSelector('[data-testid=upload-error]')
    assert.match(await text(page, '[data-testid=upload-error]'), /Unsupported file[\s\S]*Nothing was stored/)
    assert.equal(posts(), 1)
    assert.equal(await page.locator('[data-testid=doc-row]', { hasText: 'Driver licence' }).count(), 0)

    state.forced.nextUpload = { status: 413, detail: 'The file is too large' }
    await page.click('[data-testid=upload-submit]')
    await page.waitForFunction(() => /too large[\s\S]*Nothing was stored/.test(document.querySelector('[data-testid=upload-error]')?.textContent || ''))

    // a good file
    await page.setInputFiles('[data-testid=file-input]', upload('licence.pdf'))
    await page.click('[data-testid=upload-submit]')
    await page.waitForSelector('[data-testid=upload-done]')
    assert.equal(await page.locator('[data-testid=upload-form]').count(), 0, 'the form closes after a successful upload')
    assert.equal((await titles(page))[0], 'Driver licence', 'the new document shows first')
    assert.equal(await row(page, 'Driver licence').locator('[data-testid=expiry-badge]').getAttribute('data-kind'), 'valid')
    assert.deepEqual(errors, [])
  }, { state })
})

test('upload: a network failure says nothing was stored and keeps the form', opts, () =>
  app(CARLA, async ({ page, mock }) => {
    await go(page, mock, '/documents')
    await waitRows(page)
    await page.click('[data-testid=upload-open]')
    await page.selectOption('[data-testid=upload-type]', 'ty-contract')
    await page.fill('[data-testid=upload-title]', 'Offline attempt')
    await page.setInputFiles('[data-testid=file-input]', upload('a.pdf'))
    await page.route('**/api/documents/employee', (route) => (route.request().method() === 'POST' ? route.abort('failed') : route.fallback()))
    await page.click('[data-testid=upload-submit]')
    await page.waitForSelector('[data-testid=upload-error]')
    assert.match(await text(page, '[data-testid=upload-error]'), /could not be reached[\s\S]*Nothing was stored/)
    assert.equal(await page.locator('[data-testid=upload-form]').count(), 1)
    assert.equal(await page.locator('[data-testid=upload-submit]').isDisabled(), false, 'can try again')
  }))

test('versions: history, new version (own expiry needed for an expiry type), download of an old version, and the edit form with a stale 409', opts, async () => {
  const state = createState()
  await app(CARLA, async ({ page, mock, errors }) => {
    const authed = []
    page.on('request', (r) => /\/documents\/employee\/.*\/file$/.test(r.url()) && authed.push(r.headers().authorization))
    await go(page, mock, '/documents')
    await waitRows(page)

    const contract = row(page, 'Employment contract')
    await contract.locator('[data-testid=doc-details]').click()
    await contract.locator('[data-testid=version-list]').waitFor()
    const versions = contract.locator('[data-testid=version-row]')
    assert.equal(await versions.count(), 2)
    assert.match(await versions.nth(0).innerText(), /Version 2[\s\S]*Current[\s\S]*contract-2026\.pdf[\s\S]*Anna Reyes/)
    assert.match(await versions.nth(1).innerText(), /Version 1[\s\S]*Superseded[\s\S]*contract-2024\.pdf/)
    assert.match(await contract.innerText(), /never overwritten/)
    await contract.locator('[data-testid=version-download-1]').click()
    await page.waitForFunction(() => true)
    await page.waitForTimeout(300)
    assert.ok(state.log.some((l) => l === 'GET /documents/employee/d-none/versions/1/file'), 'the old version is requested by its own URL')
    assert.ok(authed.length >= 1 && authed.every((a) => /^Bearer acc-u-carla$/.test(a)), 'downloads carry the Bearer header (never a URL token)')

    // new version of a type without expiry
    await contract.locator('[data-testid=doc-new-version]').click()
    await contract.locator('[data-testid=version-submit]').click()
    await page.waitForSelector('text=Choose the new file.')
    await contract.locator('[data-testid=version-file]').setInputFiles(upload('contract-2027.pdf'))
    await contract.locator('[data-testid=version-submit]').click()
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=version-row]').length === 3)
    assert.match(await contract.locator('[data-testid=doc-version]').innerText(), /Version 3/)

    // an expiry type insists on a date, with no request until it has one
    const passport = row(page, 'Passport copy')
    await passport.locator('[data-testid=doc-details]').click()
    await passport.locator('[data-testid=doc-new-version]').click()
    await passport.locator('[data-testid=version-file]').setInputFiles(upload('passport.pdf'))
    const before = state.log.filter((l) => /POST .*versions/.test(l)).length
    await passport.locator('[data-testid=version-submit]').click()
    await page.waitForSelector('text=needs an expiry date for the new version')
    assert.equal(state.log.filter((l) => /POST .*versions/.test(l)).length, before)
    await passport.locator('[data-testid=version-expiry]').fill(isoDay(500))
    await passport.locator('[data-testid=version-submit]').click()
    await page.waitForFunction(() => /Version 2/.test(document.querySelector('[data-doc-id=d-soon] [data-testid=doc-version]')?.textContent || ''))
    assert.equal(await passport.locator('[data-testid=expiry-badge]').getAttribute('data-kind'), 'valid', 'the badge follows the new version')

    // edit, then a stale save
    await passport.locator('[data-testid=doc-edit]').click()
    await passport.locator('[data-testid=edit-title]').fill('Passport copy (renewed)')
    await passport.locator('[data-testid=edit-submit]').click()
    await row(page, 'Passport copy (renewed)').waitFor()
    await passport.locator('[data-testid=doc-edit]').click()
    await passport.locator('[data-testid=edit-title]').fill('Stale title')
    state.docs.find((d) => d.doc_id === 'd-soon').versions.push({ version: 3, expires_on: isoDay(900), file: { filename: 'x.pdf', content_type: 'application/pdf', size_bytes: 10, sha256: 'e'.repeat(64) }, uploaded_by: { user_id: 'u-anna', name: 'Anna Reyes' }, uploaded_at: new Date().toISOString() })
    await passport.locator('[data-testid=edit-submit]').click()
    await passport.locator('[data-testid=edit-error]').waitFor()
    assert.match(await passport.locator('[data-testid=edit-error]').innerText(), /changed by someone else/)
    await page.waitForFunction(() => /Version 3/.test(document.querySelector('[data-doc-id=d-soon] [data-testid=doc-version]')?.textContent || ''))
    assert.deepEqual(errors, [])
  }, { state })
})

test('edit: "nothing changed" is reported without a request, and an expiry can be removed only where the type allows it', opts, async () => {
  const state = createState()
  state.docs.push({ doc_id: 'd-opt', employee_id: 'EMP-0003', type_id: 'ty-contract', title: 'Optional expiry doc', created_at: new Date().toISOString(), versions: [{ version: 1, expires_on: isoDay(100), file: { filename: 'o.pdf', content_type: 'application/pdf', size_bytes: 10, sha256: 'd'.repeat(64) }, uploaded_by: { user_id: 'u-carla', name: 'Carla Dizon' }, uploaded_at: new Date().toISOString() }] })
  await app(CARLA, async ({ page, mock }) => {
    await go(page, mock, '/documents')
    await waitRows(page)
    const passport = row(page, 'Passport copy')
    await passport.locator('[data-testid=doc-details]').click()
    await passport.locator('[data-testid=doc-edit]').click()
    assert.equal(await passport.locator('[data-testid=edit-clear-expiry]').count(), 0, 'an expiry-required type cannot lose its date')
    await passport.locator('[data-testid=edit-submit]').click()
    await passport.locator('[data-testid=edit-error]').waitFor()
    assert.match(await passport.locator('[data-testid=edit-error]').innerText(), /Nothing was changed/)
    assert.equal(state.log.filter((l) => l.startsWith('PATCH')).length, 0)

    const opt = row(page, 'Optional expiry doc')
    await opt.locator('[data-testid=doc-details]').click()
    await opt.locator('[data-testid=doc-edit]').click()
    await opt.locator('[data-testid=edit-clear-expiry]').check()
    assert.equal(await opt.locator('[data-testid=edit-expiry]').isDisabled(), true)
    await opt.locator('[data-testid=edit-submit]').click()
    await page.waitForFunction(() => document.querySelector('[data-doc-id=d-opt] [data-testid=expiry-badge]')?.getAttribute('data-kind') === 'none')
  }, { state })
})

// ------------------------------------------------------------------------------------------------ policies
test('policies: current versions, acknowledged state with its date, the notification deep link highlights its policy', opts, () =>
  app(CARLA, async ({ page, mock, errors }) => {
    await go(page, mock, '/documents?tab=policies')
    await page.waitForSelector('[data-testid=policy-rows]')
    const remote = page.locator('[data-testid=policy-row][data-policy-id=p-remote]')
    const conduct = page.locator('[data-testid=policy-row][data-policy-id=p-conduct]')
    assert.match(await remote.locator('[data-testid=policy-version]').innerText(), /Version 2/)
    assert.match(await remote.locator('[data-testid=policy-ack-pill]').innerText(), /Not acknowledged/)
    assert.equal(await remote.locator('[data-testid=policy-acknowledge]').count(), 1, 'version 2 must be acknowledged again')
    assert.match(await conduct.locator('[data-testid=policy-ack-pill]').innerText(), /Acknowledged/)
    assert.equal(await conduct.locator('[data-testid=policy-acknowledge]').count(), 0)
    assert.match(await conduct.locator('[data-testid=policy-ack-at]').innerText(), /You acknowledged version 1 on[\s\S]*cannot be changed/)
    assert.match(await remote.locator('[data-testid=policy-summary]').innerText(), /core hours/)
    assert.equal(await remote.locator('[data-testid=policy-versions-toggle]').count(), 0, 'version history is not offered to employees')
    assert.equal(await page.locator('[data-testid=publish-note]').count(), 0)

    await go(page, mock, '/documents/policies/p-conduct', '[data-testid=policy-row]')
    assert.equal(await page.getAttribute('[data-testid=documents-page]', 'data-tab'), 'policies')
    assert.ok((await conduct.getAttribute('class')).includes('dc-highlight'))
    assert.ok(!(await remote.getAttribute('class')).includes('dc-highlight'))
    assert.ok((await page.getAttribute('[data-nav-id=documents]', 'class')).includes('active'))
    // switching tabs from the deep link goes to the normal page
    await page.click('[data-testid=tab-mine]')
    await page.waitForURL('**/documents')
    assert.deepEqual(errors, [])
  }))

test('policies: acknowledging asks first, records once, and a newer version published meanwhile is explained (409)', opts, async () => {
  const state = createState()
  await app(CARLA, async ({ page, mock }) => {
    await go(page, mock, '/documents/policies/p-remote', '[data-testid=policy-row]')
    const remote = page.locator('[data-testid=policy-row][data-policy-id=p-remote]')
    await remote.locator('[data-testid=policy-acknowledge]').click()
    assert.match(await text(page, '[data-testid=ack-confirm-box]'), /I have read version 2 of[\s\S]*cannot be changed or removed/)
    assert.equal(state.log.filter((l) => l.includes('/acknowledge')).length, 0, 'nothing is recorded before the confirmation')
    await page.click('text=Cancel')
    assert.equal(await page.locator('[data-testid=ack-confirm-box]').count(), 0)

    // HR publishes version 3 while the box is open
    await remote.locator('[data-testid=policy-acknowledge]').click()
    state.policies[0].versions.push({ version: 3, title: 'Remote work guidelines', summary: 'Newest text.', effective_date: isoDay(1), published_at: new Date().toISOString(), file: { filename: 'v3.pdf', content_type: 'application/pdf', size_bytes: 5, sha256: 'a'.repeat(64) }, published_by: { user_id: 'u-anna', name: 'Anna Reyes' } })
    await remote.locator('[data-testid=ack-confirm]').click()
    await remote.locator('[data-testid=policy-error]').waitFor()
    assert.match(await remote.locator('[data-testid=policy-error]').innerText(), /newer version[\s\S]*read the new version/)
    await page.waitForFunction(() => /Version 3/.test(document.querySelector('[data-policy-id=p-remote] [data-testid=policy-version]')?.textContent || ''))

    // now acknowledge version 3 for real
    await remote.locator('[data-testid=policy-acknowledge]').click()
    await remote.locator('[data-testid=ack-confirm]').click()
    await page.waitForFunction(() => /Acknowledged/.test(document.querySelector('[data-policy-id=p-remote] [data-testid=policy-ack-pill]')?.textContent || ''))
    assert.equal(await remote.locator('[data-testid=policy-acknowledge]').count(), 0)
    assert.equal(state.log.filter((l) => l === 'POST /documents/policies/p-remote/acknowledge').length, 2)
  }, { state })
})

test('policies: empty, error and unknown-link states', opts, async () => {
  const state = createState()
  await app(CARLA, async ({ page, mock }) => {
    await go(page, mock, '/documents/policies/does-not-exist')
    await page.waitForSelector('[data-testid=policy-missing]')
    state.forced['GET /documents/policies'] = { status: 500, body: { detail: 'Server error' } }
    await go(page, mock, '/documents?tab=policies')
    await page.waitForSelector('[data-testid=policies-error]')
    state.forced = {}
    await page.click('[data-testid=policies-error] button')
    await page.waitForSelector('[data-testid=policy-rows]')
    state.policies.length = 0
    await go(page, mock, '/documents?tab=policies')
    await page.waitForSelector('[data-testid=empty-state]')
    assert.match(await text(page, '[data-testid=empty-state]'), /No policies published yet/)
  }, { state })
})

// ------------------------------------------------------------------------------------------------ HR tools
test('HR: the tab is offered, sections are URL-synced, and the employee lookup lists documents (incl. HR-only) and uploads on behalf', opts, async () => {
  const state = createState()
  await app(ANNA, async ({ page, mock, errors }) => {
    await go(page, mock, '/documents')
    assert.equal(await page.locator('[data-testid=tab-hr]').count(), 1)
    await page.click('[data-testid=tab-hr]')
    await page.waitForSelector('[data-testid=hr-employees]')
    assert.equal(new URL(page.url()).searchParams.get('tab'), 'hr')
    await page.waitForSelector('[data-testid=doc-rows]')
    const all = await titles(page)
    assert.ok(all.includes('HR file note') && all.includes('Dan ID card'), 'HR sees everyone, including HR-only types')
    assert.equal(await page.locator('[data-testid=upload-open]').count(), 0, 'no upload until someone is picked')
    assert.match(await text(page, '[data-testid=upload-help]'), /Pick an employee/)
    assert.match(await row(page, 'Dan ID card').innerText(), /Dan Ocampo \(Finance\)/)

    await page.fill('[data-testid=employee-search]', 'Carla')
    await page.click('[data-testid=employee-result]')
    await page.waitForSelector('[data-testid=employee-chip]')
    await page.waitForFunction(() => document.querySelector('[data-testid=doc-rows]') && ![...document.querySelectorAll('[data-testid=doc-title]')].some((e) => e.textContent.trim() === 'Dan ID card'))
    assert.ok((await titles(page)).includes('HR file note'))
    assert.match(await row(page, 'HR file note').innerText(), /HR only/)
    assert.ok(state.log.some((l) => /GET \/documents\/employee\?.*employee_id=EMP-0003/.test(l)))

    await page.click('[data-testid=upload-open]')
    assert.match(await text(page, '[data-testid=upload-form] h2'), /Upload a document for Carla Dizon/)
    assert.ok((await page.$$eval('[data-testid=upload-type] option', (os) => os.map((o) => o.textContent))).some((t) => /Disciplinary record \(HR only\)/.test(t)), 'HR may pick HR-only types')
    await page.selectOption('[data-testid=upload-type]', 'ty-contract')
    await page.fill('[data-testid=upload-title]', 'Addendum signed')
    await page.setInputFiles('[data-testid=file-input]', upload('addendum.pdf'))
    await page.click('[data-testid=upload-submit]')
    await page.waitForSelector('[data-testid=upload-done]')
    assert.ok(state.docs.some((d) => d.title === 'Addendum signed' && d.employee_id === 'EMP-0003'), 'the document was created for the picked employee')
    await page.click('[data-testid=employee-clear]')
    await page.waitForFunction(() => [...document.querySelectorAll('[data-testid=doc-title]')].some((e) => e.textContent.trim() === 'Dan ID card'))
    assert.deepEqual(errors, [])
  }, { state })
})

test('HR: the expiring list shows names, the window and "include expired" change the query, empty and error states are honest', opts, async () => {
  const state = createState()
  await app(ANNA, async ({ page, mock }) => {
    await go(page, mock, '/documents?tab=hr&section=expiring', '[data-testid=hr-expiring]')
    await page.waitForSelector('[data-testid=expiring-rows]')
    const names = await page.$$eval('[data-testid=expiring-rows] [data-testid=doc-row]', (els) => els.map((e) => e.textContent))
    assert.ok(names.some((t) => /Dan ID card/.test(t) && /Dan Ocampo/.test(t)))
    assert.ok(names.some((t) => /First aid certificate/.test(t) && /Carla Dizon/.test(t)))
    assert.equal(names.some((t) => /Compliance training certificate/.test(t)), false, '300 days is outside the 30-day window')
    assert.match(await text(page, '[data-testid=expiring-today]'), /Today is 16 Nov 2026/)
    await page.uncheck('[data-testid=expiring-include-expired]')
    await page.waitForFunction(() => ![...document.querySelectorAll('[data-testid=doc-title]')].some((e) => e.textContent.trim() === 'First aid certificate'))
    assert.ok(state.log.some((l) => /include_expired=false/.test(l)))
    await page.selectOption('[data-testid=expiring-days]', '365')
    await page.waitForFunction(() => [...document.querySelectorAll('[data-testid=doc-title]')].some((e) => e.textContent.trim() === 'Compliance training certificate'))

    state.forced['GET /documents/expiring'] = { status: 403, body: { detail: 'You do not have access to this resource' } }
    await page.selectOption('[data-testid=expiring-days]', '60')
    await page.waitForSelector('[data-testid=expiring-error]')
    assert.match(await text(page, '[data-testid=expiring-error]'), /for HR only/)
    state.forced = {}
    state.docs.length = 0
    await page.click('[data-testid=expiring-error] button')
    await page.waitForSelector('[data-testid=empty-state]')
    assert.match(await text(page, '[data-testid=empty-state]'), /Nothing is expiring/)
  }, { state })
})

test('HR: publishing a policy validates first, then publishes; a new version asks for its own date and file and shows the 409 case', opts, async () => {
  const state = createState()
  await app(ANNA, async ({ page, mock, errors }) => {
    await go(page, mock, '/documents?tab=hr&section=publish', '[data-testid=hr-publish]')
    await page.waitForSelector('[data-testid=publish-rows]')
    assert.match(await text(page, '[data-testid=publish-note]'), /notifies every employee[\s\S]*acknowledge again/)
    await page.click('[data-testid=policy-new-open]')
    await page.click('[data-testid=policy-publish-submit]')
    for (const s of ['Enter a title.', 'Enter the effective date.', 'Choose the policy file.']) await page.waitForSelector(`text=${s}`)
    assert.equal(state.log.filter((l) => l === 'POST /documents/policies').length, 0)
    await page.fill('[data-testid=policy-title-input]', 'Travel policy')
    await page.fill('[data-testid=policy-effective-input]', isoDay(30))
    await page.setInputFiles('[data-testid=policy-file]', upload('travel.pdf'))
    state.forced.nextUpload = { status: 415, detail: 'Unsupported file. Upload a PDF, PNG, JPEG, DOCX or XLSX file.' }
    await page.click('[data-testid=policy-publish-submit]')
    await page.waitForSelector('[data-testid=policy-form-error]')
    assert.match(await text(page, '[data-testid=policy-form-error]'), /Nothing was stored/)
    await page.click('[data-testid=policy-publish-submit]')
    await page.waitForSelector('[data-testid=publish-done]')
    assert.match(await text(page, '[data-testid=publish-done]'), /Published "Travel policy" \(version 1\)/)
    assert.ok(state.policies.some((p) => p.versions[0].title === 'Travel policy'))

    const conduct = page.locator('[data-testid=publish-row][data-policy-id=p-conduct]')
    await conduct.locator('[data-testid=policy-new-version-open]').click()
    assert.match(await conduct.locator('h2').innerText(), /Code of conduct \(version 2\)/)
    await conduct.locator('[data-testid=policy-publish-submit]').click()
    await page.waitForSelector('text=Enter the effective date.')
    await conduct.locator('[data-testid=policy-effective-input]').fill(isoDay(10))
    await conduct.locator('[data-testid=policy-file]').setInputFiles(upload('conduct-v2.pdf'))
    await conduct.locator('[data-testid=policy-publish-submit]').click()
    await page.waitForSelector('text=Everyone must acknowledge it again')
    assert.equal(state.policies.find((p) => p.policy_id === 'p-conduct').versions.length, 2)
    assert.deepEqual(errors, [])
  }, { state })
})

test('HR: coverage shows counts and, on request, who has and has not acknowledged (names)', opts, () =>
  app(ANNA, async ({ page, mock }) => {
    await go(page, mock, '/documents?tab=hr&section=coverage', '[data-testid=hr-coverage]')
    await page.waitForSelector('[data-testid=coverage-row]')
    assert.match(await text(page, '[data-testid=coverage-eligible]'), /4 eligible employees/)
    const conduct = page.locator('[data-testid=coverage-row][data-policy-id=p-conduct]')
    assert.match(await conduct.locator('[data-testid=coverage-counts]').innerText(), /2 acknowledged - 2 outstanding - 50%/)
    await conduct.locator('[data-testid=coverage-names]').click()
    await page.waitForSelector('[data-testid=coverage-detail] [data-testid=outstanding-list]')
    assert.deepEqual(await page.$$eval('[data-testid=outstanding-person] strong', (e) => e.map((x) => x.textContent)), ['Ben Cruz', 'Dan Ocampo'])
    assert.deepEqual(await page.$$eval('[data-testid=acknowledged-person] strong', (e) => e.map((x) => x.textContent)), ['Anna Reyes', 'Carla Dizon'])
    const remote = page.locator('[data-testid=coverage-row][data-policy-id=p-remote]')
    assert.match(await remote.locator('[data-testid=coverage-counts]').innerText(), /0 acknowledged - 4 outstanding/)
    await remote.locator('[data-testid=coverage-names]').click()
    await remote.locator('[data-testid=acknowledged-none]').waitFor()
  }))

test('HR: the document-type catalog - add, edit, deactivate, a used type cannot be deleted', opts, async () => {
  const state = createState()
  await app(ANNA, async ({ page, mock, errors }) => {
    await go(page, mock, '/documents?tab=hr&section=types', '[data-testid=hr-types]')
    await page.waitForSelector('[data-testid=type-rows]')
    assert.match(await text(page, '[data-testid=types-note]'), /HR can add, change or deactivate them/)
    assert.doesNotMatch(await text(page, '[data-testid=types-note]'), /Placeholder|company policy/)
    const rowOf = (name) => page.locator('[data-testid=type-row]', { hasText: name })
    assert.match(await rowOf('Identification').innerText(), /Expiry required/)
    assert.doesNotMatch(await rowOf('Identification').innerText(), /Placeholder/)
    assert.match(await rowOf('Old form').innerText(), /Inactive/)
    assert.match(await rowOf('Disciplinary record').innerText(), /HR only/)

    await page.click('[data-testid=type-new-open]')
    await page.click('[data-testid=type-submit]')
    await page.waitForSelector('text=Enter a name.')
    await page.fill('[data-testid=type-name-input]', 'Identification')
    await page.click('[data-testid=type-submit]')
    await page.waitForSelector('text=A type with this name already exists')
    await page.fill('[data-testid=type-name-input]', 'Work visa')
    await page.check('[data-testid=type-expiry-input]')
    await page.click('[data-testid=type-submit]')
    await rowOf('Work visa').waitFor()
    assert.match(await rowOf('Work visa').innerText(), /Expiry required/)

    await rowOf('Work visa').locator('[data-testid=type-edit]').click()
    await page.fill('[data-testid=type-form] [data-testid=type-name-input]', 'Work visa (renamed)')
    await page.click('[data-testid=type-form] [data-testid=type-submit]')
    await rowOf('Work visa (renamed)').waitFor()
    await rowOf('Work visa (renamed)').locator('[data-testid=type-toggle]').click()
    await page.waitForFunction(() => [...document.querySelectorAll('[data-testid=type-row][data-active=no]')].some((r) => r.textContent.includes('Work visa')))

    await rowOf('Identification').locator('[data-testid=type-delete]').click()
    await rowOf('Identification').locator('[data-testid=type-error]').waitFor()
    assert.match(await rowOf('Identification').locator('[data-testid=type-error]').innerText(), /used by documents[\s\S]*Deactivate/)
    await rowOf('Work visa (renamed)').locator('[data-testid=type-delete]').click()
    await page.waitForFunction(() => !/Work visa/.test(document.querySelector('[data-testid=type-rows]')?.textContent || ''))
    assert.deepEqual(errors, [])
  }, { state })
})

test('HR sections: each one shows an honest forbidden message if the server refuses (coverage, types)', opts, async () => {
  const state = createState()
  state.forced['GET /documents/policies/coverage'] = { status: 403, body: { detail: 'You do not have access to this resource' } }
  state.forced['GET /documents/types'] = { status: 403, body: { detail: 'You do not have access to this resource' } }
  await app(ANNA, async ({ page, mock }) => {
    await go(page, mock, '/documents?tab=hr&section=coverage', '[data-testid=hr-coverage]')
    await page.waitForSelector('[data-testid=coverage-error]')
    assert.match(await text(page, '[data-testid=coverage-error]'), /Coverage is for HR only/)
    await page.click('[data-testid=hr-section-types]')
    await page.waitForSelector('[data-testid=types-error]')
    assert.match(await text(page, '[data-testid=types-error]'), /catalog is for HR only/)
    assert.equal(new URL(page.url()).searchParams.get('section'), 'types')
  }, { state })
})

// ------------------------------------------------------------------------------------------------ gating
test('non-HR: no HR tab, and a forced ?tab=hr falls back to My documents without calling any HR route', opts, async () => {
  const state = createState()
  await app(BEN, async ({ page, mock }) => {
    await go(page, mock, '/documents?tab=hr&section=coverage')
    assert.equal(await page.getAttribute('[data-testid=documents-page]', 'data-tab'), 'mine')
    assert.equal(await page.locator('[data-testid=tab-hr]').count(), 0)
    await waitRows(page)
    assert.equal(state.log.filter((l) => /coverage|include_inactive/.test(l)).length, 0)
    assert.deepEqual((await page.$$eval('[data-testid=tab-mine], [data-testid=tab-policies]', (els) => els.map((e) => e.getAttribute('aria-selected')))), ['true', 'false'])
  }, { state })
})
