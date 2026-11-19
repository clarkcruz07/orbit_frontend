/** Verified ID API: GET /verified-id/me, POST /verified-id/issuance, GET /verified-id/issuance/{id}. The caller's own card only. */
import { api } from './client'

export interface VerifiedIdMe {
  available: boolean
  valid_days: number
  last_issued_at: string | null
}
export interface VerifiedIdIssuance {
  request_id: string
  /** Opens Microsoft Authenticator when tapped on the phone itself. */
  url: string
  /** A PNG data URI of the QR code (scan it with Authenticator from another device). */
  qr_code: string | null
  expires_at: number | null
}
export type VerifiedIdState = 'created' | 'scanned' | 'issued' | 'failed'

export const verifiedIdApi = {
  /** `available: false` also when the service does not have the feature (older server): the card then simply does not show. */
  async me(): Promise<VerifiedIdMe> {
    try {
      const r = await api.get('/verified-id/me')
      const d = (r.data ?? {}) as Partial<VerifiedIdMe>
      return { available: d.available === true, valid_days: typeof d.valid_days === 'number' ? d.valid_days : 90, last_issued_at: typeof d.last_issued_at === 'string' ? d.last_issued_at : null }
    } catch {
      return { available: false, valid_days: 90, last_issued_at: null }
    }
  },
  async start(): Promise<VerifiedIdIssuance> {
    const r = await api.post('/verified-id/issuance')
    return r.data as VerifiedIdIssuance
  },
  async progress(requestId: string): Promise<{ status: VerifiedIdState; error: string | null }> {
    const r = await api.get(`/verified-id/issuance/${encodeURIComponent(requestId)}`)
    return r.data as { status: VerifiedIdState; error: string | null }
  },
}
