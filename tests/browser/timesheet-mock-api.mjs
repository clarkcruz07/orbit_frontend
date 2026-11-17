// Self-contained MOCK of the Bluedge People API for the Attendance & Timesheet UI-state specs (docs/api/timesheet.md).
// It serves the built app (dist/, or TS_DIST_DIR) and the few routes the page needs: auth, notifications, and the whole
// attendance/timesheet contract with small in-memory logic. Tests script it through `mock.state` (data, forced errors,
// delays). All people and data are fictional. Nothing here is the real backend: the real behaviour is covered by e2e-timesheet.spec.mjs.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { distDir as defaultDist } from './browser-env.mjs'
import { PAY_NORMAL, paydayFor } from './mock-payday.mjs'

export const PASSWORD = 'demo-pass-fictional'
const DIST = process.env.TS_DIST_DIR ? path.resolve(process.env.TS_DIST_DIR) : defaultDist
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.json': 'application/json', '.ico': 'image/x-icon' }

const person = (u) => ({ user_id: u.user_id, email: u.email, name: u.name, roles: u.roles, employee_id: u.employee_id, job_title: u.job_title, department: u.department, avatar_initials: u.avatar_initials, demo: true })
export const USERS = [
  { user_id: 'u-anna', email: 'anna.reyes@example.test', name: 'Anna Reyes', roles: ['HRAdmin'], employee_id: 'EMP-0001', job_title: 'HR Administrator', department: 'People', avatar_initials: 'AR', manager: null },
  { user_id: 'u-miguel', email: 'miguel.santos@example.test', name: 'Miguel Santos', roles: ['Manager'], employee_id: 'EMP-0002', job_title: 'Operations Manager', department: 'Operations', avatar_initials: 'MS', manager: null },
  { user_id: 'u-paolo', email: 'paolo.cruz@example.test', name: 'Paolo Cruz', roles: ['Finance'], employee_id: 'EMP-0004', job_title: 'Finance Officer', department: 'Finance', avatar_initials: 'PC', manager: 'EMP-0002' },
  { user_id: 'u-jamie', email: 'jamie.delacruz@example.test', name: 'Jamie Dela Cruz', roles: ['Employee'], employee_id: 'EMP-0005', job_title: 'Operations Coordinator', department: 'Operations', avatar_initials: 'JD', manager: 'EMP-0002' },
  { user_id: 'u-lia', email: 'lia.ramos@example.test', name: 'Lia Ramos', roles: ['Employee'], employee_id: 'EMP-0008', job_title: 'Trainer', department: 'Learning', avatar_initials: 'LR', manager: 'EMP-0003' },
]
export const EMAIL = Object.fromEntries(USERS.map((u) => [u.user_id.slice(2), u.email]))

export const CODES = () => [
  { code_id: 'TC-ADMIN', name: 'Admin', billable: false, active: true, version: 1, placeholder: true },
  { code_id: 'TC-GENERAL', name: 'General', billable: false, active: true, version: 1, placeholder: true },
  { code_id: 'TC-PROJECT', name: 'Project work', billable: true, active: true, version: 1, placeholder: true },
  { code_id: 'TC-TRAINING', name: 'Training', billable: false, active: true, version: 1, placeholder: true },
]

