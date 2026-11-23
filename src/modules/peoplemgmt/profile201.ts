/** The 201 file import: update the profiles of people who already exist from a spreadsheet. Preview first, then apply what HR ticks. */
import { api } from '@/api/client'

const TIMEOUT = 90000
export const P201_MAX_BYTES = 5 * 1024 * 1024
export const P201_MAX_ROWS = 1000

export interface P201Change {
  path: string
  label: string
  /** Government numbers arrive masked (••••1234). */
  old: string | null
  new: string | null
  kind: 'new' | 'changed'
}
export type P201Status = 'changes' | 'no_changes' | 'unmatched' | 'invalid' | 'skipped'
export interface P201Row {
  row: number
  status: P201Status
  employee_id: string | null
  name: string | null
  matched_by: string | null
  given: Record<string, string>
  changes: P201Change[]
  field_errors: Record<string, string>
  message: string | null
}
export interface P201Preview {
  batch_id: string | null
  expires_in_seconds: number
  total: number
  matched: number
  unmatched: number
  invalid: number
  skipped: number
  people_with_changes: number
  new_fields: number
  changed_fields: number
  columns: { heading: string; label: string }[]
  ignored_columns: string[]
  rows: P201Row[]
}
export interface P201Applied {
  people_updated: number
  fields_applied: number
  failed: number
  rows: { row: number; employee_id: string; name?: string; status: 'updated' | 'unchanged' | 'failed'; applied: string[]; skipped: string[]; message: string | null }[]
}

const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)

export function normalisePreview(raw: unknown): P201Preview {
  const r = (raw ?? {}) as Record<string, unknown>
  return {
    batch_id: strOrNull(r.batch_id),
    expires_in_seconds: num(r.expires_in_seconds),
    total: num(r.total),
    matched: num(r.matched),
    unmatched: num(r.unmatched),
    invalid: num(r.invalid),
    skipped: num(r.skipped),
    people_with_changes: num(r.people_with_changes),
    new_fields: num(r.new_fields),
    changed_fields: num(r.changed_fields),
    columns: arr<{ heading: string; label: string }>(r.columns),
    ignored_columns: arr<string>(r.ignored_columns),
    rows: arr<Record<string, unknown>>(r.rows).map((x) => ({
      row: num(x.row),
      status: (typeof x.status === 'string' ? x.status : 'invalid') as P201Status,
      employee_id: strOrNull(x.employee_id),
      name: strOrNull(x.name),
      matched_by: strOrNull(x.matched_by),
      given: (x.given && typeof x.given === 'object' ? x.given : {}) as Record<string, string>,
      changes: arr<P201Change>(x.changes),
      field_errors: (x.field_errors && typeof x.field_errors === 'object' ? x.field_errors : {}) as Record<string, string>,
      message: strOrNull(x.message),
    })),
  }
}

export const profile201Api = {
  template: () => api.get<Blob>('/people/profile-import/template', { responseType: 'blob', timeout: 30000 }).then((r) => r.data),
  preview: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return api.post<unknown>('/people/profile-import', form, { timeout: TIMEOUT }).then((r) => normalisePreview(r.data))
  },
  apply: (batchId: string, selected: Record<string, string[]>) =>
    api.post<P201Applied>(`/people/profile-import/${encodeURIComponent(batchId)}/apply`, { mode: 'selected', selected }, { timeout: TIMEOUT }).then((r) => r.data),
}

/** The tick boxes: every new value starts ticked; a value that would replace something stays unticked until HR decides. */
export function defaultSelection(preview: P201Preview): Set<string> {
  const out = new Set<string>()
  for (const row of preview.rows) for (const c of row.changes) if (c.kind === 'new' && row.employee_id) out.add(key(row.employee_id, c.path))
  return out
}
export const key = (employeeId: string, path: string) => `${employeeId}|${path}`

export function selectionBody(preview: P201Preview, picked: Set<string>): Record<string, string[]> {
  const body: Record<string, string[]> = {}
  for (const row of preview.rows) {
    if (!row.employee_id) continue
    const paths = row.changes.filter((c) => picked.has(key(row.employee_id as string, c.path))).map((c) => c.path)
    if (paths.length) body[row.employee_id] = paths
  }
  return body
}

export const MATCHED_BY: Record<string, string> = { email: 'work e-mail', employee_number: 'employee number', name: 'name' }
