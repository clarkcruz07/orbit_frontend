// Mock-API browser tests for the Microsoft directory sync on the People pages: the HR card (last sync, Sync now, running, not connected,
// failures), the Microsoft pill and the "Left Microsoft directory" hint. The mock (peoplemgmt-mock.mjs) plays "the server".
// Gated: RUN_BROWSER_TESTS=1. Fictional data only.
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { launchBrowser } from './browser-env.mjs'
import { U } from './peoplemgmt-mock.mjs'
import { callsTo, hasText, noOverflow, opts, text, withApp, enabled } from './peoplemgmt-helpers.mjs'

let browser
before(async () => {
  if (enabled) browser = await launchBrowser()
})
after(async () => {
  await browser?.close()
})
const app = (user, fn, o) => withApp(browser, user, fn, o)
const CARD = '[data-testid=entra-sync]'
const view = (v) => `${CARD}[data-view=${v}]`

test('HR sees the Microsoft directory card with the last sync in plain numbers and the next sync time', opts, () =>
  app(U.anna, async ({ page, errors, go }) => {
    await go('/people', view('synced'))
    const t = await text(page, CARD)
    assert.match(t, /Microsoft directory/)
    assert.match(await text(page, '[data-testid=sync-status]'), /^Last synced 5 minutes ago: 3 added, 2 updated, 1 left\.$/)
    assert.match(await text(page, '[data-testid=sync-next]'), /^Next sync in 3 hours\.$/)
    assert.equal(await page.isDisabled('[data-testid=sync-now]'), false)
    assert.equal(await page.getAttribute('[data-testid=sync-status]', 'role'), 'status', 'the status line is a live region')
    assert.deepEqual(errors, [])
  }))

test('Sync now starts a run, shows it running, then shows the new numbers and reloads the list', opts, () =>
  app(
    U.anna,
    async ({ page, mock, errors, go }) => {
      await go('/people', view('synced'))
      await hasText(page, '[data-testid=people-count]', /of 30 people/)
      const listCalls = callsTo(mock, 'GET', '/people/employees').length
      await page.click('[data-testid=sync-now]')
      await page.waitForSelector(view('running'))
      assert.match(await text(page, CARD), /Syncing with Microsoft/)
      assert.equal(await page.isDisabled('[data-testid=sync-now]'), true, 'no second run while one is going')
      assert.equal(callsTo(mock, 'POST', '/people/entra-sync/run').length, 1)
      await page.waitForSelector(view('synced'), { timeout: 20000 })
      assert.match(await text(page, '[data-testid=sync-status]'), /Last synced (just now|1 minute ago): 1 added, 4 updated, 0 left\./)
      assert.ok(callsTo(mock, 'GET', '/people/employees').length > listCalls, 'the people list was asked again')
      await hasText(page, '[data-testid=people-count]', /of 31 people/)
      assert.equal(await page.isDisabled('[data-testid=sync-now]'), false)
      assert.deepEqual(errors, [])
    },
    { setup: (m) => (m.state.entra.runPolls = 1) },
  ))

test('a sync another HR person started is followed to the end, and the list reloads when it is done', opts, () =>
  app(
    U.anna,
    async ({ page, mock, errors, go }) => {
      await go('/people', view('running'))
      assert.equal(await page.isDisabled('[data-testid=sync-now]'), true)
      await page.waitForSelector(view('synced'), { timeout: 20000 })
      await hasText(page, '[data-testid=people-count]', /of 31 people/)
      assert.equal(callsTo(mock, 'POST', '/people/entra-sync/run').length, 0, 'this page never started it')
      assert.deepEqual(errors, [])
    },
    { setup: (m) => Object.assign(m.state.entra, { state: 'running', pollsLeft: 1 }) },
  ))

test('"already running" from the server is not an error: the card just follows the run', opts, () =>
  app(U.anna, async ({ page, mock, errors, go }) => {
    await go('/people', view('synced'))
    mock.state.respondOnce['POST /people/entra-sync/run'] = { status: 409, body: { code: 'already_running', detail: 'A sync is already running' } }
    await page.click('[data-testid=sync-now]')
    await page.waitForSelector(view('running'))
    assert.equal(await page.locator('[data-testid=sync-notice]').count(), 0, 'no error is shown')
    await page.waitForSelector(view('synced'), { timeout: 20000 })
    assert.equal(await page.locator('[data-testid=sync-notice]').count(), 0)
    assert.deepEqual(errors, [])
  }))

test('not connected: a plain explanation and the server hint, and no Sync button', opts, () =>
  app(
    U.anna,
    async ({ page, errors, go }) => {
      await go('/people', view('not_configured'))
      assert.match(await text(page, '[data-testid=sync-status]'), /Microsoft directory sync is not connected yet\./)
      assert.match(await text(page, '[data-testid=sync-hint]'), /Set the sync client in the app settings/)
      assert.match(await text(page, CARD), /Ask your administrator to connect Microsoft directory sync\./)
      assert.equal(await page.locator('[data-testid=sync-now]').count(), 0)
      assert.equal(await page.locator('[data-testid=sync-next]').count(), 0)
      assert.deepEqual(errors, [])
    },
    { setup: (m) => Object.assign(m.state.entra, { configured: false, enabled: false, last: null, next_run_at: null, setup_hint: 'Set the sync client in the app settings, then restart.' }) },
  ))

test('"not connected" from the server on Sync now turns the card into the not-connected state with the server hint', opts, () =>
  app(U.anna, async ({ page, mock, errors, go }) => {
    await go('/people', view('synced'))
    Object.assign(mock.state.entra, { configured: false, setup_hint: 'Grant User.Read.All to the sync app.' })
    await page.click('[data-testid=sync-now]')
    await page.waitForSelector(view('not_configured'))
    assert.match(await text(page, '[data-testid=sync-hint]'), /Grant User\.Read\.All to the sync app\./)
    assert.equal(await page.locator('[data-testid=sync-now]').count(), 0)
    assert.deepEqual(errors, [])
  }))

