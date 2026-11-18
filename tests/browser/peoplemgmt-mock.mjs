// Self-contained MOCK API for the People management and Holidays specs (docs/api/peoplemgmt.md + docs/api/holidays.md). It also
// serves the built app from `distDir`. Everything is fictional. The mock plays "the server": every people route is HR only (403 for
// other accounts), the guard rails answer like the real backend, and `state.force` / `state.delay` let a test force a status or slow a route.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { emptyProfile, listProfile, mergeProfile, profileErrors, sampleProfile } from './profile-mock.mjs'

export const U = {
  anna: { user_id: 'u-anna', email: 'anna.reyes@example.test', name: 'Anna Reyes', roles: ['HRAdmin'], employee_id: 'EMP-0001', job_title: 'HR Administrator', department: 'People & Culture', avatar_initials: 'AR', demo: true },
  ben: { user_id: 'u-ben', email: 'ben.cruz@example.test', name: 'Ben Cruz', roles: ['Manager'], employee_id: 'EMP-0002', job_title: 'Operations Manager', department: 'Operations', avatar_initials: 'BC', demo: true },
  carla: { user_id: 'u-carla', email: 'carla.dizon@example.test', name: 'Carla Dizon', roles: ['Employee'], employee_id: 'EMP-0003', job_title: 'Compliance Analyst', department: 'Compliance', avatar_initials: 'CD', demo: true },
  dan: { user_id: 'u-dan', email: 'dan.ocampo@example.test', name: 'Dan Ocampo', roles: ['Finance'], employee_id: 'EMP-0004', job_title: 'Finance Officer', department: 'Finance', avatar_initials: 'DO', demo: true },
  bea: { user_id: 'u-bea', email: 'bea.lim@example.test', name: 'Bea Lim', roles: ['HRAdmin'], employee_id: 'EMP-0005', job_title: 'HR Officer', department: 'People & Culture', avatar_initials: 'BL', demo: true },
}
export const ALL_USERS = Object.values(U)
const ROLE_ORDER = ['Employee', 'Manager', 'HRAdmin', 'Finance']
const TYPES = ['full_time', 'part_time', 'contractor', 'intern']
const FIRST = ['Mara', 'Joel', 'Ines', 'Rey', 'Tess', 'Luz', 'Omar', 'Pia', 'Nico', 'Vera', 'Gil', 'Rosa', 'Ian', 'Dina', 'Ted', 'Uma', 'Wes', 'Yara']
const LAST = ['Aquino', 'Bautista', 'Castro', 'Estrada', 'Flores', 'Garcia', 'Hizon']
const DEPT = ['Operations', 'Finance', 'Compliance', 'People & Culture', 'Learning & Development', 'IT Operations']

const initials = (name) => name.split(/\s+/).filter(Boolean).map((p) => p[0]).slice(0, 2).join('').toUpperCase()

function person(over = {}) {
  const name = over.name ?? 'Test Person'
  return {
    employee: {
      employee_id: over.employee_id ?? 'EMP-X',
      name,
      email: over.email ?? `${name.toLowerCase().replace(/[^a-z0-9]+/g, '.')}@example.test`,
      job_title: over.job_title ?? 'Analyst',
      department: over.department ?? 'Operations',
      employment_type: over.employment_type ?? 'full_time',
      manager_id: over.manager_id ?? null,
      start_date: over.start_date ?? '2024-02-01',
      end_date: over.end_date ?? null,
      status: over.status ?? 'active',
      birthday: over.birthday ?? null,
      is_demo: false,
      source: over.source ?? 'hr_created',
      left_reason: over.left_reason ?? null,
      avatar_initials: initials(name),
      profile: over.profile ?? emptyProfile(),
    },
    account: {
      has_account: over.has_account ?? true,
      roles: over.roles ?? ['Employee'],
      source: over.has_account === false ? null : (over.account_source ?? 'hr_created'),
      disabled: over.disabled ?? false,
      disabled_reason: over.disabled_reason ?? null,
      user_id: over.has_account === false ? null : `u-${over.employee_id ?? 'x'}`,
    },
  }
}

/** The named accounts plus generated people so the list paginates (total = 5 + extra). */
function seedPeople(extra = 25) {
  const rows = ALL_USERS.map((u, i) =>
    person({ employee_id: u.employee_id, name: u.name, email: u.email, job_title: u.job_title, department: u.department, roles: [...ROLE_ORDER.filter((r) => r === 'Employee' || u.roles.includes(r))], account_source: i === 0 ? 'entra_bootstrap' : 'demo', manager_id: i === 0 ? null : i === 1 ? 'EMP-0001' : 'EMP-0002' }),
  )
  for (let i = 0; i < extra; i++) {
    const name = `${FIRST[i % FIRST.length]} ${LAST[i % LAST.length]}${i >= FIRST.length ? ` ${i}` : ''}`
    rows.push(
      person({
        employee_id: `EMP-${String(100 + i).padStart(4, '0')}`,
        name,
        department: DEPT[i % DEPT.length],
        employment_type: TYPES[i % TYPES.length],
        manager_id: i % 4 === 0 ? 'EMP-0002' : null,
        has_account: i % 6 !== 5,
        status: i === 7 ? 'left' : 'active',
        end_date: i === 7 ? '2026-10-31' : null,
        disabled: i === 7,
        disabled_reason: i === 7 ? 'deactivated' : null,
        roles: i % 6 === 5 ? [] : ['Employee'],
      }),
    )
  }
  const done = rows.map((p) => ({ ...p, account: { ...p.account, can_sign_in: p.account.has_account && !p.account.disabled } }))
  const mara = done.find((p) => p.employee.employee_id === 'EMP-0100')
  if (mara) mara.employee.profile = sampleProfile() // one person with a full profile for the specs
  return done
}

