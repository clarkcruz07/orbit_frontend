// Self-contained MOCK of the /learning API for the browser specs (own mock server; the shared mocks are untouched).
// It serves frontend/dist and the /learning routes itself and forwards everything else (auth, notifications, directory...)
// to the shared mock from mock-api.mjs. All data is fictional. The mock plays "the server": allowed_actions, overdue and
// due-soon flags are computed here from `state.today` (an injectable clock), exactly like the real service does.
// People (from the shared mock): Anna = HRAdmin, Ben = Manager of Carla and Dan, Carla = Employee, Dan = Finance.
import http from 'node:http'
import { startMock, USERS } from './mock-api.mjs'

export const MANAGER_OF = { 'EMP-0003': 'EMP-0002', 'EMP-0004': 'EMP-0002' }
const BRIEF = {
  'EMP-0001': { employee_id: 'EMP-0001', name: 'Anna Reyes', department: 'People & Culture', job_title: 'HR Administrator' },
  'EMP-0002': { employee_id: 'EMP-0002', name: 'Ben Cruz', department: 'Operations', job_title: 'Operations Manager' },
  'EMP-0003': { employee_id: 'EMP-0003', name: 'Carla Dizon', department: 'Compliance', job_title: 'Compliance Analyst' },
  'EMP-0004': { employee_id: 'EMP-0004', name: 'Dan Ocampo', department: 'Finance', job_title: 'Finance Officer' },
}
export const brief = (id) => BRIEF[id] ?? { employee_id: id, name: id, department: null, job_title: null }
const LIMITS = { title_max: 120, description_max: 1000, category_max: 60, completion_note_max: 1000, duration_hours_max: 1000, max_certificate_mb: 10, max_certificates_per_enrolment: 5 }
const NOW = '2026-11-16T10:00:00.000Z'
const STUB_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
let seq = 0
const uid = (p) => `${p}-0000-4000-8000-${String(++seq).padStart(12, '0')}`

export function makeCourse(over = {}) {
  return {
    course_id: uid('00000011'),
    title: 'Workplace Health and Safety Basics',
    category: 'Compliance',
    duration_hours: 2,
    delivery: 'online',
    active: true,
    description: 'Placeholder course - a fictional introduction to safe working practices.',
    mandatory_default: true,
    placeholder: true,
    created_at: NOW,
    updated_at: NOW,
    version: 1,
    ...over,
  }
}
export function makeEnrolment(over = {}) {
  return {
    enrolment_id: uid('00000012'),
    course_id: null, // set by the test
    employee_id: 'EMP-0003',
    status: 'assigned',
    source: 'assigned',
    mandatory: true,
    assigned_by: { employee_id: 'EMP-0002', name: 'Ben Cruz', role: 'Manager' },
    assigned_at: NOW,
    due_date: null,
    progress: 0,
    completion_note: null,
    completed_at: null,
    confirmation_status: null,
    confirmed_at: null,
    confirmed_by: null,
    certificates: [],
    created_at: NOW,
    updated_at: NOW,
    version: 1,
    ...over,
  }
}

export function createLearnState() {
  const c = [
    makeCourse(),
    makeCourse({ title: 'Data Privacy Essentials', duration_hours: 1.5, description: 'Placeholder course - a fictional overview of handling personal information.' }),
    makeCourse({ title: 'Effective Communication Skills', category: 'Soft skills', delivery: 'classroom', duration_hours: 4, mandatory_default: false, description: 'Placeholder course - a fictional workshop on clear written and spoken communication.' }),
    makeCourse({ title: 'Introduction to Project Planning', category: 'Professional skills', delivery: 'self_paced', duration_hours: 3, mandatory_default: false, description: 'Placeholder course - fictional primer on planning and tracking small projects.' }),
  ]
  return {
    courses: c,
    enrolments: [],
    today: '2026-11-16',
    delayMs: 0,
    failures: new Map(), // path prefix -> {status, times, body?}
    forceEnrolmentActions: null, // e.g. [] removes every action
    log: [],
    summaryCalls: 0,
    uploads: [],
  }
}

