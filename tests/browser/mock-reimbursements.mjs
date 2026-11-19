// Deterministic MOCK of the Reimbursements routes (SPEC section 7 + backend/DECISIONS.md shapes). Fictional data only.
// Every behaviour the UI tests need is a flag on `state.reimb`; allowed_actions are set per request and per user so a
// test can force exactly what the server "decided" (the UI must follow it, never role names).
import { randomUUID } from 'node:crypto'
import { PAY_NORMAL, paydayFor } from './mock-payday.mjs'

// 1x1 transparent PNG, served as the "receipt file".
export const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

const KEYS = ['merchant', 'receipt_date', 'currency', 'total_amount', 'tax_amount', 'receipt_reference']

export function blankField() {
  return { value: null, source: 'empty', extracted_value: null, confidence: null, flag: null }
}

export function blankFields() {
  return Object.fromEntries(KEYS.map((k) => [k, blankField()]))
}

/** Extraction scenarios used by the upload route. Values mirror the synthetic fixtures. */
export const SCENARIOS = {
  full: {
    status: 'ok',
    error_code: null,
    fields: {
      merchant: ['Cafe Lumina (SYNTHETIC)', 0.97],
      receipt_date: ['2026-10-12', 0.95],
      currency: ['PHP', 0.99],
      total_amount: ['1250.00', 0.98],
      tax_amount: ['133.93', 0.9],
      receipt_reference: ['SYN-0001', 0.93],
    },
  },
  partial: {
    status: 'partial',
    error_code: null,
    fields: {
      merchant: ['Fictional Print Shop (SYNTHETIC)', 0.94],
      receipt_date: [null, null],
      currency: ['PHP', 0.99],
      total_amount: ['540.00', 0.96],
      tax_amount: ['57.86', 0.87],
      receipt_reference: [null, null],
    },
  },
  lowconf: {
    status: 'ok',
    error_code: null,
    fields: {
      merchant: ['Demo Hardware Mart (SYNTHETIC)', 0.9],
      receipt_date: ['2026-10-22', 0.9],
      currency: ['PHP', 0.98],
      total_amount: ['980.00', 0.41],
      tax_amount: ['95.36', 0.6],
      receipt_reference: ['SYN-0006', 0.85],
    },
  },
  failed: { status: 'failed', error_code: 'unreadable_receipt', fields: {} },
}

function applyScenario(request, scenarioName) {
  const sc = SCENARIOS[scenarioName] ?? SCENARIOS.full
  for (const k of KEYS) {
    const [value, confidence] = sc.fields[k] ?? [null, null]
    const cur = request.fields[k]
    cur.extracted_value = value
    cur.confidence = confidence
    cur.flag = null
    if (sc.status === 'failed') continue
    if ((cur.source === 'edited' || cur.source === 'entered') && cur.value !== null) {
      cur.source = cur.value === value ? 'extracted' : 'edited'
    } else {
      cur.value = value
      cur.source = value !== null ? 'extracted' : 'empty'
    }
  }
  request.extraction = {
    status: sc.status,
    provider: 'demo',
    model_label: 'demo-deterministic',
    error_code: sc.error_code,
    receipt_id: request.receipts.find((r) => r.is_current)?.receipt_id,
    completed_at: new Date().toISOString(),
  }
}

export function makeRequest(over = {}) {
  const now = new Date().toISOString()
  const r = {
    request_id: randomUUID(),
    employee_id: 'EMP-0003',
    employee: { employee_id: 'EMP-0003', name: 'Carla Dizon', department: 'Compliance', job_title: 'Compliance Analyst' },
    status: 'draft',
    stage: null,
    purpose: 'Client lunch',
    fields: blankFields(),
    notes: null,
    receipts: [],
    extraction: null,
    decisions: [],
    created_at: now,
    updated_at: now,
    submitted_at: null,
    payday: null, // {date, cutoff, deferred, submitted_on} once submitted
    version: 1,
    // user_id -> allowed_actions for that user. Owner defaults are set by `forOwner`.
    allowed: {},
    // user ids (besides the owner) who may see it; others get 404.
    visibleTo: [],
    audit: [],
    ...over,
  }
  return r
}

