import test, { before } from 'node:test'
import assert from 'node:assert/strict'
import { loadTs } from './helpers/load-ts.mjs'

let m
before(async () => {
  m = await loadTs('modules/performance/logic.ts')
})

test('goal and check-in labels and tones, with a safe fallback for unknown values', () => {
  assert.equal(m.goalStatusLabel('in_progress'), 'In progress')
  assert.equal(m.goalStatusLabel('not_started'), 'Not started')
  assert.equal(m.goalStatusLabel('weird_value'), 'weird value')
  assert.equal(m.goalStatusTone('done'), 'green')
  assert.equal(m.goalStatusTone('nope'), 'neutral')
  assert.equal(m.checkinStatusLabel('acknowledged'), 'Acknowledged')
  assert.equal(m.checkinStatusTone('requested'), 'amber')
  assert.match(m.checkinStatusHint({ status: 'requested' }), /asked for this check-in/)
  assert.match(m.checkinStatusHint({ status: 'submitted', reviewer: { kind: 'manager', name: 'Miguel Santos' } }), /Waiting for Miguel Santos/)
  assert.match(m.checkinStatusHint({ status: 'submitted', reviewer: { kind: 'hr', name: null } }), /HR/)
  assert.equal(m.reviewerLabel(null), 'a reviewer')
})

test('mood label: 1..5 with a word, null is "Not given"', () => {
  assert.equal(m.moodLabel(4), '4 of 5 (Good)')
  assert.equal(m.moodLabel(null), 'Not given')
  assert.equal(m.moodLabel(undefined), 'Not given')
})

test('goal state machine choices mirror the documented transitions', () => {
  assert.deepEqual(m.goalStatusChoices({ status: 'not_started', progress: 0 }), ['not_started', 'in_progress', 'done', 'dropped'])
  // in_progress -> not_started only while progress is 0
  assert.deepEqual(m.goalStatusChoices({ status: 'in_progress', progress: 40 }), ['in_progress', 'done', 'dropped'])
  assert.ok(m.goalStatusChoices({ status: 'in_progress', progress: 0 }).includes('not_started'))
  assert.deepEqual(m.goalStatusChoices({ status: 'done', progress: 100 }), ['done', 'in_progress', 'dropped'])
  assert.deepEqual(m.goalStatusChoices({ status: 'dropped', progress: 30 }), ['dropped', 'not_started', 'in_progress'])
  // forbidden moves are never offered
  assert.ok(!m.goalStatusChoices({ status: 'dropped', progress: 30 }).includes('done'))
  assert.ok(!m.goalStatusChoices({ status: 'done', progress: 100 }).includes('not_started'))
})

test('progress-only preview: 100 -> done, 0 stays not started, otherwise in progress, dropped is blocked', () => {
  assert.equal(m.statusAfterProgress({ status: 'in_progress', progress: 30 }, 100), 'done')
  assert.equal(m.statusAfterProgress({ status: 'not_started', progress: 0 }, 0), 'not_started')
  assert.equal(m.statusAfterProgress({ status: 'not_started', progress: 0 }, 25), 'in_progress')
  assert.equal(m.statusAfterProgress({ status: 'done', progress: 100 }, 80), 'in_progress')
  assert.equal(m.statusAfterProgress({ status: 'dropped', progress: 10 }, 50), null)
  assert.equal(m.clampProgress(140), 100)
  assert.equal(m.clampProgress(-5), 0)
  assert.equal(m.clampProgress(Number.NaN), 0)
  assert.equal(m.clampProgress(33.4), 33)
})

test('goal validation: title required, single line, <=120; description <=1000; due date real', () => {
  assert.deepEqual(m.validateGoal({ title: 'Ship it', description: '', due_date: '' }), {})
  assert.ok(m.validateGoal({ title: '   ', description: '', due_date: '' }).title)
  assert.ok(m.validateGoal({ title: 'x'.repeat(121), description: '', due_date: '' }).title)
  assert.deepEqual(m.validateGoal({ title: 'x'.repeat(120), description: '', due_date: '' }), {})
  assert.ok(m.validateGoal({ title: 'two\nlines', description: '', due_date: '' }).title)
  assert.ok(m.validateGoal({ title: 'ok', description: 'y'.repeat(1001), due_date: '' }).description)
  assert.ok(m.validateGoal({ title: 'ok', description: 'bell\u0007', due_date: '' }).description)
  assert.ok(m.validateGoal({ title: 'ok', description: '', due_date: '2027-02-30' }).due_date)
  assert.ok(m.validateGoal({ title: 'ok', description: '', due_date: 'tomorrow' }).due_date)
  assert.deepEqual(m.validateGoal({ title: 'ok', description: 'multi\nline is fine', due_date: '2028-02-29' }), {})
  // limits come from the server config when known
  assert.ok(m.validateGoal({ title: 'abcdef', description: '', due_date: '' }, { ...m.DEFAULT_LIMITS, goal_title_max: 5 }).title)
})

