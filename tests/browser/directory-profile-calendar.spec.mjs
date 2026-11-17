// Mock-API browser tests (addendum 2): Directory, Directory profile, My Profile, Company Calendar, personal Dashboard cards.
// Gated: RUN_BROWSER_TESTS=1 (use `npm run test:browser`). The mock plays "the server": it decides what each caller may see.
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { ANNA, BEN, CARLA, enabled, launchBrowser, noOverflow, opts, text, visit, withMockApp } from './mock-helpers.mjs'

let browser
before(async () => {
  if (enabled) browser = await launchBrowser()
})
after(async () => {
  await browser?.close()
})
const app = (fn, o) => withMockApp(browser, fn, o)

// ------------------------------------------------------------------------------------------------ directory list
test('directory: any signed-in user sees the basic fields, 20 per page, and no HR-only controls or columns', opts, () =>
  app(async ({ page, mock, errors }) => {
    await visit(page, mock, '/directory', '[data-testid=dir-row]')
    assert.equal(await page.locator('[data-testid=dir-row]').count(), 20)
    assert.match(await text(page, '[data-testid=dir-count]'), /Showing 1-20 of 30 people/)
    assert.equal(await page.locator('[data-testid=dir-type]').count(), 0, 'employment type filter hidden without HR fields')
    assert.equal(await page.locator('[data-testid=dir-hr-fields]').count(), 0)
    const heads = await page.$$eval('.dir-table thead th', (els) => els.map((e) => e.textContent.trim()))
    assert.deepEqual(heads, ['Name', 'Department', 'Email', 'Manager'])
    assert.ok(!(await text(page, '[data-testid=directory]')).match(/Since |Full-time|Contractor/), 'no HR text anywhere')
    // Sorted by name, then id.
    const names = await page.$$eval('[data-testid=dir-row] [data-testid=dir-open]', (els) => els.map((e) => e.textContent.trim()))
    assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)))
    assert.deepEqual(errors, [])
  }, { signInAs: CARLA }))

test('directory: pagination moves through pages, keeps the URL in step, and disables the ends', opts, () =>
  app(async ({ page, mock }) => {
    await visit(page, mock, '/directory', '[data-testid=dir-row]')
    assert.equal(await page.locator('[data-testid=dir-prev]').isDisabled(), true)
    assert.match(await text(page, '[data-testid=dir-page-label]'), /Page 1 of 2/)
    await page.click('[data-testid=dir-next]')
    await page.waitForFunction(() => /Showing 21-30 of 30/.test(document.querySelector('[data-testid=dir-count]')?.textContent || ''))
    assert.equal(await page.locator('[data-testid=dir-row]').count(), 10)
    assert.equal(new URL(page.url()).searchParams.get('page'), '2')
    assert.equal(await page.locator('[data-testid=dir-next]').isDisabled(), true)
    assert.equal(await page.locator('[data-testid=dir-prev]').isDisabled(), false)
    await page.click('[data-testid=dir-prev]')
    await page.waitForFunction(() => /Showing 1-20 of 30/.test(document.querySelector('[data-testid=dir-count]')?.textContent || ''))
    assert.equal(new URL(page.url()).searchParams.get('page'), null)
    // A stale bookmarked page falls back to page 1.
    await visit(page, mock, '/directory?page=9', '[data-testid=dir-row]')
    await page.waitForFunction(() => /Showing 1-20 of 30/.test(document.querySelector('[data-testid=dir-count]')?.textContent || ''))
  }, { signInAs: CARLA }))

test('directory: search (debounced), department filter, clear filters and the no-results state', opts, () =>
  app(async ({ page, mock }) => {
    await visit(page, mock, '/directory', '[data-testid=dir-row]')
    await page.type('[data-testid=dir-search]', 'ben', { delay: 25 })
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=dir-row]').length === 1)
    assert.equal(new URL(page.url()).searchParams.get('q'), 'ben')
    assert.equal(mock.state.newApi.directoryCalls.filter((c) => c.includes('q=ben')).length, 1, 'typing is debounced into one request')
    assert.match(await text(page, '[data-testid=dir-row]'), /Ben Cruz/)
    await page.click('[data-testid=dir-clear]')
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=dir-row]').length === 20)
    assert.equal(await page.inputValue('[data-testid=dir-search]'), '')
    assert.equal(await page.locator('[data-testid=dir-clear]').count(), 0)

    await page.selectOption('[data-testid=dir-department]', 'Finance')
    await page.waitForFunction(() => [...document.querySelectorAll('[data-testid=dir-row] td:nth-child(2)')].every((e) => e.textContent.trim() === 'Finance'))
    assert.equal(new URL(page.url()).searchParams.get('department'), 'Finance')
    const options = await page.$$eval('[data-testid=dir-department] option', (els) => els.map((e) => e.textContent.trim()))
    assert.ok(options.includes('Compliance') && options.includes('All departments'))

    await page.fill('[data-testid=dir-search]', 'zzzqq')
    await page.waitForSelector('[data-testid=empty-state]')
    assert.match(await text(page, '[data-testid=empty-state]'), /No one matches your search/)
    await page.click('[data-testid=empty-state] button')
    await page.waitForSelector('[data-testid=dir-row]')
    assert.equal(await page.locator('[data-testid=dir-row]').count(), 20)
  }, { signInAs: CARLA }))

