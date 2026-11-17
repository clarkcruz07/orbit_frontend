/**
 * Employee Directory API (SPEC_ADDENDUM_2 section 2). Typed against the contract; extra fields are tolerated.
 * BASIC fields are visible to every signed-in user. `employment_type`, `start_date` and `status` are present only
 * when the server decided the caller may see them, so the UI shows them only when they arrive - never by role name.
 */
import { api } from './client'

export interface PersonRef {
  employee_id: string
  name: string
}

export interface DirectoryEntry {
  employee_id: string
  name: string
  job_title: string | null
  department: string | null
  email: string | null
  manager: PersonRef | null
  avatar_initials: string | null
  /** HR-only: absent for everyone else. */
  employment_type?: string | null
  start_date?: string | null
  status?: string | null
  /** Own profile only, from Microsoft Entra. */
  company?: string | null
  office_location?: string | null
  entra_employee_id?: string | null
}

export interface DirectoryPage {
  items: DirectoryEntry[]
  total: number
  page: number
  page_size: number
  departments: string[]
}

export interface DirectReport {
  employee_id: string
  name: string
  job_title: string | null
}

export interface DirectoryProfile extends DirectoryEntry {
  direct_reports: DirectReport[]
}

export interface DirectoryQuery {
  q?: string
  department?: string
  employment_type?: string
  page?: number
  page_size?: number
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)

function personRef(v: unknown): PersonRef | null {
  const r = v as { employee_id?: unknown; name?: unknown } | null
  if (!r || typeof r !== 'object') return null
  const id = str(r.employee_id)
  return id ? { employee_id: id, name: str(r.name) ?? id } : null
}

/** Maps a raw server entry to the typed shape. HR-only keys stay absent unless the server sent them. */
export function normaliseEntry(raw: unknown): DirectoryEntry {
  const r = (raw ?? {}) as Record<string, unknown>
  const entry: DirectoryEntry = {
    employee_id: String(r.employee_id ?? ''),
    name: str(r.name) ?? 'Unnamed',
    job_title: str(r.job_title),
    department: str(r.department),
    email: str(r.email),
    manager: personRef(r.manager),
    avatar_initials: str(r.avatar_initials),
  }
  if ('employment_type' in r) entry.employment_type = str(r.employment_type)
  if ('start_date' in r) entry.start_date = str(r.start_date)
  if ('status' in r) entry.status = str(r.status)
  for (const k of ['company', 'office_location', 'entra_employee_id'] as const) if (k in r) entry[k] = str(r[k])
  return entry
}

export function normaliseDirectReports(raw: unknown): DirectReport[] {
  const reports = Array.isArray(raw) ? raw : []
  return reports
    .map((d) => {
      const x = (d ?? {}) as Record<string, unknown>
      return { employee_id: String(x.employee_id ?? ''), name: str(x.name) ?? 'Unnamed', job_title: str(x.job_title) }
    })
    .filter((d) => d.employee_id)
}

export function normaliseProfile(raw: unknown): DirectoryProfile {
  const r = (raw ?? {}) as Record<string, unknown>
  return { ...normaliseEntry(raw), direct_reports: normaliseDirectReports(r.direct_reports) }
}

export function normalisePage(raw: unknown): DirectoryPage {
  const r = (raw ?? {}) as Record<string, unknown>
  const items = Array.isArray(r.items) ? r.items.map(normaliseEntry) : []
  const depts = Array.isArray(r.departments) ? r.departments.filter((d): d is string => typeof d === 'string') : []
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
  return { items, total: num(r.total, items.length), page: num(r.page, 1), page_size: num(r.page_size, items.length || 20), departments: depts }
}

/** True when the server returned at least one HR-only field (it decided the caller may see them). */
export function pageHasHrFields(items: readonly DirectoryEntry[]): boolean {
  return items.some((i) => 'employment_type' in i || 'start_date' in i || 'status' in i)
}

/** Query-string params: blanks are dropped so the server never sees `q=&department=`. */
export function listParams(q: DirectoryQuery): Record<string, string | number> {
  const out: Record<string, string | number> = {}
  const text = (q.q ?? '').trim()
  if (text) out.q = text
  if (q.department?.trim()) out.department = q.department.trim()
  if (q.employment_type?.trim()) out.employment_type = q.employment_type.trim()
  out.page = Math.max(1, Math.floor(q.page ?? 1))
  out.page_size = Math.min(50, Math.max(1, Math.floor(q.page_size ?? 20)))
  return out
}

export const directoryApi = {
  list: (q: DirectoryQuery, signal?: AbortSignal) =>
    api.get<unknown>('/directory/employees', { params: listParams(q), signal }).then((r) => normalisePage(r.data)),
  get: (employeeId: string) =>
    api.get<unknown>(`/directory/employees/${encodeURIComponent(employeeId)}`).then((r) => normaliseProfile(r.data)),
}
