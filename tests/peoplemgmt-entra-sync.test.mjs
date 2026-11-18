import test, { before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { loadTs } from './helpers/load-ts.mjs'

let s
let apiMod
let calls
let respond
before(async () => {
  s = await loadTs('modules/peoplemgmt/entraSync.ts')
  apiMod = await loadTs('../tests/peoplemgmt-api-entry.ts')
  apiMod.api.defaults.adapter = async (config) => {
    calls.push(config)
    const r = respond(config)
    if (r.status >= 400) {
      const err = new Error(`HTTP ${r.status}`)
      err.response = { status: r.status, data: r.data, config }
      err.config = config
      throw err
    }
    return { data: r.data, status: r.status, statusText: 'OK', headers: {}, config }
  }
})
beforeEach(() => {
  calls = []
  respond = () => ({ status: 200, data: {} })
  apiMod.useAuthStore.getState().setTokens('tok-abc', 'ref-abc')
})

const NOW = new Date('2026-11-17T12:00:00.000Z')
const ago = (ms) => new Date(NOW.getTime() - ms).toISOString()
const ahead = (ms) => new Date(NOW.getTime() + ms).toISOString()
const MIN = 60000
const HOUR = 60 * MIN
const full = (over = {}) => ({
  configured: true,
  enabled: true,
  state: 'idle',
  interval_hours: 6,
  last: { started_at: ago(6 * MIN), finished_at: ago(5 * MIN), ok: true, error_code: null, counts: { fetched: 30, created: 3, updated: 2, deactivated: 1, reactivated: 0, skipped: 0 } },
  next_run_at: ahead(3 * HOUR),
  setup_hint: null,
  ...over,
})

test('the status reader is tolerant: anything missing or odd reads as idle, not connected, never ran', () => {
  for (const raw of [undefined, null, {}, 'x', 7, []]) {
    const st = s.normaliseSyncStatus(raw)
    assert.deepEqual(st, { configured: false, enabled: false, state: 'idle', interval_hours: null, last: null, next_run_at: null, setup_hint: null })
  }
  const odd = s.normaliseSyncStatus({ configured: 'yes', enabled: 1, state: 'weird', interval_hours: -3, last: { ok: 'true', counts: { created: -2, updated: 'x', deactivated: 4.8 } }, next_run_at: '', setup_hint: '  ' })
  assert.equal(odd.configured, false)
  assert.equal(odd.enabled, false)
  assert.equal(odd.state, 'idle')
  assert.equal(odd.interval_hours, null)
  assert.equal(odd.last.ok, false, 'only a real true counts as ok')
  assert.deepEqual(odd.last.counts, { fetched: 0, created: 0, updated: 0, deactivated: 4, reactivated: 0, skipped: 0 })
  assert.equal(odd.next_run_at, null)
  assert.equal(odd.setup_hint, null)
  const good = s.normaliseSyncStatus(full({ state: 'running', setup_hint: 'Set PEOPLE_ENTRA_SYNC' }))
  assert.equal(good.state, 'running')
  assert.equal(good.last.counts.created, 3)
  assert.equal(good.setup_hint, 'Set PEOPLE_ENTRA_SYNC')
  assert.equal(good.interval_hours, 6)
})

test('which view: not connected, running, failed, synced, never', () => {
  const v = (over) => s.syncView(s.normaliseSyncStatus(full(over)))
  assert.equal(v({ configured: false }), 'not_configured')
  assert.equal(v({ configured: false, state: 'running' }), 'not_configured', 'not connected wins')
  assert.equal(v({ state: 'running' }), 'running')
  assert.equal(v({ state: 'running', last: { ok: false, error_code: 'graph_unavailable' } }), 'running', 'a run in progress hides the old failure')
  assert.equal(v({ last: { ok: false, error_code: 'graph_forbidden' } }), 'failed')
  assert.equal(v({}), 'synced')
  assert.equal(v({ last: null }), 'never')
})

test('every error code has its own plain sentence and an unknown code never shows a raw code', () => {
  assert.equal(s.syncErrorMessage('graph_auth_failed'), 'Microsoft rejected the sync credentials.')
  assert.equal(s.syncErrorMessage('graph_forbidden'), 'The app is not allowed to read the user list yet. An administrator must grant User.Read.All.')
  assert.equal(s.syncErrorMessage('graph_unavailable'), 'Microsoft could not be reached. It will retry automatically.')
  assert.equal(s.syncErrorMessage('graph_invalid'), 'Microsoft sent an answer the app could not read.')
  assert.equal(s.syncErrorMessage('partial_directory'), 'Microsoft returned far fewer people than before, so nobody was marked as left. Check the sync settings.')
  assert.match(s.syncErrorMessage('not_configured'), /not connected/)
  for (const odd of ['made_up_code', '', null, undefined]) {
    assert.equal(s.syncErrorMessage(odd), s.SYNC_ERROR_FALLBACK)
    assert.ok(!/_/.test(s.syncErrorMessage(odd)))
  }
})

test('whenText: past and future, in plain units, then a date once it is a week away', () => {
  assert.equal(s.whenText(ago(10 * 1000), NOW), 'just now')
  assert.equal(s.whenText(ago(5 * MIN), NOW), '5 minutes ago')
  assert.equal(s.whenText(ago(60 * 1000 + 5000), NOW), '1 minute ago')
  assert.equal(s.whenText(ago(1 * HOUR + 2 * MIN), NOW), '1 hour ago')
  assert.equal(s.whenText(ago(5 * HOUR), NOW), '5 hours ago')
  assert.equal(s.whenText(ago(30 * HOUR), NOW), 'yesterday')
  assert.equal(s.whenText(ago(3 * 24 * HOUR), NOW), '3 days ago')
  assert.equal(s.whenText(ago(20 * 24 * HOUR), NOW), '28 Oct 2026')
  assert.equal(s.whenText(ahead(10 * 1000), NOW), 'in a moment')
  assert.equal(s.whenText(ahead(3 * HOUR), NOW), 'in 3 hours')
  assert.equal(s.whenText(ahead(25 * MIN), NOW), 'in 25 minutes')
  assert.equal(s.whenText(ahead(30 * HOUR), NOW), 'tomorrow')
  for (const bad of [null, undefined, '', 'not a date']) assert.equal(s.whenText(bad, NOW), '')
})

test('the last-sync line says what happened in plain numbers', () => {
  const st = s.normaliseSyncStatus(full())
  assert.equal(s.lastSyncSummary(st.last, NOW), 'Last synced 5 minutes ago: 3 added, 2 updated, 1 left.')
  assert.equal(s.lastSyncSummary(null, NOW), 'Not synced yet. Press Sync now to bring in everyone from Microsoft.')
  const noTime = s.normaliseSyncStatus(full({ last: { ok: true, counts: { created: 0, updated: 0, deactivated: 0 } } }))
  assert.equal(s.lastSyncSummary(noTime.last, NOW), 'Last synced recently: 0 added, 0 updated, 0 left.')
  assert.equal(s.lastAttemptText(st.last, NOW), 'Last attempt 5 minutes ago.')
  assert.equal(s.lastAttemptText(null, NOW), '')
})

test('the next-sync line appears only when the sync is connected, on, and the server named a time', () => {
  assert.equal(s.nextSyncText(s.normaliseSyncStatus(full()), NOW), 'Next sync in 3 hours.')
  assert.equal(s.nextSyncText(s.normaliseSyncStatus(full({ enabled: false })), NOW), '')
  assert.equal(s.nextSyncText(s.normaliseSyncStatus(full({ configured: false })), NOW), '')
  assert.equal(s.nextSyncText(s.normaliseSyncStatus(full({ next_run_at: null })), NOW), '')
})

test('Sync now is offered only when connected, idle and not already sending', () => {
  const st = (over) => s.normaliseSyncStatus(full(over))
  assert.equal(s.canSync(st({}), false), true)
  assert.equal(s.canSync(st({}), true), false)
  assert.equal(s.canSync(st({ state: 'running' }), false), false)
  assert.equal(s.canSync(st({ configured: false }), false), false)
})

test('polling: only while running and only for two minutes, every three seconds', () => {
  assert.equal(s.POLL_MS, 3000)
  assert.equal(s.POLL_LIMIT_MS, 120000)
  assert.equal(s.shouldPoll('running', 0), true)
  assert.equal(s.shouldPoll('running', 119999), true)
  assert.equal(s.shouldPoll('running', 120000), false)
  assert.equal(s.shouldPoll('idle', 0), false)
})

test('the Microsoft pill and the "left" hint follow the source and the reason, nothing else', () => {
  assert.equal(s.isEntraSource('entra'), true)
  for (const other of ['hr_created', 'other', '', null, undefined, 'Entra']) assert.equal(s.isEntraSource(other), false)
  assert.equal(s.MICROSOFT_PILL_TITLE, 'Synced from Microsoft Entra')
  assert.equal(s.leftDirectoryHint({ status: 'left', left_reason: 'entra_sync' }), 'Left Microsoft directory')
  assert.equal(s.leftDirectoryHint({ status: 'left', left_reason: null }), null)
  assert.equal(s.leftDirectoryHint({ status: 'active', left_reason: 'entra_sync' }), null)
  assert.equal(s.leftDirectoryHint({}), null)
})

test('the API: status is a GET, run is a POST, both with the Bearer header and no token in the URL', async () => {
  respond = (c) => (c.method === 'get' ? { status: 200, data: full() } : { status: 202, data: { state: 'running' } })
  const st = await apiMod.entraSyncApi.status()
  assert.equal(calls[0].url, '/people/entra-sync/status')
  assert.equal(calls[0].method, 'get')
  assert.equal(st.last.counts.created, 3)
  await apiMod.entraSyncApi.run()
  assert.equal(calls[1].url, '/people/entra-sync/run')
  assert.equal(calls[1].method, 'post')
  for (const c of calls) {
    const auth = typeof c.headers?.get === 'function' ? c.headers.get('Authorization') : c.headers?.Authorization
    assert.equal(auth, 'Bearer tok-abc')
    assert.ok(!/tok-abc|token/i.test(String(c.url)))
  }
})

test('the API: 409 already_running and not_configured and 403 come back as readable failures', async () => {
  respond = () => ({ status: 409, data: { code: 'already_running', detail: 'A sync is already running' } })
  await assert.rejects(apiMod.entraSyncApi.run(), (err) => {
    const f = apiMod.parseFailure(err)
    assert.equal(f.status, 409)
    assert.equal(f.code, 'already_running')
    return true
  })
  respond = () => ({ status: 409, data: { code: 'not_configured', detail: 'Set PEOPLE_ENTRA_SYNC_ENABLED' } })
  await assert.rejects(apiMod.entraSyncApi.run(), (err) => {
    const f = apiMod.parseFailure(err)
    assert.equal(f.code, 'not_configured')
    assert.equal(f.detail, 'Set PEOPLE_ENTRA_SYNC_ENABLED')
    return true
  })
  respond = () => ({ status: 403, data: { detail: 'You do not have access to this resource' } })
  await assert.rejects(apiMod.entraSyncApi.status(), (err) => apiMod.parseFailure(err).status === 403)
})

test('people carry source and left_reason; absent means a plain person', () => {
  const p = apiMod.normalisePerson({ employee: { employee_id: 'E1', name: 'Ana', source: 'entra', status: 'left', left_reason: 'entra_sync' }, account: {} })
  assert.equal(p.employee.source, 'entra')
  assert.equal(p.employee.left_reason, 'entra_sync')
  const q = apiMod.normalisePerson({ employee: { employee_id: 'E2', name: 'Ben' }, account: {} })
  assert.equal(q.employee.source, 'other')
  assert.equal(q.employee.left_reason, null)
})