export function receiptMeta(over = {}) {
  return {
    receipt_id: randomUUID(),
    filename: 'receipt-1.png',
    content_type: 'image/png',
    size_bytes: TINY_PNG.length,
    sha256: 'a'.repeat(64),
    uploaded_at: new Date().toISOString(),
    uploaded_by: 'u-carla',
    is_current: true,
    ...over,
  }
}

export function createReimbState() {
  return {
    requests: [],
    config: {
      max_receipt_mb: 10,
      allowed_types: ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'],
      allowed_currencies: ['PHP', 'USD', 'AUD', 'EUR', 'GBP', 'SGD', 'NZD', 'JPY', 'CAD', 'HKD'],
      ocr: { provider: 'demo', model_label: 'demo-deterministic', enabled: true },
      policy_notice: 'Placeholder workflow for demonstration - not company policy. Approved means approved for reimbursement only: no payment or accounting entry is made by this system.',
      pay_calendar: PAY_NORMAL, // swap for PAY_DEFERRED / PAY_LAST_DAY (or null) in a test
    },
    uploadDelayMs: 0,
    uploadScenario: 'full', // full | partial | lowconf | failed
    uploadReject: null, // {status, detail} to refuse the next upload (nothing stored)
    patchConflictOnce: false,
    patchFieldErrors: null, // {field: message} -> 422
    submitError: null, // {status, body}
    decisionError: null, // {status, body}
    listError: null, // status code
    auditError: false,
    fileRequests: [], // {url, authorization}
    patches: [], // bodies received
    submits: [],
    decisions: [],
    uploads: [], // {filename}
  }
}

function view(request, user) {
  const { allowed, visibleTo, audit, ...pub } = request
  const own = request.employee_id === user.employee_id
  const actions = allowed[user.user_id] ?? (own && ['draft', 'clarification_requested'].includes(request.status) ? ['edit', 'upload', 'submit'] : [])
  return { ...pub, allowed_actions: actions }
}

function summary(request, user) {
  const v = view(request, user)
  const f = request.fields
  return {
    request_id: v.request_id,
    employee_id: v.employee_id,
    employee_name: v.employee.name,
    department: v.employee.department,
    purpose: v.purpose,
    status: v.status,
    stage: v.stage,
    merchant: f.merchant.value,
    receipt_date: f.receipt_date.value,
    currency: f.currency.value,
    total_amount: f.total_amount.value,
    submitted_at: v.submitted_at,
    payday: v.payday ?? null,
    created_at: v.created_at,
    updated_at: v.updated_at,
    version: v.version,
    allowed_actions: v.allowed_actions,
  }
}

export function canSeeRequest(request, user) {
  return canSee(request, user)
}

function canSee(request, user) {
  return request.employee_id === user.employee_id || request.visibleTo.includes(user.user_id) || Boolean(request.allowed[user.user_id])
}

function normaliseField(key, raw) {
  if (raw === null || raw === undefined || String(raw).trim() === '') return null
  const t = String(raw).trim()
  if (key === 'total_amount' || key === 'tax_amount') return Number(t.replace(/,/g, '')).toFixed(2)
  if (key === 'currency') return t.toUpperCase()
  return t
}

