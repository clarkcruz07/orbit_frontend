// Unit tests for the Attendance & Timesheet pure logic: week math, durations and time formatting, cell parsing and
// validation, totals, dirty tracking, tabs, error mapping, correction checks and deep links.
import test, { before } from 'node:test'
import assert from 'node:assert/strict'
import { loadTs } from './helpers/load-ts.mjs'

let L
before(async () => {
  L = await loadTs('modules/timesheet/logic.ts')
})

const DAYS = ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22']
const row = (code_id, cells = {}, extra = {}) => ({ code_id, code_name: code_id, billable: false, code_active: true, cells: Object.fromEntries(DAYS.map((d) => [d, cells[d] ?? ''])), ...extra })

// ------------------------------------------------------------------------------------------------ week math
test('mondayOf: any day of the week maps to its Monday (Monday-start), including month and year boundaries', () => {
  assert.equal(L.mondayOf('2026-11-16'), '2026-11-16') // Monday
  assert.equal(L.mondayOf('2026-11-22'), '2026-11-16') // Sunday belongs to the week that started the Monday before
  assert.equal(L.mondayOf('2026-11-18'), '2026-11-16')
  assert.equal(L.mondayOf('2026-12-01'), '2026-11-30') // Tuesday, previous month's Monday
  assert.equal(L.mondayOf('2027-01-01'), '2026-12-28') // across the year
  assert.equal(L.mondayOf('2024-03-01'), '2024-02-26') // leap year
  assert.equal(L.mondayOf('not-a-date'), 'not-a-date')
})

test('addDaysIso / daysBetween / weeksBetween use calendar arithmetic', () => {
  assert.equal(L.addDaysIso('2026-11-30', 1), '2026-12-01')
  assert.equal(L.addDaysIso('2026-03-01', -1), '2026-02-28')
  assert.equal(L.addDaysIso('2024-03-01', -1), '2024-02-29')
  assert.equal(L.addDaysIso('2026-11-16', -7), '2026-11-09')
  assert.equal(L.daysBetween('2026-11-16', '2026-11-22'), 6)
  assert.equal(L.daysBetween('2026-11-22', '2026-11-16'), -6)
  assert.equal(L.weeksBetween('2026-11-16', '2026-12-14'), 4)
  assert.ok(Number.isNaN(L.daysBetween('x', '2026-11-16')))
})

test('weekDates returns the seven ISO dates Monday to Sunday', () => {
  assert.deepEqual(L.weekDates('2026-11-16'), DAYS)
  assert.deepEqual(L.weekDates('2026-12-28'), ['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03'])
})

test('weekNavLimits: 53 weeks back and 4 weeks ahead of the current week', () => {
  const cur = '2026-11-16'
  assert.deepEqual(L.weekNavLimits(cur, cur), { canPrev: true, canNext: true, inRange: true })
  const oldest = L.addDaysIso(cur, -53 * 7)
  assert.deepEqual(L.weekNavLimits(oldest, cur), { canPrev: false, canNext: true, inRange: true })
  assert.equal(L.weekNavLimits(L.addDaysIso(oldest, -7), cur).inRange, false)
  const newest = L.addDaysIso(cur, 4 * 7)
  assert.deepEqual(L.weekNavLimits(newest, cur), { canPrev: true, canNext: false, inRange: true })
  assert.equal(L.weekNavLimits(L.addDaysIso(newest, 7), cur).inRange, false)
})

test('formatWeekRange / day labels', () => {
  assert.equal(L.formatWeekRange('2026-11-16'), '16 - 22 Nov 2026')
  assert.equal(L.formatWeekRange('2026-11-30'), '30 Nov - 6 Dec 2026')
  assert.equal(L.formatWeekRange('2026-12-28'), '28 Dec 2026 - 3 Jan 2027')
  assert.equal(L.formatDayLabel('2026-11-16'), 'Mon 16 Nov')
  assert.equal(L.formatDayLong('2026-11-22'), 'Sun 22 Nov 2026')
  assert.equal(L.weekdayShort('2026-11-19'), 'Thu')
  assert.equal(L.dayMonth('2026-11-02'), '2 Nov')
  assert.equal(L.sheetIdFor('EMP-0005', '2026-11-16'), 'EMP-0005_2026-11-16')
})

