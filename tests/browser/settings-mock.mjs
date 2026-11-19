// Self-contained MOCK API for the Settings specs (docs/api/preferences.md + docs/api/livedash.md section 1). It also serves the
// built app from `distDir`. Everything is fictional. The mock plays "the server": HR-only routes answer 403 to other accounts,
// writes are strict (like the real backend) and `state.force` / `state.delay` let a test force a status or slow a route.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { handleClock } from './mock-clock.mjs'

export const U = {
  anna: { user_id: 'u-anna', email: 'anna.reyes@example.test', name: 'Anna Reyes', roles: ['HRAdmin'], employee_id: 'EMP-0001', job_title: 'HR Administrator', department: 'People & Culture', avatar_initials: 'AR', demo: true },
  ben: { user_id: 'u-ben', email: 'ben.cruz@example.test', name: 'Ben Cruz', roles: ['Manager'], employee_id: 'EMP-0002', job_title: 'Operations Manager', department: 'Operations', avatar_initials: 'BC', demo: true },
  carla: { user_id: 'u-carla', email: 'carla.dizon@example.test', name: 'Carla Dizon', roles: ['Employee'], employee_id: 'EMP-0003', job_title: 'Compliance Analyst', department: 'Compliance', avatar_initials: 'CD', demo: true },
  dan: { user_id: 'u-dan', email: 'dan.ocampo@example.test', name: 'Dan Ocampo', roles: ['Finance'], employee_id: 'EMP-0004', job_title: 'Finance Officer', department: 'Finance', avatar_initials: 'DO', demo: true },
}
export const ALL_USERS = Object.values(U)

export const GROUPS = [
  ['reimbursements', 'Reimbursements', 'Requests waiting for your review and decisions on your own requests.'],
  ['leave', 'Leave', 'Leave requests waiting for your decision and decisions on your own leave.'],
  ['timesheet', 'Attendance and timesheets', 'Timesheets and attendance corrections waiting for you, and decisions on yours.'],
  ['performance', 'Performance and check-ins', 'Check-in requests, submitted check-ins, feedback and goal comments.'],
  ['learning', 'Learning and development', 'Courses assigned to you, due dates and completion reviews.'],
  ['documents', 'Documents and policies', 'New policies to read and documents that are about to expire.'],
  ['cases', 'HR requests', 'New cases, replies and status changes on HR requests.'],
]

const FIRST = ['Mara', 'Joel', 'Ines', 'Rey', 'Tess', 'Luz', 'Omar', 'Pia', 'Nico', 'Vera', 'Gil', 'Rosa', 'Ian', 'Dina', 'Ted']
const LAST = ['Aquino', 'Bautista', 'Castro', 'Dizon', 'Estrada', 'Flores', 'Garcia']
const DEPT = ['Operations', 'Finance', 'Compliance', 'People & Culture', 'Learning & Development', 'IT Operations']

