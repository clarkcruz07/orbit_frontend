import test, { before } from 'node:test'
import assert from 'node:assert/strict'
import { loadTs } from './helpers/load-ts.mjs'

let m
before(async () => {
  m = await loadTs('modules/peoplemgmt/logic.ts')
})

const NOW = new Date(2026, 10, 16) // 16 Nov 2026
const person = (over = {}) => ({
  employee: { employee_id: 'EMP-1', name: 'Ana Cruz', email: 'ana@x.test', job_title: 'Analyst', department: 'Operations', employment_type: 'full_time', manager_id: 'EMP-2', manager: { employee_id: 'EMP-2', name: 'Miguel' }, start_date: '2026-01-05', end_date: null, status: 'active', birthday: '03-27', is_demo: false, source: 'hr_created', avatar_initials: 'AC', ...over.employee },
  account: { has_account: true, can_sign_in: true, roles: ['Employee', 'Manager'], source: 'hr_created', disabled: false, disabled_reason: null, user_id: 'u1', ...over.account },
})
const goodForm = () => ({ ...m.emptyForm(), name: 'Ana Cruz', email: 'Ana@X.test', job_title: 'Analyst', department: 'Operations' })

// ------------------------------------------------------------------------------------------------ validation mirrors the server
test('limits mirror the server contract', () => {
  assert.equal(m.NAME_MAX, 120)
  assert.equal(m.TEXT_MAX, 120)
  assert.equal(m.EMAIL_MAX, 254)
  assert.equal(m.START_DATE_MIN, '1950-01-01')
  assert.equal(m.START_DATE_FUTURE_DAYS, 730)
  assert.equal(m.CSV_MAX_BYTES, 1024 * 1024)
  assert.equal(m.CSV_MAX_ROWS, 500)
  assert.equal(m.HOLIDAY_NAME_MAX, 120)
})

test('text rules: required, trimmed, collapsed, no control characters, no formula start, 120 max', () => {
  assert.equal(m.textRuleError('', 120, true), 'is required')
  assert.equal(m.textRuleError('   ', 120, true), 'is required')
  assert.equal(m.textRuleError('', 120, false), null)
  assert.equal(m.textRuleError('Ana  Maria', 120, true), null)
  assert.equal(m.textRuleError('a'.repeat(120), 120, true), null)
  assert.equal(m.textRuleError('a'.repeat(121), 120, true), 'must be at most 120 characters')
  assert.equal(m.textRuleError('a\u0007b', 120, true), 'contains control characters')
  for (const bad of ['=SUM(A1)', '+1', '-1', '@x', '  =cmd', '\tx']) assert.match(m.textRuleError(bad, 120, true), /must not start with/, bad)
  assert.equal(m.textRuleError('Mary-Jane', 120, true), null)
})

test('email rules: required, valid address, <= 254, no double dots, case folded for storage', () => {
  assert.equal(m.emailRuleError(''), 'is required')
  assert.equal(m.emailRuleError('nope'), 'must be a valid e-mail address')
  assert.equal(m.emailRuleError('a@b'), 'must be a valid e-mail address')
  assert.equal(m.emailRuleError('a..b@x.test'), 'must be a valid e-mail address')
  assert.equal(m.emailRuleError('a@.x.test'), 'must be a valid e-mail address')
  assert.equal(m.emailRuleError('=a@x.test'), 'must be a valid e-mail address')
  assert.equal(m.emailRuleError(`${'a'.repeat(250)}@x.test`), 'must be a valid e-mail address')
  assert.equal(m.emailRuleError('  Ana.Cruz@Demo.Example.test '), null)
})

test('birthday is MM-DD, a real calendar day (02-29 allowed), never a year', () => {
  for (const ok of ['01-01', '02-29', '12-31', '03-27']) assert.ok(m.isBirthday(ok), ok)
  for (const bad of ['13-01', '00-10', '02-30', '04-31', '1-1', '2026-03-27', '03/27', 'ab-cd', '']) assert.ok(!m.isBirthday(bad), bad)
  assert.equal(m.birthdayRuleError(''), null)
  assert.match(m.birthdayRuleError('02-30'), /MM-DD/)
})

