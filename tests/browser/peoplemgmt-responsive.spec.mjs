// Responsive sweep for People management and Holidays admin at 1440, 1024, 768, 390 and 320 px against the mock API. Per route and
// width: no horizontal page overflow, nothing wider than the viewport, no text under 11px, no text spilling out of buttons or pills,
// content below the sticky header, and at <= 768px every primary control is visible, inside the viewport and at least 44px tall.
// Long names, e-mail addresses, job titles and holiday names must wrap. Gated: RUN_BROWSER_TESTS=1.
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { launchBrowser } from './browser-env.mjs'
import { U } from './peoplemgmt-mock.mjs'
import { AUDIT, HEIGHT, WIDTHS, dist, enabled, opts } from './peoplemgmt-helpers.mjs'
import { startPeopleMock } from './peoplemgmt-mock.mjs'

let browser
before(async () => {
  if (enabled) browser = await launchBrowser()
})
after(async () => {
  await browser?.close()
})

const LONG_NAME = 'Bartholomew Maximilian Featherstonehaugh-Cholmondeley'
const LONG_EMAIL = 'bartholomew.maximilian.featherstonehaugh-cholmondeley@a-very-long-company-domain-name.example.test'
const LONG_TITLE = 'Senior Vice President of Extraordinarily Long Job Titles and Organisational Effectiveness'
const LONG_HOLIDAY = 'A very long holiday name that keeps going and going to test wrapping on narrow screens'
const HEAD = 'name,email,job_title,department,employment_type,manager_email,start_date,birthday,roles,can_sign_in\n'

const seedLong = (m, holidays) => {
  const p = m.state.people.find((x) => x.employee.employee_id === 'EMP-0100')
  Object.assign(p.employee, { name: LONG_NAME, email: LONG_EMAIL, job_title: LONG_TITLE, department: 'Learning & Development and Organisational Effectiveness', source: 'entra' })
  if (!holidays) return
  m.state.holidays.push({ holiday_id: 'h-long', name: LONG_HOLIDAY, type: 'company', date: '2026-03-03', month: null, day: null, active: true })
  m.state.holidays.push({ holiday_id: 'h-2', name: 'Founders Day', type: 'public', date: null, month: 12, day: 24, active: false })
}

