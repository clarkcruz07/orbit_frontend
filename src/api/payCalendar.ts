/** GET /pay-calendar: the payday a submission made today lands on, its cutoff, and the payday after it. The server decides all of it. */
import { api } from './client'
import { normalisePayCalendar, type PayCalendar } from '@/lib/payday'

export const payCalendarApi = {
  get: (): Promise<PayCalendar | null> => api.get<unknown>('/pay-calendar').then((r) => normalisePayCalendar(r.data)),
}
