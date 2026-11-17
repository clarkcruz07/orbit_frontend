/**
 * Documents API (docs/api/documents.md). Typed against the contract.
 * Every download goes through the Bearer-token client as a blob: a token is never put in a URL.
 */
import { api } from '@/api/client'

export type ExpiryState = 'expired' | 'expiring' | 'valid'
export type DocAction = 'download' | 'add_version' | 'edit'
export type PolicyAction = 'download' | 'acknowledge' | 'publish_version' | 'view_coverage'

export interface FileMeta {
  filename: string
  content_type: string
  size_bytes: number
  sha256: string
}

export interface UserRef {
  user_id: string
  name: string
}

export interface DocumentType {
  type_id: string
  name: string
  description: string
  expiry_required: boolean
  hr_only: boolean
  active: boolean
  placeholder: boolean
}

export interface DocumentVersion {
  version: number
  status: 'active' | 'superseded'
  expires_on: string | null
  file: FileMeta
  uploaded_by: UserRef
  uploaded_at: string
}

export interface EmployeeRef {
  employee_id: string
  name: string | null
  department: string | null
  job_title: string | null
}

export interface EmployeeDocument {
  doc_id: string
  employee_id: string
  employee: EmployeeRef | null
  type: { type_id: string; name: string; hr_only: boolean; expiry_required: boolean }
  title: string
  status: 'active'
  version: number
  version_count: number
  expires_on: string | null
  expiry_state: ExpiryState | null
  days_left: number | null
  file: FileMeta
  uploaded_by: UserRef
  uploaded_at: string
  created_at: string
  updated_at: string
  allowed_actions: DocAction[]
  /** Detail only, newest first. */
  versions?: DocumentVersion[]
}

export interface Page<T> {
  items: T[]
  total: number
  page: number
  page_size: number
}

export interface ExpiringPage extends Page<EmployeeDocument> {
  days: number
  today: string
}

export interface PolicyVersion {
  version: number
  status: 'active' | 'superseded'
  title: string
  summary: string
  effective_date: string
  published_at: string
  file: FileMeta
  published_by?: UserRef
}

export interface PolicySummary {
  policy_id: string
  title: string
  summary: string
  version: number
  effective_date: string
  published_at: string
  file: FileMeta
  acknowledged: boolean
  acknowledged_at: string | null
  version_count: number
  created_at: string
  updated_at: string
  published_by?: UserRef
  allowed_actions: PolicyAction[]
  versions?: PolicyVersion[]
}

export interface CoverageRow {
  policy_id: string
  title: string
  version: number
  acknowledged_count: number
  outstanding_count: number
  pct: number | null
}

export interface CoverageOverview {
  eligible_count: number
  overall_pct: number | null
  policies: CoverageRow[]
}

export interface PolicyCoverage {
  policy_id: string
  title: string
  version: number
  is_current: boolean
  eligible_count: number
  acknowledged_count: number
  outstanding_count: number
  pct: number | null
  acknowledged: { employee_id: string; name: string; department: string | null; acknowledged_at: string }[]
  outstanding: { employee_id: string; name: string; department: string | null }[]
}

export interface TypeBody {
  name?: string
  description?: string
  expiry_required?: boolean
  hr_only?: boolean
  active?: boolean
}

export interface UploadFields {
  type_id: string
  title: string
  file: File
  expires_on?: string
  /** HR uploading on behalf of someone else. */
  employee_id?: string
}

export interface PolicyFields {
  title?: string
  summary?: string
  effective_date: string
  file: File
  expected_version?: number
}

const enc = encodeURIComponent
const UPLOAD_TIMEOUT = 90000

function form(fields: Record<string, string | File | undefined | null>): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null || v === '') continue
    f.append(k, v)
  }
  return f
}