// ------------------------------------------------------------------------------------------------ durations and times
test('formatHours / formatHoursMinutes', () => {
  assert.equal(L.formatHours(7.5), '7.5')
  assert.equal(L.formatHours(8), '8')
  assert.equal(L.formatHours(0.25), '0.25')
  assert.equal(L.formatHours(0.1 + 0.2), '0.3') // floating point noise is rounded away
  assert.equal(L.formatHours(null), '0')
  assert.equal(L.formatHoursMinutes(7.5), '7h 30m')
  assert.equal(L.formatHoursMinutes(0.25), '15m')
  assert.equal(L.formatHoursMinutes(8), '8h')
  assert.equal(L.formatHoursMinutes(0), '0m')
  assert.equal(L.formatHoursMinutes(8.33), '8h 20m')
})

test('stampRows: one line per punch pair in time order; the open session is included once; out is null while open', () => {
  const done = { session_id: 'a', clock_in: '2026-11-16T01:00:00+00:00', clock_out: '2026-11-16T04:00:00+00:00' }
  const open = { session_id: 'b', clock_in: '2026-11-16T05:00:00+00:00', clock_out: null }
  assert.deepEqual(L.stampRows([open, done], open), [
    { id: 'a', clockIn: done.clock_in, clockOut: done.clock_out },
    { id: 'b', clockIn: open.clock_in, clockOut: null },
  ])
  assert.deepEqual(L.stampRows([], open), [{ id: 'b', clockIn: open.clock_in, clockOut: null }], 'open session shown even if the day record lags')
  assert.deepEqual(L.stampRows([], null), [])
})

test('dayStamp: one time in (the first of the day) and one time out (the latest); null time out while a session is open', () => {
  const a = { session_id: 'a', clock_in: '2026-11-16T01:00:00+00:00', clock_out: '2026-11-16T04:00:00+00:00' }
  const b = { session_id: 'b', clock_in: '2026-11-16T05:00:00+00:00', clock_out: '2026-11-16T08:30:00+00:00' }
  const open = { session_id: 'c', clock_in: '2026-11-16T09:00:00+00:00', clock_out: null }
  assert.deepEqual(L.dayStamp([b, a], null), { clockIn: a.clock_in, clockOut: b.clock_out })
  assert.deepEqual(L.dayStamp([a, b, open], open), { clockIn: a.clock_in, clockOut: null })
  assert.deepEqual(L.dayStamp([], open), { clockIn: open.clock_in, clockOut: null })
  assert.equal(L.dayStamp([], null), null)
})

test('formatElapsed: HH:MM:SS, hours can pass 24, never negative', () => {
  assert.equal(L.formatElapsed(0), '00:00:00')
  assert.equal(L.formatElapsed(59_999), '00:00:59')
  assert.equal(L.formatElapsed(3_661_000), '01:01:01')
  assert.equal(L.formatElapsed(26 * 3600_000 + 5000), '26:00:05')
  assert.equal(L.formatElapsed(-5000), '00:00:00')
  assert.equal(L.formatElapsed(Number.NaN), '00:00:00')
})

test('elapsedMs measures on the SERVER clock, so a wrong laptop clock changes nothing', () => {
  const clockIn = '2026-11-16T01:00:00.000+00:00'
  const serverNow = '2026-11-16T03:30:00.000+00:00' // 2.5 h after clock-in
  // The laptop thinks it is 10 hours later than the server: the offset cancels that out.
  const laptopAtFetch = Date.parse('2026-11-16T13:30:00Z')
  assert.equal(L.elapsedMs(clockIn, serverNow, laptopAtFetch, laptopAtFetch), 2.5 * 3600_000)
  assert.equal(L.elapsedMs(clockIn, serverNow, laptopAtFetch, laptopAtFetch + 90_000), 2.5 * 3600_000 + 90_000)
  assert.equal(L.elapsedMs('garbage', serverNow, 0, 0), 0)
  assert.equal(L.elapsedMs(serverNow, clockIn, 0, 0), 0) // clock-in in the "future": never negative
})

test('isOverLimit: exactly 16 hours is fine, one second more is not', () => {
  assert.equal(L.isOverLimit(16 * 3600_000), false)
  assert.equal(L.isOverLimit(16 * 3600_000 + 1), true)
  assert.equal(L.isOverLimit(0), false)
})

