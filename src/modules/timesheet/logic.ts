/**
 * Attendance & Timesheet: pure helpers (no DOM, no network) so they can be unit tested with node --test.
 * The limits below mirror docs/api/timesheet.md and the server stays the
 * authority; the UI only gives friendly early feedback.
 */
import { MONTH_SHORT, isoDate, parseIsoDate, weekdayOf } from '@/lib/dates'

// ------------------------------------------------------------------------------------------------ limits (mirror the server)
export const HOUR_STEP = 0.25
export const MAX_HOURS_PER_DAY = 24
export const MAX_ROWS = 20
export const MAX_SESSION_HOURS = 16
export const CORRECTION_WINDOW_DAYS = 60
/** Readable range of weeks: 53 back from the current week and 4 ahead (server rule `week_out_of_range`). */
export const WEEKS_BACK = 53
export const WEEKS_AHEAD = 4
export const REASON_MAX = 500
export const COMMENT_MAX = 1000

// ------------------------------------------------------------------------------------------------ calendar math (integers, no time zone)
const pad = (n: number) => String(n).padStart(2, '0')

export function addDaysIso(iso: string, days: number): string {
  const p = parseIsoDate(iso)
  if (!p) return iso
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day + days))
  return isoDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
}

/** The Monday of the week that contains `iso` (Monday-start weeks, like the server). Unparsable input is returned unchanged. */
export function mondayOf(iso: string): string {
  const p = parseIsoDate(iso)
  if (!p) return iso
  const wd = weekdayOf(p.year, p.month, p.day) // 0 = Sunday
  return addDaysIso(iso, -((wd + 6) % 7))
}

export function isIsoDate(value: string | null | undefined): value is string {
  return parseIsoDate(value) !== null && /^\d{4}-\d{2}-\d{2}$/.test(value ?? '')
}

export function weekDates(monday: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDaysIso(monday, i))
}

/** Whole days from a to b (b - a). */
export function daysBetween(a: string, b: string): number {
  const pa = parseIsoDate(a)
  const pb = parseIsoDate(b)
  if (!pa || !pb) return NaN
  return Math.round((Date.UTC(pb.year, pb.month - 1, pb.day) - Date.UTC(pa.year, pa.month - 1, pa.day)) / 86_400_000)
}

export function weeksBetween(aMonday: string, bMonday: string): number {
  return Math.round(daysBetween(aMonday, bMonday) / 7)
}

/** Which way the week navigation may go, from the readable range (53 back .. 4 ahead of the CURRENT week). */
export function weekNavLimits(monday: string, currentMonday: string): { canPrev: boolean; canNext: boolean; inRange: boolean } {
  const diff = weeksBetween(currentMonday, monday)
  return { canPrev: diff > -WEEKS_BACK, canNext: diff < WEEKS_AHEAD, inRange: diff >= -WEEKS_BACK && diff <= WEEKS_AHEAD }
}

/** "16 - 22 Nov 2026" (month and year shown where they change). */
export function formatWeekRange(monday: string): string {
  const a = parseIsoDate(monday)
  const b = parseIsoDate(addDaysIso(monday, 6))
  if (!a || !b) return monday
  if (a.year !== b.year) return `${a.day} ${MONTH_SHORT[a.month - 1]} ${a.year} - ${b.day} ${MONTH_SHORT[b.month - 1]} ${b.year}`
  if (a.month !== b.month) return `${a.day} ${MONTH_SHORT[a.month - 1]} - ${b.day} ${MONTH_SHORT[b.month - 1]} ${b.year}`
  return `${a.day} - ${b.day} ${MONTH_SHORT[b.month - 1]} ${b.year}`
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export function weekdayShort(iso: string): string {
  const p = parseIsoDate(iso)
  return p ? WEEKDAYS[weekdayOf(p.year, p.month, p.day)] : ''
}
/** "16 Nov" */
export function dayMonth(iso: string): string {
  const p = parseIsoDate(iso)
  return p ? `${p.day} ${MONTH_SHORT[p.month - 1]}` : iso
}
/** "Mon 16 Nov" */
export function formatDayLabel(iso: string): string {
  const p = parseIsoDate(iso)
  return p ? `${WEEKDAYS[weekdayOf(p.year, p.month, p.day)]} ${p.day} ${MONTH_SHORT[p.month - 1]}` : iso
}
/** "Mon 16 Nov 2026" */
export function formatDayLong(iso: string): string {
  const p = parseIsoDate(iso)
  return p ? `${WEEKDAYS[weekdayOf(p.year, p.month, p.day)]} ${p.day} ${MONTH_SHORT[p.month - 1]} ${p.year}` : iso
}

export function sheetIdFor(employeeId: string, monday: string): string {
  return `${employeeId}_${monday}`
}

// ------------------------------------------------------------------------------------------------ hours and durations
export function roundHours(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/** 7.5 -> "7.5", 8 -> "8", 0.25 -> "0.25". Not a number -> "0". */
export function formatHours(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '0'
  return String(roundHours(n))
}

/** 7.5 -> "7h 30m", 0.25 -> "15m", 8 -> "8h". */
export function formatHoursMinutes(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n) || n <= 0) return '0m'
  const totalMin = Math.round(n * 60)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  if (h && m) return `${h}h ${m}m`
  return h ? `${h}h` : `${m}m`
}

