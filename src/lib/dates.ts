/**
 * Pure date helpers (no DOM, no network). Calendar dates are handled as plain `YYYY-MM-DD` / `YYYY-MM` strings and
 * integer arithmetic so results never depend on the viewer's time zone. Only month/day are ever shown for
 * birthdays; a year is shown for dates such as a start date.
 */

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const
export const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const
export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

const pad = (n: number, width = 2) => String(n).padStart(width, '0')

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

/** `month` is 1-12. */
export function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}

export interface YearMonth {
  year: number
  month: number
}

export function parseMonthKey(key: string | null | undefined): YearMonth | null {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec((key ?? '').trim())
  return m ? { year: Number(m[1]), month: Number(m[2]) } : null
}

export function monthKey(year: number, month: number): string {
  return `${pad(year, 4)}-${pad(month)}`
}

/** Months since year 0: lets two month keys be compared and subtracted. */
export function monthNumber(key: string): number | null {
  const p = parseMonthKey(key)
  return p ? p.year * 12 + (p.month - 1) : null
}

export function shiftMonth(key: string, delta: number): string {
  const n = monthNumber(key)
  if (n === null) return key
  const t = n + delta
  return monthKey(Math.floor(t / 12), (((t % 12) + 12) % 12) + 1)
}

export function monthLabel(key: string): string {
  const p = parseMonthKey(key)
  return p ? `${MONTH_NAMES[p.month - 1]} ${p.year}` : key
}

export interface DateParts extends YearMonth {
  day: number
}

export function isoDate(year: number, month: number, day: number): string {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`
}

/** Strict `YYYY-MM-DD` (a trailing time part is ignored). Rejects impossible dates such as 2026-02-30. */
export function parseIsoDate(value: string | null | undefined): DateParts | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T ])/.exec((value ?? '').trim())
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null
  return { year, month, day }
}

/** The viewer's local calendar date (what "today" means on screen). */
export function todayParts(now: Date): DateParts {
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() }
}

export function todayIso(now: Date): string {
  const t = todayParts(now)
  return isoDate(t.year, t.month, t.day)
}

export function currentMonthKey(now: Date): string {
  const t = todayParts(now)
  return monthKey(t.year, t.month)
}

/** 0 = Sunday .. 6 = Saturday, independent of the local time zone. */
export function weekdayOf(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay()
}

/** "16 Nov" */
export function formatDayMonth(value: string): string {
  const p = parseIsoDate(value)
  return p ? `${p.day} ${MONTH_SHORT[p.month - 1]}` : value
}

/** "Mon, 16 Nov" (no year: used for holidays and birthdays). */
export function formatWeekdayDayMonth(value: string): string {
  const p = parseIsoDate(value)
  return p ? `${WEEKDAY_SHORT[weekdayOf(p.year, p.month, p.day)]}, ${p.day} ${MONTH_SHORT[p.month - 1]}` : value
}

/** "1 Mar 2021"; anything unparsable is returned unchanged (or "-" when empty). */
export function formatDate(value: string | null | undefined): string {
  if (!value) return '-'
  const p = parseIsoDate(value)
  return p ? `${p.day} ${MONTH_SHORT[p.month - 1]} ${p.year}` : value
}

/** Short relative time for the notification list. `now` is injectable so tests are deterministic. */
export function relativeTime(iso: string | null | undefined, now: Date): string {
  const then = iso ? Date.parse(iso) : NaN
  if (!Number.isFinite(then)) return ''
  const sec = Math.floor((now.getTime() - then) / 1000)
  if (sec < 45) return 'just now'
  const min = Math.floor(sec / 60)
  if (min < 1) return '1 minute ago'
  if (min < 60) return min === 1 ? '1 minute ago' : `${min} minutes ago`
  const hours = Math.floor(min / 60)
  if (hours < 24) return hours === 1 ? '1 hour ago' : `${hours} hours ago`
  if (hours < 48) return 'yesterday'
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} days ago`
  const d = new Date(then)
  return formatDate(isoDate(d.getFullYear(), d.getMonth() + 1, d.getDate()))
}
