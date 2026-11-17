// Unit tests for the Leave pure helpers (src/modules/leave/logic.ts): labels, day-count and date display, form rules,
// error mapping, timeline and calendar math.
import test, { before } from 'node:test'
import assert from 'node:assert/strict'
import { loadTs } from './helpers/load-ts.mjs'

let L
before(async () => {
  L = await loadTs('modules/leave/logic.ts')
})

const types = [
  { type_id: 'vacation', name: 'Vacation', paid: true, annual_days: 15, requires_reason: false, active: true },
  { type_id: 'personal', name: 'Personal', paid: true, annual_days: 3, requires_reason: true, active: true },
  { type_id: 'old', name: 'Old', paid: true, annual_days: 1, requires_reason: false, active: false },
  { type_id: 'unpaid', name: 'Unpaid', paid: false, annual_days: 0, requires_reason: false, active: true },
]
const ctx = { types, today: '2026-11-16' }
const form = (o = {}) => ({ typeId: 'vacation', start: '2026-11-23', end: '2026-11-25', half: 'none', reason: '', ...o })

// ------------------------------------------------------------------------------------------------ status + actions
test('status labels, tones and hints cover the five statuses; unknown statuses pass through', () => {
  assert.deepEqual(L.STATUS_ORDER.map((s) => L.statusLabel(s)), ['Pending', 'Needs clarification', 'Approved', 'Rejected', 'Cancelled'])
  assert.equal(L.statusTone('approved'), 'green')
  assert.equal(L.statusTone('rejected'), 'red')
  assert.equal(L.statusTone('clarification_requested'), 'amber')
  assert.equal(L.statusTone('pending'), 'blue')
  assert.equal(L.statusTone('cancelled'), 'neutral')
  assert.equal(L.statusLabel('weird'), 'weird')
  assert.equal(L.statusTone('weird'), 'neutral')
  assert.equal(L.statusHint('approved'), 'Approved.')
})

test('allowed_actions helpers read only the server list', () => {
  assert.ok(L.isDeciderMode(['approve', 'reject', 'clarify']))
  assert.ok(L.isDeciderMode(['reject']))
  assert.ok(!L.isDeciderMode(['cancel']))
  assert.ok(L.isEditorMode(['edit', 'resubmit', 'cancel']))
  assert.ok(!L.isEditorMode(['cancel']))
  assert.ok(!L.isEditorMode(undefined))
  assert.ok(L.hasAction(['cancel'], 'cancel'))
  assert.ok(!L.hasAction(undefined, 'cancel'))
})

// ------------------------------------------------------------------------------------------------ navigation hint
test('tabs: Approvals for Manager/HRAdmin, Leave settings for HRAdmin only, scopes follow the server matrix', () => {
  assert.deepEqual(L.availableTabs(['Employee']), ['my', 'calendar'])
  assert.deepEqual(L.availableTabs(['Finance']), ['my', 'calendar'])
  assert.deepEqual(L.availableTabs(['Manager']), ['my', 'approvals', 'calendar'])
  assert.deepEqual(L.availableTabs(['HRAdmin']), ['my', 'approvals', 'calendar', 'settings'])
  assert.deepEqual(L.availableTabs(undefined), ['my', 'calendar'])
  assert.deepEqual(L.listScopesFor(['Manager']), ['review', 'team'])
  assert.deepEqual(L.listScopesFor(['HRAdmin']), ['review', 'all'])
  assert.deepEqual(L.listScopesFor(['Employee']), [])
  assert.deepEqual(L.listScopesFor(['Manager', 'HRAdmin']), ['review', 'team', 'all'])
})

test('parseTab falls back to "my" for unknown or unavailable tabs; parseScope falls back to the first scope', () => {
  const emp = L.availableTabs(['Employee'])
  assert.equal(L.parseTab('approvals', emp), 'my')
  assert.equal(L.parseTab('settings', emp), 'my')
  assert.equal(L.parseTab('calendar', emp), 'calendar')
  assert.equal(L.parseTab('nope', emp), 'my')
  assert.equal(L.parseTab(null, emp), 'my')
  assert.equal(L.parseTab('settings', L.availableTabs(['HRAdmin'])), 'settings')
  assert.equal(L.parseScope('team', ['review', 'team']), 'team')
  assert.equal(L.parseScope('all', ['review', 'team']), 'review')
  assert.equal(L.parseScope(null, ['review', 'all']), 'review')
})

