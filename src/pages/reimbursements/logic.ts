/**
 * Pure helpers for the Reimbursements screens (no DOM, no network) so they are unit tested with node --test.
 *
 * PLACEHOLDER WORKFLOW (not company policy). The backend is the only control: every function here is a
 * presentation helper. Permissions in the UI come from the server's `allowed_actions`, never from a role name;
 * the single exception is `availableScopes`, a navigation hint for which list tabs to offer (the server still
 * answers 403 for a scope the caller may not use).
 */

export type ReimbursementStatus =
  | 'draft'
  | 'pending_manager'
  | 'pending_finance'
  | 'approved'
  | 'rejected'
  | 'clarification_requested'

export type FieldKey = 'merchant' | 'receipt_date' | 'currency' | 'total_amount' | 'tax_amount' | 'receipt_reference'
export type FieldSource = 'extracted' | 'entered' | 'edited' | 'empty'
export type Scope = 'mine' | 'review' | 'all'
export type AllowedAction = 'edit' | 'upload' | 'submit' | 'approve' | 'reject' | 'clarify'

export const STATUS_ORDER: readonly ReimbursementStatus[] = [
  'draft',
  'clarification_requested',
  'pending_manager',
  'pending_finance',
  'approved',
  'rejected',
]

export type Tone = 'neutral' | 'blue' | 'amber' | 'violet' | 'green' | 'red'

const STATUS_META: Record<ReimbursementStatus, { label: string; tone: Tone; hint: string }> = {
  draft: { label: 'Draft', tone: 'neutral', hint: 'Not submitted yet' },
  pending_manager: { label: 'Pending manager', tone: 'blue', hint: 'Waiting for the manager' },
  pending_finance: { label: 'Pending finance', tone: 'violet', hint: 'Waiting for Finance' },
  approved: { label: 'Approved', tone: 'green', hint: 'Approved for reimbursement - nothing is paid or posted by this system' },
  rejected: { label: 'Rejected', tone: 'red', hint: 'Rejected by a reviewer' },
  clarification_requested: { label: 'Clarification requested', tone: 'amber', hint: 'A reviewer asked for more information' },
}

export function statusLabel(status: string): string {
  return (STATUS_META as Record<string, { label: string }>)[status]?.label ?? status
}
export function statusTone(status: string): Tone {
  return (STATUS_META as Record<string, { tone: Tone }>)[status]?.tone ?? 'neutral'
}
export function statusHint(status: string): string {
  return (STATUS_META as Record<string, { hint: string }>)[status]?.hint ?? ''
}

// ---------------------------------------------------------------------------------------------------- scopes
/** Which list tabs to offer. A navigation hint only: the backend enforces scopes (403) and never trusts this. */
export function availableScopes(roles: readonly string[] | undefined | null): Scope[] {
  const has = (r: string) => Boolean(roles?.includes(r))
  const scopes: Scope[] = ['mine']
  if (has('Manager') || has('Finance')) scopes.push('review')
  if (has('Manager') || has('HRAdmin') || has('Finance')) scopes.push('all')
  return scopes
}

export const SCOPE_LABEL: Record<Scope, string> = {
  mine: 'My requests',
  review: 'Awaiting my review',
  all: 'All requests',
}

export function parseScope(value: string | null | undefined, allowed: readonly Scope[]): Scope {
  return allowed.find((s) => s === value) ?? 'mine'
}

// ---------------------------------------------------------------------------------------------------- provenance
export const FIELD_KEYS: readonly FieldKey[] = ['merchant', 'receipt_date', 'currency', 'total_amount', 'tax_amount', 'receipt_reference']

export interface FieldDef {
  key: FieldKey
  label: string
  kind: 'text' | 'date' | 'select' | 'money'
  /** Required to submit (the server checks the same four). */
  required: boolean
}

export const FIELD_DEFS: readonly FieldDef[] = [
  { key: 'merchant', label: 'Merchant', kind: 'text', required: true },
  { key: 'receipt_date', label: 'Receipt date', kind: 'date', required: true },
  { key: 'currency', label: 'Currency', kind: 'select', required: true },
  { key: 'total_amount', label: 'Total amount', kind: 'money', required: true },
  { key: 'tax_amount', label: 'Tax amount', kind: 'money', required: false },
  { key: 'receipt_reference', label: 'Receipt reference', kind: 'text', required: false },
]

export function fieldLabel(key: string): string {
  return FIELD_DEFS.find((f) => f.key === key)?.label ?? (key === 'receipt' ? 'Receipt' : key)
}

