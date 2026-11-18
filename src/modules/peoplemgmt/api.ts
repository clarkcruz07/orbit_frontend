/**
 * People management + Holidays API (docs/api/peoplemgmt.md, docs/api/holidays.md). Typed against the contracts.
 * Every route here is HR only: the SERVER answers 403 to anyone else and the pages show that answer. Nothing in this file
 * looks at a role. A token is never put in a URL: files are sent as multipart bodies and the template comes back as a blob.
 */
import { api } from '@/api/client'
import { normaliseProfile, type EmployeeProfile, type ProfileBody, type ProfilePatch } from '@/api/profile'
import { normaliseSyncStatus, type SyncStatus } from './entraSync'

export type { EmployeeProfile, ProfileBody, ProfilePatch } from '@/api/profile'

export type EmploymentType = 'full_time' | 'part_time' | 'contractor' | 'intern'
export type Role = 'Employee' | 'Manager' | 'HRAdmin' | 'Finance'
export type PersonStatus = 'active' | 'left'
export type AccountSource = 'hr_created' | 'entra_bootstrap' | 'demo' | 'other'
export type DisabledReason = 'deactivated' | 'sign_in_off'

export interface ManagerRef {
  employee_id: string
  name: string
}

export interface PersonEmployee {
  employee_id: string
  name: string
  email: string
  job_title: string
  department: string
  employment_type: EmploymentType | string
  manager_id: string | null
  manager: ManagerRef | null
  start_date: string | null
  end_date: string | null
  status: PersonStatus | string
  birthday: string | null
  is_demo: boolean
  /** Where the person came from: 'entra' (synced from Microsoft), 'hr_created', ... Anything the server omits reads as 'other'. */
  source: string
  /** 'entra_sync' when the Microsoft sync marked this person as left. */
  left_reason: string | null
  avatar_initials: string
  /** All five sections, always present (empty strings when not on file). The list omits the sensitive ones, so they read as empty there. */
  profile: EmployeeProfile
}

export interface PersonAccount {
  has_account: boolean
  can_sign_in: boolean
  roles: Role[]
  source: AccountSource | null
  disabled: boolean
  disabled_reason: DisabledReason | null
  user_id: string | null
}

export interface Person {
  employee: PersonEmployee
  account: PersonAccount
}

export interface PeoplePage {
  items: Person[]
  total: number
  page: number
  page_size: number
}

export interface ListQuery {
  q?: string
  status?: PersonStatus | ''
  page?: number
  page_size?: number
}

/** Body of POST /people/employees. */
export interface CreateBody {
  name: string
  email: string
  job_title: string
  department: string
  employment_type: string
  manager_id: string | null
  start_date: string | null
  birthday: string | null
  roles: string[]
  can_sign_in: boolean
  /** Optional HR profile sections; only sections with a value are sent. */
  profile?: ProfileBody
}

/** Body of PATCH /people/employees/{id}: only the fields that changed (and, for the profile, only the changed keys of one section). */
export type PatchBody = Partial<Omit<CreateBody, 'roles' | 'profile'>> & { profile?: ProfilePatch }

export interface DeactivateBody {
  end_date?: string
  reassign_reports_to?: string
}

export type ImportRowStatus = 'created' | 'skipped' | 'invalid'

export interface ImportRow {
  row: number
  status: ImportRowStatus
  reason: string | null
  message: string | null
  employee_id: string | null
  field_errors: Record<string, string>
}

export interface ImportReport {
  dry_run: boolean
  total: number
  created: number
  skipped: number
  invalid: number
  ignored_columns: string[]
  rows: ImportRow[]
}

export type HolidayType = 'public' | 'company'

export interface Holiday {
  holiday_id: string | null
  name: string
  type: HolidayType | string
  date: string | null
  month: number | null
  day: number | null
  recurring: boolean
  active: boolean
  date_in_year: string | null
  /** 'ai': filled in automatically from the AI, not yet confirmed by HR. Editing it makes it 'manual'. */
  source: 'ai' | 'manual'
}

/** pending: the server is fetching this year's holidays right now; failed: it tried and could not; off: no AI is set up. */
export type HolidaySync = 'ready' | 'pending' | 'failed' | 'off'

export interface HolidaysResponse {
  year: number
  items: Holiday[]
  sync: HolidaySync
}

export interface HolidayBody {
  name?: string
  type?: string
  date?: string | null
  month?: number | null
  day?: number | null
  active?: boolean
}

// ------------------------------------------------------------------------------------------------ errors
/** What a failed call tells us, in one place. The server's `detail` is client-safe by contract and is shown for 4xx answers. */
export interface ApiFailure {
  /** null: the service could not be reached (no HTTP answer). */
  status: number | null
  code: string | null
  detail: string | null
  fieldErrors: Record<string, string>
  /** A single offending field (holidays use `field`). */
  field: string | null
  activeDirectReports: number | null
  missingColumns: string[]
  maxRows: number | null
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)