// ------------------------------------------------------------------------------------------------ time helpers (company zone = UTC+8)
const MANILA_MS = 8 * 3600_000
const manilaDate = (iso) => new Date(Date.parse(iso) + MANILA_MS).toISOString().slice(0, 10)
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
const mondayOf = (iso) => addDays(iso, -((new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7))
const weekDays = (m) => Array.from({ length: 7 }, (_, i) => addDays(m, i))
const hhmm = (iso) => new Date(Date.parse(iso) + MANILA_MS).toISOString().slice(11, 16)
const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function createState() {
  return {
    now: '2026-11-16T02:00:00.000+00:00', // Mon 16 Nov 2026, 10:00 in Manila
    timezone: 'Asia/Manila',
    payCalendar: PAY_NORMAL, // swap for PAY_DEFERRED / PAY_LAST_DAY (or null) in a test
    noteText: 'Placeholder rules - set by HR. Attendance and timesheets have no payroll, pay or billing effect.',
    codes: CODES(),
    sessions: [], // {session_id, user_id, day, clock_in, clock_out, status, correction_id}
    attendance: {}, // user_id -> { 'YYYY-MM-DD': partial DayRecord (merged over the generated one) }
    corrections: [],
    sheets: {}, // `${emp}_${monday}` -> {status, rows:[{code_id,hours}], version, submitted_at, decisions:[]}
    teamDay: {}, // 'YYYY-MM-DD' -> rows
    seq: 1,
    force: {}, // 'GET /attendance/status' -> {status, body, once?}
    delay: {}, // 'GET /attendance/status' -> ms
    log: [],
    apiDown: false,
  }
}

export async function startTimesheetMock() {
  const state = createState()
  const byId = (id) => USERS.find((u) => u.user_id === id)
  const byEmp = (id) => USERS.find((u) => u.employee_id === id)
  const card = (u) => ({ employee_id: u.employee_id, name: u.name })
  const today = () => manilaDate(state.now)
  const nextId = (p) => `${p}-${String(state.seq++).padStart(4, '0')}`
  const managerUser = (u) => (u.manager ? byEmp(u.manager) : null)
  const approverFor = (owner) => {
    const m = managerUser(owner)
    return m && m.roles.includes('Manager') ? { kind: 'manager', employee_id: m.employee_id, name: m.name } : { kind: 'hr_fallback', employee_id: null, name: null }
  }
  const isHr = (u) => u.roles.includes('HRAdmin')
  const isMgr = (u) => u.roles.includes('Manager')
  const reportsOf = (u) => USERS.filter((x) => x.manager === u.employee_id)
  const canDecideFor = (viewer, owner) => owner.employee_id !== viewer.employee_id && (approverFor(owner).kind === 'manager' ? approverFor(owner).employee_id === viewer.employee_id && isMgr(viewer) : isHr(viewer))
  const canSee = (viewer, owner) => owner.employee_id === viewer.employee_id || isHr(viewer) || (isMgr(viewer) && owner.manager === viewer.employee_id)

  // ---- attendance helpers
  const openSessionOf = (u) => state.sessions.find((s) => s.user_id === u.user_id && s.status === 'open') ?? null
  const sessionView = (s) => {
    const over = s.status === 'open' && Date.parse(state.now) - Date.parse(s.clock_in) > 16 * 3600_000
    const status = over ? 'needs_correction' : s.status
    return {
      session_id: s.session_id,
      day: s.day,
      clock_in: s.clock_in,
      clock_out: s.clock_out ?? null,
      status,
      needs_correction: over,
      hours: s.clock_out ? r2((Date.parse(s.clock_out) - Date.parse(s.clock_in)) / 3600_000) : null,
      elapsed_hours: s.status === 'open' ? r2((Date.parse(state.now) - Date.parse(s.clock_in)) / 3600_000) : null,
      correction_id: s.correction_id ?? null,
    }
  }
  const dayRecord = (u, date, viewerIsOwner) => {
    const sessions = state.sessions.filter((s) => s.user_id === u.user_id && s.day === date).map(sessionView)
    const closed = sessions.filter((s) => s.clock_out)
    const worked = r2(closed.reduce((a, s) => a + (s.hours ?? 0), 0))
    const open = sessions.some((s) => s.status === 'open' || s.status === 'needs_correction')
    const flagged = sessions.some((s) => s.needs_correction)
    const pending = state.corrections.find((c) => c.employee.employee_id === u.employee_id && c.day === date && c.status === 'pending')
    const base = {
      date,
      weekday: WD[new Date(`${date}T00:00:00Z`).getUTCDay()],
      is_today: date === today(),
      sessions,
      worked_hours: worked,
      open,
      needs_correction: flagged,
      correction: null,
      pending_correction: pending ? { correction_id: pending.correction_id, status: 'pending', clock_in: pending.clock_in, clock_out: pending.clock_out, hours: pending.hours, decided_at: null } : null,
      effective: sessions.length ? { source: 'punches', first_in: sessions[0].clock_in, last_out: closed.length ? closed[closed.length - 1].clock_out : null, hours: worked } : null,
      can_request_correction: viewerIsOwner && date < today() && !pending && date >= addDays(today(), -60),
    }
    return { ...base, ...(state.attendance[u.user_id]?.[date] ?? {}) }
  }

  // ---- sheet helpers
  const sheetKey = (emp, monday) => `${emp}_${monday}`
  const sheetView = (viewer, owner, monday, { me = false } = {}) => {
    const key = sheetKey(owner.employee_id, monday)
    const stored = state.sheets[key]
    const days = weekDays(monday)
    const rows = (stored?.rows ?? []).map((r) => {
      const c = state.codes.find((x) => x.code_id === r.code_id) ?? { name: r.code_id, billable: false, active: false }
      const hours = Object.fromEntries(days.map((d) => [d, r.hours[d] ?? 0]))
      return { code_id: r.code_id, code_name: c.name, billable: c.billable, code_active: c.active, hours, total: r2(Object.values(hours).reduce((a, b) => a + b, 0)) }
    })
    const dayTotals = Object.fromEntries(days.map((d) => [d, r2(rows.reduce((a, r) => a + r.hours[d], 0))]))
    const status = stored?.status ?? 'open'
    const own = owner.employee_id === viewer.employee_id
    const allowed = []
    if (own && (status === 'open' || status === 'rejected')) allowed.push('edit', 'submit')
    if (own && status === 'submitted') allowed.push('recall')
    if (!own && status === 'submitted' && canDecideFor(viewer, owner)) allowed.push('approve', 'reject')
    const decisions = stored?.decisions ?? []
    const out = {
      sheet_id: key,
      employee: card(owner),
      week_start: monday,
      week_end: addDays(monday, 6),
      days,
      status,
      rows,
      day_totals: dayTotals,
      total_hours: r2(Object.values(dayTotals).reduce((a, b) => a + b, 0)),
      version: stored?.version ?? 0,
      persisted: Boolean(stored),
      submitted_at: stored?.submitted_at ?? null,
      decided_at: decisions.length && ['approved', 'rejected'].includes(status) ? decisions[decisions.length - 1].at : null,
      decision: ['approved', 'rejected'].includes(status) && decisions.length ? decisions[decisions.length - 1] : null,
      decisions,
      approver: approverFor(owner),
      is_future_week: monday > mondayOf(today()),
      is_current_week: monday === mondayOf(today()),
      allowed_actions: allowed,
      timezone: state.timezone,
      limits: { max_hours_per_day: 24, step: 0.25, max_rows: 20 },
    }
    if (me) Object.assign(out, { prev_week: addDays(monday, -7), next_week: addDays(monday, 7) })
    return out
  }
  const summary = (viewer, owner, monday) => {
    const v = sheetView(viewer, owner, monday)
    return { sheet_id: v.sheet_id, employee: v.employee, week_start: v.week_start, week_end: v.week_end, status: v.status, total_hours: v.total_hours, submitted_at: v.submitted_at, decided_at: v.decided_at, version: v.version }
  }
  const correctionView = (viewer, c) => {
    const owner = byEmp(c.employee.employee_id)
    const own = owner.employee_id === viewer.employee_id
    const allowed = []
    if (own && c.status === 'pending') allowed.push('cancel')
    if (!own && c.status === 'pending' && canDecideFor(viewer, owner)) allowed.push('approve', 'reject')
    return { ...c, approver: approverFor(owner), allowed_actions: allowed }
  }

  const send = (res, status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    res.end(status === 204 ? undefined : JSON.stringify(body ?? {}))
  }
  const err = (res, status, detail, code) => send(res, status, code ? { detail, code } : { detail })
  const readBody = (req) =>
    new Promise((resolve) => {
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
  const page = (items, q) => {
    const p = Math.max(1, Number(q.get('page')) || 1)
    const size = Math.min(50, Math.max(1, Number(q.get('page_size')) || 20))
    return { items: items.slice((p - 1) * size, p * size), total: items.length, page: p, page_size: size }
  }

  async function api(req, res, route, q) {
    const method = req.method
    const key = `${method} ${route.replace(/\/[^/]*(?:EMP-\d+|[0-9a-f-]{8,}|c-\d+|ts-\d+)[^/]*/g, '/:id')}`
    state.log.push(`${method} ${route}${q.toString() ? `?${q}` : ''}`)
    const body = method === 'POST' || method === 'PATCH' ? await readBody(req) : {}
    if (state.apiDown) return req.socket.destroy()

    // ---- auth
    if (route === '/auth/config') return send(res, 200, { demo_auth: true, entra_configured: false })
    if (route === '/auth/demo-users') return send(res, 200, USERS.map((u) => ({ name: u.name, email: u.email, roles: u.roles, job_title: u.job_title })))
    if (route === '/auth/login' && method === 'POST') {
      const u = USERS.find((x) => x.email === String(body.email || '').toLowerCase())
      if (!u || body.password !== PASSWORD) return err(res, 401, 'Invalid email or password')
      return send(res, 200, { access_token: `acc-${u.user_id}`, refresh_token: `ref-${u.user_id}`, token_type: 'bearer', user: person(u) })
    }
    if (route === '/auth/refresh') return send(res, 200, { access_token: `acc-${String(body.refresh_token || '').slice(4)}` })
    if (route === '/auth/logout') return send(res, 204)
    const token = (req.headers.authorization || '').replace(/^Bearer acc-/, '')
    const user = byId(token)
    if (!user) return err(res, 401, 'Not authenticated')
    if (route === '/auth/me') return send(res, 200, person(user))
    if (route === '/notifications') return send(res, 200, { items: [], unread_count: 0 })
    if (route === '/search') return send(res, 200, { q: '', people: [], requests: [], limit: 8 })

    const delay = state.delay[key]
    if (delay) await new Promise((r) => setTimeout(r, delay))
    const forced = state.force[key]
    if (forced) {
      if (forced.once) delete state.force[key]
      return send(res, forced.status, forced.body ?? { detail: 'Forced error' })
    }

    let m
    // ---- meta + codes
    if (route === '/timesheet/config') {
      const t = today()
      return send(res, 200, { timezone: state.timezone, now: state.now, today: t, current_week_start: mondayOf(t), max_session_hours: 16, max_hours_per_day: 24, hour_step: 0.25, max_rows: 20, correction_window_days: 60, notice: state.noteText, ...(state.payCalendar ? { pay_calendar: state.payCalendar } : {}) })
    }
    if (route === '/timesheet/codes' && method === 'GET') {
      const inc = q.get('include_inactive') === 'true'
      if (inc && !isHr(user)) return err(res, 403, 'Not allowed')
      const items = state.codes.filter((c) => inc || c.active).sort((a, b) => a.name.localeCompare(b.name))
      return send(res, 200, { items, total: items.length, notice: 'Placeholder codes - set by HR.', can_manage: isHr(user) })
    }
    if (route === '/timesheet/codes' && method === 'POST') {
      if (!isHr(user)) return err(res, 403, 'Not allowed')
      const name = String(body.name || '').replace(/\s+/g, ' ').trim()
      if (!name) return send(res, 422, { detail: 'Invalid request', errors: [{ loc: ['body', 'name'], msg: 'too short' }] })
      if (state.codes.some((c) => c.name.toLowerCase() === name.toLowerCase())) return err(res, 409, 'A code with this name exists', 'code_name_taken')
      const c = { code_id: `TC-${name.toUpperCase().replace(/[^A-Z0-9]+/g, '-')}`, name, billable: Boolean(body.billable), active: body.active !== false, version: 1, placeholder: true }
      state.codes.push(c)
      return send(res, 201, c)
    }
    if ((m = route.match(/^\/timesheet\/codes\/([^/]+)$/)) && method === 'PATCH') {
      if (!isHr(user)) return err(res, 403, 'Not allowed')
      const c = state.codes.find((x) => x.code_id === decodeURIComponent(m[1]))
      if (!c) return err(res, 404, 'Code not found')
      if (body.version !== undefined && body.version !== c.version) return err(res, 409, 'Stale version')
      if (body.name !== undefined && state.codes.some((x) => x !== c && x.name.toLowerCase() === String(body.name).toLowerCase())) return err(res, 409, 'A code with this name exists', 'code_name_taken')
      for (const k of ['name', 'billable', 'active']) if (body[k] !== undefined) c[k] = body[k]
      c.version += 1
      return send(res, 200, c)
    }

    // ---- attendance
    if (route === '/attendance/status') {
      const open = openSessionOf(user)
      const view = open ? sessionView(open) : null
      const flagged = Boolean(view?.needs_correction)
      return send(res, 200, { now: state.now, today: today(), timezone: state.timezone, open_session: view, needs_correction: flagged, max_session_hours: 16, allowed_actions: flagged ? ['request_correction'] : open ? ['clock_out'] : ['clock_in'] })
    }
    if (route === '/attendance/clock-in' && method === 'POST') {
      const open = openSessionOf(user)
      if (open) return err(res, 409, 'Already clocked in', sessionView(open).needs_correction ? 'needs_correction' : 'already_clocked_in')
      const s = { session_id: nextId('sess'), user_id: user.user_id, day: today(), clock_in: state.now, clock_out: null, status: 'open', correction_id: null }
      state.sessions.push(s)
      return send(res, 201, sessionView(s))
    }
    if (route === '/attendance/clock-out' && method === 'POST') {
      const open = openSessionOf(user)
      if (!open) return err(res, 409, 'Not clocked in', 'not_clocked_in')
      if (sessionView(open).needs_correction) return err(res, 409, 'Needs correction', 'needs_correction')
      open.clock_out = state.now
      open.status = 'closed'
      return send(res, 200, sessionView(open))
    }
    if (route === '/attendance/me' || (m = route.match(/^\/attendance\/employees\/([^/]+)$/))) {
      const owner = m ? byEmp(decodeURIComponent(m[1])) : user
      if (!owner || !canSee(user, owner)) return err(res, 404, 'Not found')
      const month = q.get('month') || today().slice(0, 7)
      if (!/^\d{4}-\d{2}$/.test(month) || month > today().slice(0, 7)) return send(res, 422, { detail: 'Invalid month' })
      const [y, mo] = month.split('-').map(Number)
      const count = new Date(Date.UTC(y, mo, 0)).getUTCDate()
      const days = Array.from({ length: count }, (_, i) => dayRecord(owner, `${month}-${String(i + 1).padStart(2, '0')}`, owner.user_id === user.user_id))
      const worked = days.filter((d) => d.effective && d.effective.hours > 0)
      return send(res, 200, { employee: card(owner), month, timezone: state.timezone, today: today(), days, totals: { hours: r2(worked.reduce((a, d) => a + d.effective.hours, 0)), days_worked: worked.length, needs_correction_days: days.filter((d) => d.needs_correction).length } })
    }
    if (route === '/attendance/team') {
      if (!isMgr(user)) return err(res, 403, 'Not allowed')
      const date = q.get('date') || today()
      if (date > today()) return send(res, 422, { detail: 'Future date' })
      const items = state.teamDay[date] ?? reportsOf(user).map((u) => ({ employee_id: u.employee_id, name: u.name, job_title: u.job_title, state: 'none', first_in: null, last_out: null, hours: 0 }))
      return send(res, 200, { date, timezone: state.timezone, ...page(items, q) })
    }

    // ---- corrections
    if (route === '/attendance/corrections' && method === 'GET') {
      const scope = q.get('scope') || 'mine'
      const status = q.get('status')
      let items
      if (scope === 'mine') items = state.corrections.filter((c) => c.employee.employee_id === user.employee_id)
      else if (scope === 'review') {
        if (!isMgr(user) && !isHr(user)) return err(res, 403, 'Not allowed')
        items = state.corrections.filter((c) => c.status === 'pending' && canDecideFor(user, byEmp(c.employee.employee_id)))
      } else return err(res, 403, 'Not allowed')
      if (status) items = items.filter((c) => c.status === status)
      items = [...items].sort((a, b) => (a.submitted_at < b.submitted_at ? 1 : -1))
      return send(res, 200, { ...page(items.map((c) => correctionView(user, c)), q) })
    }
    if (route === '/attendance/corrections' && method === 'POST') {
      const own = user
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.day))) return send(res, 422, { detail: 'Invalid request', errors: [{ loc: ['body', 'day'], msg: 'bad' }] })
      if (body.day >= today()) return err(res, 422, 'Pick a past day', 'day_not_past')
      if (body.day < addDays(today(), -60)) return err(res, 422, 'Too old', 'day_too_old')
      const a = Number(body.clock_in.slice(0, 2)) * 60 + Number(body.clock_in.slice(3))
      const b = Number(body.clock_out.slice(0, 2)) * 60 + Number(body.clock_out.slice(3)) + (body.clock_out_next_day ? 1440 : 0)
      if (b <= a) return err(res, 422, 'Out before in', 'out_before_in')
      if (!String(body.reason || '').trim()) return send(res, 422, { detail: 'Invalid request', errors: [{ loc: ['body', 'reason'], msg: 'empty' }] })
      if (state.corrections.some((c) => c.employee.employee_id === own.employee_id && c.day === body.day && c.status === 'pending')) return err(res, 409, 'One pending per day', 'correction_pending')
      const c = {
        correction_id: nextId('c'),
        employee: card(own),
        day: body.day,
        clock_in: `${body.day}T${body.clock_in}:00.000+08:00`,
        clock_out: `${addDays(body.day, body.clock_out_next_day ? 1 : 0)}T${body.clock_out}:00.000+08:00`,
        local_clock_in: body.clock_in,
        local_clock_out: body.clock_out,
        clock_out_next_day: Boolean(body.clock_out_next_day),
        hours: r2((b - a) / 60),
        timezone: state.timezone,
        session_id: body.session_id ?? null,
        reason: String(body.reason).trim(),
        status: 'pending',
        submitted_at: state.now,
        decided_at: null,
        decision: null,
        version: 1,
        payday: state.payCalendar ? paydayFor(state.payCalendar, state.now.slice(0, 10)) : null,
      }
      state.corrections.push(c)
      return send(res, 201, correctionView(user, c))
    }
    if ((m = route.match(/^\/attendance\/corrections\/([^/]+)(\/decision|\/cancel)?$/))) {
      const c = state.corrections.find((x) => x.correction_id === decodeURIComponent(m[1]))
      if (!c || !canSee(user, byEmp(c.employee.employee_id))) return err(res, 404, 'Not found')
      if (!m[2] && method === 'GET') return send(res, 200, correctionView(user, c))
      if (m[2] === '/cancel' && method === 'POST') {
        if (c.employee.employee_id !== user.employee_id) return err(res, 403, 'Not allowed')
        if (c.status !== 'pending') return err(res, 409, 'Already decided', 'not_editable')
        c.status = 'cancelled'
        c.version += 1
        return send(res, 200, correctionView(user, c))
      }
      if (m[2] === '/decision' && method === 'POST') {
        if (!canDecideFor(user, byEmp(c.employee.employee_id))) return err(res, 403, 'Not allowed')
        if (c.status !== 'pending') return err(res, 409, 'Already decided')
        if (body.version !== undefined && body.version !== c.version) return err(res, 409, 'Stale version')
        if (body.action === 'reject' && !String(body.comment || '').trim()) return err(res, 422, 'Comment required', 'comment_required')
        c.status = body.action === 'approve' ? 'approved' : 'rejected'
        c.decided_at = state.now
        c.version += 1
        c.decision = { action: body.action, by: { name: user.name }, at: state.now, comment: body.comment ?? null, approver_kind: 'manager' }
        return send(res, 200, correctionView(user, c))
      }
    }

    // ---- sheets
    if (route === '/timesheet/me' && method === 'GET') {
      const w = q.get('week') || today()
      if (!/^\d{4}-\d{2}-\d{2}$/.test(w)) return send(res, 422, { detail: 'Invalid week' })
      const monday = mondayOf(w)
      const diff = Math.round((Date.parse(monday) - Date.parse(mondayOf(today()))) / (7 * 86_400_000))
      if (diff < -53 || diff > 4) return err(res, 422, 'Out of range', 'week_out_of_range')
      return send(res, 200, sheetView(user, user, monday, { me: true }))
    }
    if ((m = route.match(/^\/timesheet\/sheets\/(EMP-\d+)_(\d{4}-\d{2}-\d{2})(\/submit|\/recall|\/decision)?$/))) {
      const owner = byEmp(m[1])
      const monday = m[2]
      if (!owner || mondayOf(monday) !== monday || !canSee(user, owner)) return err(res, 404, 'Timesheet not found')
      const k = sheetKey(owner.employee_id, monday)
      const own = owner.employee_id === user.employee_id
      if (!m[3] && method === 'GET') return send(res, 200, sheetView(user, owner, monday))
      const stored = state.sheets[k]
      if (!m[3] && method === 'PATCH') {
        if (!own) return err(res, 403, 'Only the owner can change it')
        const st = stored?.status ?? 'open'
        if (st === 'submitted' || st === 'approved') return err(res, 409, 'No longer editable', 'not_editable')
        if (body.version !== undefined && body.version !== (stored?.version ?? 0)) return err(res, 409, 'Changed by someone else')
        const days = new Set(weekDays(monday))
        const totals = {}
        for (const r of body.rows ?? []) {
          for (const [d, v] of Object.entries(r.hours ?? {})) {
            if (!days.has(d)) return err(res, 422, 'Outside week', 'day_outside_week')
            if (typeof v !== 'number') return err(res, 422, 'Not a number', 'hours_invalid')
            if (v < 0 || v > 24) return err(res, 422, 'Range', 'hours_range')
            if (Math.abs(v * 4 - Math.round(v * 4)) > 1e-9) return err(res, 422, 'Step', 'hours_step')
            totals[d] = (totals[d] ?? 0) + v
          }
          const code = state.codes.find((c) => c.code_id === r.code_id)
          if (!code || (!code.active && !stored?.rows.some((x) => x.code_id === r.code_id))) return err(res, 422, 'Unknown or inactive code', 'code_invalid')
        }
        if (Object.values(totals).some((t) => t > 24)) return err(res, 422, 'Day total', 'day_total_exceeded')
        state.sheets[k] = { ...(stored ?? { status: 'open', decisions: [], submitted_at: null }), rows: (body.rows ?? []).map((r) => ({ code_id: r.code_id, hours: Object.fromEntries(Object.entries(r.hours ?? {}).filter(([, v]) => v > 0)) })), version: (stored?.version ?? 0) + 1 }
        return send(res, 200, sheetView(user, owner, monday))
      }
      if (m[3] === '/submit' && method === 'POST') {
        if (!own) return err(res, 403, 'Only the owner can submit')
        if (!stored || (stored.status !== 'open' && stored.status !== 'rejected')) return err(res, 409, 'No longer editable', 'not_editable')
        if (body.version !== undefined && body.version !== stored.version) return err(res, 409, 'Changed by someone else')
        if (monday > mondayOf(today())) return err(res, 422, 'Future week', 'week_in_future')
        if (!stored.rows.some((r) => Object.keys(r.hours).length)) return err(res, 422, 'Empty', 'empty_timesheet')
        stored.status = 'submitted'
        stored.submitted_at = state.now
        stored.version += 1
        return send(res, 200, sheetView(user, owner, monday))
      }
      if (m[3] === '/recall' && method === 'POST') {
        if (!own) return err(res, 403, 'Only the owner can recall')
        if (!stored || stored.status !== 'submitted') return err(res, 409, 'Not recallable', 'not_recallable')
        stored.status = 'open'
        stored.version += 1
        return send(res, 200, sheetView(user, owner, monday))
      }
      if (m[3] === '/decision' && method === 'POST') {
        if (!canDecideFor(user, owner)) return err(res, 403, 'Not allowed')
        if (!stored || stored.status !== 'submitted') return err(res, 409, 'Not submitted', 'not_submitted')
        if (body.version !== undefined && body.version !== stored.version) return err(res, 409, 'Changed by someone else')
        if (body.action === 'reject' && !String(body.comment || '').trim()) return err(res, 422, 'Comment required', 'comment_required')
        stored.status = body.action === 'approve' ? 'approved' : 'rejected'
        stored.version += 1
        stored.decisions.push({ decision_id: nextId('d'), action: body.action, by: { name: user.name }, at: state.now, comment: body.comment ?? null, approver_kind: 'manager', submission_no: stored.decisions.length + 1 })
        return send(res, 200, sheetView(user, owner, monday))
      }
    }

    // ---- views
    if (route === '/timesheet/review') {
      if (!isMgr(user) && !isHr(user)) return err(res, 403, 'Not allowed')
      const kind = q.get('kind') || 'all'
      const items = []
      for (const [k, s] of Object.entries(state.sheets)) {
        if (s.status !== 'submitted') continue
        const [emp, week] = k.split('_')
        const owner = byEmp(emp)
        if (!canDecideFor(user, owner)) continue
        items.push({ type: 'timesheet', id: k, submitted_at: s.submitted_at, allowed_actions: ['approve', 'reject'], approver: approverFor(owner), sheet: summary(user, owner, week), correction: null })
      }
      for (const c of state.corrections) {
        if (c.status !== 'pending' || !canDecideFor(user, byEmp(c.employee.employee_id))) continue
        items.push({ type: 'correction', id: c.correction_id, submitted_at: c.submitted_at, allowed_actions: ['approve', 'reject'], approver: approverFor(byEmp(c.employee.employee_id)), sheet: null, correction: { correction_id: c.correction_id, employee: c.employee, day: c.day, local_clock_in: c.local_clock_in, local_clock_out: c.local_clock_out, clock_out_next_day: c.clock_out_next_day, hours: c.hours, status: c.status, version: c.version, payday: c.payday ?? null } })
      }
      items.sort((a, b) => (a.submitted_at < b.submitted_at ? -1 : 1))
      const counts = { sheets: items.filter((i) => i.type === 'timesheet').length, corrections: items.filter((i) => i.type === 'correction').length }
      const shown = kind === 'sheets' ? items.filter((i) => i.type === 'timesheet') : kind === 'corrections' ? items.filter((i) => i.type === 'correction') : items
      return send(res, 200, { ...page(shown, q), counts })
    }
    if (route === '/timesheet/team') {
      if (!isMgr(user)) return err(res, 403, 'Not allowed')
      const monday = mondayOf(q.get('week') || today())
      const items = reportsOf(user)
        .map((u) => {
          const v = sheetView(user, u, monday)
          return { employee_id: u.employee_id, name: u.name, job_title: u.job_title, sheet_id: v.sheet_id, status: v.status, total_hours: v.total_hours, submitted_at: v.submitted_at, persisted: v.persisted }
        })
        .sort((a, b) => a.name.localeCompare(b.name))
      return send(res, 200, { week_start: monday, week_end: addDays(monday, 6), ...page(items, q), total_hours: r2(items.reduce((a, i) => a + i.total_hours, 0)) })
    }
    if (route === '/timesheet/overview') {
      if (!isHr(user)) return err(res, 403, 'Not allowed')
      const monday = mondayOf(q.get('week') || today())
      const counts = { open: 0, submitted: 0, approved: 0, rejected: 0 }
      for (const [k, s] of Object.entries(state.sheets)) if (k.endsWith(`_${monday}`)) counts[s.status] += 1
      const saved = Object.values(counts).reduce((a, b) => a + b, 0)
      return send(res, 200, { week_start: monday, week_end: addDays(monday, 6), active_employees: USERS.length, counts, no_sheet: USERS.length - saved, pending_corrections: state.corrections.filter((c) => c.status === 'pending').length })
    }
    return err(res, 404, 'Not found')
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost')
    if (url.pathname.startsWith('/api/')) {
      try {
        return await api(req, res, url.pathname.slice(4), url.searchParams)
      } catch (e) {
        return send(res, 500, { detail: `mock failure: ${e?.message}` })
      }
    }
    let file = path.join(DIST, decodeURIComponent(url.pathname))
    if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html')
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' })
    fs.createReadStream(file).pipe(res)
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const { port } = server.address()

  return {
    state,
    port,
    origin: `http://127.0.0.1:${port}`,
    helpers: { sheetKey, mondayOf, addDays, weekDays, manilaDate, hhmm },
    close: () => new Promise((r) => server.close(() => r())),
  }
}

/** Rich, fictional demo data around Wed 18 Nov 2026 (used by the screenshots and the responsive sweep). */
export function seedDemoData(mock) {
  const s = mock.state
  s.now = '2026-11-18T05:23:41.000+00:00' // Wed 18 Nov 2026, 13:23 in Manila
  const closed = (user, day, inUtc, outUtc) => s.sessions.push({ session_id: `s-${s.seq++}`, user_id: user, day, clock_in: `${day}T${inUtc}:00.000+00:00`, clock_out: `${day}T${outUtc}:00.000+00:00`, status: 'closed', correction_id: null })
  const jitter = [['00:58', '09:31'], ['01:04', '09:12'], ['00:55', '09:40'], ['01:01', '09:05'], ['00:59', '09:22']]
  for (const [i, day] of ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-09', '2026-11-12', '2026-11-13', '2026-11-16', '2026-11-17'].entries()) closed('u-jamie', day, ...jitter[i % 5])
  s.sessions.push({ session_id: 's-open', user_id: 'u-jamie', day: '2026-11-18', clock_in: '2026-11-18T00:58:00.000+00:00', clock_out: null, status: 'open', correction_id: null })
  s.attendance['u-jamie'] = {
    '2026-11-11': {
      effective: { source: 'correction', first_in: '2026-11-11T01:00:00.000+00:00', last_out: '2026-11-11T09:30:00.000+00:00', hours: 8.5 },
      correction: { correction_id: 'c-1', status: 'approved', clock_in: '2026-11-11T01:00:00.000+00:00', clock_out: '2026-11-11T09:30:00.000+00:00', hours: 8.5, decided_at: '2026-11-12T03:00:00.000+00:00' },
    },
    '2026-11-10': {
      can_request_correction: false,
      pending_correction: { correction_id: 'c-2', status: 'pending', clock_in: '2026-11-10T01:00:00.000+00:00', clock_out: '2026-11-10T09:00:00.000+00:00', hours: 8, decided_at: null },
    },
  }
  const base = { clock_in: '', clock_out: '', timezone: 'Asia/Manila', session_id: null, version: 1, decided_at: null, decision: null, status: 'pending', clock_out_next_day: false }
  s.corrections.push(
    { ...base, correction_id: 'c-2', employee: { employee_id: 'EMP-0005', name: 'Jamie Dela Cruz' }, day: '2026-11-10', local_clock_in: '09:00', local_clock_out: '17:00', hours: 8, reason: 'Forgot to clock in; I was at the client site', submitted_at: '2026-11-11T01:00:00.000+00:00', payday: { date: '2026-11-27', cutoff: '2026-11-22', deferred: true, submitted_on: '2026-11-11' } },
    { ...base, correction_id: 'c-3', employee: { employee_id: 'EMP-0004', name: 'Paolo Cruz' }, day: '2026-11-13', local_clock_in: '08:30', local_clock_out: '16:45', hours: 8.25, reason: 'Power cut in the office, could not clock out', submitted_at: '2026-11-16T01:30:00.000+00:00', payday: { date: '2026-11-27', cutoff: '2026-11-22', deferred: false, submitted_on: '2026-11-16' } },
  )
  const hrs = (a) => Object.fromEntries(a.map((h, i) => [`2026-11-${16 + i}`, h]).filter(([, h]) => h > 0))
  s.sheets['EMP-0005_2026-11-16'] = {
    status: 'open',
    version: 3,
    submitted_at: null,
    decisions: [],
    rows: [
      { code_id: 'TC-GENERAL', hours: hrs([4, 3.5, 0, 0, 0, 0, 0]) },
      { code_id: 'TC-PROJECT', hours: hrs([4, 4.5, 0, 0, 0, 0, 0]) },
      { code_id: 'TC-TRAINING', hours: hrs([0, 0, 2, 0, 0, 0, 0]) },
    ],
  }
  s.sheets['EMP-0005_2026-11-09'] = {
    status: 'submitted',
    version: 2,
    submitted_at: '2026-11-13T09:40:00.000+00:00',
    decisions: [],
    rows: [
      { code_id: 'TC-GENERAL', hours: { '2026-11-09': 8, '2026-11-10': 8, '2026-11-11': 8, '2026-11-12': 7.5, '2026-11-13': 8 } },
      { code_id: 'TC-ADMIN', hours: { '2026-11-12': 0.5 } },
    ],
  }
  s.sheets['EMP-0004_2026-11-09'] = {
    status: 'submitted',
    version: 2,
    submitted_at: '2026-11-14T02:10:00.000+00:00',
    decisions: [],
    rows: [{ code_id: 'TC-ADMIN', hours: { '2026-11-09': 8, '2026-11-10': 8, '2026-11-11': 8, '2026-11-12': 8, '2026-11-13': 6 } }],
  }
}
