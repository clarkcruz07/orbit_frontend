// Responsive sweep for Attendance & Timesheet: the `attendance` route (every tab and state worth checking) at 1440, 1024,
// 768, 390 and 320 px against the self-contained mock API. Per state and width it asserts:
//   * no horizontal page overflow and no element wider than the viewport (except inside a scroll/clip container that is
//     itself inside the viewport),
//   * the weekly grid and the tables fit their containers without an inner scrollbar,
//   * the sticky header never covers the content,
//   * at <= 768 px every primary control (header buttons, buttons, inputs, selects, tabs, links, icon buttons) is visible,
//     inside the viewport and at least 44 px tall,
//   * on phones the weekly grid is stacked day cards (one card per day), above that it is the table.
// An audit self-check proves the audit can fail. Gated: RUN_BROWSER_TESTS=1. Fictional mock data only.
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { launchBrowser, signIn } from './browser-env.mjs'
import { EMAIL, seedDemoData, startTimesheetMock } from './timesheet-mock-api.mjs'

const enabled = process.env.RUN_BROWSER_TESTS === '1'
const opts = { skip: enabled ? false : 'set RUN_BROWSER_TESTS=1 to run real-browser tests' }
let browser
before(async () => {
  if (enabled) browser = await launchBrowser()
})
after(async () => {
  await browser?.close()
})

const WIDTHS = [1440, 1024, 768, 390, 320]
const HEIGHT = (w) => (w >= 1024 ? 900 : w >= 768 ? 1024 : 800)
const LONG = 'Supercalifragilisticexpialidocious-Timesheet-Code-Name-Without-Any-Spaces-0123456789'
const WEEK = '2026-11-16'

function seed(mock) {
  seedDemoData(mock)
  const s = mock.state
  s.codes.push({ code_id: 'TC-LONG', name: LONG, billable: true, active: true, version: 1, placeholder: true })
  // Jamie's current week has the long-named code on it plus an invalid-looking comment-free state.
  s.sheets[`EMP-0005_${WEEK}`].rows.push({ code_id: 'TC-LONG', hours: { '2026-11-20': 1.25 } })
  // A rejected week with a long, unbroken comment.
  s.sheets['EMP-0005_2026-11-02'] = {
    status: 'rejected',
    version: 4,
    submitted_at: '2026-11-06T09:00:00.000+00:00',
    rows: [{ code_id: 'TC-GENERAL', hours: { '2026-11-02': 8, '2026-11-03': 8 } }],
    decisions: [{ decision_id: 'd-9', action: 'reject', by: { name: 'Miguel Santos' }, at: '2026-11-07T01:00:00.000+00:00', comment: `Please check ${LONG}${LONG}`, approver_kind: 'manager', submission_no: 1 }],
  }
  // Lia: a punch left open for days -> the flagged state.
  s.sessions.push({ session_id: '9d1e0000-0000-4000-8000-0000000000a1', user_id: 'u-lia', day: '2026-11-14', clock_in: '2026-11-14T01:00:00.000+00:00', clock_out: null, status: 'open', correction_id: null })
  // A correction with a long reason, pending for Miguel to decide.
  s.corrections.push({
    correction_id: 'c-long', employee: { employee_id: 'EMP-0005', name: 'Jamie Dela Cruz' }, day: '2026-11-12', clock_in: '', clock_out: '', local_clock_in: '22:00', local_clock_out: '06:00', clock_out_next_day: true, hours: 8, timezone: 'Asia/Manila', session_id: null,
    reason: `${LONG} ${LONG}`, status: 'pending', submitted_at: '2026-11-13T02:00:00.000+00:00', decided_at: null, decision: null, version: 1,
  })
  return s
}