test('check-in validation: period when needed, at least one text, <=2000 each, mood 1..5', () => {
  const base = { period_label: '2027-Q1', accomplishments: 'Done', blockers: '', next_steps: '', mood: null }
  assert.deepEqual(m.validateCheckin(base, { needsPeriod: true }), {})
  assert.ok(m.validateCheckin({ ...base, period_label: ' ' }, { needsPeriod: true }).period_label)
  assert.ok(m.validateCheckin({ ...base, period_label: 'p'.repeat(61) }, { needsPeriod: true }).period_label)
  assert.ok(m.validateCheckin({ ...base, period_label: 'a\nb' }, { needsPeriod: true }).period_label)
  assert.equal(m.validateCheckin({ ...base, period_label: '' }, { needsPeriod: false }).period_label, undefined, 'a requested check-in fixes its period')
  const none = m.validateCheckin({ ...base, accomplishments: '  ' }, { needsPeriod: true })
  assert.match(none.texts, /at least one/)
  assert.ok(m.validateCheckin({ ...base, blockers: 'b'.repeat(2001) }, { needsPeriod: true }).blockers)
  assert.deepEqual(m.validateCheckin({ ...base, mood: 3 }, { needsPeriod: true }), {})
  assert.ok(m.validateCheckin({ ...base, mood: 0 }, { needsPeriod: true }).mood)
  assert.ok(m.validateCheckin({ ...base, mood: 6 }, { needsPeriod: true }).mood)
  assert.ok(m.validateCheckin({ ...base, mood: 2.5 }, { needsPeriod: true }).mood)
})

test('comment, feedback and period validators', () => {
  assert.ok(m.validateComment('   '))
  assert.equal(m.validateComment('Nice progress'), null)
  assert.ok(m.validateComment('c'.repeat(1001)))
  assert.equal(m.validateFeedback(''), null)
  assert.ok(m.validateFeedback('f'.repeat(2001)))
  assert.equal(m.validatePeriod('Week 12'), null)
  assert.ok(m.validatePeriod(''))
})

test('isIsoDate accepts only real dates in range', () => {
  for (const ok of ['2027-01-31', '2028-02-29', '2000-01-01', '2100-12-31']) assert.ok(m.isIsoDate(ok), ok)
  for (const bad of ['2027-02-29', '2027-13-01', '1999-12-31', '2101-01-01', '27-01-01', '', '2027-1-1']) assert.ok(!m.isIsoDate(bad), bad)
})

test('parseServerError: safe wording, 404 never leaks, 422 field errors, 409 existing check-in, network case', () => {
  const e = (status, data) => ({ response: { status, data } })
  assert.equal(m.parseServerError(e(409, { detail: 'You already have a check-in for that period', existing_checkin_id: 'abc' })).existingCheckinId, 'abc')
  assert.equal(m.parseServerError(e(409, { detail: 'Stale version' })).detail, 'Stale version')
  assert.match(m.parseServerError(e(404, { detail: 'Not found' })).detail, /not found, or you do not have access/)
  const f = m.parseServerError(e(422, { detail: 'Invalid request', errors: [{ loc: ['body', 'title'], msg: 'String should have at most 120 characters' }] }))
  assert.equal(f.fieldErrors.title, 'String should have at most 120 characters')
  assert.match(f.detail, /not accepted/)
  assert.match(m.parseServerError({}).detail, /could not be reached/)
  assert.equal(m.parseServerError(e(500, { detail: 'x'.repeat(400) }), 'Fallback text').detail, 'Fallback text', 'long server text is never shown')
  assert.equal(m.parseServerError(e(500, {}), 'Fallback text').detail, 'Fallback text')
})

test('tabs and scopes are navigation hints only: employee 2 tabs, manager +Team, HR +Team +overview', () => {
  assert.deepEqual(m.performanceTabs(['Employee']), ['goals', 'checkins'])
  assert.deepEqual(m.performanceTabs(['Manager']), ['goals', 'checkins', 'team', 'probation'])
  assert.deepEqual(m.performanceTabs(['HRAdmin']), ['goals', 'checkins', 'team', 'overview', 'probation'])
  assert.deepEqual(m.performanceTabs(['Finance']), ['goals', 'checkins'])
  assert.deepEqual(m.performanceTabs(undefined), ['goals', 'checkins'])
  assert.equal(m.parseTab('overview', ['goals', 'checkins']), 'goals', 'a forced tab that is not offered falls back')
  assert.equal(m.parseTab('team', ['goals', 'checkins', 'team']), 'team')
  assert.deepEqual(m.teamScopes(['Manager']), ['team'])
  assert.deepEqual(m.teamScopes(['HRAdmin']), ['all'])
  assert.deepEqual(m.teamScopes(['Manager', 'HRAdmin']), ['team', 'all'])
  assert.deepEqual(m.teamScopes(['Employee']), [])
  assert.equal(m.parseTeamView('goals'), 'goals')
  assert.equal(m.parseTeamView('zzz'), 'review')
})

test('actions come from the server list only', () => {
  assert.ok(m.canEditGoal({ allowed_actions: ['edit'] }))
  assert.ok(!m.canEditGoal({ allowed_actions: ['comment'] }))
  assert.ok(m.canCommentGoal({ allowed_actions: ['comment'] }))
  assert.ok(!m.canCommentGoal({ allowed_actions: [] }))
  assert.ok(m.canSubmitCheckin({ allowed_actions: ['submit'] }))
  assert.ok(m.canAcknowledgeCheckin({ allowed_actions: ['acknowledge'] }))
  assert.ok(!m.canAcknowledgeCheckin({ allowed_actions: [] }))
})

test('small helpers: pageCount, plural, person name, date time', () => {
  assert.equal(m.pageCount(0, 20), 1)
  assert.equal(m.pageCount(21, 20), 2)
  assert.equal(m.plural(1, 'goal'), '1 goal')
  assert.equal(m.plural(2, 'goal'), '2 goals')
  assert.equal(m.personName({ name: null, employee_id: 'EMP-0005' }), 'EMP-0005')
  assert.equal(m.personName(null), 'Unknown')
  assert.equal(m.formatDateTime(null), '-')
  assert.equal(m.formatDateTime('garbage'), 'garbage')
  assert.match(m.formatDateTime('2026-11-16T10:00:00.000Z'), /2026/)
})
