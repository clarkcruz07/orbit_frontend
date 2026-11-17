// Self-contained MOCK of the /performance API for the browser specs (own mock server; the shared mocks are untouched).
// It serves frontend/dist and the /performance routes itself and forwards everything else (auth, notifications, search,
// directory...) to the shared mock from mock-api.mjs, so the whole shell works. All data is fictional.
// People (from the shared mock): Anna = HRAdmin, Ben = Manager of Carla, Carla = Employee, Dan = Finance.
// `state.*` flags let a test force errors, delays, allowed_actions and the mood switch.
import http from 'node:http'
import { startMock, USERS } from './mock-api.mjs'

export const MANAGER_OF = { 'EMP-0003': 'EMP-0002', 'EMP-0004': 'EMP-0002' } // Carla and Dan -> Ben
const BRIEF = {
  'EMP-0001': { employee_id: 'EMP-0001', name: 'Anna Reyes', department: 'People & Culture', job_title: 'HR Administrator' },
  'EMP-0002': { employee_id: 'EMP-0002', name: 'Ben Cruz', department: 'Operations', job_title: 'Operations Manager' },
  'EMP-0003': { employee_id: 'EMP-0003', name: 'Carla Dizon', department: 'Compliance', job_title: 'Compliance Analyst' },
  'EMP-0004': { employee_id: 'EMP-0004', name: 'Dan Ocampo', department: 'Finance', job_title: 'Finance Officer' },
}
export const brief = (id) => BRIEF[id] ?? { employee_id: id, name: id, department: null, job_title: null }

const LIMITS = { goal_title_max: 120, goal_description_max: 1000, comment_max: 1000, period_label_max: 60, checkin_text_max: 2000, feedback_max: 2000, max_goals_per_employee: 100, max_comments_per_goal: 100 }
const NOW = '2026-11-16T10:00:00.000Z'
let seq = 0
const uid = (p) => `${p}-0000-4000-8000-${String(++seq).padStart(12, '0')}`

export function makeGoal(over = {}) {
  return {
    goal_id: uid('00000001'),
    employee_id: 'EMP-0003',
    title: 'Complete the compliance refresher',
    description: 'Fictional goal.',
    due_date: '2027-03-31',
    status: 'not_started',
    progress: 0,
    created_at: NOW,
    updated_at: NOW,
    version: 1,
    comments: [],
    ...over,
  }
}
export function makeCheckin(over = {}) {
  return {
    checkin_id: uid('00000002'),
    employee_id: 'EMP-0003',
    period_label: '2027-Q1',
    status: 'submitted',
    origin: 'employee',
    requested_by: null,
    requested_at: null,
    accomplishments: 'Closed the audit findings.',
    blockers: 'Waiting for the policy owner.',
    next_steps: 'Run the next review.',
    mood: 4,
    submitted_at: NOW,
    acknowledged_at: null,
    acknowledged_by: null,
    feedback: null,
    created_at: NOW,
    updated_at: NOW,
    version: 1,
    ...over,
  }
}

export function createPerfState() {
  return {
    goals: [],
    checkins: [],
    hrCanSeeMood: false,
    delayMs: 0, // delay every /performance answer
    failures: new Map(), // path prefix -> {status, times}
    forceGoalActions: null, // e.g. [] to remove every action
    forceCheckinActions: null,
    noManager: new Set(), // employee ids whose reviewer is HR
    probation: [], // Probation Evaluation rows (see makeEvaluation)
    probationBodies: [], // {method, route, body} of every probation write, for the specs
    probationEligible: null, // e.g. [] to force "nobody to evaluate"
    probationForceMissing: null,
    probationPdfStatus: 0,
    pdfCalls: [],
    log: [],
    today: '2026-11-16',
  }
}

const isoToday = (state) => state.today

