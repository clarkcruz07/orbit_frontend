/** Pure auth helpers (no DOM, no network) so they can be unit tested with node --test. */

export type Role = 'Employee' | 'Manager' | 'HRAdmin' | 'Finance'

export interface SessionUser {
  user_id: string
  email: string
  name: string
  roles: Role[]
  employee_id: string | null
  job_title?: string | null
  department?: string | null
  avatar_initials?: string | null
  demo?: boolean
}

/** Endpoints where a 401 means "bad credentials/token", never "refresh and retry". */
const NO_REFRESH_PATHS = ['/auth/login', '/auth/refresh', '/auth/logout', '/auth/entra', '/auth/config', '/auth/demo-users']

export function isAuthEndpoint(url: string | undefined | null): boolean {
  if (!url) return false
  const path = url.split('?')[0]
  return NO_REFRESH_PATHS.some((p) => path === p || path.endsWith(p))
}

export interface RefreshDecisionInput {
  status: number | undefined
  url: string | undefined | null
  alreadyRetried: boolean
  hasRefreshToken: boolean
}

/** One refresh attempt per request, only for 401s on non-auth endpoints, only if we hold a refresh token. */
export function shouldAttemptRefresh(i: RefreshDecisionInput): boolean {
  return i.status === 401 && !i.alreadyRetried && i.hasRefreshToken && !isAuthEndpoint(i.url)
}

/**
 * The two dashboard views. The owner of the product is HR personnel; everyone else is non-HR personnel.
 * The classification comes from the Entra ID `employeeType` claim: the backend maps it to the `HRAdmin` role
 * at sign-in (PEOPLE_ENTRA_ROLE_MAP, e.g. {"employee_type": {"HR": "HRAdmin"}}), so the session's roles are the single source.
 */
export type DashboardView = 'hr' | 'standard'

export function dashboardView(user: Pick<SessionUser, 'roles'> | null | undefined): DashboardView {
  return user?.roles?.includes('HRAdmin') ? 'hr' : 'standard'
}

/** Everybody lands on the Dashboard; which dashboard they see depends on `dashboardView`. */
export function landingPath(_user?: Pick<SessionUser, 'roles'> | null): string {
  return '/'
}

export function hasAnyRole(user: Pick<SessionUser, 'roles'> | null | undefined, allowed?: readonly Role[]): boolean {
  if (!allowed || allowed.length === 0) return true
  if (!user?.roles) return false
  return allowed.some((r) => user.roles.includes(r))
}

export function loginRedirectPath(pathname: string, search = '', hash = ''): string {
  const target = `${pathname}${search}${hash}`
  if (!target || target === '/' || /^\/login/i.test(target)) return '/login'
  return `/login?next=${encodeURIComponent(target)}`
}

export type MeFailure = 'unauthorized' | 'unreachable'

/** `/auth/me` restore: 401/403 means the session is gone; anything else (no response, 5xx) means "try again". */
export function classifyMeFailure(err: { response?: { status?: number } } | null | undefined): MeFailure {
  const status = err?.response?.status
  return status === 401 || status === 403 ? 'unauthorized' : 'unreachable'
}

export function roleLabel(roles: readonly string[] | undefined): string {
  if (!roles || roles.length === 0) return 'Employee'
  const map: Record<string, string> = {
    HRAdmin: 'HR Administrator',
    Manager: 'Manager',
    Finance: 'Finance',
    Employee: 'Employee',
  }
  const order = ['HRAdmin', 'Finance', 'Manager', 'Employee']
  const first = order.find((r) => roles.includes(r)) ?? roles[0]
  return map[first] ?? first
}

export function initialsOf(name: string | undefined | null): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  const first = parts[0][0] ?? ''
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? '' : ''
  return (first + last).toUpperCase()
}

/** Client-safe message from an axios-style error. Never shows raw network/stack text. */
export function errorMessage(err: unknown, fallback: string): string {
  const e = err as { response?: { data?: { detail?: unknown } } } | null
  const detail = e?.response?.data?.detail
  if (typeof detail === 'string' && detail.trim() && detail.length < 300) return detail
  return fallback
}
