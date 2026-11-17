/**
 * Pure helpers for the Documents module (no DOM, no network) so they are unit tested with node --test.
 *
 * Privacy rules. The backend is the only control: every function here is a
 * presentation helper. Buttons are driven by the server's `allowed_actions`; the single role hint is `visibleTabs`,
 * which only decides which tabs to OFFER (the server still answers 403 for HR routes).
 */
import { formatDate } from '@/lib/dates'

export { formatDate }

export type Tone = 'neutral' | 'blue' | 'amber' | 'violet' | 'green' | 'red'
export type TabId = 'mine' | 'policies' | 'hr'
export type HrSection = 'employees' | 'expiring' | 'publish' | 'coverage' | 'types'

export const MAX_FILE_MB = 10
export const ALLOWED_EXTENSIONS = ['pdf', 'png', 'jpg', 'jpeg', 'docx', 'xlsx'] as const
export const FILE_HINT = `PDF, PNG, JPEG, DOCX or XLSX, up to ${MAX_FILE_MB} MB`
export const ACCEPT_ATTR = '.pdf,.png,.jpg,.jpeg,.docx,.xlsx'

export const PRIVACY_NOTE =
  'Your personal documents are visible to you and to HR only. Managers do not see them.'
export const HR_ONLY_NOTE = 'Document types marked "HR only" are visible to HR only - not even the person they belong to.'

// ---------------------------------------------------------------------------------------------------- tabs
/** Which tabs to offer. Navigation hint only: the HR routes answer 403 for anyone else. */
export function visibleTabs(roles: readonly string[] | undefined | null): TabId[] {
  const tabs: TabId[] = ['mine', 'policies']
  if (roles?.includes('HRAdmin')) tabs.push('hr')
  return tabs
}

export const TAB_LABEL: Record<TabId, string> = { mine: 'My documents', policies: 'Policies', hr: 'HR' }

export function parseTab(value: string | null | undefined, allowed: readonly TabId[]): TabId {
  return allowed.find((t) => t === value) ?? 'mine'
}

export const HR_SECTIONS: readonly { id: HrSection; label: string }[] = [
  { id: 'employees', label: 'Employee documents' },
  { id: 'expiring', label: 'Expiring' },
  { id: 'publish', label: 'Publish policies' },
  { id: 'coverage', label: 'Acknowledgement coverage' },
  { id: 'types', label: 'Document types' },
]

export function parseSection(value: string | null | undefined): HrSection {
  return HR_SECTIONS.find((s) => s.id === value)?.id ?? 'employees'
}