/** Runs inside the page: returns the problems found for the current screen at the current width. */
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

  // Grids and tables fit without an inner scrollbar.
  for (const el of document.querySelectorAll('.ts-grid-wrap, .ts-table-card')) {
    if (hiddenByAncestor(el)) continue
    if (el.scrollWidth > el.clientWidth + 1) note('inner horizontal scroll', el, `${el.scrollWidth} > ${el.clientWidth}`)
  }

  const header = document.querySelector('.topbar')
  if (header) {
    const hb = header.getBoundingClientRect()
    const h1 = document.querySelector('.app-content h1')
    if (h1 && h1.getBoundingClientRect().top < hb.bottom - 1) note('title under header', h1)
  }

  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('.sr-only, svg')) continue
    if (hiddenByAncestor(el)) continue
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
    if (own && parseFloat(getComputedStyle(el).fontSize) < 11) note('text smaller than 11px', el, getComputedStyle(el).fontSize)
  }
  for (const el of document.querySelectorAll('button, .btn, .ts-pill, .ts-tab')) {
    if (hiddenByAncestor(el)) continue
    const cs = getComputedStyle(el)
    if (cs.overflowX === 'visible' && el.scrollWidth > el.clientWidth + 1) note('text spills out', el, `${el.scrollWidth} > ${el.clientWidth}`)
  }

  if (narrow) {
    const targets = [
      ...document.querySelectorAll(
        '.topbar-menu, .topbar-search-toggle, .topbar-search input, [data-testid=bell], .profile-button, .app-content .btn, .app-content .ts-tab, .app-content .ts-icon-btn, .app-content .ts-link, .app-content summary, .app-content select, .app-content textarea, .app-content input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file])',
      ),
    ]
    for (const el of targets) {
      if (!visible(el) || hiddenByAncestor(el)) continue
      const r = el.getBoundingClientRect()
      if (r.height < 43.5) note('target shorter than 44px', el, `${Math.round(r.height * 10) / 10}px`)
      if (r.right > vw + 1 || r.left < -1) note('control outside viewport', el)
    }
    for (const sel of ['.topbar-menu', '[data-testid=bell]', '.profile-button']) {
      const el = document.querySelector(sel)
      if (!el || !visible(el)) problems.push(`missing/hidden control ${sel}`)
    }
  }
  // Layout contract for the weekly grid.
  const grid = document.querySelector('[data-testid=sheet-grid]')
  if (grid) {
    const layout = grid.getAttribute('data-layout')
    if (phone && layout !== 'stacked') problems.push(`grid should be stacked on phones, is ${layout}`)
    if (!phone && layout !== 'table') problems.push(`grid should be a table above phones, is ${layout}`)
    if (phone && document.querySelectorAll('[data-testid=day-stack]').length !== 7) problems.push('stacked grid should have 7 day cards')
  }
  return problems
}

const STATES = [
  { name: 'today: clocked in, month table/cards', as: 'jamie', path: '/attendance', ready: '[data-testid=month-view]' },
  { name: 'today: flagged session explanation', as: 'lia', path: '/attendance', ready: '[data-testid=flagged-explainer]' },
  { name: 'timesheet: grid with rows and a long code name', as: 'jamie', path: `/attendance?tab=timesheet&week=${WEEK}`, ready: '[data-testid=grid-row][data-code=TC-LONG], [data-testid=day-stack]' },
  { name: 'timesheet: validation messages shown', as: 'jamie', path: `/attendance?tab=timesheet&week=${WEEK}`, ready: '[data-testid=sheet]', act: async (page) => { await page.fill('[data-testid=cell-TC-TRAINING-2026-11-19]', '2.3'); await page.fill('[data-testid=cell-TC-GENERAL-2026-11-19]', '30'); await page.waitForSelector('[data-testid=grid-issues]') } },
  { name: 'timesheet: rejected with a long comment', as: 'jamie', path: '/attendance?tab=timesheet&week=2026-11-02', ready: '[data-testid=status-rejected]' },
  { name: 'timesheet: submitted, read-only', as: 'jamie', path: '/attendance?tab=timesheet&week=2026-11-09', ready: '[data-testid=status-submitted]' },
  { name: 'timesheet: discard confirmation', as: 'jamie', path: `/attendance?tab=timesheet&week=${WEEK}`, ready: '[data-testid=sheet]', act: async (page) => { await page.fill('[data-testid=cell-TC-GENERAL-2026-11-21]', '1'); await page.click('[data-testid=week-next]'); await page.waitForSelector('[data-testid=discard-confirm-box]') } },
  { name: 'corrections: list + open form', as: 'jamie', path: '/attendance?tab=corrections&new=1&day=2026-11-12', ready: '[data-testid=correction-form]' },
  { name: 'corrections: list with entries', as: 'jamie', path: '/attendance?tab=corrections', ready: '[data-testid=corr-row], [data-testid=corr-card]' },
  { name: 'corrections: detail with long reason (owner)', as: 'jamie', path: '/attendance?tab=corrections&id=c-long', ready: '[data-testid=correction-detail]' },
  { name: 'approvals: queue', as: 'miguel', path: '/attendance?tab=approvals', ready: '[data-testid=queue-row], [data-testid=queue-card]' },
  { name: 'approvals: reviewing a timesheet', as: 'miguel', path: `/attendance?tab=timesheet&week=2026-11-09&employee_id=EMP-0005`, ready: '[data-testid=decision-panel]' },
  { name: 'approvals: reviewing a correction', as: 'miguel', path: '/attendance?tab=corrections&id=c-long', ready: '[data-testid=decision-panel]' },
  { name: 'team: hours', as: 'miguel', path: '/attendance?tab=team', ready: '[data-testid=team-row], [data-testid=team-card]' },
  { name: 'team: attendance', as: 'miguel', path: '/attendance?tab=team&view=attendance', ready: '[data-testid=team-att-row], [data-testid=team-att-card]' },
  { name: 'team: a report month', as: 'miguel', path: '/attendance?tab=team&view=attendance&person=EMP-0005', ready: '[data-testid=person-month] [data-testid=month-view]' },
  { name: 'hr: overview and code catalog', as: 'anna', path: '/attendance?tab=hr', ready: '[data-testid=code-row]' },
  { name: 'not available (403 from the server)', as: 'jamie', path: '/attendance?tab=approvals', ready: '[data-testid=ts-not-available]' },
]

