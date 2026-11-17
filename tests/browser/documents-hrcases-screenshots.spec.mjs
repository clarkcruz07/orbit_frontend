// Screenshots of the Documents and HR Requests modules from a REAL backend run (fictional data, curated through the API
// on a clean stack). Writes docs/screenshots/documents-*.png and hrcases-*.png at desktop 1448, tablet 768 and mobile 390.
// Also runnable alone: RUN_BROWSER_TESTS=1 node --test tests/browser/documents-hrcases-screenshots.spec.mjs
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { launchBrowser } from './browser-env.mjs'
import { PEOPLE, startRealStack } from './real-backend.mjs'
import { actor, apiLogin } from './e2e-helpers.mjs'
import { MIME, isoDaysFromToday, pdf, png, upload } from './documents-fixtures.mjs'
import { apiPublishPolicy, apiUploadDocument, jsonCall, multipart } from './documents-helpers.mjs'

const enabled = process.env.RUN_BROWSER_TESTS === '1'
const opts = { skip: enabled ? false : 'set RUN_BROWSER_TESTS=1 to run real-browser tests' }
const VIEWS = [
  ['desktop-1448', 1448, 1000],
  ['tablet-768', 768, 1024],
  ['mobile-390', 390, 844],
]
const SCREENS = ['documents-my-documents', 'documents-policies', 'documents-hr-documents', 'documents-hr-coverage', 'hrcases-landing', 'hrcases-thread', 'hrcases-queue']
const SCREENSHOT_FILES = SCREENS.flatMap((s) => VIEWS.map(([tag]) => `${s}-${tag}.png`))

let browser
let stack
before(async () => {
  if (!enabled) return
  stack = await startRealStack()
  browser = await launchBrowser()
})
after(async () => {
  await browser?.close()
  await stack?.close()
})

async function seed(origin) {
  const jt = await apiLogin(origin, PEOPLE.jamie)
  const lt = await apiLogin(origin, PEOPLE.lia)
  const at = await apiLogin(origin, PEOPLE.anna)
  // ---- documents
  await apiUploadDocument(origin, jt, { type: 'Identification', title: 'Passport copy', file: upload('passport.png', png(), MIME.png), expires: isoDaysFromToday(400) })
  await apiUploadDocument(origin, jt, { type: 'Certification', title: 'First aid certificate', file: upload('first-aid.pdf', pdf('first-aid'), MIME.pdf), expires: isoDaysFromToday(-35) })
  await apiUploadDocument(origin, jt, { type: 'Certification', title: 'Fire safety training', file: upload('fire-safety.pdf', pdf('fire-safety'), MIME.pdf), expires: isoDaysFromToday(12) })
  const contract = await apiUploadDocument(origin, jt, { type: 'Contract', title: 'Employment contract', file: upload('contract-2024.pdf', pdf('contract-1'), MIME.pdf) })
  await multipart(origin, jt, 'POST', `/documents/employee/${contract.doc_id}/versions`, { file: upload('contract-2026.pdf', pdf('contract-2'), MIME.pdf) })
  await apiUploadDocument(origin, jt, { type: 'Other', title: 'Training attendance record', file: upload('attendance.pdf', pdf('attendance'), MIME.pdf) })
  await apiUploadDocument(origin, lt, { type: 'Identification', title: 'National ID card', file: upload('id.png', png(), MIME.png), expires: isoDaysFromToday(9) })
  // ---- policies
  const conduct = await apiPublishPolicy(origin, at, { title: 'Code of conduct', summary: 'How we treat each other and our clients. Placeholder text, not company policy.', effective: isoDaysFromToday(-60), file: upload('conduct.pdf', pdf('conduct'), MIME.pdf) })
  const remote = await apiPublishPolicy(origin, at, { title: 'Remote work guidelines', summary: 'When and how people may work remotely. Placeholder text, not company policy.', effective: isoDaysFromToday(-20), file: upload('remote-v1.pdf', pdf('remote-1'), MIME.pdf) })
  await multipart(origin, at, 'POST', `/documents/policies/${remote.policy_id}/versions`, { effective_date: isoDaysFromToday(-2), summary: 'Updated expectations for core hours. Placeholder text.', file: upload('remote-v2.pdf', pdf('remote-2'), MIME.pdf) })
  for (const t of [jt, lt]) assert.equal((await jsonCall(origin, t, 'POST', `/documents/policies/${conduct.policy_id}/acknowledge`, { version: 1 })).status, 201)
  // ---- cases
  const types = Object.fromEntries((await jsonCall(origin, jt, 'GET', '/hrcases/types')).json.items.map((t) => [t.name, t.type_id]))
  const open = async (token, type, subject, description, priority, file) => {
    const r = await multipart(origin, token, 'POST', '/hrcases/cases', { type_id: types[type], subject, description, priority, file })
    assert.equal(r.status, 201, JSON.stringify(r.json))
    return r.json
  }
  const annaId = (await jsonCall(origin, at, 'GET', '/auth/me')).json.user_id
  const laptop = await open(jt, 'Equipment', 'Replacement laptop charger', 'My charger stopped working this week. Please could I get a replacement? It is the 65W USB-C model.', 'high', upload('charger-photo.png', png(), MIME.png))
  await jsonCall(origin, at, 'POST', `/hrcases/cases/${laptop.case_id}/assign`, { assignee_user_id: annaId })
  await multipart(origin, at, 'POST', `/hrcases/cases/${laptop.case_id}/messages`, { text: 'Thanks - I have ordered one. It should arrive on Friday. Could you confirm your desk number?', status: 'waiting_on_employee' })
  await multipart(origin, jt, 'POST', `/hrcases/cases/${laptop.case_id}/messages`, { text: 'Desk 14B, second floor. Thank you!', file: upload('desk-plan.pdf', pdf('desk-plan'), MIME.pdf) })
  const coe = await open(jt, 'Certificate of employment', 'Certificate of employment for a visa application', 'I need a certificate of employment for a visa application.', 'low')
  await multipart(origin, at, 'POST', `/hrcases/cases/${coe.case_id}/messages`, { text: 'Which country is the visa for, and by which date do you need it?', status: 'waiting_on_employee' })
  const hours = await open(jt, 'General inquiry', 'Question about the office opening hours', 'Are the office hours changing in December?', 'low')
  await multipart(origin, at, 'POST', `/hrcases/cases/${hours.case_id}/messages`, { text: 'No change - the hours stay the same.', status: 'resolved' })
  await open(lt, 'Profile change', 'Update my emergency contact', 'Please update my emergency contact details. Fictional text.', 'medium')
  await open(lt, 'Payslip / benefit question', 'Benefit statement line', 'I have a question about a line on my benefit statement.', 'high')
  return { laptopId: laptop.case_id, remoteId: remote.policy_id }
}