/** The day's single time in / time out for the clock card: time in = the FIRST clock-in of the day, time out = the LATEST clock-out, or null
 * while a session is open (a new clock-in clears the time out until you clock out again). Null when nothing is stamped. */
export function dayStamp(
  sessions: readonly { session_id: string; clock_in: string; clock_out: string | null }[],
  open: { session_id: string; clock_in: string; clock_out: string | null } | null,
): { clockIn: string; clockOut: string | null } | null {
  const rows = stampRows(sessions, open)
  if (rows.length === 0) return null
  const isOpen = Boolean(open) || rows.some((r) => !r.clockOut)
  const outs = rows.map((r) => r.clockOut).filter((o): o is string => Boolean(o)).sort()
  return { clockIn: rows[0].clockIn, clockOut: isOpen ? null : (outs[outs.length - 1] ?? null) }
}

/** Internal: the day's punches in time order. The open session is included even if the day record lags. */
export function stampRows(
  sessions: readonly { session_id: string; clock_in: string; clock_out: string | null }[],
  open: { session_id: string; clock_in: string; clock_out: string | null } | null,
): { id: string; clockIn: string; clockOut: string | null }[] {
  const all = [...sessions]
  if (open && !all.some((s) => s.session_id === open.session_id)) all.push(open)
  return all
    .filter((s) => typeof s.clock_in === 'string' && s.clock_in)
    .sort((a, b) => (a.clock_in < b.clock_in ? -1 : a.clock_in > b.clock_in ? 1 : 0))
    .map((s) => ({ id: s.session_id, clockIn: s.clock_in, clockOut: s.clock_out || null }))
}

/** Live timer text: milliseconds -> "HH:MM:SS". (hours may exceed 24). Negative values show 00:00:00. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return `${pad(h)}:${pad(m)}:${pad(s)}`
}

/**
 * Elapsed time since `clockInIso`, measured on the SERVER's clock: the offset between the server's `now` and the
 * browser clock at fetch time is applied, so a wrong laptop clock does not change what is shown.
 */
export function elapsedMs(clockInIso: string, serverNowIso: string, fetchedAtMs: number, nowMs: number): number {
  const start = Date.parse(clockInIso)
  const serverNow = Date.parse(serverNowIso)
  if (!Number.isFinite(start) || !Number.isFinite(serverNow)) return 0
  const offset = serverNow - fetchedAtMs
  return Math.max(0, nowMs + offset - start)
}

/** Has an open session run past the 16 hour limit (what the server calls needs_correction)? */
export function isOverLimit(ms: number): boolean {
  return ms > MAX_SESSION_HOURS * 3600_000
}

/** "HH:MM" in the company time zone for an ISO instant. An unknown zone falls back to UTC. */
export function formatClockTime(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return '-'
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return '-'
  const make = (tz: string) =>
    new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(t))
  try {
    return make(timeZone || 'UTC')
  } catch {
    return make('UTC')
  }
}

/** "16 Nov, 09:15" in the company time zone. */
export function formatDateTimeIn(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return '-'
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return '-'
  const make = (tz: string) =>
    new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(t))
  try {
    return make(timeZone || 'UTC').replace(',', '')
  } catch {
    return make('UTC').replace(',', '')
  }
}

// ------------------------------------------------------------------------------------------------ timesheet cells
export type CellIssue = 'invalid' | 'range' | 'step'

