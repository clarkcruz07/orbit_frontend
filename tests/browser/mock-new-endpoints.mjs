// Deterministic MOCK of the SPEC_ADDENDUM_2 routes: directory, me/profile, calendar, notifications, search.
// Hooked into mock-api.mjs the same way mock-reimbursements.mjs is. All people and dates are fictional.
// The mock plays "the server": it decides which fields/birthdays the caller may see (the UI never checks roles).
import { randomUUID } from 'node:crypto'
import { emptyProfile, sampleProfile, selfPatch, selfProfile } from './profile-mock.mjs'
import { canSeeRequest } from './mock-reimbursements.mjs'

const FIRST = ['Mara', 'Joel', 'Tessa', 'Rey', 'Nina', 'Paolo', 'Gina', 'Luis', 'Hana', 'Marco', 'Sol', 'Vince', 'Pia', 'Dino', 'Cora', 'Ivan', 'Lena', 'Omar', 'Rhea', 'Teo', 'Wren', 'Yuri', 'Zia', 'Abel', 'Bianca', 'Cesar']
const LAST = ['Abad', 'Bautista', 'Castillo', 'Dela Pena', 'Estrada', 'Fabian', 'Gomez', 'Hizon', 'Ignacio', 'Jacinto', 'Katigbak', 'Lacson', 'Magno', 'Nolasco', 'Ortega', 'Pascual', 'Quizon', 'Roxas', 'Soriano', 'Tolentino', 'Uy', 'Valdez', 'Wenceslao', 'Yap', 'Zamora', 'Alonzo']
const DEPTS = ['Operations', 'Compliance', 'Finance', 'People & Culture', 'IT Operations', 'Learning & Development']
const TYPES = ['full_time', 'full_time', 'part_time', 'contractor', 'full_time', 'intern']

/** 30 fictional people. EMP-0001..0004 are the four mock sign-in users (see mock-api.mjs USERS). */
export const EMPLOYEES = (() => {
  const base = [
    { employee_id: 'EMP-0001', name: 'Anna Reyes', job_title: 'HR Administrator', department: 'People & Culture', employment_type: 'full_time', manager_id: 'EMP-0030', start_date: '2021-03-01', birthday: '05-14' },
    { employee_id: 'EMP-0002', name: 'Ben Cruz', job_title: 'Operations Manager', department: 'Operations', employment_type: 'full_time', manager_id: 'EMP-0030', start_date: '2019-07-15', birthday: '09-02' },
    { employee_id: 'EMP-0003', name: 'Carla Dizon', job_title: 'Compliance Analyst', department: 'Compliance', employment_type: 'full_time', manager_id: 'EMP-0002', start_date: '2022-02-07', birthday: '11-23' },
    { employee_id: 'EMP-0004', name: 'Dan Ocampo', job_title: 'Finance Officer', department: 'Finance', employment_type: 'full_time', manager_id: 'EMP-0002', start_date: '2022-06-20', birthday: '03-30' },
  ]
  for (let i = 5; i <= 29; i++) {
    const n = i - 5
    const name = `${FIRST[n % FIRST.length]} ${LAST[n % LAST.length]}`
    base.push({
      employee_id: `EMP-${String(i).padStart(4, '0')}`,
      name,
      job_title: ['Coordinator', 'Analyst', 'Specialist', 'Officer', 'Trainer'][n % 5],
      department: DEPTS[n % DEPTS.length],
      employment_type: TYPES[n % TYPES.length],
      manager_id: n % 3 === 0 ? 'EMP-0003' : 'EMP-0002',
      start_date: `20${20 + (n % 6)}-0${1 + (n % 9)}-1${n % 9}`,
      birthday: `${String(1 + (n % 12)).padStart(2, '0')}-${String(3 + n).padStart(2, '0')}`,
    })
  }
  base.push({ employee_id: 'EMP-0030', name: 'Elena Marquez', job_title: 'Chief Operating Officer', department: 'Executive', employment_type: 'full_time', manager_id: null, start_date: '2018-01-08', birthday: '03-12' })
  return base.map((e) => ({ ...e, email: `${e.name.toLowerCase().replace(/[^a-z]+/g, '.')}@example.test`, avatar_initials: e.name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase(), status: 'active' }))
})()

