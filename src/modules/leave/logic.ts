/**
 * Pure Leave helpers: labels, date and day-count display, form validation, API error mapping, timeline and calendar
 * math. No DOM, no network, so it is unit tested directly (tests/leave-logic.test.mjs).
 */
import { MONTH_SHORT, WEEKDAY_SHORT, daysInMonth, formatDate, isoDate, parseIsoDate, parseMonthKey, weekdayOf } from '@/lib/dates'
import type {
  AllowedAction,
  BalanceItem,
  CreateBody,
  DecisionAction,
  HalfDay,
  LeaveRequest,
  LeaveStatus,
  LeaveType,
  ListScope,
  PatchBody,
  Preview,
  PreviewBalanceRow,
  TeamItem,
} from './api'

// ------------------------------------------------------------------------------------------------ fixed wording

/** The four catalog entries the backend seeds with fixed ids; they can be deactivated but never deleted. */
export const DEFAULT_TYPE_IDS: readonly string[] = ['vacation', 'sick', 'personal', 'unpaid']

export const REASON_MAX = 500
export const COMMENT_MAX = 1000
export const WINDOW_DAYS = 365
export const MAX_SPAN_DAYS = 366
export const NAME_MAX = 60

// ------------------------------------------------------------------------------------------------ status
export const STATUS_ORDER: readonly LeaveStatus[] = ['pending', 'clarification_requested', 'approved', 'rejected', 'cancelled']
export type Tone = 'neutral' | 'blue' | 'violet' | 'amber' | 'green' | 'red'

const STATUS_LABEL: Record<LeaveStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  clarification_requested: 'Needs clarification',
  cancelled: 'Cancelled',
}
const STATUS_TONE: Record<LeaveStatus, Tone> = {
  pending: 'blue',
  approved: 'green',
  rejected: 'red',
  clarification_requested: 'amber',
  cancelled: 'neutral',
}
const STATUS_HINT: Record<LeaveStatus, string> = {
  pending: 'Waiting for the approver to decide.',
  approved: 'Approved.',
  rejected: 'Rejected. This request is closed.',
  clarification_requested: 'The approver asked a question. Edit the request and send it again.',
  cancelled: 'Cancelled by the person who asked. This request is closed.',
}

export const isStatus = (s: string | null | undefined): s is LeaveStatus => STATUS_ORDER.includes(s as LeaveStatus)
export const statusLabel = (s: string): string => (isStatus(s) ? STATUS_LABEL[s] : s)
export const statusTone = (s: string): Tone => (isStatus(s) ? STATUS_TONE[s] : 'neutral')
export const statusHint = (s: string): string => (isStatus(s) ? STATUS_HINT[s] : '')

export function hasAction(actions: readonly string[] | undefined, action: AllowedAction): boolean {
  return Boolean(actions?.includes(action))
}
export const isDeciderMode = (actions: readonly string[] | undefined): boolean =>
  hasAction(actions, 'approve') || hasAction(actions, 'reject') || hasAction(actions, 'clarify')
export const isEditorMode = (actions: readonly string[] | undefined): boolean => hasAction(actions, 'edit') || hasAction(actions, 'resubmit')

// ------------------------------------------------------------------------------------------------ navigation hints (the ONE place roles are named)
export type TabId = 'my' | 'approvals' | 'calendar' | 'settings'
export const TAB_LABEL: Record<TabId, string> = { my: 'My leave', approvals: 'Approvals', calendar: 'Team calendar', settings: 'Leave settings' }
export const TAB_PARAM: Record<TabId, string> = { my: '', approvals: 'approvals', calendar: 'calendar', settings: 'settings' }

/**
 * Navigation hint ONLY: which tabs to offer. It mirrors the server rules (review/team/all scopes, catalog admin) but never
 * grants anything: every call is authorised by the server (403 -> an honest "not available" state). Probing with real calls
 * was rejected because each refused probe writes an `access.denied` audit event.
 */