export async function startLearnMock({ distDir } = {}) {
  const base = await startMock({ distDir })
  const state = createLearnState()
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost')
    if (!url.pathname.startsWith('/api/learning')) return forward(req, res, base.port)
    const chunks = []
    for await (const ch of req) chunks.push(ch)
    const rawBuf = Buffer.concat(chunks)
    const isMultipart = String(req.headers['content-type'] || '').startsWith('multipart/')
    let json = {}
    if (!isMultipart) {
      try {
        json = rawBuf.length ? JSON.parse(rawBuf.toString('utf8')) : {}
      } catch {
        /* ignore */
      }
    }
    const route = url.pathname.slice(4)
    state.log.push(`${req.method} ${route}${url.search}`)
    if (state.delayMs) await new Promise((r) => setTimeout(r, state.delayMs))
    const auth = req.headers.authorization || ''
    const m = auth.match(/^Bearer acc-(.+)$/)
    const user = m ? USERS.find((u) => u.user_id === m[1]) : null
    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      res.end(status === 204 ? undefined : JSON.stringify(body ?? {}))
    }
    if (!user) return send(401, { detail: 'Not authenticated' })
    for (const [prefix, f] of state.failures) {
      if (route.startsWith(prefix) && f.times > 0) {
        f.times -= 1
        return send(f.status, f.body ?? { detail: 'Server error' })
      }
    }
    try {
      handle({ req, res, route, url, json, rawBuf, user, state, send })
    } catch (e) {
      send(500, { detail: `mock error: ${e.message}` })
    }
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const { port } = server.address()
  return {
    state,
    base,
    origin: `http://127.0.0.1:${port}`,
    close: async () => {
      await new Promise((r) => server.close(() => r()))
      await base.close()
    },
  }
}

function forward(req, res, port) {
  const up = http.request({ host: '127.0.0.1', port, method: req.method, path: req.url, headers: { ...req.headers, host: `127.0.0.1:${port}` } }, (r) => {
    res.writeHead(r.statusCode ?? 502, r.headers)
    r.pipe(res)
  })
  up.on('error', () => {
    res.writeHead(502)
    res.end()
  })
  req.pipe(up)
}

const has = (user, role) => user.roles.includes(role)
const isManagerOf = (user, empId) => has(user, 'Manager') && MANAGER_OF[empId] === user.employee_id
const OPEN = ['assigned', 'enrolled', 'in_progress']

function dayDiff(a, b) {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000)
}

function flags(state, e) {
  const open = OPEN.includes(e.status)
  if (!open || !e.due_date) return { overdue: false, days_overdue: 0, due_soon: false, days_until_due: null }
  const d = dayDiff(e.due_date, state.today)
  return { overdue: d < 0, days_overdue: d < 0 ? -d : 0, due_soon: d >= 0 && d <= 7, days_until_due: d }
}

const requiresConfirmation = (e) => e.source === 'assigned' || e.mandatory

function visible(user, e) {
  return e.employee_id === user.employee_id || e.assigned_by?.employee_id === user.employee_id || isManagerOf(user, e.employee_id) || has(user, 'HRAdmin')
}

function canConfirm(user, e) {
  if (e.status !== 'completed' || e.confirmation_status !== 'pending' || e.employee_id === user.employee_id) return false
  if (e.source === 'assigned') {
    if (e.assigned_by?.role === 'HRAdmin') return has(user, 'HRAdmin')
    return e.assigned_by?.employee_id === user.employee_id && has(user, 'Manager')
  }
  return isManagerOf(user, e.employee_id) || (has(user, 'HRAdmin') && !MANAGER_OF[e.employee_id])
}

function actionsFor(state, e, user) {
  if (state.forceEnrolmentActions) return state.forceEnrolmentActions
  const out = []
  const own = e.employee_id === user.employee_id
  const open = OPEN.includes(e.status)
  const locked = e.confirmation_status === 'confirmed'
  if (own && !locked) {
    if (e.status === 'assigned' || e.status === 'enrolled') out.push('start')
    if (open) out.push('update_progress', 'complete')
    if (open || (e.status === 'completed' && e.confirmation_status === 'pending')) out.push('upload_certificate')
    if (open && e.source === 'self' && !e.mandatory) out.push('cancel')
  }
  if (!own && open) {
    const byMe = e.assigned_by?.employee_id === user.employee_id
    if (e.source === 'assigned' && (byMe || has(user, 'HRAdmin'))) out.push('update_due_date', 'cancel')
    else if (e.mandatory && has(user, 'HRAdmin')) out.push('cancel')
  }
  if (canConfirm(user, e)) out.push('confirm', 'return')
  return out
}