test('start date: ISO only, 1950-01-01 up to today + 730 days', () => {
  assert.equal(m.startDateMax(NOW), '2028-11-15')
  assert.equal(m.startDateRuleError('', NOW), null)
  assert.equal(m.startDateRuleError('1950-01-01', NOW), null)
  assert.equal(m.startDateRuleError('2028-11-15', NOW), null)
  assert.equal(m.startDateRuleError('1949-12-31', NOW), 'is outside the supported range')
  assert.equal(m.startDateRuleError('2028-11-16', NOW), 'is outside the supported range')
  assert.equal(m.startDateRuleError('2026-02-30', NOW), 'must be a date like YYYY-MM-DD')
  assert.equal(m.startDateRuleError('16/11/2026', NOW), 'must be a date like YYYY-MM-DD')
})

test('employment type must be one of the four values', () => {
  assert.equal(m.employmentRuleError(''), 'is required')
  assert.equal(m.employmentRuleError('full_time'), null)
  assert.match(m.employmentRuleError('temp'), /must be one of/)
})

test('validatePersonForm: a good form passes; every problem is reported at once with the field name; own manager refused', () => {
  assert.deepEqual(m.validatePersonForm(goodForm(), NOW), {})
  const bad = { ...m.emptyForm(), name: '=x', email: 'nope', birthday: '13-40', start_date: '1900-01-01' }
  const e = m.validatePersonForm(bad, NOW)
  assert.deepEqual(Object.keys(e).sort(), ['birthday', 'department', 'email', 'job_title', 'name', 'start_date'])
  assert.match(e.name, /^Name must not start with/)
  assert.equal(e.job_title, 'Job title is required')
  const self = { ...goodForm(), manager: { employee_id: 'EMP-1', name: 'Ana' } }
  assert.equal(m.validatePersonForm(self, NOW, { selfId: 'EMP-1' }).manager_id, 'Manager cannot be the person themselves')
  assert.deepEqual(m.validatePersonForm(self, NOW), {})
})

test('fieldMessage prefixes the field label to the server wording', () => {
  assert.equal(m.fieldMessage('email', 'must be a valid e-mail address'), 'Email must be a valid e-mail address')
  assert.equal(m.fieldMessage('manager_id', 'must be an active employee'), 'Manager must be an active employee')
  assert.equal(m.fieldMessage('reassign_reports_to', 'must be an existing employee'), 'New manager must be an existing employee')
  assert.equal(m.fieldMessage('weird_field', ''), 'weird field is not valid')
})

// ------------------------------------------------------------------------------------------------ bodies
test('create body: normalised text, lower-case email, null for empty optionals, Employee always first, roles dropped without sign-in', () => {
  const form = { ...goodForm(), name: '  Ana   Cruz ', manager: { employee_id: 'EMP-2', name: 'M' }, roles: { Manager: true, HRAdmin: false, Finance: true } }
  const b = m.buildCreateBody(form)
  assert.deepEqual(b, { name: 'Ana Cruz', email: 'ana@x.test', job_title: 'Analyst', department: 'Operations', employment_type: 'full_time', manager_id: 'EMP-2', start_date: null, birthday: null, roles: ['Employee', 'Manager', 'Finance'], can_sign_in: true })
  const off = m.buildCreateBody({ ...form, can_sign_in: false })
  assert.deepEqual(off.roles, ['Employee'])
  assert.equal(off.can_sign_in, false)
})

