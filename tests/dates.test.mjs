import test from 'node:test'
import assert from 'node:assert/strict'
import { loadTs } from './helpers/load-ts.mjs'

const d = await loadTs('lib/dates.ts')

test('leap years follow the Gregorian rule', () => {
  for (const y of [2000, 2024, 2028, 2400]) assert.equal(d.isLeapYear(y), true, String(y))
  for (const y of [1900, 2100, 2023, 2026, 2200]) assert.equal(d.isLeapYear(y), false, String(y))
})

test('daysInMonth incl. February in leap and common years', () => {
  assert.equal(d.daysInMonth(2024, 2), 29)
  assert.equal(d.daysInMonth(2026, 2), 28)
  assert.equal(d.daysInMonth(2026, 4), 30)
  assert.equal(d.daysInMonth(2026, 12), 31)
  assert.equal(d.daysInMonth(1900, 2), 28)
})

test('month keys: parse, build, shift across year boundaries', () => {
  assert.deepEqual(d.parseMonthKey('2026-11'), { year: 2026, month: 11 })
  for (const bad of ['2026-13', '2026-00', '26-01', '2026-1', '', null, undefined, '2026-11-01']) assert.equal(d.parseMonthKey(bad), null, String(bad))
  assert.equal(d.monthKey(2026, 3), '2026-03')
  assert.equal(d.shiftMonth('2026-12', 1), '2027-01')
  assert.equal(d.shiftMonth('2026-01', -1), '2025-12')
  assert.equal(d.shiftMonth('2026-11', 14), '2028-01')
  assert.equal(d.shiftMonth('2026-11', -24), '2024-11')
  assert.equal(d.shiftMonth('nope', 1), 'nope')
  assert.equal(d.monthLabel('2026-11'), 'November 2026')
})

test('parseIsoDate accepts real dates only (leap day included)', () => {
  assert.deepEqual(d.parseIsoDate('2028-02-29'), { year: 2028, month: 2, day: 29 })
  assert.equal(d.parseIsoDate('2026-02-29'), null)
  assert.equal(d.parseIsoDate('2026-04-31'), null)
  assert.equal(d.parseIsoDate('2026-13-01'), null)
  assert.equal(d.parseIsoDate('garbage'), null)
  assert.deepEqual(d.parseIsoDate('2026-11-16T10:00:00Z'), { year: 2026, month: 11, day: 16 })
})

test('weekdayOf is independent of the local time zone (0 = Sunday)', () => {
  assert.equal(d.weekdayOf(2026, 11, 16), 1) // Monday
  assert.equal(d.weekdayOf(2024, 2, 29), 4) // Thursday
  assert.equal(d.weekdayOf(2000, 1, 1), 6) // Saturday
})

test('formatting helpers', () => {
  assert.equal(d.formatDate('2021-03-01'), '1 Mar 2021')
  assert.equal(d.formatDate(null), '-')
  assert.equal(d.formatDate('not a date'), 'not a date')
  assert.equal(d.formatDayMonth('2026-11-16'), '16 Nov')
  assert.equal(d.formatWeekdayDayMonth('2026-11-16'), 'Mon, 16 Nov')
  assert.equal(d.todayIso(new Date(2026, 0, 5, 23, 59)), '2026-01-05')
  assert.equal(d.currentMonthKey(new Date(2026, 11, 31)), '2026-12')
})

test('relativeTime buckets, with an injected clock', () => {
  const now = new Date('2026-11-16T12:00:00Z')
  const ago = (ms) => new Date(now.getTime() - ms).toISOString()
  assert.equal(d.relativeTime(ago(5_000), now), 'just now')
  assert.equal(d.relativeTime(ago(44_000), now), 'just now')
  assert.equal(d.relativeTime(ago(50_000), now), '1 minute ago')
  assert.equal(d.relativeTime(ago(5 * 60_000), now), '5 minutes ago')
  assert.equal(d.relativeTime(ago(59 * 60_000), now), '59 minutes ago')
  assert.equal(d.relativeTime(ago(60 * 60_000), now), '1 hour ago')
  assert.equal(d.relativeTime(ago(5 * 3_600_000), now), '5 hours ago')
  assert.equal(d.relativeTime(ago(23 * 3_600_000), now), '23 hours ago')
  assert.equal(d.relativeTime(ago(30 * 3_600_000), now), 'yesterday')
  assert.equal(d.relativeTime(ago(3 * 86_400_000), now), '3 days ago')
  assert.match(d.relativeTime(ago(30 * 86_400_000), now), /^\d{1,2} [A-Z][a-z]{2} 2026$/)
})

test('relativeTime is safe for the future (clock skew) and bad input', () => {
  const now = new Date('2026-11-16T12:00:00Z')
  assert.equal(d.relativeTime('2026-11-16T12:05:00Z', now), 'just now')
  assert.equal(d.relativeTime('', now), '')
  assert.equal(d.relativeTime(null, now), '')
  assert.equal(d.relativeTime('garbage', now), '')
})