function enrolmentOut(state, e, user) {
  const c = state.courses.find((x) => x.course_id === e.course_id)
  const f = flags(state, e)
  return {
    enrolment_id: e.enrolment_id,
    course: { course_id: c.course_id, title: c.title, category: c.category, duration_hours: c.duration_hours, delivery: c.delivery, active: c.active },
    employee: brief(e.employee_id),
    status: e.status,
    source: e.source,
    mandatory: e.mandatory,
    assigned_by: e.assigned_by,
    assigned_at: e.assigned_at,
    due_date: e.due_date,
    progress: e.progress,
    completion_note: e.completion_note,
    completed_at: e.completed_at,
    requires_confirmation: requiresConfirmation(e),
    confirmation_status: e.confirmation_status,
    confirmed_at: e.confirmed_at,
    confirmed_by: e.confirmed_by,
    ...f,
    counts_as_complete: e.status === 'completed' && (e.confirmation_status === 'not_required' || e.confirmation_status === 'confirmed'),
    certificates: e.certificates,
    created_at: e.created_at,
    updated_at: e.updated_at,
    version: e.version,
    allowed_actions: actionsFor(state, e, user),
  }
}

function courseOut(state, c, user) {
  const mine = state.enrolments.filter((e) => e.course_id === c.course_id && e.employee_id === user.employee_id && e.status !== 'cancelled').pop()
  const open = state.enrolments.some((e) => e.course_id === c.course_id && e.employee_id === user.employee_id && OPEN.includes(e.status))
  const actions = []
  if (c.active && user.employee_id && !open) actions.push('enrol')
  if (c.active && (has(user, 'Manager') || has(user, 'HRAdmin'))) actions.push('assign')
  if (has(user, 'HRAdmin')) actions.push('edit')
  return { ...c, my_enrolment: mine ? { enrolment_id: mine.enrolment_id, status: mine.status } : null, allowed_actions: actions }
}

function page(items, url) {
  const p = Math.max(1, Number(url.searchParams.get('page') || 1))
  const size = Math.min(50, Math.max(1, Number(url.searchParams.get('page_size') || 20)))
  return { items: items.slice((p - 1) * size, p * size), total: items.length, page: p, page_size: size }
}
const unprocessable = (send, field, msg) => send(422, { detail: 'Invalid request', errors: [{ loc: ['body', field], msg }] })
const norm = (s) => s.trim().replace(/\s+/g, ' ').toLowerCase()
const touch = (e) => {
  e.version += 1
  e.updated_at = new Date().toISOString()
}

