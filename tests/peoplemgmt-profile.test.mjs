// Unit tests for the HR employee profile: tolerant reader, server-mirroring validators, minimal PATCH bodies, masking, error-key mapping.
import test, { before } from 'node:test'
import assert from 'node:assert/strict'
import { loadTs, readSrc, listSrc } from './helpers/load-ts.mjs'

let p
let a
let l
before(async () => {
  p = await loadTs('modules/peoplemgmt/profileLogic.ts')
  a = await loadTs('api/profile.ts')
  l = await loadTs('modules/peoplemgmt/logic.ts')
})

const fmt = (iso) => iso
const full = () => ({
  personal: { preferred_name: 'Mara', gender: 'female', civil_status: 'single', nationality: 'Filipino', birth_year: 1995 },
  contact: { personal_email: 'mara@home.test', mobile: '+63 917 123 4567', address: { line1: '12 Mabini St', line2: 'Unit 4', city: 'Makati', province: 'Metro Manila', postal_code: '1210', country: 'Philippines' } },
  emergency_contact: { name: 'Ana Reyes', relationship: 'Sister', phone: '0917-555-0100' },
  work: { employee_number: 'E-77', company: 'Bluedge', office_location: 'Makati', work_arrangement: 'hybrid', probation_end_date: '2027-02-03', regularization_date: '' },
  statutory: { tin: '123-456-789', sss: '34-1234567-8', philhealth: '12-345678901-2', pagibig: '1234-5678-9012' },
})

test('the reader is tolerant: missing sections, wrong types and junk never throw and read as not provided', () => {
  assert.deepEqual(a.normaliseProfile(undefined), a.emptyProfile())
  assert.deepEqual(a.normaliseProfile('nope'), a.emptyProfile())
  const r = a.normaliseProfile({ personal: { preferred_name: 5, gender: 'female' }, contact: { address: 'x', mobile: '123' }, work: null })
  assert.equal(r.personal.preferred_name, '')
  assert.equal(r.personal.gender, 'female')
  assert.equal(r.contact.address.city, '')
  assert.equal(r.contact.mobile, '123')
  assert.equal(r.work.company, '')
  assert.deepEqual(a.normaliseProfile(full()), { ...full(), personal: { ...full().personal, birth_year: '1995' } }, 'the birth year arrives as an integer and reads as digits')
})

test('limits and rules mirror the server contract', () => {
  assert.equal(p.PERSON_NAME_MAX, 60)
  assert.equal(p.PLACE_MAX, 120)
  assert.equal(p.PHONE_MIN, 7)
  assert.equal(p.PHONE_MAX, 24)
  assert.equal(p.EMPLOYEE_NUMBER_MAX, 30)
  assert.equal(p.GOV_ID_MAX, 20)
  const f = Object.fromEntries(p.SECTION_FIELDS.contact.map((s) => [s.key, s]))
  const w = Object.fromEntries(p.SECTION_FIELDS.work.map((s) => [s.key, s]))
  const st = Object.fromEntries(p.SECTION_FIELDS.statutory.map((s) => [s.key, s]))
  assert.equal(p.fieldRuleError(f.mobile, '+63 917 123 4567'), null)
  assert.match(p.fieldRuleError(f.mobile, '12'), /7 to 24/)
  assert.match(p.fieldRuleError(f.mobile, '0917-abc-1234'), /digits, spaces/)
  assert.match(p.fieldRuleError(f.mobile, '1'.repeat(25)), /7 to 24/)
  assert.equal(p.fieldRuleError(f.personal_email, 'a@b.test'), null)
  assert.match(p.fieldRuleError(f.personal_email, 'not-an-email'), /valid e-mail/)
  assert.match(p.fieldRuleError(f['address.city'], 'x'.repeat(121)), /at most 120/)
  assert.equal(p.fieldRuleError(f['address.city'], '   '), null, 'blank is fine: it just means not provided')
  assert.equal(p.fieldRuleError(st.tin, '123-456-789'), null)
  assert.match(p.fieldRuleError(st.tin, '123 456'), /digits and hyphens/)
  assert.match(p.fieldRuleError(st.tin, '1'.repeat(21)), /at most 20/)
  assert.equal(p.fieldRuleError(w.probation_end_date, '2027-02-03'), null)
  assert.match(p.fieldRuleError(w.probation_end_date, '2027-02-30'), /real date/)
  assert.match(p.fieldRuleError(w.probation_end_date, '03/02/2027'), /real date/)
  assert.match(p.fieldRuleError(w.work_arrangement, 'sometimes'), /choices/)
  assert.equal(p.fieldRuleError(w.work_arrangement, 'remote'), null)
  assert.equal(p.fieldRuleError(w.employee_number, 'E'.repeat(30)), null)
  assert.match(p.fieldRuleError(w.employee_number, 'E'.repeat(31)), /at most 30/)
})

