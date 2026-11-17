// Self-contained MOCK of the Leave API (docs/api/leave.md) for the Leave browser specs. All data is fictional.
// It runs its own HTTP server: /api/leave/* is answered here (day counting, overlap, balance, workflow, visibility), every
// other /api route (auth, notifications, directory, search) is forwarded to the shared mock in mock-api.mjs, which is
// only reused, never edited. Static files come from the built dist/ with an SPA fallback.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { startMock, USERS } from './mock-api.mjs'

export const TODAY = '2026-11-16' // a Monday
export const HOLIDAYS = [
  [1, 1, "New Year's Day"], [2, 10, 'Chinese New Year'], [2, 25, 'EDSA People Power Day'], [4, 9, 'Araw ng Kagitingan (Day of Valor)'],
  [5, 1, 'Labor Day'], [6, 12, 'Independence Day'], [8, 21, 'Ninoy Aquino Day'], [11, 1, "All Saints' Day"], [11, 30, 'Bonifacio Day'],
  [12, 25, 'Christmas Day'], [12, 30, 'Rizal Day'],
]
const NOTICE = 'Placeholder - set by HR. Leave types and yearly entitlements are placeholder values, not company policy. Approving leave has no pay effect.'

/** Employees of the mock sign-in users (ids match mock-new-endpoints.mjs). Manager chain: Carla and Dan -> Ben; Ben and Anna -> nobody (HR fallback). */
export const EMPLOYEES = {
  'EMP-0001': { employee_id: 'EMP-0001', name: 'Anna Reyes', department: 'People & Culture', job_title: 'HR Administrator', manager_id: null },
  'EMP-0002': { employee_id: 'EMP-0002', name: 'Ben Cruz', department: 'Operations', job_title: 'Operations Manager', manager_id: null },
  'EMP-0003': { employee_id: 'EMP-0003', name: 'Carla Dizon', department: 'Compliance', job_title: 'Compliance Analyst', manager_id: 'EMP-0002' },
  'EMP-0004': { employee_id: 'EMP-0004', name: 'Dan Ocampo', department: 'Finance', job_title: 'Finance Officer', manager_id: 'EMP-0002' },
}

const iso = (d) => d.toISOString().slice(0, 10)
const parse = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(s ?? '') && !Number.isNaN(Date.parse(s)) && iso(new Date(`${s}T00:00:00Z`)) === s ? new Date(`${s}T00:00:00Z`) : null)
const addDays = (d, n) => new Date(d.getTime() + n * 86_400_000)
const dayDiff = (a, b) => Math.round((a.getTime() - b.getTime()) / 86_400_000)
const holidayTitle = (d) => HOLIDAYS.find(([m, day]) => m === d.getUTCMonth() + 1 && day === d.getUTCDate())?.[2] ?? null
const nowIso = () => new Date().toISOString()

export function countDays(start, end, half) {
  const byYear = {}
  const holidays = []
  let weekend = 0
  const factor = half !== 'none' && start.getTime() === end.getTime() ? 0.5 : 1
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const wd = d.getUTCDay()
    if (wd === 0 || wd === 6) weekend++
    else if (holidayTitle(d)) holidays.push({ date: iso(d), title: holidayTitle(d) })
    else byYear[d.getUTCFullYear()] = (byYear[d.getUTCFullYear()] ?? 0) + factor
  }
  return { byYear, days: Object.values(byYear).reduce((a, b) => a + b, 0), holidays, weekend }
}

class ApiErr extends Error {
  constructor(status, detail, extra = {}) {
    super(detail)
    this.status = status
    this.body = { detail, ...extra }
  }
}