test('patch body: only changed fields; cleared optionals become null; nothing changed is an empty patch', () => {
  const p = person()
  const same = m.formFromPerson(p)
  assert.ok(m.isEmptyPatch(m.buildPatchBody(p, same)))
  const changed = { ...same, name: ' Ana  Maria Cruz', manager: null, birthday: '', start_date: '2026-02-01', department: 'Operations' }
  assert.deepEqual(m.buildPatchBody(p, changed), { name: 'Ana Maria Cruz', manager_id: null, birthday: null, start_date: '2026-02-01' })
  const email = m.buildPatchBody(p, { ...same, email: ' ANA@x.test' })
  assert.ok(m.isEmptyPatch(email), 'case-only difference is not a change')
  assert.deepEqual(m.buildPatchBody(p, { ...same, email: 'new@x.test' }), { email: 'new@x.test' })
  assert.ok(!('roles' in m.buildPatchBody(p, { ...same, roles: { Manager: false, HRAdmin: true, Finance: true } })), 'roles go through their own endpoint')
})

test('formFromPerson mirrors the server person; rolesChanged compares as sets', () => {
  const f = m.formFromPerson(person({ account: { roles: ['Employee', 'Finance'] } }))
  assert.deepEqual(f.roles, { Manager: false, HRAdmin: false, Finance: true })
  assert.equal(f.manager.name, 'Miguel')
  assert.ok(!m.rolesChanged(['Employee', 'Finance'], f.roles))
  assert.ok(m.rolesChanged(['Employee'], f.roles))
  assert.deepEqual(m.rolesList(['Finance', 'HRAdmin']), ['Employee', 'HRAdmin', 'Finance'])
  assert.equal(m.rolesText([]), 'No roles (no sign-in account)')
  assert.equal(m.rolesText(['Employee', 'HRAdmin']), 'Employee, HR Administrator')
})

// ------------------------------------------------------------------------------------------------ labels and badges
test('account badge comes from the server account object', () => {
  assert.equal(m.accountBadge(person({ account: { has_account: false, can_sign_in: false, roles: [] } })).kind, 'no_account')
  assert.equal(m.accountBadge(person()).kind, 'can_sign_in')
  assert.equal(m.accountBadge(person({ account: { can_sign_in: false, disabled: true, disabled_reason: 'deactivated' } })).label, 'Deactivated')
  assert.equal(m.accountBadge(person({ account: { can_sign_in: false, disabled: true, disabled_reason: 'sign_in_off' } })).label, 'Sign-in off')
})

test('labels: employment, status, sign-in source, birthday (no year), initials', () => {
  assert.equal(m.employmentLabel('part_time'), 'Part-time')
  assert.equal(m.employmentLabel('weird_kind'), 'Weird Kind')
  assert.equal(m.statusLabel('left'), 'Left')
  assert.equal(m.statusTone('active'), 'green')
  assert.match(m.signInSourceLabel('hr_created'), /Microsoft work account/)
  assert.equal(m.signInSourceLabel(null), 'No sign-in account')
  assert.equal(m.birthdayLabel('03-27'), '27 Mar')
  assert.equal(m.birthdayLabel(null), '-')
  assert.equal(m.initialsOf('Ana Maria Cruz'), 'AC')
  assert.match(m.disabledText('deactivated'), /deactivated/)
})

// ------------------------------------------------------------------------------------------------ list helpers
test('list helpers: query cleaning, page parsing, literal match, exact department, ranges', () => {
  assert.equal(m.cleanQuery('  ab  '), 'ab')
  assert.equal(m.cleanQuery('x'.repeat(200)).length, 100)
  assert.equal(m.parsePage('3'), 3)
  assert.equal(m.parsePage('0'), 1)
  assert.equal(m.parsePage('x'), 1)
  assert.equal(m.parseStatusFilter('left'), 'left')
  assert.equal(m.parseStatusFilter('zzz'), '')
  const p = person()
  assert.ok(m.matchesQuery(p, 'ANA'))
  assert.ok(m.matchesQuery(p, 'operations'))
  assert.ok(!m.matchesQuery(p, '.*'), 'literal, never a regex')
  assert.ok(m.matchesQuery(p, ''))
  assert.ok(m.exactDepartment(p, ' operations '))
  assert.ok(!m.exactDepartment(p, 'Operation'))
  assert.equal(m.rangeText(2, 20, 45, 20), '21-40 of 45')
  assert.equal(m.rangeText(1, 20, 0, 0), '0 of 0')
  assert.equal(m.pageCount(45, 20), 3)
  assert.equal(m.pageCount(0, 20), 1)
})