// Fictional company holidays: exactly one per month so every month has something to show.
export const HOLIDAYS = [
  ['01-01', "New Year's Day"],
  ['02-10', 'Chinese New Year (demo)'],
  ['03-17', 'Founders Day (demo)'],
  ['04-09', 'Araw ng Kagitingan (Day of Valor)'],
  ['05-01', 'Labour Day'],
  ['06-12', 'Independence Day'],
  ['07-04', 'Mid-year Break (demo)'],
  ['08-21', 'Heroes Day (demo)'],
  ['09-15', 'Company Anniversary (demo)'],
  ['10-31', 'Founders Week Close (demo)'],
  ['11-30', 'Bonifacio Day'],
  ['12-25', 'Christmas Day'],
]

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function createNewEndpointsState() {
  return {
    extraEmployees: [], // extra fictional people (e.g. very long names/emails for responsive tests)
    now: null, // Date override for "server today" (default: real now)
    forceStatus: {}, // key -> status: 'directory' | 'directoryProfile' | 'profile' | 'calendar' | 'upcoming' | 'notifications' | 'search' | 'markRead' | 'readAll'
    searchDelayMs: 0,
    notifDelayMs: 0,
    notifications: {}, // user_id -> [{notification_id, kind, title, body, link, created_at, read}]
    searchCalls: [], // q strings
    directoryCalls: [], // raw query strings
    notifCalls: 0,
    readCalls: [], // ids
    readAllCalls: 0,
  }
}

export function addNotification(state, userId, over = {}) {
  const list = (state.newApi.notifications[userId] ??= [])
  const n = { notification_id: randomUUID(), kind: 'reimbursement.review_needed', title: 'Review needed', body: 'Client lunch from Carla Dizon is waiting for your decision.', link: '/reimbursements', created_at: new Date().toISOString(), read: false, ...over }
  list.push(n)
  return n
}

const pad = (n) => String(n).padStart(2, '0')
const hasRole = (user, role) => user.roles.includes(role)
const mdToIso = (year, md) => `${year}-${md}`
const toMonthNumber = (key) => Number(key.slice(0, 4)) * 12 + Number(key.slice(5, 7)) - 1

function entryFor(e, user, ns = { extraEmployees: [] }) {
  const manager = e.manager_id ? [...EMPLOYEES, ...ns.extraEmployees].find((m) => m.employee_id === e.manager_id) : null
  const out = {
    employee_id: e.employee_id,
    name: e.name,
    job_title: e.job_title,
    department: e.department,
    email: e.email,
    manager: manager ? { employee_id: manager.employee_id, name: manager.name } : null,
    avatar_initials: e.avatar_initials,
  }
  if (hasRole(user, 'HRAdmin')) Object.assign(out, { employment_type: e.employment_type, start_date: e.start_date, status: e.status })
  return out
}

/** Carla (EMP-0003) has a full profile; everyone else has nothing on file yet. */
const defaultSelfProfile = (e) => (e.employee_id === 'EMP-0003' ? { ...sampleProfile(), personal: { ...sampleProfile().personal, preferred_name: 'Carly' } } : emptyProfile())

function directReports(id, staff = EMPLOYEES) {
  return staff.filter((e) => e.manager_id === id).map((e) => ({ employee_id: e.employee_id, name: e.name, job_title: e.job_title }))
}

function birthdayLabel(md) {
  return `${MONTHS[Number(md.slice(0, 2)) - 1]} ${Number(md.slice(3, 5))}`
}

function visibleBirthdays(user, staff = EMPLOYEES) {
  return staff.filter((e) => hasRole(user, 'HRAdmin') || e.employee_id === user.employee_id).map((e) => ({ e, own: e.employee_id === user.employee_id }))
}

function bad(send, res, status, detail) {
  return send(res, status, { detail }) || true
}

