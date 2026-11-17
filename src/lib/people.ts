/** Presentation helpers for the Directory and My Profile screens (pure). */

export const EMPLOYMENT_TYPES: readonly { value: string; label: string }[] = [
  { value: 'full_time', label: 'Full-time' },
  { value: 'part_time', label: 'Part-time' },
  { value: 'contractor', label: 'Contractor' },
  { value: 'intern', label: 'Intern' },
]

/** "full_time" -> "Full-time"; unknown values are title-cased rather than hidden. */
export function employmentTypeLabel(value: string | null | undefined): string {
  if (!value) return '-'
  const known = EMPLOYMENT_TYPES.find((t) => t.value === value)
  if (known) return known.label
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

/** "active" -> "Active". */
export function personStatusLabel(value: string | null | undefined): string {
  if (!value) return '-'
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export type StatusTone = 'green' | 'amber' | 'neutral'

export function personStatusTone(value: string | null | undefined): StatusTone {
  const v = (value ?? '').toLowerCase()
  if (v === 'active') return 'green'
  if (v === 'on_leave' || v === 'probation' || v === 'onboarding' || v === 'offboarding') return 'amber'
  return 'neutral'
}

export function authSourceLabel(source: string | null | undefined): string {
  if (source === 'microsoft') return 'Microsoft work account'
  if (source === 'password') return 'Email and password'
  if (source === 'demo') return 'Local account'
  return source || '-'
}

export interface PageWindow {
  page: number
  pages: number
  from: number
  to: number
  hasPrev: boolean
  hasNext: boolean
}

/** Pagination arithmetic. `page` is clamped to the valid range; an empty list reports 0-0. */
export function pageWindow(page: number, pageSize: number, total: number): PageWindow {
  const size = Math.max(1, pageSize)
  const count = Math.max(0, total)
  const pages = Math.max(1, Math.ceil(count / size))
  const p = Math.min(Math.max(1, Math.floor(page) || 1), pages)
  const from = count === 0 ? 0 : (p - 1) * size + 1
  const to = Math.min(count, p * size)
  return { page: p, pages, from, to, hasPrev: p > 1, hasNext: p < pages }
}

/** Readable role list for the profile ("HR Administrator, Manager"). Presentation only. */
export function rolesText(roles: readonly string[]): string {
  const labels: Record<string, string> = { HRAdmin: 'HR Administrator', Manager: 'Manager', Finance: 'Finance', Employee: 'Employee' }
  const list = roles.map((r) => labels[r] ?? r)
  return list.length ? list.join(', ') : 'Employee'
}
