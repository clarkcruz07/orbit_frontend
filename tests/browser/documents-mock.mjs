// In-browser MOCK of /documents/** and /hrcases/** for the self-contained UI specs (documents-ui, hrcases-ui and the
// responsive sweep). The shell/auth mock (mock-api.mjs `startMock`) serves dist and the sign-in routes; this module only
// intercepts the module routes through `page.route`, so no shared mock file is edited. All data is fictional.
// Mock users (from mock-api.mjs): u-anna HRAdmin EMP-0001, u-ben Manager EMP-0002, u-carla Employee EMP-0003, u-dan Finance EMP-0004.

export const NOW = new Date('2026-11-16T10:00:00Z')
const DAY = 86400000
export const isoDay = (offsetDays) => new Date(NOW.getTime() + offsetDays * DAY).toISOString().slice(0, 10)
const at = (offsetMinutes = 0) => new Date(NOW.getTime() + offsetMinutes * 60000).toISOString()

const USERS = {
  'u-anna': { user_id: 'u-anna', name: 'Anna Reyes', employee_id: 'EMP-0001', department: 'People & Culture', job_title: 'HR Administrator', hr: true },
  'u-ben': { user_id: 'u-ben', name: 'Ben Cruz', employee_id: 'EMP-0002', department: 'Operations', job_title: 'Operations Manager', hr: false },
  'u-carla': { user_id: 'u-carla', name: 'Carla Dizon', employee_id: 'EMP-0003', department: 'Compliance', job_title: 'Compliance Analyst', hr: false },
  'u-dan': { user_id: 'u-dan', name: 'Dan Ocampo', employee_id: 'EMP-0004', department: 'Finance', job_title: 'Finance Officer', hr: false },
}
const EMP_NAMES = Object.fromEntries(Object.values(USERS).map((u) => [u.employee_id, u]))

const file = (filename, size = 48213, content_type = 'application/pdf') => ({ filename, content_type, size_bytes: size, sha256: 'f'.repeat(64) })

