import test, { before } from 'node:test'
import assert from 'node:assert/strict'
import { loadTs } from './helpers/load-ts.mjs'

let L
before(async () => {
  L = await loadTs('pages/reimbursements/logic.ts')
})

const field = (over = {}) => ({ value: null, source: 'empty', extracted_value: null, confidence: null, flag: null, ...over })
const FIELDS = (over = {}) => ({
  merchant: field(),
  receipt_date: field(),
  currency: field(),
  total_amount: field(),
  tax_amount: field(),
  receipt_reference: field(),
  ...over,
})

// ---------------------------------------------------------------------------------------------------- status labels
test('every workflow status has a label, a tone and a hint', () => {
  const statuses = ['draft', 'pending_manager', 'pending_finance', 'approved', 'rejected', 'clarification_requested']
  assert.deepEqual([...L.STATUS_ORDER].sort(), [...statuses].sort())
  assert.deepEqual(statuses.map(L.statusLabel), ['Draft', 'Pending manager', 'Pending finance', 'Approved', 'Rejected', 'Clarification requested'])
  for (const s of statuses) {
    assert.ok(L.statusHint(s).length > 0, s)
    assert.ok(['neutral', 'blue', 'amber', 'violet', 'green', 'red'].includes(L.statusTone(s)), s)
  }
  assert.match(L.statusHint('approved'), /nothing is paid or posted/i)
  assert.equal(L.statusLabel('mystery'), 'mystery', 'unknown statuses are shown as-is, never hidden')
  assert.equal(L.statusTone('mystery'), 'neutral')
})

test('countByStatus counts known statuses and ignores unknown ones', () => {
  const c = L.countByStatus([{ status: 'draft' }, { status: 'draft' }, { status: 'approved' }, { status: 'weird' }])
  assert.deepEqual(c, { draft: 2, clarification_requested: 0, pending_manager: 0, pending_finance: 0, approved: 1, rejected: 0 })
})

// ---------------------------------------------------------------------------------------------------- scopes
test('availableScopes: navigation hint mirrors the backend list scopes', () => {
  assert.deepEqual(L.availableScopes(['Employee']), ['mine'])
  assert.deepEqual(L.availableScopes(['Manager']), ['mine', 'review', 'all'])
  assert.deepEqual(L.availableScopes(['Finance']), ['mine', 'review', 'all'])
  assert.deepEqual(L.availableScopes(['HRAdmin']), ['mine', 'all'])
  assert.deepEqual(L.availableScopes(['Employee', 'Manager']), ['mine', 'review', 'all'])
  assert.deepEqual(L.availableScopes(undefined), ['mine'])
  assert.deepEqual(L.availableScopes([]), ['mine'])
})

test('parseScope only accepts offered scopes (a URL cannot unlock a tab)', () => {
  assert.equal(L.parseScope('review', ['mine']), 'mine')
  assert.equal(L.parseScope('review', ['mine', 'review']), 'review')
  assert.equal(L.parseScope('all', ['mine', 'all']), 'all')
  assert.equal(L.parseScope(null, ['mine', 'all']), 'mine')
  assert.equal(L.parseScope('bogus', ['mine', 'all']), 'mine')
})

// ---------------------------------------------------------------------------------------------------- provenance
test('sourceLabel: the four provenance badges; "Not found" only once an extraction exists', () => {
  assert.equal(L.sourceLabel('extracted', true), 'Extracted')
  assert.equal(L.sourceLabel('edited', true), 'Edited by you')
  assert.equal(L.sourceLabel('entered', true), 'Entered by you')
  assert.equal(L.sourceLabel('empty', true), 'Not found')
  assert.equal(L.sourceLabel('empty', false), 'Not entered')
  assert.equal(L.sourceLabelForReviewer('edited'), 'Edited by employee')
  assert.equal(L.sourceLabelForReviewer('entered'), 'Entered by employee')
  assert.equal(L.sourceLabelForReviewer('extracted'), 'Extracted')
  assert.equal(L.sourceLabelForReviewer('empty'), 'Empty')
})