// ------------------------------------------------------------------------------------------------ numbers and dates
test('formatNumber / formatDays: halves, singular, no trailing .0', () => {
  assert.equal(L.formatNumber(3), '3')
  assert.equal(L.formatNumber(3.0), '3')
  assert.equal(L.formatNumber(0.5), '0.5')
  assert.equal(L.formatNumber(2.5), '2.5')
  assert.equal(L.formatNumber(null), '-')
  assert.equal(L.formatDays(1), '1 day')
  assert.equal(L.formatDays(0.5), '0.5 days')
  assert.equal(L.formatDays(2), '2 days')
  assert.equal(L.formatDays(0), '0 days')
  assert.equal(L.formatDays(-2), '-2 days')
})

test('formatRange compacts same-month and same-year ranges and marks half days', () => {
  assert.equal(L.formatRange('2026-11-23', '2026-11-25'), '23 to 25 Nov 2026')
  assert.equal(L.formatRange('2026-11-28', '2026-12-02'), '28 Nov to 2 Dec 2026')
  assert.equal(L.formatRange('2026-12-30', '2027-01-04'), '30 Dec 2026 to 4 Jan 2027')
  assert.equal(L.formatRange('2026-11-23', '2026-11-23'), '23 Nov 2026')
  assert.equal(L.formatRange('2026-11-23', '2026-11-23', 'am'), '23 Nov 2026 (am)')
  assert.equal(L.formatRange('2026-11-23', '2026-11-23', 'pm'), '23 Nov 2026 (pm)')
  assert.equal(L.formatRange('garbage', 'x'), 'garbage to x')
})

test('formatLongDate shows the weekday without depending on the time zone', () => {
  assert.equal(L.formatLongDate('2026-11-23'), 'Mon 23 Nov 2026')
  assert.equal(L.formatLongDate('2026-11-29'), 'Sun 29 Nov 2026')
  assert.equal(L.formatLongDate('nope'), 'nope')
})

test('dayNumber is an exact day difference (leap years, month ends)', () => {
  assert.equal(L.dayNumber('2026-03-01') - L.dayNumber('2026-02-28'), 1)
  assert.equal(L.dayNumber('2028-03-01') - L.dayNumber('2028-02-28'), 2)
  assert.equal(L.dayNumber('2027-01-01') - L.dayNumber('2026-01-01'), 365)
  assert.equal(L.dayNumber('2026-02-30'), null)
  assert.equal(L.dayNumber(''), null)
})

test('daysByYearText only appears when a request crosses a year end', () => {
  assert.equal(L.daysByYearText({ 2026: 3 }), null)
  assert.equal(L.daysByYearText({ 2027: 2, 2026: 3 }), '2026: 3 days, 2027: 2 days')
  assert.equal(L.daysByYearText(null), null)
})

test('approverLine says who it is waiting for, including the HR fallback', () => {
  assert.equal(L.approverLine({ status: 'pending', approver: { kind: 'manager', name: 'Miguel Santos', employee_id: 'E' } }), 'Waiting for Miguel Santos')
  assert.match(L.approverLine({ status: 'pending', approver: { kind: 'hr_fallback', name: null, employee_id: null } }), /^Waiting for HR/)
  assert.equal(L.approverLine({ status: 'approved', approver: { kind: 'manager', name: 'Miguel Santos', employee_id: 'E' } }), 'Miguel Santos')
  assert.equal(L.approverLine({ status: 'pending', approver: null }), '-')
})

// ------------------------------------------------------------------------------------------------ balances
test('balanceView stacks used then pending and never exceeds 100%', () => {
  assert.deepEqual(L.balanceView({ entitlement: 10, used: 3, pending: 2, unlimited: false }), { usedPct: 30, pendingPct: 20, over: false })
  const over = L.balanceView({ entitlement: 10, used: 8, pending: 5, unlimited: false })
  assert.equal(over.usedPct + over.pendingPct, 100)
  assert.equal(over.over, true)
  assert.deepEqual(L.balanceView({ entitlement: 0, used: 0, pending: 0, unlimited: true }), { usedPct: 0, pendingPct: 0, over: false })
  assert.equal(L.remainingText({ remaining: null, unlimited: true }), 'No limit')
  assert.equal(L.remainingText({ remaining: 7.5, unlimited: false }), '7.5 days')
  assert.equal(L.remainingText({ remaining: 1, unlimited: false }), '1 day')
})