export interface ParsedHours {
  ok: boolean
  /** Hours as a number (0 for an empty box). */
  value: number
  empty: boolean
  issue: CellIssue | null
}

export const CELL_MESSAGE: Record<CellIssue, string> = {
  invalid: 'Enter hours as a number, for example 7.5.',
  range: `Hours must be between 0 and ${MAX_HOURS_PER_DAY}.`,
  step: 'Use quarter-hour steps: .25, .5 or .75.',
}

/** Parses what a person typed into a cell. A comma decimal separator is accepted. Empty means 0. */
export function parseHoursInput(raw: string | null | undefined): ParsedHours {
  const text = (raw ?? '').trim().replace(',', '.')
  if (text === '') return { ok: true, value: 0, empty: true, issue: null }
  if (!/^-?(\d+(\.\d*)?|\.\d+)$/.test(text)) return { ok: false, value: 0, empty: false, issue: 'invalid' }
  const value = Number(text)
  if (!Number.isFinite(value)) return { ok: false, value: 0, empty: false, issue: 'invalid' }
  if (value < 0 || value > MAX_HOURS_PER_DAY) return { ok: false, value: 0, empty: false, issue: 'range' }
  const quarters = value / HOUR_STEP
  if (Math.abs(quarters - Math.round(quarters)) > 1e-9) return { ok: false, value: 0, empty: false, issue: 'step' }
  return { ok: true, value: roundHours(value), empty: false, issue: null }
}

export interface GridRow {
  code_id: string
  code_name: string
  billable: boolean
  code_active: boolean
  /** Text in each day box, keyed by ISO date. Empty string = no hours. */
  cells: Record<string, string>
}

export interface SheetRowLike {
  code_id: string
  code_name: string
  billable: boolean
  code_active: boolean
  hours: Record<string, number>
}

export function cellText(n: number | undefined): string {
  return n && n > 0 ? String(roundHours(n)) : ''
}

export function gridFromRows(rows: readonly SheetRowLike[], days: readonly string[]): GridRow[] {
  return rows.map((r) => ({
    code_id: r.code_id,
    code_name: r.code_name,
    billable: r.billable,
    code_active: r.code_active,
    cells: Object.fromEntries(days.map((d) => [d, cellText(r.hours?.[d])])),
  }))
}

export function emptyRow(code: { code_id: string; name: string; billable: boolean; active: boolean }, days: readonly string[]): GridRow {
  return { code_id: code.code_id, code_name: code.name, billable: code.billable, code_active: code.active, cells: Object.fromEntries(days.map((d) => [d, ''])) }
}

export const cellKey = (codeId: string, day: string) => `${codeId}|${day}`

export interface GridValidation {
  /** key = cellKey(code_id, day) */
  cellIssues: Record<string, CellIssue>
  /** ISO day -> message, when a day's total is above the limit */
  dayIssues: Record<string, string>
  tooManyRows: boolean
  ok: boolean
}

export interface GridTotals {
  rowTotals: Record<string, number>
  dayTotals: Record<string, number>
  total: number
}

/** Totals over the numbers that parse; a cell with a problem counts as 0 (the problem is reported by validateGrid). */
export function computeTotals(rows: readonly GridRow[], days: readonly string[]): GridTotals {
  const rowTotals: Record<string, number> = {}
  const dayTotals: Record<string, number> = Object.fromEntries(days.map((d) => [d, 0]))
  let total = 0
  for (const r of rows) {
    let rt = 0
    for (const d of days) {
      const p = parseHoursInput(r.cells[d])
      if (!p.ok) continue
      rt += p.value
      dayTotals[d] += p.value
      total += p.value
    }
    rowTotals[r.code_id] = roundHours(rt)
  }
  for (const d of days) dayTotals[d] = roundHours(dayTotals[d])
  return { rowTotals, dayTotals, total: roundHours(total) }
}

export function validateGrid(rows: readonly GridRow[], days: readonly string[]): GridValidation {
  const cellIssues: Record<string, CellIssue> = {}
  for (const r of rows) {
    for (const d of days) {
      const p = parseHoursInput(r.cells[d])
      if (!p.ok && p.issue) cellIssues[cellKey(r.code_id, d)] = p.issue
    }
  }
  const { dayTotals } = computeTotals(rows, days)
  const dayIssues: Record<string, string> = {}
  for (const d of days) {
    if (dayTotals[d] > MAX_HOURS_PER_DAY + 1e-9) dayIssues[d] = `${formatDayLabel(d)} adds up to ${formatHours(dayTotals[d])} hours. One day can have at most ${MAX_HOURS_PER_DAY}.`
  }
  const tooManyRows = rows.length > MAX_ROWS
  return { cellIssues, dayIssues, tooManyRows, ok: Object.keys(cellIssues).length === 0 && Object.keys(dayIssues).length === 0 && !tooManyRows }
}

