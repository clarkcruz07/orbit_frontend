import test, { before } from 'node:test'
import assert from 'node:assert/strict'
import { loadTs } from './helpers/load-ts.mjs'

let m
before(async () => {
  m = await loadTs('modules/learning/logic.ts')
})

const fmt = (d) => d // identity formatter keeps the wording tests readable

test('status and delivery labels, tones, duration wording', () => {
  assert.equal(m.statusLabel('in_progress'), 'In progress')
  assert.equal(m.statusLabel('assigned'), 'Assigned')
  assert.equal(m.statusLabel('odd_thing'), 'odd thing')
  assert.equal(m.statusTone('completed'), 'green')
  assert.equal(m.statusTone('cancelled'), 'neutral')
  assert.equal(m.deliveryLabel('self_paced'), 'Self-paced')
  assert.equal(m.deliveryLabel(null), '-')
  assert.equal(m.durationLabel(1), '1 hour')
  assert.equal(m.durationLabel(2.5), '2.5 hours')
  assert.equal(m.durationLabel(1.5), '1.5 hours')
  assert.equal(m.durationLabel(3), '3 hours')
  assert.equal(m.durationLabel(null), '-')
})

test('confirmation wording only appears for completed enrolments', () => {
  assert.equal(m.confirmationLabel({ status: 'in_progress', confirmation_status: 'pending' }), null)
  assert.equal(m.confirmationLabel({ status: 'completed', confirmation_status: 'pending' }), 'Waiting for confirmation')
  assert.equal(m.confirmationLabel({ status: 'completed', confirmation_status: 'confirmed' }), 'Confirmed')
  assert.equal(m.confirmationLabel({ status: 'completed', confirmation_status: 'not_required' }), 'Self-attested')
  assert.equal(m.confirmationLabel({ status: 'completed', confirmation_status: null }), null)
  assert.equal(m.confirmationTone({ confirmation_status: 'pending' }), 'amber')
  assert.equal(m.confirmationTone({ confirmation_status: 'confirmed' }), 'green')
})

test('due text phrases the SERVER-computed flags (overdue, due soon, plain, none)', () => {
  const base = { status: 'enrolled', overdue: false, days_overdue: 0, due_soon: false, days_until_due: null }
  assert.equal(m.dueText({ ...base, due_date: null }, fmt), null)
  assert.equal(m.dueText({ ...base, due_date: '2027-03-05' }, fmt), 'Due 2027-03-05')
  assert.equal(m.dueText({ ...base, due_date: '2026-11-10', overdue: true, days_overdue: 6 }, fmt), 'Due 2026-11-10 - 6 days overdue')
  assert.equal(m.dueText({ ...base, due_date: '2026-11-15', overdue: true, days_overdue: 1 }, fmt), 'Due 2026-11-15 - 1 day overdue')
  assert.equal(m.dueText({ ...base, due_date: '2026-11-16', due_soon: true, days_until_due: 0 }, fmt), 'Due 2026-11-16 - today')
  assert.equal(m.dueText({ ...base, due_date: '2026-11-17', due_soon: true, days_until_due: 1 }, fmt), 'Due 2026-11-17 - tomorrow')
  assert.equal(m.dueText({ ...base, due_date: '2026-11-20', due_soon: true, days_until_due: 4 }, fmt), 'Due 2026-11-20 - in 4 days')
})

test('tabs are navigation hints only: everyone Catalog + My learning, manager +Team, HR +HR', () => {
  assert.deepEqual(m.learningTabs(['Employee']), ['catalog', 'mine'])
  assert.deepEqual(m.learningTabs(['Finance']), ['catalog', 'mine'])
  assert.deepEqual(m.learningTabs(['Manager']), ['catalog', 'mine', 'team'])
  assert.deepEqual(m.learningTabs(['HRAdmin']), ['catalog', 'mine', 'hr'])
  assert.deepEqual(m.learningTabs(['Manager', 'HRAdmin']), ['catalog', 'mine', 'team', 'hr'])
  assert.deepEqual(m.learningTabs(undefined), ['catalog', 'mine'])
  assert.equal(m.parseTab('hr', ['catalog', 'mine']), 'catalog', 'a forced tab that is not offered falls back')
  assert.equal(m.parseTab('mine', ['catalog', 'mine']), 'mine')
})

