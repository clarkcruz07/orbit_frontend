// Responsive sweep (addendum 2 section 4): EVERY route at 1440, 1024, 768, 390 and 320 px against the mock API.
// Per route and width it asserts:
//   * no horizontal page overflow and no element wider than the viewport (except inside intentionally scrolling or
//     clipping regions, and the closed off-canvas drawer),
//   * the fixed/sticky header never covers content and its own controls never overlap,
//   * no text smaller than 11px and no text spilling out of buttons and pills,
//   * at <= 768px every primary control (hamburger, search, bell, profile, buttons, form inputs) is visible,
//     inside the viewport and at least 44px tall.
// Gated: RUN_BROWSER_TESTS=1 (use `npm run test:browser`). Fictional mock data only.
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { distDir } from './browser-env.mjs'
import { startMock } from './mock-api.mjs'
import { ANNA, BEN, CARLA, FIXED_NOW, enabled, launchBrowser, minutesAgo, opts } from './mock-helpers.mjs'
import { addNotification } from './mock-new-endpoints.mjs'
import { blankFields, makeRequest, receiptMeta } from './mock-reimbursements.mjs'
import { signIn } from './browser-env.mjs'

let browser
before(async () => {
  if (enabled) browser = await launchBrowser()
})
after(async () => {
  await browser?.close()
})

const WIDTHS = [1440, 1024, 768, 390, 320]
const HEIGHT = (w) => (w >= 1024 ? 900 : w >= 768 ? 1024 : 800)

const LONG_WORD = 'Supercalifragilisticexpialidocious-Reimbursement-Purpose-Without-Any-Spaces-To-Wrap-0123456789'
const LONG_EMAIL = 'bartholomew.maximilian.featherstonehaugh-cholmondeley@a-very-long-company-domain-name.example.test'

function seed(mock) {
  const fields = blankFields()
  const set = (k, v, src = 'extracted') => {
    fields[k] = { value: v, source: src, extracted_value: v, confidence: 0.95, flag: null }
  }
  set('merchant', 'Cafe Lumina (SYNTHETIC)')
  set('receipt_date', '2026-10-12')
  set('currency', 'PHP')
  set('total_amount', '1250.00')
  const editor = makeRequest({ purpose: LONG_WORD, status: 'draft', fields, receipts: [receiptMeta({ filename: 'a-really-long-receipt-file-name-that-should-wrap-nicely-on-a-phone.png' })] })
  editor.id = 'editor'
  const review = makeRequest({
    purpose: 'Hardware for the training room',
    status: 'pending_manager',
    stage: 'manager',
    fields: JSON.parse(JSON.stringify(fields)),
    receipts: [receiptMeta()],
    allowed: { 'u-ben': ['approve', 'reject', 'clarify'] },
    submitted_at: new Date().toISOString(),
  })
  review.audit = []
  mock.state.reimb.requests.push(editor, review)
  mock.state.newApi.extraEmployees.push({
    employee_id: 'EMP-0031',
    name: 'Bartholomew Maximilian Featherstonehaugh-Cholmondeley',
    job_title: 'Senior Vice President of Extraordinarily Long Job Titles',
    department: 'Learning & Development',
    employment_type: 'contractor',
    manager_id: 'EMP-0002',
    start_date: '2023-05-02',
    birthday: '11-20',
    email: LONG_EMAIL,
    avatar_initials: 'BM',
    status: 'active',
  })
  for (const user of ['u-anna', 'u-ben', 'u-carla']) addNotification(mock.state, user, { title: 'Review needed', body: 'Hardware for the training room is waiting.', link: '/reimbursements', created_at: minutesAgo(3) })
  return { editorId: editor.request_id, reviewId: review.request_id }
}