for (const width of WIDTHS) {
  test(`responsive @${width}px: every attendance state fits, controls are tappable`, opts, async () => {
    const mock = await startTimesheetMock()
    seed(mock)
    const ctxs = new Map()
    const problems = []
    try {
      const pageFor = async (who) => {
        if (!ctxs.has(who)) {
          const ctx = await browser.newContext({ viewport: { width, height: HEIGHT(width) } })
          const page = await ctx.newPage()
          page.on('pageerror', (e) => problems.push(`[${who}] page error: ${e}`))
          await signIn(page, mock.origin, EMAIL[who])
          await page.waitForSelector('.app-content')
          ctxs.set(who, { ctx, page })
        }
        return ctxs.get(who).page
      }
      for (const st of STATES) {
        const page = await pageFor(st.as)
        await page.goto(`${mock.origin}${st.path}`)
        try {
          await page.waitForSelector(st.ready, { timeout: 15000, state: 'attached' })
          if (st.act) await st.act(page)
        } catch (e) {
          problems.push(`${st.name} (${st.path}): never became ready (${st.ready}) ${String(e).split('\n')[0]}`)
          continue
        }
        await page.evaluate(() => window.scrollTo(0, 0)) // a focused field far down the page may have scrolled it
        await page.waitForTimeout(250)
        const found = await page.evaluate(AUDIT, { narrow: width <= 768, phone: width <= 640 })
        for (const p of found) problems.push(`${st.name} (${st.path}): ${p}`)
      }
    } finally {
      for (const { ctx } of ctxs.values()) await ctx.close()
      await mock.close()
    }
    assert.deepEqual(problems, [], `\n${problems.join('\n')}`)
  })
}

test('responsive audit self-check: it reports sideways overflow, a short tap target and a wrongly laid out grid', opts, async () => {
  const mock = await startTimesheetMock()
  seed(mock)
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } })
  try {
    const page = await ctx.newPage()
    await signIn(page, mock.origin, EMAIL.jamie)
    await page.waitForSelector('.app-content')
    await page.goto(`${mock.origin}/attendance?tab=timesheet&week=${WEEK}`)
    await page.waitForSelector('[data-testid=day-stack]')
    assert.deepEqual(await page.evaluate(AUDIT, { narrow: true, phone: true }), [], 'a clean page reports nothing')
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
      document.querySelector('[data-testid=sheet-grid]').setAttribute('data-layout', 'table')
    })
    const found = (await page.evaluate(AUDIT, { narrow: true, phone: true })).join('\n')
    assert.match(found, /page scrolls sideways/)
    assert.match(found, /wider than viewport: <div data-testid=injected-wide>/)
    assert.match(found, /target shorter than 44px: <button\.btn>/)
    assert.match(found, /grid should be stacked on phones/)
  } finally {
    await ctx.close()
    await mock.close()
  }
})