test('balanceSentence and previewBalanceText speak plainly, unpaid has no limit', () => {
  const b = { type_id: 'vacation', name: 'Vacation', paid: true, active: true, entitlement: 15, override: false, used: 3, pending: 2, remaining: 10, unlimited: false }
  assert.equal(L.balanceSentence(b, 2026), 'Vacation 2026: 10 days left of 15, 3 used, 2 pending.')
  assert.match(L.balanceSentence({ ...b, name: 'Unpaid', unlimited: true, remaining: null }, 2026), /no balance limit/)
  assert.equal(L.balanceSentence(undefined, 2026), null)
  assert.match(L.previewBalanceText({ year: 2026, entitlement: 15, used: 3, pending: 2, requested: 2, remaining_after: 8 }, true), /^2026: 8 days left after this request/)
  assert.match(L.previewBalanceText({ year: 2026, entitlement: 0, used: 0, pending: 0, requested: 2, remaining_after: null }, false), /no balance limit/)
})

// ------------------------------------------------------------------------------------------------ form
test('validateForm: a good form has no errors', () => {
  assert.deepEqual(L.validateForm(form(), ctx), {})
})

test('validateForm: required fields, end before start, half day only for one day', () => {
  assert.equal(L.validateForm(form({ typeId: '' }), ctx).type, 'Choose a leave type.')
  assert.equal(L.validateForm(form({ start: '' }), ctx).start, 'Choose a start date.')
  assert.equal(L.validateForm(form({ end: '' }), ctx).end, 'Choose an end date.')
  assert.equal(L.validateForm(form({ start: '2026-11-25', end: '2026-11-23' }), ctx).end, 'The end date cannot be before the start date.')
  assert.equal(L.validateForm(form({ half: 'am' }), ctx).half, 'A half day can only be taken on a single day.')
  assert.deepEqual(L.validateForm(form({ start: '2026-11-23', end: '2026-11-23', half: 'am' }), ctx), {})
  assert.equal(L.validateForm(form({ typeId: 'old' }), ctx).type, 'This leave type is no longer available.')
  assert.equal(L.validateForm(form({ typeId: 'ghost' }), ctx).type, 'Choose a leave type from the list.')
})

test('validateForm: reason required by type, max 500, window of 365 days, span of 366 days', () => {
  assert.equal(L.validateForm(form({ typeId: 'personal' }), ctx).reason, 'This leave type needs a reason.')
  assert.equal(L.validateForm(form({ typeId: 'personal', reason: '   ' }), ctx).reason, 'This leave type needs a reason.')
  assert.deepEqual(L.validateForm(form({ typeId: 'personal', reason: 'Family event' }), ctx), {})
  assert.match(L.validateForm(form({ reason: 'x'.repeat(501) }), ctx).reason, /at most 500/)
  assert.deepEqual(L.validateForm(form({ reason: 'x'.repeat(500) }), ctx), {})
  assert.match(L.validateForm(form({ start: '2028-01-03', end: '2028-01-04' }), ctx).start, /within 365 days/)
  assert.match(L.validateForm(form({ start: '2025-01-01', end: '2025-01-02' }), ctx).start, /within 365 days/)
  assert.deepEqual(L.validateForm(form({ start: '2027-11-16', end: '2027-11-16' }), ctx), {}, 'exactly 365 days ahead is allowed')
  assert.match(L.validateForm(form({ start: '2026-11-17', end: '2027-11-20' }), ctx).end, /at most 366 days/)
  assert.deepEqual(L.validateForm(form({ start: '2026-11-17', end: '2027-11-17' }), ctx), {}, '366 days inclusive is allowed')
})

