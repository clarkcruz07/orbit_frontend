/**
 * Learning & Development API (docs/api/learning.md). Typed against the contract.
 * No grades, costs, payments or external LMS.
 * Only GET, POST and PATCH are used (CORS allows nothing else).
 */
import { api } from '@/api/client'

export type Delivery = 'self_paced' | 'classroom' | 'online'
export type EnrolmentStatus = 'assigned' | 'enrolled' | 'in_progress' | 'completed' | 'cancelled'
export type EnrolmentAction = 'start' | 'update_progress' | 'complete' | 'upload_certificate' | 'confirm' | 'return' | 'update_due_date' | 'cancel'
export type CourseAction = 'enrol' | 'assign' | 'edit'
export type EnrolmentScope = 'mine' | 'team' | 'review' | 'all'
export type ConfirmationStatus = 'not_required' | 'pending' | 'confirmed'

export interface Course {
  course_id: string
  title: string
  category: string
  duration_hours: number
  delivery: Delivery
  active: boolean
  description: string
  mandatory_default: boolean
  placeholder: boolean
  created_at: string
  updated_at: string
  version: number
  my_enrolment: { enrolment_id: string; status: EnrolmentStatus } | null
  allowed_actions: CourseAction[]
}

export interface EmployeeBrief {
  employee_id: string
  name: string | null
  department: string | null
  job_title: string | null
}

export interface Certificate {
  certificate_id: string
  filename: string
  content_type: string
  size_bytes: number
  uploaded_at: string
  is_current: boolean
}

export interface Enrolment {
  enrolment_id: string
  course: { course_id: string; title: string; category: string | null; duration_hours: number | null; delivery: Delivery | null; active: boolean }
  employee: EmployeeBrief
  status: EnrolmentStatus
  source: 'self' | 'assigned'
  mandatory: boolean
  assigned_by: { employee_id: string; name: string | null; role: string } | null
  assigned_at: string | null
  due_date: string | null
  progress: number
  completion_note: string | null
  completed_at: string | null
  requires_confirmation: boolean
  confirmation_status: ConfirmationStatus | null
  confirmed_at: string | null
  confirmed_by: { employee_id: string; name: string | null } | null
  overdue: boolean
  days_overdue: number
  due_soon: boolean
  days_until_due: number | null
  counts_as_complete: boolean
  certificates: Certificate[]
  created_at: string
  updated_at: string
  version: number
  allowed_actions: EnrolmentAction[]
}

export interface Page<T> {
  items: T[]
  total: number
  page: number
  page_size: number
}
export interface CoursePage extends Page<Course> {
  categories: string[]
}

export interface LearningConfig {
  limits: {
    title_max: number
    description_max: number
    category_max: number
    completion_note_max: number
    duration_hours_max: number
    max_certificate_mb: number
    max_certificates_per_enrolment: number
  }
  allowed_certificate_types: string[]
  statuses: string[]
  deliveries: Delivery[]
  due_soon_days: number
  notice: string
}

export interface MySummary {
  counts: {
    assigned: number
    enrolled: number
    in_progress: number
    completed: number
    cancelled: number
    overdue: number
    due_soon: number
    pending_confirmation: number
    mandatory_open: number
  }
  awaiting_my_confirmation: number
}

export interface TeamRow {
  employee: EmployeeBrief
  assigned: number
  enrolled: number
  in_progress: number
  completed: number
  overdue: number
  pending_confirmation: number
  mandatory_open: number
}
export interface TeamSummary {
  items: TeamRow[]
  total: number
}

export interface ComplianceDepartment {
  department: string
  assigned: number
  completed: number
  overdue: number
  pending_confirmation: number
  completion_pct: number
}
export interface ComplianceCourse {
  course_id: string
  title: string
  mandatory_default: boolean
  assigned: number
  completed: number
  overdue: number
  pending_confirmation: number
  completion_pct: number
  not_enrolled: number
  by_department: ComplianceDepartment[]
}
export interface ComplianceOverdue {
  enrolment_id: string
  employee_id: string
  employee_name: string
  department: string | null
  course_id: string
  course_title: string
  due_date: string
  days_overdue: number
  status: EnrolmentStatus
}
export interface Compliance {
  as_of: string
  totals: { assigned: number; completed: number; overdue: number; pending_confirmation: number; completion_pct: number }
  courses: ComplianceCourse[]
  overdue: ComplianceOverdue[]
  overdue_total: number
  departments: string[]
  notice: string
}