/** Runs inside the page: returns a list of problems for the current route at the current width. */
const AUDIT = ({ narrow, phone }) => {
  const problems = []
  const vw = document.documentElement.clientWidth
  const note = (kind, el, extra = '') => {
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''
    problems.push(`${kind}: <${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}${el.dataset?.testid ? ` data-testid=${el.dataset.testid}` : ''}> ${extra}`.trim())
  }
  const visible = (el) => {
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) return false
    const cs = getComputedStyle(el)
    return cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0'
  }
  const hiddenByAncestor = (el) => {
    for (let a = el; a && a !== document.body; a = a.parentElement) {
      const cs = getComputedStyle(a)
      if (cs.display === 'none' || cs.visibility === 'hidden') return true
    }
    return false
  }

  // 1. Page-level horizontal overflow.
  if (document.documentElement.scrollWidth > vw + 1) problems.push(`page scrolls sideways: scrollWidth ${document.documentElement.scrollWidth} > ${vw}`)

  // 2. Elements wider than the viewport, unless a clipping/scrolling ancestor keeps them inside it.
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('.sr-only, .r-visually-hidden, svg *')) continue
    if (hiddenByAncestor(el)) continue
    const r = el.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) continue
    if (r.right <= vw + 1 && r.left >= -1) continue
    let clipped = false
    for (let a = el.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
      const cs = getComputedStyle(a)
      if (cs.overflowX !== 'visible') {
        const ar = a.getBoundingClientRect()
        if (ar.right <= vw + 1 && ar.left >= -1) clipped = true
        break
      }
    }
    if (!clipped) note('wider than viewport', el, `left=${Math.round(r.left)} right=${Math.round(r.right)} vw=${vw}`)
  }

  // 3. Fixed/sticky header: content starts below it, and its controls do not overlap.
  const header = document.querySelector('.topbar')
  if (header) {
    const hb = header.getBoundingClientRect()
    const main = document.querySelector('.app-content')
    if (main && main.getBoundingClientRect().top < hb.bottom - 1) note('content under header', main, `top=${Math.round(main.getBoundingClientRect().top)} header bottom=${Math.round(hb.bottom)}`)
    const h1 = document.querySelector('.app-content h1')
    if (h1 && h1.getBoundingClientRect().top < hb.bottom - 1) note('title under header', h1)
    const parts = [...header.querySelectorAll('.topbar-menu, .topbar-search-wrap, .topbar-search-toggle, [data-testid=bell], .profile-button')].filter(visible)
    for (let i = 0; i < parts.length; i++) {
      const a = parts[i].getBoundingClientRect()
      if (a.right > vw + 1 || a.left < -1) note('header control outside viewport', parts[i])
      for (let j = i + 1; j < parts.length; j++) {
        if (parts[i].contains(parts[j]) || parts[j].contains(parts[i])) continue
        const b = parts[j].getBoundingClientRect()
        if (a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5) note('header controls overlap', parts[i], `with ${parts[j].className}`)
      }
    }
  }

  // 4. Readable type and no text spilling out of buttons/pills.
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('.sr-only, .r-visually-hidden, svg')) continue
    if (hiddenByAncestor(el)) continue
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
    if (own && parseFloat(getComputedStyle(el).fontSize) < 11) note('text smaller than 11px', el, getComputedStyle(el).fontSize)
  }
  for (const el of document.querySelectorAll('button, .btn, .r-pill, .pill, .soon-tag, .date-chip')) {
    if (hiddenByAncestor(el)) continue
    const cs = getComputedStyle(el)
    if (cs.overflowX === 'visible' && el.scrollWidth > el.clientWidth + 1) note('text spills out', el, `${el.scrollWidth} > ${el.clientWidth}`)
  }

  // 5. Touch targets on tablets and phones.
  if (narrow) {
    const targets = [...document.querySelectorAll('.topbar-menu, .topbar-search-toggle, .topbar-search input, [data-testid=bell], .profile-button, .app-content .btn, .app-content button.r-tab, .app-content input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]), .app-content select, .app-content textarea, .login-card button, .login-card input:not([type=checkbox]), .login-page button, .login-page input:not([type=checkbox])')]
    for (const el of targets) {
      if (!visible(el) || hiddenByAncestor(el)) continue
      const r = el.getBoundingClientRect()
      if (r.height < 43.5) note('target shorter than 44px', el, `${Math.round(r.height * 10) / 10}px`)
      if (r.right > vw + 1 || r.left < -1) note('control outside viewport', el)
    }
    const must = ['.topbar-menu', '[data-testid=bell]', '.profile-button']
    if (document.querySelector('.topbar')) {
      for (const sel of must) {
        const el = document.querySelector(sel)
        if (!el || !visible(el)) problems.push(`missing/hidden control ${sel}`)
      }
      const searchEl = phone ? document.querySelector('.topbar-search-toggle') : document.querySelector('.topbar-search input')
      if (!searchEl || !visible(searchEl)) problems.push('search control missing/hidden')
    }
  }
  return problems
}

