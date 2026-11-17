/**
 * Pure helpers for People management and Holidays admin (no DOM, no network) so they are unit tested with node --test.
 *
 * Nothing here decides who may do what: every route is HR only and the SERVER answers 403/404/409. The validation below
 * MIRRORS the server limits (docs/api/peoplemgmt.md, docs/api/holidays.md) only to give quick feedback; the server's own
 * answer is always shown when it disagrees, and a value the client accepts can still be refused.
 */
import { formatDate, parseIsoDate, daysInMonth, isoDate, todayIso } from '@/lib/dates'
import { PROFILE_FIELD_LABEL } from '@/api/profile'
import type { ApiFailure, Holiday, HolidayBody, ImportReport, ImportRow, Person, PatchBody, CreateBody } from './api'

// ------------------------------------------------------------------------------------------------ limits (server mirror)
export const NAME_MAX = 120
export const TEXT_MAX = 120
export const EMAIL_MAX = 254
export const START_DATE_MIN = '1950-01-01'
export const START_DATE_FUTURE_DAYS = 730
export const CSV_MAX_BYTES = 1024 * 1024
export const CSV_MAX_ROWS = 500
export const HOLIDAY_YEAR_MIN = 2000
export const HOLIDAY_YEAR_MAX = 2100
export const PAGE_SIZE = 20
export const QUERY_MAX = 100
export const MANAGER_QUERY_MAX = 64

export const EMPLOYMENT_OPTIONS: readonly { value: string; label: string }[] = [
  { value: 'full_time', label: 'Full-time' },
  { value: 'part_time', label: 'Part-time' },
  { value: 'contractor', label: 'Contractor' },
  { value: 'intern', label: 'Intern' },
]

export const GRANTABLE_ROLES = ['Manager', 'HRAdmin', 'Finance'] as const
export type GrantableRole = (typeof GRANTABLE_ROLES)[number]

export const ROLE_LABEL: Record<string, string> = {
  Employee: 'Employee',
  Manager: 'Manager',
  HRAdmin: 'HR Administrator',
  Finance: 'Finance',
}

export const ROLE_HELP: Record<string, string> = {
  Employee: 'Everyone is an employee for their own records. This role is always on.',
  Manager: 'Approves requests of their direct reports.',
  HRAdmin: 'Manages people, holidays, catalogs and sees HR oversight pages.',
  Finance: 'Reviews reimbursements that reach the Finance stage.',
}

export const FORMULA_PREFIXES = ['=', '+', '-', '@', '\t', '\r'] as const

const FIELD_LABEL: Record<string, string> = {
  name: 'Name',
  email: 'Email',
  job_title: 'Job title',
  department: 'Department',
  employment_type: 'Employment type',
  manager_id: 'Manager',
  start_date: 'Start date',
  end_date: 'Leaving date',
  birthday: 'Birthday',
  roles: 'Roles',
  can_sign_in: 'Sign-in',
  reassign_reports_to: 'New manager',
  month: 'Month',
  day: 'Day',
  date: 'Date',
  type: 'Type',
  active: 'Active',
}

export function fieldLabel(field: string): string {
  return FIELD_LABEL[field] ?? PROFILE_FIELD_LABEL[field] ?? field.replace(/^profile\./, '').replace(/[._]/g, ' ')
}

/** "is required" -> "Name is required". Messages from the server start in lower case and carry no field name. */
export function fieldMessage(field: string, message: string): string {
  const m = message.trim()
  if (!m) return `${fieldLabel(field)} is not valid`
  return `${fieldLabel(field)} ${m.charAt(0).toLowerCase()}${m.slice(1)}`
}

export type FieldErrors = Record<string, string>

// ------------------------------------------------------------------------------------------------ person form
export interface ManagerChoice {
  employee_id: string
  name: string
}

export interface PersonForm {
  name: string
  email: string
  job_title: string
  department: string
  employment_type: string
  manager: ManagerChoice | null
  start_date: string
  birthday: string
  roles: Record<GrantableRole, boolean>
  can_sign_in: boolean
}

