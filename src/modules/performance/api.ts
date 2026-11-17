/**
 * Performance & Check-ins API (docs/api/performance.md). Typed against the contract.
 * No ratings, scores, rankings or pay/promotion effect.
 * Only GET, POST and PATCH are used (CORS allows nothing else).
 */
import { api } from '@/api/client'

export type GoalStatus = 'not_started' | 'in_progress' | 'done' | 'dropped'
export type CheckinStatus = 'requested' | 'submitted' | 'acknowledged'
export type GoalAction = 'edit' | 'comment'
export type CheckinAction = 'submit' | 'acknowledge'
export type GoalScope = 'mine' | 'team' | 'all'
export type CheckinScope = 'mine' | 'team' | 'review' | 'all'

export interface EmployeeBrief {
  employee_id: string
  name: string | null
  department: string | null
  job_title: string | null
}

export interface GoalComment {
  comment_id: string
  by: { employee_id: string; name: string | null }
  text: string
  at: string
}

export interface Goal {
  goal_id: string
  employee: EmployeeBrief
  title: string
  description: string
  due_date: string | null
  status: GoalStatus
  progress: number
  overdue: boolean
  comment_count: number
  created_at: string
  updated_at: string
  version: number
  allowed_actions: GoalAction[]
  /** Present on detail responses only. */
  comments?: GoalComment[]
}

export interface Checkin {
  checkin_id: string
  employee: EmployeeBrief
  period_label: string
  status: CheckinStatus
  origin: 'employee' | 'manager'
  requested_by: { employee_id: string; name: string | null } | null
  requested_at: string | null
  accomplishments: string
  blockers: string
  next_steps: string
  mood: number | null
  mood_visible: boolean
  submitted_at: string | null
  reviewer: { kind: 'manager' | 'hr'; employee_id: string | null; name: string | null } | null
  acknowledged_at: string | null
  acknowledged_by: { employee_id: string | null; name: string | null; kind: 'manager' | 'hr' } | null
  feedback: string | null
  created_at: string
  updated_at: string
  version: number
  allowed_actions: CheckinAction[]
}

export interface Page<T> {
  items: T[]
  total: number
  page: number
  page_size: number
}

export interface PerformanceConfig {
  limits: {
    goal_title_max: number
    goal_description_max: number
    comment_max: number
    period_label_max: number
    checkin_text_max: number
    feedback_max: number
    max_goals_per_employee: number
    max_comments_per_goal: number
  }
  goal_statuses: string[]
  checkin_statuses: string[]
  mood_scale: { min: number; max: number }
  hr_can_see_mood: boolean
  notice: string
}

export interface PerformanceSummary {
  goals: { total: number; not_started: number; in_progress: number; done: number; dropped: number; overdue: number }
  checkins: { requested_of_me: number; submitted: number; acknowledged: number }
  team: null | { direct_reports: number; reviews_waiting: number; open_goals: number }
}

export interface OverviewDepartment {
  department: string
  requested: number
  submitted: number
  acknowledged: number
  total: number
  completed: number
  completion_pct: number
}
export interface OverviewPeriod extends Omit<OverviewDepartment, 'department'> {
  period_label: string
  by_department: OverviewDepartment[]
}
export interface PerformanceOverview {
  periods: OverviewPeriod[]
  goals: { total: number; by_status: Record<GoalStatus, number> }
  departments: string[]
}

export interface GoalQuery {
  scope?: GoalScope
  status?: string
  employee_id?: string
  page?: number
  page_size?: number
}
export interface CheckinQuery {
  scope?: CheckinScope
  status?: string
  period?: string
  employee_id?: string
  page?: number
  page_size?: number
}

export interface GoalCreate {
  title: string
  description?: string
  due_date?: string | null
}
export interface GoalPatch {
  title?: string
  description?: string
  due_date?: string | null
  status?: GoalStatus
  progress?: number
  version?: number
}
export interface CheckinCreate {
  period_label: string
  accomplishments?: string
  blockers?: string
  next_steps?: string
  mood?: number | null
}
export type CheckinFill = Omit<CheckinCreate, 'period_label'>

const enc = encodeURIComponent

/** Blank filters are dropped so the server never sees `status=&period=`. */
export function cleanParams(q: object): Record<string, string | number> {
  const out: Record<string, string | number> = {}
  for (const [k, v] of Object.entries(q as Record<string, unknown>)) {
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v
    else if (typeof v === 'string' && v.trim()) out[k] = v.trim()
  }
  return out
}

export const performanceApi = {
  config: () => api.get<PerformanceConfig>('/performance/config'),
  summary: () => api.get<PerformanceSummary>('/performance/summary'),
  goals: (q: GoalQuery = {}) => api.get<Page<Goal>>('/performance/goals', { params: cleanParams({ scope: 'mine', ...q }) }),
  goal: (id: string) => api.get<Goal>(`/performance/goals/${enc(id)}`),
  createGoal: (body: GoalCreate) => api.post<Goal>('/performance/goals', body),
  patchGoal: (id: string, body: GoalPatch) => api.patch<Goal>(`/performance/goals/${enc(id)}`, body),
  commentGoal: (id: string, text: string) => api.post<Goal>(`/performance/goals/${enc(id)}/comments`, { text }),
  checkins: (q: CheckinQuery = {}) => api.get<Page<Checkin>>('/performance/checkins', { params: cleanParams({ scope: 'mine', ...q }) }),
  checkin: (id: string) => api.get<Checkin>(`/performance/checkins/${enc(id)}`),
  createCheckin: (body: CheckinCreate) => api.post<Checkin>('/performance/checkins', body),
  requestCheckin: (employeeId: string, periodLabel: string) =>
    api.post<Checkin>('/performance/checkins/request', { employee_id: employeeId, period_label: periodLabel }),
  fillCheckin: (id: string, body: CheckinFill) => api.post<Checkin>(`/performance/checkins/${enc(id)}/submit`, body),
  acknowledge: (id: string, feedback?: string) =>
    api.post<Checkin>(`/performance/checkins/${enc(id)}/acknowledge`, feedback && feedback.trim() ? { feedback: feedback.trim() } : {}),
  overview: (q: { period?: string; department?: string } = {}) => api.get<PerformanceOverview>('/performance/overview', { params: cleanParams(q) }),
}