export async function startPerfMock({ distDir } = {}) {
  const base = await startMock({ distDir })
  const state = createPerfState()
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost')
    if (!url.pathname.startsWith('/api/performance')) return forward(req, res, base.port)
    let raw = ''
    for await (const c of req) raw += c
    let json = {}
    try {
      json = raw ? JSON.parse(raw) : {}
    } catch {
      /* ignore */
    }
    const route = url.pathname.slice(4)
    state.log.push(`${req.method} ${route}${url.search}`)
    if (route.startsWith('/performance/probation') && req.method !== 'GET') state.probationBodies.push({ method: req.method, route, body: json })
    if (state.delayMs) await new Promise((r) => setTimeout(r, state.delayMs))
    const auth = req.headers.authorization || ''
    const m = auth.match(/^Bearer acc-(.+)$/)
    const user = m ? USERS.find((u) => u.user_id === m[1]) : null
    const send = (status, body) => {
      if (body && body.__raw) {
        res.writeHead(status, { 'Cache-Control': 'no-store', ...body.__headers })
        return res.end(body.__raw)
      }
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
      handle({ req, route, url, json, user, state, send })
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
const managerOf = (empId) => MANAGER_OF[empId] ?? null
const isManagerOf = (user, empId) => has(user, 'Manager') && managerOf(empId) === user.employee_id

function canSee(user, ownerId) {
  return ownerId === user.employee_id || isManagerOf(user, ownerId) || has(user, 'HRAdmin')
}

function goalOut(state, g, user, withComments) {
  const overdue = Boolean(g.due_date && g.due_date < isoToday(state) && (g.status === 'not_started' || g.status === 'in_progress'))
  let actions = g.employee_id === user.employee_id ? ['edit'] : isManagerOf(user, g.employee_id) ? ['comment'] : []
  if (state.forceGoalActions) actions = state.forceGoalActions
  const out = {
    goal_id: g.goal_id,
    employee: brief(g.employee_id),
    title: g.title,
    description: g.description,
    due_date: g.due_date,
    status: g.status,
    progress: g.progress,
    overdue,
    comment_count: g.comments.length,
    created_at: g.created_at,
    updated_at: g.updated_at,
    version: g.version,
    allowed_actions: actions,
  }
  if (withComments) out.comments = g.comments
  return out
}

function reviewerFor(state, empId) {
  const mgr = managerOf(empId)
  if (!mgr || state.noManager.has(empId)) return { kind: 'hr', employee_id: null, name: null }
  return { kind: 'manager', employee_id: mgr, name: brief(mgr).name }
}

function checkinOut(state, c, user) {
  const own = c.employee_id === user.employee_id
  const mgr = isManagerOf(user, c.employee_id)
  const moodVisible = own || mgr || (has(user, 'HRAdmin') && state.hrCanSeeMood)
  const reviewer = reviewerFor(state, c.employee_id)
  let actions = []
  if (c.status === 'requested' && own) actions = ['submit']
  if (c.status === 'submitted' && !own && (mgr || (reviewer.kind === 'hr' && has(user, 'HRAdmin')))) actions = ['acknowledge']
  if (state.forceCheckinActions) actions = state.forceCheckinActions
  return {
    checkin_id: c.checkin_id,
    employee: brief(c.employee_id),
    period_label: c.period_label,
    status: c.status,
    origin: c.origin,
    requested_by: c.requested_by,
    requested_at: c.requested_at,
    accomplishments: c.status === 'requested' ? '' : c.accomplishments,
    blockers: c.status === 'requested' ? '' : c.blockers,
    next_steps: c.status === 'requested' ? '' : c.next_steps,
    mood: moodVisible ? c.mood : null,
    mood_visible: moodVisible,
    submitted_at: c.submitted_at,
    reviewer,
    acknowledged_at: c.acknowledged_at,
    acknowledged_by: c.acknowledged_by,
    feedback: c.feedback,
    created_at: c.created_at,
    updated_at: c.updated_at,
    version: c.version,
    allowed_actions: actions,
  }
}

const norm = (s) => s.trim().replace(/\s+/g, ' ').toLowerCase()
function page(items, url) {
  const p = Math.max(1, Number(url.searchParams.get('page') || 1))
  const size = Math.min(50, Math.max(1, Number(url.searchParams.get('page_size') || 20)))
  return { items: items.slice((p - 1) * size, p * size), total: items.length, page: p, page_size: size }
}
const unprocessable = (send, field, msg) => send(422, { detail: 'Invalid request', errors: [{ loc: ['body', field], msg }] })

function handle({ req, route, url, json, user, state, send }) {
  const method = req.method
  const notFound = () => send(404, { detail: 'Not found' })
  const forbidden = () => send(403, { detail: 'You do not have access to this action' })

  if (route === '/performance/config' && method === 'GET') {
    return send(200, {
      limits: LIMITS,
      goal_statuses: ['not_started', 'in_progress', 'done', 'dropped'],
      checkin_statuses: ['requested', 'submitted', 'acknowledged'],
      mood_scale: { min: 1, max: 5 },
      hr_can_see_mood: state.hrCanSeeMood,
      notice: 'Placeholder rules for demonstration - no ratings, scores or pay effects.',
    })
  }
  if (route === '/performance/summary' && method === 'GET') {
    const mine = state.goals.filter((g) => g.employee_id === user.employee_id)
    const count = (s) => mine.filter((g) => g.status === s).length
    const myC = state.checkins.filter((c) => c.employee_id === user.employee_id)
    const team = has(user, 'Manager') || has(user, 'HRAdmin')
      ? { direct_reports: has(user, 'Manager') ? 1 : 0, reviews_waiting: state.checkins.filter((c) => checkinOut(state, c, user).allowed_actions.includes('acknowledge')).length, open_goals: 0 }
      : null
    return send(200, {
      goals: { total: mine.length, not_started: count('not_started'), in_progress: count('in_progress'), done: count('done'), dropped: count('dropped'), overdue: 0 },
      checkins: { requested_of_me: myC.filter((c) => c.status === 'requested').length, submitted: myC.filter((c) => c.status === 'submitted').length, acknowledged: myC.filter((c) => c.status === 'acknowledged').length },
      team,
    })
  }

  // ---------------------------------------------------------------- goals
  if (route === '/performance/goals' && method === 'GET') {
    const scope = url.searchParams.get('scope') || 'mine'
    if (!['mine', 'team', 'all'].includes(scope)) return send(400, { detail: 'Unknown scope' })
    if ((scope === 'team' && !has(user, 'Manager')) || (scope === 'all' && !has(user, 'HRAdmin'))) return forbidden()
    let list = state.goals.filter((g) => (scope === 'mine' ? g.employee_id === user.employee_id : scope === 'team' ? isManagerOf(user, g.employee_id) : true))
    const status = url.searchParams.get('status')
    if (status) list = list.filter((g) => g.status === status)
    const emp = url.searchParams.get('employee_id')
    if (emp) list = list.filter((g) => g.employee_id === emp)
    list = [...list].sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    const p = page(list, url)
    return send(200, { ...p, items: p.items.map((g) => goalOut(state, g, user, false)) })
  }
  if (route === '/performance/goals' && method === 'POST') {
    if (!user.employee_id) return forbidden()
    const title = typeof json.title === 'string' ? json.title.trim() : ''
    if (!title) return unprocessable(send, 'title', 'String should have at least 1 character')
    const g = makeGoal({ employee_id: user.employee_id, title, description: json.description ?? '', due_date: json.due_date ?? null, updated_at: new Date().toISOString() })
    state.goals.push(g)
    return send(201, goalOut(state, g, user, true))
  }
  let m = route.match(/^\/performance\/goals\/([^/]+)$/)
  if (m) {
    const g = state.goals.find((x) => x.goal_id === m[1])
    if (!g || !canSee(user, g.employee_id)) return notFound()
    if (method === 'GET') return send(200, goalOut(state, g, user, true))
    if (method === 'PATCH') {
      if (g.employee_id !== user.employee_id) return forbidden()
      if (typeof json.version === 'number' && json.version !== g.version) return send(409, { detail: 'This goal was changed by someone else. Reload it and try again.' })
      if (typeof json.title === 'string') g.title = json.title.trim()
      if (typeof json.description === 'string') g.description = json.description
      if ('due_date' in json) g.due_date = json.due_date
      if (json.status) {
        if (g.status === 'dropped' && json.status === 'done') return send(409, { detail: 'A dropped goal cannot be marked done' })
        g.status = json.status
        if (json.status === 'done') g.progress = 100
        if (json.status === 'not_started') g.progress = 0
        if (json.status === 'in_progress' && g.progress === 100) g.progress = 99
      } else if (typeof json.progress === 'number') {
        if (g.status === 'dropped') return send(409, { detail: 'Reopen the goal before changing its progress' })
        g.progress = json.progress
        g.status = json.progress >= 100 ? 'done' : json.progress === 0 && g.status === 'not_started' ? 'not_started' : 'in_progress'
      }
      g.version += 1
      g.updated_at = new Date().toISOString()
      return send(200, goalOut(state, g, user, true))
    }
  }
  m = route.match(/^\/performance\/goals\/([^/]+)\/comments$/)
  if (m && method === 'POST') {
    const g = state.goals.find((x) => x.goal_id === m[1])
    if (!g || !canSee(user, g.employee_id)) return notFound()
    if (!isManagerOf(user, g.employee_id)) return forbidden()
    const text = typeof json.text === 'string' ? json.text.trim() : ''
    if (!text) return unprocessable(send, 'text', 'String should have at least 1 character')
    g.comments.push({ comment_id: uid('00000003'), by: { employee_id: user.employee_id, name: user.name }, text, at: new Date().toISOString() })
    return send(201, goalOut(state, g, user, true))
  }

  // ---------------------------------------------------------------- check-ins
  if (route === '/performance/checkins' && method === 'GET') {
    const scope = url.searchParams.get('scope') || 'mine'
    if (!['mine', 'team', 'review', 'all'].includes(scope)) return send(400, { detail: 'Unknown scope' })
    if ((scope === 'team' && !has(user, 'Manager')) || (scope === 'review' && !has(user, 'Manager') && !has(user, 'HRAdmin')) || (scope === 'all' && !has(user, 'HRAdmin'))) return forbidden()
    let list = state.checkins.filter((c) => {
      if (scope === 'mine') return c.employee_id === user.employee_id
      if (scope === 'team') return isManagerOf(user, c.employee_id)
      if (scope === 'review') return checkinOut(state, c, user).allowed_actions.includes('acknowledge')
      return true
    })
    const status = url.searchParams.get('status')
    if (status) list = list.filter((c) => c.status === status)
    const period = url.searchParams.get('period')
    if (period) list = list.filter((c) => norm(c.period_label) === norm(period))
    const emp = url.searchParams.get('employee_id')
    if (emp) list = list.filter((c) => c.employee_id === emp)
    const p = page([...list].sort((a, b) => b.updated_at.localeCompare(a.updated_at)), url)
    return send(200, { ...p, items: p.items.map((c) => checkinOut(state, c, user)) })
  }
  if (route === '/performance/checkins' && method === 'POST') {
    if (!user.employee_id) return forbidden()
    const period = typeof json.period_label === 'string' ? json.period_label.trim() : ''
    if (!period) return unprocessable(send, 'period_label', 'String should have at least 1 character')
    if (!['accomplishments', 'blockers', 'next_steps'].some((k) => typeof json[k] === 'string' && json[k].trim())) return unprocessable(send, 'accomplishments', 'Fill in at least one of the three text fields')
    const dup = state.checkins.find((c) => c.employee_id === user.employee_id && norm(c.period_label) === norm(period))
    if (dup) return send(409, { detail: 'You already have a check-in for that period', existing_checkin_id: dup.checkin_id })
    const c = makeCheckin({ employee_id: user.employee_id, period_label: period, accomplishments: json.accomplishments ?? '', blockers: json.blockers ?? '', next_steps: json.next_steps ?? '', mood: json.mood ?? null, updated_at: new Date().toISOString() })
    state.checkins.push(c)
    return send(201, checkinOut(state, c, user))
  }
  if (route === '/performance/checkins/request' && method === 'POST') {
    const target = Object.keys(BRIEF).includes(json.employee_id) ? json.employee_id : null
    if (!target) return notFound()
    if (!isManagerOf(user, target)) return forbidden()
    const period = typeof json.period_label === 'string' ? json.period_label.trim() : ''
    if (!period) return unprocessable(send, 'period_label', 'String should have at least 1 character')
    if (state.checkins.some((c) => c.employee_id === target && norm(c.period_label) === norm(period))) return send(409, { detail: 'A check-in for this period already exists for this person' })
    const c = makeCheckin({ employee_id: target, period_label: period, status: 'requested', origin: 'manager', requested_by: { employee_id: user.employee_id, name: user.name }, requested_at: new Date().toISOString(), accomplishments: '', blockers: '', next_steps: '', mood: null, submitted_at: null })
    state.checkins.push(c)
    return send(201, checkinOut(state, c, user))
  }
  m = route.match(/^\/performance\/checkins\/([^/]+)(?:\/(submit|acknowledge))?$/)
  if (m) {
    const c = state.checkins.find((x) => x.checkin_id === m[1])
    if (!c || !canSee(user, c.employee_id)) return notFound()
    if (!m[2] && method === 'GET') return send(200, checkinOut(state, c, user))
    if (m[2] === 'submit' && method === 'POST') {
      if (c.employee_id !== user.employee_id) return forbidden()
      if (c.status !== 'requested') return send(409, { detail: 'This check-in is not waiting to be filled in' })
      if (!['accomplishments', 'blockers', 'next_steps'].some((k) => typeof json[k] === 'string' && json[k].trim())) return unprocessable(send, 'accomplishments', 'Fill in at least one of the three text fields')
      Object.assign(c, { status: 'submitted', accomplishments: json.accomplishments ?? '', blockers: json.blockers ?? '', next_steps: json.next_steps ?? '', mood: json.mood ?? null, submitted_at: new Date().toISOString(), version: c.version + 1 })
      return send(200, checkinOut(state, c, user))
    }
    if (m[2] === 'acknowledge' && method === 'POST') {
      const couldReview = isManagerOf(user, c.employee_id) || (has(user, 'HRAdmin') && c.employee_id !== user.employee_id)
      if (couldReview && c.status !== 'submitted') return send(409, { detail: 'This check-in is not waiting to be acknowledged' })
      if (!checkinOut(state, c, user).allowed_actions.includes('acknowledge') && !state.forceCheckinActions) return forbidden()
      Object.assign(c, { status: 'acknowledged', acknowledged_at: new Date().toISOString(), acknowledged_by: { employee_id: user.employee_id, name: user.name, kind: isManagerOf(user, c.employee_id) ? 'manager' : 'hr' }, feedback: json.feedback ?? null, version: c.version + 1 })
      return send(200, checkinOut(state, c, user))
    }
  }

  // ---------------------------------------------------------------- overview
  if (route === '/performance/overview' && method === 'GET') {
    if (!has(user, 'HRAdmin')) return forbidden()
    const wanted = url.searchParams.get('period')
    const dept = url.searchParams.get('department')
    const byPeriod = new Map()
    for (const c of state.checkins) {
      if (wanted && norm(c.period_label) !== norm(wanted)) continue
      const d = brief(c.employee_id).department ?? 'Unassigned'
      if (dept && d !== dept) continue
      const p = byPeriod.get(c.period_label) ?? { period_label: c.period_label, requested: 0, submitted: 0, acknowledged: 0, by: new Map() }
      p[c.status] += 1
      const x = p.by.get(d) ?? { department: d, requested: 0, submitted: 0, acknowledged: 0 }
      x[c.status] += 1
      p.by.set(d, x)
      byPeriod.set(c.period_label, p)
    }
    const fin = (x) => {
      const total = x.requested + x.submitted + x.acknowledged
      const completed = x.submitted + x.acknowledged
      return { ...x, total, completed, completion_pct: total ? Math.round((completed / total) * 100) : 0 }
    }
    const periods = [...byPeriod.values()].map((p) => ({ ...fin(p), by: undefined, by_department: [...p.by.values()].map(fin) }))
    const by_status = { not_started: 0, in_progress: 0, done: 0, dropped: 0 }
    for (const g of state.goals) by_status[g.status] += 1
    return send(200, { periods, goals: { total: state.goals.length, by_status }, departments: [...new Set(state.checkins.map((c) => brief(c.employee_id).department ?? 'Unassigned'))].sort() })
  }
  // ---------------------------------------------------------------- probation evaluations (manager + HR only)
  if (route.startsWith('/performance/probation')) return handleProbation({ req, route, url, json, user, state, send })
  return notFound()
}

const CRITERIA = [
  ['role', 'Understanding of the Role'],
  ['quality', 'Quality of Work'],
  ['productivity', 'Productivity & Time Management'],
  ['problem_solving', 'Problem Solving & Decision Making'],
  ['learning', 'Learning & Adaptability'],
  ['communication', 'Communication'],
  ['teamwork', 'Teamwork & Collaboration'],
  ['reliability', 'Reliability & Professionalism'],
  ['initiative', 'Initiative'],
]
export const PROBATION_KEYS = CRITERIA.map(([k]) => k)
const PROBATION_FORM = {
  version: '1.0',
  title: 'Probationary Employee Evaluation Form',
  rating_guide: [
    { rating: 5, label: 'Exceeds Expectations', standard: 'Consistently performs above the requirements of the role.' },
    { rating: 4, label: 'Meets Expectations', standard: 'Consistently performs the duties of the role to the expected standard.' },
    { rating: 3, label: 'Developing', standard: 'Generally meets expectations but still requires guidance.' },
    { rating: 2, label: 'Needs Improvement', standard: 'Performance is inconsistent and requires regular supervision or coaching.' },
    { rating: 1, label: 'Unsatisfactory', standard: 'Does not meet the minimum performance requirements of the role.' },
  ],
  criteria: CRITERIA.map(([key, title], i) => ({ key, number: i + 1, title, bullets: [1, 2, 3, 4, 5].map((n) => `${title}: criterion ${n}.`) })),
  recommendations: [
    { value: 'confirm', label: 'Confirm Employment (Regularise)' },
    { value: 'extend', label: 'Extend Probation' },
    { value: 'not_confirm', label: 'Do Not Confirm Employment' },
  ],
  limits: { comment_max: 2000, dev_rows_max: 10, cell_max: 300 },
}

export function makeEvaluation(over = {}) {
  const ratings = {}
  for (const k of PROBATION_KEYS) ratings[k] = { rating: null, comments: '' }
  return {
    evaluation_id: uid('00000003'),
    employee_id: 'EMP-0003',
    evaluator_id: 'u-ben',
    review_date: '2026-11-16',
    status: 'draft',
    ratings,
    strengths: '',
    development_comments: '',
    development_rows: [],
    summary: '',
    recommendation: null,
    extension: { reasons: '', objectives: '', review_date: '' },
    created_at: NOW,
    updated_at: NOW,
    submitted_at: null,
    submitted_by_name: null,
    ...over,
  }
}
export function completeRatings(rating = 4) {
  const r = {}
  for (const k of PROBATION_KEYS) r[k] = { rating, comments: '' }
  return r
}

const PDF_BYTES = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n')
const average = (e) => {
  const given = PROBATION_KEYS.map((k) => e.ratings[k]?.rating).filter((n) => Number.isInteger(n))
  return given.length ? Math.round((given.reduce((a, b) => a + b, 0) / given.length) * 10) / 10 : null
}

function handleProbation({ req, route, url, json, user, state, send }) {
  const method = req.method
  const notFound = () => send(404, { detail: 'Not found' })
  const forbidden = () => send(403, { detail: 'Probation evaluations are only available to managers and HR.' })
  const hr = has(user, 'HRAdmin')
  if (!hr && !has(user, 'Manager')) return forbidden()
  const evaluatorOf = (e) => USERS.find((u) => u.user_id === e.evaluator_id)
  const mine = (e) => e.evaluator_id === user.user_id
  const visible = (e) => hr || mine(e)
  const eligibleIds = () => (hr ? Object.keys(BRIEF).filter((id) => id !== user.employee_id) : Object.keys(MANAGER_OF).filter((id) => MANAGER_OF[id] === user.employee_id))
  const out = (e) => {
    const b = brief(e.employee_id)
    const mgr = managerOf(e.employee_id)
    const canEdit = e.status === 'draft' && mine(e)
    return {
      evaluation_id: e.evaluation_id,
      status: e.status,
      employee: { employee_id: b.employee_id, name: b.name, position: b.job_title, department: b.department },
      manager: mgr ? { employee_id: mgr, name: brief(mgr).name } : null,
      evaluator: { user_id: e.evaluator_id, name: evaluatorOf(e)?.name ?? null },
      review_date: e.review_date,
      ratings: e.ratings,
      strengths: e.strengths,
      development_comments: e.development_comments,
      development_rows: e.development_rows,
      summary: e.summary,
      recommendation: e.recommendation,
      extension: e.extension,
      average: average(e),
      created_at: e.created_at,
      updated_at: e.updated_at,
      submitted_at: e.submitted_at,
      submitted_by_name: e.submitted_by_name,
      can_edit: canEdit,
      can_submit: canEdit,
      can_reopen: hr && e.status === 'submitted',
      can_delete: e.status === 'draft' && (mine(e) || hr),
    }
  }
  const listItem = (e) => {
    const f = out(e)
    return { evaluation_id: f.evaluation_id, employee: f.employee, manager: f.manager, evaluator: f.evaluator, review_date: f.review_date, status: f.status, recommendation: f.recommendation, average: f.average, updated_at: f.updated_at, submitted_at: f.submitted_at }
  }
  const field = (name, msg) => send(422, { detail: 'Invalid request', errors: [{ loc: ['body', name], msg }] })

  if (route === '/performance/probation/form' && method === 'GET') return send(200, PROBATION_FORM)
  if (route === '/performance/probation/eligible' && method === 'GET') {
    const ids = state.probationEligible ?? eligibleIds()
    const items = ids.map((id) => ({ employee_id: id, name: brief(id).name, job_title: brief(id).job_title, department: brief(id).department, start_date: '2026-08-03' }))
    return send(200, { items })
  }
  if (route === '/performance/probation' && method === 'GET') {
    let list = state.probation.filter(visible)
    const st = url.searchParams.get('status')
    if (st) list = list.filter((e) => e.status === st)
    const q = (url.searchParams.get('q') || '').trim().toLowerCase()
    if (q) list = list.filter((e) => (brief(e.employee_id).name || '').toLowerCase().includes(q))
    const emp = url.searchParams.get('employee_id')
    if (emp) list = list.filter((e) => e.employee_id === emp)
    list = [...list].sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    return send(200, { items: list.map(listItem), total: list.length })
  }
  if (route === '/performance/probation' && method === 'POST') {
    if (!eligibleIds().includes(json.employee_id)) return forbidden()
    if (state.probation.some((e) => e.employee_id === json.employee_id && e.status === 'draft' && mine(e))) return send(409, { detail: 'You already have a draft evaluation for this person.', code: 'open_draft_exists' })
    const e = makeEvaluation({ employee_id: json.employee_id, evaluator_id: user.user_id, review_date: json.review_date ?? isoToday(state) })
    state.probation.push(e)
    return send(201, out(e))
  }
  const m = route.match(/^\/performance\/probation\/([^/]+)(?:\/(submit|reopen|pdf))?$/)
  if (!m) return notFound()
  const e = state.probation.find((x) => x.evaluation_id === m[1])
  if (!e || !visible(e)) return notFound()
  const sub = m[2]
  if (!sub && method === 'GET') return send(200, out(e))
  if (!sub && method === 'DELETE') {
    if (e.status !== 'draft') return send(409, { detail: 'Only a draft can be deleted.', code: 'not_draft' })
    state.probation = state.probation.filter((x) => x !== e)
    return send(204)
  }
  if (!sub && method === 'PATCH') {
    if (e.status !== 'draft' || !mine(e)) return send(409, { detail: 'This evaluation is no longer a draft you can edit.', code: 'not_draft' })
    for (const [k, v] of Object.entries(json.ratings ?? {})) {
      if (!PROBATION_KEYS.includes(k)) continue
      if (v.rating !== null && v.rating !== undefined && !(Number.isInteger(v.rating) && v.rating >= 1 && v.rating <= 5)) return field(k, 'Input should be between 1 and 5')
      if (typeof v.comments === 'string' && v.comments.length > 2000) return field(k, 'String should have at most 2000 characters')
    }
    for (const k of ['strengths', 'development_comments', 'summary']) if (typeof json[k] === 'string' && json[k].length > 2000) return field(k, 'String should have at most 2000 characters')
    for (const [k, v] of Object.entries(json.ratings ?? {})) if (PROBATION_KEYS.includes(k)) e.ratings[k] = { rating: v.rating ?? null, comments: v.comments ?? '' }
    for (const k of ['review_date', 'strengths', 'development_comments', 'development_rows', 'summary', 'recommendation', 'extension']) if (k in json) e[k] = json[k]
    e.updated_at = new Date().toISOString()
    return send(200, out(e))
  }
  if (sub === 'submit' && method === 'POST') {
    if (e.status !== 'draft' || !mine(e)) return send(409, { detail: 'This evaluation is no longer a draft you can submit.', code: 'not_draft' })
    const missing = []
    for (const k of PROBATION_KEYS) if (!Number.isInteger(e.ratings[k]?.rating)) missing.push(`ratings.${k}`)
    if (!e.summary.trim()) missing.push('summary')
    if (!e.recommendation) missing.push('recommendation')
    if (e.recommendation === 'extend') for (const k of ['reasons', 'objectives', 'review_date']) if (!String(e.extension[k] ?? '').trim()) missing.push(`extension.${k}`)
    if (state.probationForceMissing) missing.push(...state.probationForceMissing)
    if (missing.length) return send(422, { detail: 'The evaluation is not complete.', code: 'incomplete', details: { missing } })
    Object.assign(e, { status: 'submitted', submitted_at: new Date().toISOString(), submitted_by_name: user.name, updated_at: new Date().toISOString() })
    return send(200, out(e))
  }
  if (sub === 'reopen' && method === 'POST') {
    if (!hr) return forbidden()
    if (e.status !== 'submitted') return send(409, { detail: 'Only a submitted evaluation can be reopened.', code: 'not_submitted' })
    Object.assign(e, { status: 'draft', submitted_at: null, submitted_by_name: null, updated_at: new Date().toISOString() })
    return send(200, out(e))
  }
  if (sub === 'pdf' && method === 'GET') {
    state.pdfCalls.push(e.evaluation_id)
    if (state.probationPdfStatus) return send(state.probationPdfStatus, { detail: 'The PDF is not available.' })
    const fn = `Probation Evaluation - ${brief(e.employee_id).name}.pdf`
    return send(200, { __raw: PDF_BYTES, __headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${fn}"` } })
  }
  return notFound()
}
