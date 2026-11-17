/**
 * Leave API module (docs/api/leave.md). Typed against the contract; calls go through the shared Bearer-token client.
 */
import { api } from '@/api/client'

export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'clarification_requested' | 'cancelled'
export type HalfDay = 'none' | 'am' | 'pm'
export type AllowedAction = 'cancel' | 'edit' | 'resubmit' | 'approve' | 'reject' | 'clarify'
export type DecisionAction = 'approve' | 'reject' | 'clarify'
export type ListScope = 'mine' | 'review' | 'team' | 'all'

export interface LeaveConfig {
  today: string
  year: number
  notice: string
  half_day_values: HalfDay[]
  window_days: number
  max_span_days: number
  statuses: LeaveStatus[]
  scopes: ListScope[]
  reason_max_chars: number
  comment_max_chars: number
}

export interface LeaveType {
  type_id: string
  name: string
  paid: boolean
  annual_days: number
  requires_reason: boolean
  active: boolean
  placeholder: boolean
  /** true/false for HR; null for everyone else. */
  in_use: boolean | null
  created_at?: string
  updated_at?: string
}

export interface TypesResponse {
  items: LeaveType[]
  total: number
  notice?: string
}

export interface TypeBody {
  name: string
  paid: boolean
  annual_days: number
  requires_reason: boolean
}
export type TypePatch = Partial<TypeBody> & { active?: boolean }

export interface EntitlementRow {
  employee_id: string
  employee_name: string | null
  type_id: string
  type_name: string | null
  year: number
  days: number
  updated_at?: string
}

export interface BalanceItem {
  type_id: string
  name: string
  paid: boolean
  active: boolean
  entitlement: number
  override: boolean
  used: number
  pending: number
  remaining: number | null
  unlimited: boolean
}

export interface BalancesResponse {
  year: number
  employee_id: string
  notice?: string
  items: BalanceItem[]
}

export interface PreviewHoliday {
  date: string
  title: string
}
export interface PreviewBalanceRow {
  year: number
  entitlement: number
  used: number
  pending: number
  requested: number
  remaining_after: number | null
}
export interface PreviewIssue {
  code: string
  message: string
}
export interface Preview {
  type_id: string
  start_date: string
  end_date: string
  half_day: HalfDay
  days: number
  days_by_year: Record<string, number>
  weekend_days: number
  holidays: PreviewHoliday[]
  balance: PreviewBalanceRow[]
  issues: PreviewIssue[]
  valid: boolean
}

export interface PreviewQuery {
  type_id: string
  start_date: string
  end_date: string
  half_day: HalfDay
}

export interface EmployeeRef {
  employee_id: string
  name: string | null
  department: string | null
  job_title: string | null
}

export interface Approver {
  kind: 'manager' | 'hr_fallback'
  employee_id: string | null
  name: string | null
}

export interface LeaveDecision {
  decision_id: string
  action: DecisionAction
  by_name: string | null
  by_role: string | null
  comment: string | null
  at: string
}

export interface LeaveRequest {
  request_id: string
  employee_id: string
  employee: EmployeeRef
  type_id: string
  type_name: string
  paid: boolean
  start_date: string
  end_date: string
  half_day: HalfDay
  days: number
  days_by_year: Record<string, number>
  reason: string | null
  status: LeaveStatus
  approver: Approver | null
  decisions: LeaveDecision[]
  created_at: string
  updated_at: string
  submitted_at: string | null
  decided_at: string | null
  cancelled_at: string | null
  version: number
  allowed_actions: AllowedAction[]
}

export interface RequestPage {
  items: LeaveRequest[]
  total: number
  page: number
  page_size: number
}

export interface ListQuery {
  scope: ListScope
  status?: string
  year?: number
  type_id?: string
  employee_id?: string
  page?: number
  page_size?: number
}

export interface CreateBody {
  type_id: string
  start_date: string
  end_date: string
  half_day: HalfDay
  reason: string | null
}
export type PatchBody = Partial<CreateBody> & { version?: number }

export interface TeamItem {
  employee_id: string
  employee_name: string
  department: string | null
  type_id: string
  type_name: string
  start_date: string
  end_date: string
  half_day: HalfDay
  days: number
  own: boolean
}
export interface TeamMonth {
  month: string
  days_in_month: number
  total: number
  items: TeamItem[]
}

const enc = encodeURIComponent
/** Drops undefined / empty values so the query string only carries what the user chose. */
function clean<T extends object>(o: T): Partial<T> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') out[k] = v
  return out as Partial<T>
}

export const leaveApi = {
  config: () => api.get<LeaveConfig>('/leave/config').then((r) => r.data),

  types: (includeInactive = false) =>
    api.get<TypesResponse>('/leave/types', { params: includeInactive ? { include_inactive: true } : undefined }).then((r) => r.data),
  createType: (body: TypeBody) => api.post<LeaveType>('/leave/types', body).then((r) => r.data),
  patchType: (typeId: string, body: TypePatch) => api.patch<LeaveType>(`/leave/types/${enc(typeId)}`, body).then((r) => r.data),
  deleteType: (typeId: string) => api.delete(`/leave/types/${enc(typeId)}`).then(() => undefined),

  entitlements: (q: { employee_id?: string; year?: number; type_id?: string } = {}) =>
    api.get<{ items: EntitlementRow[]; total: number }>('/leave/entitlements', { params: clean(q) }).then((r) => r.data),
  setEntitlement: (body: { employee_id: string; type_id: string; year: number; days: number }) =>
    api.post<EntitlementRow>('/leave/entitlements', body).then((r) => r.data),
  removeEntitlement: (q: { employee_id: string; type_id: string; year: number }) =>
    api.delete('/leave/entitlements', { params: q }).then(() => undefined),

  balances: (year?: number, employeeId?: string) =>
    api.get<BalancesResponse>('/leave/balances', { params: clean({ year, employee_id: employeeId }) }).then((r) => r.data),

  preview: (q: PreviewQuery, signal?: AbortSignal) => api.get<Preview>('/leave/preview', { params: q, signal }).then((r) => r.data),

  team: (month?: string) => api.get<TeamMonth>('/leave/team', { params: clean({ month }) }).then((r) => r.data),

  list: (q: ListQuery) => api.get<RequestPage>('/leave/requests', { params: clean(q) }).then((r) => r.data),
  create: (body: CreateBody) => api.post<LeaveRequest>('/leave/requests', body).then((r) => r.data),
  get: (id: string) => api.get<LeaveRequest>(`/leave/requests/${enc(id)}`).then((r) => r.data),
  patch: (id: string, body: PatchBody) => api.patch<LeaveRequest>(`/leave/requests/${enc(id)}`, body).then((r) => r.data),
  resubmit: (id: string, version?: number) =>
    api.post<LeaveRequest>(`/leave/requests/${enc(id)}/resubmit`, version === undefined ? undefined : { version }).then((r) => r.data),
  cancel: (id: string, version?: number) =>
    api.post<LeaveRequest>(`/leave/requests/${enc(id)}/cancel`, version === undefined ? undefined : { version }).then((r) => r.data),
  decide: (id: string, action: DecisionAction, comment: string | null, version?: number) =>
    api
      .post<LeaveRequest>(`/leave/requests/${enc(id)}/decision`, clean({ action, comment: comment || undefined, version }))
      .then((r) => r.data),
}