/** Below this the "Low confidence" badge shows. Presentation only; the value is never changed by it. */
export const LOW_CONFIDENCE = 0.7

export function isLowConfidence(confidence: number | null | undefined): boolean {
  return typeof confidence === 'number' && confidence < LOW_CONFIDENCE
}

export function confidenceLabel(confidence: number | null | undefined): string {
  return typeof confidence === 'number' ? `${Math.round(confidence * 100)}% confidence` : 'No confidence reported'
}

export function sourceLabel(source: FieldSource, hasExtraction: boolean): string {
  switch (source) {
    case 'extracted':
      return 'Extracted'
    case 'edited':
      return 'Edited by you'
    case 'entered':
      return 'Entered by you'
    default:
      return hasExtraction ? 'Not found' : 'Not entered'
  }
}

/** Same wording as the reviewer-facing column: who produced the final value. */
export function sourceLabelForReviewer(source: FieldSource): string {
  switch (source) {
    case 'extracted':
      return 'Extracted'
    case 'edited':
      return 'Edited by employee'
    case 'entered':
      return 'Entered by employee'
    default:
      return 'Empty'
  }
}

export const FLAG_TEXT: Record<string, string> = {
  invalid_merchant: 'The merchant could not be read reliably.',
  invalid_date: 'The date could not be read reliably.',
  date_out_of_range: 'The date is outside the accepted range.',
  invalid_amount: 'The total could not be read reliably.',
  invalid_tax: 'The tax amount could not be read reliably.',
  tax_exceeds_total: 'The tax amount is larger than the total.',
  invalid_currency: 'The currency is not recognised or not allowed.',
  invalid_reference: 'The receipt reference could not be read reliably.',
}

export function flagText(flag: string | null | undefined): string | null {
  if (!flag) return null
  return FLAG_TEXT[flag] ?? 'The extracted value was not accepted.'
}

// ---------------------------------------------------------------------------------------------------- extraction errors
const EXTRACTION_ERRORS: Record<string, string> = {
  unsupported_file: "This file type can't be read automatically.",
  unreadable_receipt: "We couldn't read this receipt automatically. It may be blurred, cropped or not a receipt.",
  invalid_model_output: "The receipt reader returned something we couldn't trust, so nothing was filled in.",
  provider_timeout: 'The receipt reader took too long to respond.',
  provider_rate_limited: 'The receipt reader is busy right now.',
  provider_unavailable: 'The receipt reader is not available right now.',
  provider_not_configured: "Automatic reading isn't set up in this environment.",
  extraction_disabled: 'Automatic reading is turned off in this environment.',
}

export function extractionErrorText(code: string | null | undefined): string {
  if (code && EXTRACTION_ERRORS[code]) return EXTRACTION_ERRORS[code]
  return "We couldn't read this receipt automatically."
}

export const MANUAL_ENTRY_TEXT = 'You can type the details yourself below. Your receipt is saved either way.'

// ---------------------------------------------------------------------------------------------------- decisions / audit
export function decisionLabel(action: string): string {
  if (action === 'approve') return 'Approved'
  if (action === 'reject') return 'Rejected'
  if (action === 'clarify') return 'Asked for clarification'
  return action
}

export function stageLabel(stage: string | null | undefined): string {
  if (stage === 'manager') return 'Manager review'
  if (stage === 'finance') return 'Finance review'
  return ''
}

export function decisionTone(action: string): Tone {
  return action === 'approve' ? 'green' : action === 'reject' ? 'red' : 'amber'
}

const AUDIT_LABELS: Record<string, string> = {
  'reimbursement.created': 'Draft created',
  'reimbursement.updated': 'Draft saved',
  'reimbursement.receipt_uploaded': 'Receipt uploaded',
  'reimbursement.extraction_completed': 'Values suggested from the receipt',
  'reimbursement.extraction_failed': 'Automatic reading failed',
  'reimbursement.submitted': 'Submitted for review',
  'reimbursement.decided': 'Decision recorded',
  'reimbursement.receipt_downloaded': 'Receipt viewed or downloaded',
}

export function auditLabel(event: { action: string; details?: Record<string, unknown> | null }): string {
  const base = AUDIT_LABELS[event.action] ?? event.action
  if (event.action === 'reimbursement.decided') {
    const a = event.details?.action
    const stage = event.details?.stage
    const verb = typeof a === 'string' ? decisionLabel(a) : 'Decision recorded'
    const where = typeof stage === 'string' && stageLabel(stage) ? ` (${stageLabel(stage)})` : ''
    return `${verb}${where}`
  }
  if (event.action === 'reimbursement.submitted') {
    const to = event.details?.to_status
    if (typeof to === 'string') return `Submitted - now ${statusLabel(to).toLowerCase()}`
  }
  return base
}

