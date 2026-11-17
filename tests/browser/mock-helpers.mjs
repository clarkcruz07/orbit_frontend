// Shared helpers for the mock-API browser specs (addendum 2 screens and the responsive sweep).
import { distDir, launchBrowser, signIn } from './browser-env.mjs'
import { startMock } from './mock-api.mjs'

export const enabled = process.env.RUN_BROWSER_TESTS === '1'
export const opts = { skip: enabled ? false : 'set RUN_BROWSER_TESTS=1 to run real-browser tests' }

export const ANNA = 'anna.reyes@example.test' // HRAdmin
export const BEN = 'ben.cruz@example.test' // Manager
export const CARLA = 'carla.dizon@example.test' // Employee
export const DAN = 'dan.ocampo@example.test' // Finance

/** "Today" for every mock test: the page clock and the mock server agree on it, so months and relative times are stable. */
export const FIXED_NOW = new Date('2026-11-16T10:00:00')

export { launchBrowser }

/**
 * Runs `fn({page, mock, ctx, errors})` against a fresh mock + browser context.
 * `fixedClock` (default true) pins Date.now in the page and in the mock server; timers still run for real.
 */
export async function withMockApp(browser, fn, { viewport = { width: 1448, height: 1086 }, fixedClock = true, signInAs = null, demoAuth = true } = {}) {
  const mock = await startMock({ distDir, demoAuth })
  if (fixedClock) mock.state.newApi.now = FIXED_NOW
  const ctx = await browser.newContext({ viewport })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  if (fixedClock) await page.clock.setFixedTime(FIXED_NOW)
  try {
    if (signInAs) {
      await signIn(page, mock.origin, signInAs)
      await page.waitForSelector('.app-content')
    }
    await fn({ page, mock, ctx, errors })
  } finally {
    await ctx.close()
    await mock.close()
  }
}

export const text = (page, sel) => page.locator(sel).innerText()
export const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)

/** Opens a path on the same origin and waits for the shell content. */
export async function visit(page, mock, path, readySelector = '.app-content h1') {
  await page.goto(`${mock.origin}${path}`)
  await page.waitForSelector(readySelector)
}

export const iso = (d) => d.toISOString()
export const minutesAgo = (n) => new Date(FIXED_NOW.getTime() - n * 60_000).toISOString()

/** Polls a node-side condition (e.g. what the mock server has seen) until it holds. */
export async function until(cond, timeoutMs = 5000) {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    if (cond()) return
    await new Promise((r) => setTimeout(r, 25))
  }
  throw new Error('timed out waiting for condition')
}