const FAILURES = [
  ['graph_auth_failed', /^Microsoft rejected the sync credentials\.$/],
  ['graph_forbidden', /^The app is not allowed to read the user list yet\. An administrator must grant User\.Read\.All\.$/],
  ['graph_unavailable', /^Microsoft could not be reached\. It will retry automatically\.$/],
  ['graph_invalid', /^Microsoft sent an answer the app could not read\.$/],
  ['partial_directory', /^Microsoft returned far fewer people than before, so nobody was marked as left\. Check the sync settings\.$/],
]
for (const [code, re] of FAILURES) {
  test(`a failed sync (${code}) is explained in plain words, with Sync now to try again`, opts, () =>
    app(
      U.anna,
      async ({ page, errors, go }) => {
        await go('/people', view('failed'))
        assert.match(await text(page, '[data-testid=sync-error]'), re)
        assert.match(await text(page, CARD), /Last attempt 5 minutes ago\./)
        assert.ok(!/graph_|partial_directory/.test(await text(page, CARD)), 'no raw error code on screen')
        assert.equal(await page.isDisabled('[data-testid=sync-now]'), false)
        assert.deepEqual(errors, [])
      },
      { setup: (m) => (m.state.entra.last = { ...m.state.entra.last, ok: false, error_code: code, counts: { fetched: 0, created: 0, updated: 0, deactivated: 0, reactivated: 0, skipped: 0 } }) },
    ))
}

test('a run that ends in a failure shows its message once it is done', opts, () =>
  app(
    U.anna,
    async ({ page, errors, go }) => {
      await go('/people', view('synced'))
      await page.click('[data-testid=sync-now]')
      await page.waitForSelector(view('failed'), { timeout: 20000 })
      assert.match(await text(page, '[data-testid=sync-error]'), /Microsoft could not be reached/)
      assert.deepEqual(errors, [])
    },
    { setup: (m) => Object.assign(m.state.entra, { runPolls: 0, outcome: 'graph_unavailable' }) },
  ))

test('when the status cannot be loaded the card says so and Try again works; other HR pages are unaffected', opts, () =>
  app(U.anna, async ({ page, mock, go }) => {
    mock.state.force['GET /people/entra-sync/status'] = 500
    await go('/people', '[data-testid=sync-load-error]')
    assert.match(await text(page, '[data-testid=sync-load-error]'), /could not be loaded/)
    assert.ok((await page.locator('[data-testid=people-row]').count()) > 0, 'the people list still works')
    delete mock.state.force['GET /people/entra-sync/status']
    await page.click('[data-testid=sync-load-error] button')
    await page.waitForSelector(view('synced'))
  }))

test('someone who is not HR sees no card and the sync is never asked about', opts, () =>
  app(U.carla, async ({ page, mock, go }) => {
    await go('/people', '[data-testid=people-denied]')
    assert.equal(await page.locator(CARD).count(), 0)
    assert.equal(await page.locator('[data-testid=sync-loading]').count(), 0)
    assert.equal(callsTo(mock, 'GET', '/people/entra-sync/status').length, 0)
  }))

test('the Microsoft pill shows for people who came from Entra, and a person the sync marked as gone says so', opts, () =>
  app(U.anna, async ({ page, mock, errors, go }) => {
    const find = (id) => mock.state.people.find((p) => p.employee.employee_id === id).employee
    const synced = find('EMP-0100')
    const gone = find('EMP-0107')
    Object.assign(synced, { source: 'entra' })
    Object.assign(gone, { source: 'entra', left_reason: 'entra_sync' })
    // the list: a person from Entra has the pill (and only that person), in the table and in the cards
    await go(`/people?q=${encodeURIComponent(synced.email)}`, '[data-testid=people-row]')
    assert.equal(await page.locator('[data-testid=people-row] [data-testid=source-pill]').count(), 1)
    assert.equal((await text(page, '[data-testid=people-row] [data-testid=source-pill]')).trim(), 'Microsoft')
    assert.equal(await page.getAttribute('[data-testid=people-row] [data-testid=source-pill]', 'title'), 'Synced from Microsoft Entra')
    assert.equal(await page.locator('[data-testid=people-card] [data-testid=source-pill]').count(), 1)
    // a person who was not synced has none
    await go('/people?q=anna.reyes', '[data-testid=people-row]')
    assert.equal(await page.locator('[data-testid=source-pill]').count(), 0)
    // the person who left Microsoft: the usual Left status plus the hint
    await go(`/people?q=${encodeURIComponent(gone.email)}`, '[data-testid=people-row]')
    assert.match(await text(page, '[data-testid=people-row] [data-testid=status-pill]'), /Left/)
    assert.match(await text(page, '[data-testid=people-row] [data-testid=left-directory-hint]'), /^Left Microsoft directory$/)
    // the person page
    await go('/people/EMP-0100', '[data-testid=person-detail]')
    assert.equal((await text(page, '[data-testid=details-card] [data-testid=source-pill]')).trim(), 'Microsoft')
    assert.equal(await page.locator('[data-testid=left-directory-hint]').count(), 0)
    await go('/people/EMP-0107', '[data-testid=person-detail]')
    assert.match(await text(page, '[data-testid=details-card] [data-testid=left-directory-hint]'), /^Left Microsoft directory$/)
    assert.ok(await noOverflow(page))
    assert.deepEqual(errors, [])
  }))