test('applyFormChange keeps end >= start and clears the half day when the dates stop being one day', () => {
  let f = { typeId: 'vacation', start: '', end: '', half: 'none', reason: '' }
  f = L.applyFormChange(f, { start: '2026-11-23' })
  assert.equal(f.end, '2026-11-23', 'end follows the first start date')
  f = L.applyFormChange(f, { half: 'pm' })
  assert.equal(f.half, 'pm')
  f = L.applyFormChange(f, { end: '2026-11-24' })
  assert.equal(f.half, 'none', 'a range cannot be a half day')
  f = L.applyFormChange(f, { start: '2026-12-01' })
  assert.equal(f.end, '2026-12-01', 'a start after the end pulls the end along')
  f = L.applyFormChange({ ...f, end: '2026-12-10' }, { start: '2026-12-03' })
  assert.equal(f.end, '2026-12-10', 'an earlier or equal start leaves a later end alone')
  assert.ok(L.halfDayAllowed({ start: '2026-12-03', end: '2026-12-03' }))
  assert.ok(!L.halfDayAllowed({ start: '', end: '' }))
})

test('previewQuery is null until type and dates are valid, ignores the reason, and never includes it', () => {
  assert.equal(L.previewQuery(form({ typeId: '' }), ctx), null)
  assert.equal(L.previewQuery(form({ end: '' }), ctx), null)
  assert.equal(L.previewQuery(form({ typeId: 'personal' }), ctx).type_id, 'personal', 'a missing reason does not block the preview')
  assert.deepEqual(L.previewQuery(form(), ctx), { type_id: 'vacation', start_date: '2026-11-23', end_date: '2026-11-25', half_day: 'none' })
})

test('toCreateBody trims the reason and sends null when empty; buildPatch sends only changes plus the version', () => {
  assert.deepEqual(L.toCreateBody(form({ reason: '  Trip  ' })), { type_id: 'vacation', start_date: '2026-11-23', end_date: '2026-11-25', half_day: 'none', reason: 'Trip' })
  assert.equal(L.toCreateBody(form({ reason: '   ' })).reason, null)
  const saved = { type_id: 'vacation', start_date: '2026-11-23', end_date: '2026-11-25', half_day: 'none', reason: 'Trip', version: 4 }
  assert.deepEqual(L.buildPatch(L.formFromRequest(saved), saved), { version: 4 })
  assert.equal(L.patchHasChanges({ version: 4 }), false)
  const p = L.buildPatch({ ...L.formFromRequest(saved), end: '2026-11-26', reason: '' }, saved)
  assert.deepEqual(p, { version: 4, end_date: '2026-11-26', reason: null })
  assert.ok(L.patchHasChanges(p))
  assert.deepEqual(L.formFromRequest({ ...saved, reason: null }).reason, '')
})

test('preview display: headline, weekend/holiday/year-split notes', () => {
  const p = { days: 2, days_by_year: { 2026: 2 }, weekend_days: 2, holidays: [{ date: '2026-11-30', title: 'Bonifacio Day' }] }
  assert.equal(L.previewHeadline(p), '2 days of leave')
  assert.equal(L.previewHeadline({ ...p, days: 0 }), 'No working days')
  assert.equal(L.previewHeadline({ ...p, days: 0.5 }), '0.5 days of leave')
  const notes = L.previewNotes(p)
  assert.equal(notes[0], '2 weekend days are not counted.')
  assert.match(notes[1], /Mon 30 Nov 2026 is a company holiday \(Bonifacio Day\)/)
  assert.equal(L.previewNotes({ days: 1, days_by_year: { 2026: 1 }, weekend_days: 1, holidays: [] })[0], '1 weekend day is not counted.')
  assert.match(L.previewNotes({ days: 5, days_by_year: { 2026: 3, 2027: 2 }, weekend_days: 0, holidays: [] })[0], /per calendar year: 2026: 3 days, 2027: 2 days/)
})

// ------------------------------------------------------------------------------------------------ error mapping
const httpError = (status, data) => ({ response: { status, data } })