export function createState() {
  const types = [
    { type_id: 'ty-id', name: 'Identification', description: 'Government-issued ID (placeholder).', expiry_required: true, hr_only: false, active: true, placeholder: true },
    { type_id: 'ty-contract', name: 'Contract', description: 'Employment contract (placeholder).', expiry_required: false, hr_only: false, active: true, placeholder: true },
    { type_id: 'ty-cert', name: 'Certification', description: 'Training certificate (placeholder).', expiry_required: true, hr_only: false, active: true, placeholder: true },
    { type_id: 'ty-hr', name: 'Disciplinary record', description: 'Visible to HR only.', expiry_required: false, hr_only: true, active: true, placeholder: false },
    { type_id: 'ty-old', name: 'Old form', description: '', expiry_required: false, hr_only: false, active: false, placeholder: false },
  ]
  const ver = (version, expires_on, filename, by = USERS['u-carla'], minutes = -60 * 24 * 30) => ({
    version,
    status: 'superseded',
    expires_on,
    file: file(filename),
    uploaded_by: { user_id: by.user_id, name: by.name },
    uploaded_at: at(minutes),
  })
  const doc = (id, empId, typeId, title, versions) => ({ doc_id: id, employee_id: empId, type_id: typeId, title, versions, created_at: versions[versions.length - 1].uploaded_at })
  const docs = [
    doc('d-expired', 'EMP-0003', 'ty-cert', 'First aid certificate', [ver(1, isoDay(-40), 'first-aid.pdf')]),
    doc('d-soon', 'EMP-0003', 'ty-id', 'Passport copy', [ver(1, isoDay(12), 'passport.png')]),
    doc('d-valid', 'EMP-0003', 'ty-cert', 'Compliance training certificate', [ver(1, isoDay(300), 'compliance.pdf')]),
    doc('d-none', 'EMP-0003', 'ty-contract', 'Employment contract', [ver(1, null, 'contract-2024.pdf'), ver(2, null, 'contract-2026.pdf', USERS['u-anna'], -60 * 24 * 3)]),
    doc('d-hr', 'EMP-0003', 'ty-hr', 'HR file note', [ver(1, null, 'note.pdf', USERS['u-anna'])]),
    doc('d-other', 'EMP-0004', 'ty-id', 'Dan ID card', [ver(1, isoDay(5), 'dan-id.png', USERS['u-dan'])]),
  ]
  const policy = (id, title, summary, versions, acks = {}) => ({ policy_id: id, versions, acks })
  const pv = (version, title, summary, effective, filename) => ({ version, title, summary, effective_date: effective, published_at: at(-60 * 24 * (10 - version)), file: file(filename), published_by: { user_id: 'u-anna', name: 'Anna Reyes' } })
  const policies = [
    policy('p-remote', 'Remote work guidelines', 'When and how people may work remotely. Placeholder text, not company policy.', [pv(1, 'Remote work guidelines', 'When and how people may work remotely. Placeholder text, not company policy.', isoDay(-20), 'remote-v1.pdf'), pv(2, 'Remote work guidelines', 'Updated expectations for core hours. Placeholder text.', isoDay(-2), 'remote-v2.pdf')], { 1: { 'EMP-0003': at(-60 * 24 * 8) } }),
    policy('p-conduct', 'Code of conduct', 'How we treat each other and our clients. Placeholder text.', [pv(1, 'Code of conduct', 'How we treat each other and our clients. Placeholder text.', isoDay(-60), 'conduct.pdf')], { 1: { 'EMP-0003': at(-60 * 24 * 30), 'EMP-0001': at(-60 * 24 * 31) } }),
  ]
  const caseTypes = [
    { type_id: 'ct-coe', name: 'Certificate of employment', description: 'Ask HR for a certificate of employment.', default_priority: 'low', active: true, placeholder: true },
    { type_id: 'ct-equip', name: 'Equipment', description: 'Laptops, monitors and other equipment.', default_priority: 'medium', active: true, placeholder: true },
    { type_id: 'ct-pay', name: 'Payslip / benefit question', description: 'Inquiry only - no pay data in this system.', default_priority: 'medium', active: true, placeholder: true },
    { type_id: 'ct-gen', name: 'General inquiry', description: 'Anything else.', default_priority: 'low', active: true, placeholder: true },
  ]
  const msg = (id, who, role, text, minutes, attachment = null, desc = false) => ({
    message_id: id,
    by: { user_id: who.user_id, name: who.name, role },
    at: at(minutes),
    text,
    is_description: desc,
    attachment,
  })
  const mkCase = (id, empId, typeId, subject, priority, status, messages, extra = {}) => ({
    case_id: id,
    employee_id: empId,
    type_id: typeId,
    subject,
    priority,
    status,
    assignee: null,
    messages,
    created_at: messages[0].at,
    updated_at: messages[messages.length - 1].at,
    resolved_at: null,
    closed_at: null,
    version: 1,
    ...extra,
  })
  const carla = USERS['u-carla']
  const anna = USERS['u-anna']
  const cases = [
    mkCase('c-laptop', 'EMP-0003', 'ct-equip', 'Replacement laptop charger', 'high', 'in_progress', [
      msg('m1', carla, 'employee', 'My charger stopped working this week. Please could I get a replacement? It is the 65W USB-C model.', -60 * 30, { attachment_id: 'a1', filename: 'charger-photo.png', content_type: 'image/png', size_bytes: 20480, sha256: 'a'.repeat(64) }, true),
      msg('m2', anna, 'hr', 'Thanks Carla - I have ordered one. It should arrive on Friday.', -60 * 20),
    ], { assignee: { user_id: 'u-anna', name: 'Anna Reyes' } }),
    mkCase('c-coe', 'EMP-0003', 'ct-coe', 'Certificate of employment for a visa application', 'low', 'waiting_on_employee', [
      msg('m3', carla, 'employee', 'I need a certificate of employment for a visa application.', -60 * 50, null, true),
      msg('m4', anna, 'hr', 'Which country is the visa for, and by which date do you need it?', -60 * 45),
    ], { assignee: { user_id: 'u-anna', name: 'Anna Reyes' } }),
    mkCase('c-done', 'EMP-0003', 'ct-gen', 'Question about the office opening hours', 'low', 'resolved', [
      msg('m5', carla, 'employee', 'Are the office hours changing in December?', -60 * 100, null, true),
      msg('m6', anna, 'hr', 'No change - the hours stay the same.', -60 * 90),
    ], { resolved_at: at(-60 * 90) }),
    mkCase('c-closed', 'EMP-0003', 'ct-gen', 'Old question', 'low', 'closed', [msg('m7', carla, 'employee', 'An old question.', -60 * 400, null, true)], { closed_at: at(-60 * 300) }),
    mkCase('c-dan', 'EMP-0004', 'ct-pay', 'Benefit statement line', 'medium', 'open', [msg('m8', USERS['u-dan'], 'employee', 'I have a question about a line on my benefit statement.', -60 * 5, null, true)]),
  ]
  const eligible = Object.values(USERS).map((u) => ({ employee_id: u.employee_id, name: u.name, department: u.department }))
  return { now: NOW, types, docs, policies, caseTypes, cases, eligible, people: {}, forced: {}, delay: {}, log: [], seq: 100 }
}