export function emptyForm(): PersonForm {
  return {
    name: '',
    email: '',
    job_title: '',
    department: '',
    employment_type: 'full_time',
    manager: null,
    start_date: '',
    birthday: '',
    roles: { Manager: false, HRAdmin: false, Finance: false },
    can_sign_in: true,
  }
}

export function formFromPerson(p: Person): PersonForm {
  const e = p.employee
  return {
    name: e.name,
    email: e.email,
    job_title: e.job_title,
    department: e.department,
    employment_type: e.employment_type,
    manager: e.manager ? { employee_id: e.manager.employee_id, name: e.manager.name } : e.manager_id ? { employee_id: e.manager_id, name: e.manager_id } : null,
    start_date: e.start_date ?? '',
    birthday: e.birthday ?? '',
    roles: { Manager: p.account.roles.includes('Manager'), HRAdmin: p.account.roles.includes('HRAdmin'), Finance: p.account.roles.includes('Finance') },
    can_sign_in: p.account.can_sign_in,
  }
}

/** Collapses whitespace like the server does. */
export function collapse(raw: string): string {
  return raw.split(/\s+/).filter(Boolean).join(' ')
}

export function looksLikeFormula(value: string): boolean {
  return FORMULA_PREFIXES.some((p) => value.startsWith(p))
}

const hasControl = (s: string) => [...s].some((c) => {
  const o = c.charCodeAt(0)
  return (o < 32 && c !== '\t' && c !== '\r' && c !== '\n') || o === 127
})

/** Mirrors the server's text rules. Returns an error WITHOUT the field name ("is required"), or null. */
export function textRuleError(raw: string, limit: number, required: boolean): string | null {
  if (hasControl(raw)) return 'contains control characters'
  const text = collapse(raw)
  if (raw.replace(/^ +/, '').length && looksLikeFormula(raw.replace(/^ +/, ''))) return 'must not start with = + - or @'
  if (!text) return required ? 'is required' : null
  if (text.length > limit) return `must be at most ${limit} characters`
  return null
}

const EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/

export function emailRuleError(raw: string): string | null {
  const email = raw.trim().toLowerCase()
  if (!email) return 'is required'
  if (email.length > EMAIL_MAX || !EMAIL_RE.test(email) || email.includes('..') || email.includes('@.') || looksLikeFormula(email)) return 'must be a valid e-mail address'
  return null
}

const MAX_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

/** `MM-DD`, a real calendar day, 02-29 allowed, never a year. */
export function isBirthday(raw: string): boolean {
  const m = /^(\d{2})-(\d{2})$/.exec(raw.trim())
  if (!m) return false
  const month = Number(m[1])
  const day = Number(m[2])
  return month >= 1 && month <= 12 && day >= 1 && day <= MAX_DAYS[month - 1]
}

export function birthdayRuleError(raw: string): string | null {
  if (!raw.trim()) return null
  return isBirthday(raw) ? null : 'must look like MM-DD (a real calendar day, no year)'
}

/** Latest accepted start date: today + 730 days (ISO). `now` is injectable for tests. */
export function startDateMax(now: Date): string {
  const t = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() + START_DATE_FUTURE_DAYS))
  return isoDate(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate())
}

export function startDateRuleError(raw: string, now: Date): string | null {
  if (!raw.trim()) return null
  const p = parseIsoDate(raw)
  if (!p || !/^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) return 'must be a date like YYYY-MM-DD'
  const iso = isoDate(p.year, p.month, p.day)
  if (iso < START_DATE_MIN || iso > startDateMax(now)) return 'is outside the supported range'
  return null
}

export function employmentRuleError(raw: string): string | null {
  if (!raw) return 'is required'
  return EMPLOYMENT_OPTIONS.some((o) => o.value === raw) ? null : 'must be one of full_time, part_time, contractor, intern'
}