export function createLeaveState() {
  return {
    today: TODAY,
    types: [
      { type_id: 'vacation', name: 'Vacation', paid: true, annual_days: 15, requires_reason: false, active: true, placeholder: true, sort_order: 1 },
      { type_id: 'sick', name: 'Sick', paid: true, annual_days: 10, requires_reason: false, active: true, placeholder: true, sort_order: 2 },
      { type_id: 'personal', name: 'Personal', paid: true, annual_days: 3, requires_reason: false, active: true, placeholder: true, sort_order: 3 },
      { type_id: 'unpaid', name: 'Unpaid', paid: false, annual_days: 0, requires_reason: false, active: true, placeholder: true, sort_order: 4 },
    ],
    entitlements: [], // {employee_id,type_id,year,days}
    requests: [],
    force: {}, // key -> status (or {status, body}) for the next calls; sticky until deleted
    delay: {}, // key -> ms
    log: [], // 'METHOD /path?query' strings
    bodies: [], // [{route, body}] of writes
    seq: 0,
  }
}

const userByToken = (token) => USERS.find((u) => `acc-${u.user_id}` === token) ?? null
const isHr = (u) => u.roles.includes('HRAdmin')
const isMgr = (u) => u.roles.includes('Manager')

function approverOf(empId) {
  const emp = EMPLOYEES[empId]
  const mgr = emp?.manager_id ? EMPLOYEES[emp.manager_id] : null
  const mgrUser = mgr ? USERS.find((u) => u.employee_id === mgr.employee_id && u.roles.includes('Manager')) : null
  return mgrUser ? { kind: 'manager', employee_id: mgr.employee_id, name: mgr.name } : { kind: 'hr_fallback', employee_id: null, name: null }
}

function typeView(state, t, user) {
  const inUse = isHr(user) ? state.requests.some((r) => r.type_id === t.type_id) : null
  const { sort_order, ...rest } = t
  void sort_order
  return { ...rest, in_use: inUse, created_at: nowIso(), updated_at: nowIso() }
}

function view(state, r, user) {
  const emp = EMPLOYEES[r.employee_id]
  return {
    request_id: r.request_id, employee_id: r.employee_id,
    employee: { employee_id: emp.employee_id, name: emp.name, department: emp.department, job_title: emp.job_title },
    type_id: r.type_id, type_name: state.types.find((t) => t.type_id === r.type_id)?.name ?? r.type_id, paid: state.types.find((t) => t.type_id === r.type_id)?.paid ?? true,
    start_date: r.start_date, end_date: r.end_date, half_day: r.half_day, days: r.days, days_by_year: r.days_by_year,
    reason: r.reason, status: r.status, approver: approverOf(r.employee_id), decisions: r.decisions,
    created_at: r.created_at, updated_at: r.updated_at, submitted_at: r.submitted_at, decided_at: r.decided_at, cancelled_at: r.cancelled_at,
    version: r.version, allowed_actions: allowedActions(state, r, user),
  }
}

function canDecide(r, user) {
  if (r.employee_id === user.employee_id) return false
  const a = approverOf(r.employee_id)
  if (a.kind === 'manager') return a.employee_id === user.employee_id && isMgr(user)
  return isHr(user)
}
function allowedActions(state, r, user) {
  if (r.employee_id === user.employee_id) {
    if (r.status === 'pending') return ['cancel']
    if (r.status === 'clarification_requested') return ['edit', 'resubmit', 'cancel']
    if (r.status === 'approved' && r.start_date >= state.today) return ['cancel']
    return []
  }
  return r.status === 'pending' && canDecide(r, user) ? ['approve', 'reject', 'clarify'] : []
}
function visible(r, user) {
  if (r.employee_id === user.employee_id) return true
  if (isHr(user)) return true
  return isMgr(user) && EMPLOYEES[r.employee_id]?.manager_id === user.employee_id
}