// ------------------------------------------------------------------------------------------------ views
function expiryOf(expiresOn, now) {
  if (!expiresOn) return { expiry_state: null, days_left: null }
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const days = Math.round((Date.parse(expiresOn + 'T00:00:00Z') - today) / DAY)
  return { expiry_state: days < 0 ? 'expired' : days <= 30 ? 'expiring' : 'valid', days_left: days }
}

function viewDoc(state, d, user, detail) {
  const cur = d.versions[d.versions.length - 1]
  const type = state.types.find((t) => t.type_id === d.type_id)
  const emp = state.people[d.employee_id] ?? EMP_NAMES[d.employee_id]
  const out = {
    doc_id: d.doc_id,
    employee_id: d.employee_id,
    employee: emp ? { employee_id: emp.employee_id, name: emp.name, department: emp.department, job_title: emp.job_title } : null,
    type: { type_id: type.type_id, name: type.name, hr_only: type.hr_only, expiry_required: type.expiry_required },
    title: d.title,
    status: 'active',
    version: cur.version,
    version_count: d.versions.length,
    expires_on: cur.expires_on,
    ...expiryOf(cur.expires_on, state.now),
    file: cur.file,
    uploaded_by: cur.uploaded_by,
    uploaded_at: cur.uploaded_at,
    created_at: d.created_at,
    updated_at: cur.uploaded_at,
    allowed_actions: ['download', 'add_version', 'edit'],
  }
  if (detail) out.versions = [...d.versions].reverse().map((v) => ({ ...v, status: v.version === cur.version ? 'active' : 'superseded' }))
  return out
}

function visibleDocs(state, user) {
  return state.docs.filter((d) => {
    const hrOnly = state.types.find((t) => t.type_id === d.type_id).hr_only
    return user.hr || (d.employee_id === user.employee_id && !hrOnly)
  })
}

function viewPolicy(state, p, user, detail) {
  const cur = p.versions[p.versions.length - 1]
  const ack = p.acks[cur.version]?.[user.employee_id] ?? null
  const actions = ['download']
  if (!ack) actions.push('acknowledge')
  if (user.hr) actions.push('publish_version', 'view_coverage')
  const out = {
    policy_id: p.policy_id,
    title: cur.title,
    summary: cur.summary,
    version: cur.version,
    effective_date: cur.effective_date,
    published_at: cur.published_at,
    file: cur.file,
    acknowledged: Boolean(ack),
    acknowledged_at: ack,
    version_count: p.versions.length,
    created_at: p.versions[0].published_at,
    updated_at: cur.published_at,
    allowed_actions: actions,
  }
  if (user.hr) out.published_by = cur.published_by
  if (detail) out.versions = (user.hr ? [...p.versions].reverse() : [cur]).map((v) => ({ ...v, status: v.version === cur.version ? 'active' : 'superseded' }))
  return out
}

