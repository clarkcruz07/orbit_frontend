// Helpers shared by the Performance and Learning browser specs (mock-API suites and the responsive sweep).
import path from 'node:path'
import { distDir as sharedDist, launchBrowser, signIn } from './browser-env.mjs'
import { startPerfMock } from './performance-mock.mjs'
import { startLearnMock } from './learning-mock.mjs'

export const enabled = process.env.RUN_BROWSER_TESTS === '1'
export const opts = { skip: enabled ? false : 'set RUN_BROWSER_TESTS=1 to run real-browser tests' }
// PL_DIST_DIR lets a developer point these mock suites at a private build while other agents rebuild the shared dist/.
export const distDir = process.env.PL_DIST_DIR ? path.resolve(process.env.PL_DIST_DIR) : sharedDist
export { launchBrowser, signIn }

// The shared mock's four people.
export const ANNA = 'anna.reyes@example.test' // HRAdmin
export const BEN = 'ben.cruz@example.test' // Manager of Carla and Dan
export const CARLA = 'carla.dizon@example.test' // Employee
export const DAN = 'dan.ocampo@example.test' // Finance

export const FIXED_NOW = new Date('2026-11-16T10:00:00')

/** Runs `fn({page, mock, state, ctx, errors})` against a fresh mock + browser context (module chosen by `kind`). */
export async function withModuleMock(browser, kind, fn, { viewport = { width: 1448, height: 1000 }, signInAs = null, seed = null } = {}) {
  const mock = kind === 'performance' ? await startPerfMock({ distDir }) : await startLearnMock({ distDir })
  if (seed) seed(mock.state, mock)
  const ctx = await browser.newContext({ viewport, acceptDownloads: true })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.clock.setFixedTime(FIXED_NOW)
  try {
    if (signInAs) {
      await signIn(page, mock.origin, signInAs)
      await page.waitForSelector('.app-content')
    }
    await fn({ page, mock, state: mock.state, ctx, errors })
  } finally {
    await ctx.close()
    await mock.close()
  }
}

export const withPerfMock = (browser, fn, o) => withModuleMock(browser, 'performance', fn, o)
export const withLearnMock = (browser, fn, o) => withModuleMock(browser, 'learning', fn, o)

export const text = (page, sel) => page.locator(sel).innerText()
export const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)

export async function visit(page, mock, path, ready) {
  await page.goto(`${mock.origin}${path}`)
  await page.waitForSelector(ready)
}

/** Polls a node-side condition until it holds. */
export async function until(cond, timeoutMs = 5000) {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    if (cond()) return
    await new Promise((r) => setTimeout(r, 25))
  }
  throw new Error('timed out waiting for condition')
}
