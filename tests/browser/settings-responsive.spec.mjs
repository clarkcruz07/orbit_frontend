// Responsive sweep for Settings (all five tabs) and the HR Administration dashboard in Live mode, at 1440, 1024, 768, 390 and
// 320 px against the Settings mock. Per route and width: no horizontal page overflow, nothing wider than the viewport, no text
// under 11px, no text spilling out of buttons/badges, content below the sticky header, and at <= 768px every primary control
// (tabs, switches, search, buttons, links) is visible, inside the viewport and at least 44px tall.
// Gated: RUN_BROWSER_TESTS=1 (use `npm run test:browser`). Fictional data only.
import path from 'node:path'
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { distDir, launchBrowser } from './browser-env.mjs'
import { U, liveDegraded, liveTiny, startSettingsMock } from './settings-mock.mjs'

const enabled = process.env.RUN_BROWSER_TESTS === '1'
const opts = { skip: enabled ? false : 'set RUN_BROWSER_TESTS=1 to run real-browser tests' }
const dist = process.env.SETTINGS_DIST ? path.resolve(process.env.SETTINGS_DIST) : distDir

let browser
before(async () => {
  if (enabled) browser = await launchBrowser()
})
after(async () => {
  await browser?.close()
})

const WIDTHS = [1440, 1024, 768, 390, 320]
const HEIGHT = (w) => (w >= 1024 ? 900 : w >= 768 ? 1024 : 800)
const LONG_EMAIL = 'bartholomew.maximilian.featherstonehaugh-cholmondeley@a-very-long-company-domain-name.example.test'

const AUDIT = ({ narrow }) => {
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
  for (const el of document.querySelectorAll('button, .btn, .st-badge, .pill, .st-tab, .src-opt')) {
    if (hiddenByAncestor(el)) continue
    const cs = getComputedStyle(el)
    if (cs.overflowX === 'visible' && el.scrollWidth > el.clientWidth + 1) note('text spills out', el, `${el.scrollWidth} > ${el.clientWidth}`)
  }
  if (narrow) {
    const targets = document.querySelectorAll('.st-tab, .st-switch, .src-opt, .st-search-input, .st-search, .app-content .btn, .st-link, .st-go, .topbar-menu, [data-testid=bell], .profile-button')
    for (const el of targets) {
      if (!visible(el)) continue
      const r = el.getBoundingClientRect()
      if (r.height < 43.5) note('target shorter than 44px', el, `${Math.round(r.height * 10) / 10}px`)
      if (r.right > vw + 1 || r.left < -1) note('control outside viewport', el)
    }
  }
  return problems
}

const routes = [
  { name: 'preferences (employee)', path: '/settings', as: U.carla, ready: '[data-testid=pref-switch-leave]' },
  { name: 'preferences (HR, five tabs)', path: '/settings', as: U.anna, ready: '[data-testid=settings-tab-catalogs]' },
  { name: 'account (HR)', path: '/settings?tab=account', as: U.anna, ready: '[data-testid=fact-timezone]' },
  { name: 'HR settings', path: '/settings?tab=hr', as: U.anna, ready: '[data-testid=mood-switch]' },
  { name: 'users (long values)', path: '/settings?tab=users', as: U.anna, ready: '[data-testid=user-row], [data-testid=user-card]' },
  { name: 'users (long search, no results)', path: `/settings?tab=users&q=${'x'.repeat(64)}`, as: U.anna, ready: '[data-testid=empty-state]' },
  { name: 'catalogs', path: '/settings?tab=catalogs', as: U.anna, ready: '[data-testid=catalog-leave]' },
  { name: 'dashboard (not tracked cards)', path: '/', as: U.anna, ready: '[data-testid=card-upcoming]' },
  { name: 'dashboard (tiny company)', path: '/', as: U.anna, ready: '[data-testid=card-upcoming]', setup: (m) => (m.state.liveVariant = liveTiny) },
  { name: 'dashboard (degraded blocks)', path: '/', as: U.anna, ready: '[data-testid=card-upcoming]', setup: (m) => (m.state.liveVariant = liveDegraded) },
]

for (const width of WIDTHS) {
  test(`settings responsive @${width}px: every Settings tab and the dashboard fit, controls are tappable`, opts, async () => {
    const problems = []
    for (const r of routes) {
      const mock = await startSettingsMock({ distDir: dist })
      mock.state.users.push({ user_id: 'u-long', name: 'Bartholomew Maximilian Featherstonehaugh-Cholmondeley', email: LONG_EMAIL, roles: ['Employee', 'Manager'], employee_id: 'EMP-0999', auth_source: 'microsoft', is_demo: false, department: 'Learning & Development and Organisational Effectiveness', job_title: 'Senior Vice President of Extraordinarily Long Job Titles' })
      r.setup?.(mock)
      const ctx = await browser.newContext({ viewport: { width, height: HEIGHT(width) } })
      await ctx.addInitScript((t) => localStorage.setItem('people.accessToken', t), `acc-${r.as.user_id}`)
      const page = await ctx.newPage()
      page.on('pageerror', (e) => problems.push(`${r.name}: page error ${e}`))
      try {
        await page.goto(`${mock.origin}${r.path}`)
        try {
          await page.waitForSelector(r.ready, { timeout: 15000, state: 'attached' })
        } catch {
          problems.push(`${r.name} (${r.path}): never became ready (${r.ready})`)
          continue
        }
        await page.waitForTimeout(350)
        for (const p of await page.evaluate(AUDIT, { narrow: width <= 768 })) problems.push(`${r.name} (${r.path}): ${p}`)
      } finally {
        await ctx.close()
        await mock.close()
      }
    }
    assert.deepEqual(problems, [], `\n${problems.join('\n')}`)
  })
}
