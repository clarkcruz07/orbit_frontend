/** Pure logic for the header search combobox (no DOM, no network) so it can be unit tested. */
import type { SearchResults } from '@/api/search'
import { statusLabel } from '@/pages/reimbursements/logic'
import { NAV_ITEMS } from '@/shell/navigation'

export const MIN_QUERY = 2
export const MAX_QUERY = 64
export const DEBOUNCE_MS = 250
export const PAGES_LIMIT = 8

export type OptionKind = 'person' | 'request' | 'page'

export interface SearchOption {
  /** DOM id, also used for aria-activedescendant */
  id: string
  kind: OptionKind
  label: string
  sub: string
  /** In-app path the option opens */
  to: string
  /** Request status code, for a pill */
  status?: string
}

export interface SearchGroup {
  id: 'people' | 'requests' | 'pages'
  label: string
  options: SearchOption[]
}

export interface NormalisedQuery {
  q: string
  /** 'empty' | 'short' | 'long' | null (valid) */
  problem: 'empty' | 'short' | 'long' | null
}

/** Trim, then check the contract limits (2..64). */
export function normaliseQuery(raw: string): NormalisedQuery {
  const q = (raw ?? '').trim()
  if (!q) return { q, problem: 'empty' }
  if (q.length < MIN_QUERY) return { q, problem: 'short' }
  if (q.length > MAX_QUERY) return { q, problem: 'long' }
  return { q, problem: null }
}

interface PageEntry {
  id: string
  label: string
  to: string
  keywords: string
}

const EXTRA_KEYWORDS: Record<string, string> = {
  dashboard: 'home welcome hr administration admin people lifecycle',
  'my-profile': 'account me details birthday',
  'hr-requests': 'requests forms',
  reimbursements: 'expenses receipts claims',
  'company-calendar': 'holidays birthdays events dates',
  attendance: 'timesheet hours',
}

/** Searchable pages: every sidebar entry plus the (non-sidebar) Employee Directory. Static, filtered on the client. */
export const PAGE_ENTRIES: readonly PageEntry[] = [
  ...NAV_ITEMS.filter((i) => !i.onlyView).map((i) => ({ id: i.id, label: i.label, to: i.path, keywords: EXTRA_KEYWORDS[i.id] ?? '' })),
  { id: 'directory', label: 'Employee Directory', to: '/directory', keywords: 'people staff employees colleagues find' },
]

/** Case-insensitive match on label and keywords; label prefix first, then label contains, then keywords. Max 8. */
export function filterPages(q: string, entries: readonly PageEntry[] = PAGE_ENTRIES): SearchOption[] {
  const needle = q.trim().toLowerCase()
  if (needle.length < MIN_QUERY) return []
  const scored: { entry: PageEntry; score: number }[] = []
  for (const entry of entries) {
    const label = entry.label.toLowerCase()
    let score = -1
    if (label.startsWith(needle)) score = 0
    else if (label.split(/[\s&-]+/).some((w) => w.startsWith(needle))) score = 1
    else if (label.includes(needle)) score = 2
    else if (entry.keywords.toLowerCase().split(/\s+/).some((w) => w.startsWith(needle))) score = 3
    if (score >= 0) scored.push({ entry, score })
  }
  return scored
    .sort((a, b) => a.score - b.score)
    .slice(0, PAGES_LIMIT)
    .map(({ entry }) => ({ id: `search-opt-page-${entry.id}`, kind: 'page' as const, label: entry.label, sub: 'Page', to: entry.to }))
}

/** People and Requests come from the server, Pages from the client; empty groups are dropped. */
export function buildGroups(results: SearchResults | null, pages: readonly SearchOption[]): SearchGroup[] {
  const groups: SearchGroup[] = []
  const people = (results?.people ?? []).map((p) => ({
    id: `search-opt-person-${p.employee_id}`,
    kind: 'person' as const,
    label: p.name,
    sub: [p.job_title, p.department].filter(Boolean).join(' - '),
    to: `/directory/${encodeURIComponent(p.employee_id)}`,
  }))
  const requests = (results?.requests ?? []).map((r) => ({
    id: `search-opt-request-${r.request_id}`,
    kind: 'request' as const,
    label: r.purpose,
    sub: r.status ? `Reimbursement - ${statusLabel(r.status)}` : 'Reimbursement request',
    to: `/reimbursements/${encodeURIComponent(r.request_id)}`,
    status: r.status,
  }))
  if (people.length) groups.push({ id: 'people', label: 'People', options: people })
  if (requests.length) groups.push({ id: 'requests', label: 'Requests', options: requests })
  if (pages.length) groups.push({ id: 'pages', label: 'Pages', options: [...pages] })
  return groups
}

export function flattenGroups(groups: readonly SearchGroup[]): SearchOption[] {
  return groups.flatMap((g) => g.options)
}

/** Arrow/Home/End movement through `count` options. -1 means "no option highlighted". Wraps around. */
export function nextActiveIndex(current: number, key: string, count: number): number {
  if (count <= 0) return -1
  switch (key) {
    case 'ArrowDown':
      return current < 0 || current >= count - 1 ? 0 : current + 1
    case 'ArrowUp':
      return current <= 0 ? count - 1 : current - 1
    case 'Home':
      return 0
    case 'End':
      return count - 1
    default:
      return current
  }
}

/** Polite wording for failed searches (never raw server text). */
export function searchFailureMessage(status: number | undefined): string {
  if (status === 400) return `Type between ${MIN_QUERY} and ${MAX_QUERY} characters to search.`
  if (status === 429) return 'You are searching too fast. Wait a moment and try again.'
  if (status === 401 || status === 403) return 'Your session may have ended. Sign in again to search.'
  if (!status) return "Can't reach the Bluedge People service. Try again."
  return 'Search is unavailable right now. Try again in a moment.'
}

export function hintFor(problem: NormalisedQuery['problem']): string | null {
  if (problem === 'short') return `Type at least ${MIN_QUERY} characters to search.`
  if (problem === 'long') return `Searches are limited to ${MAX_QUERY} characters.`
  return null
}
