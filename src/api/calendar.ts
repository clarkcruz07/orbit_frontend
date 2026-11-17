/**
 * Company Calendar API (SPEC_ADDENDUM_2 section 2). Holidays come from the company holiday list kept by HR; birthdays are
 * included by the server only when the caller may see them (own, or everyone for HR). Month/day only, never a year.
 */
import { api } from './client'

export type CalendarEventType = 'holiday' | 'birthday'

export interface CalendarEvent {
  /** YYYY-MM-DD */
  date: string
  type: CalendarEventType
  title: string
  subtitle: string | null
  own: boolean
}

export interface CalendarMonth {
  month: string
  days_in_month: number
  events: CalendarEvent[]
}

export interface CalendarUpcoming {
  holidays: CalendarEvent[]
  birthdays: CalendarEvent[]
}

export function normaliseEvent(raw: unknown, fallbackType: CalendarEventType = 'holiday'): CalendarEvent | null {
  const r = (raw ?? {}) as Record<string, unknown>
  if (typeof r.date !== 'string' || typeof r.title !== 'string' || !r.title) return null
  const type: CalendarEventType = r.type === 'birthday' || r.type === 'holiday' ? r.type : fallbackType
  return { date: r.date, type, title: r.title, subtitle: typeof r.subtitle === 'string' && r.subtitle ? r.subtitle : null, own: r.own === true }
}

function events(raw: unknown, type: CalendarEventType): CalendarEvent[] {
  return Array.isArray(raw) ? raw.map((e) => normaliseEvent(e, type)).filter((e): e is CalendarEvent => e !== null) : []
}

export function normaliseMonth(raw: unknown, requested: string): CalendarMonth {
  const r = (raw ?? {}) as Record<string, unknown>
  return {
    month: typeof r.month === 'string' ? r.month : requested,
    days_in_month: typeof r.days_in_month === 'number' ? r.days_in_month : 0,
    events: events(r.events, 'holiday'),
  }
}

export function normaliseUpcoming(raw: unknown): CalendarUpcoming {
  const r = (raw ?? {}) as Record<string, unknown>
  return {
    holidays: events(r.holidays, 'holiday'),
    birthdays: events(r.birthdays, 'birthday'),
  }
}

export const calendarApi = {
  month: (month: string) => api.get<unknown>('/calendar', { params: { month } }).then((r) => normaliseMonth(r.data, month)),
  upcoming: (days = 30) => api.get<unknown>('/calendar/upcoming', { params: { days } }).then((r) => normaliseUpcoming(r.data)),
}
