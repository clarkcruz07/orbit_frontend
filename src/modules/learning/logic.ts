/**
 * Pure helpers for Learning & Development (no DOM, no network): labels, due-date wording, validation, error parsing.
 * No grades, costs, payments or external LMS.
 *
 * Permissions never come from here: every control is driven by the server's `allowed_actions` / 403 / 404.
 * The ONE role hint is `learningTabs`: it only decides which tabs to OFFER (navigation); the server still answers 403.
 */
import type { Course, CourseAction, CourseCreate, Delivery, Enrolment, EnrolmentAction, EnrolmentStatus, LearningConfig } from './api'

export const DEFAULT_LIMITS: LearningConfig['limits'] = {
  title_max: 120,
  description_max: 1000,
  category_max: 60,
  completion_note_max: 1000,
  duration_hours_max: 1000,
  max_certificate_mb: 10,
  max_certificates_per_enrolment: 5,
}
export const DEFAULT_CERT_TYPES = ['application/pdf', 'image/png', 'image/jpeg']

export type Tone = 'neutral' | 'blue' | 'violet' | 'amber' | 'green' | 'red'

// ------------------------------------------------------------------------------------------------ labels
export const DELIVERIES: Delivery[] = ['self_paced', 'classroom', 'online']
const DELIVERY_LABEL: Record<Delivery, string> = { self_paced: 'Self-paced', classroom: 'Classroom', online: 'Online' }
export function deliveryLabel(d: string | null | undefined): string {
  return d ? (DELIVERY_LABEL[d as Delivery] ?? d.replace(/_/g, ' ')) : '-'
}

export const STATUSES: EnrolmentStatus[] = ['assigned', 'enrolled', 'in_progress', 'completed', 'cancelled']
const STATUS_LABEL: Record<EnrolmentStatus, string> = { assigned: 'Assigned', enrolled: 'Enrolled', in_progress: 'In progress', completed: 'Completed', cancelled: 'Cancelled' }
const STATUS_TONE: Record<EnrolmentStatus, Tone> = { assigned: 'amber', enrolled: 'violet', in_progress: 'blue', completed: 'green', cancelled: 'neutral' }
export function statusLabel(s: string): string {
  return STATUS_LABEL[s as EnrolmentStatus] ?? s.replace(/_/g, ' ')
}
export function statusTone(s: string): Tone {
  return STATUS_TONE[s as EnrolmentStatus] ?? 'neutral'
}

export function confirmationLabel(e: { status: string; confirmation_status: Enrolment['confirmation_status'] }): string | null {
  if (e.status !== 'completed') return null
  if (e.confirmation_status === 'pending') return 'Waiting for confirmation'
  if (e.confirmation_status === 'confirmed') return 'Confirmed'
  if (e.confirmation_status === 'not_required') return 'Self-attested'
  return null
}
export function confirmationTone(e: Pick<Enrolment, 'confirmation_status'>): Tone {
  return e.confirmation_status === 'pending' ? 'amber' : e.confirmation_status === 'confirmed' ? 'green' : 'neutral'
}

export function durationLabel(h: number | null | undefined): string {
  if (typeof h !== 'number') return '-'
  const v = Number.isInteger(h) ? String(h) : h.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
  return `${v} ${h === 1 ? 'hour' : 'hours'}`
}

/** "Due 5 Mar 2027" plus the computed flag wording. The server computes overdue/due_soon; this only phrases them. */
export function dueText(e: Pick<Enrolment, 'due_date' | 'overdue' | 'days_overdue' | 'due_soon' | 'days_until_due' | 'status'>, fmt: (d: string | null) => string): string | null {
  if (!e.due_date) return null
  if (e.overdue) return `Due ${fmt(e.due_date)} - ${e.days_overdue === 1 ? '1 day' : `${e.days_overdue} days`} overdue`
  if (e.due_soon) {
    const n = e.days_until_due ?? 0
    return `Due ${fmt(e.due_date)} - ${n === 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`}`
  }
  return `Due ${fmt(e.due_date)}`
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
  return contentType
}

export function certHint(types: readonly string[], maxMb: number, maxFiles: number): string {
  const names = [...new Set(types.map(typeLabel))]
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}` : (names[0] ?? 'PDF')
  return `${list}, up to ${maxMb} MB, at most ${maxFiles} files per course. The service checks the real file type and size when you upload.`
}

