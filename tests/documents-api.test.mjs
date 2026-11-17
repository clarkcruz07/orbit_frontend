import test, { before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { loadTs } from './helpers/load-ts.mjs'

let mod
let calls
before(async () => {
  mod = await loadTs('../tests/helpers/documents-entry.ts')
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
const header = (c, name) => (typeof c.headers?.get === 'function' ? c.headers.get(name) : c.headers?.[name])
const file = (name = 'a.pdf', type = 'application/pdf') => new File([new Uint8Array([1, 2, 3])], name, { type })

test('every request carries the Bearer header and no token ever appears in a URL', async () => {
  await mod.documentsApi.types()
  await mod.documentsApi.fileBlob('d1')
  await mod.documentsApi.policyBlob('p1', 2)
  for (const c of calls) {
    assert.equal(header(c, 'Authorization'), 'Bearer tok-abc')
    assert.ok(!/tok-abc|token/i.test(String(c.url) + JSON.stringify(c.params ?? {})), c.url)
    assert.equal(c.baseURL, '/api')
  }
})

test('types: list (HR can ask for inactive ones), create, update and delete use the contract paths', async () => {
  await mod.documentsApi.types()
  assert.equal(last().url, '/documents/types')
  assert.equal(last().params, undefined)
  await mod.documentsApi.types(true)
  assert.deepEqual(last().params, { include_inactive: true })
  await mod.documentsApi.createType({ name: 'Visa', expiry_required: true, hr_only: false })
  assert.equal(last().method, 'post')
  assert.deepEqual(JSON.parse(last().data), { name: 'Visa', expiry_required: true, hr_only: false })
  await mod.documentsApi.updateType('t/1', { active: false })
  assert.equal(last().method, 'patch')
  assert.equal(last().url, '/documents/types/t%2F1')
  assert.deepEqual(JSON.parse(last().data), { active: false })
  await mod.documentsApi.deleteType('t1')
  assert.equal(last().method, 'delete')
  assert.equal(last().url, '/documents/types/t1')
})

test('list: blank filters are dropped, ids are passed as employee_id / type_id', async () => {
  await mod.documentsApi.list({ employee_id: 'EMP-1', type_id: '', page: 2, page_size: 20 })
  assert.equal(last().url, '/documents/employee')
  assert.deepEqual(last().params, { employee_id: 'EMP-1', page: 2, page_size: 20 })
  await mod.documentsApi.list({})
  assert.deepEqual(last().params, {})
})

test('create: multipart with the file part named "file"; optional fields only when given; HR-on-behalf adds employee_id', async () => {
  await mod.documentsApi.create({ type_id: 't1', title: 'Passport', file: file('p.png', 'image/png') })
  let c = last()
  assert.equal(c.method, 'post')
  assert.equal(c.url, '/documents/employee')
  assert.ok(c.data instanceof FormData)
  assert.equal(c.data.get('type_id'), 't1')
  assert.equal(c.data.get('title'), 'Passport')
  assert.equal(c.data.get('file').name, 'p.png')
  assert.equal(c.data.has('expires_on'), false)
  assert.equal(c.data.has('employee_id'), false)
  assert.ok(c.timeout >= 60000, 'uploads get a generous timeout')

  const seen = []
  await mod.documentsApi.create({ type_id: 't1', title: 'ID', file: file(), expires_on: '2027-01-31', employee_id: 'EMP-0005' }, (f) => seen.push(f))
  c = last()
  assert.equal(c.data.get('expires_on'), '2027-01-31')
  assert.equal(c.data.get('employee_id'), 'EMP-0005')
  c.onUploadProgress({ loaded: 25, total: 100 })
  c.onUploadProgress({ loaded: 500, total: 100 })
  c.onUploadProgress({ loaded: 5 })
  assert.deepEqual(seen, [0.25, 1], 'progress is clamped to 0..1 and ignored without a total')
})

test('get / update / addVersion build the contract requests (ids URL-encoded, expected_version sent as a string field)', async () => {
  await mod.documentsApi.get('a b')
  assert.equal(last().url, '/documents/employee/a%20b')
  await mod.documentsApi.update('d1', { title: 'New', version: 3 })
  assert.equal(last().method, 'patch')
  assert.deepEqual(JSON.parse(last().data), { title: 'New', version: 3 })
  await mod.documentsApi.update('d1', { clear_expiry: true })
  assert.deepEqual(JSON.parse(last().data), { clear_expiry: true })
  await mod.documentsApi.addVersion('d1', { file: file(), expires_on: '2028-02-29', expected_version: 2 })
  const c = last()
  assert.equal(c.url, '/documents/employee/d1/versions')
  assert.equal(c.data.get('expected_version'), '2')
  assert.equal(c.data.get('expires_on'), '2028-02-29')
  assert.ok(c.data.get('file'))
  await mod.documentsApi.addVersion('d1', { file: file() })
  assert.equal(last().data.has('expected_version'), false)
})

test('downloads are Bearer-authorised blob requests (current version or a specific one)', async () => {
  await mod.documentsApi.fileBlob('d1')
  assert.equal(last().url, '/documents/employee/d1/file')
  assert.equal(last().responseType, 'blob')
  await mod.documentsApi.fileBlob('d1', 1)
  assert.equal(last().url, '/documents/employee/d1/versions/1/file')
  assert.equal(last().responseType, 'blob')
  await mod.documentsApi.policyBlob('p1')
  assert.equal(last().url, '/documents/policies/p1/file')
  await mod.documentsApi.policyBlob('p1', 3)
  assert.equal(last().url, '/documents/policies/p1/versions/3/file')
  assert.equal(last().responseType, 'blob')
})

test('expiring: days, include_expired and paging go as query parameters', async () => {
  await mod.documentsApi.expiring({ days: 60, include_expired: true, page: 2, page_size: 20 })
  assert.equal(last().url, '/documents/expiring')
  assert.deepEqual(last().params, { days: 60, include_expired: true, page: 2, page_size: 20 })
})

test('policies: list, detail, publish (multipart), new version (expected_version), acknowledge (JSON), coverage', async () => {
  await mod.documentsApi.policies()
  assert.equal(last().url, '/documents/policies')
  await mod.documentsApi.policy('p1')
  assert.equal(last().url, '/documents/policies/p1')

  await mod.documentsApi.publishPolicy({ title: 'Remote work', summary: '', effective_date: '2026-12-01', file: file() })
  let c = last()
  assert.equal(c.method, 'post')
  assert.equal(c.url, '/documents/policies')
  assert.equal(c.data.get('title'), 'Remote work')
  assert.equal(c.data.get('effective_date'), '2026-12-01')
  assert.equal(c.data.has('summary'), false, 'an empty summary is not sent')
  assert.ok(c.data.get('file'))

  await mod.documentsApi.publishVersion('p1', { effective_date: '2027-01-01', file: file(), expected_version: 1, summary: 'Updated' })
  c = last()
  assert.equal(c.url, '/documents/policies/p1/versions')
  assert.equal(c.data.get('expected_version'), '1')
  assert.equal(c.data.get('summary'), 'Updated')
  assert.equal(c.data.has('title'), false, 'the title is optional for a new version')

  await mod.documentsApi.acknowledge('p1', 2)
  assert.equal(last().method, 'post')
  assert.equal(last().url, '/documents/policies/p1/acknowledge')
  assert.deepEqual(JSON.parse(last().data), { version: 2 })

  await mod.documentsApi.coverage()
  assert.equal(last().url, '/documents/policies/coverage')
  await mod.documentsApi.policyCoverage('p1')
  assert.equal(last().url, '/documents/policies/p1/coverage')
  assert.equal(last().params, undefined)
  await mod.documentsApi.policyCoverage('p1', 1)
  assert.deepEqual(last().params, { version: 1 })
})