export interface PayloadRow {
  code_id: string
  hours: Record<string, number>
}

/** The PATCH body rows: only cells with hours, numbers only. Call only for a valid grid. */
export function toPayloadRows(rows: readonly GridRow[], days: readonly string[]): PayloadRow[] {
  return rows.map((r) => {
    const hours: Record<string, number> = {}
    for (const d of days) {
      const p = parseHoursInput(r.cells[d])
      if (p.ok && p.value > 0) hours[d] = p.value
    }
    return { code_id: r.code_id, hours }
  })
}

/** True when the grid differs from the baseline rows (compared as numbers, so "7.50" equals "7.5"). */
export function gridDirty(rows: readonly GridRow[], baseline: readonly GridRow[], days: readonly string[]): boolean {
  const norm = (list: readonly GridRow[]) =>
    JSON.stringify(
      list.map((r) => [
        r.code_id,
        days.map((d) => {
          const p = parseHoursInput(r.cells[d])
          return p.ok ? p.value : `?${r.cells[d]}`
        }),
      ]),
    )
  return norm(rows) !== norm(baseline)
}

// ------------------------------------------------------------------------------------------------ tabs
export type TabId = 'today' | 'timesheet' | 'corrections' | 'approvals' | 'team' | 'hr'

export const TAB_LABEL: Record<TabId, string> = {
  today: 'Attendance',
  timesheet: 'Timesheet',
  corrections: 'Corrections',
  approvals: 'Approvals',
  team: 'Team',
  hr: 'HR overview',
}

export const ALL_TABS: readonly TabId[] = ['today', 'timesheet', 'corrections', 'approvals', 'team', 'hr']

/**
 * NAVIGATION HINT ONLY (the one place role names appear, like `availableScopes` in the reimbursements module):
 * it decides which tabs to OFFER. The server stays the control: every call answers 403/404 and the tab then shows
 * "not available for your account". The HR tab is offered from the server's own `can_manage` flag (GET /timesheet/codes),
 * not from a role. Probing the review/team routes to find out would write an `access.denied` audit event per refusal.
 */
export function availableTabs(roles: readonly string[] | null | undefined, canManageCodes: boolean): TabId[] {
  const r = roles ?? []
  const tabs: TabId[] = ['today', 'timesheet', 'corrections']
  if (r.includes('Manager') || r.includes('HRAdmin')) tabs.push('approvals')
  if (r.includes('Manager')) tabs.push('team')
  if (canManageCodes) tabs.push('hr')
  return tabs
}

/** An unknown or not-offered tab falls back to the first one; `forced` tabs (deep links) are honoured so the server can answer. */
export function parseTab(raw: string | null | undefined): TabId {
  return (ALL_TABS as readonly string[]).includes(raw ?? '') ? (raw as TabId) : 'today'
}

// ------------------------------------------------------------------------------------------------ labels and tones
export type Tone = 'neutral' | 'blue' | 'violet' | 'amber' | 'green' | 'red'

export function sheetStatusLabel(status: string): string {
  switch (status) {
    case 'open':
      return 'Open'
    case 'submitted':
      return 'Submitted'
    case 'approved':
      return 'Approved'
    case 'rejected':
      return 'Rejected'
    default:
      return status || '-'
  }
}
export function sheetStatusTone(status: string): Tone {
  return status === 'approved' ? 'green' : status === 'rejected' ? 'red' : status === 'submitted' ? 'blue' : 'neutral'
}

export function correctionStatusLabel(status: string): string {
  switch (status) {
    case 'pending':
      return 'Pending review'
    case 'approved':
      return 'Approved'
    case 'rejected':
      return 'Rejected'
    case 'cancelled':
      return 'Withdrawn'
    default:
      return status || '-'
  }
}
export function correctionStatusTone(status: string): Tone {
  return status === 'approved' ? 'green' : status === 'rejected' ? 'red' : status === 'pending' ? 'amber' : 'neutral'
}