export function parseFailure(err: unknown): ApiFailure {
  const e = err as { response?: { status?: number; data?: unknown } } | null
  const status = typeof e?.response?.status === 'number' ? e.response.status : null
  const data = (e?.response?.data ?? {}) as Record<string, unknown>
  const fe: Record<string, string> = {}
  const raw = data.field_errors
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (typeof v === 'string') fe[k] = v
  }
  const adr = data.active_direct_reports
  const cols = Array.isArray(data.missing_columns) ? data.missing_columns.filter((c): c is string => typeof c === 'string') : []
  return {
    status,
    code: str(data.code),
    detail: typeof data.detail === 'string' ? str(data.detail) : null,
    fieldErrors: fe,
    field: str(data.field),
    activeDirectReports: typeof adr === 'number' && Number.isFinite(adr) ? adr : null,
    missingColumns: cols,
    maxRows: typeof data.max_rows === 'number' ? data.max_rows : null,
  }
}

// ------------------------------------------------------------------------------------------------ normalisers
const text = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d)
const nullableText = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)
const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)

function managerRef(v: unknown): ManagerRef | null {
  const r = v as { employee_id?: unknown; name?: unknown } | null
  if (!r || typeof r !== 'object' || typeof r.employee_id !== 'string') return null
  return { employee_id: r.employee_id, name: text(r.name, r.employee_id) }
}

export function normalisePerson(raw: unknown): Person {
  const r = (raw ?? {}) as { employee?: Record<string, unknown>; account?: Record<string, unknown> }
  const e = r.employee ?? {}
  const a = r.account ?? {}
  const roles = Array.isArray(a.roles) ? a.roles.filter((x): x is Role => typeof x === 'string') : []
  return {
    employee: {
      employee_id: text(e.employee_id),
      name: text(e.name, 'Unnamed'),
      email: text(e.email),
      job_title: text(e.job_title),
      department: text(e.department),
      employment_type: text(e.employment_type),
      manager_id: nullableText(e.manager_id),
      manager: managerRef(e.manager),
      start_date: nullableText(e.start_date),
      end_date: nullableText(e.end_date),
      status: text(e.status, 'active'),
      birthday: nullableText(e.birthday),
      is_demo: e.is_demo === true,
      source: text(e.source, 'other'),
      left_reason: nullableText(e.left_reason),
      avatar_initials: text(e.avatar_initials),
      profile: normaliseProfile(e.profile),
    },
    account: {
      has_account: a.has_account === true,
      can_sign_in: a.can_sign_in === true,
      roles,
      source: nullableText(a.source) as AccountSource | null,
      disabled: a.disabled === true,
      disabled_reason: nullableText(a.disabled_reason) as DisabledReason | null,
      user_id: nullableText(a.user_id),
    },
  }
}

export function normalisePage(raw: unknown): PeoplePage {
  const r = (raw ?? {}) as Record<string, unknown>
  const items = Array.isArray(r.items) ? r.items.map(normalisePerson) : []
  return { items, total: num(r.total, items.length), page: num(r.page, 1), page_size: num(r.page_size, items.length || 20) }
}

export function normaliseReport(raw: unknown): ImportReport {
  const r = (raw ?? {}) as Record<string, unknown>
  const rows = (Array.isArray(r.rows) ? r.rows : []).map((x): ImportRow => {
    const o = (x ?? {}) as Record<string, unknown>
    const fe: Record<string, string> = {}
    if (o.field_errors && typeof o.field_errors === 'object') {
      for (const [k, v] of Object.entries(o.field_errors as Record<string, unknown>)) if (typeof v === 'string') fe[k] = v
    }
    const st = o.status === 'created' || o.status === 'skipped' ? o.status : 'invalid'
    return { row: num(o.row, 0), status: st, reason: nullableText(o.reason), message: nullableText(o.message), employee_id: nullableText(o.employee_id), field_errors: fe }
  })
  return {
    dry_run: r.dry_run === true,
    total: num(r.total, rows.length),
    created: num(r.created, 0),
    skipped: num(r.skipped, 0),
    invalid: num(r.invalid, 0),
    ignored_columns: Array.isArray(r.ignored_columns) ? r.ignored_columns.filter((c): c is string => typeof c === 'string') : [],
    rows,
  }
}

export function normaliseHoliday(raw: unknown): Holiday {
  const r = (raw ?? {}) as Record<string, unknown>
  return {
    holiday_id: nullableText(r.holiday_id),
    name: text(r.name),
    type: text(r.type, 'company'),
    date: nullableText(r.date),
    month: typeof r.month === 'number' ? r.month : null,
    day: typeof r.day === 'number' ? r.day : null,
    recurring: r.recurring === true,
    active: r.active !== false,
    date_in_year: nullableText(r.date_in_year),
    source: r.source === 'ai' ? 'ai' : 'manual',
  }
}