test('liveSource: the badge follows the text in the box, using the preserved extracted value', () => {
  const f = field({ value: '1250.00', source: 'extracted', extracted_value: '1250.00', confidence: 0.98 })
  assert.equal(L.liveSource('total_amount', '1250.00', f), 'extracted')
  assert.equal(L.liveSource('total_amount', '1,250', f), 'extracted', 'same number, different formatting')
  assert.equal(L.liveSource('total_amount', '1300', f), 'edited')
  assert.equal(L.liveSource('total_amount', '', f), 'edited', 'clearing an extracted value is an edit')
  const none = field()
  assert.equal(L.liveSource('merchant', '', none), 'empty')
  assert.equal(L.liveSource('merchant', 'Typed', none), 'entered')
  const cur = field({ value: 'PHP', extracted_value: 'PHP', source: 'extracted' })
  assert.equal(L.liveSource('currency', 'php', cur), 'extracted', 'currency compare is case-insensitive')
})

test('low confidence: below 0.7 only; null is not "low"; label shows a percentage', () => {
  assert.equal(L.isLowConfidence(0.41), true)
  assert.equal(L.isLowConfidence(0.69), true)
  assert.equal(L.isLowConfidence(0.7), false)
  assert.equal(L.isLowConfidence(0.98), false)
  assert.equal(L.isLowConfidence(null), false)
  assert.equal(L.isLowConfidence(undefined), false)
  assert.equal(L.confidenceLabel(0.41), '41% confidence')
  assert.equal(L.confidenceLabel(null), 'No confidence reported')
})

test('flagText maps every backend flag to friendly text; unknown flags still say something honest', () => {
  for (const flag of ['invalid_merchant', 'invalid_date', 'date_out_of_range', 'invalid_amount', 'invalid_tax', 'tax_exceeds_total', 'invalid_currency', 'invalid_reference']) {
    assert.ok(L.flagText(flag) && !L.flagText(flag).includes('_'), flag)
  }
  assert.equal(L.flagText(null), null)
  assert.equal(L.flagText('brand_new_flag'), 'The extracted value was not accepted.')
})

// ---------------------------------------------------------------------------------------------------- error-code map
test('every documented extraction error_code has friendly text without the raw code', () => {
  const codes = ['unsupported_file', 'unreadable_receipt', 'invalid_model_output', 'provider_timeout', 'provider_rate_limited', 'provider_unavailable', 'provider_not_configured', 'extraction_disabled']
  const seen = new Set()
  for (const code of codes) {
    const t = L.extractionErrorText(code)
    assert.ok(t.length > 20, code)
    assert.ok(!t.includes(code) && !/_/.test(t), `${code}: ${t}`)
    seen.add(t)
  }
  assert.equal(seen.size, codes.length, 'each code has its own message')
  assert.equal(L.extractionErrorText(null), "We couldn't read this receipt automatically.")
  assert.equal(L.extractionErrorText('something_new'), "We couldn't read this receipt automatically.")
  assert.match(L.MANUAL_ENTRY_TEXT, /type the details yourself/)
})

// ---------------------------------------------------------------------------------------------------- decisions / audit
test('decision and audit labels', () => {
  assert.equal(L.decisionLabel('approve'), 'Approved')
  assert.equal(L.decisionLabel('reject'), 'Rejected')
  assert.equal(L.decisionLabel('clarify'), 'Asked for clarification')
  assert.equal(L.stageLabel('manager'), 'Manager review')
  assert.equal(L.stageLabel('finance'), 'Finance review')
  assert.equal(L.stageLabel(null), '')
  assert.equal(L.auditLabel({ action: 'reimbursement.created' }), 'Draft created')
  assert.equal(L.auditLabel({ action: 'reimbursement.decided', details: { action: 'approve', stage: 'manager' } }), 'Approved (Manager review)')
  assert.equal(L.auditLabel({ action: 'reimbursement.decided', details: { action: 'clarify', stage: 'finance' } }), 'Asked for clarification (Finance review)')
  assert.equal(L.auditLabel({ action: 'reimbursement.submitted', details: { to_status: 'pending_finance' } }), 'Submitted - now pending finance')
  assert.equal(L.auditLabel({ action: 'reimbursement.submitted' }), 'Submitted for review')
  assert.equal(L.auditLabel({ action: 'something.else' }), 'something.else')
})