function entitlementFor(state, empId, t, year) {
  const o = state.entitlements.find((e) => e.employee_id === empId && e.type_id === t.type_id && e.year === year)
  return o ? o.days : t.annual_days
}
function committed(state, empId, typeId, excludeId) {
  const used = {}
  const pending = {}
  for (const r of state.requests) {
    if (r.employee_id !== empId || r.type_id !== typeId || r.request_id === excludeId) continue
    const target = r.status === 'approved' ? used : r.status === 'pending' ? pending : null
    if (!target) continue
    for (const [y, d] of Object.entries(r.days_by_year)) target[y] = (target[y] ?? 0) + d
  }
  return { used, pending }
}

function shape(state, b) {
  const start = parse(b.start_date)
  const end = parse(b.end_date)
  const half = b.half_day ?? 'none'
  if (!start || !end) throw new ApiErr(422, 'Enter valid dates', { code: 'invalid_date' })
  if (!['none', 'am', 'pm'].includes(half)) throw new ApiErr(422, 'half_day must be none, am or pm', { code: 'invalid_half_day' })
  if (end < start) throw new ApiErr(422, 'The end date cannot be before the start date', { code: 'invalid_range' })
  if (half !== 'none' && start.getTime() !== end.getTime()) throw new ApiErr(422, 'A half day can only be requested for a single day', { code: 'half_day_range' })
  if (Math.abs(dayDiff(start, parse(state.today))) > 365) throw new ApiErr(422, 'The start date must be within 365 days of today', { code: 'date_window' })
  if (dayDiff(end, start) + 1 > 366) throw new ApiErr(422, 'A request can cover at most 366 days', { code: 'span_too_long' })
  return { start, end, half, count: countDays(start, end, half) }
}

function overlapWith(state, empId, start, end, half, excludeId) {
  return state.requests.find((r) => {
    if (r.employee_id !== empId || r.request_id === excludeId || !['pending', 'approved'].includes(r.status)) return false
    if (r.start_date > iso(end) || r.end_date < iso(start)) return false
    const sameSingleDay = r.start_date === r.end_date && iso(start) === iso(end) && r.start_date === iso(start)
    if (sameSingleDay && half !== 'none' && r.half_day !== 'none' && half !== r.half_day) return false
    return true
  })
}

function checkRules(state, empId, b, excludeId, { balance = true } = {}) {
  const s = shape(state, b)
  const t = state.types.find((x) => x.type_id === b.type_id)
  if (!t) throw new ApiErr(422, 'Unknown leave type', { code: 'unknown_type' })
  if (!t.active) throw new ApiErr(422, 'This leave type is no longer available', { code: 'inactive_type' })
  if (s.count.days <= 0) throw new ApiErr(422, 'The selected dates contain no working days', { code: 'no_working_days' })
  if (t.requires_reason && !(b.reason ?? '').trim()) throw new ApiErr(422, 'A reason is required for this leave type', { code: 'reason_required' })
  if (balance) {
    const over = overlapWith(state, empId, s.start, s.end, s.half, excludeId)
    if (over) throw new ApiErr(409, 'You already have a pending or approved leave request that overlaps these dates', { code: 'overlap', conflicting_request_id: over.request_id })
    if (t.paid) {
      const c = committed(state, empId, t.type_id, excludeId)
      for (const [y, d] of Object.entries(s.count.byYear)) {
        const remaining = entitlementFor(state, empId, t, Number(y)) - (c.used[y] ?? 0) - (c.pending[y] ?? 0)
        if (d > remaining + 1e-9) throw new ApiErr(422, `Not enough leave balance: ${remaining} day(s) remaining for ${y}`, { code: 'insufficient_balance', year: Number(y), remaining, requested: d })
      }
    }
  }
  return { ...s, type: t }
}

function balancesFor(state, empId, year) {
  const items = []
  for (const t of state.types) {
    const c = committed(state, empId, t.type_id)
    const used = c.used[year] ?? 0
    const pending = c.pending[year] ?? 0
    if (!t.active && used + pending === 0) continue
    const ent = entitlementFor(state, empId, t, year)
    const override = state.entitlements.some((e) => e.employee_id === empId && e.type_id === t.type_id && e.year === year)
    items.push({ type_id: t.type_id, name: t.name, paid: t.paid, active: t.active, entitlement: ent, override, used, pending, remaining: t.paid ? ent - used - pending : null, unlimited: !t.paid })
  }
  return items
}

