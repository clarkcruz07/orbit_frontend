import test, { before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { loadTs } from './helpers/load-ts.mjs'

let mod
let calls
let respond
before(async () => {
  mod = await loadTs('../tests/peoplemgmt-api-entry.ts')
  mod.api.defaults.adapter = async (config) => {
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
  mod.useAuthStore.getState().setTokens('tok-abc', 'ref-abc')
})

const last = () => calls[calls.length - 1]
const header = (c, name) => (typeof c.headers?.get === 'function' ? c.headers.get(name) : c.headers?.[name])
const person = (over = {}) => ({
  employee: { employee_id: 'EMP-1A2B3C4D', name: 'Ana Cruz', email: 'ana@x.test', job_title: 'Analyst', department: 'Ops', employment_type: 'full_time', manager_id: 'EMP-0002', manager: { employee_id: 'EMP-0002', name: 'Miguel Santos' }, start_date: '2026-01-05', end_date: null, status: 'active', birthday: '03-27', is_demo: false, source: 'hr_created', avatar_initials: 'AC', ...over.employee },
  account: { has_account: true, can_sign_in: true, roles: ['Employee', 'Manager'], source: 'hr_created', disabled: false, disabled_reason: null, user_id: 'u1', ...over.account },
})

test('every request carries the Bearer header and no token ever appears in a URL or query', async () => {
  respond = () => ({ status: 200, data: person() })
  await mod.peopleApi.get('EMP-1')
  await mod.peopleApi.list({ q: 'a' })
  await mod.peopleApi.templateBlob()
  await mod.holidaysApi.list(2026, true)
  for (const c of calls) {
    assert.equal(header(c, 'Authorization'), 'Bearer tok-abc')
    assert.ok(!/tok-abc|token/i.test(String(c.url) + JSON.stringify(c.params ?? {})), c.url)
    assert.equal(c.baseURL, '/api')
  }
})

test('list: blanks dropped, page and page_size clamped, status passed through', async () => {
  respond = () => ({ status: 200, data: { items: [person()], total: 1, page: 1, page_size: 20 } })
  const page = await mod.peopleApi.list({ q: '  ana  ', status: 'left', page: 0, page_size: 500 })
  assert.equal(last().url, '/people/employees')
  assert.deepEqual(last().params, { q: 'ana', status: 'left', page: 1, page_size: 50 })
  assert.equal(page.items[0].employee.name, 'Ana Cruz')
  await mod.peopleApi.list({})
  assert.deepEqual(last().params, { page: 1, page_size: 20 })
})

test('person calls use the contract paths and verbs', async () => {
  respond = () => ({ status: 200, data: person() })
  await mod.peopleApi.create({ name: 'A', email: 'a@x.test', job_title: 'T', department: 'D', employment_type: 'full_time', manager_id: null, start_date: null, birthday: null, roles: ['Employee'], can_sign_in: true })
  assert.equal(last().method, 'post')
  assert.equal(last().url, '/people/employees')
  assert.equal(JSON.parse(last().data).can_sign_in, true)
  await mod.peopleApi.update('EMP/1', { name: 'B' })
  assert.equal(last().method, 'patch')
  assert.equal(last().url, '/people/employees/EMP%2F1')
  assert.deepEqual(JSON.parse(last().data), { name: 'B' })
  await mod.peopleApi.deactivate('EMP-1', { reassign_reports_to: 'EMP-2' })
  assert.equal(last().method, 'post')
  assert.equal(last().url, '/people/employees/EMP-1/deactivate')
  assert.deepEqual(JSON.parse(last().data), { reassign_reports_to: 'EMP-2' })
  await mod.peopleApi.reactivate('EMP-1')
  assert.equal(last().url, '/people/employees/EMP-1/reactivate')
  await mod.peopleApi.setRoles('EMP-1', ['Employee', 'Finance'])
  assert.equal(last().method, 'put')
  assert.equal(last().url, '/people/employees/EMP-1/roles')
  assert.deepEqual(JSON.parse(last().data), { roles: ['Employee', 'Finance'] })
})

test('import: multipart with the part named "file" and dry_run as a query parameter; the template is a blob request', async () => {
  respond = () => ({
    status: 200,
    data: {
      dry_run: true,
      total: 2,
      created: 1,
      skipped: 0,
      invalid: 1,
      ignored_columns: ['x'],
      rows: [
        { row: 2, status: 'created', reason: null, message: null, employee_id: null, field_errors: {} },
        { row: 3, status: 'invalid', reason: 'validation', message: 'm', employee_id: null, field_errors: { email: 'must be a valid e-mail address' } },
      ],
    },
  })
  const file = new File(['name,email\n'], 'p.csv', { type: 'text/csv' })
  const r = await mod.peopleApi.importCsv(file, true)
  assert.equal(last().url, '/people/employees/import')
  assert.deepEqual(last().params, { dry_run: true })
  assert.ok(last().data instanceof FormData)
  assert.ok(last().data.get('file') instanceof File)
  assert.equal(r.invalid, 1)
  assert.equal(r.rows[1].field_errors.email, 'must be a valid e-mail address')
  await mod.peopleApi.importCsv(file, false)
  assert.deepEqual(last().params, { dry_run: false })
  await mod.peopleApi.templateBlob()
  assert.equal(last().url, '/people/employees/import/template')
  assert.equal(last().responseType, 'blob')
})

test('holidays: list (year, HR include_inactive), create, patch and delete use the contract paths', async () => {
  respond = () => ({
    status: 200,
    data: { year: 2026, sync: 'pending', items: [{ holiday_id: 'h1', source: 'ai', name: 'X', type: 'company', date: '2026-12-24', month: null, day: null, recurring: false, active: true, date_in_year: '2026-12-24' }] },
  })
  const res = await mod.holidaysApi.list(2026, true)
  assert.equal(last().url, '/holidays')
  assert.deepEqual(last().params, { year: 2026, include_inactive: true })
  assert.equal(res.items[0].date_in_year, '2026-12-24')
  assert.equal(res.sync, 'pending')
  assert.equal(res.items[0].source, 'ai')
  await mod.holidaysApi.list(2027)
  assert.deepEqual(last().params, { year: 2027 })
  // Unknown or missing values are safe: not pending, not AI.
  respond = () => ({ status: 200, data: { year: 2027, sync: 'weird', items: [{ holiday_id: 'h2', name: 'Y', source: 'other' }] } })
  const odd = await mod.holidaysApi.list(2027)
  assert.equal(odd.sync, 'ready')
  assert.equal(odd.items[0].source, 'manual')
  respond = () => ({ status: 201, data: { holiday_id: 'h2', name: 'Y', type: 'public', date: null, month: 12, day: 25, recurring: true, active: true } })
  await mod.holidaysApi.create({ name: 'Y', type: 'public', month: 12, day: 25 })
  assert.equal(last().method, 'post')
  await mod.holidaysApi.update('h/2', { active: false })
  assert.equal(last().method, 'patch')
  assert.equal(last().url, '/holidays/h%2F2')
  respond = () => ({ status: 204, data: '' })
  await mod.holidaysApi.remove('h2')
  assert.equal(last().method, 'delete')
})

test('manager search uses the normal directory search and never an HR-only route', async () => {
  respond = () => ({
    status: 200,
    data: { items: [{ employee_id: 'EMP-2', name: 'Miguel', job_title: 'Mgr', department: 'Ops', status: 'active' }, { employee_id: '', name: 'bad' }], total: 2, page: 1, page_size: 20, departments: [] },
  })
  const hits = await mod.managerSearchApi.search('mig')
  assert.equal(last().url, '/directory/employees')
  assert.deepEqual(last().params, { q: 'mig', page: 1, page_size: 20 })
  assert.equal(hits.length, 1)
  assert.equal(hits[0].status, 'active')
})

test('normalisePerson tolerates missing pieces and never invents an account', () => {
  const p = mod.normalisePerson({ employee: { employee_id: 'E1', name: 'N' } })
  assert.equal(p.account.has_account, false)
  assert.deepEqual(p.account.roles, [])
  assert.equal(p.employee.manager, null)
  assert.equal(p.employee.status, 'active')
  const e = mod.normalisePerson(null)
  assert.equal(e.employee.name, 'Unnamed')
})

test('parseFailure reads status, code, field errors, report extras and ignores junk', () => {
  const mk = (status, data) => ({ response: { status, data } })
  assert.equal(mod.parseFailure(new Error('network')).status, null)
  const f = mod.parseFailure(mk(422, { detail: 'Invalid employee details', code: 'validation', field_errors: { email: 'is required', bad: 3 } }))
  assert.equal(f.status, 422)
  assert.equal(f.code, 'validation')
  assert.deepEqual(f.fieldErrors, { email: 'is required' })
  const g = mod.parseFailure(mk(409, { detail: 'x', code: 'has_direct_reports', active_direct_reports: 3 }))
  assert.equal(g.activeDirectReports, 3)
  const h = mod.parseFailure(mk(422, { detail: 'x', code: 'missing_columns', missing_columns: ['email', 7] }))
  assert.deepEqual(h.missingColumns, ['email'])
  const i = mod.parseFailure(mk(422, { detail: 'name is required', code: 'validation', field: 'name' }))
  assert.equal(i.field, 'name')
  const j = mod.parseFailure(mk(500, '<html>'))
  assert.equal(j.detail, null)
})