// ------------------------------------------------------------------------------------------------ failure wording
test('failureMessage: guard rails show the SERVER reason verbatim; other cases have fixed friendly wording', () => {
  const f = (over) => ({ status: 409, code: null, detail: null, fieldErrors: {}, field: null, activeDirectReports: null, missingColumns: [], maxRows: null, ...over })
  assert.match(m.failureMessage(f({ status: null }), 'X.'), /Can't reach/)
  assert.match(m.failureMessage(f({ status: 401 }), 'X.'), /session has ended/)
  assert.equal(m.failureMessage(f({ status: 403, detail: 'You cannot change your own roles' }), 'X.'), 'You cannot change your own roles')
  assert.equal(m.failureMessage(f({ code: 'last_hradmin', detail: 'Promote someone else to HR Administrator first.' }), 'X.'), 'Promote someone else to HR Administrator first.')
  assert.match(m.failureMessage(f({ code: 'email_exists', detail: 'raw text' }), 'X.'), /already used by another person or account/)
  assert.equal(m.failureMessage(f({ code: 'duplicate' }), 'X.'), 'A holiday with this name already exists on that day.')
  assert.match(m.failureMessage(f({ status: 413 }), 'X.'), /larger than 1 MB/)
  assert.match(m.failureMessage(f({ status: 500, detail: 'Traceback...' }), 'X.'), /Something went wrong/)
  assert.ok(!/Traceback/.test(m.failureMessage(f({ status: 500, detail: 'Traceback...' }), 'X.')))
  assert.equal(m.failureMessage(f({ status: 422, fieldErrors: { manager_id: 'must be an active employee' } }), 'X.'), 'Manager must be an active employee')
})

test('import whole-file errors have clear messages', () => {
  const f = (code, extra = {}) => ({ status: 422, code, detail: null, fieldErrors: {}, field: null, activeDirectReports: null, missingColumns: [], maxRows: null, ...extra })
  assert.match(m.importFileMessage(f('empty_file')), /empty/)
  assert.match(m.importFileMessage(f('invalid_encoding')), /UTF-8/)
  assert.match(m.importFileMessage(f('missing_columns', { missingColumns: ['email', 'name'] })), /email, name/)
  assert.match(m.importFileMessage(f('too_many_rows', { maxRows: 500 })), /more than 500/)
  assert.equal(m.importFileMessage(f('something_else')), null)
})

// ------------------------------------------------------------------------------------------------ CSV hints
test('file hints: empty, over 1 MB, not .csv', () => {
  assert.deepEqual(m.fileHints({ name: 'a.csv', size: 10 }), [])
  assert.equal(m.fileHints({ name: 'a.csv', size: 0 })[0].tone, 'error')
  const big = m.fileHints({ name: 'a.csv', size: 1024 * 1024 + 1 })
  assert.equal(big[0].tone, 'error')
  assert.match(big[0].text, /limit is 1 MB/)
  assert.equal(m.fileHints({ name: 'a.xlsx', size: 10 })[0].tone, 'warning')
  assert.ok(m.hasBlockingHint(big))
  assert.ok(!m.hasBlockingHint(m.fileHints({ name: 'a.txt', size: 5 })))
})

test('peekCsv reads header names and a row estimate only; hints flag missing columns and too many rows', () => {
  const peek = m.peekCsv('﻿Name,EMAIL,job_title\r\nA,a@x.test,T\r\n\r\nB,b@x.test,T\r\n')
  assert.deepEqual(peek.columns, ['name', 'email', 'job_title'])
  assert.equal(peek.approxRows, 2)
  const hints = m.peekHints(peek)
  assert.match(hints[0].text, /department, employment_type/)
  const many = m.peekCsv(`name,email,job_title,department,employment_type\n${'a,b,c,d,e\n'.repeat(501)}`)
  assert.equal(many.approxRows, 501)
  assert.ok(m.peekHints(many).some((h) => h.tone === 'warning' && /limit is 500/.test(h.text)), 'a line count is only an estimate, so it warns but never blocks')
  assert.ok(!m.hasBlockingHint(m.peekHints(many)))
  assert.ok(m.peekHints(m.peekCsv('name,email,job_title,department,employment_type\n')).some((h) => /no people/.test(h.text)))
})

// ------------------------------------------------------------------------------------------------ import report
const report = (over = {}) => ({
  dry_run: true,
  total: 3,
  created: 1,
  skipped: 1,
  invalid: 1,
  ignored_columns: [],
  rows: [
    { row: 2, status: 'created', reason: null, message: null, employee_id: null, field_errors: {} },
    { row: 3, status: 'skipped', reason: 'email_exists', message: 'exists', employee_id: null, field_errors: {} },
    { row: 4, status: 'invalid', reason: 'validation', message: 'bad', employee_id: null, field_errors: { name: 'must not start with = + - or @' } },
  ],
  ...over,
})

test('import report: Import N people is offered only after a dry run that would create someone', () => {
  assert.ok(m.canImport(report()))
  assert.ok(!m.canImport(report({ created: 0 })))
  assert.ok(!m.canImport(report({ dry_run: false })), 'a real run is never offered again')
  assert.ok(!m.canImport(null))
  assert.equal(m.importButtonLabel(report()), 'Import 1 person')
  assert.equal(m.importButtonLabel(report({ created: 12 })), 'Import 12 people')
})

test('import report wording: status words, reasons, per-field messages, filters, summary - no cell values anywhere', () => {
  const r = report()
  assert.equal(m.rowStatusWord(r.rows[0], true), 'Would be created')
  assert.equal(m.rowStatusWord(r.rows[0], false), 'Created')
  assert.equal(m.rowStatusWord(r.rows[1], true), 'Skipped')
  assert.match(m.reasonText(r.rows[1]), /already in the system/)
  assert.match(m.reasonText(r.rows[2]), /not valid/)
  assert.deepEqual(m.rowErrorList(r.rows[2]), ['Name must not start with = + - or @'])
  assert.equal(m.filterRows(r.rows, 'invalid').length, 1)
  assert.equal(m.filterRows(r.rows, 'all').length, 3)
  assert.equal(m.summaryText(r), '3 rows read: 1 would be created, 1 skipped, 1 invalid.')
  assert.equal(m.summaryText(report({ dry_run: false })), '3 rows read: 1 created, 1 skipped, 1 invalid.')
  assert.match(m.IMPORT_FORMULA_NOTE, /= \+ - or @/)
  assert.equal(m.reasonText({ row: 9, status: 'invalid', reason: 'new_unknown_reason', message: 'Server words', employee_id: null, field_errors: {} }), 'Server words')
})

// ------------------------------------------------------------------------------------------------ holidays
const hol = (over = {}) => ({ holiday_id: 'h1', name: 'Founders Day', type: 'company', date: '2026-12-24', month: null, day: null, recurring: false, active: true, date_in_year: '2026-12-24', ...over })

test('holiday form validation: name rules, real one-off date 2000-2100, yearly month/day incl. 29 Feb', () => {
  const ok = { ...m.emptyHolidayForm(2026), name: 'Founders Day', date: '2026-12-24' }
  assert.deepEqual(m.validateHolidayForm(ok), {})
  assert.equal(m.validateHolidayForm({ ...ok, name: '' }).name, 'Name is required')
  assert.match(m.validateHolidayForm({ ...ok, name: '=cmd' }).name, /must not start with/)
  assert.match(m.validateHolidayForm({ ...ok, name: 'x'.repeat(121) }).name, /at most 120/)
  assert.match(m.validateHolidayForm({ ...ok, date: '2026-02-30' }).date, /real date/)
  assert.match(m.validateHolidayForm({ ...ok, date: '1999-12-31' }).date, /between 2000 and 2100/)
  assert.match(m.validateHolidayForm({ ...ok, date: '2101-01-01' }).date, /between 2000 and 2100/)
  const yearly = { ...ok, recurring: true, month: '2', day: '29' }
  assert.deepEqual(m.validateHolidayForm(yearly), {}, '29 February is allowed for a yearly holiday')
  assert.match(m.validateHolidayForm({ ...yearly, day: '30' }).month, /February has 29 days at most/)
  assert.match(m.validateHolidayForm({ ...yearly, month: '4', day: '31' }).month, /April has 30 days at most/)
  assert.deepEqual(m.validateHolidayForm({ ...yearly, date: 'garbage' }), {}, 'the date box is ignored for a yearly holiday')
})

test('holiday bodies: create sends date OR month+day; patch sends only changes and the new form of the timing', () => {
  const f = { ...m.emptyHolidayForm(2026), name: ' Founders  Day ', type: 'public', date: '2026-12-24', active: true }
  assert.deepEqual(m.buildHolidayCreate(f), { name: 'Founders Day', type: 'public', active: true, date: '2026-12-24' })
  assert.deepEqual(m.buildHolidayCreate({ ...f, recurring: true, month: '12', day: '25' }), { name: 'Founders Day', type: 'public', active: true, month: 12, day: 25 })
  const h = hol()
  const same = m.formFromHoliday(h, 2026)
  assert.deepEqual(m.buildHolidayPatch(h, same), {})
  assert.deepEqual(m.buildHolidayPatch(h, { ...same, active: false }), { active: false })
  assert.deepEqual(m.buildHolidayPatch(h, { ...same, name: 'New name', type: 'public' }), { name: 'New name', type: 'public' })
  assert.deepEqual(m.buildHolidayPatch(h, { ...same, date: '2026-12-26' }), { date: '2026-12-26' })
  assert.deepEqual(m.buildHolidayPatch(h, { ...same, recurring: true, month: '12', day: '24' }), { month: 12, day: 24 })
  const yearly = hol({ recurring: true, date: null, month: 12, day: 25 })
  const yf = m.formFromHoliday(yearly, 2026)
  assert.deepEqual(m.buildHolidayPatch(yearly, yf), {})
  assert.deepEqual(m.buildHolidayPatch(yearly, { ...yf, recurring: false, date: '2026-12-25' }), { date: '2026-12-25' })
})

test('holiday display: type and repeat text, year parsing and options, other-years count', () => {
  assert.equal(m.holidayTypeLabel('public'), 'Public holiday')
  assert.equal(m.holidayTypeLabel('company'), 'Company holiday')
  assert.equal(m.repeatText(hol()), 'One date only')
  assert.equal(m.repeatText(hol({ recurring: true, date: null, month: 12, day: 25 })), 'Every year (25 Dec)')
  assert.equal(m.holidayDateText(hol()), 'Thu, 24 Dec 2026')
  assert.equal(m.holidayDateText(hol({ date_in_year: null })), '-')
  assert.equal(m.parseYear('2027', NOW), 2027)
  assert.equal(m.parseYear('1999', NOW), 2026)
  assert.equal(m.parseYear('abc', NOW), 2026)
  assert.equal(m.parseYear(null, NOW), 2026)
  const years = m.yearOptions(2040, NOW)
  assert.ok(years.includes(2040) && years.includes(2026) && years.includes(2031))
  assert.deepEqual([...years].sort((a, b) => a - b), years)
  const items = [hol(), hol({ holiday_id: 'h2', date_in_year: null })]
  assert.equal(m.inYear(items).length, 1)
  assert.equal(m.otherYearsCount(items), 1)
  assert.match(m.HOLIDAYS_USAGE_NOTE, /NOT recalculated/)
})