export const documentsApi = {
  // ----- types
  types: (includeInactive = false) =>
    api.get<{ items: DocumentType[] }>('/documents/types', { params: includeInactive ? { include_inactive: true } : undefined }),
  createType: (body: TypeBody) => api.post<DocumentType>('/documents/types', body),
  updateType: (id: string, body: TypeBody) => api.patch<DocumentType>(`/documents/types/${enc(id)}`, body),
  deleteType: (id: string) => api.delete(`/documents/types/${enc(id)}`),

  // ----- employee documents
  list: (q: { employee_id?: string; type_id?: string; page?: number; page_size?: number }) =>
    api.get<Page<EmployeeDocument>>('/documents/employee', {
      params: Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== '')),
    }),
  create: (f: UploadFields, onProgress?: (fraction: number) => void) =>
    api.post<EmployeeDocument>(
      '/documents/employee',
      form({ type_id: f.type_id, title: f.title, expires_on: f.expires_on, employee_id: f.employee_id, file: f.file }),
      { timeout: UPLOAD_TIMEOUT, onUploadProgress: (e) => e.total && onProgress?.(Math.min(1, e.loaded / e.total)) },
    ),
  get: (docId: string) => api.get<EmployeeDocument>(`/documents/employee/${enc(docId)}`),
  update: (docId: string, body: { title?: string; expires_on?: string; clear_expiry?: boolean; version?: number }) =>
    api.patch<EmployeeDocument>(`/documents/employee/${enc(docId)}`, body),
  addVersion: (docId: string, f: { file: File; expires_on?: string; expected_version?: number }) =>
    api.post<EmployeeDocument>(
      `/documents/employee/${enc(docId)}/versions`,
      form({ file: f.file, expires_on: f.expires_on, expected_version: f.expected_version === undefined ? undefined : String(f.expected_version) }),
      { timeout: UPLOAD_TIMEOUT },
    ),
  /** Authorised download (Bearer header). `version` omitted = current version. */
  fileBlob: (docId: string, version?: number) =>
    api.get<Blob>(version === undefined ? `/documents/employee/${enc(docId)}/file` : `/documents/employee/${enc(docId)}/versions/${version}/file`, {
      responseType: 'blob',
      timeout: 60000,
    }),

  // ----- expiring
  expiring: (q: { days?: number; include_expired?: boolean; page?: number; page_size?: number }) =>
    api.get<ExpiringPage>('/documents/expiring', { params: q }),

  // ----- policies
  policies: () => api.get<{ items: PolicySummary[] }>('/documents/policies'),
  policy: (id: string) => api.get<PolicySummary>(`/documents/policies/${enc(id)}`),
  publishPolicy: (f: Omit<PolicyFields, 'expected_version'>) =>
    api.post<PolicySummary>('/documents/policies', form({ title: f.title, summary: f.summary, effective_date: f.effective_date, file: f.file }), {
      timeout: UPLOAD_TIMEOUT,
    }),
  publishVersion: (id: string, f: PolicyFields) =>
    api.post<PolicySummary>(
      `/documents/policies/${enc(id)}/versions`,
      form({
        title: f.title,
        summary: f.summary,
        effective_date: f.effective_date,
        file: f.file,
        expected_version: f.expected_version === undefined ? undefined : String(f.expected_version),
      }),
      { timeout: UPLOAD_TIMEOUT },
    ),
  policyBlob: (id: string, version?: number) =>
    api.get<Blob>(version === undefined ? `/documents/policies/${enc(id)}/file` : `/documents/policies/${enc(id)}/versions/${version}/file`, {
      responseType: 'blob',
      timeout: 60000,
    }),
  acknowledge: (id: string, version: number) =>
    api.post<{ policy_id: string; version: number; acknowledged_at: string }>(`/documents/policies/${enc(id)}/acknowledge`, { version }),
  coverage: () => api.get<CoverageOverview>('/documents/policies/coverage'),
  policyCoverage: (id: string, version?: number) =>
    api.get<PolicyCoverage>(`/documents/policies/${enc(id)}/coverage`, { params: version === undefined ? undefined : { version } }),
}