function handle({ req, res, route, url, json, rawBuf, user, state, send }) {
  const method = req.method
  const notFound = () => send(404, { detail: 'Not found' })
  const forbidden = () => send(403, { detail: 'You do not have access to this action' })
  const hrOnly = () => send(403, { detail: 'You do not have access to this resource' })
  const course = (id) => state.courses.find((c) => c.course_id === id)
  const enrolment = (id) => state.enrolments.find((e) => e.enrolment_id === id)

  if (route === '/learning/config' && method === 'GET') {
    return send(200, { limits: LIMITS, allowed_certificate_types: ['application/pdf', 'image/png', 'image/jpeg'], statuses: ['assigned', 'enrolled', 'in_progress', 'completed', 'cancelled'], deliveries: ['self_paced', 'classroom', 'online'], due_soon_days: 7, notice: 'Placeholder courses and rules - set by HR. No grades, costs or external learning system.' })
  }

  // ---------------------------------------------------------------- courses
  if (route === '/learning/courses' && method === 'GET') {
    const active = url.searchParams.get('active') || 'true'
    if (!['true', 'false', 'all'].includes(active)) return send(400, { detail: 'Unknown filter value' })
    if (active !== 'true' && !has(user, 'HRAdmin')) return hrOnly()
    let list = state.courses.filter((c) => (active === 'all' ? true : active === 'true' ? c.active : !c.active))
    const categories = [...new Set(list.map((c) => c.category))].sort()
    const q = (url.searchParams.get('q') || '').toLowerCase()
    if (q) list = list.filter((c) => `${c.title} ${c.description} ${c.category}`.toLowerCase().includes(q))
    const cat = url.searchParams.get('category')
    if (cat) list = list.filter((c) => c.category.toLowerCase() === cat.toLowerCase())
    const del = url.searchParams.get('delivery')
    if (del) list = list.filter((c) => c.delivery === del)
    list = [...list].sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title))
    const p = page(list, url)
    return send(200, { ...p, items: p.items.map((c) => courseOut(state, c, user)), categories })
  }
  if (route === '/learning/courses' && method === 'POST') {
    if (!has(user, 'HRAdmin')) return forbidden()
    if (typeof json.title !== 'string' || !json.title.trim()) return unprocessable(send, 'title', 'String should have at least 1 character')
    if (state.courses.some((c) => norm(c.title) === norm(json.title))) return send(409, { detail: 'A course with that title already exists' })
    const c = makeCourse({ title: json.title.trim(), description: json.description ?? '', category: json.category, duration_hours: json.duration_hours, delivery: json.delivery, mandatory_default: Boolean(json.mandatory_default), active: json.active !== false, placeholder: false })
    state.courses.push(c)
    return send(201, courseOut(state, c, user))
  }
  let m = route.match(/^\/learning\/courses\/([^/]+)$/)
  if (m) {
    const c = course(m[1])
    if (!c) return notFound()
    if (method === 'GET') return send(200, courseOut(state, c, user))
    if (method === 'PATCH') {
      if (!has(user, 'HRAdmin')) return forbidden()
      if (typeof json.version === 'number' && json.version !== c.version) return send(409, { detail: 'This course was changed by someone else. Reload it and try again.' })
      if (typeof json.title === 'string') {
        if (state.courses.some((o) => o !== c && norm(o.title) === norm(json.title))) return send(409, { detail: 'A course with that title already exists' })
        c.title = json.title.trim()
      }
      for (const k of ['description', 'category', 'duration_hours', 'delivery', 'mandatory_default', 'active']) if (k in json) c[k] = json[k]
      c.placeholder = false
      c.version += 1
      return send(200, courseOut(state, c, user))
    }
  }

  // ---------------------------------------------------------------- enrolments
  if (route === '/learning/enrolments' && method === 'GET') {
    const scope = url.searchParams.get('scope') || 'mine'
    if (!['mine', 'team', 'review', 'all'].includes(scope)) return send(400, { detail: 'Unknown scope' })
    if ((scope === 'team' && !has(user, 'Manager')) || (scope === 'review' && !has(user, 'Manager') && !has(user, 'HRAdmin')) || (scope === 'all' && !has(user, 'HRAdmin'))) return forbidden()
    if (scope === 'mine') state.summaryCalls += 0
    let list = state.enrolments.filter((e) => (scope === 'mine' ? e.employee_id === user.employee_id : scope === 'team' ? isManagerOf(user, e.employee_id) : scope === 'review' ? canConfirm(user, e) : true))
    const status = url.searchParams.get('status')
    if (status) list = list.filter((e) => e.status === status)
    if (url.searchParams.get('overdue') === 'true') list = list.filter((e) => flags(state, e).overdue)
    if (url.searchParams.get('mandatory') === 'true') list = list.filter((e) => e.mandatory)
    const cid = url.searchParams.get('course_id')
    if (cid) list = list.filter((e) => e.course_id === cid)
    list = [...list].sort((a, b) => b.created_at.localeCompare(a.created_at))
    const p = page(list, url)
    return send(200, { ...p, items: p.items.map((e) => enrolmentOut(state, e, user)) })
  }
  if (route === '/learning/enrolments' && method === 'POST') {
    if (!user.employee_id) return forbidden()
    const c = course(json.course_id)
    if (!c) return notFound()
    if (!c.active) return send(409, { detail: 'This course is not open for enrolment' })
    const open = state.enrolments.find((e) => e.course_id === c.course_id && e.employee_id === user.employee_id && OPEN.includes(e.status))
    if (open) return send(409, { detail: 'You already have this course open', existing_enrolment_id: open.enrolment_id })
    const e = makeEnrolment({ course_id: c.course_id, employee_id: user.employee_id, status: 'enrolled', source: 'self', mandatory: c.mandatory_default, assigned_by: null, assigned_at: null })
    state.enrolments.push(e)
    return send(201, enrolmentOut(state, e, user))
  }
  if (route === '/learning/assignments' && method === 'POST') {
    const c = course(json.course_id)
    const target = Object.keys(BRIEF).includes(json.employee_id) ? json.employee_id : null
    if (!c || !target) return notFound()
    if (target === user.employee_id) return send(422, { detail: 'You cannot assign a course to yourself; enrol instead.' })
    const allowed = (has(user, 'Manager') && isManagerOf(user, target)) || has(user, 'HRAdmin')
    if (!allowed) return forbidden()
    if (json.due_date && json.due_date < state.today) return unprocessable(send, 'due_date', 'The due date cannot be in the past')
    const open = state.enrolments.find((e) => e.course_id === c.course_id && e.employee_id === target && OPEN.includes(e.status))
    if (open) return send(409, { detail: 'This person already has this course open', existing_enrolment_id: open.enrolment_id })
    const e = makeEnrolment({ course_id: c.course_id, employee_id: target, status: 'assigned', source: 'assigned', mandatory: typeof json.mandatory === 'boolean' ? json.mandatory : c.mandatory_default, assigned_by: { employee_id: user.employee_id, name: user.name, role: has(user, 'HRAdmin') ? 'HRAdmin' : 'Manager' }, due_date: json.due_date ?? null })
    state.enrolments.push(e)
    return send(201, enrolmentOut(state, e, user))
  }
  m = route.match(/^\/learning\/enrolments\/([^/]+)(?:\/(start|complete|confirm|return|cancel|certificate))?$/)
  if (m) {
    const e = enrolment(m[1])
    if (!e || !visible(user, e)) return notFound()
    const act = m[2]
    const allowed = actionsFor(state, e, user)
    if (!act && method === 'GET') return send(200, enrolmentOut(state, e, user))
    if (!act && method === 'PATCH') {
      if (typeof json.version === 'number' && json.version !== e.version) return send(409, { detail: 'This enrolment was changed by someone else. Reload it and try again.' })
      if ('progress' in json) {
        if (!allowed.includes('update_progress')) return OPEN.includes(e.status) ? forbidden() : send(409, { detail: 'Progress cannot change once the course is finished' })
        e.progress = json.progress
        if (e.progress > 0 && (e.status === 'assigned' || e.status === 'enrolled')) e.status = 'in_progress'
      }
      if ('due_date' in json) {
        if (!allowed.includes('update_due_date')) return forbidden()
        if (json.due_date && json.due_date < state.today) return unprocessable(send, 'due_date', 'The due date cannot be in the past')
        e.due_date = json.due_date
      }
      touch(e)
      return send(200, enrolmentOut(state, e, user))
    }
    if (method === 'POST' && act) {
      const need = { start: 'start', complete: 'complete', confirm: 'confirm', return: 'return', cancel: 'cancel', certificate: 'upload_certificate' }[act]
      if (!allowed.includes(need)) return e.status === 'completed' || e.status === 'cancelled' || e.confirmation_status === 'confirmed' ? send(409, { detail: 'This is not possible in the current state' }) : forbidden()
      if (act === 'start') e.status = 'in_progress'
      if (act === 'complete') {
        e.status = 'completed'
        e.progress = 100
        e.completion_note = json.completion_note ?? null
        e.completed_at = new Date().toISOString()
        e.confirmation_status = requiresConfirmation(e) ? 'pending' : 'not_required'
      }
      if (act === 'confirm') Object.assign(e, { confirmation_status: 'confirmed', confirmed_at: new Date().toISOString(), confirmed_by: { employee_id: user.employee_id, name: user.name } })
      if (act === 'return') Object.assign(e, { status: 'in_progress', completion_note: null, completed_at: null, confirmation_status: null })
      if (act === 'cancel') e.status = 'cancelled'
      if (act === 'certificate') {
        const head = rawBuf.toString('latin1', 0, Math.min(rawBuf.length, 2000))
        const name = /filename="([^"]*)"/.exec(head)?.[1] ?? 'file'
        state.uploads.push({ enrolment_id: e.enrolment_id, name, size: rawBuf.length })
        if (rawBuf.length > 10 * 1024 * 1024) return send(413, { detail: 'The file is too large' })
        if (!/\.(pdf|png|jpe?g)$/i.test(name)) return send(415, { detail: 'Unsupported file type' })
        if (e.certificates.length >= 5) return send(409, { detail: 'At most 5 certificate files per enrolment' })
        for (const c of e.certificates) c.is_current = false
        e.certificates.push({ certificate_id: uid('00000013'), filename: name, content_type: /\.pdf$/i.test(name) ? 'application/pdf' : /\.png$/i.test(name) ? 'image/png' : 'image/jpeg', size_bytes: STUB_PNG.length, uploaded_at: new Date().toISOString(), is_current: true })
        touch(e)
        return send(201, enrolmentOut(state, e, user))
      }
      touch(e)
      return send(200, enrolmentOut(state, e, user))
    }
  }
  m = route.match(/^\/learning\/enrolments\/([^/]+)\/certificates\/([^/]+)\/file$/)
  if (m && method === 'GET') {
    const e = enrolment(m[1])
    if (!e || !visible(user, e)) return notFound()
    const cert = e.certificates.find((c) => c.certificate_id === m[2])
    if (!cert) return notFound()
    if (cert.missing) return send(404, { detail: 'The file is not available' })
    res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Disposition': `attachment; filename="certificate-${cert.certificate_id.slice(-8)}.png"`, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' })
    return res.end(STUB_PNG)
  }

  // ---------------------------------------------------------------- summaries
  if (route === '/learning/my/summary' && method === 'GET') {
    state.summaryCalls += 1
    const mine = state.enrolments.filter((e) => e.employee_id === user.employee_id)
    const n = (s) => mine.filter((e) => e.status === s).length
    const fl = mine.map((e) => flags(state, e))
    return send(200, {
      counts: {
        assigned: n('assigned'),
        enrolled: n('enrolled'),
        in_progress: n('in_progress'),
        completed: n('completed'),
        cancelled: n('cancelled'),
        overdue: fl.filter((f) => f.overdue).length,
        due_soon: fl.filter((f) => f.due_soon).length,
        pending_confirmation: mine.filter((e) => e.confirmation_status === 'pending').length,
        mandatory_open: mine.filter((e) => e.mandatory && OPEN.includes(e.status)).length,
      },
      awaiting_my_confirmation: state.enrolments.filter((e) => canConfirm(user, e)).length,
    })
  }
  if (route === '/learning/team/summary' && method === 'GET') {
    if (!has(user, 'Manager')) return hrOnly()
    const reports = Object.entries(MANAGER_OF).filter(([, mgr]) => mgr === user.employee_id).map(([id]) => id)
    const items = reports.map((id) => {
      const list = state.enrolments.filter((e) => e.employee_id === id && e.status !== 'cancelled')
      const n = (s) => list.filter((e) => e.status === s).length
      return { employee: brief(id), assigned: n('assigned'), enrolled: n('enrolled'), in_progress: n('in_progress'), completed: n('completed'), overdue: list.filter((e) => flags(state, e).overdue).length, pending_confirmation: list.filter((e) => e.confirmation_status === 'pending').length, mandatory_open: list.filter((e) => e.mandatory && OPEN.includes(e.status)).length }
    })
    return send(200, { items, total: items.length })
  }
  if (route === '/learning/compliance' && method === 'GET') {
    if (!has(user, 'HRAdmin')) return hrOnly()
    const dept = url.searchParams.get('department')
    const cid = url.searchParams.get('course_id')
    const mand = state.enrolments.filter((e) => e.mandatory && e.status !== 'cancelled' && (!dept || (brief(e.employee_id).department ?? 'Unassigned') === dept) && (!cid || e.course_id === cid))
    const complete = (e) => e.status === 'completed' && (e.confirmation_status === 'not_required' || e.confirmation_status === 'confirmed')
    const sum = (list) => {
      const assigned = list.length
      const completed = list.filter(complete).length
      return { assigned, completed, overdue: list.filter((e) => flags(state, e).overdue).length, pending_confirmation: list.filter((e) => e.confirmation_status === 'pending').length, completion_pct: assigned ? Math.round((completed / assigned) * 100) : 0 }
    }
    const courses = state.courses
      .filter((c) => (!cid || c.course_id === cid) && (mand.some((e) => e.course_id === c.course_id) || (c.mandatory_default && c.active)))
      .map((c) => {
        const list = mand.filter((e) => e.course_id === c.course_id)
        const depts = [...new Set(list.map((e) => brief(e.employee_id).department ?? 'Unassigned'))].sort()
        return { course_id: c.course_id, title: c.title, mandatory_default: c.mandatory_default, ...sum(list), not_enrolled: c.mandatory_default ? Math.max(0, 4 - list.length) : 0, by_department: depts.map((d) => ({ department: d, ...sum(list.filter((e) => (brief(e.employee_id).department ?? 'Unassigned') === d)) })) }
      })
    const overdue = mand
      .filter((e) => flags(state, e).overdue)
      .map((e) => ({ enrolment_id: e.enrolment_id, employee_id: e.employee_id, employee_name: brief(e.employee_id).name, department: brief(e.employee_id).department, course_id: e.course_id, course_title: course(e.course_id).title, due_date: e.due_date, days_overdue: flags(state, e).days_overdue, status: e.status }))
      .sort((a, b) => b.days_overdue - a.days_overdue)
    return send(200, { as_of: state.today, totals: sum(mand), courses, overdue, overdue_total: overdue.length, departments: [...new Set(state.enrolments.map((e) => brief(e.employee_id).department ?? 'Unassigned'))].sort(), notice: 'Placeholder rules - set by HR.' })
  }
  return notFound()
}
