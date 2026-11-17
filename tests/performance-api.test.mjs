import test, { before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { loadTs } from './helpers/load-ts.mjs'

let mod
let calls
before(async () => {
  mod = await loadTs('modules/performance/test-entry.ts')
  mod.api.defaults.adapter = async (config) => {
    calls.push(config)
    return { data: { ok: true }, status: 200, statusText: 'OK', headers: {}, config }
  }
})
beforeEach(() => {
  calls = []
  mod.useAuthStore.getState().setTokens('tok-abc', 'ref-abc')
})
const last = () => calls[calls.length - 1]
const body = () => JSON.parse(last().data)

test('config and summary', async () => {
  await mod.performanceApi.config()
  assert.equal(last().url, '/performance/config')
  assert.equal(last().method, 'get')
  assert.equal(last().baseURL, '/api')
  await mod.performanceApi.summary()
  assert.equal(last().url, '/performance/summary')
})

test('goals: scope defaults to mine, blank filters are dropped, paging numbers pass through', async () => {
  await mod.performanceApi.goals()
  assert.deepEqual(last().params, { scope: 'mine' })
  await mod.performanceApi.goals({ scope: 'team', status: '', employee_id: ' EMP-0005 ', page: 2, page_size: 20 })
  assert.deepEqual(last().params, { scope: 'team', employee_id: 'EMP-0005', page: 2, page_size: 20 })
  await mod.performanceApi.goals({ scope: 'all', status: 'in_progress' })
  assert.deepEqual(last().params, { scope: 'all', status: 'in_progress' })
  assert.equal(last().url, '/performance/goals')
})

test('goal create / read / patch / comment build the contract requests; ids are URL-encoded', async () => {
  await mod.performanceApi.createGoal({ title: 'Ship', description: '', due_date: null })
  assert.equal(last().method, 'post')
  assert.equal(last().url, '/performance/goals')
  assert.deepEqual(body(), { title: 'Ship', description: '', due_date: null })
  await mod.performanceApi.goal('a/b c')
  assert.equal(last().url, '/performance/goals/a%2Fb%20c')
  await mod.performanceApi.patchGoal('g1', { progress: 50, version: 3 })
  assert.equal(last().method, 'patch')
  assert.equal(last().url, '/performance/goals/g1')
  assert.deepEqual(body(), { progress: 50, version: 3 })
  await mod.performanceApi.patchGoal('g1', { due_date: null, status: 'done', version: 4 })
  assert.deepEqual(body(), { due_date: null, status: 'done', version: 4 })
  await mod.performanceApi.commentGoal('g1', 'Good work')
  assert.equal(last().method, 'post')
  assert.equal(last().url, '/performance/goals/g1/comments')
  assert.deepEqual(body(), { text: 'Good work' })
})

test('check-ins: list scopes and filters, create, request, fill, acknowledge', async () => {
  await mod.performanceApi.checkins()
  assert.deepEqual(last().params, { scope: 'mine' })
  await mod.performanceApi.checkins({ scope: 'review', status: 'submitted', period: ' 2027-Q1 ', page_size: 50 })
  assert.deepEqual(last().params, { scope: 'review', status: 'submitted', period: '2027-Q1', page_size: 50 })
  await mod.performanceApi.createCheckin({ period_label: '2027-Q1', accomplishments: 'A', blockers: '', next_steps: '', mood: 4 })
  assert.equal(last().url, '/performance/checkins')
  assert.deepEqual(body(), { period_label: '2027-Q1', accomplishments: 'A', blockers: '', next_steps: '', mood: 4 })
  await mod.performanceApi.requestCheckin('EMP-0005', 'Week 3')
  assert.equal(last().url, '/performance/checkins/request')
  assert.deepEqual(body(), { employee_id: 'EMP-0005', period_label: 'Week 3' })
  await mod.performanceApi.fillCheckin('c1', { accomplishments: 'A', mood: null })
  assert.equal(last().url, '/performance/checkins/c1/submit')
  assert.deepEqual(body(), { accomplishments: 'A', mood: null })
  assert.ok(!('period_label' in body()), 'period_label is not accepted when filling a requested check-in')
  await mod.performanceApi.checkin('c1')
  assert.equal(last().url, '/performance/checkins/c1')
})

test('acknowledge sends {} without feedback and the trimmed feedback otherwise', async () => {
  await mod.performanceApi.acknowledge('c1')
  assert.equal(last().url, '/performance/checkins/c1/acknowledge')
  assert.deepEqual(body(), {})
  await mod.performanceApi.acknowledge('c1', '   ')
  assert.deepEqual(body(), {})
  await mod.performanceApi.acknowledge('c1', '  Well done  ')
  assert.deepEqual(body(), { feedback: 'Well done' })
})

test('overview: GET with only the filters that are set', async () => {
  await mod.performanceApi.overview()
  assert.equal(last().url, '/performance/overview')
  assert.deepEqual(last().params, {})
  await mod.performanceApi.overview({ period: '2027-Q1', department: 'Operations' })
  assert.deepEqual(last().params, { period: '2027-Q1', department: 'Operations' })
})

test('Bearer token is attached by the shared client and never put in a URL; only GET/POST/PATCH are used', async () => {
  await mod.performanceApi.summary()
  assert.equal(last().headers.get('Authorization'), 'Bearer tok-abc')
  for (const c of calls) assert.ok(!/token/i.test(String(c.url)))
  await mod.performanceApi.createGoal({ title: 'x' })
  await mod.performanceApi.patchGoal('g', { title: 'y' })
  assert.deepEqual([...new Set(calls.map((c) => c.method))].sort(), ['get', 'patch', 'post'])
})

test('cleanParams drops blanks, keeps numbers and trimmed strings', () => {
  assert.deepEqual(mod.cleanParams({ a: '', b: '  ', c: ' x ', d: 0, e: 3, f: undefined, g: null, h: Number.NaN }), { c: 'x', d: 0, e: 3 })
})