const sortDesc = (a, b) => b.start_date.localeCompare(a.start_date) || b.created_at.localeCompare(a.created_at) || a.request_id.localeCompare(b.request_id)

function listRequests(state, user, q) {
  const scope = q.get('scope') ?? 'mine'
  if (!['mine', 'review', 'team', 'all'].includes(scope)) throw new ApiErr(400, 'Unknown scope')
  const status = q.get('status')
  if (status && !['pending', 'approved', 'rejected', 'clarification_requested', 'cancelled'].includes(status)) throw new ApiErr(400, 'Unknown status')
  let list
  if (scope === 'mine') list = state.requests.filter((r) => r.employee_id === user.employee_id)
  else if (scope === 'review') {
    if (!isMgr(user) && !isHr(user)) throw new ApiErr(403, 'Not allowed')
    list = state.requests.filter((r) => r.status === 'pending' && canDecide(r, user))
  } else if (scope === 'team') {
    if (!isMgr(user)) throw new ApiErr(403, 'Not allowed')
    list = state.requests.filter((r) => EMPLOYEES[r.employee_id]?.manager_id === user.employee_id)
  } else {
    if (!isHr(user)) throw new ApiErr(403, 'Not allowed')
    list = [...state.requests]
  }
  if (status) list = list.filter((r) => r.status === status)
  if (q.get('type_id')) list = list.filter((r) => r.type_id === q.get('type_id'))
  if (q.get('employee_id')) list = list.filter((r) => r.employee_id === q.get('employee_id'))
  if (q.get('year')) list = list.filter((r) => Object.keys(r.days_by_year).includes(q.get('year')))
  list.sort(scope === 'review' ? (a, b) => a.start_date.localeCompare(b.start_date) || a.request_id.localeCompare(b.request_id) : sortDesc)
  const pageSize = Math.min(50, Math.max(1, Number(q.get('page_size') ?? 20)))
  const page = Math.max(1, Number(q.get('page') ?? 1))
  return { items: list.slice((page - 1) * pageSize, page * pageSize).map((r) => view(state, r, user)), total: list.length, page, page_size: pageSize }
}

function team(state, user, month) {
  const cur = state.today.slice(0, 7)
  const m = month ?? cur
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) throw new ApiErr(400, 'month must be YYYY-MM')
  const n = (x) => Number(x.slice(0, 4)) * 12 + Number(x.slice(5, 7))
  if (Math.abs(n(m) - n(cur)) > 12) throw new ApiErr(400, 'month is outside the allowed range')
  const first = `${m}-01`
  const last = `${m}-31`
  const items = state.requests
    .filter((r) => r.status === 'approved' && r.end_date >= first && r.start_date <= last)
    .filter((r) => r.employee_id === user.employee_id || isHr(user) || (isMgr(user) && EMPLOYEES[r.employee_id]?.manager_id === user.employee_id))
    .map((r) => ({ employee_id: r.employee_id, employee_name: EMPLOYEES[r.employee_id].name, department: EMPLOYEES[r.employee_id].department, type_id: r.type_id, type_name: state.types.find((t) => t.type_id === r.type_id)?.name, start_date: r.start_date, end_date: r.end_date, half_day: r.half_day, days: r.days, own: r.employee_id === user.employee_id }))
    .sort((a, b) => a.start_date.localeCompare(b.start_date) || a.employee_name.localeCompare(b.employee_name))
  return { month: m, days_in_month: new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0).getDate(), total: items.length, items }
}