export function listScopesFor(roles: readonly string[] | undefined): ListScope[] {
  const r = roles ?? []
  const scopes: ListScope[] = []
  if (r.includes('Manager') || r.includes('HRAdmin')) scopes.push('review')
  if (r.includes('Manager')) scopes.push('team')
  if (r.includes('HRAdmin')) scopes.push('all')
  return scopes
}
export function availableTabs(roles: readonly string[] | undefined): TabId[] {
  const tabs: TabId[] = ['my']
  if (listScopesFor(roles).length > 0) tabs.push('approvals')
  tabs.push('calendar')
  if ((roles ?? []).includes('HRAdmin')) tabs.push('settings')
  return tabs
}
export function parseTab(raw: string | null | undefined, available: readonly TabId[]): TabId {
  const found = (Object.keys(TAB_PARAM) as TabId[]).find((t) => TAB_PARAM[t] && TAB_PARAM[t] === raw)
  return found && available.includes(found) ? found : 'my'
}
export const SCOPE_LABEL: Record<ListScope, string> = {
  mine: 'My requests',
  review: 'Waiting for my decision',
  team: "My team's requests",
  all: 'All requests',
}
export const SCOPE_SUB: Record<ListScope, string> = {
  mine: 'Leave you have asked for, newest first.',
  review: 'Pending requests you can decide now, soonest first.',
  team: 'Every request from the people who report to you. Decide the ones that are pending.',
  all: 'Everything in the company, for oversight. Read-only: you can only decide requests that fall to you.',
}
export function parseScope(raw: string | null | undefined, scopes: readonly ListScope[]): ListScope {
  return scopes.find((s) => s === raw) ?? scopes[0] ?? 'review'
}

// ------------------------------------------------------------------------------------------------ numbers and dates
/** 3 -> "3", 0.5 -> "0.5", 2.50 -> "2.5". Never shows more than one decimal (the API uses half-day steps). */
export function formatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '-'
  const r = Math.round(n * 10) / 10
  return Number.isInteger(r) ? String(r) : r.toFixed(1)
}
export function formatDays(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '-'
  return `${formatNumber(n)} ${Math.abs(n) === 1 ? 'day' : 'days'}`
}
export const HALF_LABEL: Record<HalfDay, string> = { none: 'Full day', am: 'Morning (am)', pm: 'Afternoon (pm)' }
export const halfDayLabel = (h: string | null | undefined): string => HALF_LABEL[(h as HalfDay) ?? 'none'] ?? 'Full day'

/** "23 to 25 Nov 2026", "28 Nov to 2 Dec 2026", "30 Dec 2026 to 4 Jan 2027", "23 Nov 2026 (am)". */
export function formatRange(start: string, end: string, half: HalfDay | string = 'none'): string {
  const a = parseIsoDate(start)
  const b = parseIsoDate(end)
  if (!a || !b) return [start, end].filter(Boolean).join(' to ')
  const suffix = half === 'am' ? ' (am)' : half === 'pm' ? ' (pm)' : ''
  if (start === end) return `${formatDate(start)}${suffix}`
  if (a.year === b.year && a.month === b.month) return `${a.day} to ${b.day} ${MONTH_SHORT[b.month - 1]} ${b.year}${suffix}`
  if (a.year === b.year) return `${a.day} ${MONTH_SHORT[a.month - 1]} to ${b.day} ${MONTH_SHORT[b.month - 1]} ${b.year}${suffix}`
  return `${formatDate(start)} to ${formatDate(end)}${suffix}`
}

/** "Mon 23 Nov 2026" */
export function formatLongDate(iso: string): string {
  const p = parseIsoDate(iso)
  return p ? `${WEEKDAY_SHORT[weekdayOf(p.year, p.month, p.day)]} ${p.day} ${MONTH_SHORT[p.month - 1]} ${p.year}` : iso
}

/** Days since 1970-01-01 (UTC arithmetic: independent of the viewer's time zone). */
export function dayNumber(iso: string | null | undefined): number | null {
  const p = parseIsoDate(iso)
  return p ? Math.round(Date.UTC(p.year, p.month - 1, p.day) / 86_400_000) : null
}

