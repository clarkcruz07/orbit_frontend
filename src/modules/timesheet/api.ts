/**
 * Attendance & Timesheet API (contract: docs/api/timesheet.md). Typed against the documented shapes.
 * Browser CORS allows GET/POST/PATCH only,
 * so saving a sheet and editing a code use PATCH and nothing here calls DELETE.
 */
import { api } from '@/api/client'

export interface PersonCard {
  employee_id: string
  name: string
}
export interface ApproverCard {
  kind: 'manager' | 'hr_fallback'
  employee_id: string | null
  name: string | null
}

export interface TimesheetConfig {
  timezone: string
  now: string
  today: string
  current_week_start: string
  max_session_hours: number
  max_hours_per_day: number
  hour_step: number
  max_rows: number
  correction_window_days: number
  notice: string
  /** Raw server value; read it with normalisePayCalendar (absent -> null). */
  pay_calendar?: unknown
}

// ---------------------------------------------------------------------------------------------- attendance
export type SessionStatus = 'open' | 'needs_correction' | 'closed' | 'resolved_by_correction'
export interface Session {
  session_id: string
  day: string
  clock_in: string
  clock_out: string | null
  status: SessionStatus
  needs_correction: boolean
  hours: number | null
  elapsed_hours: number | null
  correction_id: string | null
}

export type AttendanceAction = 'clock_in' | 'clock_out' | 'request_correction'
export interface AttendanceStatus {
  now: string
  today: string
  timezone: string
  open_session: Session | null
  needs_correction: boolean
  max_session_hours: number
  allowed_actions: AttendanceAction[]
}

export interface CorrectionBrief {
  correction_id: string
  status: CorrectionStatus
  clock_in: string
  clock_out: string
  hours: number
  decided_at: string | null
  payday?: unknown
}

export interface DayRecord {
  date: string
  weekday: string
  is_today: boolean
  sessions: Session[]
  worked_hours: number
  open: boolean
  needs_correction: boolean
  correction: CorrectionBrief | null
  pending_correction: CorrectionBrief | null
  effective: { source: 'punches' | 'correction'; first_in: string; last_out: string | null; hours: number } | null
  can_request_correction: boolean
}

export interface MonthAttendance {
  employee: PersonCard
  month: string
  timezone: string
  today: string
  days: DayRecord[]
  totals: { hours: number; days_worked: number; needs_correction_days: number }
}

export interface TeamDayRow {
  employee_id: string
  name: string
  job_title: string | null
  state: 'none' | 'in' | 'out' | 'needs_correction'
  first_in: string | null
  last_out: string | null
  hours: number
}
export interface TeamDay {
  date: string
  timezone: string
  items: TeamDayRow[]
  total: number
  page: number
  page_size: number
}

// ---------------------------------------------------------------------------------------------- corrections
export type CorrectionStatus = 'pending' | 'approved' | 'rejected' | 'cancelled'
export type CorrectionAction = 'cancel' | 'approve' | 'reject'
export interface Decision {
  action: 'approve' | 'reject'
  by: { name: string }
  at: string
  comment: string | null
  approver_kind: 'manager' | 'hr_fallback'
}
export interface Correction {
  correction_id: string
  employee: PersonCard
  day: string
  clock_in: string
  clock_out: string
  local_clock_in: string
  local_clock_out: string
  clock_out_next_day: boolean
  hours: number
  timezone: string
  session_id: string | null
  reason: string
  status: CorrectionStatus
  submitted_at: string
  decided_at: string | null
  decision: Decision | null
  approver: ApproverCard
  version: number
  allowed_actions: CorrectionAction[]
  /** Raw server value; read it with normalisePayday (absent or null for older rows). */
  payday?: unknown
}
export interface Page<T> {
  items: T[]
  total: number
  page: number
  page_size: number
}
export interface CorrectionInput {
  day: string
  clock_in: string
  clock_out: string
  clock_out_next_day: boolean
  reason: string
  session_id?: string
}

// ---------------------------------------------------------------------------------------------- codes and sheets
export interface Code {
  code_id: string
  name: string
  billable: boolean
  active: boolean
  version: number
  placeholder: boolean
}
export interface CodeList {
  items: Code[]
  total: number
  notice: string
  can_manage: boolean
}

export type SheetStatus = 'open' | 'submitted' | 'approved' | 'rejected'
export type SheetAction = 'edit' | 'submit' | 'recall' | 'approve' | 'reject'
export interface SheetRow {
  code_id: string
  code_name: string
  billable: boolean
  code_active: boolean
  hours: Record<string, number>
  total: number
}
export interface SheetDecision {
  decision_id: string
  action: 'approve' | 'reject'
  by: { name: string }
  at: string
  comment: string | null
  approver_kind: 'manager' | 'hr_fallback'
  submission_no: number
}
export interface Sheet {
  sheet_id: string
  employee: PersonCard
  week_start: string
  week_end: string
  days: string[]
  status: SheetStatus
  rows: SheetRow[]
  day_totals: Record<string, number>
  total_hours: number
  version: number
  persisted: boolean
  submitted_at: string | null
  decided_at: string | null
  decision: SheetDecision | null
  decisions: SheetDecision[]
  approver: ApproverCard
  is_future_week: boolean
  is_current_week: boolean
  allowed_actions: SheetAction[]
  timezone: string
  limits: { max_hours_per_day: number; step: number; max_rows: number }
  prev_week?: string
  next_week?: string
}