test('actions come from the server list only', () => {
  assert.ok(m.enrolmentCan({ allowed_actions: ['start', 'complete'] }, 'start'))
  assert.ok(!m.enrolmentCan({ allowed_actions: ['start'] }, 'confirm'))
  assert.ok(m.courseCan({ allowed_actions: ['enrol'] }, 'enrol'))
  assert.ok(!m.courseCan({ allowed_actions: ['enrol'] }, 'edit'))
  assert.ok(!m.courseCan({ allowed_actions: [] }, 'assign'))
})

test('assignment validation: course and person required, due date real and not clearly in the past', () => {
  const today = '2026-11-16'
  assert.deepEqual(m.validateAssign({ course_id: 'c', employee_id: 'EMP-0005', due_date: '' }, today), {})
  assert.deepEqual(m.validateAssign({ course_id: 'c', employee_id: 'EMP-0005', due_date: '2026-11-16' }, today), {})
  assert.ok(m.validateAssign({ course_id: '', employee_id: 'EMP-0005', due_date: '' }, today).course_id)
  assert.ok(m.validateAssign({ course_id: 'c', employee_id: '', due_date: '' }, today).employee_id)
  assert.match(m.validateAssign({ course_id: 'c', employee_id: 'e', due_date: '2026-11-15' }, today).due_date, /past/)
  assert.match(m.validateAssign({ course_id: 'c', employee_id: 'e', due_date: '2026-02-30' }, today).due_date, /valid/)
  assert.match(m.validateDueDate('', today, true), /Choose/)
  assert.equal(m.validateDueDate('', today), null)
})

test('addDays works on plain dates without time-zone effects', () => {
  assert.equal(m.addDays('2026-11-16', -1), '2026-11-15')
  assert.equal(m.addDays('2026-03-01', -1), '2026-02-28')
  assert.equal(m.addDays('2028-03-01', -1), '2028-02-29')
  assert.equal(m.addDays('2026-12-31', 1), '2027-01-01')
  assert.equal(m.addDays('nonsense', 1), 'nonsense')
})

test('duration parsing: positive, at most 2 decimals, at most the limit', () => {
  assert.equal(m.parseDuration('2.5'), 2.5)
  assert.equal(m.parseDuration(' 8 '), 8)
  assert.equal(m.parseDuration('1000'), 1000)
  for (const bad of ['', '0', '0.00', '-1', '1.234', '1001', 'abc', '1e3', '1,5']) assert.equal(m.parseDuration(bad), null, bad)
})

test('course validation and request body', () => {
  const ok = { ...m.emptyCourseForm(), title: 'Fire Safety Basics', category: 'Compliance', duration_hours: '1.5', delivery: 'online', mandatory_default: true }
  assert.deepEqual(m.validateCourse(ok), {})
  assert.deepEqual(m.courseBody(ok), { title: 'Fire Safety Basics', description: '', category: 'Compliance', duration_hours: 1.5, delivery: 'online', mandatory_default: true, active: true })
  assert.ok(m.validateCourse({ ...ok, title: ' ' }).title)
  assert.ok(m.validateCourse({ ...ok, title: 'x'.repeat(121) }).title)
  assert.ok(m.validateCourse({ ...ok, title: 'a\nb' }).title)
  assert.ok(m.validateCourse({ ...ok, category: '' }).category)
  assert.ok(m.validateCourse({ ...ok, category: 'c'.repeat(61) }).category)
  assert.ok(m.validateCourse({ ...ok, description: 'd'.repeat(1001) }).description)
  assert.ok(m.validateCourse({ ...ok, duration_hours: '0' }).duration_hours)
  assert.ok(m.validateCourse({ ...ok, duration_hours: '' }).duration_hours)
  assert.ok(m.validateCourse({ ...ok, delivery: '' }).delivery)
  const edited = m.formFromCourse({ title: 'T', description: 'D', category: 'C', duration_hours: 2, delivery: 'classroom', mandatory_default: false, active: false })
  assert.deepEqual(edited, { title: 'T', description: 'D', category: 'C', duration_hours: '2', delivery: 'classroom', mandatory_default: false, active: false })
})

test('completion note validation', () => {
  assert.equal(m.validateNote(''), null)
  assert.equal(m.validateNote('Finished the workbook'), null)
  assert.ok(m.validateNote('n'.repeat(1001)))
  assert.ok(m.validateNote('bell\u0007'))
})