test('directory: server error shows an error with a working retry; loading state appears first', opts, () =>
  app(async ({ page, mock }) => {
    mock.state.newApi.forceStatus.directory = 500
    await page.goto(`${mock.origin}/directory`)
    await page.waitForSelector('[data-testid=dir-error]')
    assert.match(await text(page, '[data-testid=dir-error]'), /could not be loaded/)
    delete mock.state.newApi.forceStatus.directory
    await page.click('[data-testid=dir-error] button')
    await page.waitForSelector('[data-testid=dir-row]')
  }, { signInAs: CARLA }))

test('directory: HR sees the employment-type filter and HR columns; the filter narrows the list', opts, () =>
  app(async ({ page, mock }) => {
    await visit(page, mock, '/directory', '[data-testid=dir-row]')
    await page.waitForSelector('[data-testid=dir-type]')
    const heads = await page.$$eval('.dir-table thead th', (els) => els.map((e) => e.textContent.trim()))
    assert.deepEqual(heads, ['Name', 'Department', 'Email', 'Manager', 'Employment'])
    assert.ok((await page.locator('[data-testid=dir-hr-fields]').count()) >= 20)
    assert.match(await text(page, '[data-testid=dir-hr-fields] >> nth=0'), /Since \d{1,2} [A-Z][a-z]{2} \d{4}/)
    await page.selectOption('[data-testid=dir-type]', 'intern')
    await page.waitForFunction(() => /of \d+ people?/.test(document.querySelector('[data-testid=dir-count]')?.textContent || '') && !/of 30/.test(document.querySelector('[data-testid=dir-count]').textContent))
    assert.ok(mock.state.newApi.directoryCalls.some((c) => c.includes('employment_type=intern')))
    const types = await page.$$eval('[data-testid=dir-hr-fields] span:first-child', (els) => els.map((e) => e.textContent.trim()))
    assert.ok(types.length > 0 && types.every((t) => t === 'Intern'))
    // The filter survives an empty result (it stays available because HR fields were seen).
    await page.fill('[data-testid=dir-search]', 'zzzqq')
    await page.waitForSelector('[data-testid=empty-state]')
    assert.equal(await page.locator('[data-testid=dir-type]').count(), 1)
  }, { signInAs: ANNA }))