// ------------------------------------------------------------------------------------------------ actions / tabs
export function hasAction<T extends string>(actions: readonly T[] | undefined, a: T): boolean {
  return Boolean(actions?.includes(a))
}
export const enrolmentCan = (e: Pick<Enrolment, 'allowed_actions'>, a: EnrolmentAction) => hasAction<EnrolmentAction>(e.allowed_actions, a)
export const courseCan = (c: Pick<Course, 'allowed_actions'>, a: CourseAction) => hasAction<CourseAction>(c.allowed_actions, a)

/** True when the course shows as already taken (an open or finished, non-cancelled enrolment exists). */
export function enrolmentBlurb(c: Pick<Course, 'my_enrolment'>): string | null {
  const m = c.my_enrolment
  return m ? statusLabel(m.status) : null
}

export type TabId = 'catalog' | 'mine' | 'team' | 'hr'
export const TAB_LABEL: Record<TabId, string> = { catalog: 'Catalog', mine: 'My learning', team: 'Team', hr: 'HR' }

/** Navigation hint only (which tabs to offer). The backend enforces access; see the header comment. */
export function learningTabs(roles: readonly string[] | undefined): TabId[] {
  const r = roles ?? []
  const tabs: TabId[] = ['catalog', 'mine']
  if (r.includes('Manager')) tabs.push('team')
  if (r.includes('HRAdmin')) tabs.push('hr')
  return tabs
}
export function parseTab(raw: string | null, offered: readonly TabId[]): TabId {
  return offered.find((t) => t === raw) ?? 'catalog'
}

export function isOpen(s: string): boolean {
  return s === 'assigned' || s === 'enrolled' || s === 'in_progress'
}

/** ISO date shifted by whole days, using UTC arithmetic so the viewer's time zone never matters. */
export function addDays(iso: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return iso
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days))
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

// ------------------------------------------------------------------------------------------------ validation
export type FieldErrors = Partial<Record<string, string>>
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/
const NEWLINE = /[\r\n]/

export function isIsoDate(v: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v)
  if (!m) return false
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1) return false
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)
  return d <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1]
}

/** The assignment due date: optional, a real date, not in the past (`today` is injected: the server is the authority). */
export function validateDueDate(value: string, today: string, required = false): string | null {
  const v = value.trim()
  if (!v) return required ? 'Choose a due date.' : null
  if (!isIsoDate(v)) return 'Enter a valid date.'
  if (v < today) return 'The due date cannot be in the past.'
  return null
}

export function validateAssign(input: { course_id: string; employee_id: string; due_date: string }, today: string): FieldErrors {
  const e: FieldErrors = {}
  if (!input.course_id) e.course_id = 'Choose a course.'
  if (!input.employee_id) e.employee_id = 'Choose a person.'
  const d = validateDueDate(input.due_date, today)
  if (d) e.due_date = d
  return e
}

export interface CourseForm {
  title: string
  description: string
  category: string
  duration_hours: string
  delivery: Delivery | ''
  mandatory_default: boolean
  active: boolean
}

export function emptyCourseForm(): CourseForm {
  return { title: '', description: '', category: '', duration_hours: '', delivery: 'self_paced', mandatory_default: false, active: true }
}
export function formFromCourse(c: Course): CourseForm {
  return { title: c.title, description: c.description, category: c.category, duration_hours: String(c.duration_hours), delivery: c.delivery, mandatory_default: c.mandatory_default, active: c.active }
}

/** Parses "2.5" style input: positive, at most 2 decimals, at most the limit. Returns null when invalid. */
export function parseDuration(raw: string, max = DEFAULT_LIMITS.duration_hours_max): number | null {
  const t = raw.trim()
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(t)) return null
  const n = Number(t)
  return n > 0 && n <= max ? n : null
}

