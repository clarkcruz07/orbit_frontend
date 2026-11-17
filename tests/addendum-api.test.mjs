import test, { before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { loadTs } from './helpers/load-ts.mjs'

let mod
let calls
let reply
before(async () => {
  mod = await loadTs('../tests/helpers/api-entry-new.ts')
  mod.api.defaults.adapter = async (config) => {
    calls.push(config)
    return { data: reply, status: 200, statusText: 'OK', headers: {}, config }
  }
})
beforeEach(() => {
  calls = []
  reply = {}
  mod.useAuthStore.getState().setTokens('tok-abc', 'ref-abc')
})
const last = () => calls[calls.length - 1]

// ---------------------------------------------------------------------------------------------- directory
test('directory list: GET /directory/employees with blanks dropped, page and page_size always sent', async () => {
  reply = { items: [], total: 0, page: 1, page_size: 20, departments: [] }
  await mod.directoryApi.list({ q: '  ana ', department: '', employment_type: undefined })
  assert.equal(last().url, '/directory/employees')
  assert.equal(last().method, 'get')
  assert.deepEqual(last().params, { q: 'ana', page: 1, page_size: 20 })
  await mod.directoryApi.list({ q: '', department: 'Finance', employment_type: 'intern', page: 3, page_size: 10 })
  assert.deepEqual(last().params, { department: 'Finance', employment_type: 'intern', page: 3, page_size: 10 })
})

test('listParams clamps page >= 1 and page_size to 1..50', () => {
  assert.deepEqual(mod.listParams({ page: 0, page_size: 500 }), { page: 1, page_size: 50 })
  assert.deepEqual(mod.listParams({ page: -4, page_size: 0 }), { page: 1, page_size: 1 })
  assert.deepEqual(mod.listParams({ page: 2.9 }), { page: 2, page_size: 20 })
})

test('directory get: employee ids are URL-encoded and the profile carries direct reports', async () => {
  reply = { employee_id: 'EMP-0002', name: 'Ben Cruz', job_title: null, direct_reports: [{ employee_id: 'EMP-0003', name: 'Carla', job_title: 'Analyst' }, { name: 'no id' }] }
  const p = await mod.directoryApi.get('EMP/0002 x')
  assert.equal(last().url, '/directory/employees/EMP%2F0002%20x')
  assert.equal(p.name, 'Ben Cruz')
  assert.equal(p.job_title, null)
  assert.deepEqual(p.direct_reports, [{ employee_id: 'EMP-0003', name: 'Carla', job_title: 'Analyst' }])
})

test('normaliseEntry: basic fields mapped, extra fields tolerated, HR keys absent unless sent', () => {
  const basic = mod.normaliseEntry({ employee_id: 'E1', name: 'Ana', job_title: 'Dev', department: 'IT', email: 'a@x.test', manager: { employee_id: 'E0', name: 'Boss', extra: 1 }, avatar_initials: 'A', surprise: true })
  assert.equal(basic.manager.name, 'Boss')
  assert.ok(!('employment_type' in basic) && !('start_date' in basic) && !('status' in basic))
  assert.ok(!('surprise' in basic))
  const hr = mod.normaliseEntry({ employee_id: 'E1', name: 'Ana', employment_type: 'intern', start_date: '2024-01-02', status: 'active' })
  assert.equal(hr.employment_type, 'intern')
  assert.equal(hr.status, 'active')
  const sparse = mod.normaliseEntry({ employee_id: 'E2' })
  assert.equal(sparse.name, 'Unnamed')
  assert.equal(sparse.manager, null)
  assert.equal(sparse.email, null)
})

test('pageHasHrFields is true only when the server sent an HR-only key', () => {
  const basic = mod.normaliseEntry({ employee_id: 'E1', name: 'Ana' })
  const hr = mod.normaliseEntry({ employee_id: 'E2', name: 'Bo', employment_type: 'full_time' })
  assert.equal(mod.pageHasHrFields([basic]), false)
  assert.equal(mod.pageHasHrFields([basic, hr]), true)
  assert.equal(mod.pageHasHrFields([]), false)
})

test('normalisePage tolerates missing fields', () => {
  const p = mod.normalisePage({ items: [{ employee_id: 'E1', name: 'Ana' }] })
  assert.equal(p.total, 1)
  assert.equal(p.page, 1)
  assert.deepEqual(p.departments, [])
  assert.deepEqual(mod.normalisePage(null).items, [])
})

// ---------------------------------------------------------------------------------------------- me
test('my profile: GET /me/profile; manager falls back to employee.manager; birthday stays a month/day string', async () => {
  reply = {
    employee: { employee_id: 'E1', name: 'Ana', employment_type: 'full_time', start_date: '2021-03-01', status: 'active', manager: { employee_id: 'E0', name: 'Boss' } },
    direct_reports: [{ employee_id: 'E5', name: 'Cy', job_title: 'Dev' }],
    birthday: 'May 14',
    roles: ['Employee'],
    auth_source: 'microsoft',
    member_since: '2021-03-01',
  }
  const p = await mod.meApi.profile()
  assert.equal(last().url, '/me/profile')
  assert.equal(p.manager.name, 'Boss')
  assert.equal(p.birthday, 'May 14')
  assert.equal(p.auth_source, 'microsoft')
  assert.equal(p.direct_reports.length, 1)
  assert.equal(mod.normaliseMyProfile({ employee: { employee_id: 'E1', name: 'A' } }).birthday, null)
})

// ---------------------------------------------------------------------------------------------- calendar
test('calendar month: month param sent; events normalised; unknown types fall back, junk dropped', async () => {
  reply = {
    month: '2026-02',
    days_in_month: 28,
    events: [
      { date: '2026-02-10', type: 'holiday', title: 'H', subtitle: 'Public Holiday', own: false },
      { date: '2026-02-12', type: 'birthday', title: 'Ana', subtitle: 'IT', own: true },
      { date: '2026-02-13', title: 'No type' },
      { title: 'No date' },
    ],
  }
  const m = await mod.calendarApi.month('2026-02')
  assert.equal(last().url, '/calendar')
  assert.deepEqual(last().params, { month: '2026-02' })
  assert.equal(m.events.length, 3)
  assert.equal(m.events[1].own, true)
  assert.equal(m.events[2].type, 'holiday')
})

test('calendar upcoming: days param, two lists', async () => {
  reply = { holidays: [{ date: '2026-12-25', type: 'holiday', title: 'Christmas Day' }], birthdays: [{ date: '2026-11-23', title: 'Carla', own: true }] }
  const u = await mod.calendarApi.upcoming(45)
  assert.equal(last().url, '/calendar/upcoming')
  assert.deepEqual(last().params, { days: 45 })
  assert.equal(u.birthdays[0].type, 'birthday')
  assert.equal(u.holidays[0].title, 'Christmas Day')
})

// ---------------------------------------------------------------------------------------------- notifications
test('notifications list: params, normalisation, unread_count falls back to counting unread', async () => {
  reply = { items: [{ notification_id: 'n1', kind: 'k', title: 'T', body: 'B', link: '/reimbursements/x', created_at: '2026-11-16T01:00:00Z', read: false }, { notification_id: '', title: 'dropped' }, { notification_id: 'n2', read: true }], unread_count: 4 }
  const l = await mod.notificationsApi.list(10, true)
  assert.equal(last().url, '/notifications')
  assert.deepEqual(last().params, { limit: 10, unread_only: true })
  assert.equal(l.items.length, 2)
  assert.equal(l.unread_count, 4)
  assert.equal(mod.normaliseNotifications({ items: [{ notification_id: 'a' }, { notification_id: 'b', read: true }] }).unread_count, 1)
})

test('notifications: mark read and read-all are POSTs; ids are URL-encoded', async () => {
  await mod.notificationsApi.markRead('a/b')
  assert.equal(last().method, 'post')
  assert.equal(last().url, '/notifications/a%2Fb/read')
  await mod.notificationsApi.markAllRead()
  assert.equal(last().method, 'post')
  assert.equal(last().url, '/notifications/read-all')
})

// ---------------------------------------------------------------------------------------------- search
test('search: GET /search?q= and two groups normalised', async () => {
  reply = { q: 'ana', people: [{ employee_id: 'E1', name: 'Ana', job_title: 'Dev', department: 'IT' }, { name: 'no id' }], requests: [{ request_id: 'r1', purpose: 'Lunch', status: 'draft' }], limit: 8 }
  const r = await mod.searchApi.search('ana')
  assert.equal(last().url, '/search')
  assert.deepEqual(last().params, { q: 'ana' })
  assert.equal(r.people.length, 1)
  assert.equal(r.requests[0].status, 'draft')
  assert.equal(mod.normaliseSearch(undefined, 'zz').q, 'zz')
})

test('every new request carries the Bearer token from the shared client', async () => {
  reply = { items: [], unread_count: 0 }
  await mod.notificationsApi.list()
  assert.equal(last().headers.get('Authorization'), 'Bearer tok-abc')
})