export function attendanceStateLabel(state: string): string {
  switch (state) {
    case 'in':
      return 'Clocked in'
    case 'out':
      return 'Clocked out'
    case 'needs_correction':
      return 'Needs correction'
    case 'none':
      return 'No punches'
    default:
      return state || '-'
  }
}
export function attendanceStateTone(state: string): Tone {
  return state === 'in' ? 'blue' : state === 'out' ? 'green' : state === 'needs_correction' ? 'red' : 'neutral'
}

export interface DayFlag {
  key: string
  label: string
  tone: Tone
}

export interface DayRecordLike {
  open: boolean
  needs_correction: boolean
  correction: unknown | null
  pending_correction: unknown | null
}

/** Chips for a day of the month view, in a fixed order. */
export function dayFlags(d: DayRecordLike): DayFlag[] {
  const out: DayFlag[] = []
  if (d.needs_correction) out.push({ key: 'needs_correction', label: 'Needs correction', tone: 'red' })
  else if (d.open) out.push({ key: 'open', label: 'Clocked in', tone: 'blue' })
  if (d.pending_correction) out.push({ key: 'pending', label: 'Correction pending', tone: 'amber' })
  if (d.correction) out.push({ key: 'corrected', label: 'Corrected', tone: 'green' })
  return out
}

// ------------------------------------------------------------------------------------------------ errors
export interface Problem {
  status: number | null
  code: string | null
  detail: string
}

/** Friendly wording for the server's machine codes. The server's own `detail` is the fallback. */
export const CODE_TEXT: Record<string, string> = {
  already_clocked_in: 'You are already clocked in. The page has been refreshed.',
  not_clocked_in: 'You are not clocked in. The page has been refreshed.',
  needs_correction: 'An earlier session was left open for more than 16 hours. Request a correction for it before clocking in or out.',
  clock_skew: 'The clock-out time could not be recorded because it came out before the clock-in. Please try again in a moment.',
  correction_pending: 'You already have a correction waiting for review for that day. Withdraw it first or wait for the decision.',
  day_not_past: 'Pick a day in the past. Today and future days cannot be corrected.',
  day_too_old: `Corrections can only be requested for the last ${CORRECTION_WINDOW_DAYS} days.`,
  out_before_in: 'The clock-out must be after the clock-in. For a night shift tick "Clock-out is on the next day".',
  session_too_long: `A session can be at most ${MAX_SESSION_HOURS} hours.`,
  session_day_mismatch: 'That punch belongs to a different day than the one you picked.',
  comment_required: 'A comment is required when rejecting.',
  hours_step: CELL_MESSAGE.step,
  hours_range: CELL_MESSAGE.range,
  hours_invalid: CELL_MESSAGE.invalid,
  day_total_exceeded: `One day can have at most ${MAX_HOURS_PER_DAY} hours across all rows.`,
  duplicate_code: 'Each code can appear only once per timesheet.',
  day_outside_week: 'A day is outside this week.',
  too_many_rows: `A timesheet can have at most ${MAX_ROWS} rows.`,
  code_invalid: 'A code on this timesheet is unknown or no longer active. Remove it and pick another.',
  week_out_of_range: 'That week is outside the range you can open (53 weeks back to 4 weeks ahead).',
  week_in_future: 'A future week can be saved but not submitted yet.',
  empty_timesheet: 'Add some hours before submitting.',
  not_editable: 'This timesheet can no longer be edited.',
  not_recallable: 'This timesheet can no longer be recalled: it was already decided.',
  not_submitted: 'This timesheet is no longer waiting for a decision.',
  code_name_taken: 'A code with this name already exists.',
  code_in_use: 'This code is used by a timesheet. Deactivate it instead.',
}

interface AxiosLike {
  response?: { status?: number; data?: { detail?: unknown; code?: unknown; errors?: unknown } }
  code?: string
  message?: string
}

/** Turns any thrown value into something safe to show. Never throws. */
export function toProblem(error: unknown, fallback: string): Problem {
  const e = (error ?? {}) as AxiosLike
  const status = typeof e.response?.status === 'number' ? e.response.status : null
  if (status === null) return { status: null, code: null, detail: 'The server could not be reached. Check your connection and try again.' }
  const data = e.response?.data ?? {}
  const code = typeof data.code === 'string' ? data.code : null
  const rawDetail = typeof data.detail === 'string' ? data.detail : null
  if (code && CODE_TEXT[code]) return { status, code, detail: CODE_TEXT[code] }
  if (status === 422 && Array.isArray(data.errors)) return { status, code, detail: rawDetail && rawDetail !== 'Invalid request' ? rawDetail : fallback }
  if (status >= 500) return { status, code, detail: 'The server had a problem. Please try again.' }
  return { status, code, detail: rawDetail || fallback }
}