export interface CourseQuery {
  q?: string
  category?: string
  delivery?: string
  active?: 'true' | 'false' | 'all'
  page?: number
  page_size?: number
}
export interface EnrolmentQuery {
  scope?: EnrolmentScope
  status?: string
  course_id?: string
  employee_id?: string
  overdue?: boolean
  mandatory?: boolean
  page?: number
  page_size?: number
}
export interface CourseCreate {
  title: string
  description?: string
  category: string
  duration_hours: number
  delivery: Delivery
  mandatory_default?: boolean
  active?: boolean
}
export interface CoursePatch extends Partial<CourseCreate> {
  version?: number
}
export interface AssignBody {
  course_id: string
  employee_id: string
  due_date?: string | null
  mandatory?: boolean
}
export interface EnrolmentPatch {
  progress?: number
  due_date?: string | null
  version?: number
}

const enc = encodeURIComponent

/** Blank filters are dropped; booleans become the literal strings the API expects. */
export function cleanParams(q: object): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {}
  for (const [k, v] of Object.entries(q as Record<string, unknown>)) {
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v
    else if (typeof v === 'boolean') out[k] = v
    else if (typeof v === 'string' && v.trim()) out[k] = v.trim()
  }
  return out
}

const enrolmentUrl = (id: string) => `/learning/enrolments/${enc(id)}`

export const learningApi = {
  config: () => api.get<LearningConfig>('/learning/config'),
  courses: (q: CourseQuery = {}) => api.get<CoursePage>('/learning/courses', { params: cleanParams(q) }),
  course: (id: string) => api.get<Course>(`/learning/courses/${enc(id)}`),
  createCourse: (body: CourseCreate) => api.post<Course>('/learning/courses', body),
  patchCourse: (id: string, body: CoursePatch) => api.patch<Course>(`/learning/courses/${enc(id)}`, body),
  enrolments: (q: EnrolmentQuery = {}) => api.get<Page<Enrolment>>('/learning/enrolments', { params: cleanParams({ scope: 'mine', ...q }) }),
  enrolment: (id: string) => api.get<Enrolment>(enrolmentUrl(id)),
  enrol: (courseId: string) => api.post<Enrolment>('/learning/enrolments', { course_id: courseId }),
  assign: (body: AssignBody) => api.post<Enrolment>('/learning/assignments', body),
  patchEnrolment: (id: string, body: EnrolmentPatch) => api.patch<Enrolment>(enrolmentUrl(id), body),
  start: (id: string) => api.post<Enrolment>(`${enrolmentUrl(id)}/start`),
  complete: (id: string, note?: string) => api.post<Enrolment>(`${enrolmentUrl(id)}/complete`, note && note.trim() ? { completion_note: note.trim() } : {}),
  confirm: (id: string) => api.post<Enrolment>(`${enrolmentUrl(id)}/confirm`),
  returnCompletion: (id: string) => api.post<Enrolment>(`${enrolmentUrl(id)}/return`),
  cancel: (id: string) => api.post<Enrolment>(`${enrolmentUrl(id)}/cancel`),
  /** Multipart field `file`. The server validates type (magic bytes), size and the 5-file limit. */
  uploadCertificate: (id: string, file: File, onProgress?: (fraction: number) => void) => {
    const form = new FormData()
    form.append('file', file)
    return api.post<Enrolment>(`${enrolmentUrl(id)}/certificate`, form, {
      timeout: 90000,
      onUploadProgress: (e) => {
        if (onProgress && e.total) onProgress(Math.min(1, e.loaded / e.total))
      },
    })
  },
  /** Authorised download through the Bearer-token client; the token is never put in a URL. */
  certificateBlob: (id: string, certificateId: string) =>
    api.get<Blob>(`${enrolmentUrl(id)}/certificates/${enc(certificateId)}/file`, { responseType: 'blob', timeout: 60000 }),
  mySummary: () => api.get<MySummary>('/learning/my/summary'),
  teamSummary: () => api.get<TeamSummary>('/learning/team/summary'),
  compliance: (q: { course_id?: string; department?: string } = {}) => api.get<Compliance>('/learning/compliance', { params: cleanParams(q) }),
}