/** What the (mock) server fills in on its own for a year (the automatic AI sync); a date HR already has is never duplicated. */
const autofillFor = (year) => [
  { date: `${year}-01-01`, name: "New Year's Day", type: 'public' },
  { date: `${year}-04-09`, name: 'Araw ng Kagitingan', type: 'public' },
  { date: `${year}-11-01`, name: "All Saints' Day", type: 'public' },
  { date: `${year}-12-25`, name: 'Christmas Day', type: 'public' },
]

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.json': 'application/json', '.ico': 'image/x-icon' }
const FORBIDDEN = { detail: 'You do not have access to this resource' }
const LAST_ADMIN = 'The last active HR Administrator cannot be changed this way. Promote someone else to HR Administrator first.'
const FORMULA = ['=', '+', '-', '@', '\t', '\r']

export const TEMPLATE = 'name,email,job_title,department,employment_type,manager_email,start_date,birthday,roles,can_sign_in,preferred_name,gender,civil_status,nationality,birth_year,personal_email,mobile,address_line1,address_line2,city,province,postal_code,country,emergency_name,emergency_relationship,emergency_phone,employee_number,company,office_location,work_arrangement,probation_end_date,regularization_date,tin,sss,philhealth,pagibig\n'

/** Extracts the bytes of the first file part from a multipart/form-data body (enough for the specs). */
function multipartFile(buffer, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType || '')
  if (!m) return null
  const boundary = Buffer.from(`--${m[1] ?? m[2]}`)
  const start = buffer.indexOf(boundary)
  if (start < 0) return null
  const headEnd = buffer.indexOf(Buffer.from('\r\n\r\n'), start)
  const next = buffer.indexOf(boundary, headEnd)
  if (headEnd < 0 || next < 0) return null
  return buffer.subarray(headEnd + 4, next - 2)
}

const minutesAgo = (n) => new Date(Date.now() - n * 60000).toISOString()
const hoursAhead = (n) => new Date(Date.now() + n * 3600000).toISOString()
const ZERO_COUNTS = { fetched: 0, created: 0, updated: 0, deactivated: 0, reactivated: 0, skipped: 0 }

/** The Microsoft directory sync as the server reports it. `outcome` is what the next run ends with ('ok' or an error_code); a run stays 'running' for `runPolls` status reads. */
const entraDefaults = () => ({
  configured: true,
  enabled: true,
  state: 'idle',
  interval_hours: 6,
  setup_hint: null,
  last: { started_at: minutesAgo(6), finished_at: minutesAgo(5), ok: true, error_code: null, counts: { fetched: 30, created: 3, updated: 2, deactivated: 1, reactivated: 0, skipped: 0 } },
  next_run_at: hoursAhead(3),
  runPolls: 2,
  pollsLeft: 0,
  outcome: 'ok',
  runCounts: { fetched: 33, created: 1, updated: 4, deactivated: 0, reactivated: 0, skipped: 0 },
  startedAt: null,
})

