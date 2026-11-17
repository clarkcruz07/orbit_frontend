/**
 * Pure Settings logic (no DOM, no network) so it can be unit tested with node --test.
 *
 * Permissions are NEVER decided here from role names. The page asks the server: `GET /settings` answers 200 for HR
 * administrators and 403 for everyone else, and the HR tabs are offered only after a 200. Every call is authorised by the
 * server again; hiding a tab is a convenience, not the control.
 */
import type { PrefGroup, PrefItem } from './api'

// ------------------------------------------------------------------------------------------------ tabs
export type TabId = 'preferences' | 'account' | 'hr' | 'users' | 'catalogs'

export const TAB_LABEL: Record<TabId, string> = {
  preferences: 'My preferences',
  account: 'Account',
  hr: 'HR settings',
  users: 'Users and roles',
  catalogs: 'Catalogs',
}

/** `?tab=` value for each tab; the default tab has no parameter. */
export const TAB_PARAM: Record<TabId, string> = { preferences: '', account: 'account', hr: 'hr', users: 'users', catalogs: 'catalogs' }

/** checking: probe in flight; allowed: GET /settings answered 200; denied: it answered 403; error: it could not be checked. */
export type HrAccess = 'checking' | 'allowed' | 'denied' | 'error'

export function hrAccessFromError(err: unknown): HrAccess {
  const status = (err as { response?: { status?: number } } | null)?.response?.status
  return status === 403 ? 'denied' : 'error'
}

export function availableTabs(access: HrAccess): TabId[] {
  return access === 'allowed' ? ['preferences', 'account', 'hr', 'users', 'catalogs'] : ['preferences', 'account']
}

export const HR_TABS: readonly TabId[] = ['hr', 'users', 'catalogs']

/** An unknown or unavailable tab falls back to the first one. While the HR probe is running an HR tab is kept (no flicker). */
export function parseTab(raw: string | null | undefined, available: readonly TabId[], access: HrAccess = 'allowed'): TabId {
  const found = (Object.keys(TAB_PARAM) as TabId[]).find((t) => TAB_PARAM[t] && TAB_PARAM[t] === raw)
  if (!found) return 'preferences'
  if (available.includes(found)) return found
  if (access === 'checking' && HR_TABS.includes(found)) return found
  return 'preferences'
}

// ------------------------------------------------------------------------------------------------ errors
export interface ErrorInfo {
  status: number | null
  message: string
}

/** Friendly, fixed wording per failure type. The server's own text is never shown (it can name internals). */
export function describeError(err: unknown, what: string): ErrorInfo {
  const status = (err as { response?: { status?: number } } | null)?.response?.status ?? null
  if (status === null) return { status, message: `${what} Can't reach the Bluedge People service. Check your connection and try again.` }
  if (status === 401) return { status, message: 'Your session has ended. Please sign in again.' }
  if (status === 403) return { status, message: `${what} Your account does not have access to this.` }
  if (status === 422) return { status, message: `${what} The value was not accepted.` }
  if (status === 429) return { status, message: `${what} Too many requests. Please wait a moment and try again.` }
  return { status, message: `${what} Please try again.` }
}

// ------------------------------------------------------------------------------------------------ notification switches
export const PREFS_NOTE =
  'These switches control in-app notifications only: the bell at the top of the page. Bluedge People does not send e-mail, push or Teams messages.'

export const PREFS_DETAIL =
  'Turning a group off means those notifications are no longer created for you from then on. Ones you already received stay in the bell, and other people involved in the same event still get theirs. It does not change who is responsible for a request: something waiting for your decision still waits for you.'

/** The group a notification switch change would flip back to if the save fails. */
export function toggled(items: readonly PrefItem[], group: PrefGroup, enabled: boolean): PrefItem[] {
  return items.map((i) => (i.group === group ? { ...i, enabled } : i))
}

export function groupEnabled(items: readonly PrefItem[], group: PrefGroup): boolean {
  return items.find((i) => i.group === group)?.enabled ?? true
}

/** Status line after a save: "Reimbursements notifications are on." */
export function savedMessage(label: string, enabled: boolean): string {
  return `${label} notifications are ${enabled ? 'on' : 'off'}.`
}

/** Error line after a failed save, naming the value the switch went back to. */
export function rollbackMessage(label: string, restoredTo: boolean, detail: string): string {
  return `${detail} ${label} is still ${restoredTo ? 'on' : 'off'}.`.replace(/\s+/g, ' ').trim()
}

// ------------------------------------------------------------------------------------------------ mood
export const MOOD_EXPLAIN_OFF =
  "Off (default): HR administrators do not see the mood score (1 to 5) on anyone's check-ins."
export const MOOD_EXPLAIN_ON =
  "On: HR administrators can also see the mood score on everyone's check-ins. Employees pick that score as a private note for their manager, so this shows it to HR too. The switch changes what HR sees; it does not show mood to any other role."

