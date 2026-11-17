/** Calendar grid math and event grouping (pure). Dates are `YYYY-MM-DD` strings; see dates.ts. */
import type { CalendarEvent } from '@/api/calendar'
import { WEEKDAY_SHORT, daysInMonth, isoDate, monthNumber, parseIsoDate, parseMonthKey, shiftMonth, weekdayOf } from './dates'

export interface GridCell {
  /** YYYY-MM-DD */
  date: string
  day: number
  /** false for the leading/trailing days that belong to the neighbouring months */
  inMonth: boolean
}

/** Weekday column headers starting at `weekStart` (0 = Sunday, 1 = Monday). */
export function weekdayLabels(weekStart = 0): string[] {
  return Array.from({ length: 7 }, (_, i) => WEEKDAY_SHORT[(weekStart + i) % 7])
}

/**
 * Weeks (rows of 7 cells) that cover the month, padded with neighbouring-month days so every row is complete.
 * 4 to 6 rows; a 28-day February that starts on the week start is exactly 4 rows.
 */
export function buildMonthGrid(key: string, weekStart = 0): GridCell[][] {
  const p = parseMonthKey(key)
  if (!p) return []
  const lead = (weekdayOf(p.year, p.month, 1) - weekStart + 7) % 7
  const total = daysInMonth(p.year, p.month)
  const rows = Math.ceil((lead + total) / 7)
  const prev = parseMonthKey(shiftMonth(key, -1))!
  const next = parseMonthKey(shiftMonth(key, 1))!
  const prevDays = daysInMonth(prev.year, prev.month)
  const weeks: GridCell[][] = []
  for (let r = 0; r < rows; r++) {
    const week: GridCell[] = []
    for (let c = 0; c < 7; c++) {
      const offset = r * 7 + c - lead + 1 // day number relative to this month (may be <1 or >total)
      if (offset < 1) week.push({ date: isoDate(prev.year, prev.month, prevDays + offset), day: prevDays + offset, inMonth: false })
      else if (offset > total) week.push({ date: isoDate(next.year, next.month, offset - total), day: offset - total, inMonth: false })
      else week.push({ date: isoDate(p.year, p.month, offset), day: offset, inMonth: true })
    }
    weeks.push(week)
  }
  return weeks
}

/** The calendar is available from `back` months before to `ahead` months after the current month (server rule: 12). */
export const CALENDAR_SPAN_MONTHS = 12

export function monthBounds(currentKey: string, span = CALENDAR_SPAN_MONTHS): { min: string; max: string } {
  return { min: shiftMonth(currentKey, -span), max: shiftMonth(currentKey, span) }
}

export function monthInRange(key: string, currentKey: string, span = CALENDAR_SPAN_MONTHS): boolean {
  const n = monthNumber(key)
  const c = monthNumber(currentKey)
  return n !== null && c !== null && Math.abs(n - c) <= span
}

/** Unparsable or out-of-range months fall back to the current month's nearest allowed month. */
export function clampMonth(key: string | null | undefined, currentKey: string, span = CALENDAR_SPAN_MONTHS): string {
  const n = key ? monthNumber(key) : null
  const c = monthNumber(currentKey)
  if (n === null || c === null) return currentKey
  if (n > c + span) return shiftMonth(currentKey, span)
  if (n < c - span) return shiftMonth(currentKey, -span)
  return key as string
}

export function canShiftMonth(key: string, delta: number, currentKey: string, span = CALENDAR_SPAN_MONTHS): boolean {
  return monthInRange(shiftMonth(key, delta), currentKey, span)
}

const TYPE_ORDER: Record<string, number> = { holiday: 0, birthday: 1 }

/** Holidays first, then birthdays, then by title: a stable order for chips and agenda rows. */
export function sortEvents(events: readonly CalendarEvent[]): CalendarEvent[] {
  return [...events].sort((a, b) => (TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9) || a.title.localeCompare(b.title))
}

export function groupByDate(events: readonly CalendarEvent[]): Map<string, CalendarEvent[]> {
  const map = new Map<string, CalendarEvent[]>()
  for (const e of sortEvents(events)) {
    const list = map.get(e.date)
    if (list) list.push(e)
    else map.set(e.date, [e])
  }
  return map
}

export interface AgendaDay {
  date: string
  events: CalendarEvent[]
}

/** Only the days of `key` that have something on them, in date order (the mobile agenda). */
export function agendaDays(events: readonly CalendarEvent[], key: string): AgendaDay[] {
  const prefix = `${key}-`
  return [...groupByDate(events.filter((e) => e.date.startsWith(prefix) && parseIsoDate(e.date)))]
    .map(([date, list]) => ({ date, events: list }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

export type ChipKind = 'holiday' | 'birthday' | 'own-birthday'

export function chipKind(e: Pick<CalendarEvent, 'type' | 'own'>): ChipKind {
  if (e.type === 'holiday') return 'holiday'
  return e.own ? 'own-birthday' : 'birthday'
}

/** Birthdays are shown without a year, e.g. "Anna Reyes - birthday". */
export function chipText(e: Pick<CalendarEvent, 'type' | 'title' | 'own'>): string {
  if (e.type === 'holiday') return e.title
  return e.own ? 'Your birthday' : `${e.title} - birthday`
}
