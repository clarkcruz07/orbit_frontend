// Responsive sweep for the Documents and HR Requests routes: every route (and the open forms inside them) at 1440, 1024,
// 768, 390 and 320 px against the self-contained mock (documents-mock.mjs), with deliberately awkward data (very long
// unbroken titles, file names, names, subjects, messages). Per route and width it asserts:
//   * no horizontal page overflow and no element wider than the viewport (except inside scrolling/clipping regions),
//   * the sticky header never covers content and its controls never overlap,
//   * no text smaller than 11px and no text spilling out of buttons and pills,
//   * at <= 768px every primary control (header controls, buttons, tabs, inputs, selects, textareas) is visible,
//     inside the viewport and at least 44px tall.
// Gated: RUN_BROWSER_TESTS=1 (use `npm run test:browser`). Fictional mock data only.
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { distDir, signIn } from './browser-env.mjs'
import { startMock } from './mock-api.mjs'
import { ANNA, CARLA, FIXED_NOW, enabled, launchBrowser, opts } from './mock-helpers.mjs'
import { createState, installModuleMock, isoDay } from './documents-mock.mjs'

let browser
before(async () => {
  if (enabled) browser = await launchBrowser()
})
after(async () => {
  await browser?.close()
})

const WIDTHS = [1440, 1024, 768, 390, 320]
const HEIGHT = (w) => (w >= 1024 ? 900 : w >= 768 ? 1024 : 800)
const LONG_WORD = 'Supercalifragilisticexpialidocious-Document-Title-Without-Any-Spaces-To-Wrap-0123456789'
const LONG_FILE = 'a-really-long-file-name-that-should-wrap-nicely-on-a-phone-without-breaking-the-page-layout.pdf'
const LONG_NAME = 'Bartholomew Maximilian Featherstonehaugh-Cholmondeley'

function seed(state) {
  state.people['EMP-0031'] = { employee_id: 'EMP-0031', name: LONG_NAME, department: 'Learning & Development and Other Long Department Names', job_title: 'Senior Vice President of Extraordinarily Long Job Titles' }
  const cur = { version: 1, expires_on: isoDay(9), file: { filename: LONG_FILE, content_type: 'application/pdf', size_bytes: 123456, sha256: 'a'.repeat(64) }, uploaded_by: { user_id: 'u-carla', name: 'Carla Dizon' }, uploaded_at: new Date(FIXED_NOW).toISOString() }
  state.docs.unshift({ doc_id: 'd-long', employee_id: 'EMP-0003', type_id: 'ty-cert', title: LONG_WORD, created_at: cur.uploaded_at, versions: [cur] })
  state.docs.unshift({ doc_id: 'd-long-hr', employee_id: 'EMP-0031', type_id: 'ty-id', title: `${LONG_WORD}-for-HR`, created_at: cur.uploaded_at, versions: [{ ...cur, expires_on: isoDay(-3), uploaded_by: { user_id: 'u-anna', name: 'Anna Reyes' } }] })
  for (let i = 1; i <= 24; i++) state.docs.push({ doc_id: `d-bulk-${i}`, employee_id: 'EMP-0003', type_id: 'ty-contract', title: `Bulk document ${i}`, created_at: cur.uploaded_at, versions: [{ ...cur, expires_on: null }] })
  state.policies[0].versions[1].title = `Remote work guidelines ${LONG_WORD}`
  state.policies[0].versions[1].file.filename = LONG_FILE
  state.eligible.push({ employee_id: 'EMP-0031', name: LONG_NAME, department: 'Learning & Development and Other Long Department Names' })
  const msg = (id, who, role, text, minutes, attachment = null, desc = false) => ({ message_id: id, by: { user_id: who.user_id, name: who.name, role }, at: new Date(FIXED_NOW.getTime() + minutes * 60000).toISOString(), text, is_description: desc, attachment })
  const carla = { user_id: 'u-carla', name: 'Carla Dizon' }
  const longName = { user_id: 'u-x', name: LONG_NAME }
  state.cases.unshift({
    case_id: 'c-long',
    employee_id: 'EMP-0031',
    type_id: 'ct-equip',
    subject: `${LONG_WORD} subject line that keeps going and going`,
    priority: 'high',
    status: 'waiting_on_employee',
    assignee: { user_id: 'u-anna', name: 'Anna Reyes' },
    created_at: new Date(FIXED_NOW.getTime() - 3600000).toISOString(),
    updated_at: new Date(FIXED_NOW.getTime() - 60000).toISOString(),
    resolved_at: null,
    closed_at: null,
    version: 1,
    messages: [
      msg('lm1', longName, 'employee', `${LONG_WORD}${LONG_WORD} then more text ${'wrapping words '.repeat(30)}`, -60, { attachment_id: 'la', filename: LONG_FILE, content_type: 'application/pdf', size_bytes: 99999, sha256: 'b'.repeat(64) }, true),
      msg('lm2', { user_id: 'u-anna', name: 'Anna Reyes' }, 'hr', 'Thank you. Could you confirm which model you need?', -1),
    ],
  })
  state.cases.unshift({
    case_id: 'c-carla-long',
    employee_id: 'EMP-0003',
    type_id: 'ct-gen',
    subject: `${LONG_WORD} subject line that keeps going and going`,
    priority: 'medium',
    status: 'waiting_on_employee',
    assignee: null,
    created_at: new Date(FIXED_NOW.getTime() - 3600000).toISOString(),
    updated_at: new Date(FIXED_NOW.getTime() - 30000).toISOString(),
    resolved_at: null,
    closed_at: null,
    version: 1,
    messages: [msg('cm1', carla, 'employee', `${LONG_WORD}${LONG_WORD} then more text ${'wrapping words '.repeat(30)}`, -60, { attachment_id: 'ca', filename: LONG_FILE, content_type: 'application/pdf', size_bytes: 99999, sha256: 'c'.repeat(64) }, true), msg('cm2', { user_id: 'u-anna', name: 'Anna Reyes' }, 'hr', 'Could you confirm the details?', -1)],
  })
}