test('parseLeaveError: status, code, extras and 422 field errors; never echoes long or non-string details', () => {
  const e = L.parseLeaveError(httpError(422, { detail: 'Not enough leave balance: 1 day(s) remaining for 2026', code: 'insufficient_balance', year: 2026, remaining: 1, requested: 3 }))
  assert.equal(e.status, 422)
  assert.equal(e.code, 'insufficient_balance')
  assert.equal(e.remaining, 1)
  assert.equal(e.requested, 3)
  assert.equal(e.year, 2026)
  const o = L.parseLeaveError(httpError(409, { detail: 'overlap', code: 'overlap', conflicting_request_id: 'abc' }))
  assert.equal(o.conflictingId, 'abc')
  const v = L.parseLeaveError(httpError(422, { detail: 'Invalid request', errors: [{ loc: ['body', 'start_date'], msg: 'String should match pattern' }, { loc: ['body', 'reason'], msg: 'too long' }] }))
  assert.equal(v.fieldErrors.start, 'String should match pattern')
  assert.equal(v.fieldErrors.reason, 'too long')
  assert.equal(L.parseLeaveError(httpError(500, { detail: 'boom: traceback ...' })).detail, 'The service had a problem. Please try again in a moment.')
  assert.match(L.parseLeaveError(null).detail, /Can't reach/)
  assert.equal(L.parseLeaveError(httpError(404, { detail: 'x'.repeat(400) }), 'fallback text').detail, 'fallback text')
  assert.equal(L.parseLeaveError(httpError(403, { detail: 123 }), 'fb').detail, 'fb')
})

test('friendlyError: insufficient balance names the days left and needed; overlap, no working days, ranges', () => {
  const f = (data, status = 422) => L.friendlyError(L.parseLeaveError(httpError(status, data)))
  assert.equal(f({ detail: 'd', code: 'insufficient_balance', year: 2026, remaining: 2, requested: 5 }), 'Not enough leave balance: you have 2 days left for 2026 and this request needs 5 days.')
  assert.equal(f({ detail: 'd', code: 'insufficient_balance', year: 2026, remaining: 1, requested: 0.5 }), 'Not enough leave balance: you have 1 day left for 2026 and this request needs 0.5 days.')
  assert.equal(f({ detail: 'd', code: 'insufficient_balance', year: 2026, remaining: -2, requested: 1 }), 'Not enough leave balance: you have no days left for 2026 and this request needs 1 day.')
  assert.equal(f({ detail: 'Server wording', code: 'insufficient_balance' }), 'Server wording')
  assert.match(f({ detail: 'x', code: 'overlap' }, 409), /already have a pending or approved leave request that overlaps/)
  assert.match(f({ detail: 'x', code: 'no_working_days' }), /no working days/)
  assert.match(f({ detail: 'x', code: 'invalid_range' }), /end date cannot be before/)
  assert.match(f({ detail: 'x', code: 'half_day_range' }), /single day/)
  assert.match(f({ detail: 'x', code: 'span_too_long' }), /at most 366 days/)
  assert.match(f({ detail: 'x', code: 'date_window' }), /within 365 days/)
  assert.match(f({ detail: 'x', code: 'inactive_type' }), /no longer available/)
  assert.match(f({ detail: 'x', code: 'reason_required' }), /needs a reason/)
  assert.match(f({ detail: 'x', code: 'comment_required' }), /comment is required/)
  assert.equal(f({ detail: 'Leave request not found' }, 404), 'Leave request not found')
  assert.equal(f({ detail: 'Request changed', code: 'something_new' }, 409), 'Request changed')
})

test('fieldForCode points rule failures at the field they belong to', () => {
  assert.equal(L.fieldForCode('reason_required'), 'reason')
  assert.equal(L.fieldForCode('inactive_type'), 'type')
  assert.equal(L.fieldForCode('half_day_range'), 'half')
  assert.equal(L.fieldForCode('date_window'), 'start')
  assert.equal(L.fieldForCode('invalid_range'), 'end')
  assert.equal(L.fieldForCode('overlap'), null)
  assert.equal(L.fieldForCode('insufficient_balance'), null)
  assert.equal(L.fieldForCode(null), null)
})

// ------------------------------------------------------------------------------------------------ timeline
const req = (o = {}) => ({
  request_id: 'r', employee: { name: 'Jamie' }, created_at: '2026-11-10T08:00:00.000Z', submitted_at: '2026-11-10T08:00:00.000Z',
  cancelled_at: null, decisions: [], ...o,
})

test('buildTimeline: submitted first, then decisions oldest first, then cancellation', () => {
  const t = L.buildTimeline(req({
    decisions: [{ decision_id: 'd1', action: 'approve', by_name: 'Miguel', by_role: 'Manager', comment: 'Enjoy', at: '2026-11-11T08:00:00.000Z' }],
    cancelled_at: '2026-11-12T08:00:00.000Z',
  }))
  assert.deepEqual(t.map((e) => e.kind), ['submitted', 'approve', 'cancelled'])
  assert.equal(t[1].by, 'Miguel (Manager)')
  assert.equal(t[1].comment, 'Enjoy')
  assert.equal(t[1].title, 'Approved')
})

test('buildTimeline: a clarification round trip shows "Resubmitted" after the question', () => {
  const t = L.buildTimeline(req({
    submitted_at: '2026-11-13T09:00:00.000Z',
    decisions: [
      { decision_id: 'd1', action: 'clarify', by_name: 'Miguel', by_role: 'Manager', comment: 'Which dates?', at: '2026-11-11T08:00:00.000Z' },
      { decision_id: 'd2', action: 'approve', by_name: 'Miguel', by_role: 'Manager', comment: null, at: '2026-11-14T08:00:00.000Z' },
    ],
  }))
  assert.deepEqual(t.map((e) => e.kind), ['submitted', 'clarify', 'resubmitted', 'approve'])
  assert.equal(t[1].title, 'Clarification requested')
  // while waiting for the owner there is no resubmission yet
  const waiting = L.buildTimeline(req({ decisions: [{ decision_id: 'd1', action: 'clarify', by_name: 'M', by_role: 'Manager', comment: 'q', at: '2026-11-11T08:00:00.000Z' }] }))
  assert.deepEqual(waiting.map((e) => e.kind), ['submitted', 'clarify'])
})

test('lastClarification returns the newest clarify comment', () => {
  assert.equal(L.lastClarification(req()), null)
  const r = req({ decisions: [
    { decision_id: 'a', action: 'clarify', by_name: 'M', by_role: 'Manager', comment: 'first', at: '2026-11-11T08:00:00.000Z' },
    { decision_id: 'b', action: 'clarify', by_name: 'M', by_role: 'Manager', comment: 'second', at: '2026-11-12T08:00:00.000Z' },
  ] })
  assert.equal(L.lastClarification(r).comment, 'second')
})

// ------------------------------------------------------------------------------------------------ team calendar
const item = (o) => ({ employee_id: 'E1', employee_name: 'Jamie Dela Cruz', department: 'Ops', type_id: 'vacation', type_name: 'Vacation', start_date: '2026-11-23', end_date: '2026-11-25', half_day: 'none', days: 3, own: false, ...o })

test('leaveByDate maps entries onto the days of the month, clipping entries that start before or end after it', () => {
  const m = L.leaveByDate([item({}), item({ employee_id: 'E2', employee_name: 'Ana', start_date: '2026-10-29', end_date: '2026-11-02', type_id: 'sick', type_name: 'Sick' })], '2026-11')
  assert.deepEqual([...m.keys()].filter((k) => m.get(k).length === 1).slice(0, 3), ['2026-11-01', '2026-11-02', '2026-11-23'])
  assert.equal(m.has('2026-10-31'), false, 'days outside the month are not in the map')
  assert.deepEqual(m.get('2026-11-24').map((i) => i.employee_name), ['Jamie Dela Cruz'])
  const both = L.leaveByDate([item({}), item({ employee_id: 'E3', employee_name: 'Aaron' })], '2026-11')
  assert.deepEqual(both.get('2026-11-23').map((i) => i.employee_name), ['Aaron', 'Jamie Dela Cruz'], 'sorted by name')
  assert.equal(both.has('2026-11-26'), false)
  assert.equal(L.leaveByDate([], 'nope').size, 0)
})

test('agendaEntries lists what touches the month, soonest first, clipped to the month', () => {
  const a = L.agendaEntries([item({}), item({ employee_name: 'Ana', start_date: '2026-10-29', end_date: '2026-11-02' }), item({ employee_name: 'Out', start_date: '2026-12-01', end_date: '2026-12-02' })], '2026-11')
  assert.deepEqual(a.map((e) => [e.item.employee_name, e.from, e.to]), [['Ana', '2026-11-01', '2026-11-02'], ['Jamie Dela Cruz', '2026-11-23', '2026-11-25']])
})

test('typeTone is stable: defaults map to themselves, custom ids hash into the extra palette', () => {
  assert.equal(L.typeTone('vacation'), 'vacation')
  assert.equal(L.typeTone('unpaid'), 'unpaid')
  const t = L.typeTone('3f2c9e1a-uuid')
  assert.ok(['c1', 'c2', 'c3'].includes(t))
  assert.equal(L.typeTone('3f2c9e1a-uuid'), t)
})

test('chipLabel says "You" for the viewer and marks half days', () => {
  assert.equal(L.chipLabel(item({})), 'Jamie Dela Cruz - Vacation')
  assert.equal(L.chipLabel(item({ own: true, half_day: 'am' })), 'You - Vacation (am)')
})

test('monthOfDate reads the server date, not the browser clock', () => {
  assert.equal(L.monthOfDate('2026-11-16'), '2026-11')
  assert.equal(L.monthOfDate('bad'), null)
})

// ------------------------------------------------------------------------------------------------ pagination
test('pagination helpers', () => {
  assert.equal(L.pageCount(0, 10), 1)
  assert.equal(L.pageCount(10, 10), 1)
  assert.equal(L.pageCount(11, 10), 2)
  assert.equal(L.rangeText(0, 1, 10), 'No requests')
  assert.equal(L.rangeText(23, 3, 10), '21-23 of 23')
  assert.equal(L.rangeText(5, 1, 10), '1-5 of 5')
  assert.equal(L.parsePage('3'), 3)
  assert.equal(L.parsePage('0'), 1)
  assert.equal(L.parsePage('-2'), 1)
  assert.equal(L.parsePage('abc'), 1)
  assert.equal(L.parsePage('1.5'), 1)
  assert.equal(L.parsePage(null), 1)
})

// ------------------------------------------------------------------------------------------------ HR catalog
test('parseDays accepts 0..366 in half steps only', () => {
  assert.equal(L.parseDays('15'), 15)
  assert.equal(L.parseDays(' 7.5 '), 7.5)
  assert.equal(L.parseDays('0'), 0)
  assert.equal(L.parseDays('366'), 366)
  for (const bad of ['', 'abc', '-1', '367', '1.3', '1.25', '1,5', '1e2', '1000']) assert.equal(L.parseDays(bad), null, bad)
})

test('validateTypeForm: name required, max 60, unique case-insensitively (editing excludes itself), days valid', () => {
  assert.deepEqual(L.validateTypeForm({ name: 'Study leave', paid: true, days: '5', requiresReason: false }, types, null), {})
  assert.equal(L.validateTypeForm({ name: '  ', paid: true, days: '5', requiresReason: false }, types, null).name, 'A name is required.')
  assert.match(L.validateTypeForm({ name: 'x'.repeat(61), paid: true, days: '5', requiresReason: false }, types, null).name, /at most 60/)
  assert.match(L.validateTypeForm({ name: 'VACATION', paid: true, days: '5', requiresReason: false }, types, null).name, /already exists/)
  assert.deepEqual(L.validateTypeForm({ name: 'vacation', paid: true, days: '5', requiresReason: false }, types, 'vacation'), {})
  assert.match(L.validateTypeForm({ name: 'A', paid: true, days: '1.2', requiresReason: false }, types, null).days, /steps of 0.5/)
})

test('validateOverride: employee, type, a 4-digit year in range, valid days', () => {
  assert.deepEqual(L.validateOverride({ employeeId: 'EMP-0005', typeId: 'vacation', year: '2026', days: '20' }), {})
  const e = L.validateOverride({ employeeId: '', typeId: '', year: '1999', days: 'x' })
  assert.deepEqual(Object.keys(e).sort(), ['days', 'employee', 'type', 'year'])
  assert.ok(L.validateOverride({ employeeId: 'E', typeId: 'v', year: '2101', days: '1' }).year)
  assert.ok(L.validateOverride({ employeeId: 'E', typeId: 'v', year: '26', days: '1' }).year)
})

test('typeSummary and the default catalog ids', () => {
  assert.equal(L.typeSummary({ paid: true, annual_days: 15, requires_reason: false }), '15 days a year')
  assert.equal(L.typeSummary({ paid: true, annual_days: 3, requires_reason: true }), '3 days a year, reason required')
  assert.equal(L.typeSummary({ paid: false, annual_days: 0, requires_reason: false }), 'Unpaid, no balance limit')
  assert.deepEqual([...L.DEFAULT_TYPE_IDS], ['vacation', 'sick', 'personal', 'unpaid'])
})