const NEXT = {
  open: ['in_progress', 'waiting_on_employee', 'resolved'],
  in_progress: ['waiting_on_employee', 'resolved'],
  waiting_on_employee: ['in_progress', 'resolved'],
  resolved: ['in_progress', 'closed'],
  closed: [],
}

function viewCase(state, c, user, detail) {
  const type = state.caseTypes.find((t) => t.type_id === c.type_id)
  const emp = state.people[c.employee_id] ?? EMP_NAMES[c.employee_id]
  const owner = c.employee_id === user.employee_id
  const statuses = user.hr ? NEXT[c.status] : owner && c.status === 'resolved' ? ['closed'] : []
  const actions = []
  if (c.status !== 'closed') {
    actions.push('reply')
    if (user.hr) actions.push('set_status', 'set_priority', 'assign')
    if (!user.hr && statuses.includes('closed')) actions.push('close')
    if (user.hr && statuses.includes('closed') && owner) actions.push('close')
  }
  const last = c.messages[c.messages.length - 1]
  const out = {
    case_id: c.case_id,
    employee: emp ? { employee_id: emp.employee_id, name: emp.name, department: emp.department, job_title: emp.job_title } : null,
    type: { type_id: type.type_id, name: type.name },
    subject: c.subject,
    priority: c.priority,
    status: c.status,
    assignee: c.assignee,
    message_count: c.messages.length,
    last_message_at: last.at,
    last_message_role: last.by.role,
    created_at: c.created_at,
    updated_at: c.updated_at,
    resolved_at: c.resolved_at,
    closed_at: c.closed_at,
    version: c.version,
    allowed_actions: actions,
    allowed_statuses: statuses,
  }
  if (detail) {
    out.description = c.messages[0].text
    out.messages = c.messages
  }
  return out
}

// ------------------------------------------------------------------------------------------------ multipart
function parseMultipart(request) {
  const ct = request.headers()['content-type'] || ''
  const boundary = /boundary=(.+)$/.exec(ct)?.[1]
  const buf = request.postDataBuffer()
  if (!boundary || !buf) return {}
  const out = {}
  for (const part of buf.toString('latin1').split(`--${boundary}`)) {
    const m = /^\r\nContent-Disposition: form-data; name="([^"]+)"(?:; filename="([^"]*)")?\r\n(?:Content-Type: ([^\r\n]+)\r\n)?\r\n([\s\S]*?)\r\n$/.exec(part)
    if (!m) continue
    out[m[1]] = m[2] !== undefined ? { filename: m[2], type: m[3] ?? '', size: m[4].length } : m[4]
  }
  return out
}

// ------------------------------------------------------------------------------------------------ installer
const json = (route, status, body) => route.fulfill({ status, contentType: 'application/json', body: body === undefined ? '' : JSON.stringify(body) })
const notFound = (route, what) => json(route, 404, { detail: `${what} not found` })

