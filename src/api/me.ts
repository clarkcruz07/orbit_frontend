/** My Profile API (SPEC_ADDENDUM_2 section 2): GET /me/profile. Always the caller's own record, full fields. */
import { api } from './client'
import { normaliseProfile, type EmployeeProfile, type ProfilePatch } from './profile'
import { normaliseDirectReports, normaliseEntry, type DirectReport, type DirectoryEntry, type PersonRef } from './directory'

export type AuthSource = 'microsoft' | 'password' | 'demo'

export interface MyProfileData {
  employee: DirectoryEntry
  manager: PersonRef | null
  direct_reports: DirectReport[]
  /** "Mon DD" - month and day only, never a year. */
  birthday: string | null
  roles: string[]
  auth_source: AuthSource | string
  member_since: string | null
  /** The HR profile sections, read-only (government numbers arrive masked from the server). */
  profile: EmployeeProfile
}

export function normaliseMyProfile(raw: unknown): MyProfileData {
  const r = (raw ?? {}) as Record<string, unknown>
  const employee = normaliseEntry(r.employee)
  const m = (r.manager ?? employee.manager) as Partial<PersonRef> | null
  const manager = m && typeof m === 'object' && m.employee_id ? { employee_id: m.employee_id, name: m.name || m.employee_id } : null
  return {
    employee,
    manager,
    direct_reports: normaliseDirectReports(r.direct_reports),
    birthday: typeof r.birthday === 'string' && r.birthday.trim() ? r.birthday : null,
    roles: Array.isArray(r.roles) ? r.roles.filter((x): x is string => typeof x === 'string') : [],
    auth_source: typeof r.auth_source === 'string' ? r.auth_source : 'password',
    member_since: typeof r.member_since === 'string' ? r.member_since : null,
    profile: normaliseProfile((r.employee as Record<string, unknown> | null | undefined)?.profile),
  }
}

export const meApi = {
  profile: () => api.get<unknown>('/me/profile').then((r) => normaliseMyProfile(r.data)),
  /** Own personal, contact, emergency contact and government IDs only (work, birth year and the basics are HR only: the server answers 422 "Ask HR to change this."). Returns the updated profile. */
  updateProfile: (body: { profile: ProfilePatch }) => api.patch<unknown>('/me/profile', body).then((r) => normaliseMyProfile(r.data)),
}