export async function startPeopleMock({ distDir, extraPeople = 25 }) {
  const state = {
    entra: entraDefaults(),
    people: seedPeople(extraPeople),
    holidays: [], // {holiday_id, name, type, date|null, month|null, day|null, active}
    // The server fills a year in on its own: 'ready' (nothing to do), 'pending' (fills in after `pendingPolls` more reads), 'failed', 'off' (no AI set up).
    autosync: { mode: 'ready', pendingPolls: 0 },
    seq: 1,
    force: {},
    respondOnce: {},
    delay: {},
    log: [],
    calls: [],
    today: '2026-11-16',
  }

  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers })
    res.end(status === 204 ? undefined : JSON.stringify(body ?? {}))
  }
  const readRaw = (req) =>
    new Promise((resolve) => {
      const chunks = []
      req.on('data', (c) => chunks.push(c))
      req.on('end', () => resolve(Buffer.concat(chunks)))
    })
  const parseJson = (raw) => {
    try {
      return raw.length ? JSON.parse(raw.toString('utf8')) : {}
    } catch {
      return { __invalid: true }
    }
  }

  const find = (id) => state.people.find((p) => p.employee.employee_id === id)
  // A run that has stayed 'running' for `runPolls` reads finishes on the next read: the last-sync record is replaced and, when it worked, one person from Microsoft appears.
  const finishRun = () => {
    const e = state.entra
    const ok = e.outcome === 'ok'
    e.state = 'idle'
    e.last = { started_at: e.startedAt, finished_at: new Date().toISOString(), ok, error_code: ok ? null : e.outcome, counts: ok ? { ...e.runCounts } : { ...ZERO_COUNTS } }
    e.next_run_at = hoursAhead(e.interval_hours)
    if (ok) {
      const id = `EMP-ENTRA-${state.seq++}`
      state.people.push(person({ employee_id: id, name: 'Zoe Entrada', email: `zoe.entrada.${id.toLowerCase()}@example.test`, source: 'entra', has_account: false }))
    }
  }
  const entraView = () => {
    const e = state.entra
    if (e.state === 'running') {
      if (e.pollsLeft > 0) e.pollsLeft -= 1
      else finishRun()
    }
    return { configured: e.configured, enabled: e.enabled, state: e.state, interval_hours: e.interval_hours, last: e.last, next_run_at: e.next_run_at, setup_hint: e.setup_hint }
  }
  const byEmail = (e) => state.people.find((p) => p.employee.email === e)
  const withName = (p) => ({ ...p, employee: { ...p.employee, manager: p.employee.manager_id ? { employee_id: p.employee.manager_id, name: find(p.employee.manager_id)?.employee.name ?? p.employee.manager_id } : null } })
  const out = (p, list = false) => {
    const a = { ...p.account, can_sign_in: p.account.has_account && !p.account.disabled }
    const emp = withName(p).employee
    return { employee: list ? { ...emp, profile: listProfile(emp.profile) } : emp, account: a }
  }
  const activeAdmins = () => state.people.filter((p) => p.account.has_account && !p.account.disabled && p.account.roles.includes('HRAdmin'))
  const directReports = (id) => state.people.filter((p) => p.employee.manager_id === id && p.employee.status === 'active')
  const reportsTo = (id, boss) => {
    let cur = find(id)?.employee.manager_id ?? null
    const seen = new Set()
    while (cur && !seen.has(cur)) {
      if (cur === boss) return true
      seen.add(cur)
      cur = find(cur)?.employee.manager_id ?? null
    }
    return false
  }

  const textError = (v, required = true) => {
    if (v === undefined || v === null || (typeof v === 'string' && !v.trim())) return required ? 'is required' : null
    if (typeof v !== 'string') return 'must be text'
    if (FORMULA.some((f) => v.trimStart().startsWith(f))) return 'must not start with = + - or @'
    if (v.trim().length > 120) return 'must be at most 120 characters'
    return null
  }
  const emailError = (v) => (typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) ? null : 'must be a valid e-mail address')
  const bdayError = (v) => {
    if (v === undefined || v === null || v === '') return null
    const m = /^(\d{2})-(\d{2})$/.exec(v)
    if (!m) return 'must look like MM-DD (a real calendar day, no year)'
    const max = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][Number(m[1]) - 1]
    return Number(m[1]) >= 1 && Number(m[1]) <= 12 && Number(m[2]) >= 1 && Number(m[2]) <= max ? null : 'must look like MM-DD (a real calendar day, no year)'
  }

  function validateCreate(b) {
    const fe = {}
    for (const k of ['name', 'job_title', 'department']) {
      const e = textError(b[k])
      if (e) fe[k] = e
    }
    const ee = emailError(b.email)
    if (ee) fe.email = ee
    if (!TYPES.includes(b.employment_type)) fe.employment_type = 'must be one of ' + TYPES.join(', ')
    const be = bdayError(b.birthday)
    if (be) fe.birthday = be
    if (b.manager_id) {
      const mgr = find(b.manager_id)
      if (!mgr) fe.manager_id = 'must be an existing employee'
      else if (mgr.employee.status !== 'active') fe.manager_id = 'must be an active employee'
    }
    const roles = b.roles ?? ['Employee']
    if (!Array.isArray(roles) || roles.some((r) => !ROLE_ORDER.includes(r))) fe.roles = 'contains an unknown role'
    if (b.can_sign_in === false && Array.isArray(roles) && roles.some((r) => r !== 'Employee')) fe.roles = 'must be just Employee when the person cannot sign in'
    return fe
  }

  function createPerson(b, source = 'hr_created') {
    const roles = ROLE_ORDER.filter((r) => r === 'Employee' || (b.roles ?? []).includes(r))
    const id = `EMP-${(0x1a2b3c4d + state.seq++).toString(16).toUpperCase().padStart(8, '0')}`
    const canSign = b.can_sign_in !== false
    const p = person({ employee_id: id, name: b.name.trim().replace(/\s+/g, ' '), email: b.email.trim().toLowerCase(), job_title: b.job_title.trim(), department: b.department.trim(), employment_type: b.employment_type, manager_id: b.manager_id ?? null, start_date: b.start_date ?? null, birthday: b.birthday ?? null, has_account: canSign, roles: canSign ? roles : [], account_source: canSign ? source : null })
    if (b.profile) p.employee.profile = mergeProfile(emptyProfile(), b.profile)
    state.people.push(p)
    return p
  }

  // ------------------------------------------------------------------------------------------------ holidays
  const activeDb = () => state.holidays.some((h) => h.active)
  const occurrence = (h, year) => {
    if (h.date) return h.date.startsWith(String(year)) ? h.date : null
    let { month, day } = h
    if (month === 2 && day === 29 && !((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0)) day = 28
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }
  const holidayView = (h, year) => ({ holiday_id: h.holiday_id, name: h.name, type: h.type, date: h.date, month: h.month, day: h.day, recurring: !h.date, active: h.active, source: h.source ?? 'manual', ...(year ? { date_in_year: occurrence(h, year) } : {}) })
  const sameDay = (a, b) => (a.date || b.date ? a.date === b.date : a.month === b.month && a.day === b.day)
  const dup = (c, ignore) => state.holidays.some((h) => h.holiday_id !== ignore && h.name.toLowerCase() === c.name.toLowerCase() && sameDay(h, c))
  const holidayName = (n) => {
    if (typeof n !== 'string' || !n.trim()) return 'name is required'
    if (FORMULA.some((f) => n.trimStart().startsWith(f))) return 'name must not start with = + - or @'
    if (n.trim().length > 120) return 'name must be at most 120 characters'
    return null
  }
  const validDate = (d) => {
    if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false
    const t = new Date(`${d}T00:00:00Z`)
    return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d && Number(d.slice(0, 4)) >= 2000 && Number(d.slice(0, 4)) <= 2100
  }
  const validMD = (m, d) => Number.isInteger(m) && Number.isInteger(d) && m >= 1 && m <= 12 && d >= 1 && d <= [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]

  // ------------------------------------------------------------------------------------------------ import
  function runImport(buffer, dry) {
    if (buffer.length > 1024 * 1024) return { status: 413, body: { detail: 'The file is larger than 1 MB', code: 'file_too_large' } }
    const textRaw = buffer.toString('utf8').replace(/^﻿/, '')
    if (!textRaw.trim()) return { status: 422, body: { detail: 'The file is empty', code: 'empty_file' } }
    const lines = textRaw.split(/\r\n|\n|\r/)
    const header = lines[0].split(',').map((h) => h.trim().toLowerCase())
    const required = ['name', 'email', 'job_title', 'department', 'employment_type']
    const missing = required.filter((c) => !header.includes(c))
    if (missing.length) return { status: 422, body: { detail: 'Missing columns', code: 'missing_columns', missing_columns: missing } }
    const rowsRaw = lines.map((l, i) => ({ l, row: i + 1 })).slice(1).filter((x) => x.l.trim() !== '')
    if (!rowsRaw.length) return { status: 422, body: { detail: 'No rows', code: 'no_rows' } }
    if (rowsRaw.length > 500) return { status: 422, body: { detail: 'Too many rows', code: 'too_many_rows', max_rows: 500 } }
    const known = [...required, ...TEMPLATE.trim().split(',').slice(5)]
    const ignored = header.filter((h) => h && !known.includes(h))
    const seen = new Set()
    const rows = []
    const toCreate = []
    const emailCol = header.indexOf('email')
    const fileEmails = new Set(rowsRaw.map(({ l }) => (l.split(',')[emailCol] ?? '').trim().toLowerCase()))
    for (const { l, row } of rowsRaw) {
      const cells = l.split(',')
      const get = (c) => (header.includes(c) ? (cells[header.indexOf(c)] ?? '').trim() : '')
      if (cells.length > header.length) {
        rows.push({ row, status: 'invalid', reason: 'too_many_cells', message: 'The row has more cells than the header', employee_id: null, field_errors: {} })
        continue
      }
      const fe = {}
      for (const c of ['name', 'job_title', 'department']) {
        const e = textError(get(c))
        if (e) fe[c] = e
      }
      const email = get('email').toLowerCase()
      if (FORMULA.some((f) => get('email').startsWith(f)) || emailError(email)) fe.email = 'must be a valid e-mail address'
      if (!TYPES.includes(get('employment_type'))) fe.employment_type = 'must be one of ' + TYPES.join(', ')
      const be = bdayError(get('birthday') || null)
      if (be) fe.birthday = be
      for (const c of ['mobile', 'emergency_phone']) if (get(c) && (!/^[0-9 +\-()]+$/.test(get(c)) || get(c).length < 7 || get(c).length > 24)) fe[c] = 'must be 7 to 24 characters, digits, spaces and + - ( ) only'
      if (get('tin') && !/^[0-9-]+$/.test(get('tin'))) fe.tin = 'may only contain digits and hyphens'
      const roleCell = get('roles')
      const roles = roleCell ? roleCell.split(/[;|]/).map((r) => r.trim()).filter(Boolean) : []
      if (roles.some((r) => !ROLE_ORDER.includes(r))) fe.roles = 'contains an unknown role'
      if (Object.keys(fe).length) {
        rows.push({ row, status: 'invalid', reason: 'validation', message: 'Some values are not valid', employee_id: null, field_errors: fe })
        continue
      }
      if (seen.has(email)) {
        rows.push({ row, status: 'skipped', reason: 'duplicate_in_file', message: 'Duplicate e-mail in the file', employee_id: null, field_errors: {} })
        continue
      }
      seen.add(email)
      if (byEmail(email)) {
        rows.push({ row, status: 'skipped', reason: 'email_exists', message: 'Already in the system', employee_id: null, field_errors: {} })
        continue
      }
      const mgrEmail = get('manager_email').toLowerCase()
      if (mgrEmail && !byEmail(mgrEmail) && !fileEmails.has(mgrEmail)) {
        rows.push({ row, status: 'invalid', reason: 'manager_not_found', message: 'Manager not found', employee_id: null, field_errors: {} })
        continue
      }
      const signIn = !['false', 'no', '0'].includes(get('can_sign_in').toLowerCase())
      const entry = { row, status: 'created', reason: null, message: null, employee_id: null, field_errors: {} }
      rows.push(entry)
      toCreate.push({ entry, mgrEmail, b: { name: get('name'), email, job_title: get('job_title'), department: get('department'), employment_type: get('employment_type'), manager_id: null, start_date: get('start_date') || null, birthday: get('birthday') || null, roles: ['Employee', ...roles], can_sign_in: signIn } })
    }
    if (!dry) {
      for (const { entry, b } of toCreate) entry.employee_id = createPerson(b).employee.employee_id
      for (const { mgrEmail, b } of toCreate) if (mgrEmail) byEmail(b.email).employee.manager_id = byEmail(mgrEmail).employee.employee_id
    }
    const count = (s) => rows.filter((r) => r.status === s).length
    return { status: 200, body: { dry_run: dry, total: rows.length, created: count('created'), skipped: count('skipped'), invalid: count('invalid'), ignored_columns: ignored, rows } }
  }

  // ------------------------------------------------------------------------------------------------ server
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
    const raw = method === 'GET' ? Buffer.alloc(0) : await readRaw(req)
    const isMultipart = /multipart\/form-data/.test(req.headers['content-type'] || '')
    const body = method === 'GET' || isMultipart ? {} : parseJson(raw)
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
    // `respondOnce[key] = {status, body}`: answer exactly once with that body (to show server wording the mock does not produce itself).
    if (state.respondOnce[key]) {
      const r = state.respondOnce[key]
      delete state.respondOnce[key]
      return send(res, r.status, r.body)
    }
    const hr = user.roles.includes('HRAdmin')

    if (route === '/auth/me') return send(res, 200, user)
    if (route === '/notifications') return send(res, 200, { items: [], unread_count: 0 })

    // ---- directory (the manager type-ahead): any signed-in user; HR also sees status
    if (route === '/directory/employees' && method === 'GET') {
      const q = (url.searchParams.get('q') ?? '').trim().toLowerCase()
      const size = Math.min(50, Math.max(1, Number(url.searchParams.get('page_size') ?? 20)))
      const rows = state.people
        .filter((p) => !q || [p.employee.name, p.employee.email, p.employee.job_title, p.employee.department].some((f) => f.toLowerCase().includes(q)))
        .sort((a, b) => a.employee.name.toLowerCase().localeCompare(b.employee.name.toLowerCase()))
      const items = rows.slice(0, size).map((p) => ({ employee_id: p.employee.employee_id, name: p.employee.name, job_title: p.employee.job_title, department: p.employee.department, email: p.employee.email, manager: null, avatar_initials: p.employee.avatar_initials, ...(hr ? { employment_type: p.employee.employment_type, start_date: p.employee.start_date, status: p.employee.status } : {}) }))
      return send(res, 200, { items, total: rows.length, page: 1, page_size: size, departments: [...new Set(state.people.map((p) => p.employee.department))].sort() })
    }

    // ---- holidays: read for everyone, write for HR
    if (route === '/holidays' && method === 'GET') {
      const year = Number(url.searchParams.get('year') ?? state.today.slice(0, 4))
      const inc = url.searchParams.get('include_inactive') === 'true'
      if (inc && !hr) return send(res, 403, FORBIDDEN)
      if (!Number.isInteger(year) || year < 2000 || year > 2100) return send(res, 422, { detail: 'Invalid request', errors: [] })
      let sync = state.autosync.mode
      if (sync === 'pending') {
        if (state.autosync.pendingPolls > 0) state.autosync.pendingPolls -= 1
        else {
          const taken = new Set(state.holidays.map((h) => holidayView(h, year).date_in_year).filter(Boolean))
          for (const i of autofillFor(year)) if (!taken.has(i.date)) state.holidays.push({ holiday_id: `ai-${state.seq++}`, name: i.name, type: i.type, date: i.date, month: null, day: null, active: true, source: 'ai' })
          state.autosync.mode = 'ready'
          sync = 'ready'
        }
      }
      let list = state.holidays.filter((h) => inc || h.active).map((h) => holidayView(h, year))
      if (!inc) list = list.filter((h) => h.date_in_year)
      list.sort((a, b) => (a.date_in_year === null) - (b.date_in_year === null) || String(a.date_in_year).localeCompare(String(b.date_in_year)) || a.name.localeCompare(b.name))
      return send(res, 200, { year, items: list, sync })
    }
    if (route === '/holidays' && method === 'POST') {
      if (!hr) return send(res, 403, FORBIDDEN)
      const unknown = Object.keys(body).filter((k) => !['name', 'type', 'date', 'month', 'day', 'active'].includes(k))
      if (unknown.length || body.__invalid) return send(res, 422, { detail: 'Invalid request', errors: [] })
      const ne = holidayName(body.name)
      if (ne) return send(res, 422, { detail: ne, code: 'validation', field: 'name' })
      const type = body.type ?? 'company'
      if (!['public', 'company'].includes(type)) return send(res, 422, { detail: 'type must be public or company', code: 'validation', field: 'type' })
      const hasDate = body.date !== undefined && body.date !== null
      const hasMd = body.month !== undefined || body.day !== undefined
      if (hasDate === hasMd) return send(res, 422, { detail: 'Send either date (one-off) or month and day (every year), not both and not neither', code: 'validation', field: 'date' })
      if (hasDate && !validDate(body.date)) return send(res, 422, { detail: 'date must be a valid YYYY-MM-DD between 2000 and 2100', code: 'validation', field: 'date' })
      if (hasMd && !validMD(body.month, body.day)) return send(res, 422, { detail: 'month and day must be a valid calendar day (29 February is allowed)', code: 'validation', field: 'month' })
      const h = { holiday_id: `h-${state.seq++}`, name: body.name.trim().replace(/\s+/g, ' '), type, date: hasDate ? body.date : null, month: hasDate ? null : body.month, day: hasDate ? null : body.day, active: body.active !== false }
      if (dup(h)) return send(res, 409, { detail: 'A holiday with this name already exists on that day', code: 'duplicate' })
      state.holidays.push(h)
      return send(res, 201, holidayView(h))
    }
    const hm = /^\/holidays\/([^/]+)$/.exec(route)
    if (hm) {
      if (!hr) return send(res, 403, FORBIDDEN)
      const h = state.holidays.find((x) => x.holiday_id === decodeURIComponent(hm[1]))
      if (!h) return send(res, 404, { detail: 'Holiday not found' })
      if (method === 'DELETE') {
        state.holidays = state.holidays.filter((x) => x !== h)
        return send(res, 204)
      }
      if (method === 'PATCH') {
        const keys = Object.keys(body)
        if (!keys.length) return send(res, 422, { detail: 'Nothing to change', code: 'empty' })
        const next = { ...h, ...(h.source === 'ai' ? { source: 'manual' } : {}) }
        if ('name' in body) {
          const ne = holidayName(body.name)
          if (ne) return send(res, 422, { detail: ne, code: 'validation', field: 'name' })
          next.name = body.name.trim().replace(/\s+/g, ' ')
        }
        if ('type' in body) next.type = body.type
        if ('active' in body) next.active = Boolean(body.active)
        if ('date' in body || 'month' in body || 'day' in body) {
          if (body.date) {
            if (!validDate(body.date)) return send(res, 422, { detail: 'date must be a valid YYYY-MM-DD between 2000 and 2100', code: 'validation', field: 'date' })
            Object.assign(next, { date: body.date, month: null, day: null })
          } else {
            if (!validMD(body.month, body.day)) return send(res, 422, { detail: 'month and day must be a valid calendar day (29 February is allowed)', code: 'validation', field: 'month' })
            Object.assign(next, { date: null, month: body.month, day: body.day })
          }
        }
        if (dup(next, h.holiday_id)) return send(res, 409, { detail: 'A holiday with this name already exists on that day', code: 'duplicate' })
        Object.assign(h, next)
        return send(res, 200, holidayView(h))
      }
    }

    // ---- people management: HR only
    if (route.startsWith('/people/')) {
      if (!hr) return send(res, 403, FORBIDDEN)
      if (route === '/people/entra-sync/status' && method === 'GET') return send(res, 200, entraView())
      if (route === '/people/entra-sync/run' && method === 'POST') {
        const e = state.entra
        if (!e.configured) return send(res, 409, { code: 'not_configured', detail: e.setup_hint ?? 'Microsoft directory sync is not connected.' })
        if (e.state === 'running') return send(res, 409, { code: 'already_running', detail: 'A sync is already running' })
        e.state = 'running'
        e.pollsLeft = e.runPolls
        e.startedAt = new Date().toISOString()
        return send(res, 202, { state: 'running' })
      }
      if (route === '/people/employees' && method === 'GET') {
        const q = (url.searchParams.get('q') ?? '').trim().toLowerCase()
        const status = url.searchParams.get('status')
        const page = Math.max(1, Number(url.searchParams.get('page') ?? 1))
        const size = Math.min(50, Math.max(1, Number(url.searchParams.get('page_size') ?? 20)))
        const rows = state.people
          .filter((p) => (!status || p.employee.status === status) && (!q || [p.employee.name, p.employee.email, p.employee.job_title, p.employee.department].some((f) => f.toLowerCase().includes(q))))
          .sort((a, b) => a.employee.name.toLowerCase().localeCompare(b.employee.name.toLowerCase()) || a.employee.employee_id.localeCompare(b.employee.employee_id))
        return send(res, 200, { items: rows.slice((page - 1) * size, page * size).map((p) => out(p, true)), total: rows.length, page, page_size: size })
      }
      if (route === '/people/employees' && method === 'POST') {
        const known = ['name', 'email', 'job_title', 'department', 'employment_type', 'manager_id', 'start_date', 'birthday', 'roles', 'can_sign_in', 'profile']
        if (body.__invalid || Object.keys(body).some((k) => !known.includes(k))) return send(res, 422, { detail: 'Invalid request', errors: [] })
        const fe = validateCreate(body)
        if ('profile' in body) {
          const pe = profileErrors(body.profile)
          if (pe.unknown) return send(res, 422, { detail: 'Invalid request', errors: [] })
          Object.assign(fe, pe)
        }
        if (Object.keys(fe).length) return send(res, 422, { detail: 'Invalid employee details', code: 'validation', field_errors: fe })
        if (byEmail(body.email.trim().toLowerCase())) return send(res, 409, { detail: 'An employee or account with this e-mail address already exists', code: 'email_exists' })
        return send(res, 201, out(createPerson(body)))
      }
      if (route === '/people/employees/import/template' && method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="employee_import_template.csv"', 'Cache-Control': 'no-store' })
        return res.end(TEMPLATE)
      }
      if (route === '/people/employees/import' && method === 'POST') {
        const file = multipartFile(raw, req.headers['content-type'])
        if (!file) return send(res, 422, { detail: 'Invalid request', errors: [] })
        const r = runImport(file, url.searchParams.get('dry_run') === 'true')
        return send(res, r.status, r.body)
      }
      const em = /^\/people\/employees\/([^/]+)(?:\/(deactivate|reactivate|roles))?$/.exec(route)
      if (em) {
        const target = find(decodeURIComponent(em[1]))
        if (!target) return send(res, 404, { detail: 'Employee not found' })
        const sub = em[2]
        const e = target.employee
        const a = target.account
        if (!sub && method === 'GET') return send(res, 200, out(target))
        if (!sub && method === 'DELETE') {
          if (state.deleteFails) return send(res, 409, { detail: 'This person still has active direct reports. Choose who they report to first.', code: 'has_direct_reports' })
          if (e.status !== 'left') return send(res, 409, { detail: 'Only people who have left can be deleted. Deactivate them first.', code: 'not_left' })
          state.people.splice(state.people.indexOf(target), 1)
          return send(res, 200, { deleted: true, employee_id: e.employee_id })
        }
        if (!sub && method === 'PATCH') {
          const allowed = ['name', 'email', 'job_title', 'department', 'employment_type', 'manager_id', 'start_date', 'birthday', 'can_sign_in', 'profile']
          if (body.__invalid || !Object.keys(body).length) return send(res, 422, { detail: 'Nothing to change', code: 'empty' })
          if (Object.keys(body).some((k) => !allowed.includes(k))) return send(res, 422, { detail: 'Invalid request', errors: [] })
          const fe = {}
          for (const k of ['name', 'job_title', 'department']) if (k in body) {
            const x = textError(body[k])
            if (x) fe[k] = x
          }
          if ('email' in body && emailError(body.email)) fe.email = 'must be a valid e-mail address'
          if ('employment_type' in body && !TYPES.includes(body.employment_type)) fe.employment_type = 'must be one of ' + TYPES.join(', ')
          if ('birthday' in body && bdayError(body.birthday)) fe.birthday = bdayError(body.birthday)
          if ('manager_id' in body && body.manager_id) {
            const mgr = find(body.manager_id)
            if (!mgr) fe.manager_id = 'must be an existing employee'
            else if (mgr.employee.status !== 'active') fe.manager_id = 'must be an active employee'
            else if (body.manager_id === e.employee_id || reportsTo(body.manager_id, e.employee_id)) fe.manager_id = 'must not be the person or someone who reports to them'
          }
          if ('profile' in body) {
            const pe = profileErrors(body.profile, e.profile)
            if (pe.unknown) return send(res, 422, { detail: 'Invalid request', errors: [] })
            Object.assign(fe, pe)
          }
          if (Object.keys(fe).length) return send(res, 422, { detail: 'Invalid employee details', code: 'validation', field_errors: fe })
          if ('email' in body) {
            const next = body.email.trim().toLowerCase()
            if (next !== e.email) {
              if (a.has_account && ['entra_bootstrap', 'demo'].includes(a.source)) return send(res, 409, { detail: "This person's e-mail address is managed by configuration and cannot be changed here", code: 'email_managed' })
              if (byEmail(next)) return send(res, 409, { detail: 'An employee or account with this e-mail address already exists', code: 'email_exists' })
            }
          }
          if ('can_sign_in' in body) {
            if (body.can_sign_in === false && a.has_account && !a.disabled && a.roles.includes('HRAdmin') && activeAdmins().length <= 1) return send(res, 409, { detail: LAST_ADMIN, code: 'last_hradmin' })
            if (body.can_sign_in === true && e.status === 'left') return send(res, 409, { detail: 'Reactivate this person before allowing sign-in', code: 'not_active' })
          }
          for (const k of ['name', 'job_title', 'department']) if (k in body) e[k] = body[k].trim().replace(/\s+/g, ' ')
          if ('email' in body) e.email = body.email.trim().toLowerCase()
          if ('employment_type' in body) e.employment_type = body.employment_type
          if ('manager_id' in body) e.manager_id = body.manager_id || null
          if ('start_date' in body) e.start_date = body.start_date || null
          if ('birthday' in body) e.birthday = body.birthday || null
          if ('name' in body) e.avatar_initials = initials(e.name)
          if ('profile' in body) e.profile = mergeProfile(e.profile, body.profile)
          if ('can_sign_in' in body) {
            if (body.can_sign_in === false && a.has_account) Object.assign(a, { disabled: true, disabled_reason: 'sign_in_off' })
            else if (body.can_sign_in === true) {
              if (!a.has_account) Object.assign(a, { has_account: true, roles: ['Employee'], source: 'hr_created', disabled: false, disabled_reason: null, user_id: `u-${e.employee_id}` })
              else Object.assign(a, { disabled: false, disabled_reason: null })
            }
          }
          return send(res, 200, out(target))
        }
        if (sub === 'deactivate' && method === 'POST') {
          if (e.status === 'left') return send(res, 409, { detail: 'This person has already left', code: 'already_left' })
          if (a.has_account && !a.disabled && a.roles.includes('HRAdmin') && activeAdmins().length <= 1) return send(res, 409, { detail: LAST_ADMIN, code: 'last_hradmin' })
          const reports = directReports(e.employee_id)
          const to = body.reassign_reports_to
          if (reports.length && !to) return send(res, 409, { detail: `${reports.length} active people report to this person. Choose a new manager for them.`, code: 'has_direct_reports', active_direct_reports: reports.length })
          if (to) {
            const mgr = find(to)
            if (!mgr) return send(res, 422, { detail: 'Invalid employee details', code: 'validation', field_errors: { reassign_reports_to: 'must be an existing employee' } })
            if (to === e.employee_id || mgr.employee.status !== 'active') return send(res, 422, { detail: 'Invalid employee details', code: 'validation', field_errors: { reassign_reports_to: 'must be an active person other than the one leaving' } })
            for (const r of reports) r.employee.manager_id = to
          }
          e.status = 'left'
          e.end_date = body.end_date ?? state.today
          if (a.has_account) Object.assign(a, { disabled: true, disabled_reason: 'deactivated' })
          return send(res, 200, out(target))
        }
        if (sub === 'reactivate' && method === 'POST') {
          if (e.status !== 'left') return send(res, 409, { detail: 'This person is not marked as left', code: 'not_left' })
          e.status = 'active'
          e.end_date = null
          if (a.has_account && a.disabled_reason === 'deactivated') Object.assign(a, { disabled: false, disabled_reason: null })
          return send(res, 200, out(target))
        }
        if (sub === 'roles' && method === 'PUT') {
          if (body.__invalid || !Array.isArray(body.roles) || Object.keys(body).length !== 1) return send(res, 422, { detail: 'Invalid request', errors: [] })
          if (body.roles.some((r) => !ROLE_ORDER.includes(r))) return send(res, 422, { detail: 'Invalid employee details', code: 'validation', field_errors: { roles: 'contains an unknown role' } })
          if (e.employee_id === user.employee_id) return send(res, 403, { detail: 'You cannot change your own roles' })
          if (!a.has_account) return send(res, 409, { detail: 'This person has no sign-in account, so they have no roles', code: 'no_account' })
          const next = ROLE_ORDER.filter((r) => r === 'Employee' || body.roles.includes(r))
          if (a.roles.includes('HRAdmin') && !next.includes('HRAdmin') && !a.disabled && activeAdmins().length <= 1) return send(res, 409, { detail: LAST_ADMIN, code: 'last_hradmin' })
          a.roles = next
          return send(res, 200, out(target))
        }
      }
      return send(res, 404, { detail: 'Not found' })
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