async function settle(page) {
  await page.evaluate(() => document.fonts?.ready)
  await page.waitForTimeout(500)
}
async function shot(page, outDir, name, cap = 2800) {
  await settle(page)
  const vp = page.viewportSize()
  const h = await page.evaluate(() => document.documentElement.scrollHeight)
  await page.setViewportSize({ width: vp.width, height: Math.min(Math.max(h, vp.height), cap) })
  await page.waitForTimeout(350)
  await page.screenshot({ path: path.join(outDir, name) })
  await page.setViewportSize(vp)
}

test('E2E screenshots: Documents and HR Requests from the real backend (fictional data, 3 widths)', opts, async () => {
  const outDir = path.resolve(process.cwd(), '..', 'docs', 'screenshots')
  fs.mkdirSync(outDir, { recursive: true })
  const { laptopId, remoteId } = await seed(stack.origin)
  const written = []
  for (const [tag, w, h] of VIEWS) {
    const jamie = await actor(browser, stack.origin, PEOPLE.jamie, { width: w, height: h })
    const anna = await actor(browser, stack.origin, PEOPLE.anna, { width: w, height: h })
    const go = async (a, p, ready) => {
      await a.page.goto(`${stack.origin}${p}`)
      await a.page.waitForSelector(ready, { state: 'attached' })
    }
    const take = async (a, screen, cap) => {
      const name = `${screen}-${tag}.png`
      await shot(a.page, outDir, name, cap)
      written.push(name)
    }

    await go(jamie, '/documents', '[data-testid=doc-rows]')
    await jamie.page.locator('[data-testid=doc-row]', { hasText: 'Employment contract' }).locator('[data-testid=doc-details]').click()
    await jamie.page.waitForSelector('[data-testid=version-list]')
    await take(jamie, 'documents-my-documents')

    await go(jamie, '/documents?tab=policies', '[data-testid=policy-rows]')
    await take(jamie, 'documents-policies')

    await go(anna, '/documents?tab=hr', '[data-testid=doc-rows]')
    await anna.page.fill('[data-testid=employee-search]', 'Jamie')
    await anna.page.click('[data-testid=employee-result]')
    await anna.page.waitForSelector('[data-testid=employee-chip]')
    await anna.page.waitForFunction(() => document.querySelector('[data-testid=doc-rows]') && document.querySelectorAll('[data-testid=doc-row]').length >= 5)
    await take(anna, 'documents-hr-documents')

    await go(anna, '/documents?tab=hr&section=coverage', '[data-testid=coverage-row]')
    await anna.page.locator(`[data-testid=coverage-row][data-policy-id="${remoteId}"] [data-testid=coverage-names]`).click()
    await anna.page.waitForSelector('[data-testid=outstanding-list]')
    await take(anna, 'documents-hr-coverage')

    await go(jamie, '/hr-requests', '[data-testid=case-rows]')
    await take(jamie, 'hrcases-landing')

    await go(jamie, `/hr-requests/cases/${laptopId}`, '[data-testid=thread]')
    await jamie.page.waitForFunction(() => document.querySelectorAll('[data-testid=message]').length === 3)
    await take(jamie, 'hrcases-thread')

    await go(anna, '/hr-requests?tab=queue', '[data-testid=queue-panel] [data-testid=case-row]')
    await anna.page.waitForFunction(() => document.querySelectorAll('[data-testid=case-row]').length === 5)
    await take(anna, 'hrcases-queue')

    for (const a of [jamie, anna]) {
      assert.deepEqual(a.pageErrors, [], 'no uncaught page errors')
      await a.close()
    }
  }
  assert.deepEqual([...written].sort(), [...SCREENSHOT_FILES].sort())
  for (const f of SCREENSHOT_FILES) assert.ok(fs.statSync(path.join(outDir, f)).size > 15000, `${f} looks empty`)
})