/** Intercepts /api/documents/** and /api/hrcases/** for `page`. `state.forced['METHOD /path']` = {status, body} forces a response. */
export async function installModuleMock(page, state) {
  await page.route(/\/api\/(documents|hrcases)\//, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const method = request.method()
    const path = url.pathname.replace(/^\/api/, '')
    state.log.push(`${method} ${path}${url.search}`)
    const token = (request.headers().authorization || '').replace(/^Bearer /, '')
    const user = USERS[token.replace(/^acc-/, '')]
    if (!user) return json(route, 401, { detail: 'Not authenticated' })
    const forced = state.forced[`${method} ${path}`]
    const wait = state.delay[`${method} ${path}`]
    if (wait) await new Promise((r) => setTimeout(r, wait))
    if (forced) return json(route, forced.status, forced.body ?? { detail: 'Server error' })
    const q = url.searchParams
    const page_ = Math.max(1, Number(q.get('page') || 1))
    const size = Math.min(50, Number(q.get('page_size') || 20))
    const paged = (all) => ({ items: all.slice((page_ - 1) * size, page_ * size), total: all.length, page: page_, page_size: size })
    const forbidden = () => json(route, 403, { detail: 'You do not have access to this resource' })
    let m

    // ---- document types
    if (path === '/documents/types') {
      if (method === 'GET') {
        if (q.get('include_inactive') === 'true' && !user.hr) return forbidden()
        const items = state.types.filter((t) => (user.hr ? q.get('include_inactive') === 'true' || t.active : t.active && !t.hr_only))
        return json(route, 200, { items })
      }
      if (method === 'POST') {
        if (!user.hr) return forbidden()
        const b = JSON.parse(request.postData() || '{}')
        if (state.types.some((t) => t.name.toLowerCase() === String(b.name).toLowerCase())) return json(route, 409, { detail: 'A type with this name already exists' })
        const t = { type_id: `ty-${++state.seq}`, name: b.name, description: b.description || '', expiry_required: Boolean(b.expiry_required), hr_only: Boolean(b.hr_only), active: true, placeholder: false }
        state.types.push(t)
        return json(route, 201, t)
      }
    }
    if ((m = /^\/documents\/types\/([^/]+)$/.exec(path))) {
      if (!user.hr) return forbidden()
      const t = state.types.find((x) => x.type_id === m[1])
      if (!t) return notFound(route, 'Type')
      if (method === 'PATCH') {
        Object.assign(t, JSON.parse(request.postData() || '{}'))
        return json(route, 200, t)
      }
      if (method === 'DELETE') {
        if (state.docs.some((d) => d.type_id === t.type_id)) return json(route, 409, { detail: 'Type is in use' })
        state.types.splice(state.types.indexOf(t), 1)
        return json(route, 204)
      }
    }

    // ---- employee documents
    if (path === '/documents/employee' && method === 'GET') {
      const emp = q.get('employee_id')
      if (emp && emp !== user.employee_id && !user.hr) return forbidden()
      let list = visibleDocs(state, user)
      if (emp) list = list.filter((d) => d.employee_id === emp)
      if (q.get('type_id')) list = list.filter((d) => d.type_id === q.get('type_id'))
      return json(route, 200, paged(list.map((d) => viewDoc(state, d, user, false))))
    }
    if (path === '/documents/employee' && method === 'POST') {
      const f = parseMultipart(request)
      if (state.forced.nextUpload) {
        const x = state.forced.nextUpload
        state.forced.nextUpload = null
        return json(route, x.status, { detail: x.detail })
      }
      const type = state.types.find((t) => t.type_id === f.type_id)
      if (!type) return json(route, 422, { detail: 'Unknown document type' })
      if (type.expiry_required && !f.expires_on) return json(route, 422, { detail: 'This document type requires an expiry date' })
      const empId = f.employee_id || user.employee_id
      if (empId !== user.employee_id && !user.hr) return forbidden()
      const d = { doc_id: `d-${++state.seq}`, employee_id: empId, type_id: type.type_id, title: f.title, created_at: at(0), versions: [{ version: 1, expires_on: f.expires_on || null, file: file(f.file?.filename || 'upload.pdf', f.file?.size ?? 1000), uploaded_by: { user_id: user.user_id, name: user.name }, uploaded_at: at(0) }] }
      state.docs.unshift(d)
      return json(route, 201, viewDoc(state, d, user, true))
    }
    if ((m = /^\/documents\/employee\/([^/]+)(\/.*)?$/.exec(path))) {
      const d = visibleDocs(state, user).find((x) => x.doc_id === m[1])
      if (!d) return notFound(route, 'Document')
      const rest = m[2] || ''
      if (rest === '' && method === 'GET') return json(route, 200, viewDoc(state, d, user, true))
      if (rest === '' && method === 'PATCH') {
        const b = JSON.parse(request.postData() || '{}')
        const cur = d.versions[d.versions.length - 1]
        if (b.version !== undefined && b.version !== cur.version) return json(route, 409, { detail: 'The document changed' })
        if (b.title) d.title = b.title
        if (b.expires_on) cur.expires_on = b.expires_on
        if (b.clear_expiry) cur.expires_on = null
        return json(route, 200, viewDoc(state, d, user, true))
      }
      if (rest === '/versions' && method === 'POST') {
        const f = parseMultipart(request)
        const type = state.types.find((t) => t.type_id === d.type_id)
        if (type.expiry_required && !f.expires_on) return json(route, 422, { detail: 'This document type requires an expiry date' })
        if (state.forced.nextUpload) {
          const x = state.forced.nextUpload
          state.forced.nextUpload = null
          return json(route, x.status, { detail: x.detail })
        }
        d.versions.push({ version: d.versions.length + 1, expires_on: f.expires_on || null, file: file(f.file?.filename || 'upload.pdf', f.file?.size ?? 1000), uploaded_by: { user_id: user.user_id, name: user.name }, uploaded_at: at(0) })
        return json(route, 201, viewDoc(state, d, user, true))
      }
      if (/^(\/versions\/\d+)?\/file$/.test(rest) && method === 'GET') {
        return route.fulfill({ status: 200, contentType: 'application/pdf', headers: { 'Content-Disposition': 'attachment; filename="doc.pdf"' }, body: '%PDF-1.4 mock' })
      }
    }

    // ---- expiring
    if (path === '/documents/expiring' && method === 'GET') {
      const days = Number(q.get('days') || 30)
      const includeExpired = q.get('include_expired') === 'true'
      const mine = user.hr ? state.docs : visibleDocs(state, user)
      const list = mine
        .map((d) => viewDoc(state, d, user, false))
        .filter((d) => d.days_left !== null && d.days_left <= days && (includeExpired || d.days_left >= 0))
        .sort((a, b) => a.expires_on.localeCompare(b.expires_on))
      return json(route, 200, { ...paged(list), days, today: state.now.toISOString().slice(0, 10) })
    }

    // ---- policies
    if (path === '/documents/policies' && method === 'GET') return json(route, 200, { items: state.policies.map((p) => viewPolicy(state, p, user, false)) })
    if (path === '/documents/policies' && method === 'POST') {
      if (!user.hr) return forbidden()
      const f = parseMultipart(request)
      if (state.forced.nextUpload) {
        const x = state.forced.nextUpload
        state.forced.nextUpload = null
        return json(route, x.status, { detail: x.detail })
      }
      const p = { policy_id: `p-${++state.seq}`, acks: {}, versions: [{ version: 1, title: f.title, summary: f.summary || '', effective_date: f.effective_date, published_at: at(0), file: file(f.file?.filename || 'policy.pdf'), published_by: { user_id: user.user_id, name: user.name } }] }
      state.policies.push(p)
      return json(route, 201, viewPolicy(state, p, user, true))
    }
    if (path === '/documents/policies/coverage' && method === 'GET') {
      if (!user.hr) return forbidden()
      const rows = state.policies.map((p) => {
        const cur = p.versions[p.versions.length - 1]
        const n = Object.keys(p.acks[cur.version] || {}).length
        return { policy_id: p.policy_id, title: cur.title, version: cur.version, acknowledged_count: n, outstanding_count: state.eligible.length - n, pct: Math.round((n / state.eligible.length) * 1000) / 10 }
      })
      return json(route, 200, { eligible_count: state.eligible.length, overall_pct: rows.length ? Math.round((rows.reduce((a, r) => a + r.acknowledged_count, 0) / (rows.length * state.eligible.length)) * 1000) / 10 : null, policies: rows })
    }
    if ((m = /^\/documents\/policies\/([^/]+)(\/.*)?$/.exec(path))) {
      const p = state.policies.find((x) => x.policy_id === m[1])
      if (!p) return notFound(route, 'Policy')
      const rest = m[2] || ''
      const cur = p.versions[p.versions.length - 1]
      if (rest === '' && method === 'GET') return json(route, 200, viewPolicy(state, p, user, true))
      if (rest === '/acknowledge' && method === 'POST') {
        const b = JSON.parse(request.postData() || '{}')
        if (b.version !== cur.version) return json(route, 409, { detail: 'Read the new version' })
        p.acks[cur.version] = p.acks[cur.version] || {}
        p.acks[cur.version][user.employee_id] = p.acks[cur.version][user.employee_id] || at(0)
        return json(route, 201, { policy_id: p.policy_id, version: cur.version, acknowledged_at: p.acks[cur.version][user.employee_id] })
      }
      if (rest === '/versions' && method === 'POST') {
        if (!user.hr) return forbidden()
        const f = parseMultipart(request)
        p.versions.push({ version: cur.version + 1, title: f.title || cur.title, summary: f.summary || cur.summary, effective_date: f.effective_date, published_at: at(0), file: file(f.file?.filename || 'policy.pdf'), published_by: { user_id: user.user_id, name: user.name } })
        return json(route, 201, viewPolicy(state, p, user, true))
      }
      if (/^(\/versions\/\d+)?\/file$/.test(rest) && method === 'GET') return route.fulfill({ status: 200, contentType: 'application/pdf', body: '%PDF-1.4 mock' })
      if (rest === '/coverage' && method === 'GET') {
        if (!user.hr) return forbidden()
        const acks = p.acks[cur.version] || {}
        const ackedIds = Object.keys(acks)
        return json(route, 200, {
          policy_id: p.policy_id,
          title: cur.title,
          version: cur.version,
          is_current: true,
          eligible_count: state.eligible.length,
          acknowledged_count: ackedIds.length,
          outstanding_count: state.eligible.length - ackedIds.length,
          pct: Math.round((ackedIds.length / state.eligible.length) * 1000) / 10,
          acknowledged: state.eligible.filter((e) => acks[e.employee_id]).map((e) => ({ ...e, acknowledged_at: acks[e.employee_id] })),
          outstanding: state.eligible.filter((e) => !acks[e.employee_id]),
        })
      }
    }

    // ---- HR cases
    if (path === '/hrcases/types' && method === 'GET') return json(route, 200, { items: state.caseTypes.filter((t) => t.active) })
    if (path === '/hrcases/cases' && method === 'GET') {
      const scope = q.get('scope') || 'mine'
      if (scope === 'queue' && !user.hr) return forbidden()
      let list = scope === 'queue' ? state.cases : state.cases.filter((c) => c.employee_id === user.employee_id)
      const st = q.get('status')
      if (st === 'active') list = list.filter((c) => ['open', 'in_progress', 'waiting_on_employee'].includes(c.status))
      else if (st) list = list.filter((c) => c.status === st)
      if (q.get('priority')) list = list.filter((c) => c.priority === q.get('priority'))
      if (q.get('type_id')) list = list.filter((c) => c.type_id === q.get('type_id'))
      if (q.get('assignee') === 'me') list = list.filter((c) => c.assignee?.user_id === user.user_id)
      if (q.get('assignee') === 'unassigned') list = list.filter((c) => !c.assignee)
      list = [...list].sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      return json(route, 200, paged(list.map((c) => viewCase(state, c, user, false))))
    }
    if (path === '/hrcases/cases' && method === 'POST') {
      const f = parseMultipart(request)
      if (state.forced.nextUpload) {
        const x = state.forced.nextUpload
        state.forced.nextUpload = null
        return json(route, x.status, { detail: x.detail })
      }
      const type = state.caseTypes.find((t) => t.type_id === f.type_id)
      if (!type) return json(route, 422, { detail: 'Unknown request type' })
      const c = {
        case_id: `c-${++state.seq}`,
        employee_id: user.employee_id,
        type_id: type.type_id,
        subject: f.subject,
        priority: f.priority || type.default_priority,
        status: 'open',
        assignee: null,
        created_at: at(0),
        updated_at: at(0),
        resolved_at: null,
        closed_at: null,
        version: 1,
        messages: [{ message_id: `m-${++state.seq}`, by: { user_id: user.user_id, name: user.name, role: 'employee' }, at: at(0), text: f.description, is_description: true, attachment: f.file?.filename ? { attachment_id: 'at', filename: f.file.filename, content_type: f.file.type, size_bytes: f.file.size, sha256: 'b'.repeat(64) } : null }],
      }
      state.cases.unshift(c)
      return json(route, 201, viewCase(state, c, user, true))
    }
    if ((m = /^\/hrcases\/cases\/([^/]+)(\/.*)?$/.exec(path))) {
      const c = state.cases.find((x) => x.case_id === m[1])
      if (!c || (!user.hr && c.employee_id !== user.employee_id)) return notFound(route, 'Case')
      const rest = m[2] || ''
      if (rest === '' && method === 'GET') return json(route, 200, viewCase(state, c, user, true))
      const body = () => JSON.parse(request.postData() || '{}')
      const stale = (b) => b.version !== undefined && b.version !== c.version
      if (rest === '/messages' && method === 'POST') {
        if (c.status === 'closed') return json(route, 409, { detail: 'This case is closed' })
        const f = parseMultipart(request)
        c.messages.push({ message_id: `m-${++state.seq}`, by: { user_id: user.user_id, name: user.name, role: user.hr && c.employee_id !== user.employee_id ? 'hr' : 'employee' }, at: at(5), text: f.text, is_description: false, attachment: f.file?.filename ? { attachment_id: 'at', filename: f.file.filename, content_type: f.file.type, size_bytes: f.file.size, sha256: 'c'.repeat(64) } : null })
        if (f.status && user.hr) c.status = f.status
        else if (!user.hr && ['waiting_on_employee', 'resolved'].includes(c.status)) c.status = 'in_progress'
        c.updated_at = at(5)
        c.version += 1
        return json(route, 201, viewCase(state, c, user, true))
      }
      if (rest === '/status' && method === 'POST') {
        const b = body()
        if (stale(b)) return json(route, 409, { detail: 'The case changed' })
        if (!viewCase(state, c, user, false).allowed_statuses.includes(b.status)) return json(route, user.hr ? 409 : 403, { detail: 'That status is not allowed' })
        c.status = b.status
        if (b.status === 'resolved') c.resolved_at = at(0)
        if (b.status === 'closed') c.closed_at = at(0)
        c.version += 1
        return json(route, 200, viewCase(state, c, user, true))
      }
      if (rest === '' && method === 'PATCH') {
        if (!user.hr) return forbidden()
        const b = body()
        if (stale(b)) return json(route, 409, { detail: 'The case changed' })
        c.priority = b.priority
        c.version += 1
        return json(route, 200, viewCase(state, c, user, true))
      }
      if (rest === '/assign' && method === 'POST') {
        if (!user.hr) return forbidden()
        const b = body()
        if (stale(b)) return json(route, 409, { detail: 'The case changed' })
        c.assignee = b.assignee_user_id ? { user_id: b.assignee_user_id, name: USERS[b.assignee_user_id]?.name ?? 'HR' } : null
        c.version += 1
        return json(route, 200, viewCase(state, c, user, true))
      }
      if (/^\/messages\/[^/]+\/attachment$/.test(rest) && method === 'GET') return route.fulfill({ status: 200, contentType: 'application/pdf', body: '%PDF-1.4 mock' })
    }
    return json(route, 404, { detail: 'Not found' })
  })
}