test('formatClockTime renders company-time HH:MM; a bad zone falls back to UTC; empty is a dash', () => {
  assert.equal(L.formatClockTime('2026-11-16T01:00:00.000+00:00', 'Asia/Manila'), '09:00')
  assert.equal(L.formatClockTime('2026-11-16T09:30:00.000+00:00', 'Asia/Manila'), '17:30')
  assert.equal(L.formatClockTime('2026-11-16T16:00:00.000+00:00', 'Asia/Manila'), '00:00') // midnight is 00:00, not 24:00
  assert.equal(L.formatClockTime('2026-11-16T01:00:00.000+00:00', 'UTC'), '01:00')
  assert.equal(L.formatClockTime('2026-11-16T01:00:00.000+00:00', 'Not/AZone'), '01:00')
  assert.equal(L.formatClockTime(null, 'UTC'), '-')
  assert.equal(L.formatClockTime('nope', 'UTC'), '-')
  assert.equal(L.formatDateTimeIn('2026-11-16T01:05:00.000+00:00', 'Asia/Manila'), '16 Nov 09:05')
})

// ------------------------------------------------------------------------------------------------ cells
test('parseHoursInput accepts quarter hours (also a comma) and empty as zero', () => {
  for (const [raw, value] of [['7.5', 7.5], ['7,5', 7.5], ['8', 8], ['.25', 0.25], ['0.75', 0.75], ['24', 24], ['0', 0], [' 4 ', 4], ['1.', 1], ['12.25', 12.25]]) {
    const p = L.parseHoursInput(raw)
    assert.deepEqual([p.ok, p.value, p.issue], [true, value, null], raw)
  }
  const empty = L.parseHoursInput('  ')
  assert.deepEqual([empty.ok, empty.value, empty.empty], [true, 0, true])
  assert.equal(L.parseHoursInput(undefined).ok, true)
})

test('parseHoursInput reports invalid, range and step problems with their own code', () => {
  for (const raw of ['abc', '7h', '1e3', '--1', '1.2.3', '7 5', 'NaN', 'Infinity', '0x10']) assert.equal(L.parseHoursInput(raw).issue, 'invalid', raw)
  for (const raw of ['-1', '-0.25', '24.25', '25', '100']) assert.equal(L.parseHoursInput(raw).issue, 'range', raw)
  for (const raw of ['7.3', '0.1', '1.33', '8.01', '2.2']) assert.equal(L.parseHoursInput(raw).issue, 'step', raw)
  assert.equal(L.parseHoursInput('7.3').ok, false)
  assert.ok(L.CELL_MESSAGE.step.includes('quarter'))
})

test('validateGrid: cell problems, a day above 24 h, and the row limit', () => {
  const rows = [row('A', { '2026-11-16': '8', '2026-11-17': '7.3' }), row('B', { '2026-11-16': '17', '2026-11-18': 'x', '2026-11-19': '30' })]
  const v = L.validateGrid(rows, DAYS)
  assert.equal(v.ok, false)
  assert.equal(v.cellIssues[L.cellKey('A', '2026-11-17')], 'step')
  assert.equal(v.cellIssues[L.cellKey('B', '2026-11-18')], 'invalid')
  assert.equal(v.cellIssues[L.cellKey('B', '2026-11-19')], 'range')
  assert.match(v.dayIssues['2026-11-16'], /25 hours/) // 8 + 17
  assert.equal(v.dayIssues['2026-11-17'], undefined)
  const many = Array.from({ length: 21 }, (_, i) => row(`C${i}`))
  const m = L.validateGrid(many, DAYS)
  assert.equal(m.tooManyRows, true)
  assert.equal(m.ok, false)
  assert.equal(L.validateGrid(Array.from({ length: 20 }, (_, i) => row(`C${i}`)), DAYS).ok, true)
})

test('validateGrid: exactly 24 hours in a day is allowed, 24.25 is not', () => {
  assert.equal(L.validateGrid([row('A', { '2026-11-16': '16' }), row('B', { '2026-11-16': '8' })], DAYS).ok, true)
  assert.equal(L.validateGrid([row('A', { '2026-11-16': '16' }), row('B', { '2026-11-16': '8.25' })], DAYS).ok, false)
  assert.equal(L.validateGrid([row('A', {})], DAYS).ok, true)
})

test('computeTotals sums rows, days and the week; cells with a problem count as zero', () => {
  const rows = [row('A', { '2026-11-16': '8', '2026-11-17': '7.5', '2026-11-18': '1.1' }), row('B', { '2026-11-16': '0.25', '2026-11-19': '4' })]
  const t = L.computeTotals(rows, DAYS)
  assert.equal(t.rowTotals.A, 15.5)
  assert.equal(t.rowTotals.B, 4.25)
  assert.equal(t.dayTotals['2026-11-16'], 8.25)
  assert.equal(t.dayTotals['2026-11-18'], 0)
  assert.equal(t.dayTotals['2026-11-22'], 0)
  assert.equal(t.total, 19.75)
  assert.deepEqual(L.computeTotals([], DAYS).total, 0)
  // 0.1-style sums must not leak floating point noise
  const noisy = L.computeTotals([row('A', { '2026-11-16': '0.25', '2026-11-17': '0.25', '2026-11-18': '0.25' })], DAYS)
  assert.equal(noisy.total, 0.75)
})

