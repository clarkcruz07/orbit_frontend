import test, { before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { loadTs } from './helpers/load-ts.mjs'

let mod
let calls
before(async () => {
  mod = await loadTs('../tests/helpers/api-entry.ts')
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

test('config: GET /reimbursements/config', async () => {
  await mod.reimbursementsApi.config()
  assert.equal(last().method, 'get')
  assert.equal(last().url, '/reimbursements/config')
  assert.equal(last().baseURL, '/api')
})

test('list: scope is always sent, status only when given', async () => {
  await mod.reimbursementsApi.list('mine')
  assert.deepEqual(last().params, { scope: 'mine' })
  await mod.reimbursementsApi.list('review', 'pending_manager')
  assert.deepEqual(last().params, { scope: 'review', status: 'pending_manager' })
  assert.equal(last().url, '/reimbursements')
})

test('create / get / patch build the contract requests; ids are URL-encoded', async () => {
  await mod.reimbursementsApi.create('Client lunch')
  assert.equal(last().method, 'post')
  assert.deepEqual(JSON.parse(last().data), { purpose: 'Client lunch' })
  await mod.reimbursementsApi.get('a/b c')
  assert.equal(last().url, '/reimbursements/a%2Fb%20c')
  await mod.reimbursementsApi.patch('abc', { version: 3, fields: { merchant: 'X', tax_amount: null }, notes: null })
  assert.equal(last().method, 'patch')
  assert.equal(last().url, '/reimbursements/abc')
  assert.deepEqual(JSON.parse(last().data), { version: 3, fields: { merchant: 'X', tax_amount: null }, notes: null })
})

test('uploadReceipt: multipart "file" field, generous timeout, progress mapped to 0..1 (ignored without a total)', async () => {
  const seen = []
  const file = new File([new Uint8Array([1, 2, 3])], 'r.png', { type: 'image/png' })
  await mod.reimbursementsApi.uploadReceipt('abc', file, (f) => seen.push(f))
  const c = last()
  assert.equal(c.method, 'post')
  assert.equal(c.url, '/reimbursements/abc/receipts')
  assert.ok(c.data instanceof FormData)
  assert.equal(c.data.get('file').name, 'r.png')
  assert.ok(c.timeout >= 60000)
  c.onUploadProgress({ loaded: 50, total: 100 })
  c.onUploadProgress({ loaded: 150, total: 100 })
  c.onUploadProgress({ loaded: 10 })
  assert.deepEqual(seen, [0.5, 1])
})

test('extract / submit / decide / audit', async () => {
  await mod.reimbursementsApi.extract('abc')
  assert.equal(last().url, '/reimbursements/abc/extract')
  assert.equal(last().method, 'post')
  await mod.reimbursementsApi.submit('abc', true)
  assert.equal(last().url, '/reimbursements/abc/submit')
  assert.deepEqual(JSON.parse(last().data), { confirm_fields: true })
  await mod.reimbursementsApi.decide('abc', 'reject', 'No receipt')
  assert.equal(last().url, '/reimbursements/abc/decision')
  assert.deepEqual(JSON.parse(last().data), { action: 'reject', comment: 'No receipt' })
  await mod.reimbursementsApi.audit('abc')
  assert.equal(last().url, '/reimbursements/abc/audit')
  assert.equal(last().method, 'get')
})

test('receiptBlob: Bearer header, blob response, and the token is never in the URL', async () => {
  await mod.reimbursementsApi.receiptBlob('abc', 'rid-1')
  const c = last()
  assert.equal(c.url, '/reimbursements/abc/receipts/rid-1/file')
  assert.equal(c.responseType, 'blob')
  assert.equal(c.headers.get('Authorization'), 'Bearer tok-abc')
  assert.ok(!String(c.url).includes('tok-abc'))
  assert.equal(c.params, undefined)
})

test('the module never builds a URL with a query-string credential', async () => {
  const file = new File([new Uint8Array([1])], 'r.png', { type: 'image/png' })
  await mod.reimbursementsApi.list('all')
  await mod.reimbursementsApi.uploadReceipt('abc', file)
  await mod.reimbursementsApi.receiptBlob('abc', 'rid')
  for (const c of calls) assert.ok(!/[?&](token|access_token|authorization)=/i.test(String(c.url)), c.url)
})
