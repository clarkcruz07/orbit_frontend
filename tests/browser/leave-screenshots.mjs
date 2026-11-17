// Captures the documented Leave screenshots from a REAL backend run (in-memory DB, fictional demo people and data).
//   node tests/browser/leave-screenshots.mjs [outDir]        (default ../docs/screenshots, files leave-*.png)
// Widths: desktop 1448, tablet 768, mobile 390. Tall pages are captured by stretching the viewport to the document height
// (the sidebar is fixed and the top bar sticky, so Playwright's fullPage would repeat them).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchBrowser, frontendDir } from './browser-env.mjs'
import { PEOPLE, startRealStack } from './real-backend.mjs'
import { actor, apiCall, apiLogin } from './e2e-helpers.mjs'
import { HOLIDAYS } from './mock-leave.mjs'

export const LEAVE_SCREENSHOT_FILES = []
for (const screen of ['overview', 'new', 'approval', 'calendar', 'settings']) {
  for (const w of ['desktop-1448', 'tablet-768', 'mobile-390']) LEAVE_SCREENSHOT_FILES.push(`leave-${screen}-${w}.png`)
}

const D = (s) => new Date(`${s}T00:00:00Z`)
const iso = (d) => d.toISOString().slice(0, 10)
const addDays = (s, n) => iso(new Date(D(s).getTime() + n * 86_400_000))
const isWorkday = (s) => D(s).getUTCDay() >= 1 && D(s).getUTCDay() <= 5 && !HOLIDAYS.some(([m, d]) => m === D(s).getUTCMonth() + 1 && d === D(s).getUTCDate())

async function settle(page) {
  await page.evaluate(() => document.fonts?.ready)
  await page.waitForFunction(() => [...document.images].every((i) => i.complete))
  await page.waitForTimeout(450)
}

