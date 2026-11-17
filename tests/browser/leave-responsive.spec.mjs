// Responsive sweep for the Leave routes: every Leave screen and state at 1440, 1024, 768, 390 and 320 px (mock API).
// Per route and width: no horizontal page overflow, nothing wider than the viewport (except inside clipping/scrolling regions),
// header controls clear of each other and of the content, readable type, no text spilling out of buttons/pills, and at <= 768px
// every primary control (buttons, inputs, selects, tabs, radio and checkbox labels) is visible, inside the viewport and >= 44px tall.
// Gated: RUN_BROWSER_TESTS=1 (use `npm run test:browser`). Fictional mock data only.
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { signIn } from './browser-env.mjs'
import { EMPLOYEES, seedRequest, startLeaveMock } from './mock-leave.mjs'
import { ANNA, BEN, CARLA, EMP, enabled, launchBrowser, opts, seedBasic, snapshotDist, TODAY } from './leave-helpers.mjs'

let browser
before(async () => {
  if (enabled) browser = await launchBrowser()
})
after(async () => {
  await browser?.close()
})

const WIDTHS = [1440, 1024, 768, 390, 320]
const HEIGHT = (w) => (w >= 1024 ? 900 : w >= 768 ? 1024 : 800)
const LONG_WORD = 'Supercalifragilisticexpialidocious-Leave-Reason-Without-Any-Spaces-To-Wrap-0123456789'
const LONG_NAME = 'Bartholomew Maximilian Featherstonehaugh-Cholmondeley'
const LONG_DEPT = 'Learning and Organisational Development Operations'

/** Runs inside the page: returns a list of problems for the current screen at the current width. */
const AUDIT = ({ narrow, phone }) => {
  const problems = []
  window.scrollTo(0, 0) // setup steps may have scrolled the page: the header/content checks need the top of the page
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
    if (el.closest('.sr-only, svg *')) continue
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
        if (a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5) note('header controls overlap', parts[i])
      }
    }
  }

  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('.sr-only, svg')) continue
    if (hiddenByAncestor(el)) continue
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
    if (own && parseFloat(getComputedStyle(el).fontSize) < 11) note('text smaller than 11px', el, getComputedStyle(el).fontSize)
  }
  for (const el of document.querySelectorAll('button, .btn, .lv-pill, .lcal-chip')) {
    if (hiddenByAncestor(el)) continue
    const cs = getComputedStyle(el)
    if (el.classList.contains('lcal-chip')) continue // calendar chips truncate with an ellipsis on purpose
    if (cs.overflowX === 'visible' && el.scrollWidth > el.clientWidth + 1) note('text spills out', el, `${el.scrollWidth} > ${el.clientWidth}`)
  }

  // Calendar grid cells clip their chips on purpose; but a chip must never be cut off by the cell's bottom edge without a "+N more".
  for (const cell of document.querySelectorAll('.lcal-cell')) {
    if (hiddenByAncestor(cell)) continue
    const cb = cell.getBoundingClientRect()
    const last = [...cell.querySelectorAll('.lcal-chips > li')].pop()
    if (last && last.getBoundingClientRect().bottom > cb.bottom + 1) note('calendar content cut off by its cell', cell, `date=${cell.dataset.date}`)
  }

  if (narrow) {
    const targets = [
      ...document.querySelectorAll(
        '.topbar-menu, .topbar-search-toggle, .topbar-search input, [data-testid=bell], .profile-button, .app-content .btn, .app-content button, .app-content select, .app-content textarea, .app-content input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]), .lv-radio, .lv-check',
      ),
    ]
    for (const el of targets) {
      if (!visible(el) || hiddenByAncestor(el)) continue
      const r = el.getBoundingClientRect()
      if (r.height < 43.5) note('target shorter than 44px', el, `${Math.round(r.height * 10) / 10}px`)
      if (r.right > vw + 1 || r.left < -1) note('control outside viewport', el)
    }
    if (document.querySelector('.topbar')) {
      for (const sel of ['.topbar-menu', '[data-testid=bell]', '.profile-button']) {
        const el = document.querySelector(sel)
        if (!el || !visible(el)) problems.push(`missing/hidden control ${sel}`)
      }
      const searchEl = phone ? document.querySelector('.topbar-search-toggle') : document.querySelector('.topbar-search input')
      if (!searchEl || !visible(searchEl)) problems.push('search control missing/hidden')
    }
  }
  return problems
}