test('toPayloadRows keeps one entry per row, only cells with hours, numbers only', () => {
  const rows = [row('A', { '2026-11-16': '8', '2026-11-17': '0', '2026-11-18': '', '2026-11-19': '7,5' }), row('B')]
  assert.deepEqual(L.toPayloadRows(rows, DAYS), [
    { code_id: 'A', hours: { '2026-11-16': 8, '2026-11-19': 7.5 } },
    { code_id: 'B', hours: {} },
  ])
})

test('gridFromRows / cellText / emptyRow / gridDirty', () => {
  const sheetRows = [{ code_id: 'A', code_name: 'General', billable: false, code_active: true, hours: { '2026-11-16': 8, '2026-11-17': 7.5 }, total: 15.5 }]
  const grid = L.gridFromRows(sheetRows, DAYS)
  assert.equal(grid[0].cells['2026-11-16'], '8')
  assert.equal(grid[0].cells['2026-11-17'], '7.5')
  assert.equal(grid[0].cells['2026-11-18'], '')
  assert.equal(L.cellText(0), '')
  assert.equal(L.cellText(undefined), '')
  assert.equal(L.cellText(0.25), '0.25')
  assert.equal(L.gridDirty(grid, L.gridFromRows(sheetRows, DAYS), DAYS), false)
  // "8.00" is the same number as "8": not dirty
  const same = structuredClone(grid)
  same[0].cells['2026-11-16'] = '8.00'
  assert.equal(L.gridDirty(same, grid, DAYS), false)
  const edited = structuredClone(grid)
  edited[0].cells['2026-11-18'] = '1'
  assert.equal(L.gridDirty(edited, grid, DAYS), true)
  const typo = structuredClone(grid)
  typo[0].cells['2026-11-18'] = 'abc'
  assert.equal(L.gridDirty(typo, grid, DAYS), true)
  assert.equal(L.gridDirty([...grid, L.emptyRow({ code_id: 'B', name: 'Admin', billable: true, active: true }, DAYS)], grid, DAYS), true)
  assert.equal(L.emptyRow({ code_id: 'B', name: 'Admin', billable: true, active: true }, DAYS).cells['2026-11-20'], '')
})

// ------------------------------------------------------------------------------------------------ tabs
test('availableTabs: employees get three tabs; manager and HR get approvals; team is managers; HR tab follows the server flag', () => {
  assert.deepEqual(L.availableTabs(['Employee'], false), ['today', 'timesheet', 'corrections'])
  assert.deepEqual(L.availableTabs(['Manager'], false), ['today', 'timesheet', 'corrections', 'approvals', 'team'])
  assert.deepEqual(L.availableTabs(['HRAdmin'], true), ['today', 'timesheet', 'corrections', 'approvals', 'hr'])
  assert.deepEqual(L.availableTabs(['Finance'], false), ['today', 'timesheet', 'corrections'])
  assert.deepEqual(L.availableTabs(undefined, false), ['today', 'timesheet', 'corrections'])
  // The HR tab comes from the server's can_manage flag, not from the role.
  assert.ok(!L.availableTabs(['HRAdmin'], false).includes('hr'))
  assert.ok(L.availableTabs(['Employee'], true).includes('hr'))
})

test('parseTab: unknown values fall back to the first tab', () => {
  assert.equal(L.parseTab('timesheet'), 'timesheet')
  assert.equal(L.parseTab('corrections'), 'corrections')
  assert.equal(L.parseTab('hr'), 'hr')
  assert.equal(L.parseTab('nope'), 'today')
  assert.equal(L.parseTab(null), 'today')
  assert.equal(L.parseTab('__proto__'), 'today')
})

// ------------------------------------------------------------------------------------------------ errors
const axiosErr = (status, data) => ({ response: { status, data } })

