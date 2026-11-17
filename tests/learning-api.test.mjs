import test, { before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { loadTs } from './helpers/load-ts.mjs'

let mod
let calls
before(async () => {
  mod = await loadTs('modules/learning/test-entry.ts')
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

test('config, my summary (the call that triggers due-soon notifications), team summary, compliance', async () => {
  await mod.learningApi.config()
  assert.equal(last().url, '/learning/config')
  assert.equal(last().baseURL, '/api')
  await mod.learningApi.mySummary()
  assert.equal(last().url, '/learning/my/summary')
  assert.equal(last().method, 'get')
  await mod.learningApi.teamSummary()
  assert.equal(last().url, '/learning/team/summary')
  await mod.learningApi.compliance()
  assert.equal(last().url, '/learning/compliance')
  assert.deepEqual(last().params, {})
  await mod.learningApi.compliance({ course_id: 'c1', department: 'Operations' })
  assert.deepEqual(last().params, { course_id: 'c1', department: 'Operations' })
})

test('courses: blank filters dropped, active=all/false passes through, ids encoded', async () => {
  await mod.learningApi.courses()
  assert.deepEqual(last().params, {})
  await mod.learningApi.courses({ q: ' safety ', category: '', delivery: 'online', active: 'all', page: 2, page_size: 12 })
  assert.deepEqual(last().params, { q: 'safety', delivery: 'online', active: 'all', page: 2, page_size: 12 })
  await mod.learningApi.course('a/b c')
  assert.equal(last().url, '/learning/courses/a%2Fb%20c')
})

test('course create / patch (deactivate)', async () => {
  await mod.learningApi.createCourse({ title: 'T', category: 'C', duration_hours: 2.5, delivery: 'online', mandatory_default: false, active: true })
  assert.equal(last().method, 'post')
  assert.equal(last().url, '/learning/courses')
  assert.deepEqual(body(), { title: 'T', category: 'C', duration_hours: 2.5, delivery: 'online', mandatory_default: false, active: true })
  await mod.learningApi.patchCourse('c1', { active: false, version: 2 })
  assert.equal(last().method, 'patch')
  assert.equal(last().url, '/learning/courses/c1')
  assert.deepEqual(body(), { active: false, version: 2 })
})

test('enrolments: scope defaults to mine; booleans and filters pass through', async () => {
  await mod.learningApi.enrolments()
  assert.deepEqual(last().params, { scope: 'mine' })
  await mod.learningApi.enrolments({ scope: 'team', status: 'in_progress', overdue: true, mandatory: false, page: 3 })
  assert.deepEqual(last().params, { scope: 'team', status: 'in_progress', overdue: true, mandatory: false, page: 3 })
  await mod.learningApi.enrolments({ scope: 'review', overdue: undefined, mandatory: undefined, status: '' })
  assert.deepEqual(last().params, { scope: 'review' })
  assert.equal(last().url, '/learning/enrolments')
})

test('enrol, assign, start, complete, confirm, return, cancel build the contract requests', async () => {
  await mod.learningApi.enrol('c1')
  assert.equal(last().url, '/learning/enrolments')
  assert.deepEqual(body(), { course_id: 'c1' })
  await mod.learningApi.assign({ course_id: 'c1', employee_id: 'EMP-0005', due_date: '2027-01-31', mandatory: true })
  assert.equal(last().url, '/learning/assignments')
  assert.deepEqual(body(), { course_id: 'c1', employee_id: 'EMP-0005', due_date: '2027-01-31', mandatory: true })
  await mod.learningApi.start('e1')
  assert.equal(last().url, '/learning/enrolments/e1/start')
  assert.equal(last().method, 'post')
  await mod.learningApi.complete('e1')
  assert.equal(last().url, '/learning/enrolments/e1/complete')
  assert.deepEqual(body(), {}, 'an empty note sends an empty body')
  await mod.learningApi.complete('e1', '  Finished the workbook  ')
  assert.deepEqual(body(), { completion_note: 'Finished the workbook' })
  await mod.learningApi.confirm('e1')
  assert.equal(last().url, '/learning/enrolments/e1/confirm')
  await mod.learningApi.returnCompletion('e1')
  assert.equal(last().url, '/learning/enrolments/e1/return')
  await mod.learningApi.cancel('e1')
  assert.equal(last().url, '/learning/enrolments/e1/cancel')
})

test('patch enrolment: progress with version, due date set and cleared', async () => {
  await mod.learningApi.patchEnrolment('e1', { progress: 40, version: 2 })
  assert.equal(last().method, 'patch')
  assert.equal(last().url, '/learning/enrolments/e1')
  assert.deepEqual(body(), { progress: 40, version: 2 })
  await mod.learningApi.patchEnrolment('e1', { due_date: null, version: 3 })
  assert.deepEqual(body(), { due_date: null, version: 3 })
})

test('certificate upload: multipart "file" field, generous timeout, progress mapped to 0..1', async () => {
  const seen = []
  const file = new File([new Uint8Array([1, 2, 3])], 'cert.png', { type: 'image/png' })
  await mod.learningApi.uploadCertificate('e1', file, (f) => seen.push(f))
  const c = last()
  assert.equal(c.method, 'post')
  assert.equal(c.url, '/learning/enrolments/e1/certificate')
  assert.ok(c.data instanceof FormData)
  assert.equal(c.data.get('file').name, 'cert.png')
  assert.ok(c.timeout >= 60000)
  c.onUploadProgress({ loaded: 50, total: 100 })
  c.onUploadProgress({ loaded: 150, total: 100 })
  c.onUploadProgress({ loaded: 10 })
  assert.deepEqual(seen, [0.5, 1])
})

test('certificate download goes through the Bearer client as a blob; the token is never in the URL', async () => {
  await mod.learningApi.certificateBlob('e1', 'cert/1')
  const c = last()
  assert.equal(c.method, 'get')
  assert.equal(c.url, '/learning/enrolments/e1/certificates/cert%2F1/file')
  assert.equal(c.responseType, 'blob')
  assert.equal(c.headers.get('Authorization'), 'Bearer tok-abc')
  assert.ok(!/token|access|bearer/i.test(c.url))
  assert.ok(!c.params)
})

test('only GET, POST and PATCH are used', async () => {
  await mod.learningApi.config()
  await mod.learningApi.enrol('c')
  await mod.learningApi.patchEnrolment('e', { progress: 1 })
  assert.deepEqual([...new Set(calls.map((c) => c.method))].sort(), ['get', 'patch', 'post'])
})
