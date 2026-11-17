/**
 * Settings API module (docs/api/preferences.md, docs/api/livedash.md section 1). Typed against the contract; every call goes
 * through the shared Bearer-token client. Responses are normalised so a missing or odd field can never crash the page.
 *
 * Note: `PUT` is same-origin through the Vite `/api` proxy (the normal setup); the API's CORS list has no PUT.
 */
import { api } from '@/api/client'

// ------------------------------------------------------------------------------------------------ notification groups
export const GROUP_ORDER = ['reimbursements', 'leave', 'timesheet', 'performance', 'learning', 'documents', 'cases'] as const
export type PrefGroup = (typeof GROUP_ORDER)[number]

/** Used only when the server sends no label/description for a group; the server's own wording wins. */
export const GROUP_FALLBACK: Record<PrefGroup, { label: string; description: string }> = {
  reimbursements: { label: 'Reimbursements', description: 'Requests waiting for your review and decisions on your own requests.' },
  leave: { label: 'Leave', description: 'Leave requests waiting for your decision and decisions on your own leave.' },
  timesheet: { label: 'Attendance and timesheets', description: 'Timesheets and attendance corrections waiting for you, and decisions on yours.' },
  performance: { label: 'Performance and check-ins', description: 'Check-in requests, submitted check-ins, feedback and goal comments.' },
  learning: { label: 'Learning and development', description: 'Courses assigned to you, due dates and completion reviews.' },
  documents: { label: 'Documents and policies', description: 'New policies to read and documents that are about to expire.' },
  cases: { label: 'HR requests', description: 'New cases, replies and status changes on HR requests.' },
}

export interface PrefItem {
  group: PrefGroup
  label: string
  description: string
  enabled: boolean
}

export interface MyPreferences {
  items: PrefItem[]
  updated_at: string | null
}

const isGroup = (g: unknown): g is PrefGroup => typeof g === 'string' && (GROUP_ORDER as readonly string[]).includes(g)
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)

/** Items come from `items` (labels and order); `groups` fills any group the list misses. Missing = on (the server default). */
export function normalisePreferences(raw: unknown): MyPreferences {
  const r = obj(raw)
  const groups = obj(r.groups)
  const byGroup = new Map<PrefGroup, PrefItem>()
  for (const it of Array.isArray(r.items) ? r.items : []) {
    const o = obj(it)
    if (!isGroup(o.group)) continue
    const fb = GROUP_FALLBACK[o.group]
    byGroup.set(o.group, {
      group: o.group,
      label: text(o.label) ?? fb.label,
      description: text(o.description) ?? fb.description,
      enabled: typeof o.enabled === 'boolean' ? o.enabled : groups[o.group] !== false,
    })
  }
  const items: PrefItem[] = []
  for (const g of GROUP_ORDER) {
    const found = byGroup.get(g)
    items.push(found ?? { group: g, label: GROUP_FALLBACK[g].label, description: GROUP_FALLBACK[g].description, enabled: groups[g] !== false })
  }
  return { items, updated_at: text(r.updated_at) }
}

// ------------------------------------------------------------------------------------------------ HR settings
export interface ChangeStamp {
  updated_at: string | null
  updated_by: string | null
}

export interface HrSettings {
  hr_can_see_mood: boolean
  updated: { hr_can_see_mood: ChangeStamp | null }
}

function stamp(v: unknown): ChangeStamp | null {
  if (!v || typeof v !== 'object') return null
  const o = obj(v)
  return { updated_at: text(o.updated_at), updated_by: text(o.updated_by) }
}

export function normaliseSettings(raw: unknown): HrSettings {
  const r = obj(raw)
  const u = obj(r.updated)
  return {
    hr_can_see_mood: r.hr_can_see_mood === true,
    updated: { hr_can_see_mood: stamp(u.hr_can_see_mood) },
  }
}

export interface SettingsOverview {
  company_timezone: string | null
  version: string | null
  roles_editable: boolean
}

export function normaliseOverview(raw: unknown): SettingsOverview {
  const r = obj(raw)
  return { company_timezone: text(r.company_timezone), version: text(r.version), roles_editable: r.roles_editable === true }
}

// ------------------------------------------------------------------------------------------------ users and roles
export interface UserRow {
  user_id: string
  name: string
  email: string
  roles: string[]
  employee_id: string | null
  auth_source: string
  is_demo: boolean
  department: string | null
  job_title: string | null
}

export interface UsersPage {
  items: UserRow[]
  total: number
  page: number
  page_size: number
  roles_editable: boolean
}

const int = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.trunc(v)) : fallback)

export function normaliseUsers(raw: unknown): UsersPage {
  const r = obj(raw)
  const items: UserRow[] = []
  for (const it of Array.isArray(r.items) ? r.items : []) {
    const o = obj(it)
    const id = text(o.user_id)
    if (!id) continue
    items.push({
      user_id: id,
      name: text(o.name) ?? text(o.email) ?? id,
      email: text(o.email) ?? '',
      roles: Array.isArray(o.roles) ? o.roles.filter((x): x is string => typeof x === 'string') : [],
      employee_id: text(o.employee_id),
      auth_source: text(o.auth_source) ?? 'password',
      is_demo: o.is_demo === true,
      department: text(o.department),
      job_title: text(o.job_title),
    })
  }
  return { items, total: int(r.total, items.length), page: Math.max(1, int(r.page, 1)), page_size: Math.max(1, int(r.page_size, 20)), roles_editable: r.roles_editable === true }
}

export const USERS_PAGE_SIZE = 20
export const USERS_QUERY_MAX = 64

// ------------------------------------------------------------------------------------------------ calls
export const settingsApi = {
  preferences: () => api.get<unknown>('/preferences/me').then((r) => normalisePreferences(r.data)),
  /** Partial update: only the listed groups change. Resolves with the server's new state. */
  savePreferences: (groups: Partial<Record<PrefGroup, boolean>>) => api.put<unknown>('/preferences/me', { groups }).then((r) => normalisePreferences(r.data)),

  /** 200 for HRAdmin, 403 for everyone else: the page offers the HR tabs only when this succeeds. */
  settings: () => api.get<unknown>('/settings').then((r) => normaliseSettings(r.data)),
  saveSettings: (patch: { hr_can_see_mood?: boolean }) => api.put<unknown>('/settings', patch).then((r) => normaliseSettings(r.data)),
  overview: () => api.get<unknown>('/settings/overview').then((r) => normaliseOverview(r.data)),
  users: (params: { q?: string; page?: number; pageSize?: number }, signal?: AbortSignal) =>
    api
      .get<unknown>('/settings/users', { params: { ...(params.q ? { q: params.q } : {}), page: params.page ?? 1, page_size: params.pageSize ?? USERS_PAGE_SIZE }, signal })
      .then((r) => normaliseUsers(r.data)),
}