/** Returns true when the route was handled. `ctx` = {req, res, route, method, url, user, state, send, json}. */
export function handleNewEndpoints(ctx) {
  const { route, method, url, user, state, send, res, json } = ctx
  const ns = state.newApi
  const isNew = /^\/(directory|me\/profile|calendar|notifications|search)(\/|$)/.test(route)
  if (!isNew) return false
  if (!user) return bad(send, res, 401, 'Not authenticated')
  const forced = (key) => ns.forceStatus[key]
  const reply = (key, body, status = 200) => {
    if (forced(key)) return send(res, forced(key), { detail: forced(key) === 429 ? 'Too many requests' : 'Server error' }) || true
    return send(res, status, body) || true
  }
  const later = (ms, fn) => (ms > 0 ? (setTimeout(fn, ms), true) : (fn(), true))
  const today = ns.now ?? new Date()
  const staff = [...EMPLOYEES, ...ns.extraEmployees]

  // ---------------------------------------------------------------------------------------------- directory
  if (route === '/directory/employees' && method === 'GET') {
    ns.directoryCalls.push(url.search)
    const q = (url.searchParams.get('q') || '').trim().toLowerCase()
    const department = url.searchParams.get('department')
    const etype = url.searchParams.get('employment_type')
    if (etype && !hasRole(user, 'HRAdmin')) return bad(send, res, 403, 'You cannot filter by employment type')
    const pageSize = Math.min(50, Math.max(1, Number(url.searchParams.get('page_size') || 20)))
    const page = Math.max(1, Number(url.searchParams.get('page') || 1))
    let list = staff.filter((e) => (!department || e.department === department) && (!etype || e.employment_type === etype) && (!q || [e.name, e.job_title, e.department, e.email].some((f) => f.toLowerCase().includes(q))))
    list = [...list].sort((a, b) => a.name.localeCompare(b.name) || a.employee_id.localeCompare(b.employee_id))
    const items = list.slice((page - 1) * pageSize, page * pageSize).map((e) => entryFor(e, user, ns))
    return reply('directory', { items, total: list.length, page, page_size: pageSize, departments: [...new Set(staff.map((e) => e.department))].sort() })
  }
  let m = route.match(/^\/directory\/employees\/([^/]+)$/)
  if (m && method === 'GET') {
    const e = staff.find((x) => x.employee_id === decodeURIComponent(m[1]))
    if (forced('directoryProfile')) return reply('directoryProfile', null)
    if (!e) return bad(send, res, 404, 'Not found')
    return send(res, 200, { ...entryFor(e, user, ns), direct_reports: directReports(e.employee_id, staff) }) || true
  }

  // ---------------------------------------------------------------------------------------------- my profile
  const myProfileBody = (e) => ({
    employee: { ...entryFor(e, user, ns), employment_type: e.employment_type, start_date: e.start_date, status: e.status, profile: selfProfile(ns.profiles?.[e.employee_id] ?? defaultSelfProfile(e)) },
    manager: entryFor(e, user, ns).manager,
    direct_reports: directReports(e.employee_id, staff),
    birthday: birthdayLabel(e.birthday),
    roles: user.roles,
    auth_source: user.auth_source ?? 'demo',
    member_since: e.start_date,
  })
  if (route === '/me/profile' && method === 'PATCH') {
    const e = staff.find((x) => x.employee_id === user.employee_id)
    if (!e) return bad(send, res, 404, 'Not found')
    ns.selfPatches = ns.selfPatches ?? []
    ns.selfPatches.push(json)
    if (forced('profilePatch')) return send(res, forced('profilePatch'), { detail: 'Server error' }) || true
    if (ns.patchOnce) {
      const r = ns.patchOnce
      ns.patchOnce = null
      return send(res, r.status, r.body) || true
    }
    const r = selfPatch(ns.profiles?.[e.employee_id] ?? defaultSelfProfile(e), json)
    if (!r.next) return send(res, r.status, r.body) || true
    ns.profiles = ns.profiles ?? {}
    ns.profiles[e.employee_id] = r.next
    return send(res, 200, myProfileBody(e)) || true
  }
  if (route === '/me/profile' && method === 'GET') {
    const e = staff.find((x) => x.employee_id === user.employee_id)
    if (!e) return bad(send, res, 404, 'Not found')
    return reply('profile', {
      employee: { ...entryFor(e, user, ns), employment_type: e.employment_type, start_date: e.start_date, status: e.status, profile: selfProfile(ns.profiles?.[e.employee_id] ?? defaultSelfProfile(e)) },
      manager: entryFor(e, user, ns).manager,
      direct_reports: directReports(e.employee_id, staff),
      birthday: birthdayLabel(e.birthday),
      roles: user.roles,
      auth_source: user.auth_source ?? 'demo',
      member_since: e.start_date,
    })
  }

  // ---------------------------------------------------------------------------------------------- calendar
  if (route === '/calendar' && method === 'GET') {
    const current = `${today.getFullYear()}-${pad(today.getMonth() + 1)}`
    const month = url.searchParams.get('month') || current
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return bad(send, res, 400, 'Invalid month')
    if (Math.abs(toMonthNumber(month) - toMonthNumber(current)) > 12) return bad(send, res, 400, 'Month out of range')
    const year = Number(month.slice(0, 4))
    const mm = month.slice(5, 7)
    const events = []
    for (const [md, title] of HOLIDAYS) if (md.startsWith(`${mm}-`)) events.push({ date: mdToIso(year, md), type: 'holiday', title, subtitle: 'Public Holiday', own: false })
    for (const { e, own } of visibleBirthdays(user, staff)) if (e.birthday.startsWith(`${mm}-`)) events.push({ date: mdToIso(year, e.birthday), type: 'birthday', title: e.name, subtitle: e.department, own })
    const days = new Date(year, Number(mm), 0).getDate()
    return reply('calendar', { month, days_in_month: days, events })
  }
  if (route === '/calendar/upcoming' && method === 'GET') {
    const days = Math.min(90, Math.max(1, Number(url.searchParams.get('days') || 30)))
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate())
    const holidays = []
    const birthdays = []
    for (let i = 0; i < days; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)
      const md = `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
      const iso = `${d.getFullYear()}-${md}`
      for (const [hmd, title] of HOLIDAYS) if (hmd === md) holidays.push({ date: iso, type: 'holiday', title, subtitle: 'Public Holiday', own: false })
      for (const { e, own } of visibleBirthdays(user, staff)) if (e.birthday === md) birthdays.push({ date: iso, type: 'birthday', title: e.name, subtitle: e.department, own })
    }
    return reply('upcoming', { holidays: holidays.slice(0, 20), birthdays: birthdays.slice(0, 20) })
  }

  // ---------------------------------------------------------------------------------------------- notifications
  if (route === '/notifications' && method === 'GET') {
    ns.notifCalls += 1
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || 30)))
    const unreadOnly = url.searchParams.get('unread_only') === 'true'
    const all = [...(ns.notifications[user.user_id] ?? [])].sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    const items = (unreadOnly ? all.filter((n) => !n.read) : all).slice(0, limit)
    const body = { items, unread_count: all.filter((n) => !n.read).length }
    return later(ns.notifDelayMs, () => reply('notifications', body))
  }
  if (route === '/notifications/read-all' && method === 'POST') {
    ns.readAllCalls += 1
    if (forced('readAll')) return reply('readAll', null)
    for (const n of ns.notifications[user.user_id] ?? []) n.read = true
    return send(res, 204) || true
  }
  m = route.match(/^\/notifications\/([^/]+)\/read$/)
  if (m && method === 'POST') {
    const id = decodeURIComponent(m[1])
    ns.readCalls.push(id)
    if (forced('markRead')) return reply('markRead', null)
    const n = (ns.notifications[user.user_id] ?? []).find((x) => x.notification_id === id)
    if (!n) return bad(send, res, 404, 'Not found')
    n.read = true
    return send(res, 204) || true
  }

  // ---------------------------------------------------------------------------------------------- search
  if (route === '/search' && method === 'GET') {
    const raw = url.searchParams.get('q') ?? ''
    ns.searchCalls.push(raw)
    const q = raw.trim()
    if (q.length < 2 || q.length > 64) return bad(send, res, 400, 'Query must be 2 to 64 characters')
    const needle = q.toLowerCase()
    const people = staff.filter((e) => [e.name, e.job_title, e.department, e.email].some((f) => f.toLowerCase().includes(needle)))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 8)
      .map((e) => ({ employee_id: e.employee_id, name: e.name, job_title: e.job_title, department: e.department }))
    const requests = state.reimb.requests
      .filter((r) => canSeeRequest(r, user) && !(r.status === 'draft' && r.employee_id !== user.employee_id) && r.purpose.toLowerCase().includes(needle))
      .slice(0, 8)
      .map((r) => ({ request_id: r.request_id, purpose: r.purpose, status: r.status }))
    return later(ns.searchDelayMs, () => reply('search', { q, people, requests, limit: 8 }))
  }

  return bad(send, res, 404, 'Not found')
}