const routes = [
  { name: 'people list (long values)', path: '/people', ready: '[data-testid=people-row]' },
  { name: 'people list (Microsoft directory: synced, pill on a long name)', path: '/people', ready: '[data-testid=entra-sync][data-view=synced]' },
  { name: 'people list (Microsoft directory: running)', path: '/people', ready: '[data-testid=entra-sync][data-view=running]', entra: { state: 'running', pollsLeft: 9999 } },
  {
    name: 'people list (Microsoft directory: not connected, long hint)',
    path: '/people',
    ready: '[data-testid=entra-sync][data-view=not_configured]',
    entra: { configured: false, enabled: false, last: null, next_run_at: null, setup_hint: 'Set the Microsoft directory sync client in the app settings (a very long application setting name such as PEOPLE_ENTRA_SYNC_CLIENT_SECRET_VALUE_NAME) and restart the service, then grant User.Read.All.' },
  },
  {
    name: 'people list (Microsoft directory: failed)',
    path: '/people',
    ready: '[data-testid=entra-sync][data-view=failed]',
    entra: { last: { started_at: null, finished_at: null, ok: false, error_code: 'partial_directory', counts: { fetched: 0, created: 0, updated: 0, deactivated: 0, reactivated: 0, skipped: 0 } } },
  },
  { name: 'people list (no results)', path: `/people?q=${'x'.repeat(64)}`, ready: '[data-testid=empty-state]' },
  { name: 'people list (not available)', path: '/people', as: U.carla, ready: '[data-testid=people-denied]' },
  { name: 'new person', path: '/people/new', ready: '[data-testid=person-form]' },
  {
    name: 'new person (errors, manager list)',
    path: '/people/new',
    ready: '[data-testid=person-form]',
    act: async (page) => {
      await page.fill('[data-testid=input-email]', LONG_EMAIL.replace('@', ''))
      await page.click('[data-testid=create-person]')
      await page.waitForSelector('[data-testid=form-error]')
      await page.fill('[data-testid=manager-input]', 'a')
      await page.waitForSelector('[data-testid=manager-option]')
    },
  },
  { name: 'person detail (long values)', path: '/people/EMP-0100', ready: '[data-testid=account-card]' },
  {
    name: 'person edit form',
    path: '/people/EMP-0100',
    ready: '[data-testid=account-card]',
    act: async (page) => {
      await page.click('[data-testid=edit-details]')
      await page.waitForSelector('[data-testid=edit-form]')
    },
  },
  { name: 'person with no account', path: '/people/EMP-0105', ready: '[data-testid=no-account-block]' },
  { name: 'person detail (full profile cards)', path: '/people/EMP-0100', ready: '[data-testid=profile-cards]' },
  {
    name: 'person profile section edit (contact)',
    path: '/people/EMP-0100',
    ready: '[data-testid=profile-cards]',
    act: async (page) => {
      await page.click('[data-testid=edit-profile-contact]')
      await page.waitForSelector('[data-testid=profile-form-contact]')
    },
  },
  {
    name: 'person profile government IDs shown',
    path: '/people/EMP-0100',
    ready: '[data-testid=profile-cards]',
    act: async (page) => {
      await page.click('[data-testid=toggle-statutory-show]')
    },
  },
  {
    name: 'new person (profile sections open)',
    path: '/people/new',
    ready: '[data-testid=person-form]',
    act: async (page) => {
      await page.click('[data-testid=toggle-profile-contact]')
      await page.click('[data-testid=toggle-profile-emergency_contact]')
      await page.click('[data-testid=toggle-profile-statutory]')
    },
  },
  { name: 'person who left', path: '/people/EMP-0107', ready: '[data-testid=reactivate]' },
  {
    name: 'deactivate dialog (confirm)',
    path: '/people/EMP-0101',
    ready: '[data-testid=deactivate]',
    act: async (page) => {
      await page.click('[data-testid=deactivate]')
      await page.waitForSelector('[data-testid=deactivate-dialog]')
    },
  },
  {
    name: 'deactivate dialog (new manager)',
    path: '/people/EMP-0002',
    ready: '[data-testid=deactivate]',
    act: async (page) => {
      await page.click('[data-testid=deactivate]')
      await page.click('[data-testid=deactivate-confirm]')
      await page.waitForSelector('[data-testid=reassign-step]')
      await page.fill('[data-testid=reassign-input]', 'a')
      await page.waitForSelector('[data-testid=reassign-option]')
    },
  },
  { name: 'import (start)', path: '/people/import', ready: '[data-testid=import-page]' },
  {
    name: 'import (dry run report)',
    path: '/people/import',
    ready: '[data-testid=import-page]',
    act: async (page) => {
      const rows = [
        'Good One,good.one@example.test,Analyst,Operations,full_time,,,,,',
        '=HYPERLINK("x"),f@example.test,Analyst,Operations,full_time,,,,,',
        `${LONG_NAME},${LONG_EMAIL},T,D,bogus_type,,,,,`,
        'Already,anna.reyes@example.test,A,B,full_time,,,,,',
      ]
      await page.setInputFiles('[data-testid=import-file]', { name: `${'a-long-file-name-'.repeat(6)}.csv`, mimeType: 'text/csv', buffer: Buffer.from(HEAD + rows.join('\n') + '\n') })
      await page.click('[data-testid=check-file]')
      await page.waitForSelector('[data-testid=run-import]')
      await page.click('[data-testid=report-filter-all]')
    },
  },
  { name: 'holidays (empty list)', path: '/settings/holidays?year=2026', ready: '[data-testid=holidays-empty-note]' },
  {
    name: 'holidays (filled in automatically by AI)',
    path: '/settings/holidays?year=2026',
    ready: '[data-testid=holidays-ai-note]',
    autosync: { mode: 'pending', pendingPolls: 0 },
  },
  { name: 'holidays (list, long name, inactive)', path: '/settings/holidays?year=2026', ready: '[data-testid=holiday-row], [data-testid=holiday-card]', seed: true },
  {
    name: 'holidays (add form, yearly)',
    path: '/settings/holidays?year=2026',
    ready: '[data-testid=add-holiday]',
    act: async (page) => {
      await page.click('[data-testid=add-holiday]')
      await page.check('[data-testid=holiday-yearly]')
      await page.click('[data-testid=save-holiday]')
      await page.waitForSelector('[data-testid=holiday-form]')
    },
  },
  {
    name: 'holidays (delete dialog)',
    path: '/settings/holidays?year=2026',
    ready: '[data-testid=holiday-row], [data-testid=holiday-card]',
    seed: true,
    act: async (page) => {
      await page.locator('button:visible', { hasText: 'Delete' }).first().click()
      await page.waitForSelector('[data-testid=delete-dialog]')
    },
  },
  { name: 'holidays (not available)', path: '/settings/holidays', as: U.dan, ready: '[data-testid=holidays-denied]' },
]

for (const width of WIDTHS) {
  test(`people management responsive @${width}px: every page and dialog fits, controls are tappable`, opts, async () => {
    const problems = []
    for (const r of routes) {
      const mock = await startPeopleMock({ distDir: dist })
      seedLong(mock, r.seed)
      if (r.autosync) mock.state.autosync = { ...r.autosync }
      if (r.entra) mock.state.entra = { ...mock.state.entra, ...r.entra }
      const user = r.as ?? U.anna
      const ctx = await browser.newContext({ viewport: { width, height: HEIGHT(width) } })
      await ctx.addInitScript((t) => localStorage.setItem('people.accessToken', t), `acc-${user.user_id}`)
      const page = await ctx.newPage()
      page.on('pageerror', (e) => problems.push(`${r.name}: page error ${e}`))
      try {
        await page.goto(`${mock.origin}${r.path}`)
        try {
          await page.waitForSelector(r.ready, { timeout: 15000, state: 'attached' })
          await r.act?.(page)
        } catch (e) {
          problems.push(`${r.name} (${r.path}): never became ready (${String(e).split('\n')[0]})`)
          continue
        }
        await page.evaluate(() => window.scrollTo(0, 0))
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

test('audit self-check: the audit really flags sideways scroll, wide elements and short touch targets', opts, async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } })
  const page = await ctx.newPage()
  try {
    await page.setContent('<div class="app-content"><h1>Title</h1><div style="width:700px;height:20px">wide</div><button class="btn" style="height:20px;display:block">x</button></div>')
    const problems = await page.evaluate(AUDIT, { narrow: true })
    assert.ok(problems.some((p) => /scrolls sideways/.test(p)), problems.join('\n'))
    assert.ok(problems.some((p) => /wider than viewport/.test(p)))
    assert.ok(problems.some((p) => /target shorter than 44px/.test(p)))
    const clean = await page.evaluate(() => {
      document.body.innerHTML = '<div class="app-content"><h1>Title</h1><button class="btn" style="height:44px;display:block">x</button></div>'
    })
    void clean
    assert.deepEqual(await page.evaluate(AUDIT, { narrow: true }), [])
  } finally {
    await ctx.close()
  }
})
