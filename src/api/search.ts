/** Header search API (SPEC_ADDENDUM_2 section 2): GET /search?q= (people + requests the caller may see). */
import { api } from './client'

export interface SearchPerson {
  employee_id: string
  name: string
  job_title: string | null
  department: string | null
}

export interface SearchRequest {
  request_id: string
  purpose: string
  status: string
}

export interface SearchResults {
  q: string
  people: SearchPerson[]
  requests: SearchRequest[]
  limit: number
}

export function normaliseSearch(raw: unknown, q: string): SearchResults {
  const r = (raw ?? {}) as Record<string, unknown>
  const s = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)
  const people = (Array.isArray(r.people) ? r.people : [])
    .map((p) => {
      const x = (p ?? {}) as Record<string, unknown>
      return { employee_id: String(x.employee_id ?? ''), name: s(x.name) ?? 'Unnamed', job_title: s(x.job_title), department: s(x.department) }
    })
    .filter((p) => p.employee_id)
  const requests = (Array.isArray(r.requests) ? r.requests : [])
    .map((p) => {
      const x = (p ?? {}) as Record<string, unknown>
      return { request_id: String(x.request_id ?? ''), purpose: s(x.purpose) ?? 'Reimbursement request', status: s(x.status) ?? '' }
    })
    .filter((p) => p.request_id)
  return { q: typeof r.q === 'string' ? r.q : q, people, requests, limit: typeof r.limit === 'number' ? r.limit : 8 }
}

export const searchApi = {
  search: (q: string, signal?: AbortSignal) => api.get<unknown>('/search', { params: { q }, signal }).then((r) => normaliseSearch(r.data, q)),
}