export async function captureLeaveScreenshots({ browser, origin, outDir }) {
  fs.mkdirSync(outDir, { recursive: true })
  const written = []
  const actors = []
  const as = async (email, viewport) => {
    const a = await actor(browser, origin, email, viewport)
    actors.push(a)
    return a
  }
  const shoot = async (page, name) => {
    await settle(page)
    const vp = page.viewportSize()
    const h = await page.evaluate(() => document.documentElement.scrollHeight)
    await page.setViewportSize({ width: vp.width, height: Math.min(Math.max(h, vp.height), 3200) })
    await page.waitForTimeout(300)
    await page.screenshot({ path: path.join(outDir, name) })
    await page.setViewportSize(vp)
    written.push(name)
  }
  try {
    const jt = await apiLogin(origin, PEOPLE.jamie)
    const mt = await apiLogin(origin, PEOPLE.miguel)
    const lt = await apiLogin(origin, PEOPLE.lia)
    const ct = await apiLogin(origin, PEOPLE.carla)
    const today = (await apiCall(origin, jt, 'GET', '/leave/config')).json.today
    const year = Number(today.slice(0, 4))
    /** n consecutive working days on or after today + offset, inside one calendar year */
    const run = (offset, n) => {
      for (let i = 0; i < 400; i++) {
        const start = addDays(today, offset + i)
        const days = Array.from({ length: n }, (_, k) => addDays(start, k))
        if (days.every(isWorkday) && days[0].slice(0, 4) === days[n - 1].slice(0, 4)) return { start, end: days[n - 1] }
      }
      throw new Error('no run')
    }
    const create = async (token, body) => {
      const r = await apiCall(origin, token, 'POST', '/leave/requests', body)
      if (r.status !== 201) throw new Error(`create failed ${r.status} ${JSON.stringify(r.json)}`)
      return r.json.request_id
    }
    const decide = (token, id, action, comment) => apiCall(origin, token, 'POST', `/leave/requests/${id}/decision`, { action, comment })

    // ---- Jamie: approved vacation, pending vacation, a clarification, a rejection, a cancelled personal day
    const a = run(21, 3)
    const approved = await create(jt, { type_id: 'vacation', start_date: a.start, end_date: a.end, half_day: 'none', reason: 'Family holiday' })
    await decide(mt, approved, 'approve', 'Enjoy the break')
    const b = run(56, 4)
    const pending = await create(jt, { type_id: 'vacation', start_date: b.start, end_date: b.end, half_day: 'none', reason: 'Long weekend with the family in Baguio, flights already booked' })
    const c = run(28, 2)
    const clarify = await create(jt, { type_id: 'sick', start_date: c.start, end_date: c.end, half_day: 'none', reason: 'Dental surgery' })
    await decide(mt, clarify, 'clarify', 'Which two days exactly, and is a medical certificate available?')
    const d = run(70, 1)
    const rejected = await create(jt, { type_id: 'personal', start_date: d.start, end_date: d.start, half_day: 'pm', reason: 'Errand' })
    await decide(mt, rejected, 'reject', 'Month-end close, please pick another day')
    const e = run(84, 1)
    const cancelled = await create(jt, { type_id: 'personal', start_date: e.start, end_date: e.start, half_day: 'none', reason: null })
    await apiCall(origin, jt, 'POST', `/leave/requests/${cancelled}/cancel`)
    // others on the team calendar
    const f = run(a.start === addDays(today, 21) ? 22 : 21, 2)
    const lia = await create(lt, { type_id: 'vacation', start_date: f.start, end_date: f.end, half_day: 'none', reason: null })
    await decide(ct, lia, 'approve', null)
    const paolo = await apiLogin(origin, PEOPLE.paolo)
    const g = run(24, 2)
    const pa = await create(paolo, { type_id: 'sick', start_date: g.start, end_date: g.end, half_day: 'none', reason: null })
    await decide(mt, pa, 'approve', null)
    void clarify
    void rejected

    // ---- overview: balances + list
    for (const [w, h, size] of [[1448, 1000, 'desktop-1448'], [768, 1024, 'tablet-768'], [390, 844, 'mobile-390']]) {
      const jamie = await as(PEOPLE.jamie, { width: w, height: h })
      await jamie.page.goto(`${origin}/leave`)
      await jamie.page.waitForFunction(() => document.querySelectorAll('[data-testid=balance-card]').length >= 4 && document.querySelectorAll('[data-testid=leave-row], [data-testid=leave-card]').length >= 5)
      await shoot(jamie.page, `leave-overview-${size}.png`)

      // new request form with the live day count (a range that includes a weekend)
      const n = run(112, 5)
      await jamie.page.goto(`${origin}/leave/new`)
      await jamie.page.waitForSelector('[data-testid=leave-form]')
      await jamie.page.selectOption('[data-testid=leave-type]', 'vacation')
      await jamie.page.fill('[data-testid=leave-start]', n.start)
      await jamie.page.fill('[data-testid=leave-end]', addDays(n.start, 7))
      await jamie.page.fill('[data-testid=leave-reason]', 'Visit to the provinces')
      await jamie.page.waitForSelector('[data-testid=leave-preview][data-state=valid]')
      await shoot(jamie.page, `leave-new-${size}.png`)

      // approval panel (Miguel reviewing Jamie's pending request)
      const miguel = await as(PEOPLE.miguel, { width: w, height: h })
      await miguel.page.goto(`${origin}/leave/${pending}`)
      await miguel.page.waitForSelector('[data-testid=decision-panel]')
      await miguel.page.fill('[data-testid=leave-comment]', 'Please confirm who covers the desk that week.')
      await shoot(miguel.page, `leave-approval-${size}.png`)

      // team calendar (Miguel: his own team)
      const month = a.start.slice(0, 7)
      await miguel.page.goto(`${origin}/leave?tab=calendar&month=${month}`)
      await miguel.page.waitForSelector('[data-testid=lcal-chip]:visible, [data-testid=lcal-agenda-item]:visible')
      await shoot(miguel.page, `leave-calendar-${size}.png`)

      // HR settings (Anna): the placeholder catalog and an override
      const anna = await as(PEOPLE.anna, { width: w, height: h })
      await anna.page.goto(`${origin}/leave?tab=settings`)
      await anna.page.waitForSelector('[data-testid=type-row]:visible, [data-testid=type-card]:visible')
      await shoot(anna.page, `leave-settings-${size}.png`)
    }
    void year
  } finally {
    for (const x of actors) await x.close().catch(() => undefined)
  }
  return written
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outDir = path.resolve(process.argv[2] ?? path.join(frontendDir, '..', 'docs', 'screenshots'))
  const stack = await startRealStack()
  const browser = await launchBrowser()
  try {
    const files = await captureLeaveScreenshots({ browser, origin: stack.origin, outDir })
    console.log(`wrote ${files.length} leave screenshots to ${outDir}`)
  } finally {
    await browser.close()
    await stack.close()
  }
}
