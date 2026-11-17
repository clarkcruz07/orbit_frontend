// Leave API module: every call builds exactly the request docs/api/leave.md describes (method, path, query, body).
import test, { before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { loadTs } from './helpers/load-ts.mjs'

let mod
let calls
before(async () => {
  mod = await loadTs('../tests/leave-entry.ts')
  mod.api.defaults.adapter = async (config) => {
    calls.push(config)
    return { data: { ok: true }, status: config.method === 'delete' ? 204 : 200, statusText: 'OK', headers: {}, config }
  }
})
beforeEach(() => {
  calls = []
  mod.useAuthStore.getState().setTokens('tok-abc', 'ref-abc')
})
const last = () => calls[calls.length - 1]
const body = () => JSON.parse(last().data)

test('config and catalog reads', async () => {
  await mod.leaveApi.config()
  assert.equal(last().method, 'get')
  assert.equal(last().url, '/leave/config')
  assert.equal(last().baseURL, '/api')
  await mod.leaveApi.types()
  assert.equal(last().url, '/leave/types')
  assert.equal(last().params, undefined, 'include_inactive is not sent by default')
  await mod.leaveApi.types(true)
  assert.deepEqual(last().params, { include_inactive: true })
})

test('catalog writes: create, patch, delete build the HR requests and URL-encode ids', async () => {
  await mod.leaveApi.createType({ name: 'Study', paid: true, annual_days: 5, requires_reason: true })
  assert.equal(last().method, 'post')
  assert.equal(last().url, '/leave/types')
  assert.deepEqual(body(), { name: 'Study', paid: true, annual_days: 5, requires_reason: true })
  await mod.leaveApi.patchType('a/b c', { active: false })
  assert.equal(last().method, 'patch')
  assert.equal(last().url, '/leave/types/a%2Fb%20c')
  assert.deepEqual(body(), { active: false })
  await mod.leaveApi.deleteType('study')
  assert.equal(last().method, 'delete')
  assert.equal(last().url, '/leave/types/study')
})

test('entitlement overrides: list filters are dropped when empty, upsert body, delete uses all three query params', async () => {
  await mod.leaveApi.entitlements({})
  assert.deepEqual(last().params, {})
  await mod.leaveApi.entitlements({ year: 2026, employee_id: '', type_id: undefined })
  assert.deepEqual(last().params, { year: 2026 })
  await mod.leaveApi.setEntitlement({ employee_id: 'EMP-0005', type_id: 'vacation', year: 2026, days: 20 })
  assert.equal(last().method, 'post')
  assert.equal(last().url, '/leave/entitlements')
  assert.deepEqual(body(), { employee_id: 'EMP-0005', type_id: 'vacation', year: 2026, days: 20 })
  await mod.leaveApi.removeEntitlement({ employee_id: 'EMP-0005', type_id: 'vacation', year: 2026 })
  assert.equal(last().method, 'delete')
  assert.equal(last().url, '/leave/entitlements')
  assert.deepEqual(last().params, { employee_id: 'EMP-0005', type_id: 'vacation', year: 2026 })
})

test('balances: year and employee only when given', async () => {
  await mod.leaveApi.balances()
  assert.equal(last().url, '/leave/balances')
  assert.deepEqual(last().params, {})
  await mod.leaveApi.balances(2027)
  assert.deepEqual(last().params, { year: 2027 })
  await mod.leaveApi.balances(2026, 'EMP-0005')
  assert.deepEqual(last().params, { year: 2026, employee_id: 'EMP-0005' })
})

test('preview is a GET with the four query fields and an abort signal', async () => {
  const ctl = new AbortController()
  await mod.leaveApi.preview({ type_id: 'vacation', start_date: '2026-11-23', end_date: '2026-11-25', half_day: 'none' }, ctl.signal)
  assert.equal(last().method, 'get')
  assert.equal(last().url, '/leave/preview')
  assert.deepEqual(last().params, { type_id: 'vacation', start_date: '2026-11-23', end_date: '2026-11-25', half_day: 'none' })
  assert.equal(last().signal, ctl.signal)
})

test('team calendar: month only when given', async () => {
  await mod.leaveApi.team()
  assert.equal(last().url, '/leave/team')
  assert.deepEqual(last().params, {})
  await mod.leaveApi.team('2026-12')
  assert.deepEqual(last().params, { month: '2026-12' })
})

test('list: scope always sent; empty filters dropped; paging passed through', async () => {
  await mod.leaveApi.list({ scope: 'mine' })
  assert.equal(last().url, '/leave/requests')
  assert.deepEqual(last().params, { scope: 'mine' })
  await mod.leaveApi.list({ scope: 'review', status: '', type_id: undefined, year: undefined, page: 2, page_size: 10 })
  assert.deepEqual(last().params, { scope: 'review', page: 2, page_size: 10 })
  await mod.leaveApi.list({ scope: 'all', status: 'pending', type_id: 'sick', year: 2026, employee_id: 'EMP-0005' })
  assert.deepEqual(last().params, { scope: 'all', status: 'pending', type_id: 'sick', year: 2026, employee_id: 'EMP-0005' })
})

test('create / get / patch build the contract requests; ids are URL-encoded', async () => {
  await mod.leaveApi.create({ type_id: 'vacation', start_date: '2026-11-23', end_date: '2026-11-25', half_day: 'none', reason: null })
  assert.equal(last().method, 'post')
  assert.equal(last().url, '/leave/requests')
  assert.deepEqual(body(), { type_id: 'vacation', start_date: '2026-11-23', end_date: '2026-11-25', half_day: 'none', reason: null })
  await mod.leaveApi.get('a/b c')
  assert.equal(last().url, '/leave/requests/a%2Fb%20c')
  await mod.leaveApi.patch('abc', { version: 3, end_date: '2026-11-26', reason: null })
  assert.equal(last().method, 'patch')
  assert.equal(last().url, '/leave/requests/abc')
  assert.deepEqual(body(), { version: 3, end_date: '2026-11-26', reason: null })
})

test('resubmit and cancel: POST, optional {version} body', async () => {
  await mod.leaveApi.resubmit('abc', 4)
  assert.equal(last().method, 'post')
  assert.equal(last().url, '/leave/requests/abc/resubmit')
  assert.deepEqual(body(), { version: 4 })
  await mod.leaveApi.resubmit('abc')
  assert.equal(last().data, undefined)
  await mod.leaveApi.cancel('abc', 7)
  assert.equal(last().url, '/leave/requests/abc/cancel')
  assert.deepEqual(body(), { version: 7 })
})

test('decision: action + comment + version; an approval without a comment omits it (the field is optional)', async () => {
  await mod.leaveApi.decide('abc', 'reject', 'Not this week', 2)
  assert.equal(last().method, 'post')
  assert.equal(last().url, '/leave/requests/abc/decision')
  assert.deepEqual(body(), { action: 'reject', comment: 'Not this week', version: 2 })
  await mod.leaveApi.decide('abc', 'approve', null, 5)
  assert.deepEqual(body(), { action: 'approve', version: 5 })
  await mod.leaveApi.decide('abc', 'clarify', 'Which dates?')
  assert.deepEqual(body(), { action: 'clarify', comment: 'Which dates?' })
})

test('every call carries the Bearer token from the shared client', async () => {
  await mod.leaveApi.config()
  assert.equal(last().headers.get('Authorization'), 'Bearer tok-abc')
})