/** Quick client-side check of the whole form (messages already carry the field name). Empty object = looks fine. */
export function validatePersonForm(form: PersonForm, now: Date, opts: { selfId?: string | null } = {}): FieldErrors {
  const out: FieldErrors = {}
  const put = (field: string, err: string | null) => {
    if (err) out[field] = fieldMessage(field, err)
  }
  put('name', textRuleError(form.name, NAME_MAX, true))
  put('email', emailRuleError(form.email))
  put('job_title', textRuleError(form.job_title, TEXT_MAX, true))
  put('department', textRuleError(form.department, TEXT_MAX, true))
  put('employment_type', employmentRuleError(form.employment_type))
  put('start_date', startDateRuleError(form.start_date, now))
  put('birthday', birthdayRuleError(form.birthday))
  if (form.manager && opts.selfId && form.manager.employee_id === opts.selfId) out.manager_id = 'Manager cannot be the person themselves'
  return out
}

export function selectedRoles(form: PersonForm): string[] {
  return rolesBody(form.roles)
}

export function buildCreateBody(form: PersonForm): CreateBody {
  const signIn = form.can_sign_in
  return {
    name: collapse(form.name),
    email: form.email.trim().toLowerCase(),
    job_title: collapse(form.job_title),
    department: collapse(form.department),
    employment_type: form.employment_type,
    manager_id: form.manager?.employee_id ?? null,
    start_date: form.start_date.trim() || null,
    birthday: form.birthday.trim() || null,
    // Without a sign-in account only "Employee" is allowed (the server refuses more with a 422).
    roles: signIn ? selectedRoles(form) : ['Employee'],
    can_sign_in: signIn,
  }
}

/** PATCH body: only fields that differ from the saved person; cleared optional fields are sent as null. */
export function buildPatchBody(original: Person, form: PersonForm): PatchBody {
  const e = original.employee
  const body: PatchBody = {}
  const name = collapse(form.name)
  if (name !== e.name) body.name = name
  const email = form.email.trim().toLowerCase()
  if (email !== e.email) body.email = email
  const title = collapse(form.job_title)
  if (title !== e.job_title) body.job_title = title
  const dept = collapse(form.department)
  if (dept !== e.department) body.department = dept
  if (form.employment_type !== e.employment_type) body.employment_type = form.employment_type
  const mgr = form.manager?.employee_id ?? null
  if (mgr !== (e.manager_id ?? null)) body.manager_id = mgr
  const start = form.start_date.trim() || null
  if (start !== (e.start_date ?? null)) body.start_date = start
  const bday = form.birthday.trim() || null
  if (bday !== (e.birthday ?? null)) body.birthday = bday
  return body
}

export function isEmptyPatch(body: PatchBody): boolean {
  return Object.keys(body).length === 0
}

/** The roles in the Account card changed (compared as sets; Employee is always on). */
export function rolesChanged(saved: readonly string[], form: Record<GrantableRole, boolean>): boolean {
  return GRANTABLE_ROLES.some((r) => saved.includes(r) !== form[r])
}

/** The whole role set to send to PUT /roles: Employee first (always on), then the ticked ones in canonical order. */
export function rolesBody(form: Record<GrantableRole, boolean>): string[] {
  return ['Employee', ...GRANTABLE_ROLES.filter((r) => form[r])]
}

export function rolesList(roles: readonly string[]): string[] {
  const order = ['Employee', 'Manager', 'HRAdmin', 'Finance']
  const set = new Set(['Employee', ...roles])
  return order.filter((r) => set.has(r))
}

export function rolesText(roles: readonly string[]): string {
  if (roles.length === 0) return 'No roles (no sign-in account)'
  return rolesList(roles).map((r) => ROLE_LABEL[r] ?? r).join(', ')
}