/** 4 named accounts + generated ones so the table paginates (total = 4 + extra). */
function makeUsers(extra = 41) {
  const rows = ALL_USERS.map((u, i) => ({
    user_id: u.user_id,
    name: u.name,
    email: u.email,
    roles: [...u.roles].sort(),
    employee_id: u.employee_id,
    auth_source: i === 0 ? 'microsoft' : 'demo',
    is_demo: i !== 0,
    department: u.department,
    job_title: u.job_title,
  }))
  for (let i = 0; i < extra; i++) {
    const name = `${FIRST[i % FIRST.length]} ${LAST[i % LAST.length]}${i >= FIRST.length ? ` ${i}` : ''}`
    rows.push({
      user_id: `u-gen-${i}`,
      name,
      email: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '.')}@example.test`,
      roles: ['Employee'],
      employee_id: `EMP-${String(100 + i).padStart(4, '0')}`,
      auth_source: i % 5 === 0 ? 'password' : 'demo',
      is_demo: i % 5 !== 0,
      department: DEPT[i % DEPT.length],
      job_title: i % 3 === 0 ? 'Analyst' : null,
    })
  }
  return rows
}

// ------------------------------------------------------------------------------------------------ live dashboards
const NOT_TRACKED = 'Not tracked by any module yet'
const na = (extra = {}) => ({ ...extra, available: false, reason: NOT_TRACKED })

export function liveDashboard() {
  return {
    summary: {
      headcount: { value: 19, delta_pct: 11.8, period: 'vs last month' },
      onboarding: na({ value: null, status: null }),
      offboarding: na({ value: null, status: null }),
      expiring_documents: { value: 3, window_days: 30 },
      policy_acknowledgement: { pct: 50.0, delta_pp: null },
    },
    headcount_trend: [
      { month: 'Jun', value: 16 },
      { month: 'Jul', value: 16 },
      { month: 'Aug', value: 17 },
      { month: 'Sep', value: 17 },
      { month: 'Oct', value: 18 },
      { month: 'Nov', value: 19 },
    ],
    onboarding: na({ total: null, completed: null, in_progress: null, not_started: null, pct: null }),
    offboarding: na({ total: null, completed: null, in_progress: null, not_started: null, pct: null }),
    directory: { total: 19, full_time: 15, part_time: 2, contractor: 1, intern: 1 },
    hr_cases: { active: 4, high: 2, medium: 1, low: 1, avg_resolution_days: 0.0, delta_pct: null },
    microsoft_accounts: { synced: 19, active_users: 12, not_signed_in: 7, by_role: [{ role: 'Employee', count: 12 }, { role: 'HRAdmin', count: 2 }, { role: 'Manager', count: 3 }] },
    birthdays: [{ name: 'Carla Dizon', team: 'Compliance', date: 'Nov 23', avatar_initials: 'CD' }],
    holidays: [{ month: 'Nov', day: 30, name: 'Bonifacio Day', type: 'Public Holiday' }],
    unavailable_blocks: [],
  }
}

/** A tiny company: 14 people, one trend point, zero cases, nothing expiring, no birthdays or holidays. */
export function liveTiny() {
  const d = liveDashboard()
  d.summary.headcount = { value: 14, delta_pct: null, period: 'vs last month' }
  d.summary.expiring_documents = { value: 0, window_days: 30 }
  d.summary.policy_acknowledgement = { pct: null, delta_pp: null, available: false, reason: 'No policy to measure yet' }
  d.headcount_trend = [{ month: 'Nov', value: 14 }]
  d.directory = { total: 14, full_time: 14, part_time: 0, contractor: 0, intern: 0 }
  d.hr_cases = { active: 0, high: 0, medium: 0, low: 0, avg_resolution_days: null, delta_pct: null }
  d.birthdays = []
  d.holidays = []
  return d
}

/** Several blocks failed on the server: `{keys: null, available:false, reason:"Temporarily unavailable"}` and empty lists. */
export function liveDegraded() {
  const d = liveDashboard()
  const down = (keys) => Object.fromEntries([...keys.map((k) => [k, null]), ['available', false], ['reason', 'Temporarily unavailable']])
  d.summary.headcount = { ...down(['value', 'delta_pct']), period: 'vs last month' }
  d.directory = down(['total', 'full_time', 'part_time', 'contractor', 'intern'])
  d.hr_cases = down(['active', 'high', 'medium', 'low', 'avg_resolution_days', 'delta_pct'])
  d.headcount_trend = []
  d.birthdays = []
  d.unavailable_blocks = ['headcount', 'headcount_trend', 'directory', 'hr_cases', 'birthdays']
  return d
}

// ------------------------------------------------------------------------------------------------ server
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.json': 'application/json', '.ico': 'image/x-icon' }
const FORBIDDEN = { detail: 'You do not have access to this resource' }

export async function startSettingsMock({ distDir }) {
  const state = {
    prefs: {}, // user_id -> {group: bool}
    prefsUpdatedAt: {}, // user_id -> iso
    settings: { hr_can_see_mood: false },
    updated: { hr_can_see_mood: null },
    schedule: { enabled: true, login_time: '09:00', logout_time: '18:00', days: [1, 2, 3, 4, 5], lead_minutes: 10 },
    scheduleSaved: false,
    users: makeUsers(),
    liveVariant: liveDashboard, // function returning the dashboard payload (always computed from live data)
    force: {}, // route key -> status code
    delay: {}, // route key -> ms
    log: [], // "METHOD /route"
    calls: [], // {method, route, body}
    authSource: 'microsoft',
    overview: { hr_can_see_mood: false, roles_editable: false, company_timezone: 'Asia/Manila', version: '0.1' },
  }

  const send = (res, status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    res.end(status === 204 ? undefined : JSON.stringify(body ?? {}))
  }
  const readBody = (req) =>
    new Promise((resolve) => {
      let raw = ''
      req.on('data', (c) => (raw += c))
      req.on('end', () => {
        try {
          resolve(raw ? JSON.parse(raw) : {})
        } catch {
          resolve({ __invalid: true })
        }
      })
    })

  const prefItems = (uid) => {
    const g = state.prefs[uid] ?? {}
    return {
      groups: Object.fromEntries(GROUPS.map(([k]) => [k, g[k] !== false])),
      items: GROUPS.map(([k, label, description]) => ({ group: k, label, description, enabled: g[k] !== false })),
      updated_at: state.prefsUpdatedAt[uid] ?? null,
    }
  }
  const settingsView = () => ({ ...state.settings, updated: state.updated })

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost')
    if (!url.pathname.startsWith('/api/')) {
      let file = path.join(distDir, decodeURIComponent(url.pathname))
      if (!file.startsWith(distDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(distDir, 'index.html')
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' })
      return fs.createReadStream(file).pipe(res)
    }
    const route = url.pathname.slice(4)
    const method = req.method
    const body = method === 'GET' ? {} : await readBody(req)
    state.log.push(`${method} ${route}`)
    state.calls.push({ method, route, body, query: Object.fromEntries(url.searchParams) })

    const token = (req.headers.authorization || '').replace(/^Bearer /, '')
    const m = token.match(/^acc-(.+)$/)
    const user = m ? ALL_USERS.find((u) => u.user_id === m[1]) : null
    const key = `${method} ${route}`
    const wait = state.delay[key] ?? 0
    if (wait) await new Promise((r) => setTimeout(r, wait))

    if (route === '/auth/config') return send(res, 200, { demo_auth: false, entra_configured: false })
    if (route === '/auth/refresh') return send(res, 401, { detail: 'Invalid refresh token' })
    if (route === '/auth/logout') return send(res, 204)
    if (!user) return send(res, 401, { detail: 'Not authenticated' })
    if (state.force[key]) return send(res, state.force[key], { detail: 'Forced failure' })
    const hr = user.roles.includes('HRAdmin')

    if (route === '/auth/me') return send(res, 200, user)
    if (route === '/notifications') return send(res, 200, { items: [], unread_count: 0 })
    if (route === '/me/profile')
      return send(res, 200, {
        employee: { employee_id: user.employee_id, name: user.name, job_title: user.job_title, department: user.department, email: user.email, manager: null, avatar_initials: user.avatar_initials },
        manager: null,
        direct_reports: [],
        birthday: null,
        roles: user.roles,
        auth_source: state.authSource,
        member_since: '2023-05-02',
      })

    // -------------------------------------------------------------------------------- preferences
    if (route === '/preferences/me' && method === 'GET') return send(res, 200, prefItems(user.user_id))
    if (route === '/preferences/me' && method === 'PUT') {
      const g = body?.groups
      const keys = Object.keys(body ?? {})
      const valid = keys.length === 1 && keys[0] === 'groups' && g && typeof g === 'object' && !Array.isArray(g) && Object.keys(g).length > 0 && Object.entries(g).every(([k, v]) => GROUPS.some(([x]) => x === k) && typeof v === 'boolean')
      if (!valid) return send(res, 422, { detail: 'Invalid request', errors: [] })
      state.prefs[user.user_id] = { ...(state.prefs[user.user_id] ?? {}), ...g }
      state.prefsUpdatedAt[user.user_id] = new Date().toISOString()
      return send(res, 200, prefItems(user.user_id))
    }

    // -------------------------------------------------------------------------------- work schedule (HR only)
    if (route === '/settings/work-schedule') {
      if (!hr) return send(res, 403, FORBIDDEN)
      if (method === 'GET') return send(res, 200, { ...state.schedule, timezone: 'Asia/Manila', is_default: !state.scheduleSaved })
      if (method === 'PUT') {
        const b = body ?? {}
        if (!/^\d{2}:\d{2}$/.test(b.login_time ?? '') || !/^\d{2}:\d{2}$/.test(b.logout_time ?? '')) return send(res, 422, { detail: 'Enter the times as HH:MM, for example 09:00.' })
        if (b.login_time >= b.logout_time) return send(res, 422, { detail: 'The log out time must be after the log in time.' })
        if (!Array.isArray(b.days) || b.days.length === 0) return send(res, 422, { detail: 'Choose at least one working day.' })
        state.schedule = { enabled: !!b.enabled, login_time: b.login_time, logout_time: b.logout_time, days: [...b.days].sort(), lead_minutes: b.lead_minutes }
        state.scheduleSaved = true
        return send(res, 200, { ...state.schedule, timezone: 'Asia/Manila', is_default: false })
      }
    }

    // -------------------------------------------------------------------------------- HR settings (403 before validation)
    if (route === '/settings' || route === '/settings/overview' || route === '/settings/users') {
      if (!hr) return send(res, 403, FORBIDDEN)
      if (route === '/settings' && method === 'GET') return send(res, 200, settingsView())
      if (route === '/settings' && method === 'PUT') {
        const keys = Object.keys(body ?? {})
        const ok = keys.length > 0 && keys.every((k) => k === 'hr_can_see_mood' && typeof body[k] === 'boolean')
        if (!ok) return send(res, 422, { detail: 'Invalid request', errors: [] })
        for (const k of keys) {
          if (state.settings[k] !== body[k]) {
            state.settings[k] = body[k]
            state.updated[k] = { updated_at: new Date().toISOString(), updated_by: user.user_id }
          }
        }
        return send(res, 200, settingsView())
      }
      if (route === '/settings/overview') return send(res, 200, { ...state.overview, hr_can_see_mood: state.settings.hr_can_see_mood })
      if (route === '/settings/users' && method === 'GET') {
        const q = (url.searchParams.get('q') ?? '').trim().toLowerCase()
        const page = Math.max(1, Number(url.searchParams.get('page') ?? 1))
        const size = Math.min(50, Math.max(1, Number(url.searchParams.get('page_size') ?? 20)))
        if ((url.searchParams.get('q') ?? '').length > 64) return send(res, 422, { detail: 'Invalid request', errors: [] })
        const rows = state.users
          .filter((u) => !q || [u.name, u.email, u.department, u.job_title].some((f) => (f ?? '').toLowerCase().includes(q)))
          .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || a.user_id.localeCompare(b.user_id))
        return send(res, 200, { items: rows.slice((page - 1) * size, page * size), total: rows.length, page, page_size: size, roles_editable: false })
      }
      return send(res, 405, { detail: 'Method not allowed' })
    }

    // -------------------------------------------------------------------------------- dashboard (always live) + the clock card
    if (handleClock({ route, method, user, send: (st, b) => (send(res, st, b), true) })) return
    if (route === '/hr/dashboard' && method === 'GET') {
      if (!hr) return send(res, 403, FORBIDDEN)
      return send(res, 200, state.liveVariant())
    }
    return send(res, 404, { detail: 'Not found' })
  })

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return {
    state,
    port,
    origin: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}