export function moodExplain(on: boolean): string {
  return on ? MOOD_EXPLAIN_ON : MOOD_EXPLAIN_OFF
}

/** "Default (never changed)" or "Last changed 16 Nov 2026, 10:00". `timeZone` is injectable for tests. */
export function changedLabel(stamp: { updated_at: string | null } | null | undefined, timeZone?: string): string {
  if (!stamp || !stamp.updated_at) return 'Default in force (never changed)'
  const when = formatWhen(stamp.updated_at, timeZone)
  return when ? `Last changed ${when}` : 'Changed (time unknown)'
}

export function formatWhen(iso: string | null | undefined, timeZone?: string): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  try {
    return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone }).format(d).replace(',', '')
  } catch {
    return null
  }
}

// ------------------------------------------------------------------------------------------------ account
export function authSourceLabel(source: string | null | undefined): string {
  if (source === 'microsoft') return 'Microsoft sign-in'
  if (source === 'password') return 'Email and password'
  if (source === 'demo') return 'Local account'
  return source ? source.charAt(0).toUpperCase() + source.slice(1) : 'Unknown'
}

/** Short form for table cells. */
export function authSourceShort(source: string | null | undefined): string {
  if (source === 'microsoft') return 'Microsoft'
  if (source === 'password') return 'Password'
  if (source === 'demo') return 'Local account'
  return authSourceLabel(source)
}

export type BadgeTone = 'blue' | 'lavender' | 'amber' | 'grey'
export function authSourceTone(source: string | null | undefined): BadgeTone {
  if (source === 'microsoft') return 'blue'
  if (source === 'password') return 'lavender'
  return 'grey'
}

export const ROLES_NOTE = 'Roles are set by HR on the People pages, or by the Microsoft sign-in role map. There is no role edit control on this screen.'

/** Roles of one person, in a stable order, as readable text. */
export function rolesText(roles: readonly string[]): string {
  if (roles.length === 0) return 'No roles'
  const label: Record<string, string> = { HRAdmin: 'HR Administrator', Manager: 'Manager', Employee: 'Employee', Finance: 'Finance' }
  return [...roles].sort((a, b) => a.localeCompare(b)).map((r) => label[r] ?? r).join(', ')
}

// ------------------------------------------------------------------------------------------------ users table
/** Trim, collapse nothing else (the search is a literal match on the server), cap at the server limit. */
export function cleanQuery(raw: string, max = 64): string {
  return raw.trim().slice(0, max)
}

/** "1-20 of 45", "0 of 0". */
export function rangeText(page: number, pageSize: number, total: number, shown: number): string {
  if (total === 0 || shown === 0) return '0 of 0'
  const from = (page - 1) * pageSize + 1
  return `${from}-${from + shown - 1} of ${total}`
}

export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / Math.max(1, pageSize)))
}

/** `?page=` from the URL: a positive integer, else 1. */
export function parsePage(raw: string | null | undefined): number {
  const n = Number(raw)
  return Number.isInteger(n) && n >= 1 && n <= 100000 ? n : 1
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

// ------------------------------------------------------------------------------------------------ catalogs index
export interface CatalogLink {
  id: string
  title: string
  description: string
  /** In-app path. The catalog is managed on that module's own page; Settings only points to it. */
  to: string
  /** Where on that page HR finds it, in words. */
  where: string
  /** Shown when the module has no dedicated admin screen yet (the link goes to the module root). */
  note?: string
}

export const CATALOGS: readonly CatalogLink[] = [
  {
    id: 'leave',
    title: 'Leave types and entitlements',
    description: 'The kinds of leave people can ask for, their yearly days and per-person entitlement overrides.',
    to: '/leave?tab=settings',
    where: 'Leave > Leave settings',
  },
  {
    id: 'timesheet',
    title: 'Timesheet codes',
    description: 'The codes people pick from on their weekly timesheet.',
    to: '/attendance?tab=hr',
    where: 'Attendance & Timesheet > HR overview',
  },
  {
    id: 'documents',
    title: 'Document types',
    description: 'The kinds of personal documents, whether they need an expiry date and which are visible to HR only.',
    to: '/documents?tab=hr&section=types',
    where: 'Documents > HR > Document types',
  },
  {
    id: 'learning',
    title: 'Learning courses',
    description: 'The course catalog people can enrol in or be assigned.',
    to: '/learning?tab=hr&section=courses',
    where: 'Learning & Development > HR > Courses',
  },
  {
    id: 'hrcases',
    title: 'HR request types',
    description: 'The kinds of HR request people can open, with a default priority for each.',
    to: '/hr-requests',
    where: 'HR Requests',
    note: 'There is no separate screen for editing request types yet. This link opens the HR Requests page.',
  },
]