// ------------------------------------------------------------------------------------------------ labels
export function employmentLabel(value: string | null | undefined): string {
  if (!value) return '-'
  return EMPLOYMENT_OPTIONS.find((o) => o.value === value)?.label ?? value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export function statusLabel(value: string | null | undefined): string {
  return value === 'left' ? 'Left' : value === 'active' ? 'Active' : value ? value.charAt(0).toUpperCase() + value.slice(1) : '-'
}

export type Tone = 'green' | 'amber' | 'red' | 'blue' | 'violet' | 'neutral'

export function statusTone(value: string | null | undefined): Tone {
  return value === 'active' ? 'green' : value === 'left' ? 'neutral' : 'amber'
}

export interface AccountBadge {
  label: string
  tone: Tone
  kind: 'no_account' | 'can_sign_in' | 'deactivated' | 'sign_in_off'
}

/** The account badge of the list and the detail page, from the SERVER's account object. */
export function accountBadge(p: Person): AccountBadge {
  const a = p.account
  if (!a.has_account) return { label: 'No account', tone: 'neutral', kind: 'no_account' }
  if (a.can_sign_in) return { label: 'Can sign in', tone: 'green', kind: 'can_sign_in' }
  if (a.disabled_reason === 'deactivated') return { label: 'Deactivated', tone: 'red', kind: 'deactivated' }
  return { label: 'Sign-in off', tone: 'amber', kind: 'sign_in_off' }
}

export function signInSourceLabel(source: string | null | undefined): string {
  if (source === 'hr_created') return 'Microsoft work account (created by HR)'
  if (source === 'entra_bootstrap') return 'Microsoft work account (set in configuration)'
  if (source === 'demo') return 'Local account'
  if (source === 'other') return 'Other'
  return 'No sign-in account'
}

export function signInSourceShort(source: string | null | undefined): string {
  if (source === 'hr_created') return 'Microsoft'
  if (source === 'entra_bootstrap') return 'Microsoft (config)'
  if (source === 'demo') return 'Local'
  if (source === 'other') return 'Other'
  return '-'
}

export function disabledText(reason: string | null | undefined): string {
  if (reason === 'deactivated') return 'Signed out and blocked because the person was deactivated. Reactivating them turns sign-in back on.'
  if (reason === 'sign_in_off') return 'Sign-in was switched off by HR. They cannot use the app until it is switched back on.'
  return 'Sign-in is off.'
}

export function birthdayLabel(mmdd: string | null | undefined): string {
  if (!mmdd || !isBirthday(mmdd)) return '-'
  const [m, d] = mmdd.split('-').map(Number)
  return `${d} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]}`
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

export { formatDate }

// ------------------------------------------------------------------------------------------------ list + department filter
export function cleanQuery(raw: string, max = QUERY_MAX): string {
  return raw.trim().slice(0, max)
}

export function parsePage(raw: string | null | undefined): number {
  const n = Number(raw)
  return Number.isInteger(n) && n >= 1 && n <= 100000 ? n : 1
}

export function parseStatusFilter(raw: string | null | undefined): '' | 'active' | 'left' {
  return raw === 'active' || raw === 'left' ? raw : ''
}

/** Literal, case-insensitive match over the same text the server searches (name, email, title, department). */
export function matchesQuery(p: Person, q: string): boolean {
  const needle = q.trim().toLowerCase()
  if (!needle) return true
  const e = p.employee
  return [e.name, e.email, e.job_title, e.department].some((v) => v.toLowerCase().includes(needle))
}

/** The department filter has no server parameter: the list asks the server for the department text and keeps exact matches. */
export function exactDepartment(p: Person, department: string): boolean {
  return p.employee.department.trim().toLowerCase() === department.trim().toLowerCase()
}

export function rangeText(page: number, pageSize: number, total: number, shown: number): string {
  if (total === 0 || shown === 0) return '0 of 0'
  const from = (page - 1) * pageSize + 1
  return `${from}-${from + shown - 1} of ${total}`
}

export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / Math.max(1, pageSize)))
}

// ------------------------------------------------------------------------------------------------ failures
export type FailureContext = 'load' | 'save' | 'create' | 'deactivate' | 'reactivate' | 'roles' | 'import' | 'holiday'

const GUARD_CODES = new Set(['last_hradmin', 'email_managed', 'not_active', 'no_account', 'already_left', 'not_left'])

