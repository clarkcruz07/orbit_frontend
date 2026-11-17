// Shared helpers for the real-backend suites: API seeding (through the proxy, like the browser), UI actions,
// and polling waits. Everything is fictional demo data; receipts are the synthetic fixtures only.
import fs from 'node:fs'
import { demoPassword, receiptPath, signInReal } from './real-backend.mjs'

// ------------------------------------------------------------------------------------------------ API (node fetch)
export async function apiLogin(origin, email) {
  const r = await fetch(`${origin}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: demoPassword() }),
  })
  if (!r.ok) throw new Error(`login failed for ${email}: ${r.status}`)
  return (await r.json()).access_token
}

export async function apiCall(origin, token, method, path, body) {
  const r = await fetch(`${origin}/api${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  let json = null
  try {
    json = await r.json()
  } catch {
    /* no body */
  }
  return { status: r.status, json }
}

export async function apiCreate(origin, token, purpose) {
  const { status, json } = await apiCall(origin, token, 'POST', '/reimbursements', { purpose })
  if (status !== 201) throw new Error(`create failed: ${status}`)
  return json.request_id
}

export async function apiUpload(origin, token, id, fixture, contentType = fixture.endsWith('.pdf') ? 'application/pdf' : 'image/png') {
  const form = new FormData()
  form.append('file', new Blob([fs.readFileSync(receiptPath(fixture))], { type: contentType }), fixture)
  const r = await fetch(`${origin}/api/reimbursements/${id}/receipts`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form })
  if (r.status !== 201) throw new Error(`upload failed: ${r.status}`)
  return r.json()
}

export const apiSubmit = (origin, token, id) => apiCall(origin, token, 'POST', `/reimbursements/${id}/submit`, { confirm_fields: true })
export const apiDecide = (origin, token, id, action, comment) => apiCall(origin, token, 'POST', `/reimbursements/${id}/decision`, { action, comment })

/** A submitted request (waiting for the manager) created entirely through the API. */
export async function seedSubmitted(origin, email, purpose, fixture = 'receipt_full.png') {
  const token = await apiLogin(origin, email)
  const id = await apiCreate(origin, token, purpose)
  await apiUpload(origin, token, id, fixture)
  const s = await apiSubmit(origin, token, id)
  if (s.status !== 200) throw new Error(`submit failed: ${s.status} ${JSON.stringify(s.json)}`)
  return id
}

export async function seedDraft(origin, email, purpose, fixture) {
  const token = await apiLogin(origin, email)
  const id = await apiCreate(origin, token, purpose)
  if (fixture) await apiUpload(origin, token, id, fixture)
  return id
}

// ------------------------------------------------------------------------------------------------ browser actors
export async function actor(browser, origin, email, viewport = { width: 1448, height: 1000 }) {
  const ctx = await browser.newContext({ viewport, acceptDownloads: true })
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e)))
  await signInReal(page, origin, email)
  await page.waitForSelector('.app-content')
  return { ctx, page, origin, pageErrors, close: () => ctx.close() }
}

export async function pageToken(page) {
  return page.evaluate(() => localStorage.getItem('people.accessToken'))
}

/** Direct API call made by the signed-in page's own session (Bearer from its localStorage). */
export async function pageApi(page, origin, method, path, data) {
  const token = await pageToken(page)
  const res = await page.request.fetch(`${origin}/api${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(data ? { 'Content-Type': 'application/json' } : {}) },
    data: data ? JSON.stringify(data) : undefined,
  })
  let json = null
  try {
    json = await res.json()
  } catch {
    /* no body */
  }
  return { status: res.status(), json }
}

export async function waitText(page, selector, re, timeout = 15000) {
  await page.waitForFunction(([s, src, flags]) => new RegExp(src, flags).test(document.querySelector(s)?.textContent || ''), [selector, re.source, re.flags], { timeout })
}

export async function waitValue(page, selector, value, timeout = 15000) {
  await page.waitForFunction(([s, v]) => document.querySelector(s)?.value === v, [selector, value], { timeout })
}

export async function waitGone(page, selector, timeout = 15000) {
  await page.waitForFunction((s) => !document.querySelector(s), selector, { timeout })
}

export const text = (page, selector) => page.locator(selector).innerText()

export async function openRequest(page, origin, id) {
  await page.goto(`${origin}/reimbursements/${id}`)
  await page.waitForSelector('[data-testid=reimb-detail], [data-testid=detail-missing]')
}

export async function uiCreate(page, origin, purpose) {
  await page.goto(`${origin}/reimbursements/new`)
  await page.fill('[data-testid=purpose-input]', purpose)
  await page.click('[data-testid=create-draft]')
  await page.waitForURL(/\/reimbursements\/[0-9a-f-]{36}$/)
  await page.waitForSelector('[data-testid=reimb-detail][data-mode=editor]')
  return page.url().split('/').pop()
}

/** Picks a receipt through the real file input; resolves with the HTTP status of the upload request. */
export async function uiUpload(page, file) {
  const payload = typeof file === 'string' ? receiptPath(file) : file
  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'POST' && /\/receipts$/.test(new URL(r.url()).pathname)),
    page.setInputFiles('[data-testid=receipt-input]', payload),
  ])
  await waitGone(page, '[data-testid=upload-status]')
  return resp.status()
}

export async function uiSubmit(page) {
  await page.check('[data-testid=confirm-check]')
  await page.click('[data-testid=submit-request]')
  await page.waitForSelector('[data-testid=reimb-detail][data-mode=readonly]')
}

/** Create + upload + submit entirely through the UI. Returns the request id. */
export async function uiSubmitFull(page, origin, purpose, fixture = 'receipt_full.png') {
  const id = await uiCreate(page, origin, purpose)
  const status = await uiUpload(page, fixture)
  if (status !== 201) throw new Error(`upload returned ${status}`)
  await page.waitForSelector('[data-testid=extraction-banner]')
  await uiSubmit(page)
  return id
}

export async function uiDecide(page, action, comment) {
  await page.waitForSelector('[data-testid=reviewer-panel]')
  if (comment) await page.fill('[data-testid=review-comment]', comment)
  await page.click(`[data-testid=review-${action}]`)
  await page.waitForSelector('[data-testid=review-confirm-box]')
  await page.click('[data-testid=review-confirm]')
  await waitGone(page, '[data-testid=reviewer-panel]')
}