// ------------------------------------------------------------------------------------------------ correction form
export interface CorrectionDraft {
  day: string
  clock_in: string
  clock_out: string
  clock_out_next_day: boolean
  reason: string
}

export const emptyCorrection = (): CorrectionDraft => ({ day: '', clock_in: '', clock_out: '', clock_out_next_day: false, reason: '' })

export function toMinutes(hhmm: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec((hhmm ?? '').trim())
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

/** Length of the proposed session in hours, or null when it cannot be worked out yet. */
export function correctionHours(d: Pick<CorrectionDraft, 'clock_in' | 'clock_out' | 'clock_out_next_day'>): number | null {
  const a = toMinutes(d.clock_in)
  const b = toMinutes(d.clock_out)
  if (a === null || b === null) return null
  const span = b + (d.clock_out_next_day ? 1440 : 0) - a
  return span > 0 ? roundHours(span / 60) : null
}

export type CorrectionField = 'day' | 'clock_in' | 'clock_out' | 'reason'

/** Friendly early checks that mirror the server; empty object = looks valid. `today` is the COMPANY day from the server. */
export function checkCorrection(d: CorrectionDraft, today: string, windowDays: number = CORRECTION_WINDOW_DAYS): Partial<Record<CorrectionField, string>> {
  const out: Partial<Record<CorrectionField, string>> = {}
  if (!isIsoDate(d.day)) out.day = 'Pick the day to correct.'
  else if (daysBetween(d.day, today) < 1) out.day = CODE_TEXT.day_not_past
  else if (daysBetween(d.day, today) > windowDays) out.day = `Corrections can only be requested for the last ${windowDays} days.`
  if (toMinutes(d.clock_in) === null) out.clock_in = 'Enter the clock-in time.'
  if (toMinutes(d.clock_out) === null) out.clock_out = 'Enter the clock-out time.'
  if (!out.clock_in && !out.clock_out) {
    const a = toMinutes(d.clock_in) as number
    const b = (toMinutes(d.clock_out) as number) + (d.clock_out_next_day ? 1440 : 0)
    if (b <= a) out.clock_out = CODE_TEXT.out_before_in
    else if (b - a > MAX_SESSION_HOURS * 60) out.clock_out = CODE_TEXT.session_too_long
  }
  const reason = d.reason.trim()
  if (!reason) out.reason = 'Say why the punches need correcting.'
  else if (reason.length > REASON_MAX) out.reason = `Keep the reason under ${REASON_MAX} characters.`
  return out
}

/** The date range a correction day may be picked from (inclusive): yesterday back to `windowDays` days ago. */
export function correctionDayRange(today: string, windowDays: number = CORRECTION_WINDOW_DAYS): { min: string; max: string } {
  return { min: addDaysIso(today, -windowDays), max: addDaysIso(today, -1) }
}

// ------------------------------------------------------------------------------------------------ deep links
export interface TimesheetTarget {
  week: string
  employeeId: string | null
}

/** `?tab=timesheet&week=..&employee_id=..`: any day in `week` is accepted; a bad date falls back to `fallbackMonday`. */
export function parseTimesheetTarget(params: URLSearchParams, fallbackMonday: string, ownEmployeeId: string | null | undefined): TimesheetTarget {
  const rawWeek = params.get('week')
  const week = isIsoDate(rawWeek) ? mondayOf(rawWeek) : fallbackMonday
  const emp = (params.get('employee_id') ?? '').trim()
  const valid = /^[A-Za-z0-9_-]{1,40}$/.test(emp)
  return { week, employeeId: valid && emp !== ownEmployeeId ? emp : null }
}

/** Query string for a timesheet deep link (the shape the notifications use). */
export function timesheetLink(week: string, employeeId?: string | null, from?: string): string {
  const p = new URLSearchParams({ tab: 'timesheet', week })
  if (employeeId) p.set('employee_id', employeeId)
  if (from) p.set('from', from)
  return `?${p.toString()}`
}

export function correctionLink(id: string): string {
  return `?${new URLSearchParams({ tab: 'corrections', id }).toString()}`
}
