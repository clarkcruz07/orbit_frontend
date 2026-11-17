// Pay calendar fixtures for the browser mocks (paydays: the Friday on or before the 15th and before month-end; cutoff 5 days earlier).
// The mocks only ECHO what the server would send; the front end never works out a payday itself.

/** "Today" is Mon 16 Nov 2026: a submission now is handled on Fri 27 Nov (cutoff Sun 22 Nov), the next one is Fri 11 Dec. */
export const PAY_NORMAL = {
  today: '2026-11-16',
  timezone: 'Asia/Manila',
  cutoff_days: 5,
  current: { payday: '2026-11-27', cutoff: '2026-11-22', days_to_cutoff: 6, deferred_now: false },
  next: { payday: '2026-12-11', cutoff: '2026-12-06' },
}

/** Last day: Sun 22 Nov, the cutoff day itself. */
export const PAY_LAST_DAY = {
  ...PAY_NORMAL,
  today: '2026-11-22',
  current: { payday: '2026-11-27', cutoff: '2026-11-22', days_to_cutoff: 0, deferred_now: false },
}

/** Past the cutoff: Mon 23 Nov. A submission now goes to Fri 11 Dec (cutoff Sun 6 Dec); the one after is Fri 25 Dec. */
export const PAY_DEFERRED = {
  today: '2026-11-23',
  timezone: 'Asia/Manila',
  cutoff_days: 5,
  current: { payday: '2026-12-11', cutoff: '2026-12-06', days_to_cutoff: 13, deferred_now: true },
  next: { payday: '2026-12-25', cutoff: '2026-12-20' },
}

/** What the server stores on a request or correction when it is submitted. */
export function paydayFor(cal, submittedOn) {
  return { date: cal.current.payday, cutoff: cal.current.cutoff, deferred: cal.current.deferred_now, submitted_on: submittedOn ?? cal.today }
}
