// Screenshots of the People management and Holidays pages with FICTIONAL data (the mock API in peoplemgmt-mock.mjs).
//   node tests/browser/peoplemgmt-screenshots.mjs
// Environment: PEOPLEMGMT_DIST (use another build folder), SHOT_DIR (output folder, default docs/screenshots).
// Widths: desktop 1448, tablet 768, mobile 390. Tall pages are captured by stretching the viewport to the document height (the
// sidebar is fixed and the top bar sticky, so Playwright's fullPage would repeat them); very long pages are capped.
import fs from 'node:fs'
import path from 'node:path'
import { frontendDir, launchBrowser } from './browser-env.mjs'
import { U, startPeopleMock } from './peoplemgmt-mock.mjs'
import { dist } from './peoplemgmt-helpers.mjs'

const out = process.env.SHOT_DIR ? path.resolve(process.env.SHOT_DIR) : path.resolve(frontendDir, '..', 'docs', 'screenshots')
fs.mkdirSync(out, { recursive: true })
const SIZES = [
  ['desktop-1448', 1448, 1000],
  ['tablet-768', 768, 1024],
  ['mobile-390', 390, 800],
]
const HEAD = 'name,email,job_title,department,employment_type,manager_email,start_date,birthday,roles,can_sign_in\n'
const MAX_H = 2600

async function shoot(page, name) {
  await page.waitForTimeout(250)
  const h = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight))
  const { width } = page.viewportSize()
  await page.setViewportSize({ width, height: Math.min(Math.max(h, 600), MAX_H) })
  await page.waitForTimeout(150)
  await page.screenshot({ path: path.join(out, name) })
}

const SHOTS = [
  {
    name: 'people-list',
    path: '/people',
    ready: '[data-testid=people-row], [data-testid=people-card]',
  },
  {
    name: 'people-new',
    path: '/people/new',
    ready: '[data-testid=person-form]',
    act: async (page) => {
      await page.fill('[data-testid=input-name]', 'Nina Valdez')
      await page.fill('[data-testid=input-email]', 'nina.valdez@example.test')
      await page.fill('[data-testid=input-job_title]', 'Analyst')
      await page.fill('[data-testid=input-department]', 'Operations')
      await page.fill('[data-testid=input-birthday]', '03-27')
      await page.fill('[data-testid=manager-input]', 'ben')
      await page.click('[data-testid=manager-option]')
      await page.check('[data-testid=role-Manager]')
    },
  },
  { name: 'people-detail', path: '/people/EMP-0100', ready: '[data-testid=account-card]' },
  {
    name: 'people-import-report',
    path: '/people/import',
    ready: '[data-testid=import-page]',
    act: async (page) => {
      const rows = [
        'Pat One,pat.one@example.test,Analyst,Operations,full_time,ben.cruz@example.test,2026-12-01,03-27,Manager;Finance,true',
        'Pat Two,pat.two@example.test,Analyst,Operations,intern,pat.one@example.test,,,,false',
        '=HYPERLINK("x"),pat.three@example.test,Analyst,Operations,full_time,,,,,',
        'Pat Four,not-an-email,Analyst,Operations,full_time,,,,,',
        'Already Here,anna.reyes@example.test,Analyst,Operations,full_time,,,,,',
        'Pat Six,pat.six@example.test,Analyst,Operations,bogus,,,,,',
      ]
      await page.setInputFiles('[data-testid=import-file]', { name: 'new-hires.csv', mimeType: 'text/csv', buffer: Buffer.from(HEAD + rows.join('\n') + '\n') })
      await page.click('[data-testid=check-file]')
      await page.waitForSelector('[data-testid=run-import]')
      await page.click('[data-testid=report-filter-all]')
    },
  },
  {
    name: 'holidays',
    path: '/settings/holidays?year=2026',
    ready: '[data-testid=holiday-row], [data-testid=holiday-card]',
    seed: (m) =>
      m.state.holidays.push(
        { holiday_id: 'h1', name: "New Year's Day", type: 'public', date: null, month: 1, day: 1, active: true },
        { holiday_id: 'h2', name: 'Araw ng Kagitingan', type: 'public', date: '2026-04-09', month: null, day: null, active: true },
        { holiday_id: 'h3', name: 'Company Anniversary', type: 'company', date: '2026-06-12', month: null, day: null, active: true },
        { holiday_id: 'h4', name: 'Christmas Day', type: 'public', date: null, month: 12, day: 25, active: true },
        { holiday_id: 'h5', name: 'Year-end Shutdown', type: 'company', date: '2026-12-31', month: null, day: null, active: false },
      ),
  },
  { name: 'holidays-demo', path: '/settings/holidays?year=2026', ready: '[data-testid=holidays-demo]' },
]

const browser = await launchBrowser()
try {
  for (const [label, width, height] of SIZES) {
    for (const s of SHOTS) {
      if (s.name === 'holidays-demo' && label !== 'desktop-1448') continue
      const mock = await startPeopleMock({ distDir: dist })
      s.seed?.(mock)
      const ctx = await browser.newContext({ viewport: { width, height } })
      await ctx.addInitScript((t) => localStorage.setItem('people.accessToken', t), `acc-${U.anna.user_id}`)
      const page = await ctx.newPage()
      try {
        await page.goto(`${mock.origin}${s.path}`)
        await page.waitForSelector(s.ready, { timeout: 20000, state: 'attached' })
        await s.act?.(page)
        await page.evaluate(() => window.scrollTo(0, 0))
        await shoot(page, `${s.name}-${label}.png`)
        console.log('saved', `${s.name}-${label}.png`)
      } finally {
        await ctx.close()
        await mock.close()
      }
    }
  }
} finally {
  await browser.close()
}
