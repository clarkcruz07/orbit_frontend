/**
 * Payday cutoff, as the server reports it (GET /pay-calendar, `pay_calendar` on the reimbursement and timesheet config, and `payday` on a
 * submitted request or correction). The server is the authority: nothing here works out which Friday is a payday or where the cutoff falls.
 * This file only reads the values safely and words them for people.
 */
export interface PayCycle {
  payday: string
  cutoff: string
}
export interface PayCalendar {
  today: string | null
  timezone: string | null
  cutoffDays: number | null
  current: (PayCycle & { daysToCutoff: number | null; deferredNow: boolean }) | null
  next: PayCycle | null
}
export interface Payday {
  date: string
  cutoff: string | null
  deferred: boolean
  submittedOn: string | null
}

const ISO = /^\d{4}-\d{2}-\d{2}$/
const iso = (v: unknown): string | null => (typeof v === 'string' && ISO.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) ? v : null)
const rec = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null)
const int = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) ? v : null)

function cycle(v: unknown): PayCycle | null {
  const r = rec(v)
  const payday = iso(r?.payday)
  const cutoff = iso(r?.cutoff)
  return payday && cutoff ? { payday, cutoff } : null
}

/** Tolerant reader: anything missing or malformed gives null (the UI then simply shows nothing). */
export function normalisePayCalendar(raw: unknown): PayCalendar | null {
  const r = rec(raw)
  if (!r) return null
  const cur = cycle(r.current)
  const curRec = rec(r.current)
  const current = cur ? { ...cur, daysToCutoff: int(curRec?.days_to_cutoff), deferredNow: curRec?.deferred_now === true } : null
  const next = cycle(r.next)
  if (!current && !next) return null
  return {
    today: iso(r.today),
    timezone: typeof r.timezone === 'string' && r.timezone ? r.timezone : null,
    cutoffDays: int(r.cutoff_days),
    current,
    next,
  }
}

/** The payday a submitted request or correction belongs to. Null for drafts and older rows. */
export function normalisePayday(raw: unknown): Payday | null {
  const r = rec(raw)
  const date = iso(r?.date)
  if (!r || !date) return null
  return { date, cutoff: iso(r.cutoff), deferred: r.deferred === true, submittedOn: iso(r.submitted_on) }
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "2026-11-27" -> "Fri, 27 Nov". Pure calendar arithmetic in UTC: the time zone of the viewer never moves the date. */
export function formatPayday(isoDate: string | null | undefined): string {
  const v = iso(isoDate)
  if (!v) return ''
  const d = new Date(`${v}T00:00:00Z`)
  return `${WEEKDAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`
}

export const DEFERRED_MARKER = 'Next payday (submitted after the cutoff)'

/** "Payday: Fri, 27 Nov" */
export function paydayLabel(p: Pick<Payday, 'date'> | null): string {
  return p ? `Payday: ${formatPayday(p.date)}` : ''
}

/** Short countdown for the cutoff of the payday a submission made today lands on. Null when there is nothing useful to say. */
export function countdown(cal: PayCalendar | null): string | null {
  const c = cal?.current
  if (!c || c.deferredNow || c.daysToCutoff === null || c.daysToCutoff < 0) return null
  const day = formatPayday(c.payday)
  if (c.daysToCutoff === 0) return `Today is the last day to make the ${day} payday.`
  return `${c.daysToCutoff} ${c.daysToCutoff === 1 ? 'day' : 'days'} left to make the ${day} payday.`
}

export interface CutoffNotice {
  variant: 'normal' | 'deferred'
  text: string
  countdown: string | null
}

/**
 * The notice shown before submitting. `noun` is "request" or "correction".
 * normal:   Submit by Sun, 22 Nov to be handled on the Fri, 27 Nov payday. Later requests go to the Fri, 11 Dec payday.
 * deferred: The cutoff for the nearest payday has passed. A request submitted today goes to the Fri, 11 Dec payday.
 * (When the cutoff has passed the server's `current` is already the later payday; the one that was missed is not part of the contract.)
 */
export function cutoffNotice(cal: PayCalendar | null, noun: 'request' | 'correction' = 'request'): CutoffNotice | null {
  const c = cal?.current
  if (!c) return null
  const payday = formatPayday(c.payday)
  if (c.deferredNow) {
    return {
      variant: 'deferred',
      text: `The cutoff for the nearest payday has passed. A ${noun} submitted today goes to the ${payday} payday.`,
      countdown: null,
    }
  }
  const later = cal?.next ? ` Later ${noun}s go to the ${formatPayday(cal.next.payday)} payday.` : ''
  return {
    variant: 'normal',
    text: `Submit by ${formatPayday(c.cutoff)} to be handled on the ${payday} payday.${later}`,
    countdown: countdown(cal),
  }
}

/** The sentence used on a detail page or after submitting: which payday it landed on. */
export function landedSentence(p: Payday | null, noun: 'request' | 'correction' = 'request'): string | null {
  if (!p) return null
  const day = formatPayday(p.date)
  return p.deferred
    ? `Submitted after the cutoff, so this ${noun} goes to the next payday: ${day}.`
    : `This ${noun} will be handled on the ${day} payday.`
}