// ---------------------------------------------------------------------------------------------------- formatting
export function formatMoney(currency: string | null | undefined, amount: string | number | null | undefined): string {
  if (amount === null || amount === undefined || amount === '') return '-'
  const n = Number(amount)
  if (!Number.isFinite(n)) return String(amount)
  const text = n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return currency ? `${currency} ${text}` : text
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '-'
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return iso
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const month = months[Number(m[2]) - 1]
  return month ? `${Number(m[3])} ${month} ${m[1]}` : iso
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '-'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function formatBytes(n: number | null | undefined): string {
  if (typeof n !== 'number') return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

export function typeLabel(contentType: string): string {
  if (contentType === 'application/pdf') return 'PDF'
  if (contentType === 'image/png') return 'PNG'
  if (contentType === 'image/jpeg') return 'JPEG'
  if (contentType === 'image/webp') return 'WebP'
  return contentType
}

/** "PNG, JPEG, WebP or PDF, up to 10 MB" from /reimbursements/config. A hint only: the server validates for real. */
export function uploadHint(allowedTypes: readonly string[], maxMb: number): string {
  const names = [...allowedTypes].map(typeLabel)
  const order = ['PNG', 'JPEG', 'WebP', 'PDF']
  names.sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99))
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}` : names[0] ?? 'a receipt file'
  return `${list}, up to ${maxMb} MB`
}

// ---------------------------------------------------------------------------------------------------- counts
export function countByStatus(items: readonly { status: string }[]): Record<ReimbursementStatus, number> {
  const out: Record<ReimbursementStatus, number> = {
    draft: 0,
    clarification_requested: 0,
    pending_manager: 0,
    pending_finance: 0,
    approved: 0,
    rejected: 0,
  }
  for (const it of items) if (it.status in out) out[it.status as ReimbursementStatus] += 1
  return out
}

// ---------------------------------------------------------------------------------------------------- form validation
export const MAX_PURPOSE = 200
export const MAX_NOTES = 2000
export const MAX_COMMENT = 2000

const MONEY_MAX = 9_999_999.99

/** Mirror of the server rules, for early feedback. The server stays authoritative. Returns an error text or null. */
export function validateMoney(text: string): string | null {
  const t = text.trim()
  if (!t) return null
  const m = /^(\d{1,3}(,\d{3})+|\d+)(\.\d{1,2})?$/.exec(t)
  if (!m) return 'Enter an amount like 1250 or 1,250.50 (up to 2 decimals).'
  const n = Number(t.replace(/,/g, ''))
  if (!Number.isFinite(n) || n < 0 || n > MONEY_MAX) return 'The amount must be between 0 and 9,999,999.99.'
  return null
}

export function parseMoney(text: string): number | null {
  const t = text.trim()
  if (!t || validateMoney(t)) return null
  return Number(t.replace(/,/g, ''))
}

export function isValidIsoDate(text: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const dt = new Date(Date.UTC(y, mo - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d
}

export function validateDate(text: string, today: Date = new Date()): string | null {
  const t = text.trim()
  if (!t) return null
  if (!isValidIsoDate(t)) return 'Enter a valid date.'
  if (t < '2000-01-01') return 'The date cannot be before 1 January 2000.'
  const limit = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate() + 1)).toISOString().slice(0, 10)
  if (t > limit) return 'The date cannot be in the future.'
  return null
}

/** Client-side check of one field. `allowedCurrencies` empty means "do not check". */
export function validateField(key: FieldKey, text: string, allowedCurrencies: readonly string[] = [], today: Date = new Date()): string | null {
  const t = text.trim()
  if (!t) return null
  switch (key) {
    case 'merchant':
      // eslint-disable-next-line no-control-regex
      if (t.length > 120 || /[\u0000-\u001f\u007f]/.test(t)) return 'Merchant can be up to 120 characters.'
      return null
    case 'receipt_date':
      return validateDate(t, today)
    case 'currency':
      if (allowedCurrencies.length && !allowedCurrencies.includes(t.toUpperCase())) return 'Choose one of the listed currencies.'
      return null
    case 'total_amount':
    case 'tax_amount':
      return validateMoney(t)
    case 'receipt_reference':
      if (!/^[A-Za-z0-9][A-Za-z0-9._/# -]{0,63}$/.test(t)) return 'Use up to 64 letters, numbers or . _ / # - and start with a letter or number.'
      return null
  }
}

export type FormTexts = Record<FieldKey, string>

export function validateForm(texts: FormTexts, allowedCurrencies: readonly string[] = [], today: Date = new Date()): Partial<Record<FieldKey, string>> {
  const errors: Partial<Record<FieldKey, string>> = {}
  for (const def of FIELD_DEFS) {
    const err = validateField(def.key, texts[def.key], allowedCurrencies, today)
    if (err) errors[def.key] = err
  }
  const total = parseMoney(texts.total_amount)
  const tax = parseMoney(texts.tax_amount)
  if (!errors.tax_amount && total !== null && tax !== null && tax > total) errors.tax_amount = 'The tax amount is larger than the total.'
  return errors
}

/** Required values still empty. Used to explain the submit button, not to hide it. */
export function missingRequired(texts: FormTexts): FieldKey[] {
  return FIELD_DEFS.filter((d) => d.required && !texts[d.key].trim()).map((d) => d.key)
}

// ---------------------------------------------------------------------------------------------------- form <-> server
export interface FieldStateLike {
  value: string | null
  source: FieldSource
  extracted_value: string | null
  confidence: number | null
  flag: string | null
}

export function textsFromFields(fields: Record<FieldKey, FieldStateLike>): FormTexts {
  const out = {} as FormTexts
  for (const k of FIELD_KEYS) out[k] = fields[k]?.value ?? ''
  return out
}

function sameValue(key: FieldKey, a: string, b: string): boolean {
  if (key === 'total_amount' || key === 'tax_amount') {
    const x = parseMoney(a)
    const y = parseMoney(b)
    if (x !== null && y !== null) return x === y
  }
  if (key === 'currency') return a.trim().toUpperCase() === b.trim().toUpperCase()
  return a.trim() === b.trim()
}

/** What the badge will say once saved, computed live from the text in the box. */
export function liveSource(key: FieldKey, text: string, field: FieldStateLike): FieldSource {
  const t = text.trim()
  const ev = field.extracted_value
  if (!t) return ev !== null && ev !== undefined ? 'edited' : 'empty'
  if (ev === null || ev === undefined) return 'entered'
  return sameValue(key, t, ev) ? 'extracted' : 'edited'
}

/** Only the fields whose text differs from the saved value; cleared boxes become null. */
export function buildFieldsPatch(texts: FormTexts, saved: FormTexts): Partial<Record<FieldKey, string | null>> {
  const patch: Partial<Record<FieldKey, string | null>> = {}
  for (const k of FIELD_KEYS) {
    if (texts[k].trim() !== saved[k].trim()) patch[k] = texts[k].trim() === '' ? null : texts[k].trim()
  }
  return patch
}

// ---------------------------------------------------------------------------------------------------- server errors
export interface ServerErrorInfo {
  status: number | null
  detail: string
  fieldErrors: Partial<Record<string, string>>
  missingFields: string[]
  confirmRequired: boolean
}

/** Normalises an axios-style error into what the screens need. Never exposes raw network text. */
export function parseServerError(err: unknown, fallback = 'Something went wrong. Please try again.'): ServerErrorInfo {
  const e = err as { response?: { status?: number; data?: Record<string, unknown> } } | null
  const status = e?.response?.status ?? null
  const data = e?.response?.data ?? {}
  const detail = typeof data.detail === 'string' && data.detail.trim() && data.detail.length < 300 ? data.detail : fallback
  const fe = data.field_errors
  const fieldErrors: Partial<Record<string, string>> = {}
  if (fe && typeof fe === 'object') {
    for (const [k, v] of Object.entries(fe as Record<string, unknown>)) if (typeof v === 'string') fieldErrors[k] = v
  }
  const missingFields = Array.isArray(data.missing_fields) ? (data.missing_fields as unknown[]).filter((x): x is string => typeof x === 'string') : []
  return { status, detail, fieldErrors, missingFields, confirmRequired: data.confirm_required === true }
}

export function hasAction(actions: readonly string[] | undefined, action: AllowedAction): boolean {
  return Boolean(actions?.includes(action))
}

/** Editor mode is driven only by the server's allowed_actions. */
export function isEditorMode(actions: readonly string[] | undefined): boolean {
  return hasAction(actions, 'edit') || hasAction(actions, 'upload') || hasAction(actions, 'submit')
}

export function isReviewerMode(actions: readonly string[] | undefined): boolean {
  return hasAction(actions, 'approve') || hasAction(actions, 'reject') || hasAction(actions, 'clarify')
}