/** Seeds a request directly (any status) for UI tests. Returns the stored request. */
export function seedRequest(state, o) {
  const emp = o.employee_id
  const half = o.half_day ?? 'none'
  const s = shape(state, { start_date: o.start_date, end_date: o.end_date ?? o.start_date, half_day: half })
  const t = ++state.seq
  const at = o.created_at ?? new Date(Date.parse('2026-11-10T08:00:00.000Z') + t * 60_000).toISOString()
  const r = {
    request_id: o.request_id ?? `00000000-0000-4000-8000-${String(t).padStart(12, '0')}`, employee_id: emp, type_id: o.type_id ?? 'vacation',
    start_date: o.start_date, end_date: o.end_date ?? o.start_date, half_day: half, days: s.count.days, days_by_year: Object.fromEntries(Object.entries(s.count.byYear).map(([y, d]) => [y, d])),
    reason: o.reason ?? null, status: o.status ?? 'pending', decisions: o.decisions ?? [], created_at: at, updated_at: at, submitted_at: at,
    decided_at: o.decided_at ?? null, cancelled_at: o.cancelled_at ?? null, version: o.version ?? 1,
  }
  state.requests.push(r)
  return r
}

async function handleLeave(state, req, url, user, json) {
  const route = url.pathname.replace(/^\/api\/leave/, '') || '/'
  const method = req.method
  const q = url.searchParams
  const key = `${method} ${route.replace(/\/[0-9a-f-]{36}/g, '/:id')}`
  state.log.push(`${method} ${route}${url.search}`)
  if (method !== 'GET') state.bodies.push({ route: `${method} ${route}`, body: json })
  const forced = state.force[key] ?? state.force[route.split('/')[1]]
  if (state.delay[key]) await new Promise((r) => setTimeout(r, state.delay[key]))
  if (forced) {
    const f = typeof forced === 'number' ? { status: forced, body: { detail: 'Mocked failure' } } : forced
    throw new ApiErr(f.status, f.body?.detail ?? 'Mocked failure', f.body ? Object.fromEntries(Object.entries(f.body).filter(([k]) => k !== 'detail')) : {})
  }
  if (!user.employee_id) throw new ApiErr(403, 'No employee record')

  if (route === '/config' && method === 'GET') {
    return { today: state.today, year: Number(state.today.slice(0, 4)), notice: NOTICE, half_day_values: ['none', 'am', 'pm'], window_days: 365, max_span_days: 366, statuses: ['pending', 'approved', 'rejected', 'clarification_requested', 'cancelled'], scopes: ['mine', 'review', 'team', 'all'], reason_max_chars: 500, comment_max_chars: 1000 }
  }
  if (route === '/types' && method === 'GET') {
    const inactive = q.get('include_inactive') === 'true'
    if (inactive && !isHr(user)) throw new ApiErr(403, 'Not allowed')
    const items = state.types.filter((t) => inactive || t.active).sort((a, b) => Number(b.active) - Number(a.active) || a.sort_order - b.sort_order).map((t) => typeView(state, t, user))
    return { items, total: items.length, notice: NOTICE }
  }
  if (route === '/types' && method === 'POST') {
    if (!isHr(user)) throw new ApiErr(403, 'Not allowed')
    const name = String(json.name ?? '').trim()
    if (!name) throw new ApiErr(422, 'A name is required', { code: 'name_required' })
    if (state.types.some((t) => t.name.toLowerCase() === name.toLowerCase())) throw new ApiErr(409, 'A leave type with this name already exists')
    const t = { type_id: `custom-${++state.seq}`, name, paid: json.paid ?? true, annual_days: json.annual_days ?? 0, requires_reason: json.requires_reason ?? false, active: true, placeholder: false, sort_order: 100 + state.seq }
    state.types.push(t)
    return [201, typeView(state, t, user)]
  }
  let m = route.match(/^\/types\/([^/]+)$/)
  if (m) {
    if (!isHr(user)) throw new ApiErr(403, 'Not allowed')
    const t = state.types.find((x) => x.type_id === decodeURIComponent(m[1]))
    if (!t) throw new ApiErr(404, 'Leave type not found')
    if (method === 'PATCH') {
      const keys = Object.keys(json)
      if (keys.length === 0) throw new ApiErr(422, 'No changes were provided', { code: 'no_changes' })
      if (json.name !== undefined && state.types.some((x) => x !== t && x.name.toLowerCase() === String(json.name).trim().toLowerCase())) throw new ApiErr(409, 'A leave type with this name already exists')
      for (const k of keys) {
        if (k === 'name') t.name = String(json[k]).trim()
        else t[k] = json[k]
        if (k !== 'active') t.placeholder = false
      }
      return typeView(state, t, user)
    }
    if (method === 'DELETE') {
      if (['vacation', 'sick', 'personal', 'unpaid'].includes(t.type_id) || state.requests.some((r) => r.type_id === t.type_id)) throw new ApiErr(409, 'This leave type cannot be deleted: deactivate it instead')
      state.types = state.types.filter((x) => x !== t)
      state.entitlements = state.entitlements.filter((e) => e.type_id !== t.type_id)
      return 204
    }
  }
  if (route === '/entitlements') {
    if (!isHr(user)) throw new ApiErr(403, 'Not allowed')
    const row = (e) => ({ ...e, employee_name: EMPLOYEES[e.employee_id]?.name ?? e.employee_id, type_name: state.types.find((t) => t.type_id === e.type_id)?.name ?? e.type_id, updated_at: nowIso() })
    if (method === 'GET') {
      let list = state.entitlements
      if (q.get('year')) list = list.filter((e) => e.year === Number(q.get('year')))
      if (q.get('employee_id')) list = list.filter((e) => e.employee_id === q.get('employee_id'))
      if (q.get('type_id')) list = list.filter((e) => e.type_id === q.get('type_id'))
      return { items: list.map(row), total: list.length }
    }
    if (method === 'POST') {
      if (!state.types.some((t) => t.type_id === json.type_id)) throw new ApiErr(422, 'Unknown leave type', { code: 'unknown_type' })
      if (!/^EMP-\d{4}$/.test(json.employee_id ?? '')) throw new ApiErr(422, 'Unknown employee', { code: 'unknown_employee' })
      const i = state.entitlements.findIndex((e) => e.employee_id === json.employee_id && e.type_id === json.type_id && e.year === json.year)
      const e = { employee_id: json.employee_id, type_id: json.type_id, year: json.year, days: json.days }
      if (i >= 0) state.entitlements[i] = e
      else state.entitlements.push(e)
      return row(e)
    }
    if (method === 'DELETE') {
      const i = state.entitlements.findIndex((e) => e.employee_id === q.get('employee_id') && e.type_id === q.get('type_id') && e.year === Number(q.get('year')))
      if (i < 0) throw new ApiErr(404, 'Override not found')
      state.entitlements.splice(i, 1)
      return 204
    }
  }
  if (route === '/balances' && method === 'GET') {
    const year = q.get('year') ? Number(q.get('year')) : Number(state.today.slice(0, 4))
    if (!(year >= 2000 && year <= 2100)) throw new ApiErr(422, 'year is out of range', { code: 'invalid_year' })
    return { year, employee_id: user.employee_id, notice: NOTICE, items: balancesFor(state, user.employee_id, year) }
  }
  if (route === '/preview' && method === 'GET') {
    const b = { type_id: q.get('type_id'), start_date: q.get('start_date'), end_date: q.get('end_date'), half_day: q.get('half_day') ?? 'none' }
    const s = shape(state, b)
    const t = state.types.find((x) => x.type_id === b.type_id)
    if (!t) throw new ApiErr(422, 'Unknown leave type', { code: 'unknown_type' })
    const issues = []
    if (!t.active) issues.push({ code: 'inactive_type', message: 'This leave type is no longer available' })
    if (s.count.days <= 0) issues.push({ code: 'no_working_days', message: 'The selected dates contain no working days' })
    const balance = []
    if (s.count.days > 0) {
      if (overlapWith(state, user.employee_id, s.start, s.end, s.half)) issues.push({ code: 'overlap', message: 'You already have a pending or approved leave request that overlaps these dates' })
      const c = committed(state, user.employee_id, t.type_id)
      for (const [y, d] of Object.entries(s.count.byYear)) {
        const ent = entitlementFor(state, user.employee_id, t, Number(y))
        const used = c.used[y] ?? 0
        const pending = c.pending[y] ?? 0
        const remaining = ent - used - pending
        balance.push({ year: Number(y), entitlement: ent, used, pending, requested: d, remaining_after: t.paid ? remaining - d : null })
        if (t.paid && d > remaining + 1e-9) issues.push({ code: 'insufficient_balance', message: `Not enough leave balance: ${remaining} day(s) remaining for ${y}` })
      }
    }
    return { type_id: b.type_id, start_date: b.start_date, end_date: b.end_date, half_day: s.half, days: s.count.days, days_by_year: s.count.byYear, weekend_days: s.count.weekend, holidays: s.count.holidays, balance, issues, valid: issues.length === 0 }
  }
  if (route === '/team' && method === 'GET') return team(state, user, q.get('month'))
  if (route === '/requests' && method === 'GET') return listRequests(state, user, q)
  if (route === '/requests' && method === 'POST') {
    const c = checkRules(state, user.employee_id, json, null)
    const t = ++state.seq
    const at = nowIso()
    const r = { request_id: `00000000-0000-4000-9000-${String(t).padStart(12, '0')}`, employee_id: user.employee_id, type_id: json.type_id, start_date: json.start_date, end_date: json.end_date, half_day: c.half, days: c.count.days, days_by_year: c.count.byYear, reason: json.reason ?? null, status: 'pending', decisions: [], created_at: at, updated_at: at, submitted_at: at, decided_at: null, cancelled_at: null, version: 1 }
    state.requests.push(r)
    return [201, view(state, r, user)]
  }
  m = route.match(/^\/requests\/([^/]+)(?:\/(resubmit|cancel|decision))?$/)
  if (m) {
    const r = state.requests.find((x) => x.request_id === m[1])
    if (!r || !visible(r, user)) throw new ApiErr(404, 'Leave request not found')
    const action = m[2]
    const stale = () => json?.version !== undefined && json?.version !== null && json.version !== r.version
    const bump = () => {
      r.version += 1
      r.updated_at = nowIso()
    }
    if (!action && method === 'GET') return view(state, r, user)
    if (!action && method === 'PATCH') {
      if (r.employee_id !== user.employee_id) throw new ApiErr(403, 'Only the owner can change this request')
      if (r.status !== 'clarification_requested') throw new ApiErr(409, 'This request can only be edited while clarification is requested')
      if (stale()) throw new ApiErr(409, 'This request was changed by someone else')
      const next = { type_id: json.type_id ?? r.type_id, start_date: json.start_date ?? r.start_date, end_date: json.end_date ?? r.end_date, half_day: json.half_day ?? r.half_day, reason: 'reason' in json ? json.reason : r.reason }
      const c = checkRules(state, r.employee_id, next, r.request_id, { balance: false })
      Object.assign(r, next, { half_day: c.half, days: c.count.days, days_by_year: c.count.byYear })
      bump()
      return view(state, r, user)
    }
    if (action === 'resubmit' && method === 'POST') {
      if (r.employee_id !== user.employee_id) throw new ApiErr(403, 'Only the owner can resubmit this request')
      if (r.status !== 'clarification_requested') throw new ApiErr(409, 'Only a request waiting for clarification can be resubmitted')
      if (stale()) throw new ApiErr(409, 'This request was changed by someone else')
      checkRules(state, r.employee_id, r, r.request_id)
      r.status = 'pending'
      r.submitted_at = nowIso()
      bump()
      return view(state, r, user)
    }
    if (action === 'cancel' && method === 'POST') {
      if (r.employee_id !== user.employee_id) throw new ApiErr(403, 'Only the owner can cancel this request')
      if (stale()) throw new ApiErr(409, 'This request was changed by someone else')
      const ok = ['pending', 'clarification_requested'].includes(r.status) || (r.status === 'approved' && r.start_date >= state.today)
      if (!ok) throw new ApiErr(409, 'This request can no longer be cancelled')
      r.status = 'cancelled'
      r.cancelled_at = nowIso()
      bump()
      return view(state, r, user)
    }
    if (action === 'decision' && method === 'POST') {
      if (!['approve', 'reject', 'clarify'].includes(json.action)) throw new ApiErr(422, 'Invalid request', { errors: [{ loc: ['body', 'action'], msg: 'Input should be approve, reject or clarify' }] })
      if (stale()) throw new ApiErr(409, 'This request was changed by someone else')
      if (r.status !== 'pending') throw new ApiErr(409, 'Only a pending request can be decided')
      if (!canDecide(r, user)) throw new ApiErr(403, 'You cannot decide this request')
      if (json.action !== 'approve' && !(json.comment ?? '').trim()) throw new ApiErr(422, 'A comment is required to reject or ask for clarification', { code: 'comment_required' })
      r.decisions.push({ decision_id: `d-${++state.seq}`, action: json.action, by_name: EMPLOYEES[user.employee_id].name, by_role: isMgr(user) ? 'Manager' : 'HRAdmin', comment: (json.comment ?? '').trim() || null, at: nowIso() })
      r.status = json.action === 'approve' ? 'approved' : json.action === 'reject' ? 'rejected' : 'clarification_requested'
      r.decided_at = nowIso()
      bump()
      return view(state, r, user)
    }
  }
  throw new ApiErr(404, 'Not found')
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {})
      } catch {
        resolve({})
      }
    })
  })
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.json': 'application/json', '.ico': 'image/x-icon' }