export function formatDateTime(iso: string | null | undefined): string {
  const ms = iso ? Date.parse(iso) : NaN
  if (!Number.isFinite(ms)) return '-'
  const d = new Date(ms)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${d.getDate()} ${MONTH_SHORT[d.getMonth()]} ${d.getFullYear()}, ${hh}:${mm}`
}

/** `{"2026":3,"2027":2}` -> "2026: 3 days, 2027: 2 days" (only when more than one year is involved). */
export function daysByYearText(byYear: Record<string, number> | null | undefined): string | null {
  const entries = Object.entries(byYear ?? {}).sort(([a], [b]) => Number(a) - Number(b))
  if (entries.length < 2) return null
  return entries.map(([y, d]) => `${y}: ${formatDays(d)}`).join(', ')
}

// ------------------------------------------------------------------------------------------------ balances
export interface BalanceView {
  /** share of the entitlement already used, 0..100 */
  usedPct: number
  /** share reserved by pending requests, 0..100 (stacked after used, capped so the bar never overflows) */
  pendingPct: number
  over: boolean
}
export function balanceView(b: Pick<BalanceItem, 'entitlement' | 'used' | 'pending' | 'unlimited'>): BalanceView {
  if (b.unlimited || b.entitlement <= 0) return { usedPct: 0, pendingPct: 0, over: !b.unlimited && b.used + b.pending > 0 }
  const used = Math.min(100, (b.used / b.entitlement) * 100)
  const pending = Math.min(100 - used, (b.pending / b.entitlement) * 100)
  return { usedPct: Math.round(used * 10) / 10, pendingPct: Math.round(pending * 10) / 10, over: b.used + b.pending > b.entitlement }
}
export function remainingText(b: Pick<BalanceItem, 'remaining' | 'unlimited'>): string {
  if (b.unlimited || b.remaining === null) return 'No limit'
  return formatDays(b.remaining)
}
export function balanceSentence(b: BalanceItem | undefined, year: number): string | null {
  if (!b) return null
  if (b.unlimited) return `${b.name} has no balance limit (unpaid).`
  return `${b.name} ${year}: ${formatDays(b.remaining)} left of ${formatNumber(b.entitlement)}, ${formatNumber(b.used)} used, ${formatNumber(b.pending)} pending.`
}
export function previewBalanceText(row: PreviewBalanceRow, paid: boolean): string {
  if (!paid || row.remaining_after === null) return `${row.year}: no balance limit for this type`
  return `${row.year}: ${formatDays(row.remaining_after)} left after this request (${formatNumber(row.entitlement)} entitlement, ${formatNumber(row.used)} used, ${formatNumber(row.pending)} pending)`
}

// ------------------------------------------------------------------------------------------------ request form
export interface FormValues {
  typeId: string
  start: string
  end: string
  half: HalfDay
  reason: string
}
export const EMPTY_FORM: FormValues = { typeId: '', start: '', end: '', half: 'none', reason: '' }
export type FormField = 'type' | 'start' | 'end' | 'half' | 'reason'
export type FormErrors = Partial<Record<FormField, string>>

export interface FormContext {
  types: readonly LeaveType[]
  /** YYYY-MM-DD, the server's "today" */
  today: string | null
  windowDays?: number
  maxSpan?: number
  reasonMax?: number
}

/** Half days exist only for a single day: this is the one rule that couples the fields. */
export const halfDayAllowed = (v: Pick<FormValues, 'start' | 'end'>): boolean => Boolean(v.start) && v.start === v.end

/** Applies a field edit and keeps the coupled fields consistent (end follows start; half day is cleared for a range). */
export function applyFormChange(prev: FormValues, patch: Partial<FormValues>): FormValues {
  const next = { ...prev, ...patch }
  if ('start' in patch) {
    const s = dayNumber(next.start)
    const e = dayNumber(next.end)
    if (s !== null && (e === null || e < s)) next.end = next.start
  }
  if (!halfDayAllowed(next)) next.half = 'none'
  return next
}

/** Local checks mirror the server rules for fast feedback; the server stays the authority on every one of them. */
export function validateForm(v: FormValues, ctx: FormContext): FormErrors {
  const errors: FormErrors = {}
  const type = ctx.types.find((t) => t.type_id === v.typeId)
  if (!v.typeId) errors.type = 'Choose a leave type.'
  else if (!type) errors.type = 'Choose a leave type from the list.'
  else if (!type.active) errors.type = 'This leave type is no longer available.'

  const s = dayNumber(v.start)
  const e = dayNumber(v.end)
  if (!v.start) errors.start = 'Choose a start date.'
  else if (s === null) errors.start = 'Enter a valid start date.'
  if (!v.end) errors.end = 'Choose an end date.'
  else if (e === null) errors.end = 'Enter a valid end date.'
  if (s !== null && e !== null && e < s) errors.end = 'The end date cannot be before the start date.'
  const span = ctx.maxSpan ?? MAX_SPAN_DAYS
  if (s !== null && e !== null && e >= s && e - s + 1 > span) errors.end = `A request can cover at most ${span} days.`
  const t = dayNumber(ctx.today)
  const win = ctx.windowDays ?? WINDOW_DAYS
  if (s !== null && t !== null && Math.abs(s - t) > win) errors.start = `The start date must be within ${win} days of today.`
  if (v.half !== 'none' && !halfDayAllowed(v)) errors.half = 'A half day can only be taken on a single day.'

  const reasonMax = ctx.reasonMax ?? REASON_MAX
  const reason = v.reason.trim()
  if (type?.requires_reason && !reason) errors.reason = 'This leave type needs a reason.'
  else if (reason.length > reasonMax) errors.reason = `The reason can be at most ${reasonMax} characters.`
  return errors
}

/** The preview is requested only when the shape of the request is valid (reason does not change the day count). */
export function previewQuery(v: FormValues, ctx: FormContext): { type_id: string; start_date: string; end_date: string; half_day: HalfDay } | null {
  const e = validateForm({ ...v, reason: 'x' }, ctx)
  if (e.type || e.start || e.end || e.half) return null
  return { type_id: v.typeId, start_date: v.start, end_date: v.end, half_day: v.half }
}

export function toCreateBody(v: FormValues): CreateBody {
  const reason = v.reason.trim()
  return { type_id: v.typeId, start_date: v.start, end_date: v.end, half_day: v.half, reason: reason ? reason : null }
}

export function formFromRequest(r: Pick<LeaveRequest, 'type_id' | 'start_date' | 'end_date' | 'half_day' | 'reason'>): FormValues {
  return { typeId: r.type_id, start: r.start_date, end: r.end_date, half: r.half_day, reason: r.reason ?? '' }
}

/** Only changed fields, plus the version the user saw (stale -> the server answers 409). */
export function buildPatch(v: FormValues, saved: Pick<LeaveRequest, 'type_id' | 'start_date' | 'end_date' | 'half_day' | 'reason' | 'version'>): PatchBody {
  const patch: PatchBody = { version: saved.version }
  if (v.typeId !== saved.type_id) patch.type_id = v.typeId
  if (v.start !== saved.start_date) patch.start_date = v.start
  if (v.end !== saved.end_date) patch.end_date = v.end
  if (v.half !== saved.half_day) patch.half_day = v.half
  const reason = v.reason.trim()
  if (reason !== (saved.reason ?? '')) patch.reason = reason ? reason : null
  return patch
}
export const patchHasChanges = (p: PatchBody): boolean => Object.keys(p).some((k) => k !== 'version')

// ------------------------------------------------------------------------------------------------ preview display
export function previewHeadline(p: Preview): string {
  if (p.days <= 0) return 'No working days'
  return `${formatDays(p.days)} of leave`
}
export function previewNotes(p: Preview): string[] {
  const notes: string[] = []
  if (p.weekend_days > 0) notes.push(`${p.weekend_days} weekend ${p.weekend_days === 1 ? 'day is' : 'days are'} not counted.`)
  for (const h of p.holidays) notes.push(`${formatLongDate(h.date)} is a company holiday (${h.title}) and is not counted.`)
  const split = daysByYearText(p.days_by_year)
  if (split) notes.push(`This crosses a year end and is counted per calendar year: ${split}.`)
  return notes
}

// ------------------------------------------------------------------------------------------------ errors
export interface LeaveErrorInfo {
  status: number | null
  detail: string
  code: string | null
  remaining: number | null
  year: number | null
  requested: number | null
  conflictingId: string | null
  fieldErrors: Partial<Record<string, string>>
}

const LOC_FIELD: Record<string, string> = {
  type_id: 'type',
  start_date: 'start',
  end_date: 'end',
  half_day: 'half',
  reason: 'reason',
  comment: 'comment',
  name: 'name',
  annual_days: 'days',
  days: 'days',
  year: 'year',
  employee_id: 'employee',
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

export function parseLeaveError(err: unknown, fallback = 'Something went wrong. Please try again.'): LeaveErrorInfo {
  const e = err as { response?: { status?: number; data?: Record<string, unknown> } } | null
  const status = e?.response?.status ?? null
  const data = (e?.response?.data ?? {}) as Record<string, unknown>
  const rawDetail = typeof data.detail === 'string' && data.detail.trim() && data.detail.length < 300 ? data.detail : null
  const fieldErrors: Partial<Record<string, string>> = {}
  if (Array.isArray(data.errors)) {
    for (const item of data.errors as Array<{ loc?: unknown[]; msg?: unknown }>) {
      const last = Array.isArray(item?.loc) ? String(item.loc[item.loc.length - 1] ?? '') : ''
      const field = LOC_FIELD[last]
      if (field && typeof item.msg === 'string' && !fieldErrors[field]) fieldErrors[field] = item.msg.slice(0, 160)
    }
  }
  let detail = rawDetail ?? fallback
  if (status === null) detail = "Can't reach the Bluedge People service. Check your connection and try again."
  else if (status >= 500) detail = 'The service had a problem. Please try again in a moment.'
  else if (status === 422 && !rawDetail) detail = fallback
  return {
    status,
    detail,
    code: typeof data.code === 'string' ? data.code : null,
    remaining: num(data.remaining),
    year: num(data.year),
    requested: num(data.requested),
    conflictingId: typeof data.conflicting_request_id === 'string' ? data.conflicting_request_id : null,
    fieldErrors,
  }
}

/** The form field a rule failure belongs to (null = it concerns the request as a whole). */
export function fieldForCode(code: string | null): FormField | null {
  switch (code) {
    case 'reason_required':
      return 'reason'
    case 'unknown_type':
    case 'inactive_type':
      return 'type'
    case 'half_day_range':
    case 'invalid_half_day':
      return 'half'
    case 'invalid_date':
    case 'date_window':
      return 'start'
    case 'invalid_range':
    case 'span_too_long':
      return 'end'
    default:
      return null
  }
}

/** Clear wording for each stable rule code; unknown codes fall back to the server's own client-safe text. */
export function friendlyError(info: LeaveErrorInfo): string {
  switch (info.code) {
    case 'insufficient_balance': {
      if (info.remaining !== null && info.requested !== null) {
        const year = info.year !== null ? ` for ${info.year}` : ''
        const left = info.remaining > 0 ? formatDays(info.remaining) : 'no days'
        return `Not enough leave balance: you have ${left} left${year} and this request needs ${formatDays(info.requested)}.`
      }
      return info.detail
    }
    case 'overlap':
      return 'You already have a pending or approved leave request that overlaps these dates. Cancel it or choose other dates.'
    case 'no_working_days':
      return 'These dates contain no working days. Weekends and company holidays are not counted.'
    case 'invalid_range':
      return 'The end date cannot be before the start date.'
    case 'half_day_range':
      return 'A half day can only be taken on a single day.'
    case 'date_window':
      return `The start date must be within ${WINDOW_DAYS} days of today.`
    case 'span_too_long':
      return `A single request can cover at most ${MAX_SPAN_DAYS} days.`
    case 'invalid_date':
      return 'Enter valid dates.'
    case 'unknown_type':
    case 'inactive_type':
      return 'This leave type is no longer available. Choose another one.'
    case 'reason_required':
      return 'This leave type needs a reason.'
    case 'comment_required':
      return 'A comment is required to reject or ask for clarification.'
    default:
      return info.detail
  }
}

// ------------------------------------------------------------------------------------------------ decision timeline
export type TimelineKind = 'submitted' | 'resubmitted' | 'approve' | 'reject' | 'clarify' | 'cancelled'
export interface TimelineEvent {
  key: string
  kind: TimelineKind
  at: string
  title: string
  by: string | null
  comment: string | null
}

const DECISION_TITLE: Record<DecisionAction, string> = { approve: 'Approved', reject: 'Rejected', clarify: 'Clarification requested' }
export const decisionTitle = (a: string): string => DECISION_TITLE[a as DecisionAction] ?? a
export const decisionTone = (a: string): Tone => (a === 'approve' ? 'green' : a === 'reject' ? 'red' : a === 'clarify' ? 'amber' : 'neutral')

/**
 * Oldest first. The request is created already submitted; if it was sent back and resubmitted, `submitted_at` is the
 * latest submission and is shown as "Resubmitted" after the clarification it answers.
 */
export function buildTimeline(r: LeaveRequest): TimelineEvent[] {
  const events: TimelineEvent[] = [
    { key: 'submitted', kind: 'submitted', at: r.created_at, title: 'Submitted for approval', by: r.employee?.name ?? null, comment: null },
  ]
  let lastClarify: string | null = null
  for (const d of r.decisions ?? []) {
    events.push({
      key: d.decision_id,
      kind: d.action,
      at: d.at,
      title: decisionTitle(d.action),
      by: d.by_name ? (d.by_role ? `${d.by_name} (${d.by_role})` : d.by_name) : d.by_role,
      comment: d.comment,
    })
    if (d.action === 'clarify') lastClarify = d.at
  }
  if (r.submitted_at && lastClarify && Date.parse(r.submitted_at) > Date.parse(lastClarify) && r.submitted_at !== r.created_at) {
    events.push({ key: 'resubmitted', kind: 'resubmitted', at: r.submitted_at, title: 'Resubmitted for approval', by: r.employee?.name ?? null, comment: null })
  }
  if (r.cancelled_at) events.push({ key: 'cancelled', kind: 'cancelled', at: r.cancelled_at, title: 'Cancelled', by: r.employee?.name ?? null, comment: null })
  return events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || order(a.kind) - order(b.kind))
}
const order = (k: TimelineKind): number => (k === 'submitted' ? 0 : k === 'resubmitted' ? 2 : k === 'cancelled' ? 3 : 1)

/** The last clarification comment, shown to the owner above the edit form. */
export function lastClarification(r: LeaveRequest): { comment: string | null; by: string | null; at: string } | null {
  const list = (r.decisions ?? []).filter((d) => d.action === 'clarify')
  const d = list[list.length - 1]
  return d ? { comment: d.comment, by: d.by_name, at: d.at } : null
}

export function approverLine(r: Pick<LeaveRequest, 'approver' | 'status'>): string {
  const a = r.approver
  if (!a) return '-'
  const who = a.kind === 'hr_fallback' ? 'HR (no manager can decide this request)' : a.name ?? 'the manager'
  if (r.status === 'pending') return `Waiting for ${who}`
  if (r.status === 'clarification_requested') return `${who} asked a question`
  return who
}

export const CONFIRM_TEXT: Record<DecisionAction, string> = {
  approve: 'Approve this leave request? The person will be notified.',
  reject: 'Reject this leave request? This ends it. The person will see your comment.',
  clarify: 'Ask for clarification? The person can edit the request and send it again. They will see your comment.',
}

// ------------------------------------------------------------------------------------------------ team calendar
export function coversDate(item: Pick<TeamItem, 'start_date' | 'end_date'>, iso: string): boolean {
  return item.start_date <= iso && iso <= item.end_date
}

/** Leave entries per calendar day of `key`, sorted by name then type. Entries may start before / end after the month. */
export function leaveByDate(items: readonly TeamItem[], key: string): Map<string, TeamItem[]> {
  const out = new Map<string, TeamItem[]>()
  const p = parseMonthKey(key)
  if (!p) return out
  const total = daysInMonth(p.year, p.month)
  for (let d = 1; d <= total; d++) {
    const iso = isoDate(p.year, p.month, d)
    const list = items.filter((i) => coversDate(i, iso)).sort(compareItems)
    if (list.length) out.set(iso, list)
  }
  return out
}
export const compareItems = (a: TeamItem, b: TeamItem): number => a.employee_name.localeCompare(b.employee_name) || a.type_name.localeCompare(b.type_name) || a.start_date.localeCompare(b.start_date)

export interface AgendaEntry {
  item: TeamItem
  /** the part of the leave that falls inside the month */
  from: string
  to: string
}
/** Phone agenda: every entry that touches the month, soonest first, clipped to the month. */
export function agendaEntries(items: readonly TeamItem[], key: string): AgendaEntry[] {
  const p = parseMonthKey(key)
  if (!p) return []
  const first = isoDate(p.year, p.month, 1)
  const last = isoDate(p.year, p.month, daysInMonth(p.year, p.month))
  return items
    .filter((i) => i.end_date >= first && i.start_date <= last)
    .map((item) => ({ item, from: item.start_date < first ? first : item.start_date, to: item.end_date > last ? last : item.end_date }))
    .sort((a, b) => a.from.localeCompare(b.from) || compareItems(a.item, b.item))
}

/** One chip colour per leave type; custom types hash into a small palette so they stay stable across renders. */
export type TypeTone = 'vacation' | 'sick' | 'personal' | 'unpaid' | 'c1' | 'c2' | 'c3'
export function typeTone(typeId: string): TypeTone {
  if (typeId === 'vacation' || typeId === 'sick' || typeId === 'personal' || typeId === 'unpaid') return typeId
  let h = 0
  for (const ch of typeId) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return (['c1', 'c2', 'c3'] as const)[h % 3]
}

export function chipLabel(i: Pick<TeamItem, 'employee_name' | 'type_name' | 'half_day' | 'own'>): string {
  const half = i.half_day === 'am' ? ' (am)' : i.half_day === 'pm' ? ' (pm)' : ''
  return `${i.own ? 'You' : i.employee_name} - ${i.type_name}${half}`
}

// ------------------------------------------------------------------------------------------------ pagination
export const pageCount = (total: number, pageSize: number): number => Math.max(1, Math.ceil(total / Math.max(1, pageSize)))
export function rangeText(total: number, page: number, pageSize: number): string {
  if (total <= 0) return 'No requests'
  const from = (page - 1) * pageSize + 1
  const to = Math.min(total, page * pageSize)
  return `${from}-${to} of ${total}`
}
export function parsePage(raw: string | null | undefined): number {
  const n = Number(raw)
  return Number.isInteger(n) && n >= 1 && n <= 10_000 ? n : 1
}

// ------------------------------------------------------------------------------------------------ HR catalog forms
export interface TypeFormValues {
  name: string
  paid: boolean
  days: string
  requiresReason: boolean
}
export const EMPTY_TYPE_FORM: TypeFormValues = { name: '', paid: true, days: '0', requiresReason: false }

/** "12" / "12.5" -> number; anything else (letters, negatives, not a half step, > 366) -> null. */
export function parseDays(text: string): number | null {
  const t = text.trim()
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(t)) return null
  const n = Number(t)
  if (!Number.isFinite(n) || n < 0 || n > 366) return null
  return Math.abs(n * 2 - Math.round(n * 2)) < 1e-9 ? n : null
}
export type TypeFormErrors = Partial<Record<'name' | 'days', string>>
export function validateTypeForm(v: TypeFormValues, existing: readonly LeaveType[], editingId: string | null): TypeFormErrors {
  const errors: TypeFormErrors = {}
  const name = v.name.trim()
  if (!name) errors.name = 'A name is required.'
  else if (name.length > NAME_MAX) errors.name = `The name can be at most ${NAME_MAX} characters.`
  else if (existing.some((t) => t.type_id !== editingId && t.name.trim().toLowerCase() === name.toLowerCase())) errors.name = 'A leave type with this name already exists.'
  if (parseDays(v.days) === null) errors.days = 'Enter 0 to 366 days in steps of 0.5.'
  return errors
}
export function typeFormFrom(t: LeaveType): TypeFormValues {
  return { name: t.name, paid: t.paid, days: formatNumber(t.annual_days), requiresReason: t.requires_reason }
}

export interface OverrideFormValues {
  employeeId: string
  typeId: string
  year: string
  days: string
}
export type OverrideErrors = Partial<Record<'employee' | 'type' | 'year' | 'days', string>>
export function validateOverride(v: OverrideFormValues): OverrideErrors {
  const errors: OverrideErrors = {}
  if (!v.employeeId) errors.employee = 'Choose an employee.'
  if (!v.typeId) errors.type = 'Choose a leave type.'
  const y = Number(v.year)
  if (!/^\d{4}$/.test(v.year.trim()) || y < 2000 || y > 2100) errors.year = 'Enter a year from 2000 to 2100.'
  if (parseDays(v.days) === null) errors.days = 'Enter 0 to 366 days in steps of 0.5.'
  return errors
}

export function typeSummary(t: Pick<LeaveType, 'paid' | 'annual_days' | 'requires_reason'>): string {
  const parts = [t.paid ? `${formatDays(t.annual_days)} a year` : 'Unpaid, no balance limit']
  if (t.requires_reason) parts.push('reason required')
  return parts.join(', ')
}

/** Month key helper for the team calendar when the server's date, not the browser's, defines "today". */
export function monthOfDate(iso: string | null | undefined): string | null {
  const p = parseIsoDate(iso)
  return p ? `${String(p.year).padStart(4, '0')}-${String(p.month).padStart(2, '0')}` : null
}