/** The text to show for a failed call. Guard-rail answers (last HR admin, own roles, managed e-mail) show the SERVER's reason verbatim. */
export function failureMessage(f: ApiFailure, what: string): string {
  if (f.status === null) return `${what} Can't reach the Bluedge People service. Check your connection and try again.`
  if (f.status === 401) return 'Your session has ended. Please sign in again.'
  if (f.status === 403) return f.detail ?? `${what} You do not have access to this.`
  if (f.status === 404) return f.detail ?? `${what} It could not be found.`
  if (f.status === 413) return 'The file is larger than 1 MB. Split it into smaller files and try again.'
  if (f.status === 429) return `${what} Too many requests. Wait a moment and try again.`
  if (f.status >= 500) return `${what} Something went wrong on our side. Please try again.`
  if (f.status === 409) {
    if (f.code === 'email_exists') return 'That email address is already used by another person or account. Use a different address.'
    if (f.code === 'duplicate') return 'A holiday with this name already exists on that day.'
    if (f.code === 'too_many') return f.detail ?? 'The list is full.'
    if (f.code === 'has_direct_reports') return f.detail ?? 'Active people report to this person.'
    if (f.code && GUARD_CODES.has(f.code)) return f.detail ?? `${what} The change was not allowed.`
    return f.detail ?? `${what} The change conflicts with the current data. Reload and try again.`
  }
  if (f.status === 422) {
    const first = Object.entries(f.fieldErrors)[0]
    if (first) return fieldMessage(first[0], first[1])
    return importFileMessage(f) ?? f.detail ?? `${what} A value was not accepted.`
  }
  return f.detail ?? `${what} Please try again.`
}

/** Whole-file import errors (422 codes). */
export function importFileMessage(f: ApiFailure): string | null {
  switch (f.code) {
    case 'empty_file':
      return 'The file is empty.'
    case 'no_rows':
      return 'The file has a header row but no people in it.'
    case 'invalid_encoding':
      return 'The file is not UTF-8 text. In Excel choose "CSV UTF-8" when saving.'
    case 'invalid_csv':
      return 'The file could not be read as a comma-separated CSV.'
    case 'duplicate_columns':
      return 'Two columns in the header row have the same name.'
    case 'missing_columns':
      return f.missingColumns.length ? `The header row is missing: ${f.missingColumns.join(', ')}.` : 'The header row is missing required columns.'
    case 'too_many_rows':
      return `The file has more than ${f.maxRows ?? CSV_MAX_ROWS} people. Split it into smaller files.`
    case 'file_too_large':
      return 'The file is larger than 1 MB. Split it into smaller files and try again.'
    default:
      return null
  }
}

/** Server per-field errors turned into messages that carry the field name. */
export function fieldErrorsText(fe: Record<string, string>): FieldErrors {
  const out: FieldErrors = {}
  for (const [k, v] of Object.entries(fe)) out[k] = fieldMessage(k, v)
  return out
}

// ------------------------------------------------------------------------------------------------ CSV import hints
export const IMPORT_COLUMNS_REQUIRED = ['name', 'email', 'job_title', 'department', 'employment_type'] as const
export const IMPORT_COLUMNS_OPTIONAL = ['manager_email', 'start_date', 'birthday', 'roles', 'can_sign_in'] as const
/** Optional HR profile columns (after the ones above in the template), grouped like the profile sections. */
export const IMPORT_COLUMNS_PROFILE: readonly { group: string; columns: readonly string[] }[] = [
  { group: 'Personal', columns: ['preferred_name', 'gender', 'civil_status', 'nationality', 'birth_year'] },
  { group: 'Contact and address', columns: ['personal_email', 'mobile', 'address_line1', 'address_line2', 'city', 'province', 'postal_code', 'country'] },
  { group: 'Emergency contact', columns: ['emergency_name', 'emergency_relationship', 'emergency_phone'] },
  { group: 'Work details', columns: ['employee_number', 'company', 'office_location', 'work_arrangement', 'probation_end_date', 'regularization_date'] },
  { group: 'Government IDs', columns: ['tin', 'sss', 'philhealth', 'pagibig'] },
]
export const IMPORT_PROFILE_COLUMN_LIST: readonly string[] = IMPORT_COLUMNS_PROFILE.flatMap((g) => g.columns)