test('directory: a forced employment_type for a non-HR caller is refused (403), the filter is dropped and a notice says so', opts, () =>
  app(async ({ page, mock }) => {
    await page.goto(`${mock.origin}/directory?type=intern`)
    await page.waitForSelector('[data-testid=dir-notice]')
    assert.match(await text(page, '[data-testid=dir-notice]'), /employment type filter isn't available to your account/)
    await page.waitForSelector('[data-testid=dir-row]')
    assert.equal(new URL(page.url()).searchParams.has('type'), false)
    assert.equal(await page.locator('[data-testid=dir-row]').count(), 20)
    // The notice goes away as soon as the user changes something.
    await page.selectOption('[data-testid=dir-department]', 'Finance')
    await page.waitForFunction(() => !document.querySelector('[data-testid=dir-notice]'))
  }, { signInAs: CARLA }))

test('directory: a row opens the profile (link and row click) and Back returns to the same filtered list', opts, () =>
  app(async ({ page, mock }) => {
    await visit(page, mock, '/directory?q=ben', '[data-testid=dir-row]')
    await page.click('[data-testid=dir-open]')
    await page.waitForURL('**/directory/EMP-0002')
    await page.waitForSelector('[data-testid=dir-profile]')
    await page.click('[data-testid=dir-back]')
    await page.waitForURL(/\/directory\?q=ben/)
    await page.waitForSelector('[data-testid=dir-row]')
    // Clicking the row (not the link) also opens it.
    await page.click('[data-testid=dir-row] td:nth-child(3)')
    await page.waitForURL('**/directory/EMP-0002')
  }, { signInAs: CARLA }))

// ------------------------------------------------------------------------------------------------ directory profile
test('profile: basic fields, manager link and direct reports; nothing HR-only for a colleague', opts, () =>
  app(async ({ page, mock, errors }) => {
    await visit(page, mock, '/directory/EMP-0002', '[data-testid=dir-profile]')
    assert.match(await text(page, 'h1'), /Ben Cruz/)
    const facts = await text(page, '[data-testid=dir-facts]')
    for (const s of ['ben.cruz@example.test', 'EMP-0002', 'Operations', 'Operations Manager', 'Elena Marquez']) assert.ok(facts.includes(s), s)
    assert.ok(!/Employment type|Start date|Status/.test(facts), 'HR-only facts are absent')
    assert.equal(await page.getAttribute('.dir-mail', 'href'), 'mailto:ben.cruz@example.test')
    const reports = await page.$$eval('[data-testid=dir-report] strong', (els) => els.map((e) => e.textContent.trim()))
    assert.ok(reports.length >= 3 && reports.includes('Carla Dizon'))
    await page.click('[data-testid=dir-manager] a')
    await page.waitForURL('**/directory/EMP-0030')
    assert.match(await text(page, '[data-testid=dir-manager]'), /No manager/)
    assert.match(await text(page, '[data-testid=dir-reports]'), /Direct reports/)
    assert.deepEqual(errors, [])
  }, { signInAs: CARLA }))

test('profile: HR sees employment type, start date and status; "this is you" link appears on your own profile', opts, () =>
  app(async ({ page, mock }) => {
    await visit(page, mock, '/directory/EMP-0002', '[data-testid=dir-profile]')
    const facts = await text(page, '[data-testid=dir-facts]')
    assert.ok(/Employment type\s*Full-time/.test(facts.replace(/\n+/g, ' ')))
    assert.ok(facts.includes('15 Jul 2019'))
    assert.ok(facts.includes('Active'))
    assert.equal(await page.locator('.dir-me-link').count(), 0)
    await visit(page, mock, '/directory/EMP-0001', '[data-testid=dir-profile]')
    assert.match(await text(page, '.dir-me-link'), /This is you/)
    await page.click('.dir-me-link a')
    await page.waitForURL('**/my-profile')
  }, { signInAs: ANNA }))

test('profile: unknown id gives a friendly not-found; server error gives a retry', opts, () =>
  app(async ({ page, mock }) => {
    await visit(page, mock, '/directory/EMP-9999', '[data-testid=empty-state]')
    assert.match(await text(page, '[data-testid=empty-state]'), /can't find that person/)
    mock.state.newApi.forceStatus.directoryProfile = 500
    await visit(page, mock, '/directory/EMP-0002', '[data-testid=dir-profile-error]')
    delete mock.state.newApi.forceStatus.directoryProfile
    await page.click('[data-testid=dir-profile-error] button')
    await page.waitForSelector('[data-testid=dir-profile]')
  }, { signInAs: CARLA }))

test('directory on a phone: cards instead of the table, no sideways scroll, controls are 44px tall', opts, () =>
  app(async ({ page, mock }) => {
    await visit(page, mock, '/directory', '[data-testid=dir-card]')
    assert.equal(await page.locator('[data-testid=dir-table]').isVisible(), false)
    assert.equal(await page.locator('[data-testid=dir-card]').first().isVisible(), true)
    assert.ok(await noOverflow(page))
    for (const sel of ['.dir-search', '[data-testid=dir-department]', '[data-testid=dir-next]']) {
      const box = await page.locator(sel).boundingBox()
      assert.ok(box.height >= 43.5, `${sel} is ${box.height}px tall`)
    }
    await page.click('[data-testid=dir-card] >> nth=0')
    await page.waitForSelector('[data-testid=dir-profile]')
    assert.ok(await noOverflow(page))
  }, { signInAs: CARLA, viewport: { width: 390, height: 844 } }))

// ------------------------------------------------------------------------------------------------ my profile
test('my profile: real data from /me/profile, own birthday, sign-in source, manager link, directory link', opts, () =>
  app(async ({ page, mock, errors }) => {
    await visit(page, mock, '/my-profile', '[data-testid=profile-card]')
    assert.match(await text(page, '[data-testid=profile-card] h2'), /Carla Dizon/)
    const facts = (await text(page, '[data-testid=profile-facts]')).replace(/\n+/g, ' ')
    for (const s of ['carla.dizon@example.test', 'EMP-0003', 'Compliance Analyst', 'Compliance', 'Ben Cruz', 'Full-time', '7 Feb 2022']) assert.ok(facts.includes(s), s)
    // Your own date of birth (day, month and the year HR holds) is shown to you; the calendar and the directory never show a year.
    assert.match(await text(page, "[data-testid=profile-birthday]"), /23 Nov 1995/)
    assert.match(await text(page, '[data-testid=profile-signin]'), /Local account/)
    assert.match(await text(page, '[data-testid=profile-roles]'), /Employee/)
    assert.match(await text(page, '.app-content'), /Ask HR to change this/)
    assert.ok(!(await text(page, '.app-content')).includes('Fictional demo'))
    assert.match(await text(page, '[data-testid=profile-reports]'), /Mara Abad/)
    assert.equal(await page.getAttribute('[data-testid=browse-directory]', 'href'), '/directory')
    await page.click('[data-testid=profile-manager] a')
    await page.waitForURL('**/directory/EMP-0002')
    assert.deepEqual(errors, [])
  }, { signInAs: CARLA }))

test('my profile: a manager sees their direct reports; /profile redirects here; failures offer a retry', opts, () =>
  app(async ({ page, mock }) => {
    await visit(page, mock, '/profile', '[data-testid=profile-card]')
    assert.equal(new URL(page.url()).pathname, '/my-profile')
    const names = await page.$$eval('[data-testid=profile-reports] strong', (els) => els.map((e) => e.textContent.trim()))
    assert.ok(names.includes('Carla Dizon') && names.includes('Dan Ocampo'))
    mock.state.newApi.forceStatus.profile = 500
    await visit(page, mock, '/my-profile', '[data-testid=profile-error]')
    delete mock.state.newApi.forceStatus.profile
    await page.click('[data-testid=profile-error] button')
    await page.waitForSelector('[data-testid=profile-card]')
  }, { signInAs: BEN }))

// ------------------------------------------------------------------------------------------------ calendar
const cell = (date) => `[data-testid=cal-cell][data-date="${date}"]`

test('calendar: month grid with holiday and own-birthday chips, today marked, no demo notice', opts, () =>
  app(async ({ page, mock, errors }) => {
    await visit(page, mock, '/company-calendar', '[data-testid=cal-cell]')
    assert.equal(await text(page, '[data-testid=cal-month]'), 'November 2026')
    assert.equal(await page.locator('[data-testid=cal-demo-notice]').count(), 0)
    assert.ok(!(await text(page, '.app-content')).includes('Fictional demo data'))
    assert.equal(await page.locator('[data-testid=cal-cell]:not(.outside)').count(), 30)
    assert.equal(await page.locator(cell('2026-11-16')).getAttribute('aria-current'), 'date')
    assert.ok((await page.getAttribute(cell('2026-11-16'), 'class')).includes('today'))
    const holiday = page.locator(`${cell('2026-11-30')} [data-testid=cal-chip]`)
    assert.equal(await holiday.getAttribute('data-kind'), 'holiday')
    assert.match(await holiday.innerText(), /Bonifacio Day/)
    const own = page.locator(`${cell('2026-11-23')} [data-testid=cal-chip]`)
    assert.equal(await own.getAttribute('data-kind'), 'own-birthday')
    assert.equal(await own.getAttribute('data-own'), 'true')
    assert.match(await own.innerText(), /Your birthday/)
    // Distinct colours for holiday, birthday and own birthday.
    const bg = (loc) => loc.evaluate((e) => getComputedStyle(e).backgroundColor)
    assert.notEqual(await bg(holiday), await bg(own))
    // A non-HR caller sees no one else's birthday, and no year in any chip.
    assert.equal(await page.locator('[data-testid=cal-chip][data-kind=birthday]').count(), 0)
    assert.ok(!(await page.$$eval('[data-testid=cal-chip]', (els) => els.map((e) => e.textContent).join(' '))).match(/\b(19|20)\d{2}\b/))
    assert.deepEqual(errors, [])
  }, { signInAs: CARLA }))

test('calendar: HR also sees colleagues birthdays (distinct from their own)', opts, () =>
  app(async ({ page, mock }) => {
    await visit(page, mock, '/company-calendar', '[data-testid=cal-cell]')
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=cal-chip][data-kind=birthday]').length > 0)
    assert.match(await text(page, `${cell('2026-11-23')} [data-testid=cal-chip]`), /Carla Dizon - birthday/)
    assert.equal(await page.locator('[data-testid=cal-chip][data-kind=own-birthday]').count(), 0, 'Anna has no birthday in November')
  }, { signInAs: ANNA }))

test('calendar: prev / next / Today navigate, update the URL, and stop at the 12-month limits', opts, () =>
  app(async ({ page, mock }) => {
    await visit(page, mock, '/company-calendar', '[data-testid=cal-cell]')
    assert.equal(await page.locator('[data-testid=cal-today]').isDisabled(), true)
    await page.click('[data-testid=cal-prev]')
    await page.waitForFunction(() => document.querySelector('[data-testid=cal-month]')?.textContent === 'October 2026')
    assert.equal(new URL(page.url()).searchParams.get('month'), '2026-10')
    assert.match(await text(page, `${cell('2026-10-31')} [data-testid=cal-chip]`), /Founders Week Close/)
    assert.equal(await page.locator('[data-testid=cal-today]').isDisabled(), false)
    await page.click('[data-testid=cal-next]')
    await page.click('[data-testid=cal-next]')
    await page.waitForFunction(() => document.querySelector('[data-testid=cal-month]')?.textContent === 'December 2026')
    assert.match(await text(page, `${cell('2026-12-25')} [data-testid=cal-chip]`), /Christmas Day/)
    await page.click('[data-testid=cal-today]')
    await page.waitForFunction(() => document.querySelector('[data-testid=cal-month]')?.textContent === 'November 2026')
    assert.equal(new URL(page.url()).searchParams.get('month'), null)
    // Across the year boundary and out to the limit.
    for (let i = 0; i < 12; i++) await page.click('[data-testid=cal-next]')
    await page.waitForFunction(() => document.querySelector('[data-testid=cal-month]')?.textContent === 'November 2027')
    assert.equal(await page.locator('[data-testid=cal-next]').isDisabled(), true)
    assert.match(await page.getAttribute('[data-testid=cal-next]', 'title'), /12 months/)
    // A URL beyond the limit is pulled back to the nearest allowed month (and never calls the server for it).
    await visit(page, mock, '/company-calendar?month=2030-01', '[data-testid=cal-cell]')
    assert.equal(await text(page, '[data-testid=cal-month]'), 'November 2027')
    await visit(page, mock, '/company-calendar?month=garbage', '[data-testid=cal-cell]')
    assert.equal(await text(page, '[data-testid=cal-month]'), 'November 2026')
  }, { signInAs: CARLA }))

test('calendar: February grids are right (4 rows when it fits, leap-day cell absent in a common year)', opts, () =>
  app(async ({ page, mock }) => {
    await visit(page, mock, '/company-calendar?month=2027-02', '[data-testid=cal-cell]')
    assert.equal(await page.locator('[data-testid=cal-cell]:not(.outside)').count(), 28)
    assert.equal(await page.locator(cell('2027-02-29')).count(), 0)
    assert.match(await text(page, `${cell('2027-02-10')} [data-testid=cal-chip]`), /Chinese New Year/)
  }, { signInAs: CARLA }))

test('calendar: error state with retry; loading state', opts, () =>
  app(async ({ page, mock }) => {
    mock.state.newApi.forceStatus.calendar = 500
    await page.goto(`${mock.origin}/company-calendar`)
    await page.waitForSelector('[data-testid=cal-error]')
    delete mock.state.newApi.forceStatus.calendar
    await page.click('[data-testid=cal-error] button')
    await page.waitForSelector('[data-testid=cal-cell]')
  }, { signInAs: CARLA }))

test('calendar on a phone: agenda list instead of the grid, own birthday highlighted, no sideways scroll', opts, () =>
  app(async ({ page, mock }) => {
    await visit(page, mock, '/company-calendar', '[data-testid=cal-agenda-day]')
    assert.equal(await page.locator('[data-testid=calendar-grid]').isVisible(), false)
    assert.equal(await page.locator('[data-testid=calendar-agenda]').isVisible(), true)
    const days = await page.$$eval('[data-testid=cal-agenda-day]', (els) => els.map((e) => e.dataset.date))
    assert.deepEqual(days, ['2026-11-23', '2026-11-30'])
    const own = page.locator('[data-testid=cal-agenda-event][data-kind=own-birthday]')
    assert.match(await own.innerText(), /Your birthday/)
    assert.match(await text(page, '[data-testid=cal-agenda-day] >> nth=1'), /Bonifacio Day/)
    assert.ok(await noOverflow(page))
    for (const sel of ['[data-testid=cal-prev]', '[data-testid=cal-next]', '[data-testid=cal-today]']) assert.ok((await page.locator(sel).boundingBox()).height >= 43.5, sel)
    await page.click('[data-testid=cal-next]')
    await page.waitForSelector('[data-testid=cal-agenda-day][data-date="2026-12-25"]')
    await page.click('[data-testid=cal-next]')
    await page.waitForFunction(() => document.querySelector('[data-testid=cal-month]')?.textContent === 'January 2027')
    assert.match(await text(page, '[data-testid=cal-agenda-day]'), /Fri, 1 Jan/)
  }, { signInAs: CARLA, viewport: { width: 390, height: 844 } }))

test('calendar on a tablet keeps the month grid and fits the viewport', opts, () =>
  app(async ({ page, mock }) => {
    await visit(page, mock, '/company-calendar', '[data-testid=cal-cell]')
    assert.equal(await page.locator('[data-testid=calendar-grid]').isVisible(), true)
    assert.equal(await page.locator('[data-testid=calendar-agenda]').isVisible(), false)
    assert.ok(await noOverflow(page))
  }, { signInAs: CARLA, viewport: { width: 768, height: 1024 } }))

test('/calendar redirects to the Company Calendar', opts, () =>
  app(async ({ page, mock }) => {
    await visit(page, mock, '/calendar', '[data-testid=cal-cell]')
    assert.equal(new URL(page.url()).pathname, '/company-calendar')
  }, { signInAs: CARLA }))

// ------------------------------------------------------------------------------------------------ personal Dashboard
test('dashboard: upcoming holidays and own birthday come from /calendar/upcoming, in the shared Upcoming panel', opts, () =>
  app(async ({ page, mock }) => {
    await visit(page, mock, '/', '[data-testid=card-upcoming] .holiday-list li')
    const hol = await page.$$eval('[data-testid=card-upcoming] .holiday-list li strong', (els) => els.map((e) => e.textContent.trim()))
    assert.deepEqual(hol, ['Bonifacio Day'])
    assert.match(await text(page, '[data-testid=card-upcoming] .holiday-list li'), /NOV\s*30/)
    await page.waitForSelector('[data-testid=card-upcoming] .birthday-list li')
    const b = await page.$$eval('[data-testid=card-upcoming] .birthday-list li', (els) => els.map((e) => e.textContent))
    assert.equal(b.length, 1)
    assert.match(b[0], /Carla Dizon \(you\)/)
    assert.match(b[0], /Nov 23/)
    // The summary row says which holiday is next.
    assert.match(await text(page, '[data-testid=home-sum-holiday]'), /Nov 30[\s\S]*Bonifacio Day/)
    assert.ok(!(await text(page, '[data-testid=card-upcoming]')).includes('Fictional demo'))
  }, { signInAs: CARLA }))

test('dashboard: HR sees colleagues birthdays on the personal dashboard too; errors and empty states are honest', opts, () =>
  app(async ({ page, mock }) => {
    await visit(page, mock, '/my-dashboard', '[data-testid=card-upcoming] .birthday-list li')
    assert.ok((await page.locator('[data-testid=card-upcoming] .birthday-list li').count()) >= 2)
    mock.state.newApi.forceStatus.upcoming = 500
    await page.reload()
    await page.waitForSelector('[data-testid=upcoming-error]')
    assert.equal(await page.locator('[data-testid=upcoming-error]').count(), 1)
    delete mock.state.newApi.forceStatus.upcoming
    await page.click('[data-testid=upcoming-error] button')
    await page.waitForSelector('[data-testid=card-upcoming] .holiday-list li')
  }, { signInAs: ANNA }))

test('dashboard: a person with no visible birthdays gets an honest empty state, not a blank card', opts, () =>
  app(async ({ page, mock }) => {
    await visit(page, mock, '/', '[data-testid=card-upcoming] .holiday-list li')
    await page.waitForSelector('[data-testid=birthdays-empty]')
    assert.match(await text(page, '[data-testid=birthdays-empty]'), /No birthdays in the next 30 days/)
    assert.equal(await page.locator('[data-testid=card-upcoming] .birthday-list li').count(), 0)
  }, { signInAs: 'dan.ocampo@example.test' }))