test('an emergency contact needs both name and phone as soon as any detail is given', () => {
  const e = p.validateSection('emergency_contact', { name: '', relationship: 'Sister', phone: '' })
  assert.deepEqual(Object.keys(e).sort(), ['profile.emergency_contact.name', 'profile.emergency_contact.phone'])
  assert.match(e['profile.emergency_contact.name'], /^Emergency contact name is required/)
  assert.deepEqual(p.validateSection('emergency_contact', { name: '', relationship: '', phone: '' }), {}, 'all blank is fine')
  assert.deepEqual(p.validateSection('emergency_contact', { name: 'Ana', relationship: '', phone: '0917 555 0100' }), {})
})

test('error keys are server paths; sections own their keys', () => {
  const e = p.validateSection('contact', { ...p.sectionFormFromProfile('contact', full()), mobile: 'bad!', 'address.city': 'x'.repeat(130) })
  assert.deepEqual(Object.keys(e).sort(), ['profile.contact.address.city', 'profile.contact.mobile'])
  assert.equal(p.sectionOfError('profile.contact.address.city'), 'contact')
  assert.equal(p.sectionOfError('profile.statutory.tin'), 'statutory')
  assert.equal(p.sectionOfError('name'), null)
  assert.equal(p.sectionOfError('profile.unknown.x'), null)
  assert.deepEqual(p.sectionErrors({ 'profile.contact.mobile': 'm', 'profile.work.company': 'c', email: 'e' }, 'contact'), { mobile: 'm' })
  // the labels of server field errors read naturally
  assert.equal(l.fieldMessage('profile.contact.mobile', 'must be 7 to 24 characters'), 'Mobile number must be 7 to 24 characters')
  assert.equal(l.fieldLabel('profile.statutory.sss'), 'SSS number')
  assert.equal(l.fieldLabel('profile.contact.address.postal_code'), 'Postal code')
})

test('create sends only the sections and keys that have a value', () => {
  assert.equal(p.buildProfileCreate(p.emptyProfileForm()), undefined)
  const form = p.emptyProfileForm()
  form.contact.mobile = '  0917  123 4567 '
  form.contact['address.city'] = 'Makati'
  form.work.company = 'Bluedge'
  const body = p.buildProfileCreate(form)
  assert.deepEqual(body, { contact: { mobile: '0917 123 4567', address: { city: 'Makati' } }, work: { company: 'Bluedge' } })
  assert.equal(Object.hasOwn(body, 'personal'), false)
})