export const IMPORT_FORMULA_NOTE =
  'Cells that start with = + - or @ (or a tab) are rejected in every text column, because a spreadsheet could run them as a formula. They are not repaired: fix the cell and check the file again.'

export interface FileHint {
  tone: 'error' | 'warning'
  text: string
}

/** Advisory hints from the file's name and size alone. The server checks the real file; nothing is blocked here except an obviously empty file. */
export function fileHints(file: { name: string; size: number }): FileHint[] {
  const out: FileHint[] = []
  if (file.size === 0) out.push({ tone: 'error', text: 'The file is empty.' })
  if (file.size > CSV_MAX_BYTES) out.push({ tone: 'error', text: `The file is ${(file.size / (1024 * 1024)).toFixed(1)} MB. The limit is 1 MB.` })
  if (!/\.csv$/i.test(file.name)) out.push({ tone: 'warning', text: 'The file name does not end in .csv. Only comma-separated text files are accepted.' })
  return out
}

export interface CsvPeek {
  /** Header cell names, lower-cased and trimmed (names only, never any data). */
  columns: string[]
  /** Non-blank lines after the header. A hint: a quoted cell with a line break can make it a little high. */
  approxRows: number
}

export function peekCsv(textContent: string): CsvPeek {
  const lines = textContent.replace(/^﻿/, '').split(/\r\n|\n|\r/)
  const nonBlank = lines.filter((l) => l.trim() !== '')
  const header = nonBlank[0] ?? ''
  return { columns: header.split(',').map((c) => c.trim().replace(/^"|"$/g, '').toLowerCase()).filter(Boolean), approxRows: Math.max(0, nonBlank.length - 1) }
}

export function peekHints(peek: CsvPeek): FileHint[] {
  const out: FileHint[] = []
  const missing = IMPORT_COLUMNS_REQUIRED.filter((c) => !peek.columns.includes(c))
  if (peek.columns.length && missing.length) out.push({ tone: 'warning', text: `The header row looks like it is missing: ${missing.join(', ')}.` })
  if (peek.approxRows > CSV_MAX_ROWS) out.push({ tone: 'warning', text: `The file has about ${peek.approxRows} people. The limit is ${CSV_MAX_ROWS} per file.` })
  if (peek.columns.length && peek.approxRows === 0) out.push({ tone: 'warning', text: 'There are no people under the header row.' })
  return out
}

export function hasBlockingHint(hints: readonly FileHint[]): boolean {
  return hints.some((h) => h.tone === 'error')
}

// ------------------------------------------------------------------------------------------------ import report
export type ReportFilter = 'all' | 'created' | 'skipped' | 'invalid'

export function filterRows(rows: readonly ImportRow[], filter: ReportFilter): ImportRow[] {
  return filter === 'all' ? [...rows] : rows.filter((r) => r.status === filter)
}

/** A clean-enough dry run: it would create at least one person. Rows that are invalid or skipped are simply not imported. */
export function canImport(report: ImportReport | null): boolean {
  return Boolean(report && report.dry_run && report.created > 0)
}

export function importButtonLabel(report: ImportReport | null): string {
  const n = report?.created ?? 0
  return `Import ${n} ${n === 1 ? 'person' : 'people'}`
}

const REASON_TEXT: Record<string, string> = {
  validation: 'Some values are not valid',
  too_many_cells: 'The row has more cells than there are columns',
  cell_too_long: 'A cell is too long',
  manager_not_found: 'The manager email is not an active person in the system or in this file',
  manager_inactive: 'The manager has left',
  manager_cycle: 'The manager links form a loop (or the person is their own manager)',
  write_failed: 'The row could not be saved',
  email_exists: 'This email address is already in the system',
  duplicate_in_file: 'This email address appears earlier in the file (the first one wins)',
}

export function reasonText(row: ImportRow): string {
  const base = row.reason ? (REASON_TEXT[row.reason] ?? row.message ?? row.reason) : row.message ?? ''
  return base
}