test('toProblem maps known server codes to plain wording and never leaks raw payloads', () => {
  assert.equal(L.toProblem(axiosErr(409, { detail: 'x', code: 'already_clocked_in' }), 'fb').code, 'already_clocked_in')
  assert.match(L.toProblem(axiosErr(409, { detail: 'x', code: 'needs_correction' }), 'fb').detail, /16 hours/)
  assert.match(L.toProblem(axiosErr(422, { detail: 'x', code: 'hours_step' }), 'fb').detail, /quarter/)
  assert.match(L.toProblem(axiosErr(422, { detail: 'x', code: 'day_total_exceeded' }), 'fb').detail, /24 hours/)
  assert.equal(L.toProblem(axiosErr(404, { detail: 'Timesheet not found' }), 'fb').detail, 'Timesheet not found')
  assert.equal(L.toProblem(axiosErr(403, {}), 'fallback text').detail, 'fallback text')
  assert.equal(L.toProblem(axiosErr(422, { detail: 'Invalid request', errors: [{ loc: ['body'], msg: 'bad' }] }), 'fallback text').detail, 'fallback text')
  assert.match(L.toProblem(axiosErr(500, { detail: 'Traceback ...' }), 'fb').detail, /server had a problem/)
  assert.doesNotMatch(L.toProblem(axiosErr(500, { detail: 'Traceback ...' }), 'fb').detail, /Traceback/)
  const net = L.toProblem(new Error('Network Error'), 'fb')
  assert.equal(net.status, null)
  assert.match(net.detail, /could not be reached/)
  assert.doesNotThrow(() => L.toProblem(undefined, 'fb'))
  assert.doesNotThrow(() => L.toProblem(null, 'fb'))
})

test('every machine code in the contract has friendly wording', () => {
  for (const c of ['already_clocked_in', 'not_clocked_in', 'needs_correction', 'clock_skew', 'correction_pending', 'day_not_past', 'day_too_old', 'out_before_in', 'session_too_long', 'session_day_mismatch', 'comment_required', 'hours_step', 'hours_range', 'hours_invalid', 'day_total_exceeded', 'duplicate_code', 'day_outside_week', 'too_many_rows', 'code_invalid', 'week_out_of_range', 'week_in_future', 'empty_timesheet', 'not_editable', 'not_recallable', 'not_submitted', 'code_name_taken', 'code_in_use']) {
    assert.ok(L.CODE_TEXT[c] && L.CODE_TEXT[c].length > 10, c)
  }
})

// ------------------------------------------------------------------------------------------------ corrections
const draft = (over = {}) => ({ day: '2026-11-12', clock_in: '09:00', clock_out: '17:30', clock_out_next_day: false, reason: 'Forgot to clock out', ...over })

test('correctionHours: length of the proposed session, next-day aware', () => {
  assert.equal(L.correctionHours(draft()), 8.5)
  assert.equal(L.correctionHours(draft({ clock_in: '22:00', clock_out: '06:00', clock_out_next_day: true })), 8)
  assert.equal(L.correctionHours(draft({ clock_in: '22:00', clock_out: '06:00' })), null) // out before in
  assert.equal(L.correctionHours(draft({ clock_in: '' })), null)
  assert.equal(L.correctionHours(draft({ clock_in: '09:00', clock_out: '09:00' })), null)
})

test('checkCorrection mirrors the server rules: past day, 60 days, out after in, 16 h span, reason', () => {
  const today = '2026-11-16'
  assert.deepEqual(L.checkCorrection(draft(), today), {})
  assert.ok(L.checkCorrection(draft({ day: '' }), today).day)
  assert.match(L.checkCorrection(draft({ day: today }), today).day, /past/)
  assert.match(L.checkCorrection(draft({ day: '2026-11-20' }), today).day, /past/)
  assert.deepEqual(L.checkCorrection(draft({ day: '2026-11-15' }), today), {}) // yesterday is fine
  assert.deepEqual(L.checkCorrection(draft({ day: '2026-09-17' }), today), {}) // exactly 60 days back
  assert.match(L.checkCorrection(draft({ day: '2026-09-16' }), today).day, /60 days/)
  assert.match(L.checkCorrection(draft({ clock_in: '17:00', clock_out: '09:00' }), today).clock_out, /after the clock-in/)
  assert.match(L.checkCorrection(draft({ clock_in: '09:00', clock_out: '09:00' }), today).clock_out, /after the clock-in/)
  assert.deepEqual(L.checkCorrection(draft({ clock_in: '22:00', clock_out: '06:00', clock_out_next_day: true }), today), {})
  assert.match(L.checkCorrection(draft({ clock_in: '00:00', clock_out: '16:15' }), today).clock_out, /16 hours/)
  assert.deepEqual(L.checkCorrection(draft({ clock_in: '00:00', clock_out: '16:00' }), today), {}) // exactly 16 h is allowed
  assert.ok(L.checkCorrection(draft({ clock_in: '' }), today).clock_in)
  assert.ok(L.checkCorrection(draft({ clock_out: '' }), today).clock_out)
  assert.ok(L.checkCorrection(draft({ reason: '   ' }), today).reason)
  assert.ok(L.checkCorrection(draft({ reason: 'x'.repeat(501) }), today).reason)
  assert.deepEqual(L.checkCorrection(draft({ reason: ` ${'x'.repeat(500)} ` }), today), {})
  assert.deepEqual(L.correctionDayRange(today), { min: '2026-09-17', max: '2026-11-15' })
})