// ---------------------------------------------------------------------------------------------------- formatting
test('formatMoney / formatDate / formatBytes / uploadHint', () => {
  assert.equal(L.formatMoney('PHP', '1250.00'), 'PHP 1,250.00')
  assert.equal(L.formatMoney(null, '1250'), '1,250.00')
  assert.equal(L.formatMoney('PHP', null), '-')
  assert.equal(L.formatMoney('PHP', ''), '-')
  assert.equal(L.formatMoney('PHP', 'abc'), 'abc')
  assert.equal(L.formatDate('2026-10-12'), '12 Oct 2026')
  assert.equal(L.formatDate(null), '-')
  assert.equal(L.formatDate('not a date'), 'not a date')
  assert.equal(L.formatBytes(500), '500 B')
  assert.equal(L.formatBytes(2048), '2.0 KB')
  assert.equal(L.formatBytes(5 * 1024 * 1024), '5.0 MB')
  assert.equal(L.uploadHint(['application/pdf', 'image/png', 'image/jpeg'], 10), 'PNG, JPEG or PDF, up to 10 MB')
  assert.equal(L.uploadHint(['application/pdf', 'image/png', 'image/jpeg', 'image/webp'], 10), 'PNG, JPEG, WebP or PDF, up to 10 MB')
  assert.equal(L.uploadHint(['image/png'], 5), 'PNG, up to 5 MB')
})

// ---------------------------------------------------------------------------------------------------- validation
test('validateMoney mirrors the server rules', () => {
  for (const ok of ['', '0', '1250', '1250.5', '1250.50', '1,250.50', '9,999,999.99', '12']) assert.equal(L.validateMoney(ok), null, ok)
  for (const bad of ['12.345', '-5', '1e3', 'abc', '1,25', '1,2345.00', '$12', '10000000', '9999999.995', '.5', '1..2', 'NaN']) assert.ok(L.validateMoney(bad), bad)
  assert.equal(L.parseMoney('1,250.50'), 1250.5)
  assert.equal(L.parseMoney('abc'), null)
  assert.equal(L.parseMoney(''), null)
})

test('validateDate: ISO only, 2000-01-01 .. tomorrow', () => {
  const today = new Date(2026, 10, 16)
  assert.equal(L.validateDate('', today), null)
  assert.equal(L.validateDate('2026-10-12', today), null)
  assert.equal(L.validateDate('2026-11-17', today), null, 'tomorrow is allowed')
  assert.match(L.validateDate('2026-11-18', today), /future/)
  assert.match(L.validateDate('1999-12-31', today), /2000/)
  assert.match(L.validateDate('2026-02-30', today), /valid date/)
  assert.match(L.validateDate('12/10/2026', today), /valid date/)
  assert.equal(L.isValidIsoDate('2024-02-29'), true)
  assert.equal(L.isValidIsoDate('2023-02-29'), false)
})

test('validateField: merchant, currency allow-list, reference charset', () => {
  assert.equal(L.validateField('merchant', 'Cafe Lumina'), null)
  assert.ok(L.validateField('merchant', 'x'.repeat(121)))
  assert.equal(L.validateField('currency', 'php', ['PHP', 'USD']), null)
  assert.ok(L.validateField('currency', 'XYZ', ['PHP', 'USD']))
  assert.equal(L.validateField('currency', 'XYZ', []), null, 'no list loaded: no client check')
  assert.equal(L.validateField('receipt_reference', 'SYN-0001'), null)
  assert.equal(L.validateField('receipt_reference', 'A/B#1.2_3'), null)
  assert.ok(L.validateField('receipt_reference', '-leading'))
  assert.ok(L.validateField('receipt_reference', 'has<script>'))
  assert.ok(L.validateField('receipt_reference', 'a'.repeat(65)))
  assert.equal(L.validateField('tax_amount', ''), null, 'empty is never an error here (required is checked on submit)')
})

test('validateForm: collects errors per field and catches tax larger than total', () => {
  const texts = { merchant: 'Cafe', receipt_date: '2026-10-12', currency: 'PHP', total_amount: '100', tax_amount: '200', receipt_reference: '' }
  assert.deepEqual(L.validateForm(texts, ['PHP'], new Date(2026, 10, 16)), { tax_amount: 'The tax amount is larger than the total.' })
  assert.deepEqual(L.validateForm({ ...texts, tax_amount: '10' }, ['PHP'], new Date(2026, 10, 16)), {})
  const bad = L.validateForm({ ...texts, total_amount: '1.234', receipt_date: '2999-01-01' }, ['PHP'], new Date(2026, 10, 16))
  assert.deepEqual(Object.keys(bad).sort(), ['receipt_date', 'total_amount'])
})