const click = (sel) => async (page) => page.click(sel)
const ROUTES = [
  { name: 'documents: my documents (long names, 26 rows)', path: '/documents', as: CARLA, ready: '[data-testid=doc-rows]' },
  { name: 'documents: upload form open', path: '/documents', as: CARLA, ready: '[data-testid=doc-rows]', prepare: async (page) => { await page.click('[data-testid=upload-open]'); await page.selectOption('[data-testid=upload-type]', 'ty-id'); await page.click('[data-testid=upload-submit]') } },
  { name: 'documents: details, versions, new version and edit forms open', path: '/documents', as: CARLA, ready: '[data-testid=doc-rows]', prepare: async (page) => { const r = page.locator('[data-testid=doc-row][data-doc-id=d-none]'); await r.locator('[data-testid=doc-details]').click(); await r.locator('[data-testid=version-list]').waitFor(); await r.locator('[data-testid=doc-new-version]').click(); await r.locator('[data-testid=version-submit]').click() } },
  { name: 'documents: edit form open', path: '/documents', as: CARLA, ready: '[data-testid=doc-rows]', prepare: async (page) => { const r = page.locator('[data-testid=doc-row][data-doc-id=d-long]'); await r.locator('[data-testid=doc-details]').click(); await r.locator('[data-testid=doc-edit]').click() } },
  { name: 'documents: policies (long title, acknowledge confirmation)', path: '/documents?tab=policies', as: CARLA, ready: '[data-testid=policy-rows]', prepare: async (page) => { await page.locator('[data-testid=policy-row][data-policy-id=p-remote] [data-testid=policy-acknowledge]').click() } },
  { name: 'documents: policy deep link', path: '/documents/policies/p-conduct', as: CARLA, ready: '[data-testid=policy-row]' },
  { name: 'documents: HR employees (everyone)', path: '/documents?tab=hr', as: ANNA, ready: '[data-testid=doc-rows]' },
  { name: 'documents: HR employee picked, upload on behalf open', path: '/documents?tab=hr', as: ANNA, ready: '[data-testid=doc-rows]', prepare: async (page) => { await page.fill('[data-testid=employee-search]', 'Carla'); await page.click('[data-testid=employee-result]'); await page.waitForSelector('[data-testid=upload-open]'); await page.click('[data-testid=upload-open]') } },
  { name: 'documents: HR expiring', path: '/documents?tab=hr&section=expiring', as: ANNA, ready: '[data-testid=expiring-rows]' },
  { name: 'documents: HR publish (form open)', path: '/documents?tab=hr&section=publish', as: ANNA, ready: '[data-testid=publish-rows]', prepare: async (page) => { await page.click('[data-testid=policy-new-open]'); await page.click('[data-testid=policy-publish-submit]') } },
  { name: 'documents: HR coverage (names open)', path: '/documents?tab=hr&section=coverage', as: ANNA, ready: '[data-testid=coverage-rows]', prepare: async (page) => { await page.locator('[data-testid=coverage-row][data-policy-id=p-remote] [data-testid=coverage-names]').click(); await page.waitForSelector('[data-testid=outstanding-list]') } },
  { name: 'documents: HR types (form open)', path: '/documents?tab=hr&section=types', as: ANNA, ready: '[data-testid=type-rows]', prepare: click('[data-testid=type-new-open]') },
  { name: 'hr-requests: landing, My requests (long subject)', path: '/hr-requests', as: CARLA, ready: '[data-testid=case-rows]' },
  { name: 'hr-requests: landing, HR queue with controls', path: '/hr-requests?tab=queue', as: ANNA, ready: '[data-testid=queue-panel] [data-testid=case-row]' },
  { name: 'hr-requests: new request (errors shown)', path: '/hr-requests/new', as: CARLA, ready: '[data-testid=new-case-form]', prepare: click('[data-testid=case-submit]') },
  { name: 'hr-requests: case thread, employee (long text and file name)', path: '/hr-requests/cases/c-carla-long', as: CARLA, ready: '[data-testid=thread]' },
  { name: 'hr-requests: case thread, HR with controls', path: '/hr-requests/cases/c-long', as: ANNA, ready: '[data-testid=thread]' },
  { name: 'hr-requests: case, resolved with close confirmation', path: '/hr-requests/cases/c-done', as: CARLA, ready: '[data-testid=thread]', prepare: click('[data-testid=close-case]') },
  { name: 'hr-requests: case not found', path: '/hr-requests/cases/c-nope', as: CARLA, ready: '[data-testid=case-missing]' },
]

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
  if (document.documentElement.scrollWidth > vw + 1) problems.push(`page scrolls sideways: scrollWidth ${document.documentElement.scrollWidth} > ${vw}`)
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('.sr-only, .dc-visually-hidden, svg *')) continue
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
  // content stays inside its own card (long unbroken words must wrap, not poke out of the card)
  for (const card of document.querySelectorAll('.app-content .card, .app-content .dc-row, .app-content .hc-msg')) {
    if (hiddenByAncestor(card)) continue
    const cr = card.getBoundingClientRect()
    for (const el of card.querySelectorAll('strong, p, a, span, h2, h3, dd, li')) {
      if (el.closest('svg') || hiddenByAncestor(el)) continue
      const r = el.getBoundingClientRect()
      if (r.width === 0) continue
      if (r.right > cr.right + 1 || r.left < cr.left - 1) {
        note('sticks out of its card', el, `card ${Math.round(cr.left)}-${Math.round(cr.right)} el ${Math.round(r.left)}-${Math.round(r.right)}`)
        break
      }
    }
  }
  const header = document.querySelector('.topbar')
  if (header) {
    const hb = header.getBoundingClientRect()
    const main = document.querySelector('.app-content')
    if (main && main.getBoundingClientRect().top < hb.bottom - 1) note('content under header', main)
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
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('.sr-only, .dc-visually-hidden, svg')) continue
    if (hiddenByAncestor(el)) continue
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
    if (own && parseFloat(getComputedStyle(el).fontSize) < 11) note('text smaller than 11px', el, getComputedStyle(el).fontSize)
  }
  for (const el of document.querySelectorAll('button, .btn, .dc-pill, .hc-role')) {
    if (hiddenByAncestor(el)) continue
    const cs = getComputedStyle(el)
    if (cs.overflowX === 'visible' && el.scrollWidth > el.clientWidth + 1) note('text spills out', el, `${el.scrollWidth} > ${el.clientWidth}`)
  }
  if (narrow) {
    const targets = [...document.querySelectorAll('.topbar-menu, .topbar-search-toggle, .topbar-search input, [data-testid=bell], .profile-button, .app-content .btn, .app-content .dc-tab, .app-content .dc-subtab, .app-content .dc-result, .app-content .hc-linkcard, .app-content .hc-back-link, .app-content input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]), .app-content select, .app-content textarea')]
    for (const el of targets) {
      if (!visible(el) || hiddenByAncestor(el)) continue
      const r = el.getBoundingClientRect()
      if (r.height < 43.5) note('target shorter than 44px', el, `${Math.round(r.height * 10) / 10}px`)
      if (r.right > vw + 1 || r.left < -1) note('control outside viewport', el)
    }
    // links inside rows (case titles) are text links: their row-level target must be large enough to tap
    for (const el of document.querySelectorAll('.app-content .hc-row-link')) {
      if (!visible(el) || hiddenByAncestor(el)) continue
      const r = el.getBoundingClientRect()
      if (r.height < 20) note('link text too small to tap', el, `${Math.round(r.height)}px`)
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

for (const width of WIDTHS) {
  test(`responsive @${width}px: Documents and HR Requests routes fit, are tappable and wrap long content`, opts, async () => {
    const mock = await startMock({ distDir })
    mock.state.newApi.now = FIXED_NOW
    const problems = []
    const ctxs = new Map()
    try {
      const pageFor = async (email) => {
        if (!ctxs.has(email)) {
          const state = createState()
          seed(state)
          const ctx = await browser.newContext({ viewport: { width, height: HEIGHT(width) } })
          const page = await ctx.newPage()
          await page.clock.setFixedTime(FIXED_NOW)
          page.on('pageerror', (e) => problems.push(`[${email}] page error: ${e}`))
          await installModuleMock(page, state)
          await signIn(page, mock.origin, email)
          await page.waitForSelector('.app-content')
          ctxs.set(email, { ctx, page })
        }
        return ctxs.get(email).page
      }
      for (const r of ROUTES) {
        const page = await pageFor(r.as)
        await page.goto(`${mock.origin}${r.path}`)
        try {
          await page.waitForSelector(r.ready, { timeout: 15000, state: 'attached' })
          if (r.prepare) await r.prepare(page)
        } catch (e) {
          problems.push(`${r.name} (${r.path}): never became ready (${String(e.message).split('\n')[0]})`)
          continue
        }
        await page.waitForTimeout(250)
        await page.evaluate(() => window.scrollTo(0, 0)) // prepare steps scroll to their controls; the header checks assume the top of the page
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

// The sweep is only worth something if it can fail: inject known defects and check each is reported.
test('responsive audit self-check (Documents/HR Requests): it reports sideways overflow, a short tap target and text sticking out of a card', opts, async () => {
  const mock = await startMock({ distDir })
  const state = createState()
  seed(state)
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } })
  try {
    const page = await ctx.newPage()
    await installModuleMock(page, state)
    await signIn(page, mock.origin, CARLA)
    await page.waitForSelector('.app-content')
    await page.goto(`${mock.origin}/documents`)
    await page.waitForSelector('[data-testid=doc-rows]')
    await page.waitForTimeout(250)
    assert.deepEqual(await page.evaluate(AUDIT, { narrow: true, phone: true }), [])
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
      b.onclick = () => undefined
      document.querySelector('.app-content').appendChild(b)
      const title = document.querySelector('[data-testid=doc-title]')
      title.style.overflowWrap = 'normal'
      title.style.whiteSpace = 'nowrap'
    })
    const found = (await page.evaluate(AUDIT, { narrow: true, phone: true })).join('\n')
    assert.match(found, /page scrolls sideways/)
    assert.match(found, /wider than viewport: <div data-testid=injected-wide>/)
    assert.match(found, /target shorter than 44px: <button\.btn>/)
    assert.match(found, /sticks out of its card|wider than viewport/)
  } finally {
    await ctx.close()
    await mock.close()
  }
})