export interface SheetSummary {
  sheet_id: string
  employee: PersonCard
  week_start: string
  week_end: string
  status: SheetStatus
  total_hours: number
  submitted_at: string | null
  decided_at: string | null
  version: number
}

export interface ReviewItem {
  type: 'timesheet' | 'correction'
  id: string
  submitted_at: string
  allowed_actions: string[]
  approver: ApproverCard
  sheet: SheetSummary | null
  correction: {
    correction_id: string
    employee: PersonCard
    day: string
    local_clock_in: string
    local_clock_out: string
    clock_out_next_day: boolean
    hours: number
    status: CorrectionStatus
    version: number
    payday?: unknown
  } | null
}
export interface ReviewQueue extends Page<ReviewItem> {
  counts: { sheets: number; corrections: number }
}

export interface TeamWeekRow {
  employee_id: string
  name: string
  job_title: string | null
  sheet_id: string
  status: SheetStatus
  total_hours: number
  submitted_at: string | null
  persisted: boolean
}
export interface TeamWeek extends Page<TeamWeekRow> {
  week_start: string
  week_end: string
  total_hours: number
}

export interface HrOverview {
  week_start: string
  week_end: string
  active_employees: number
  counts: { open: number; submitted: number; approved: number; rejected: number }
  no_sheet: number
  pending_corrections: number
}

export type ReviewKind = 'all' | 'sheets' | 'corrections'
export type DecisionBody = { action: 'approve' | 'reject'; comment?: string; version?: number }

// ---------------------------------------------------------------------------------------------- calls
const data = <T>(p: Promise<{ data: T }>): Promise<T> => p.then((r) => r.data)

export const timesheetApi = {
  config: () => data(api.get<TimesheetConfig>('/timesheet/config')),

  status: () => data(api.get<AttendanceStatus>('/attendance/status')),
  clockIn: () => data(api.post<Session>('/attendance/clock-in')),
  clockOut: () => data(api.post<Session>('/attendance/clock-out')),
  myMonth: (month?: string) => data(api.get<MonthAttendance>('/attendance/me', { params: month ? { month } : undefined })),
  employeeMonth: (employeeId: string, month?: string) =>
    data(api.get<MonthAttendance>(`/attendance/employees/${encodeURIComponent(employeeId)}`, { params: month ? { month } : undefined })),
  teamDay: (date?: string, page = 1) => data(api.get<TeamDay>('/attendance/team', { params: { ...(date ? { date } : {}), page, page_size: 50 } })),

  corrections: (scope: 'mine' | 'review' | 'team' | 'all', status?: string, page = 1) =>
    data(api.get<Page<Correction>>('/attendance/corrections', { params: { scope, ...(status ? { status } : {}), page, page_size: 20 } })),
  correction: (id: string) => data(api.get<Correction>(`/attendance/corrections/${encodeURIComponent(id)}`)),
  requestCorrection: (body: CorrectionInput) => data(api.post<Correction>('/attendance/corrections', body)),
  decideCorrection: (id: string, body: DecisionBody) => data(api.post<Correction>(`/attendance/corrections/${encodeURIComponent(id)}/decision`, body)),
  cancelCorrection: (id: string, version?: number) =>
    data(api.post<Correction>(`/attendance/corrections/${encodeURIComponent(id)}/cancel`, version === undefined ? {} : { version })),

  codes: (includeInactive = false) => data(api.get<CodeList>('/timesheet/codes', { params: includeInactive ? { include_inactive: true } : undefined })),
  createCode: (body: { name: string; billable: boolean; active: boolean }) => data(api.post<Code>('/timesheet/codes', body)),
  updateCode: (id: string, body: { name?: string; billable?: boolean; active?: boolean; version?: number }) =>
    data(api.patch<Code>(`/timesheet/codes/${encodeURIComponent(id)}`, body)),

  mySheet: (week?: string) => data(api.get<Sheet>('/timesheet/me', { params: week ? { week } : undefined })),
  sheet: (sheetId: string) => data(api.get<Sheet>(`/timesheet/sheets/${encodeURIComponent(sheetId)}`)),
  saveSheet: (sheetId: string, rows: { code_id: string; hours: Record<string, number> }[], version?: number) =>
    data(api.patch<Sheet>(`/timesheet/sheets/${encodeURIComponent(sheetId)}`, { rows, ...(version === undefined ? {} : { version }) })),
  submitSheet: (sheetId: string, version?: number) =>
    data(api.post<Sheet>(`/timesheet/sheets/${encodeURIComponent(sheetId)}/submit`, version === undefined ? {} : { version })),
  recallSheet: (sheetId: string, version?: number) =>
    data(api.post<Sheet>(`/timesheet/sheets/${encodeURIComponent(sheetId)}/recall`, version === undefined ? {} : { version })),
  decideSheet: (sheetId: string, body: DecisionBody) => data(api.post<Sheet>(`/timesheet/sheets/${encodeURIComponent(sheetId)}/decision`, body)),

  review: (kind: ReviewKind = 'all', page = 1) => data(api.get<ReviewQueue>('/timesheet/review', { params: { kind, page, page_size: 20 } })),
  teamWeek: (week?: string, page = 1) => data(api.get<TeamWeek>('/timesheet/team', { params: { ...(week ? { week } : {}), page, page_size: 50 } })),
  overview: (week?: string) => data(api.get<HrOverview>('/timesheet/overview', { params: week ? { week } : undefined })),
}