test('missingRequired lists only the four required fields', () => {
  const empty = { merchant: '', receipt_date: '', currency: '', total_amount: '', tax_amount: '', receipt_reference: '' }
  assert.deepEqual(L.missingRequired(empty), ['merchant', 'receipt_date', 'currency', 'total_amount'])
  assert.deepEqual(L.missingRequired({ ...empty, merchant: 'x', receipt_date: '2026-10-12', currency: 'PHP', total_amount: '1' }), [])
  assert.deepEqual(L.missingRequired({ ...empty, merchant: '   ' }), ['merchant', 'receipt_date', 'currency', 'total_amount'])
})

// ---------------------------------------------------------------------------------------------------- form <-> server
test('textsFromFields never invents values: nulls become empty strings', () => {
  const t = L.textsFromFields(FIELDS({ merchant: field({ value: 'Cafe', source: 'extracted', extracted_value: 'Cafe' }) }))
  assert.deepEqual(t, { merchant: 'Cafe', receipt_date: '', currency: '', total_amount: '', tax_amount: '', receipt_reference: '' })
})

test('buildFieldsPatch sends only changed fields and null for cleared ones', () => {
  const saved = { merchant: 'Cafe', receipt_date: '2026-10-12', currency: 'PHP', total_amount: '1250.00', tax_amount: '133.93', receipt_reference: '' }
  assert.deepEqual(L.buildFieldsPatch(saved, saved), {})
  assert.deepEqual(L.buildFieldsPatch({ ...saved, merchant: ' Cafe 2 ', tax_amount: '', receipt_reference: 'R1' }, saved), { merchant: 'Cafe 2', tax_amount: null, receipt_reference: 'R1' })
})

// ---------------------------------------------------------------------------------------------------- server errors
test('parseServerError: detail, field_errors, missing_fields, confirm_required; never raw network text', () => {
  const e = (status, data) => ({ response: { status, data } })
  assert.deepEqual(L.parseServerError(e(422, { detail: 'Some values are not valid', field_errors: { receipt_date: 'Bad date', x: 5 } })), {
    status: 422,
    detail: 'Some values are not valid',
    fieldErrors: { receipt_date: 'Bad date' },
    missingFields: [],
    confirmRequired: false,
  })
  const s = L.parseServerError(e(422, { detail: 'Missing or invalid: a', missing_fields: ['merchant', 5, 'receipt'], confirm_required: true }))
  assert.deepEqual(s.missingFields, ['merchant', 'receipt'])
  assert.equal(s.confirmRequired, true)
  assert.equal(L.parseServerError(e(409, { detail: 'x'.repeat(400) }), 'fallback').detail, 'fallback', 'overlong detail is not shown')
  assert.equal(L.parseServerError({ message: 'Network Error: ECONNREFUSED 127.0.0.1' }, 'Try again later').detail, 'Try again later')
  assert.equal(L.parseServerError({ message: 'Network Error' }).status, null)
  assert.equal(L.parseServerError(null).detail, 'Something went wrong. Please try again.')
  assert.equal(L.parseServerError(e(422, { detail: 'Invalid request', errors: [{ loc: ['body'], msg: 'm' }] })).detail, 'Invalid request')
})

// ---------------------------------------------------------------------------------------------------- modes come only from allowed_actions
test('editor/reviewer mode is derived only from allowed_actions', () => {
  assert.equal(L.isEditorMode(['edit', 'upload', 'submit']), true)
  assert.equal(L.isEditorMode(['upload']), true)
  assert.equal(L.isEditorMode(['approve', 'reject', 'clarify']), false)
  assert.equal(L.isEditorMode([]), false)
  assert.equal(L.isEditorMode(undefined), false)
  assert.equal(L.isReviewerMode(['approve', 'reject', 'clarify']), true)
  assert.equal(L.isReviewerMode(['clarify']), true)
  assert.equal(L.isReviewerMode(['edit', 'upload', 'submit']), false)
  assert.equal(L.isReviewerMode([]), false)
  assert.equal(L.hasAction(['approve'], 'approve'), true)
  assert.equal(L.hasAction(['approve'], 'reject'), false)
  assert.equal(L.hasAction(undefined, 'approve'), false)
})