/** Each entry opens a screen as a user and reaches a state worth auditing. `setup` may drive the page before the audit. */
const SCREENS = (ids) => [
  { name: 'leave overview (balances + requests)', path: '/leave', as: CARLA, ready: '[data-testid=leave-row]' },
  { name: 'leave overview, filtered to nothing', path: '/leave?type=personal&status=approved', as: CARLA, ready: '[data-testid=requests-panel] [data-testid=empty-state]' },
  { name: 'approvals: waiting for my decision', path: '/leave?tab=approvals', as: BEN, ready: '[data-testid=leave-row]' },
  { name: 'approvals: all requests (HR)', path: '/leave?tab=approvals&scope=all', as: ANNA, ready: '[data-testid=requests-panel][data-scope=all] [data-testid=leave-row]' },
  { name: 'team calendar (busy month)', path: '/leave?tab=calendar&month=2026-12', as: ANNA, ready: '[data-testid=lcal-cell]' },
  { name: 'team calendar (current month, today marked)', path: '/leave?tab=calendar', as: BEN, ready: '[data-testid=lcal-cell]' },
  { name: 'team calendar (empty month)', path: '/leave?tab=calendar&month=2027-06', as: CARLA, ready: '[data-testid=lcal-cell]' },
  { name: 'leave settings (HR)', path: '/leave?tab=settings', as: ANNA, ready: '[data-testid=override-row]' },
  {
    name: 'leave settings: add-type form open with errors',
    path: '/leave?tab=settings',
    as: ANNA,
    ready: '[data-testid=type-add]',
    setup: async (page) => {
      await page.click('[data-testid=type-add]')
      await page.click('[data-testid=type-save]')
      await page.waitForSelector('[data-testid=type-name-error]:not(:empty)')
    },
  },
  { name: 'new request (empty)', path: '/leave/new', as: CARLA, ready: '[data-testid=leave-form]' },
  {
    name: 'new request: filled, day count + notes + issues',
    path: '/leave/new',
    as: CARLA,
    ready: '[data-testid=leave-form]',
    setup: async (page) => {
      await page.selectOption('[data-testid=leave-type]', 'vacation')
      await page.fill('[data-testid=leave-start]', '2026-11-27')
      await page.fill('[data-testid=leave-end]', '2026-12-01')
      await page.fill('[data-testid=leave-reason]', LONG_WORD)
      await page.waitForSelector('[data-testid=leave-preview][data-state=valid]')
    },
  },
  {
    name: 'new request: submit refused (field errors + overlap with conflict link)',
    path: '/leave/new',
    as: CARLA,
    ready: '[data-testid=leave-form]',
    setup: async (page) => {
      await page.click('[data-testid=leave-submit]')
      await page.waitForSelector('[data-testid=error-type]:not(:empty)')
      await page.selectOption('[data-testid=leave-type]', 'vacation')
      await page.fill('[data-testid=leave-start]', '2026-11-24')
      await page.fill('[data-testid=leave-end]', '2026-11-26')
      await page.waitForSelector('[data-testid=leave-preview][data-state=issues]')
      await page.click('[data-testid=leave-submit]')
      await page.waitForSelector('[data-testid=conflict-link]')
    },
  },
  { name: 'detail: owner, pending (cancel panel)', path: `/leave/${ids.pending}`, as: CARLA, ready: '[data-testid=leave-detail]' },
  {
    name: 'detail: owner, cancel confirmation open',
    path: `/leave/${ids.pending}`,
    as: CARLA,
    ready: '[data-testid=leave-detail]',
    setup: async (page) => {
      await page.click('[data-testid=leave-cancel]')
      await page.waitForSelector('[data-testid=cancel-confirm-box]')
    },
  },
  { name: 'detail: owner, clarification (edit + resubmit)', path: `/leave/${ids.clarify}`, as: CARLA, ready: '[data-testid=edit-panel]' },
  { name: 'detail: owner, rejected with comment', path: `/leave/${ids.rejected}`, as: CARLA, ready: '[data-testid=leave-detail]' },
  { name: 'detail: approver decision panel', path: `/leave/${ids.pending}`, as: BEN, ready: '[data-testid=decision-panel]' },
  {
    name: 'detail: approver, long comment + confirmation open',
    path: `/leave/${ids.danPending}`,
    as: BEN,
    ready: '[data-testid=decision-panel]',
    setup: async (page) => {
      await page.fill('[data-testid=leave-comment]', `${LONG_WORD} ${LONG_WORD}`)
      await page.click('[data-testid=leave-reject]')
      await page.waitForSelector('[data-testid=decision-confirm-box]')
    },
  },
  { name: 'detail: HR read-only view with long names', path: `/leave/${ids.danPending}`, as: ANNA, ready: '[data-testid=no-actions]' },
  { name: 'detail: not found', path: '/leave/00000000-0000-4000-8000-0000000000ff', as: CARLA, ready: '[data-testid=leave-missing]' },
]