test('a section PATCH carries only the changed keys; a cleared key is null; nothing changed is null', () => {
  const orig = a.normaliseProfile(full())
  const form = p.sectionFormFromProfile('contact', orig)
  assert.equal(p.buildSectionPatch('contact', orig, form), null)
  form.mobile = '+63 917 000 0000'
  form['address.city'] = ''
  form['address.line2'] = '  Unit   4 '
  assert.deepEqual(p.buildSectionPatch('contact', orig, form), { profile: { contact: { mobile: '+63 917 000 0000', address: { city: null } } } })
  const st = p.sectionFormFromProfile('statutory', orig)
  st.sss = '99-9999999-9'
  assert.deepEqual(p.buildSectionPatch('statutory', orig, st), { profile: { statutory: { sss: '99-9999999-9' } } })
  const work = p.sectionFormFromProfile('work', orig)
  work.work_arrangement = ''
  assert.deepEqual(p.buildSectionPatch('work', orig, work), { profile: { work: { work_arrangement: null } } })
})

test('masking hides all but the last four; a server-masked value is left alone', () => {
  assert.equal(p.maskNumber('123-456-789'), '••••6789')
  assert.equal(p.maskNumber('1234'), '••••')
  assert.equal(p.maskNumber(''), '')
  assert.equal(p.isMasked('••••1234'), true)
  assert.equal(p.isMasked('123-456-789'), false)
})

test('display rows: empty values read "Not provided", the address is one multi-line row, selects and dates are readable', () => {
  const rows = p.sectionRows('contact', a.emptyProfile(), fmt)
  assert.deepEqual(rows.map((r) => [r.key, r.value, r.provided]), [['personal_email', 'Not provided', false], ['mobile', 'Not provided', false], ['address', 'Not provided', false]])
  const filled = p.sectionRows('contact', a.normaliseProfile(full()), fmt)
  assert.equal(filled.find((r) => r.key === 'address').value, '12 Mabini St, Unit 4\nMakati, Metro Manila 1210\nPhilippines')
  const work = p.sectionRows('work', a.normaliseProfile(full()), (iso) => `D:${iso}`)
  assert.equal(work.find((r) => r.key === 'work_arrangement').value, 'Hybrid')
  assert.equal(work.find((r) => r.key === 'probation_end_date').value, 'D:2027-02-03')
  assert.equal(work.find((r) => r.key === 'regularization_date').provided, false)
  assert.ok(p.sectionRows('statutory', a.normaliseProfile(full()), fmt).every((r) => r.sensitive === true))
  assert.equal(p.filledSections(a.emptyProfile()), 0)
  assert.equal(p.filledSections(a.normaliseProfile(full())), 5)
})

test('source guard: profile values are rendered as text, never as HTML', () => {
  const files = [...listSrc('modules/peoplemgmt'), ...listSrc('pages'), ...listSrc('api')].filter((f) => /peoplemgmt|MyProfile|profile\.ts$/.test(f))
  assert.ok(files.length > 5)
  for (const f of files) {
    const rel = f.replace(/\\/g, '/').split('/src/')[1]
    assert.ok(!/dangerouslySetInnerHTML|innerHTML/.test(readSrc(rel)), `${rel} must not render raw HTML`)
  }
})

test('birth year: 1900 to (this year - 14), four digits, digit strings accepted, sent as a number, null clears', () => {
  const spec = p.SECTION_FIELDS.personal.find((f) => f.key === 'birth_year')
  assert.equal(spec.hrOnly, true)
  const NOW = new Date(2026, 10, 16)
  assert.equal(p.fieldRuleError(spec, '1995', NOW), null)
  assert.equal(p.fieldRuleError(spec, '1900', NOW), null)
  assert.equal(p.fieldRuleError(spec, '2012', NOW), null)
  assert.match(p.fieldRuleError(spec, '2013', NOW), /between 1900 and 2012/)
  assert.match(p.fieldRuleError(spec, '1899', NOW), /between 1900 and 2012/)
  assert.match(p.fieldRuleError(spec, '95', NOW), /four-digit year/)
  assert.match(p.fieldRuleError(spec, '19x5', NOW), /four-digit year/)
  assert.equal(p.fieldRuleError(spec, '', NOW), null)
  assert.deepEqual(Object.keys(p.validateSection('personal', { ...p.sectionFormFromProfile('personal', a.emptyProfile()), birth_year: '2020' }, NOW)), ['profile.personal.birth_year'])
  assert.equal(l.fieldMessage('profile.personal.birth_year', 'must be between 1900 and 2012'), 'Birth year must be between 1900 and 2012')
  const orig = a.normaliseProfile(full())
  const form = p.sectionFormFromProfile('personal', orig)
  assert.equal(form.birth_year, '1995')
  form.birth_year = '1996'
  assert.deepEqual(p.buildSectionPatch('personal', orig, form), { profile: { personal: { birth_year: 1996 } } })
  form.birth_year = ''
  assert.deepEqual(p.buildSectionPatch('personal', orig, form), { profile: { personal: { birth_year: null } } })
  const create = p.emptyProfileForm()
  create.personal.birth_year = '1990'
  assert.deepEqual(p.buildProfileCreate(create), { personal: { birth_year: 1990 } })
})