export function validateCourse(f: CourseForm, limits = DEFAULT_LIMITS): FieldErrors {
  const e: FieldErrors = {}
  const title = f.title.trim()
  if (!title) e.title = 'Give the course a title.'
  else if (title.length > limits.title_max) e.title = `The title can be at most ${limits.title_max} characters.`
  else if (NEWLINE.test(title) || CONTROL.test(title)) e.title = 'The title must be a single line of plain text.'
  const category = f.category.trim()
  if (!category) e.category = 'Give the course a category.'
  else if (category.length > limits.category_max) e.category = `The category can be at most ${limits.category_max} characters.`
  else if (NEWLINE.test(category) || CONTROL.test(category)) e.category = 'The category must be a single line of plain text.'
  if (f.description.trim().length > limits.description_max) e.description = `The description can be at most ${limits.description_max} characters.`
  else if (CONTROL.test(f.description)) e.description = 'The description contains characters that are not allowed.'
  if (parseDuration(f.duration_hours, limits.duration_hours_max) === null) e.duration_hours = `Enter hours above 0 and up to ${limits.duration_hours_max}, with at most 2 decimals.`
  if (!f.delivery) e.delivery = 'Choose how it is delivered.'
  return e
}

export function courseBody(f: CourseForm): CourseCreate {
  return {
    title: f.title.trim(),
    description: f.description.trim(),
    category: f.category.trim(),
    duration_hours: parseDuration(f.duration_hours) ?? 0,
    delivery: (f.delivery || 'self_paced') as Delivery,
    mandatory_default: f.mandatory_default,
    active: f.active,
  }
}

export function validateNote(text: string, max = DEFAULT_LIMITS.completion_note_max): string | null {
  if (text.trim().length > max) return `The note can be at most ${max} characters.`
  if (CONTROL.test(text)) return 'The note contains characters that are not allowed.'
  return null
}

// ------------------------------------------------------------------------------------------------ errors
export interface ServerErrorInfo {
  status: number | null
  detail: string
  existingEnrolmentId: string | null
  fieldErrors: FieldErrors
}

/** Client-safe error text: only short server `detail` strings are shown; the network case has its own wording. */
export function parseServerError(err: unknown, fallback = 'Something went wrong. Please try again.'): ServerErrorInfo {
  const e = err as { response?: { status?: number; data?: Record<string, unknown> } } | null
  const status = e?.response?.status ?? null
  const data = e?.response?.data ?? {}
  let detail = typeof data.detail === 'string' && data.detail.trim() && data.detail.length < 300 ? data.detail : fallback
  if (status === null) detail = 'The service could not be reached. Check your connection and try again.'
  if (status === 404) detail = 'This item was not found, or you do not have access to it.'
  const fieldErrors: FieldErrors = {}
  if (status === 422 && Array.isArray(data.errors)) {
    for (const item of data.errors as Array<{ loc?: unknown[]; msg?: unknown }>) {
      const key = Array.isArray(item.loc) ? String(item.loc[item.loc.length - 1] ?? '') : ''
      if (key && typeof item.msg === 'string' && !fieldErrors[key]) fieldErrors[key] = item.msg
    }
    if (typeof data.detail !== 'string' || data.detail === 'Invalid request') detail = 'Some values were not accepted. Please check the form.'
  }
  const existing = typeof data.existing_enrolment_id === 'string' ? data.existing_enrolment_id : null
  return { status, detail, existingEnrolmentId: existing, fieldErrors }
}

/** Upload errors get fixed, friendly wording by status; the server detail is added when it is short and safe. */
export function uploadErrorText(info: ServerErrorInfo, maxMb: number): string {
  if (info.status === 413) return `That file is too large (limit ${maxMb} MB). Nothing was stored.`
  if (info.status === 415) return 'That file type is not accepted. Use a PDF, PNG or JPEG. Nothing was stored.'
  if (info.status === 400) return `${info.detail} Nothing was stored.`
  if (info.status === 409) return info.detail
  return info.detail
}

/** Filename for a downloaded certificate: the server's own `Content-Disposition` name, never the uploaded display name. */
export function downloadName(disposition: string | undefined | null, fallback = 'certificate'): string {
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition ?? '')
  const raw = m?.[1]?.trim()
  if (!raw) return fallback
  const clean = raw.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
  return clean || fallback
}

export function clampProgress(v: number): number {
  if (!Number.isFinite(v)) return 0
  return Math.min(100, Math.max(0, Math.round(v)))
}

export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / Math.max(1, pageSize)))
}

export function personName(p: { name: string | null; employee_id: string } | null | undefined): string {
  if (!p) return 'Unknown'
  return p.name || p.employee_id
}

export function assignedByText(e: Pick<Enrolment, 'assigned_by' | 'assigned_at' | 'source'>): string {
  if (e.source !== 'assigned' || !e.assigned_by) return 'Self-enrolled'
  return `Assigned by ${personName(e.assigned_by)}`
}