// ---------------------------------------------------------------------------------------------------- expiry
export interface Badge {
  tone: Tone
  label: string
  /** Short machine word for tests and styling. */
  kind: 'expired' | 'expiring' | 'valid' | 'none'
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

/** The expiry badge shown on a document. `state` and `daysLeft` come from the server (expiring = today..today+30). */
export function expiryBadge(state: string | null | undefined, daysLeft: number | null | undefined): Badge {
  if (state === 'expired') {
    const ago = typeof daysLeft === 'number' ? Math.abs(daysLeft) : null
    return { tone: 'red', kind: 'expired', label: ago ? `Expired ${plural(ago, 'day')} ago` : 'Expired' }
  }
  if (state === 'expiring') {
    if (daysLeft === 0) return { tone: 'amber', kind: 'expiring', label: 'Expires today' }
    return { tone: 'amber', kind: 'expiring', label: typeof daysLeft === 'number' ? `Expires in ${plural(daysLeft, 'day')}` : 'Expiring soon' }
  }
  if (state === 'valid') return { tone: 'green', kind: 'valid', label: 'Valid' }
  return { tone: 'neutral', kind: 'none', label: 'No expiry' }
}

export interface ExpirySummary {
  expired: number
  expiring: number
}

export function summariseExpiry(items: readonly { expiry_state?: string | null }[]): ExpirySummary {
  let expired = 0
  let expiring = 0
  for (const i of items) {
    if (i.expiry_state === 'expired') expired += 1
    else if (i.expiry_state === 'expiring') expiring += 1
  }
  return { expired, expiring }
}

export function expirySummaryText(s: ExpirySummary): string | null {
  const parts: string[] = []
  if (s.expired) parts.push(`${plural(s.expired, 'document')} expired`)
  if (s.expiring) parts.push(`${plural(s.expiring, 'document')} expiring within 30 days`)
  return parts.length ? parts.join(', ') : null
}

// ---------------------------------------------------------------------------------------------------- files
export function formatBytes(n: number | null | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

const TYPE_LABELS: Record<string, string> = {
  'application/pdf': 'PDF',
  'image/png': 'PNG',
  'image/jpeg': 'JPEG',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLSX',
}

export function typeLabel(contentType: string | null | undefined): string {
  return (contentType && TYPE_LABELS[contentType]) || contentType || 'File'
}

export function extensionOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i < 0 ? '' : name.slice(i + 1).toLowerCase()
}

/**
 * A client-side HINT about a chosen file ("PDF/PNG/JPEG/DOCX/XLSX up to 10 MB"). It never blocks an upload:
 * the server checks the real bytes, type and size and is the only authority.
 */
export function fileHint(file: { name: string; size: number } | null | undefined): string | null {
  if (!file) return null
  if (file.size === 0) return 'This file looks empty. The service will refuse an empty file.'
  const ext = extensionOf(file.name)
  if (!(ALLOWED_EXTENSIONS as readonly string[]).includes(ext)) return `".${ext || '?'}" is not one of the accepted types (${FILE_HINT}). The service will check the real file.`
  if (file.size > MAX_FILE_MB * 1024 * 1024) return `This file is ${formatBytes(file.size)}; the limit is ${MAX_FILE_MB} MB. The service will refuse it.`
  return null
}

// ---------------------------------------------------------------------------------------------------- validation
const ISO = /^\d{4}-\d{2}-\d{2}$/

export function isIsoDate(v: string): boolean {
  if (!ISO.test(v)) return false
  const [y, m, d] = v.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d && y >= 2000 && y <= 2100
}

export type FieldErrors = Record<string, string>

export interface UploadInput {
  typeId: string
  title: string
  expiresOn: string
  expiryRequired: boolean
  file: unknown | null
}

export function validateUpload(i: UploadInput): FieldErrors {
  const e: FieldErrors = {}
  if (!i.typeId) e.type = 'Choose a document type.'
  const t = i.title.trim()
  if (!t) e.title = 'Enter a title.'
  else if (t.length > 120) e.title = 'The title can be at most 120 characters.'
  if (i.expiresOn && !isIsoDate(i.expiresOn)) e.expires_on = 'Enter a valid expiry date.'
  else if (i.expiryRequired && !i.expiresOn) e.expires_on = 'This type needs an expiry date.'
  if (!i.file) e.file = 'Choose a file to upload.'
  return e
}

export interface VersionInput {
  expiresOn: string
  expiryRequired: boolean
  file: unknown | null
}

export function validateVersion(i: VersionInput): FieldErrors {
  const e: FieldErrors = {}
  if (i.expiresOn && !isIsoDate(i.expiresOn)) e.expires_on = 'Enter a valid expiry date.'
  else if (i.expiryRequired && !i.expiresOn) e.expires_on = 'This type needs an expiry date for the new version.'
  if (!i.file) e.file = 'Choose the new file.'
  return e
}

export interface PolicyInput {
  title: string
  summary: string
  effectiveDate: string
  file: unknown | null
  /** A new version may leave the title empty (it keeps the previous one). */
  titleOptional?: boolean
}

export function validatePolicy(i: PolicyInput): FieldErrors {
  const e: FieldErrors = {}
  const t = i.title.trim()
  if (!t && !i.titleOptional) e.title = 'Enter a title.'
  else if (t.length > 120) e.title = 'The title can be at most 120 characters.'
  if (i.summary.trim().length > 1000) e.summary = 'The summary can be at most 1000 characters.'
  if (!i.effectiveDate) e.effective_date = 'Enter the effective date.'
  else if (!isIsoDate(i.effectiveDate)) e.effective_date = 'Enter a valid effective date.'
  if (!i.file) e.file = 'Choose the policy file.'
  return e
}

export function validateTypeName(name: string): string | null {
  const t = name.trim()
  if (!t) return 'Enter a name.'
  if (t.length > 60) return 'The name can be at most 60 characters.'
  return null
}

// ---------------------------------------------------------------------------------------------------- errors
export interface ServerErrorInfo {
  status: number | null
  detail: string
  fieldErrors: FieldErrors
}

/** Client-safe text only: a long or non-string server detail is replaced by the fallback. */
export function parseServerError(err: unknown, fallback = 'Something went wrong. Please try again.'): ServerErrorInfo {
  const e = err as { response?: { status?: number; data?: Record<string, unknown> } } | null
  const status = e?.response?.status ?? null
  const data = e?.response?.data ?? {}
  let detail = typeof data.detail === 'string' && data.detail.trim() && data.detail.length < 300 ? data.detail : fallback
  const fieldErrors: FieldErrors = {}
  if (Array.isArray(data.errors)) {
    for (const item of data.errors as { loc?: unknown[]; msg?: unknown }[]) {
      const key = Array.isArray(item.loc) ? String(item.loc[item.loc.length - 1] ?? '') : ''
      if (key && typeof item.msg === 'string' && !fieldErrors[key]) fieldErrors[key] = item.msg
    }
    if (detail === 'Invalid request' && Object.keys(fieldErrors).length) detail = 'Please check the highlighted fields.'
  }
  if (status === null) detail = 'The service could not be reached. Please try again.'
  return { status, detail, fieldErrors }
}

/** Upload failures always say nothing was stored. */
export function uploadErrorText(err: unknown): string {
  const info = parseServerError(err, 'The file could not be uploaded.')
  if (info.status === 413) return `That file is too large (the limit is ${MAX_FILE_MB} MB). Nothing was stored.`
  if (info.status === 415) return `${info.detail} Nothing was stored.`
  if (info.status === 400 || info.status === 422) return `${info.detail} Nothing was stored.`
  if (info.status === null) return `${info.detail} Nothing was stored.`
  return info.detail
}

export function hasAction(actions: readonly string[] | undefined | null, action: string): boolean {
  return Boolean(actions?.includes(action))
}

// ---------------------------------------------------------------------------------------------------- misc formatting
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '-'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function formatPct(pct: number | null | undefined): string {
  return typeof pct === 'number' && Number.isFinite(pct) ? `${Math.round(pct * 10) / 10}%` : 'No data'
}

/** "Page 2 of 5" style range text. */
export function rangeText(page: number, pageSize: number, total: number): string {
  if (total === 0) return '0 results'
  const from = (page - 1) * pageSize + 1
  const to = Math.min(total, page * pageSize)
  return `${from}-${to} of ${total}`
}

export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / Math.max(1, pageSize)))
}

/** Policy deep link used by the notification `policy.published`: /documents/policies/{id}. */
export function policyLink(policyId: string): string {
  return `/documents/policies/${encodeURIComponent(policyId)}`
}