export function normaliseHolidays(raw: unknown): HolidaysResponse {
  const r = (raw ?? {}) as Record<string, unknown>
  return {
    year: num(r.year, new Date().getFullYear()),
    items: Array.isArray(r.items) ? r.items.map(normaliseHoliday) : [],
    sync: r.sync === 'pending' || r.sync === 'failed' || r.sync === 'off' ? r.sync : 'ready',
  }
}

// ------------------------------------------------------------------------------------------------ requests
const enc = encodeURIComponent
const IMPORT_TIMEOUT = 60000

/** Query-string params for the list: blanks are dropped. */
export function listParams(q: ListQuery): Record<string, string | number> {
  const out: Record<string, string | number> = {}
  const t = (q.q ?? '').trim()
  if (t) out.q = t
  if (q.status) out.status = q.status
  out.page = Math.max(1, Math.floor(q.page ?? 1))
  out.page_size = Math.min(50, Math.max(1, Math.floor(q.page_size ?? 20)))
  return out
}

export const peopleApi = {
  list: (q: ListQuery, signal?: AbortSignal) => api.get<unknown>('/people/employees', { params: listParams(q), signal }).then((r) => normalisePage(r.data)),
  get: (id: string) => api.get<unknown>(`/people/employees/${enc(id)}`).then((r) => normalisePerson(r.data)),
  create: (body: CreateBody) => api.post<unknown>('/people/employees', body).then((r) => normalisePerson(r.data)),
  update: (id: string, body: PatchBody) => api.patch<unknown>(`/people/employees/${enc(id)}`, body).then((r) => normalisePerson(r.data)),
  deactivate: (id: string, body: DeactivateBody = {}) => api.post<unknown>(`/people/employees/${enc(id)}/deactivate`, body).then((r) => normalisePerson(r.data)),
  /** Permanently deletes someone who has left (HR only). Their leave, reimbursement and timesheet history stays. */
  remove: (id: string) => api.delete<unknown>(`/people/employees/${enc(id)}`).then(() => undefined),
  reactivate: (id: string) => api.post<unknown>(`/people/employees/${enc(id)}/reactivate`).then((r) => normalisePerson(r.data)),
  setRoles: (id: string, roles: string[]) => api.put<unknown>(`/people/employees/${enc(id)}/roles`, { roles }).then((r) => normalisePerson(r.data)),
  /** The CSV header row, fetched with the Bearer header and handed to the browser as a blob (never a URL with a token). */
  templateBlob: () => api.get<Blob>('/people/employees/import/template', { responseType: 'blob', timeout: 30000 }).then((r) => r.data),
  importCsv: (file: File, dryRun: boolean) => {
    const form = new FormData()
    form.append('file', file)
    return api.post<unknown>('/people/employees/import', form, { params: { dry_run: dryRun }, timeout: IMPORT_TIMEOUT }).then((r) => normaliseReport(r.data))
  },
}

export const entraSyncApi = {
  status: (signal?: AbortSignal) => api.get<unknown>('/people/entra-sync/status', { signal }).then((r): SyncStatus => normaliseSyncStatus(r.data)),
  /** Starts a run in the background (202). 409 already_running / not_configured come back as errors the card words itself. */
  run: () => api.post<unknown>('/people/entra-sync/run').then(() => undefined),
}

export const holidaysApi = {
  /** `includeInactive` is HR only: the server answers 403 to anyone else. */
  list: (year: number, includeInactive = false, signal?: AbortSignal) =>
    api
      .get<unknown>('/holidays', { params: includeInactive ? { year, include_inactive: true } : { year }, signal })
      .then((r) => normaliseHolidays(r.data)),
  create: (body: HolidayBody) => api.post<unknown>('/holidays', body).then((r) => normaliseHoliday(r.data)),
  update: (id: string, body: HolidayBody) => api.patch<unknown>(`/holidays/${enc(id)}`, body).then((r) => normaliseHoliday(r.data)),
  remove: (id: string) => api.delete(`/holidays/${enc(id)}`).then(() => undefined),
}

/** Manager type-ahead: the normal directory search (any signed-in user may call it). */
export interface DirectoryHit {
  employee_id: string
  name: string
  job_title: string | null
  department: string | null
  status: string | null
}

export function normaliseDirectoryHits(raw: unknown): DirectoryHit[] {
  const r = (raw ?? {}) as Record<string, unknown>
  const items = Array.isArray(r.items) ? r.items : []
  return items
    .map((x): DirectoryHit => {
      const o = (x ?? {}) as Record<string, unknown>
      return { employee_id: text(o.employee_id), name: text(o.name, 'Unnamed'), job_title: nullableText(o.job_title), department: nullableText(o.department), status: nullableText(o.status) }
    })
    .filter((h) => h.employee_id)
}

export const managerSearchApi = {
  search: (q: string, signal?: AbortSignal) =>
    api.get<unknown>('/directory/employees', { params: { q, page: 1, page_size: 20 }, signal }).then((r) => normaliseDirectoryHits(r.data)),
}
