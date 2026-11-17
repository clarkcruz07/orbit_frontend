// The Attendance & Timesheet API module builds exactly the requests in docs/api/timesheet.md
// (stub adapter on the real axios instance, so no network).
import test, { before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { loadTs } from './helpers/load-ts.mjs'

let mod
let calls
before(async () => {
  mod = await loadTs('../tests/timesheet-api-entry.ts')
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

test('every call goes to /api with the Bearer token', async () => {
  await mod.timesheetApi.config()
  assert.equal(last().url, '/timesheet/config')
  assert.equal(last().baseURL, '/api')
  assert.equal(last().headers.get('Authorization'), 'Bearer tok-abc')
})

test('attendance: status, clock-in and clock-out take no body', async () => {
  await mod.timesheetApi.status()
  assert.deepEqual([last().method, last().url], ['get', '/attendance/status'])
  await mod.timesheetApi.clockIn()
  assert.deepEqual([last().method, last().url, last().data], ['post', '/attendance/clock-in', undefined])
  await mod.timesheetApi.clockOut()
  assert.deepEqual([last().method, last().url, last().data], ['post', '/attendance/clock-out', undefined])
})

test('attendance views: month is sent only when given; employee ids are URL-encoded; team day', async () => {
  await mod.timesheetApi.myMonth()
  assert.equal(last().url, '/attendance/me')
  assert.equal(last().params, undefined)
  await mod.timesheetApi.myMonth('2026-10')
  assert.deepEqual(last().params, { month: '2026-10' })
  await mod.timesheetApi.employeeMonth('EMP 0005/x', '2026-11')
  assert.equal(last().url, '/attendance/employees/EMP%200005%2Fx')
  assert.deepEqual(last().params, { month: '2026-11' })
  await mod.timesheetApi.teamDay('2026-11-12')
  assert.equal(last().url, '/attendance/team')
  assert.deepEqual(last().params, { date: '2026-11-12', page: 1, page_size: 50 })
  await mod.timesheetApi.teamDay()
  assert.deepEqual(last().params, { page: 1, page_size: 50 })
})

test('corrections: list scopes, create body, decision and cancel', async () => {
  await mod.timesheetApi.corrections('mine')
  assert.deepEqual(last().params, { scope: 'mine', page: 1, page_size: 20 })
  await mod.timesheetApi.corrections('review', 'pending', 2)
  assert.deepEqual(last().params, { scope: 'review', status: 'pending', page: 2, page_size: 20 })
  await mod.timesheetApi.requestCorrection({ day: '2026-11-12', clock_in: '09:00', clock_out: '17:30', clock_out_next_day: false, reason: 'Forgot', session_id: 's-1' })
  assert.deepEqual([last().method, last().url], ['post', '/attendance/corrections'])
  assert.deepEqual(body(), { day: '2026-11-12', clock_in: '09:00', clock_out: '17:30', clock_out_next_day: false, reason: 'Forgot', session_id: 's-1' })
  await mod.timesheetApi.correction('c/1')
  assert.equal(last().url, '/attendance/corrections/c%2F1')
  await mod.timesheetApi.decideCorrection('c1', { action: 'reject', comment: 'No', version: 2 })
  assert.deepEqual([last().method, last().url], ['post', '/attendance/corrections/c1/decision'])
  assert.deepEqual(body(), { action: 'reject', comment: 'No', version: 2 })
  await mod.timesheetApi.cancelCorrection('c1', 3)
  assert.equal(last().url, '/attendance/corrections/c1/cancel')
  assert.deepEqual(body(), { version: 3 })
  await mod.timesheetApi.cancelCorrection('c1')
  assert.deepEqual(body(), {})
})

test('codes: include_inactive only when asked; create is POST, edit is PATCH (CORS allows no PUT or DELETE)', async () => {
  await mod.timesheetApi.codes()
  assert.equal(last().params, undefined)
  await mod.timesheetApi.codes(true)
  assert.deepEqual(last().params, { include_inactive: true })
  await mod.timesheetApi.createCode({ name: 'Research', billable: true, active: true })
  assert.deepEqual([last().method, last().url], ['post', '/timesheet/codes'])
  assert.deepEqual(body(), { name: 'Research', billable: true, active: true })
  await mod.timesheetApi.updateCode('TC-ADMIN', { active: false, version: 4 })
  assert.deepEqual([last().method, last().url], ['patch', '/timesheet/codes/TC-ADMIN'])
  assert.deepEqual(body(), { active: false, version: 4 })
})

test('sheets: week param, save with PATCH + rows + version, submit, recall, decision', async () => {
  await mod.timesheetApi.mySheet()
  assert.equal(last().url, '/timesheet/me')
  assert.equal(last().params, undefined)
  await mod.timesheetApi.mySheet('2026-11-16')
  assert.deepEqual(last().params, { week: '2026-11-16' })
  await mod.timesheetApi.sheet('EMP-0005_2026-11-16')
  assert.equal(last().url, '/timesheet/sheets/EMP-0005_2026-11-16')
  const rows = [{ code_id: 'TC-GENERAL', hours: { '2026-11-16': 8 } }]
  await mod.timesheetApi.saveSheet('EMP-0005_2026-11-16', rows, 2)
  assert.deepEqual([last().method, last().url], ['patch', '/timesheet/sheets/EMP-0005_2026-11-16'])
  assert.deepEqual(body(), { rows, version: 2 })
  await mod.timesheetApi.saveSheet('EMP-0005_2026-11-16', rows)
  assert.deepEqual(body(), { rows }) // no version = no check
  await mod.timesheetApi.submitSheet('EMP-0005_2026-11-16', 3)
  assert.deepEqual([last().method, last().url], ['post', '/timesheet/sheets/EMP-0005_2026-11-16/submit'])
  assert.deepEqual(body(), { version: 3 })
  await mod.timesheetApi.recallSheet('EMP-0005_2026-11-16', 4)
  assert.equal(last().url, '/timesheet/sheets/EMP-0005_2026-11-16/recall')
  await mod.timesheetApi.decideSheet('EMP-0005_2026-11-16', { action: 'approve', version: 5 })
  assert.equal(last().url, '/timesheet/sheets/EMP-0005_2026-11-16/decision')
  assert.deepEqual(body(), { action: 'approve', version: 5 })
})

test('views: review queue, team week, HR overview', async () => {
  await mod.timesheetApi.review('corrections', 2)
  assert.equal(last().url, '/timesheet/review')
  assert.deepEqual(last().params, { kind: 'corrections', page: 2, page_size: 20 })
  await mod.timesheetApi.teamWeek('2026-11-09')
  assert.equal(last().url, '/timesheet/team')
  assert.deepEqual(last().params, { week: '2026-11-09', page: 1, page_size: 50 })
  await mod.timesheetApi.overview('2026-11-16')
  assert.equal(last().url, '/timesheet/overview')
  assert.deepEqual(last().params, { week: '2026-11-16' })
  await mod.timesheetApi.overview()
  assert.equal(last().params, undefined)
})

test('no call in the module uses a verb the browser CORS policy forbids (PUT, DELETE)', async () => {
  const fs = await import('node:fs')
  const src = fs.readFileSync(new URL('../src/modules/timesheet/api.ts', import.meta.url), 'utf8')
  assert.ok(!/api\.(put|delete)\b/.test(src))
})
