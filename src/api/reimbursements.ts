/**
 * Reimbursements API module (SPEC section 7 + backend/DECISIONS.md). Typed against the real response shapes.
 * Approval never pays or posts anything.
 */
import { api } from './client'
import type { AllowedAction, FieldKey, FieldSource, ReimbursementStatus, Scope } from '@/pages/reimbursements/logic'

export type { AllowedAction, FieldKey, FieldSource, ReimbursementStatus, Scope } from '@/pages/reimbursements/logic'
/** Kept for the earlier import name. */
export type ReimbursementScope = Scope

export interface ReimbursementConfig {
  max_receipt_mb: number
  allowed_types: string[]
  allowed_currencies: string[]
  ocr: { provider: string; model_label: string; enabled: boolean }
  policy_notice: string
  /** Raw server value; read it with normalisePayCalendar (absent -> null). */
  pay_calendar?: unknown
}

export interface FieldState {
  value: string | null
  source: FieldSource
  extracted_value: string | null
  confidence: number | null
  flag: string | null
}

export type Fields = Record<FieldKey, FieldState>

export interface ReceiptMeta {
  receipt_id: string
  filename: string
  content_type: string
  size_bytes: number
  sha256: string
  uploaded_at: string
  uploaded_by: string
  is_current: boolean
}

export interface Extraction {
  status: 'ok' | 'partial' | 'failed'
  provider: string
  model_label: string
  error_code: string | null
  receipt_id?: string
  completed_at: string
}

export interface Decision {
  decision_id: string
  by_user_id: string
  by_name?: string | null
  by_role: string
  action: 'approve' | 'reject' | 'clarify'
  comment: string | null
  at: string
  stage: 'manager' | 'finance'
}

export interface EmployeeCard {
  employee_id: string
  name: string | null
  department: string | null
  job_title: string | null
}

export interface Reimbursement {
  request_id: string
  employee_id: string
  employee: EmployeeCard
  status: ReimbursementStatus
  stage: 'manager' | 'finance' | null
  purpose: string
  fields: Fields
  notes: string | null
  receipts: ReceiptMeta[]
  extraction: Extraction | null
  decisions: Decision[]
  created_at: string
  updated_at: string
  submitted_at: string | null
  version: number
  allowed_actions: AllowedAction[]
  /** Raw server value; read it with normalisePayday (absent or null for drafts and older rows). */
  payday?: unknown
}

export interface ReimbursementSummary {
  request_id: string
  employee_id: string
  employee_name: string | null
  department: string | null
  purpose: string
  status: ReimbursementStatus
  stage: 'manager' | 'finance' | null
  merchant: string | null
  receipt_date: string | null
  currency: string | null
  total_amount: string | null
  submitted_at: string | null
  created_at: string
  updated_at: string
  version: number
  allowed_actions: AllowedAction[]
  payday?: unknown
}

export interface ReceiptResult {
  receipt: ReceiptMeta
  extraction: Extraction
  request: Reimbursement
}

export interface AuditEvent {
  event_id: string
  at: string
  actor_user_id: string | null
  actor_roles: string[]
  action: string
  target_type: string | null
  target_id: string | null
  outcome: string
  details: Record<string, unknown>
}

export interface PatchBody {
  purpose?: string
  notes?: string | null
  version?: number
  fields?: Partial<Record<FieldKey, string | null>>
}

export type DecisionAction = 'approve' | 'reject' | 'clarify'

const enc = encodeURIComponent
const base = (id: string) => `/reimbursements/${enc(id)}`

export const reimbursementsApi = {
  config: () => api.get<ReimbursementConfig>('/reimbursements/config'),
  list: (scope: Scope, status?: string) =>
    api.get<ReimbursementSummary[]>('/reimbursements', { params: { scope, ...(status ? { status } : {}) } }),
  create: (purpose: string) => api.post<Reimbursement>('/reimbursements', { purpose }),
  /** The same requests the list shows for this scope and status, as an Excel file (fetched with the signed-in client, then saved from memory). */
  exportXlsx: (scope: Scope, status?: string) =>
    api.get<Blob>('/reimbursements/export', { params: { scope, ...(status ? { status } : {}) }, responseType: 'blob', timeout: 60000 }),
  get: (id: string) => api.get<Reimbursement>(base(id)),
  patch: (id: string, body: PatchBody) => api.patch<Reimbursement>(base(id), body),
  /** Multipart upload. The extraction runs inside this request, so the timeout is generous. */
  uploadReceipt: (id: string, file: File, onProgress?: (fraction: number) => void) => {
    const form = new FormData()
    form.append('file', file)
    return api.post<ReceiptResult>(`${base(id)}/receipts`, form, {
      timeout: 90000,
      onUploadProgress: (e) => {
        if (onProgress && e.total) onProgress(Math.min(1, e.loaded / e.total))
      },
    })
  },
  extract: (id: string) => api.post<ReceiptResult>(`${base(id)}/extract`, undefined, { timeout: 90000 }),
  submit: (id: string, confirmFields: boolean) => api.post<Reimbursement>(`${base(id)}/submit`, { confirm_fields: confirmFields }),
  decide: (id: string, action: DecisionAction, comment: string) =>
    api.post<Reimbursement>(`${base(id)}/decision`, { action, comment }),
  audit: (id: string) => api.get<AuditEvent[]>(`${base(id)}/audit`),
  /** Authorised download through the Bearer-token client; the token is never put in a URL. */
  receiptBlob: (id: string, receiptId: string) =>
    api.get<Blob>(`${base(id)}/receipts/${enc(receiptId)}/file`, { responseType: 'blob', timeout: 60000 }),
}