/** Returns true when the route was handled. `ctx` = {req, res, route, method, url, json, raw, user, state, send}. */
export function handleReimbursements(ctx) {
  const { route, method, url, json, raw, user, state, send, res } = ctx
  if (!route.startsWith('/reimbursements')) return false
  const rs = state.reimb
  if (!user) return send(res, 401, { detail: 'Not authenticated' }) || true

  if (route === '/reimbursements/config' && method === 'GET') return send(res, 200, rs.config) || true

  if (route === '/reimbursements' && method === 'GET') {
    if (rs.listError) return send(res, rs.listError, { detail: 'Server error' }) || true
    const scope = url.searchParams.get('scope') || 'mine'
    const status = url.searchParams.get('status')
    const roles = user.roles
    if (scope === 'review' && !(roles.includes('Manager') || roles.includes('Finance'))) return send(res, 403, { detail: 'You do not have access to this list' }) || true
    if (scope === 'all' && roles.length === 1 && roles[0] === 'Employee') return send(res, 403, { detail: 'You do not have access to this list' }) || true
    let list = rs.requests.filter((r) => {
      if (scope === 'mine') return r.employee_id === user.employee_id
      if (scope === 'review') return canSee(r, user) && (r.allowed[user.user_id] || []).includes('approve')
      return canSee(r, user)
    })
    if (status) list = list.filter((r) => r.status === status)
    list = [...list].sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))
    return send(res, 200, list.map((r) => summary(r, user))) || true
  }

  if (route === '/reimbursements/export' && method === 'GET') {
    const scope = url.searchParams.get('scope') || 'mine'
    const status = url.searchParams.get('status')
    rs.exports = [...(rs.exports ?? []), { scope, status }]
    if (rs.exportError) return send(res, rs.exportError, { detail: 'Server error' }) || true
    res.writeHead(200, { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': 'attachment; filename="reimbursements-test.xlsx"' })
    res.end(Buffer.from('PK\u0003\u0004 fake workbook for the browser test'))
    return true
  }

  if (route === '/reimbursements' && method === 'POST') {
    const purpose = String(json.purpose || '').trim()
    if (!purpose) return send(res, 422, { detail: 'A purpose is required' }) || true
    const r = makeRequest({
      purpose,
      employee_id: user.employee_id,
      employee: { employee_id: user.employee_id, name: user.name, department: user.department, job_title: user.job_title },
    })
    rs.requests.push(r)
    return send(res, 201, view(r, user)) || true
  }

  const m = route.match(/^\/reimbursements\/([^/]+)(?:\/(receipts|extract|submit|decision|audit))?(?:\/([^/]+)\/file)?$/)
  if (!m) return send(res, 404, { detail: 'Not found' }) || true
  const [, id, sub, receiptId] = m
  const r = rs.requests.find((x) => x.request_id === id)
  if (!r || !canSee(r, user)) return send(res, 404, { detail: 'Not found' }) || true
  const own = r.employee_id === user.employee_id
  const mine = () => (r.allowed[user.user_id] ?? (own && ['draft', 'clarification_requested'].includes(r.status) ? ['edit', 'upload', 'submit'] : []))

  if (!sub && !receiptId && method === 'GET') return send(res, 200, view(r, user)) || true

  if (!sub && method === 'PATCH') {
    if (!mine().includes('edit')) return send(res, 409, { detail: 'This request can no longer be edited' }) || true
    rs.patches.push(json)
    if (rs.patchConflictOnce) {
      rs.patchConflictOnce = false
      r.version += 1
      r.purpose = `${r.purpose} (changed elsewhere)`
      return send(res, 409, { detail: 'This request was changed by someone else. Reload and try again.' }) || true
    }
    if (json.version !== undefined && json.version !== r.version) return send(res, 409, { detail: 'This request was changed by someone else. Reload and try again.' }) || true
    if (rs.patchFieldErrors) return send(res, 422, { detail: 'Some values are not valid', field_errors: rs.patchFieldErrors }) || true
    if ('purpose' in json && json.purpose !== undefined) r.purpose = String(json.purpose).trim()
    if ('notes' in json) r.notes = json.notes ? String(json.notes).trim() : null
    for (const [k, raw] of Object.entries(json.fields || {})) {
      const value = normaliseField(k, raw)
      const cur = r.fields[k]
      cur.value = value
      cur.flag = null
      const ev = cur.extracted_value
      cur.source = value === null ? (ev !== null ? 'edited' : 'empty') : ev === null ? 'entered' : value === ev ? 'extracted' : 'edited'
    }
    r.version += 1
    r.updated_at = new Date().toISOString()
    return send(res, 200, view(r, user)) || true
  }

  if (sub === 'receipts' && method === 'POST') {
    if (!mine().includes('upload')) return send(res, 409, { detail: 'This request can no longer be edited' }) || true
    const filename = /filename="([^"]*)"/.exec(raw.slice(0, 2000))?.[1] ?? 'upload.bin'
    const finish = () => {
      if (rs.uploadReject) {
        const { status, detail } = rs.uploadReject
        return send(res, status, { detail })
      }
      rs.uploads.push({ filename })
      for (const x of r.receipts) x.is_current = false
      const meta = receiptMeta({ filename, uploaded_by: user.user_id })
      r.receipts.push(meta)
      applyScenario(r, rs.uploadScenario)
      r.version += 1
      r.updated_at = new Date().toISOString()
      return send(res, 201, { receipt: meta, extraction: r.extraction, request: view(r, user) })
    }
    if (rs.uploadDelayMs > 0) setTimeout(finish, rs.uploadDelayMs)
    else finish()
    return true
  }

  if (sub === 'extract' && method === 'POST') {
    if (!mine().includes('upload')) return send(res, 409, { detail: 'This request can no longer be edited' }) || true
    if (!r.receipts.length) return send(res, 422, { detail: 'Upload a receipt first' }) || true
    applyScenario(r, rs.uploadScenario)
    r.version += 1
    return send(res, 200, { receipt: r.receipts.find((x) => x.is_current), extraction: r.extraction, request: view(r, user) }) || true
  }

  if (receiptId && method === 'GET') {
    rs.fileRequests.push({ url: ctx.req.url, authorization: ctx.req.headers.authorization || '' })
    res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Disposition': 'attachment; filename="receipt.png"', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
    res.end(TINY_PNG)
    return true
  }

  if (sub === 'submit' && method === 'POST') {
    rs.submits.push(json)
    if (rs.submitError) return send(res, rs.submitError.status, rs.submitError.body) || true
    if (!mine().includes('submit')) return send(res, 409, { detail: 'This request can no longer be edited' }) || true
    if (json.confirm_fields !== true) return send(res, 422, { detail: 'Please confirm the receipt details before submitting', missing_fields: [], confirm_required: true }) || true
    r.status = 'pending_manager'
    r.stage = 'manager'
    r.submitted_at = new Date().toISOString()
    r.payday = rs.config.pay_calendar ? paydayFor(rs.config.pay_calendar) : null
    r.version += 1
    r.allowed = { ...r.allowed, [user.user_id]: [] }
    return send(res, 200, view(r, user)) || true
  }

  if (sub === 'decision' && method === 'POST') {
    rs.decisions.push(json)
    if (rs.decisionError) return send(res, rs.decisionError.status, rs.decisionError.body) || true
    const acts = mine()
    if (!acts.includes(json.action)) return send(res, 403, { detail: 'You cannot decide this request' }) || true
    if (['reject', 'clarify'].includes(json.action) && !String(json.comment || '').trim()) return send(res, 422, { detail: 'A comment is required to reject or request clarification' }) || true
    r.decisions.push({ decision_id: randomUUID(), by_user_id: user.user_id, by_name: user.name, by_role: user.roles[0], action: json.action, comment: json.comment || null, at: new Date().toISOString(), stage: r.stage })
    r.status = json.action === 'approve' ? (r.stage === 'manager' ? 'pending_finance' : 'approved') : json.action === 'reject' ? 'rejected' : 'clarification_requested'
    if (json.action === 'approve' && r.stage === 'manager') r.stage = 'finance'
    else if (json.action === 'approve') r.stage = null
    r.version += 1
    r.allowed = { ...r.allowed, [user.user_id]: [] }
    r.audit.push({ event_id: randomUUID(), at: new Date().toISOString(), actor_user_id: user.user_id, actor_roles: user.roles, action: 'reimbursement.decided', target_type: 'reimbursement', target_id: r.request_id, outcome: 'success', details: { action: json.action, stage: r.decisions.at(-1).stage, to_status: r.status } })
    return send(res, 200, view(r, user)) || true
  }

  if (sub === 'audit' && method === 'GET') {
    if (rs.auditError) return send(res, 500, { detail: 'Server error' }) || true
    return send(res, 200, r.audit) || true
  }

  return send(res, 404, { detail: 'Not found' }) || true
}

/** Fully-formed audit events for seeded requests. */
export function auditEvent(request, action, over = {}) {
  return { event_id: randomUUID(), at: new Date().toISOString(), actor_user_id: 'u-carla', actor_roles: ['Employee'], action, target_type: 'reimbursement', target_id: request.request_id, outcome: 'success', details: {}, ...over }
}
