import { api } from './client'

/** Response of GET /hr/dashboard: computed live from the app's records. */
export interface LifecycleBlock {
  total: number
  completed: number
  in_progress: number
  not_started: number
  pct: number
}

export interface HrDashboard {
  summary: {
    headcount: { value: number; delta_pct: number; period: string }
    onboarding: { value: number; status: string }
    offboarding: { value: number; status: string }
    expiring_documents: { value: number; window_days: number }
    policy_acknowledgement: { pct: number; delta_pp: number }
  }
  headcount_trend: { month: string; value: number }[]
  onboarding: LifecycleBlock
  offboarding: LifecycleBlock
  directory: { total: number; full_time: number; part_time: number; contractor: number; intern: number }
  hr_cases: { active: number; high: number; medium: number; low: number; avg_resolution_days: number; delta_pct: number }
  microsoft_accounts?: { synced: number; active_users: number; not_signed_in: number; roles: { role: string; count: number }[] }
  birthdays: { name: string; team: string; date: string; avatar_initials: string }[]
  holidays: { month: string | number; day: number; name: string; type: string }[]
}

export const dashboardApi = {
  hrDashboard: () => api.get<HrDashboard>('/hr/dashboard'),
}