for (const width of WIDTHS) {
  test(`leave responsive @${width}px: every screen fits, the header is clear, controls are tappable`, opts, async () => {
    const mock = await startLeaveMock({ distDir: snapshotDist() })
    const ids = seedBasic(mock.state)
    // Long values: a person, a department, a leave type and a reason without spaces; a crowded day for the calendar.
    const saved = { ...EMPLOYEES['EMP-0004'] }
    EMPLOYEES['EMP-0004'].name = LONG_NAME
    EMPLOYEES['EMP-0004'].department = LONG_DEPT
    mock.state.types.push({ type_id: 'custom-long', name: `Long ${LONG_WORD}`, paid: true, annual_days: 2, requires_reason: false, active: true, placeholder: false, sort_order: 60 })
    seedRequest(mock.state, { employee_id: EMP.carla, type_id: 'custom-long', start_date: '2026-12-17', end_date: '2026-12-18', status: 'approved', reason: LONG_WORD })
    for (const emp of [EMP.anna, EMP.ben, EMP.dan]) seedRequest(mock.state, { employee_id: emp, type_id: 'sick', start_date: '2026-12-08', status: 'approved' })
    for (let i = 0; i < 12; i++) seedRequest(mock.state, { employee_id: EMP.carla, type_id: 'unpaid', start_date: `2027-01-${String(11 + i).padStart(2, '0')}`, status: 'cancelled' })
    mock.state.entitlements.push({ employee_id: EMP.dan, type_id: 'vacation', year: 2026, days: 20 })
    const ctxs = new Map()
    const problems = []
    try {
      const pageFor = async (email) => {
        if (!ctxs.has(email)) {
          const ctx = await browser.newContext({ viewport: { width, height: HEIGHT(width) }, timezoneId: 'UTC', locale: 'en-US' })
          const page = await ctx.newPage()
          await page.clock.setFixedTime(new Date(`${TODAY}T10:00:00Z`))
          page.on('pageerror', (e) => problems.push(`[${email}] page error: ${e}`))
          await signIn(page, mock.origin, email)
          await page.waitForSelector('.app-content')
          ctxs.set(email, { ctx, page })
        }
        return ctxs.get(email).page
      }
      for (const s of SCREENS(ids)) {
        const page = await pageFor(s.as)
        await page.goto(`${mock.origin}${s.path}`)
        try {
          await page.waitForSelector(s.ready, { timeout: 15000, state: 'attached' })
          if (s.setup) await s.setup(page)
        } catch (e) {
          problems.push(`${s.name} (${s.path}): never became ready (${s.ready}) ${String(e).split('\n')[0]}`)
          continue
        }
        await page.waitForTimeout(250)
        const found = await page.evaluate(AUDIT, { narrow: width <= 768, phone: width <= 640 })
        for (const p of found) problems.push(`${s.name} (${s.path}): ${p}`)
      }
    } finally {
      Object.assign(EMPLOYEES['EMP-0004'], saved)
      for (const { ctx } of ctxs.values()) await ctx.close()
      await mock.close()
    }
    assert.deepEqual(problems, [], `\n${problems.join('\n')}`)
  })
}

// The sweep is only worth something if it can fail: inject known defects into a Leave screen and check each is reported.
test('leave responsive audit self-check: it reports sideways overflow and a short tap target', opts, async () => {
  const mock = await startLeaveMock({ distDir: snapshotDist() })
  seedBasic(mock.state)
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, timezoneId: 'UTC' })
  try {
    const page = await ctx.newPage()
    await signIn(page, mock.origin, CARLA)
    await page.goto(`${mock.origin}/leave`)
    await page.waitForSelector('[data-testid=leave-card]')
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
      document.querySelector('.app-content').appendChild(b)
    })
    const found = (await page.evaluate(AUDIT, { narrow: true, phone: true })).join('\n')
    assert.match(found, /page scrolls sideways/)
    assert.match(found, /wider than viewport: <div data-testid=injected-wide>/)
    assert.match(found, /target shorter than 44px: <button\.btn>/)
  } finally {
    await ctx.close()
    await mock.close()
  }
})
