// Unit tests for the Settings module (api mapping, tab/switch logic, errors) and the live-aware dashboard formatting.
import test, { before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { loadTs } from './helpers/load-ts.mjs'

let m
let calls
let reply
let fail
before(async () => {
  m = await loadTs('../tests/helpers/settings-entry.ts')
  m.api.defaults.adapter = async (config) => {
    calls.push(config)
    if (fail) {
      const err = new Error('boom')
      err.response = { status: fail }
      throw err
    }
    return { data: reply, status: 200, statusText: 'OK', headers: {}, config }
  }
})
beforeEach(() => {
  calls = []
  reply = {}
  fail = 0
  m.useAuthStore.getState().setTokens('tok', 'ref')
})
const last = () => calls[calls.length - 1]

// ------------------------------------------------------------------------------------------------ api mapping
test('preferences: GET /preferences/me keeps the server labels and order, fills missing groups as ON', async () => {
  reply = {
    groups: { reimbursements: true, leave: false },
    items: [
      { group: 'leave', label: 'Leave', description: 'About leave', enabled: false },
      { group: 'reimbursements', label: 'Reimbursements', description: 'About money', enabled: true },
      { group: 'bogus', label: 'x', description: 'y', enabled: false },
    ],
    updated_at: '2026-11-16T02:00:00Z',
  }
  const p = await m.settingsApi.preferences()
  assert.equal(last().url, '/preferences/me')
  assert.equal(last().method, 'get')
  assert.deepEqual(p.items.map((i) => i.group), [...m.GROUP_ORDER], 'always the seven groups, in the documented order')
  assert.equal(p.items.find((i) => i.group === 'leave').enabled, false)
  assert.equal(p.items.find((i) => i.group === 'leave').description, 'About leave')
  assert.equal(p.items.find((i) => i.group === 'cases').enabled, true)
  assert.ok(p.items.find((i) => i.group === 'cases').label.length > 0, 'fallback wording for a group the server omitted')
  assert.equal(p.updated_at, '2026-11-16T02:00:00Z')
  assert.equal(m.normalisePreferences(null).items.length, 7)
  assert.equal(m.normalisePreferences({ groups: { learning: false } }).items.find((i) => i.group === 'learning').enabled, false)
})

test('preferences: PUT sends a partial {groups:{...}} body with real booleans', async () => {
  reply = { groups: {}, items: [{ group: 'leave', label: 'Leave', description: 'd', enabled: false }], updated_at: null }
  const p = await m.settingsApi.savePreferences({ leave: false })
  assert.equal(last().method, 'put')
  assert.equal(last().url, '/preferences/me')
  assert.deepEqual(JSON.parse(last().data), { groups: { leave: false } })
  assert.equal(p.items.find((i) => i.group === 'leave').enabled, false)
  assert.equal(p.updated_at, null)
})

test('settings: GET/PUT /settings, strict normalisation (only boolean true is on)', async () => {
  reply = { hr_can_see_mood: true, updated: { hr_can_see_mood: { updated_at: '2026-11-16T01:00:00Z', updated_by: 'u1' } } }
  const s = await m.settingsApi.settings()
  assert.equal(last().url, '/settings')
  assert.equal(s.hr_can_see_mood, true)
  assert.equal(s.updated.hr_can_see_mood.updated_by, 'u1')
  assert.equal(m.normaliseSettings({ hr_can_see_mood: 'true' }).hr_can_see_mood, false)
  assert.equal(m.normaliseSettings(undefined).updated.hr_can_see_mood, null)
  await m.settingsApi.saveSettings({ hr_can_see_mood: false })
  assert.equal(last().method, 'put')
  assert.deepEqual(JSON.parse(last().data), { hr_can_see_mood: false })
})

test('overview and users: query params, defaults, null-safe rows', async () => {
  reply = { company_timezone: 'Asia/Manila', version: '0.1', roles_editable: false }
  const o = await m.settingsApi.overview()
  assert.equal(o.company_timezone, 'Asia/Manila')
  assert.equal(last().url, '/settings/overview')
  reply = {
    items: [
      { user_id: 'u1', name: 'Ana', email: 'a@x.test', roles: ['Manager', 'Employee'], employee_id: 'E1', auth_source: 'microsoft', is_demo: false, department: 'IT', job_title: null },
      { name: 'no id' },
      { user_id: 'u2', email: 'only@x.test' },
    ],
    total: 45,
    page: 2,
    page_size: 20,
    roles_editable: false,
  }
  const u = await m.settingsApi.users({ q: 'an', page: 2 })
  assert.equal(last().url, '/settings/users')
  assert.deepEqual(last().params, { q: 'an', page: 2, page_size: 20 })
  assert.equal(u.items.length, 2, 'a row without user_id is dropped')
  assert.equal(u.items[0].job_title, null)
  assert.equal(u.items[1].name, 'only@x.test')
  assert.equal(u.items[1].auth_source, 'password')
  assert.equal(u.total, 45)
  await m.settingsApi.users({})
  assert.deepEqual(last().params, { page: 1, page_size: 20 }, 'blank search is not sent')
})

// ------------------------------------------------------------------------------------------------ tabs and access
test('tabs: HR tabs are offered only after the server answered 200 for GET /settings', () => {
  assert.deepEqual(m.availableTabs('allowed'), ['preferences', 'account', 'hr', 'users', 'catalogs'])
  for (const a of ['checking', 'denied', 'error']) assert.deepEqual(m.availableTabs(a), ['preferences', 'account'])
  assert.equal(m.hrAccessFromError({ response: { status: 403 } }), 'denied')
  assert.equal(m.hrAccessFromError({ response: { status: 500 } }), 'error')
  assert.equal(m.hrAccessFromError(new Error('network')), 'error')
})

test('tab parsing: unknown or unavailable tabs fall back; an HR tab is kept only while the probe runs', () => {
  const emp = m.availableTabs('denied')
  const hr = m.availableTabs('allowed')
  assert.equal(m.parseTab(null, emp, 'denied'), 'preferences')
  assert.equal(m.parseTab('account', emp, 'denied'), 'account')
  assert.equal(m.parseTab('hr', emp, 'denied'), 'preferences')
  assert.equal(m.parseTab('users', emp, 'error'), 'preferences')
  assert.equal(m.parseTab('users', emp, 'checking'), 'users')
  assert.equal(m.parseTab('catalogs', hr, 'allowed'), 'catalogs')
  assert.equal(m.parseTab('nonsense', hr, 'allowed'), 'preferences')
})

// ------------------------------------------------------------------------------------------------ switches
test('notification switches: optimistic toggle and rollback helpers', () => {
  const items = m.normalisePreferences({}).items
  const off = m.toggled(items, 'leave', false)
  assert.equal(m.groupEnabled(off, 'leave'), false)
  assert.equal(m.groupEnabled(off, 'cases'), true)
  assert.equal(m.groupEnabled(m.toggled(off, 'leave', true), 'leave'), true)
  assert.equal(items.find((i) => i.group === 'leave').enabled, true, 'the original list is untouched')
  assert.equal(m.savedMessage('Leave', false), 'Leave notifications are off.')
  assert.match(m.rollbackMessage('Leave', true, 'Not saved.'), /Leave is still on\.$/)
  assert.match(m.PREFS_NOTE, /in-app notifications only/)
  assert.match(m.PREFS_NOTE, /does not send e-mail, push or Teams/)
})

test('errors: fixed friendly wording per failure type, the server text is never shown', () => {
  assert.match(m.describeError({}, 'Not saved.').message, /Can't reach/)
  assert.match(m.describeError({ response: { status: 401 } }, 'x').message, /session has ended/)
  assert.match(m.describeError({ response: { status: 403 } }, 'Not saved.').message, /does not have access/)
  assert.match(m.describeError({ response: { status: 422, data: { detail: 'SECRET internals' } } }, 'Not saved.').message, /not accepted/)
  assert.ok(!/SECRET/.test(m.describeError({ response: { status: 500, data: { detail: 'SECRET internals' } } }, 'x').message))
  assert.equal(m.describeError({ response: { status: 500 } }, 'x').status, 500)
})

test('mood labels explain what each choice means', () => {
  assert.match(m.moodExplain(false), /do not see the mood score/)
  assert.match(m.moodExplain(true), /can also see the mood score/)
  assert.equal(m.changedLabel(null), 'Default in force (never changed)')
  assert.equal(m.changedLabel({ updated_at: null }), 'Default in force (never changed)')
  assert.equal(m.changedLabel({ updated_at: '2026-11-16T10:05:00Z' }, 'UTC'), 'Last changed 16 Nov 2026 10:05')
  assert.equal(m.formatWhen('garbage'), null)
})

test('account and users helpers', () => {
  assert.equal(m.authSourceLabel('microsoft'), 'Microsoft sign-in')
  assert.equal(m.authSourceLabel('password'), 'Email and password')
  assert.equal(m.authSourceLabel('demo'), 'Local account')
  assert.equal(m.authSourceLabel('x'), 'X')
  assert.equal(m.authSourceTone('demo'), 'grey')
  assert.equal(m.rolesText(['Manager', 'HRAdmin']), 'HR Administrator, Manager')
  assert.equal(m.rolesText([]), 'No roles')
  assert.match(m.ROLES_NOTE, /set by HR on the People pages/)
  assert.equal(m.cleanQuery('  ana  '), 'ana')
  assert.equal(m.cleanQuery('x'.repeat(100)).length, 64)
  assert.equal(m.cleanQuery('.*'), '.*', 'regex characters stay literal')
  assert.equal(m.rangeText(1, 20, 45, 20), '1-20 of 45')
  assert.equal(m.rangeText(3, 20, 45, 5), '41-45 of 45')
  assert.equal(m.rangeText(1, 20, 0, 0), '0 of 0')
  assert.equal(m.pageCount(45, 20), 3)
  assert.equal(m.pageCount(0, 20), 1)
  assert.equal(m.parsePage('2'), 2)
  assert.equal(m.parsePage('0'), 1)
  assert.equal(m.parsePage('abc'), 1)
  assert.equal(m.initialsOf('Ana Maria Reyes'), 'AR')
})

test('catalog links point at real module paths (HR request types has no admin screen yet and says so)', () => {
  const byId = Object.fromEntries(m.CATALOGS.map((c) => [c.id, c]))
  assert.deepEqual(Object.keys(byId).sort(), ['documents', 'hrcases', 'learning', 'leave', 'timesheet'])
  assert.equal(byId.leave.to, '/leave?tab=settings')
  assert.equal(byId.timesheet.to, '/attendance?tab=hr')
  assert.equal(byId.documents.to, '/documents?tab=hr&section=types')
  assert.equal(byId.learning.to, '/learning?tab=hr&section=courses')
  for (const c of m.CATALOGS) assert.ok(c.to.startsWith('/'), c.id)
  assert.ok(byId.hrcases.note, 'honest note when the link goes to the module root')
})

// ------------------------------------------------------------------------------------------------ live dashboard formatting
const liveRaw = () => ({
  demo: false,
  source: 'live',
  demo_notice: null,
  summary: {
    headcount: { value: 19, delta_pct: null, period: 'vs last month' },
    onboarding: { value: null, status: null, available: false, reason: 'Not tracked by any module yet' },
    offboarding: { value: null, status: null, available: false, reason: 'Not tracked by any module yet' },
    expiring_documents: { value: 0, window_days: 30 },
    policy_acknowledgement: { pct: null, delta_pp: null, available: false, reason: 'No policy to measure yet' },
  },
  headcount_trend: [{ month: 'Nov', value: 14 }],
  onboarding: { total: null, completed: null, in_progress: null, not_started: null, pct: null, available: false, reason: 'Not tracked by any module yet' },
  offboarding: { total: null, completed: null, in_progress: null, not_started: null, pct: null, available: false, reason: 'Not tracked by any module yet' },
  directory: { total: 14, full_time: 14, part_time: 0, contractor: 0, intern: 0 },
  hr_cases: { active: 0, high: 0, medium: 0, low: 0, avg_resolution_days: null, delta_pct: null },
  birthdays: [],
  holidays: [],
  unavailable_blocks: [],
})

test('live dashboard: nulls stay null, unavailable blocks are flagged with their reason, healthy blocks are available', () => {
  const d = m.normaliseDashboard(liveRaw())
  assert.equal(d.summary.headcount.available, true)
  assert.equal(d.summary.headcount.delta_pct, null)
  assert.equal(d.summary.expiring_documents.value, 0, 'a count of 0 is a number, not "missing"')
  assert.equal(d.summary.onboarding.available, false)
  assert.equal(d.summary.onboarding.reason, 'Not tracked by any module yet')
  assert.equal(d.onboarding.available, false)
  assert.equal(d.onboarding.pct, null)
  assert.equal(d.summary.policy_acknowledgement.available, false)
  assert.equal(d.summary.policy_acknowledgement.reason, 'No policy to measure yet')
  assert.equal(d.hr_cases.available, true)
  assert.equal(d.hr_cases.avg_resolution_days, null)
  assert.deepEqual(d.headcount_trend, [{ month: 'Nov', value: 14 }])
  assert.deepEqual(d.birthdays, [])
})

test('dashboard with every block present: the numbers pass through untouched and every block is available', () => {
  const raw = {
    summary: { headcount: { value: 1248, delta_pct: 3.2, period: 'last_month' }, onboarding: { value: 24, status: 'in_progress' }, offboarding: { value: 7, status: 'in_progress' }, expiring_documents: { value: 36, window_days: 30 }, policy_acknowledgement: { pct: 96, delta_pp: 2 } },
    headcount_trend: [{ month: 'Aug', value: 1100 }, { month: 'Jan', value: 1248 }],
    onboarding: { total: 24, completed: 19, in_progress: 5, not_started: 0, pct: 80 },
    offboarding: { total: 7, completed: 5, in_progress: 2, not_started: 0, pct: 71 },
    directory: { total: 1248, full_time: 1158, part_time: 52, contractor: 26, intern: 12 },
    hr_cases: { active: 42, high: 6, medium: 14, low: 22, avg_resolution_days: 3.4, delta_pct: -18 },
    birthdays: [{ name: 'Mark', team: 'Compliance Team', date: 'Jan 25', avatar_initials: 'MD' }],
    holidays: [{ month: 'Feb', day: 10, name: 'Chinese New Year', type: 'Public Holiday' }],
  }
  const d = m.normaliseDashboard(raw)
  assert.equal(d.summary.headcount.value, 1248)
  assert.equal(d.summary.headcount.delta_pct, 3.2)
  assert.equal(d.hr_cases.delta_pct, -18)
  for (const b of [d.summary.headcount, d.summary.onboarding, d.summary.offboarding, d.summary.expiring_documents, d.summary.policy_acknowledgement, d.onboarding, d.offboarding, d.directory, d.hr_cases]) assert.equal(b.available, true)
  assert.equal(d.holidays[0].month, 'Feb')
  assert.equal(m.formatPct(96), '96')
  assert.equal(m.formatPct(33.333), '33.3')
  assert.equal(m.formatPct(50.0), '50')
  assert.equal(m.formatPct(null), '-')
})

test('garbage never throws', () => {
  const d = m.normaliseDashboard(null)
  assert.equal(d.summary.headcount.value, null)
  assert.deepEqual(d.headcount_trend, [])
  assert.deepEqual(m.normaliseDashboard({ headcount_trend: [{ month: 'x', value: 'bad' }, { month: 'Nov', value: 3 }] }).headcount_trend, [{ month: 'Nov', value: 3 }])
})

test('degraded blocks: "Temporarily unavailable" is not shown as "Not tracked yet"', () => {
  assert.equal(m.unavailableTitle('Not tracked by any module yet'), 'Not tracked yet')
  assert.equal(m.unavailableTitle('No policy to measure yet'), 'Not tracked yet')
  assert.equal(m.unavailableTitle('Temporarily unavailable'), 'Temporarily unavailable')
  assert.equal(m.unavailableTitle(null), 'Not tracked yet')
  assert.equal(m.unavailableReason('Not tracked by any module yet'), 'Not tracked by any module yet')
  assert.ok(m.unavailableReason(null).length > 0)
  assert.equal(m.degradedNames(['headcount', 'hr_cases', 'something_new']), 'head count, HR cases, something new')
  const down = { available: false, reason: 'Temporarily unavailable', value: null, delta_pct: null, period: 'vs last month' }
  const d = m.normaliseDashboard({ summary: { headcount: down }, unavailable_blocks: ['headcount'] })
  assert.equal(d.summary.headcount.available, false)
  assert.equal(d.summary.headcount.value, null)
  assert.deepEqual(d.unavailable_blocks, ['headcount'])
})

test('headcount axis: reference data unchanged; tiny head counts and a single point stay readable', () => {
  const ref = m.trendAxis([1100, 1130, 1165, 1195, 1225, 1248])
  assert.deepEqual(ref.ticks, [1100, 1150, 1200, 1250, 1300])
  assert.equal(ref.min, 1100)
  assert.equal(ref.max, 1300)
  const small = m.trendAxis([16, 16, 17, 17, 18, 19])
  assert.equal(small.min, 0)
  assert.ok(small.max >= 19 + 1, 'headroom for the end bubble')
  assert.ok(small.ticks.length >= 3 && small.ticks.length <= 8)
  assert.ok(small.ticks.every((t, i, a) => i === 0 || t > a[i - 1]))
  const one = m.trendAxis([14])
  assert.equal(one.min, 0)
  assert.ok(one.max > 14)
  const zero = m.trendAxis([0])
  assert.ok(zero.max > 0 && zero.ticks.length >= 2)
  assert.deepEqual(m.trendAxis([]).ticks, [0, 50, 100])
  assert.deepEqual(m.trendAxis([NaN]).ticks, [0, 50, 100])
})
