/**
 * Probation Evaluation API (/performance/probation). Typed against the contract and normalised on the way in.
 * The PDF endpoint needs the bearer token, so it is fetched as a blob through the signed-in client and saved from a temporary object
 * URL (never a bare link). Employees get 403 on all of it: the evaluation is confidential to the evaluating manager and HR.
 */
import { api } from '@/api/client'
import { saveBlob } from '@/modules/assistant/download'
import {
  filenameFromDisposition,
  listParams,
  normaliseEligible,
  normaliseEvaluation,
  normaliseFormDef,
  normaliseListItem,
  type PatchBody,
  type StatusFilter,
} from './probationLogic'

const enc = encodeURIComponent
const base = '/performance/probation'

export const probationApi = {
  form: () => api.get<unknown>(`${base}/form`).then((r) => normaliseFormDef(r.data)),
  eligible: () => api.get<unknown>(`${base}/eligible`).then((r) => normaliseEligible(r.data)),
  list: (filter: StatusFilter, q: string, signal?: AbortSignal) =>
    api.get<unknown>(base, { params: listParams(filter, q), signal }).then((r) => {
      const d = (r.data ?? {}) as { items?: unknown[]; total?: unknown }
      const items = (Array.isArray(d.items) ? d.items : []).map(normaliseListItem).filter((i) => i.evaluation_id)
      return { items, total: typeof d.total === 'number' ? d.total : items.length }
    }),
  create: (employeeId: string, keys: readonly string[], reviewDate?: string) =>
    api.post<unknown>(base, { employee_id: employeeId, ...(reviewDate ? { review_date: reviewDate } : {}) }).then((r) => normaliseEvaluation(r.data, keys)),
  get: (id: string, keys: readonly string[]) => api.get<unknown>(`${base}/${enc(id)}`).then((r) => normaliseEvaluation(r.data, keys)),
  patch: (id: string, body: PatchBody, keys: readonly string[]) => api.patch<unknown>(`${base}/${enc(id)}`, body).then((r) => normaliseEvaluation(r.data, keys)),
  submit: (id: string, keys: readonly string[]) => api.post<unknown>(`${base}/${enc(id)}/submit`).then((r) => normaliseEvaluation(r.data, keys)),
  reopen: (id: string, keys: readonly string[]) => api.post<unknown>(`${base}/${enc(id)}/reopen`).then((r) => normaliseEvaluation(r.data, keys)),
  remove: (id: string) => api.delete(`${base}/${enc(id)}`).then(() => undefined),
  /** Fetches the PDF as a blob with the auth header and saves it under the server's file name (fallback: "Probation Evaluation.pdf"). */
  downloadPdf: async (id: string): Promise<string> => {
    const res = await api.get<Blob>(`${base}/${enc(id)}/pdf`, { responseType: 'blob' })
    const name = filenameFromDisposition((res.headers as Record<string, unknown>)?.['content-disposition'] as string | undefined)
    saveBlob(res.data, name)
    return name
  },
}
