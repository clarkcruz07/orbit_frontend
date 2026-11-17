import test, { before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { loadTs } from './helpers/load-ts.mjs'

let mod
let calls
before(async () => {
  mod = await loadTs('../tests/helpers/hrcases-entry.ts')
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

test('requests carry the Bearer header; no token in any URL', async () => {
  await mod.casesApi.types()
  await mod.casesApi.attachmentBlob('c1', 'm1')
  for (const c of calls) {
    assert.equal(header(c, 'Authorization'), 'Bearer tok-abc')
    assert.ok(!/tok-abc|token/i.test(String(c.url)))
    assert.equal(c.baseURL, '/api')
  }
})

test('types and list: scope and filters become query parameters, blanks are dropped', async () => {
  await mod.casesApi.types()
  assert.equal(last().url, '/hrcases/types')
  await mod.casesApi.list({ scope: 'mine' })
  assert.equal(last().url, '/hrcases/cases')
  assert.deepEqual(last().params, { scope: 'mine' })
  await mod.casesApi.list({ scope: 'queue', status: 'active', priority: 'high', assignee: 'unassigned', type_id: 't1', page: 2, page_size: 20 })
  assert.deepEqual(last().params, { scope: 'queue', status: 'active', priority: 'high', assignee: 'unassigned', type_id: 't1', page: 2, page_size: 20 })
  await mod.casesApi.list({ scope: 'queue', status: '', priority: undefined, assignee: '' })
  assert.deepEqual(last().params, { scope: 'queue' })
})

test('create is multipart (there is no JSON create): type, subject, description, optional priority and file', async () => {
  await mod.casesApi.create({ type_id: 't1', subject: 'Laptop', description: 'Please' })
  let c = last()
  assert.equal(c.method, 'post')
  assert.equal(c.url, '/hrcases/cases')
  assert.ok(c.data instanceof FormData)
  assert.equal(c.data.get('type_id'), 't1')
  assert.equal(c.data.get('subject'), 'Laptop')
  assert.equal(c.data.get('description'), 'Please')
  assert.equal(c.data.has('priority'), false, 'the type default applies when no priority is sent')
  assert.equal(c.data.has('file'), false, 'no file part when there is no attachment')

  const seen = []
  await mod.casesApi.create({ type_id: 't1', subject: 'S', description: 'D', priority: 'high', file: file('x.png', 'image/png') }, (f) => seen.push(f))
  c = last()
  assert.equal(c.data.get('priority'), 'high')
  assert.equal(c.data.get('file').name, 'x.png')
  assert.ok(c.timeout >= 60000)
  c.onUploadProgress({ loaded: 30, total: 60 })
  c.onUploadProgress({ loaded: 5 })
  assert.deepEqual(seen, [0.5])
})

test('get and reply: ids are URL-encoded; reply is multipart with optional status and file', async () => {
  await mod.casesApi.get('a/b')
  assert.equal(last().url, '/hrcases/cases/a%2Fb')
  await mod.casesApi.reply('c1', { text: 'Hello' })
  let c = last()
  assert.equal(c.url, '/hrcases/cases/c1/messages')
  assert.equal(c.method, 'post')
  assert.equal(c.data.get('text'), 'Hello')
  assert.equal(c.data.has('status'), false)
  assert.equal(c.data.has('file'), false)
  await mod.casesApi.reply('c1', { text: 'Done', status: 'resolved', file: file() })
  c = last()
  assert.equal(c.data.get('status'), 'resolved')
  assert.ok(c.data.get('file'))
})

test('status, priority and assignment send the case version for the optimistic check; unassign sends an explicit null', async () => {
  await mod.casesApi.setStatus('c1', 'closed', 4)
  assert.equal(last().method, 'post')
  assert.equal(last().url, '/hrcases/cases/c1/status')
  assert.deepEqual(JSON.parse(last().data), { status: 'closed', version: 4 })
  await mod.casesApi.setStatus('c1', 'in_progress')
  assert.deepEqual(JSON.parse(last().data), { status: 'in_progress' })
  await mod.casesApi.setPriority('c1', 'high', 2)
  assert.equal(last().method, 'patch')
  assert.equal(last().url, '/hrcases/cases/c1')
  assert.deepEqual(JSON.parse(last().data), { priority: 'high', version: 2 })
  await mod.casesApi.assign('c1', 'u-anna', 5)
  assert.equal(last().url, '/hrcases/cases/c1/assign')
  assert.deepEqual(JSON.parse(last().data), { assignee_user_id: 'u-anna', version: 5 })
  await mod.casesApi.assign('c1', null, 6)
  assert.deepEqual(JSON.parse(last().data), { assignee_user_id: null, version: 6 }, 'the key must be present for "remove the assignment"')
  await mod.casesApi.assign('c1', null)
  assert.deepEqual(JSON.parse(last().data), { assignee_user_id: null })
})

test('attachment download is a Bearer-authorised blob request', async () => {
  await mod.casesApi.attachmentBlob('c1', 'm 1')
  assert.equal(last().url, '/hrcases/cases/c1/messages/m%201/attachment')
  assert.equal(last().responseType, 'blob')
  assert.equal(last().method, 'get')
})