/** A row error names the CSV column it came from: a profile column shows its own header ("mobile: must be 7 to 24 characters"). */
export function rowErrorList(row: ImportRow): string[] {
  return Object.entries(row.field_errors).map(([k, v]) => (IMPORT_PROFILE_COLUMN_LIST.includes(k) ? `${k}: ${v.trim()}` : fieldMessage(k, v)))
}

export function summaryText(r: ImportReport): string {
  const verb = r.dry_run ? 'would be created' : 'created'
  return `${r.total} ${r.total === 1 ? 'row' : 'rows'} read: ${r.created} ${verb}, ${r.skipped} skipped, ${r.invalid} invalid.`
}

export const STATUS_WORD: Record<string, string> = { created: 'Created', skipped: 'Skipped', invalid: 'Invalid' }

export function rowStatusWord(row: ImportRow, dryRun: boolean): string {
  if (row.status === 'created') return dryRun ? 'Would be created' : 'Created'
  return STATUS_WORD[row.status] ?? row.status
}

export function rowTone(status: string): Tone {
  return status === 'created' ? 'green' : status === 'skipped' ? 'amber' : 'red'
}

/** Triggers a browser download of the template blob. Kept here (DOM only at call time) so the page stays small. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// ------------------------------------------------------------------------------------------------ holidays
export const HOLIDAY_NAME_MAX = 120

export const HOLIDAY_TYPES: readonly { value: 'public' | 'company'; label: string }[] = [
  { value: 'public', label: 'Public holiday' },
  { value: 'company', label: 'Company holiday' },
]

export function holidayTypeLabel(type: string): string {
  return HOLIDAY_TYPES.find((t) => t.value === type)?.label ?? type
}

export const HOLIDAYS_USAGE_NOTE =
  'The Company Calendar and leave day-counting both use this list: a weekday that is a holiday is not counted as a leave day. Leave requests that already exist are NOT recalculated when you change the list.'

export const HOLIDAYS_AI_NOTE =
  "The Philippine national holidays for this year were filled in automatically by AI. Dates set by proclamation or by the lunar calendar (Holy Week, Eid'l Fitr, Eid'l Adha, Chinese New Year) can be wrong: check them against the official proclamations. Edit or delete any holiday; once you edit one, it stops being marked AI."

export const HOLIDAYS_PENDING_NOTE = 'Fetching the Philippine holidays for this year. They will appear here in a moment.'

export const HOLIDAYS_FAILED_NOTE =
  'The Philippine holidays for this year could not be fetched automatically. The server tries again later; meanwhile you can add them by hand.'

export const HOLIDAYS_EMPTY_NOTE =
  'No holidays have been added. Until you add some, no day is treated as a holiday in the calendar or in leave day-counting.'

export interface HolidayForm {
  name: string
  type: 'public' | 'company'
  recurring: boolean
  date: string
  month: string
  day: string
  active: boolean
}

export function emptyHolidayForm(year: number): HolidayForm {
  return { name: '', type: 'company', recurring: false, date: `${year}-01-01`, month: '1', day: '1', active: true }
}

export function formFromHoliday(h: Holiday, year: number): HolidayForm {
  return {
    name: h.name,
    type: h.type === 'public' ? 'public' : 'company',
    recurring: h.recurring,
    date: h.date ?? h.date_in_year ?? `${year}-01-01`,
    month: String(h.month ?? 1),
    day: String(h.day ?? 1),
    active: h.active,
  }
}

export function holidayNameError(raw: string): string | null {
  const name = collapse(raw)
  if (hasControl(raw)) return 'Name contains control characters'
  if (!name) return 'Name is required'
  if (name.length > HOLIDAY_NAME_MAX) return `Name must be at most ${HOLIDAY_NAME_MAX} characters`
  if (looksLikeFormula(raw.replace(/^ +/, ''))) return 'Name must not start with = + - or @'
  return null
}

export function holidayDateError(raw: string): string | null {
  const p = /^\d{4}-\d{2}-\d{2}$/.test(raw.trim()) ? parseIsoDate(raw) : null
  if (!p) return 'Date must be a real date like 2026-12-25'
  if (p.year < HOLIDAY_YEAR_MIN || p.year > HOLIDAY_YEAR_MAX) return `Date must be between ${HOLIDAY_YEAR_MIN} and ${HOLIDAY_YEAR_MAX}`
  return null
}

/** 29 February is allowed for a yearly holiday (it falls on the 28th in other years). */
export function holidayMonthDayError(month: string, day: string): string | null {
  const m = Number(month)
  const d = Number(day)
  if (!Number.isInteger(m) || m < 1 || m > 12) return 'Choose a month'
  const max = m === 2 ? 29 : daysInMonth(2001, m)
  if (!Number.isInteger(d) || d < 1 || d > max) return `${MONTH_NAMES[m - 1]} has ${max} days at most`
  return null
}

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export function validateHolidayForm(f: HolidayForm): FieldErrors {
  const out: FieldErrors = {}
  const n = holidayNameError(f.name)
  if (n) out.name = n
  if (f.recurring) {
    const e = holidayMonthDayError(f.month, f.day)
    if (e) out.month = e
  } else {
    const e = holidayDateError(f.date)
    if (e) out.date = e
  }
  return out
}