/** Starts the shared mock (auth, notifications, directory...) plus the leave mock in front of it. */
export async function startLeaveMock({ distDir }) {
  const shared = await startMock({ distDir })
  const state = createLeaveState()
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost')
    if (url.pathname.startsWith('/api/leave/')) {
      const json = req.method === 'GET' || req.method === 'DELETE' ? {} : await readBody(req)
      const auth = req.headers.authorization || ''
      const user = userByToken(auth.startsWith('Bearer ') ? auth.slice(7) : '')
      const send = (status, body) => {
        res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        res.end(status === 204 ? undefined : JSON.stringify(body))
      }
      if (!user) return send(401, { detail: 'Not authenticated' })
      try {
        const out = await handleLeave(state, req, url, user, json)
        if (out === 204) return send(204)
        if (Array.isArray(out)) return send(out[0], out[1])
        return send(200, out)
      } catch (e) {
        if (e instanceof ApiErr) return send(e.status, e.body)
        return send(500, { detail: 'Mock error' })
      }
    }
    if (url.pathname.startsWith('/api/')) {
      const up = http.request({ host: '127.0.0.1', port: shared.port, method: req.method, path: req.url, headers: req.headers }, (r) => {
        res.writeHead(r.statusCode ?? 502, r.headers)
        r.pipe(res)
      })
      up.on('error', () => {
        res.destroy()
      })
      req.pipe(up)
      return
    }
    let file = path.join(distDir, decodeURIComponent(url.pathname))
    if (!file.startsWith(distDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(distDir, 'index.html')
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' })
    fs.createReadStream(file).pipe(res)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return {
    state,
    shared,
    port,
    origin: `http://127.0.0.1:${port}`,
    close: async () => {
      await new Promise((resolve) => server.close(() => resolve()))
      server.closeAllConnections?.()
      await shared.close()
    },
  }
}
