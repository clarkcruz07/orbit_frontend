// Helpers shared by the Leave mock-API specs (leave.spec.mjs, leave-responsive.spec.mjs, leave-screenshots.mjs).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { distDir, signIn } from './browser-env.mjs'
import { ANNA, BEN, CARLA, DAN, enabled, launchBrowser, opts } from './mock-helpers.mjs'
import { seedRequest, startLeaveMock, TODAY } from './mock-leave.mjs'

export { ANNA, BEN, CARLA, DAN, enabled, launchBrowser, opts, TODAY }

/**
 * Other agents rebuild frontend/dist while their suites run; a half-written dist would fail unrelated tests. The Leave
 * specs therefore serve a private SNAPSHOT of dist (taken once per process, retried until every asset index.html needs exists).
 */
let snapshot = null
export function snapshotDist() {
  if (snapshot) return snapshot
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'people-leave-dist-'))
  process.on('exit', () => {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      /* best effort */
    }
  })
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
      fs.cpSync(distDir, dir, { recursive: true })
      const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8')
      const refs = [...html.matchAll(/(?:src|href)="\/(assets\/[^"]+)"/g)].map((m) => m[1])
      if (refs.length > 0 && refs.every((r) => fs.existsSync(path.join(dir, r)))) {
        snapshot = dir
        return dir
      }
    } catch {
      /* dist is being rebuilt: wait and copy again */
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 750)
  }
  throw new Error('dist/ never became consistent for the Leave specs')
}

/** Requests are given employee ids: Carla EMP-0003 (reports to Ben), Dan EMP-0004 (reports to Ben), Ben EMP-0002 and Anna EMP-0001 (no manager). */
export const EMP = { anna: 'EMP-0001', ben: 'EMP-0002', carla: 'EMP-0003', dan: 'EMP-0004' }

const decision = (action, comment, at, by = 'Ben Cruz', role = 'Manager') => ({ decision_id: `seed-${action}-${at}`, action, by_name: by, by_role: role, comment, at })

/** A representative, fictional set of requests for every status. Dates are relative to the mock's "today" (Mon 2026-11-16). */
export function seedBasic(state) {
  const ids = {}
  ids.approved = seedRequest(state, { employee_id: EMP.carla, start_date: '2026-12-07', end_date: '2026-12-09', status: 'approved', decisions: [decision('approve', 'Enjoy the break', '2026-11-11T09:00:00.000Z')], decided_at: '2026-11-11T09:00:00.000Z' }).request_id
  ids.pending = seedRequest(state, { employee_id: EMP.carla, start_date: '2026-11-23', end_date: '2026-11-25', reason: 'Family trip to Baguio' }).request_id
  ids.rejected = seedRequest(state, { employee_id: EMP.carla, type_id: 'sick', start_date: '2026-11-02', end_date: '2026-11-02', status: 'rejected', decisions: [decision('reject', 'Please attach a medical note first', '2026-11-03T09:00:00.000Z')], decided_at: '2026-11-03T09:00:00.000Z' }).request_id
  ids.clarify = seedRequest(state, { employee_id: EMP.carla, start_date: '2026-12-14', end_date: '2026-12-15', status: 'clarification_requested', reason: 'Trip', decisions: [decision('clarify', 'Which days exactly, and who covers the desk?', '2026-11-12T09:00:00.000Z')] }).request_id
  ids.cancelled = seedRequest(state, { employee_id: EMP.carla, type_id: 'personal', start_date: '2026-10-05', end_date: '2026-10-05', status: 'cancelled', cancelled_at: '2026-10-01T09:00:00.000Z' }).request_id
  ids.danPending = seedRequest(state, { employee_id: EMP.dan, start_date: '2026-12-01', end_date: '2026-12-03', reason: 'Moving house' }).request_id
  ids.benPending = seedRequest(state, { employee_id: EMP.ben, start_date: '2026-12-21', end_date: '2026-12-23' }).request_id
  ids.danApproved = seedRequest(state, { employee_id: EMP.dan, type_id: 'sick', start_date: '2026-11-18', end_date: '2026-11-19', status: 'approved', decisions: [decision('approve', null, '2026-11-17T09:00:00.000Z')], decided_at: '2026-11-17T09:00:00.000Z' }).request_id
  return ids
}

/**
 * Runs `fn({page, mock, ctx, errors, ids})` against a fresh leave mock and browser context. Times are shown in UTC so
 * timeline texts are stable. The browser clock is pinned to the mock's "today".
 */
export async function withLeave(browser, fn, { as = CARLA, viewport = { width: 1448, height: 1000 }, seed = true, login = true } = {}) {
  const mock = await startLeaveMock({ distDir: snapshotDist() })
  const ids = seed ? seedBasic(mock.state) : {}
  const ctx = await browser.newContext({ viewport, timezoneId: 'UTC', locale: 'en-US' })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.clock.setFixedTime(new Date(`${TODAY}T10:00:00Z`))
  try {
    if (login) {
      await signIn(page, mock.origin, as)
      await page.waitForSelector('.app-content')
    }
    await fn({ page, mock, ctx, errors, ids })
  } finally {
    await ctx.close()
    await mock.close()
  }
}

export const text = (page, sel) => page.locator(sel).innerText()
export const count = (page, sel) => page.locator(sel).count()
export const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)

export async function visit(page, mock, path, ready) {
  await page.goto(`${mock.origin}${path}`)
  await page.waitForSelector(ready)
}

/** Polls a node-side condition (what the mock has seen) until it holds. */
export async function until(cond, timeoutMs = 5000) {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    if (cond()) return
    await new Promise((r) => setTimeout(r, 25))
  }
  throw new Error('condition not met in time')
}

export async function waitGone(page, selector, timeout = 10000) {
  await page.waitForFunction((s) => !document.querySelector(s), selector, { timeout })
}

/** Fills the request form: type, dates (end defaults to the start). */
export async function fillForm(page, { type = 'vacation', start, end = start, half = null, reason = null }) {
  await page.selectOption('[data-testid=leave-type]', type)
  await page.fill('[data-testid=leave-start]', start)
  if (end !== start) await page.fill('[data-testid=leave-end]', end)
  if (half) await page.check(`[data-testid=leave-half-${half}]`)
  if (reason !== null) await page.fill('[data-testid=leave-reason]', reason)
}

/** Waits for the day-count preview to settle on a state. */
export async function previewState(page, state) {
  await page.waitForSelector(`[data-testid=leave-preview][data-state=${state}]`, { timeout: 10000 })
}