test('toMinutes only accepts HH:MM', () => {
  assert.equal(L.toMinutes('09:30'), 570)
  assert.equal(L.toMinutes('00:00'), 0)
  assert.equal(L.toMinutes('23:59'), 1439)
  for (const bad of ['24:00', '9:30', '09:60', '', 'ab:cd', '0930']) assert.equal(L.toMinutes(bad), null, bad)
})

// ------------------------------------------------------------------------------------------------ labels, flags, links
test('status labels and tones', () => {
  assert.equal(L.sheetStatusLabel('submitted'), 'Submitted')
  assert.equal(L.sheetStatusTone('approved'), 'green')
  assert.equal(L.sheetStatusTone('rejected'), 'red')
  assert.equal(L.sheetStatusTone('open'), 'neutral')
  assert.equal(L.correctionStatusLabel('cancelled'), 'Withdrawn')
  assert.equal(L.correctionStatusLabel('pending'), 'Pending review')
  assert.equal(L.correctionStatusTone('pending'), 'amber')
  assert.equal(L.attendanceStateLabel('needs_correction'), 'Needs correction')
  assert.equal(L.attendanceStateTone('in'), 'blue')
  assert.equal(L.attendanceStateLabel('none'), 'No punches')
})

test('dayFlags: flagged beats open; pending and corrected are separate chips', () => {
  const base = { open: false, needs_correction: false, correction: null, pending_correction: null }
  assert.deepEqual(L.dayFlags(base), [])
  assert.deepEqual(L.dayFlags({ ...base, open: true }).map((f) => f.key), ['open'])
  assert.deepEqual(L.dayFlags({ ...base, open: true, needs_correction: true }).map((f) => f.key), ['needs_correction'])
  assert.deepEqual(L.dayFlags({ ...base, pending_correction: {}, correction: {} }).map((f) => f.key), ['pending', 'corrected'])
})

test('parseTimesheetTarget: the notification deep link, bad input and own id', () => {
  const p = (q) => new URLSearchParams(q)
  const cur = '2026-11-16'
  assert.deepEqual(L.parseTimesheetTarget(p('tab=timesheet&week=2026-11-09&employee_id=EMP-0005'), cur, 'EMP-0002'), { week: '2026-11-09', employeeId: 'EMP-0005' })
  assert.deepEqual(L.parseTimesheetTarget(p('week=2026-11-12'), cur, 'EMP-0005'), { week: '2026-11-09', employeeId: null }) // any day maps to its Monday
  assert.deepEqual(L.parseTimesheetTarget(p('week=garbage&employee_id=EMP-0005'), cur, 'EMP-0005'), { week: cur, employeeId: null }) // own id = own sheet
  assert.deepEqual(L.parseTimesheetTarget(p('employee_id=../../x'), cur, 'EMP-0005'), { week: cur, employeeId: null })
  assert.deepEqual(L.parseTimesheetTarget(p(''), cur, null), { week: cur, employeeId: null })
  assert.equal(L.timesheetLink('2026-11-16', 'EMP-0005', 'approvals'), '?tab=timesheet&week=2026-11-16&employee_id=EMP-0005&from=approvals')
  assert.equal(L.timesheetLink('2026-11-16'), '?tab=timesheet&week=2026-11-16')
  assert.equal(L.correctionLink('abc-123'), '?tab=corrections&id=abc-123')
})

test('isIsoDate is strict', () => {
  assert.equal(L.isIsoDate('2026-11-16'), true)
  for (const bad of ['2026-02-30', '2026-13-01', '16/11/2026', '', null, undefined, '2026-11-16T10:00']) assert.equal(L.isIsoDate(bad), false, String(bad))
})
