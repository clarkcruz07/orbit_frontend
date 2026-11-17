/**
 * HR Requests / cases API (docs/api/hrcases.md). Typed against the contract.
 * Attachments are downloaded through the Bearer-token client as blobs: a token is never put in a URL.
 */
import { api } from '@/api/client'

export type CaseStatus = 'open' | 'in_progress' | 'waiting_on_employee' | 'resolved' | 'closed'
export type CasePriority = 'low' | 'medium' | 'high'
export type CaseAction = 'reply' | 'set_status' | 'close' | 'set_priority' | 'assign'
export type QueueStatusFilter = CaseStatus | 'active'

export interface CaseType {
  type_id: string
  name: string
  description: string
  default_priority: CasePriority
  active: boolean
  placeholder: boolean
}

export interface Attachment {
  attachment_id: string
  filename: string
  content_type: string
  size_bytes: number
  sha256: string
}

export interface CaseMessage {
  message_id: string
  by: { user_id: string; name: string; role: 'employee' | 'hr' }
  at: string
  text: string
  is_description: boolean
  attachment: Attachment | null
}

export interface CaseSummary {
  case_id: string
  employee: { employee_id: string; name: string | null; department: string | null; job_title: string | null } | null
  type: { type_id: string; name: string }
  subject: string
  priority: CasePriority
  status: CaseStatus
  assignee: { user_id: string; name: string } | null
  message_count: number
  last_message_at: string | null
  last_message_role: 'employee' | 'hr' | null
  created_at: string
  updated_at: string
  resolved_at: string | null
  closed_at: string | null
  version: number
  allowed_actions: CaseAction[]
  allowed_statuses: CaseStatus[]
}

export interface CaseDetail extends CaseSummary {
  description: string
  messages: CaseMessage[]
}

export interface CasePage {
  items: CaseSummary[]
  total: number
  page: number
  page_size: number
}

export interface CaseQuery {
  scope: 'mine' | 'queue'
  status?: string
  priority?: string
  assignee?: string
  type_id?: string
  page?: number
  page_size?: number
}

export interface NewCase {
  type_id: string
  subject: string
  description: string
  priority?: CasePriority
  file?: File | null
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

export const casesApi = {
  types: () => api.get<{ items: CaseType[] }>('/hrcases/types'),
  list: (q: CaseQuery) =>
    api.get<CasePage>('/hrcases/cases', { params: Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== '')) }),
  create: (c: NewCase, onProgress?: (fraction: number) => void) =>
    api.post<CaseDetail>('/hrcases/cases', form({ type_id: c.type_id, subject: c.subject, description: c.description, priority: c.priority, file: c.file ?? undefined }), {
      timeout: UPLOAD_TIMEOUT,
      onUploadProgress: (e) => e.total && onProgress?.(Math.min(1, e.loaded / e.total)),
    }),
  get: (id: string) => api.get<CaseDetail>(`/hrcases/cases/${enc(id)}`),
  reply: (id: string, m: { text: string; status?: CaseStatus; file?: File | null }) =>
    api.post<CaseDetail>(`/hrcases/cases/${enc(id)}/messages`, form({ text: m.text, status: m.status, file: m.file ?? undefined }), { timeout: UPLOAD_TIMEOUT }),
  setStatus: (id: string, status: CaseStatus, version?: number) =>
    api.post<CaseDetail>(`/hrcases/cases/${enc(id)}/status`, version === undefined ? { status } : { status, version }),
  setPriority: (id: string, priority: CasePriority, version?: number) =>
    api.patch<CaseDetail>(`/hrcases/cases/${enc(id)}`, version === undefined ? { priority } : { priority, version }),
  /** `assigneeUserId: null` removes the assignment (the key is always sent, as the contract requires). */
  assign: (id: string, assigneeUserId: string | null, version?: number) =>
    api.post<CaseDetail>(`/hrcases/cases/${enc(id)}/assign`, version === undefined ? { assignee_user_id: assigneeUserId } : { assignee_user_id: assigneeUserId, version }),
  attachmentBlob: (id: string, messageId: string) =>
    api.get<Blob>(`/hrcases/cases/${enc(id)}/messages/${enc(messageId)}/attachment`, { responseType: 'blob', timeout: 60000 }),
}