export function buildHolidayCreate(f: HolidayForm): HolidayBody {
  return {
    name: collapse(f.name),
    type: f.type,
    active: f.active,
    ...(f.recurring ? { month: Number(f.month), day: Number(f.day) } : { date: f.date.trim() }),
  }
}

/** PATCH body: changed fields only; when the timing changes, send the new form of it (the other form is cleared by the server). */
export function buildHolidayPatch(original: Holiday, f: HolidayForm): HolidayBody {
  const body: HolidayBody = {}
  const name = collapse(f.name)
  if (name !== original.name) body.name = name
  if (f.type !== original.type) body.type = f.type
  if (f.active !== original.active) body.active = f.active
  const timingChanged = f.recurring !== original.recurring || (f.recurring ? Number(f.month) !== original.month || Number(f.day) !== original.day : f.date.trim() !== (original.date ?? ''))
  if (timingChanged) {
    if (f.recurring) {
      body.month = Number(f.month)
      body.day = Number(f.day)
    } else {
      body.date = f.date.trim()
    }
  }
  return body
}

/** "Every year on 25 Dec" / "One-off". */
export function repeatText(h: Holiday): string {
  if (!h.recurring) return 'One date only'
  if (h.month && h.day) return `Every year (${h.day} ${MONTH_NAMES[h.month - 1].slice(0, 3)})`
  return 'Every year'
}

export function parseYear(raw: string | null | undefined, now: Date): number {
  const n = Number(raw)
  return Number.isInteger(n) && n >= HOLIDAY_YEAR_MIN && n <= HOLIDAY_YEAR_MAX ? n : now.getFullYear()
}

/** Years offered in the selector: around the current year plus the selected one. */
export function yearOptions(selected: number, now: Date): number[] {
  const set = new Set<number>([selected])
  for (let y = now.getFullYear() - 2; y <= now.getFullYear() + 5; y++) if (y >= HOLIDAY_YEAR_MIN && y <= HOLIDAY_YEAR_MAX) set.add(y)
  return [...set].sort((a, b) => a - b)
}

export function holidayDateText(h: Holiday): string {
  return h.date_in_year ? formatWeekdayDate(h.date_in_year) : '-'
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export function formatWeekdayDate(iso: string): string {
  const p = parseIsoDate(iso)
  if (!p) return iso
  const wd = WEEKDAYS[new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()]
  return `${wd}, ${formatDate(iso)}`
}

/** Holidays that belong to the shown year (the server also returns one-offs of other years to HR). */
export function inYear(items: readonly Holiday[]): Holiday[] {
  return items.filter((h) => h.date_in_year !== null)
}

export function otherYearsCount(items: readonly Holiday[]): number {
  return items.filter((h) => h.date_in_year === null).length
}

export { todayIso }