test('date of birth: composed from MM-DD and the year when both exist, else the part there is', () => {
  assert.deepEqual(p.dateOfBirth('12-12', '1995'), { label: 'Date of birth', value: '12 Dec 1995' })
  assert.deepEqual(p.dateOfBirth('12-12', ''), { label: 'Birthday', value: '12 Dec' })
  assert.deepEqual(p.dateOfBirth(null, '1995'), { label: 'Birth year', value: '1995' })
  assert.equal(p.dateOfBirth(null, ''), null)
  assert.equal(p.dateOfBirth('13-40', ''), null)
  assert.deepEqual(p.dateOfBirthFromLabel('Dec 12', '1995'), { label: 'Date of birth', value: '12 Dec 1995' })
  assert.deepEqual(p.dateOfBirthFromLabel('Dec 12', null), { label: 'Birthday', value: '12 Dec' })
  assert.deepEqual(p.dateOfBirthFromLabel(null, '1995'), { label: 'Birth year', value: '1995' })
})

test('own edit: the HR-only birth year is left out of the form fields; government IDs start empty and send only what was typed or cleared', () => {
  assert.equal(p.selfFields('personal').some((f) => f.key === 'birth_year'), false)
  assert.equal(p.selfFields('contact').length, p.SECTION_FIELDS.contact.length)
  const empty = p.sectionFormFromProfile('statutory', a.emptyProfile())
  assert.equal(p.buildSelfStatutoryPatch(empty, {}), null, 'nothing typed: nothing sent (the masked value on file stays)')
  assert.deepEqual(p.buildSelfStatutoryPatch({ ...empty, sss: ' 34-1234567-8 ' }, {}), { profile: { statutory: { sss: '34-1234567-8' } } })
  assert.deepEqual(p.buildSelfStatutoryPatch(empty, { tin: true }), { profile: { statutory: { tin: null } } })
  assert.deepEqual(p.buildSelfStatutoryPatch({ ...empty, tin: '999' }, { tin: true, pagibig: false }), { profile: { statutory: { tin: null } } }, 'a cleared key wins over typed text')
})

test('import: the profile columns are listed after the original ones, grouped like the sections; a row error names its column', async () => {
  assert.deepEqual(l.IMPORT_PROFILE_COLUMN_LIST.length, 26)
  assert.deepEqual(l.IMPORT_COLUMNS_REQUIRED, ['name', 'email', 'job_title', 'department', 'employment_type'])
  for (const c of ['birth_year', 'address_line1', 'emergency_phone', 'regularization_date', 'pagibig']) assert.ok(l.IMPORT_PROFILE_COLUMN_LIST.includes(c), c)
  const row = { row: 3, status: 'invalid', reason: 'validation', message: 'x', employee_id: null, field_errors: { mobile: 'must be 7 to 24 characters', tin: 'may only contain digits and hyphens', name: 'is required' } }
  assert.deepEqual(l.rowErrorList(row), ['mobile: must be 7 to 24 characters', 'tin: may only contain digits and hyphens', 'Name is required'])
})