test('certificate hint states the types, size and file limits from the server config, and says the server checks', () => {
  const h = m.certHint(['application/pdf', 'image/png', 'image/jpeg'], 10, 5)
  assert.match(h, /PDF, PNG or JPEG/)
  assert.match(h, /10 MB/)
  assert.match(h, /5 files/)
  assert.match(h, /service checks the real file type and size/)
  assert.equal(m.typeLabel('application/pdf'), 'PDF')
  assert.equal(m.typeLabel('image/jpeg'), 'JPEG')
  assert.equal(m.formatBytes(512), '512 B')
  assert.equal(m.formatBytes(2048), '2.0 KB')
  assert.equal(m.formatBytes(3 * 1024 * 1024), '3.0 MB')
})

test('upload errors: fixed friendly wording for 413 / 415 / 400, server text for the rest', () => {
  const info = (status, detail = 'x') => ({ status, detail, existingEnrolmentId: null, fieldErrors: {} })
  assert.match(m.uploadErrorText(info(413), 10), /too large \(limit 10 MB\)\. Nothing was stored/)
  assert.match(m.uploadErrorText(info(415), 10), /PDF, PNG or JPEG\. Nothing was stored/)
  assert.match(m.uploadErrorText(info(400, 'The file is empty'), 10), /The file is empty Nothing was stored/)
  assert.equal(m.uploadErrorText(info(409, 'At most 5 certificate files'), 10), 'At most 5 certificate files')
})

test('download name comes from the server Content-Disposition, never the uploaded name; unsafe characters are removed', () => {
  assert.equal(m.downloadName('attachment; filename="certificate-1a2b3c4d.pdf"'), 'certificate-1a2b3c4d.pdf')
  assert.equal(m.downloadName("attachment; filename*=UTF-8''certificate-aa.png"), 'certificate-aa.png')
  assert.equal(m.downloadName(undefined, 'fallback.pdf'), 'fallback.pdf')
  assert.equal(m.downloadName('attachment', 'fallback.pdf'), 'fallback.pdf')
  assert.ok(!/[\\/:]/.test(m.downloadName('attachment; filename="a/b\\c:d.pdf"')))
})

test('parseServerError: safe wording, 404 never leaks, 422 field errors, 409 existing enrolment, network case', () => {
  const e = (status, data) => ({ response: { status, data } })
  assert.equal(m.parseServerError(e(409, { detail: 'You already have this course open', existing_enrolment_id: 'xyz' })).existingEnrolmentId, 'xyz')
  assert.match(m.parseServerError(e(404, { detail: 'Not found' })).detail, /not found, or you do not have access/)
  const f = m.parseServerError(e(422, { detail: 'Invalid request', errors: [{ loc: ['body', 'due_date'], msg: 'Due date cannot be in the past' }] }))
  assert.equal(f.fieldErrors.due_date, 'Due date cannot be in the past')
  assert.match(f.detail, /not accepted/)
  assert.match(m.parseServerError({}).detail, /could not be reached/)
  assert.equal(m.parseServerError(e(500, { detail: 'y'.repeat(400) }), 'Fallback').detail, 'Fallback')
  assert.equal(m.parseServerError(e(403, { detail: 'You do not have access to this action' })).detail, 'You do not have access to this action')
})

test('catalog helpers: enrolment blurb, open statuses, person names, assigned-by wording, progress clamp, paging', () => {
  assert.equal(m.enrolmentBlurb({ my_enrolment: null }), null)
  assert.equal(m.enrolmentBlurb({ my_enrolment: { enrolment_id: 'e', status: 'in_progress' } }), 'In progress')
  assert.ok(m.isOpen('assigned') && m.isOpen('enrolled') && m.isOpen('in_progress'))
  assert.ok(!m.isOpen('completed') && !m.isOpen('cancelled'))
  assert.equal(m.assignedByText({ source: 'self', assigned_by: null, assigned_at: null }), 'Self-enrolled')
  assert.equal(m.assignedByText({ source: 'assigned', assigned_by: { employee_id: 'EMP-0002', name: 'Miguel Santos', role: 'Manager' }, assigned_at: null }), 'Assigned by Miguel Santos')
  assert.equal(m.personName({ name: null, employee_id: 'EMP-0005' }), 'EMP-0005')
  assert.equal(m.clampProgress(150), 100)
  assert.equal(m.clampProgress(-3), 0)
  assert.equal(m.pageCount(0, 12), 1)
  assert.equal(m.pageCount(25, 12), 3)
})
