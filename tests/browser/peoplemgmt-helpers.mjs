// Shared helpers for the People management + Holidays browser specs (mock API and real backend).
// PEOPLEMGMT_DIST points the suites at a private build while other agents rebuild the shared dist/.
import path from 'node:path'
import { distDir as sharedDist } from './browser-env.mjs'
import { startPeopleMock } from './peoplemgmt-mock.mjs'

export const enabled = process.env.RUN_BROWSER_TESTS === '1'
export const opts = { skip: enabled ? false : 'set RUN_BROWSER_TESTS=1 to run real-browser tests' }
export const dist = process.env.PEOPLEMGMT_DIST ? path.resolve(process.env.PEOPLEMGMT_DIST) : sharedDist
export const SHOT_DIR = process.env.SHOT_DIR ? path.resolve(process.env.SHOT_DIR) : null

export const text = (page, sel) => page.locator(sel).first().innerText()
export const hasText = (page, sel, re, timeout = 15000) =>
  page.waitForFunction(([s, src, flags]) => new RegExp(src, flags).test(document.querySelector(s)?.textContent || ''), [sel, re.source, re.flags], { timeout })
export const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)
export const count = (mock, key) => mock.state.log.filter((l) => l === key).length
export const callsTo = (mock, method, route) => mock.state.calls.filter((c) => c.method === method && c.route === route)

/** A fresh mock + a context whose session token is seeded for `user` (the app restores the session through /auth/me). */
export async function withApp(browser, user, fn, { viewport = { width: 1448, height: 1000 }, setup, extraPeople, acceptDownloads = false } = {}) {
  const mock = await startPeopleMock({ distDir: dist, extraPeople })
  setup?.(mock)
  const ctx = await browser.newContext({ viewport, acceptDownloads })
  await ctx.addInitScript((t) => localStorage.setItem('people.accessToken', t), `acc-${user.user_id}`)
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text())
  })
  try {
    await fn({ page, mock, errors, ctx, go: (p, ready) => page.goto(`${mock.origin}${p}`).then(() => page.waitForSelector(ready)) })
  } finally {
    await ctx.close()
    await mock.close()
  }
}

export const WIDTHS = [1440, 1024, 768, 390, 320]
export const HEIGHT = (w) => (w >= 1024 ? 900 : w >= 768 ? 1024 : 800)

/**
 * Runs in the page. Returns a list of problems: sideways page scroll, anything wider than the viewport (unless a scrolling
 * ancestor clips it), title under the sticky header, text under 11px, text spilling out of buttons/pills, and (narrow) every
 * visible primary control being at least 44px tall and inside the viewport.
 */
export const AUDIT = ({ narrow }) => {
  const problems = []
  const vw = document.documentElement.clientWidth
  const note = (kind, el, extra = '') => {
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''
    problems.push(`${kind}: <${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}${el.dataset?.testid ? ` data-testid=${el.dataset.testid}` : ''}> ${extra}`.trim())
  }
  const hiddenByAncestor = (el) => {
    for (let a = el; a && a !== document.body; a = a.parentElement) {
      const cs = getComputedStyle(a)
      if (cs.display === 'none' || cs.visibility === 'hidden') return true
    }
    return false
  }
  const visible = (el) => {
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0 && !hiddenByAncestor(el)
  }
  if (document.documentElement.scrollWidth > vw + 1) problems.push(`page scrolls sideways: scrollWidth ${document.documentElement.scrollWidth} > ${vw}`)
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('.sr-only, svg *') || hiddenByAncestor(el)) continue
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
    const h1 = document.querySelector('.app-content h1')
    if (h1 && h1.getBoundingClientRect().top < hb.bottom - 1) note('title under header', h1)
  }
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('.sr-only, svg') || hiddenByAncestor(el)) continue
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
    if (own && parseFloat(getComputedStyle(el).fontSize) < 11) note('text smaller than 11px', el, getComputedStyle(el).fontSize)
  }
  for (const el of document.querySelectorAll('button, .btn, .pm-pill')) {
    if (hiddenByAncestor(el)) continue
    const cs = getComputedStyle(el)
    if (cs.overflowX === 'visible' && el.scrollWidth > el.clientWidth + 1) note('text spills out', el, `${el.scrollWidth} > ${el.clientWidth}`)
  }
  if (narrow) {
    const targets = document.querySelectorAll(
      '.app-content .btn, .app-content button.pm-subtab, .pm-search, .pm-select select, .pm-input, .pm-picker-box, .pm-chosen, .pm-check, .pm-radio, .pm-back-link, .pm-card, .pm-modal .btn, .topbar-menu, [data-testid=bell], .profile-button',
    )
    for (const el of targets) {
      if (!visible(el)) continue
      if (el.matches('.pm-check') && el.closest('[data-testid=roles-fieldset]') && el.querySelector('input[disabled]')) continue
      const r = el.getBoundingClientRect()
      if (r.height < 43.5) note('target shorter than 44px', el, `${Math.round(r.height * 10) / 10}px`)
      if (r.right > vw + 1 || r.left < -1) note('control outside viewport', el)
    }
  }
  return problems
}