const routes = (ids) => [
  { name: 'dashboard (personal)', path: '/', as: CARLA, ready: '[data-testid=home-my-reimbursements]' },
  { name: 'dashboard (HR)', path: '/', as: ANNA, ready: '[data-testid=card-upcoming]' },
  { name: 'dashboard (personal, as HR)', path: '/my-dashboard', as: ANNA, ready: '[data-testid=home-my-reimbursements]' },
  { name: 'my profile', path: '/my-profile', as: CARLA, ready: '[data-testid=profile-card]' },
  { name: 'directory (basic)', path: '/directory', as: CARLA, ready: '[data-testid=dir-row]' },
  { name: 'directory (HR columns, long names)', path: '/directory?q=bartholomew', as: ANNA, ready: '[data-testid=dir-row]' },
  { name: 'directory/:id (long values)', path: '/directory/EMP-0031', as: ANNA, ready: '[data-testid=dir-profile]' },
  { name: 'leave', path: '/leave', as: CARLA, ready: '[data-testid=leave-page]' },
  { name: 'attendance', path: '/attendance', as: CARLA, ready: '[data-testid=attendance-page]' },
  { name: 'performance', path: '/performance', as: CARLA, ready: '[data-testid=performance-page]' },
  { name: 'learning', path: '/learning', as: CARLA, ready: '[data-testid=learning-page]' },
  { name: 'hr-requests', path: '/hr-requests', as: CARLA, ready: '[data-testid=request-reimbursements]' },
  { name: 'reimbursements list', path: '/reimbursements', as: CARLA, ready: '[data-testid=reimb-list] [data-testid=reimb-row], [data-testid=reimb-list] [data-testid=empty-state]' },
  { name: 'reimbursements new', path: '/reimbursements/new', as: CARLA, ready: '[data-testid=purpose-input]' },
  { name: 'reimbursement editor', path: `/reimbursements/${ids.editorId}`, as: CARLA, ready: '[data-testid=reimb-detail][data-mode=editor]' },
  { name: 'reimbursement review', path: `/reimbursements/${ids.reviewId}`, as: BEN, ready: '[data-testid=reviewer-panel]' },
  // Documents is a real module now (its API is not part of this shared mock, so the page shows its honest error state);
  // its full responsive coverage lives in documents-hrcases-responsive.spec.mjs.
  { name: 'documents', path: '/documents', as: CARLA, ready: '[data-testid=documents-page]' },
  { name: 'company calendar', path: '/company-calendar', as: CARLA, ready: '[data-testid=cal-cell]' },
  { name: 'company calendar (HR, busy month)', path: '/company-calendar?month=2026-11', as: ANNA, ready: '[data-testid=cal-cell]' },
  { name: 'settings', path: '/settings', as: CARLA, ready: '[data-testid=settings-page]' },
  { name: '404', path: '/does-not-exist', as: CARLA, ready: '[data-testid=empty-state]' },
]

for (const width of WIDTHS) {
  test(`responsive @${width}px: every route fits, header is clear, controls are tappable`, opts, async () => {
    const mock = await startMock({ distDir })
    mock.state.newApi.now = FIXED_NOW
    const ids = seed(mock)
    const ctxs = new Map()
    const problems = []
    try {
      const pageFor = async (email) => {
        if (!ctxs.has(email)) {
          const ctx = await browser.newContext({ viewport: { width, height: HEIGHT(width) } })
          const page = await ctx.newPage()
          await page.clock.setFixedTime(FIXED_NOW)
          page.on('pageerror', (e) => problems.push(`[${email}] page error: ${e}`))
          await signIn(page, mock.origin, email)
          await page.waitForSelector('.app-content')
          ctxs.set(email, { ctx, page })
        }
        return ctxs.get(email).page
      }

      // Login page first (anonymous).
      {
        const ctx = await browser.newContext({ viewport: { width, height: HEIGHT(width) } })
        const page = await ctx.newPage()
        await page.goto(`${mock.origin}/login`)
        await page.waitForSelector('#email')
        const found = await page.evaluate(AUDIT, { narrow: width <= 768, phone: width <= 640 })
        for (const p of found) problems.push(`/login: ${p}`)
        await ctx.close()
      }

      for (const r of routes(ids)) {
        const page = await pageFor(r.as)
        await page.goto(`${mock.origin}${r.path}`)
        try {
          await page.waitForSelector(r.ready, { timeout: 15000, state: 'attached' })
        } catch {
          problems.push(`${r.name} (${r.path}): never became ready (${r.ready})`)
          continue
        }
        await page.waitForTimeout(350) // charts, fonts
        const found = await page.evaluate(AUDIT, { narrow: width <= 768, phone: width <= 640 })
        for (const p of found) problems.push(`${r.name} (${r.path}): ${p}`)
      }
    } finally {
      for (const { ctx } of ctxs.values()) await ctx.close()
      await mock.close()
    }
    assert.deepEqual(problems, [], `\n${problems.join('\n')}`)
  })
}

// The sweep is only worth something if it can fail: inject known defects and check each one is reported.
test('responsive audit self-check: it reports sideways overflow, a short tap target and a header overlap', opts, async () => {
  const mock = await startMock({ distDir })
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } })
  try {
    const page = await ctx.newPage()
    await signIn(page, mock.origin, CARLA)
    await page.waitForSelector('[data-testid=home-my-reimbursements]')
    const clean = await page.evaluate(AUDIT, { narrow: true, phone: true })
    assert.deepEqual(clean, [])
    await page.evaluate(() => {
      const wide = document.createElement('div')
      wide.style.cssText = 'width:900px;height:10px;background:red'
      wide.dataset.testid = 'injected-wide'
      document.querySelector('.app-content').appendChild(wide)
      const b = document.createElement('button')
      b.className = 'btn'
      b.style.minHeight = '0'
      b.style.height = '28px'
      b.textContent = 'tiny'
      document.querySelector('.app-content').appendChild(b)
      document.querySelector('.app-content').style.paddingTop = '0'
      document.querySelector('.app-main').style.marginTop = '-30px'
    })
    const found = (await page.evaluate(AUDIT, { narrow: true, phone: true })).join('\n')
    assert.match(found, /page scrolls sideways/)
    assert.match(found, /wider than viewport: <div data-testid=injected-wide>/)
    assert.match(found, /target shorter than 44px: <button\.btn>/)
    assert.match(found, /content under header|title under header/)
  } finally {
    await ctx.close()
    await mock.close()
  }
})
