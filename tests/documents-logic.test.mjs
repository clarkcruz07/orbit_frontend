import test, { before } from 'node:test'
import assert from 'node:assert/strict'
import { loadTs } from './helpers/load-ts.mjs'

let L
before(async () => {
  L = await loadTs('modules/documents/logic.ts')
})

test('tabs: everyone gets My documents and Policies, only the HR role hint adds HR; a forced tab falls back', () => {
  assert.deepEqual(L.visibleTabs(['Employee']), ['mine', 'policies'])
  assert.deepEqual(L.visibleTabs(['Manager']), ['mine', 'policies'])
  assert.deepEqual(L.visibleTabs(['Finance']), ['mine', 'policies'])
  assert.deepEqual(L.visibleTabs(['HRAdmin']), ['mine', 'policies', 'hr'])
  assert.deepEqual(L.visibleTabs(undefined), ['mine', 'policies'])
  assert.equal(L.parseTab('hr', ['mine', 'policies']), 'mine')
  assert.equal(L.parseTab('policies', ['mine', 'policies']), 'policies')
  assert.equal(L.parseTab('nonsense', ['mine', 'policies', 'hr']), 'mine')
  assert.equal(L.parseTab(null, ['mine']), 'mine')
  assert.equal(L.parseSection('coverage'), 'coverage')
  assert.equal(L.parseSection('x'), 'employees')
})

test('expiry badge: expired, expiring, valid and no expiry', () => {
  assert.deepEqual(L.expiryBadge('expired', -12), { tone: 'red', kind: 'expired', label: 'Expired 12 days ago' })
  assert.equal(L.expiryBadge('expired', -1).label, 'Expired 1 day ago')
  assert.equal(L.expiryBadge('expired', null).label, 'Expired')
  assert.deepEqual(L.expiryBadge('expiring', 10), { tone: 'amber', kind: 'expiring', label: 'Expires in 10 days' })
  assert.equal(L.expiryBadge('expiring', 1).label, 'Expires in 1 day')
  assert.equal(L.expiryBadge('expiring', 0).label, 'Expires today')
  assert.equal(L.expiryBadge('expiring', undefined).label, 'Expiring soon')
  assert.deepEqual(L.expiryBadge('valid', 200), { tone: 'green', kind: 'valid', label: 'Valid' })
  assert.deepEqual(L.expiryBadge(null, null), { tone: 'neutral', kind: 'none', label: 'No expiry' })
  assert.equal(L.expiryBadge('something-new', 3).kind, 'none', 'an unknown state is shown neutrally, never as valid')
})

test('expiry summary counts only expired and expiring documents and words them plainly', () => {
  const s = L.summariseExpiry([{ expiry_state: 'expired' }, { expiry_state: 'expiring' }, { expiry_state: 'expiring' }, { expiry_state: 'valid' }, { expiry_state: null }, {}])
  assert.deepEqual(s, { expired: 1, expiring: 2 })
  assert.equal(L.expirySummaryText(s), '1 document expired, 2 documents expiring within 30 days')
  assert.equal(L.expirySummaryText({ expired: 0, expiring: 0 }), null)
  assert.equal(L.expirySummaryText({ expired: 3, expiring: 0 }), '3 documents expired')
})

test('file helpers: sizes, type labels and the advisory hint (never a block)', () => {
  assert.equal(L.formatBytes(0), '0 B')
  assert.equal(L.formatBytes(1536), '1.5 KB')
  assert.equal(L.formatBytes(10 * 1024 * 1024), '10.0 MB')
  assert.equal(L.formatBytes(undefined), '')
  assert.equal(L.typeLabel('application/pdf'), 'PDF')
  assert.equal(L.typeLabel('application/vnd.openxmlformats-officedocument.wordprocessingml.document'), 'DOCX')
  assert.equal(L.typeLabel('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'), 'XLSX')
  assert.equal(L.typeLabel('text/plain'), 'text/plain')
  assert.equal(L.extensionOf('Report.FINAL.PDF'), 'pdf')
  assert.equal(L.extensionOf('noextension'), '')

  assert.equal(L.fileHint(null), null)
  for (const name of ['a.pdf', 'a.PNG', 'a.jpg', 'a.jpeg', 'a.docx', 'a.xlsx']) assert.equal(L.fileHint({ name, size: 1000 }), null, name)
  assert.match(L.fileHint({ name: 'run.exe', size: 1000 }), /not one of the accepted types/)
  assert.match(L.fileHint({ name: 'noext', size: 1000 }), /not one of the accepted types/)
  assert.match(L.fileHint({ name: 'a.pdf', size: 0 }), /looks empty/)
  assert.match(L.fileHint({ name: 'a.pdf', size: 10 * 1024 * 1024 + 1 }), /limit is 10 MB/)
  assert.equal(L.fileHint({ name: 'a.pdf', size: 10 * 1024 * 1024 }), null, 'exactly 10 MB is not over the limit')
  assert.equal(L.FILE_HINT, 'PDF, PNG, JPEG, DOCX or XLSX, up to 10 MB')
})

test('isIsoDate: strict calendar dates in the server range', () => {
  for (const ok of ['2026-11-16', '2000-01-01', '2100-12-31', '2028-02-29']) assert.equal(L.isIsoDate(ok), true, ok)
  for (const bad of ['2026-02-30', '2027-02-29', '1999-12-31', '2101-01-01', '16/11/2026', '2026-1-1', '', '2026-13-01', '2026-11-16T10:00']) assert.equal(L.isIsoDate(bad), false, bad)
})

test('validateUpload: type, title, expiry (required by the type) and file', () => {
  const file = { name: 'a.pdf' }
  assert.deepEqual(L.validateUpload({ typeId: 't1', title: 'Passport', expiresOn: '', expiryRequired: false, file }), {})
  assert.deepEqual(L.validateUpload({ typeId: 't1', title: 'Passport', expiresOn: '2027-01-01', expiryRequired: true, file }), {})
  assert.deepEqual(Object.keys(L.validateUpload({ typeId: '', title: '  ', expiresOn: '', expiryRequired: false, file: null })).sort(), ['file', 'title', 'type'])
  assert.match(L.validateUpload({ typeId: 't1', title: 'x', expiresOn: '', expiryRequired: true, file }).expires_on, /needs an expiry date/)
  assert.match(L.validateUpload({ typeId: 't1', title: 'x', expiresOn: '2026-02-30', expiryRequired: false, file }).expires_on, /valid expiry date/)
  assert.match(L.validateUpload({ typeId: 't1', title: 'x'.repeat(121), expiresOn: '', expiryRequired: false, file }).title, /at most 120/)
  assert.deepEqual(L.validateUpload({ typeId: 't1', title: 'x'.repeat(120), expiresOn: '', expiryRequired: false, file }), {})
})

test('validateVersion: a new version needs its own expiry date when the type requires one', () => {
  const file = { name: 'a.pdf' }
  assert.deepEqual(L.validateVersion({ expiresOn: '', expiryRequired: false, file }), {})
  assert.match(L.validateVersion({ expiresOn: '', expiryRequired: true, file }).expires_on, /needs an expiry date for the new version/)
  assert.match(L.validateVersion({ expiresOn: '', expiryRequired: false, file: null }).file, /Choose the new file/)
})

test('validatePolicy: title (optional for a new version), effective date, summary length and file', () => {
  const file = { name: 'p.pdf' }
  assert.deepEqual(L.validatePolicy({ title: 'Remote work', summary: '', effectiveDate: '2026-12-01', file }), {})
  assert.equal(L.validatePolicy({ title: '', summary: '', effectiveDate: '2026-12-01', file }).title, 'Enter a title.')
  assert.deepEqual(L.validatePolicy({ title: '', summary: '', effectiveDate: '2026-12-01', file, titleOptional: true }), {})
  assert.match(L.validatePolicy({ title: 'x', summary: 'y'.repeat(1001), effectiveDate: '2026-12-01', file }).summary, /at most 1000/)
  assert.equal(L.validatePolicy({ title: 'x', summary: '', effectiveDate: '', file }).effective_date, 'Enter the effective date.')
  assert.match(L.validatePolicy({ title: 'x', summary: '', effectiveDate: '2026-02-31', file }).effective_date, /valid effective date/)
  assert.match(L.validatePolicy({ title: 'x', summary: '', effectiveDate: '2026-12-01', file: null }).file, /Choose the policy file/)
})

test('validateTypeName', () => {
  assert.equal(L.validateTypeName('  '), 'Enter a name.')
  assert.equal(L.validateTypeName('x'.repeat(61)), 'The name can be at most 60 characters.')
  assert.equal(L.validateTypeName('Visa'), null)
})

test('parseServerError: only short client-safe text is shown; 422 field errors map by their last location segment', () => {
  assert.deepEqual(L.parseServerError({ response: { status: 404, data: { detail: 'Document not found' } } }), { status: 404, detail: 'Document not found', fieldErrors: {} })
  assert.equal(L.parseServerError({ response: { status: 500, data: { detail: 'x'.repeat(400) } } }, 'fallback').detail, 'fallback')
  assert.equal(L.parseServerError({ response: { status: 500, data: { detail: { not: 'a string' } } } }, 'fallback').detail, 'fallback')
  assert.equal(L.parseServerError({ response: { status: 502, data: '<html>' } }, 'fallback').detail, 'fallback')
  const net = L.parseServerError(new Error('Network Error'))
  assert.equal(net.status, null)
  assert.match(net.detail, /could not be reached/)
  const v = L.parseServerError({ response: { status: 422, data: { detail: 'Invalid request', errors: [{ loc: ['body', 'title'], msg: 'String should have at least 1 character' }, { loc: ['body', 'title'], msg: 'second' }] } } })
  assert.deepEqual(v.fieldErrors, { title: 'String should have at least 1 character' })
  assert.equal(v.detail, 'Please check the highlighted fields.')
})

test('uploadErrorText: file failures always say nothing was stored; a 403 does not', () => {
  const e = (status, detail) => ({ response: { status, data: { detail } } })
  assert.match(L.uploadErrorText(e(413, 'The file is too large (maximum 10 MB)')), /too large \(the limit is 10 MB\)\. Nothing was stored\./)
  assert.equal(L.uploadErrorText(e(415, 'Unsupported file. Upload a PDF, PNG, JPEG, DOCX or XLSX file.')), 'Unsupported file. Upload a PDF, PNG, JPEG, DOCX or XLSX file. Nothing was stored.')
  assert.equal(L.uploadErrorText(e(400, 'The file is empty')), 'The file is empty Nothing was stored.')
  assert.match(L.uploadErrorText(e(422, 'Unknown document type')), /Nothing was stored/)
  assert.match(L.uploadErrorText(new Error('Network Error')), /Nothing was stored/)
  assert.equal(L.uploadErrorText(e(403, 'You do not have access to this resource')), 'You do not have access to this resource')
})

test('misc formatting: percentages, ranges, page counts, action checks and the policy deep link', () => {
  assert.equal(L.formatPct(96), '96%')
  assert.equal(L.formatPct(66.666), '66.7%')
  assert.equal(L.formatPct(0), '0%')
  assert.equal(L.formatPct(null), 'No data')
  assert.equal(L.rangeText(1, 20, 0), '0 results')
  assert.equal(L.rangeText(1, 20, 45), '1-20 of 45')
  assert.equal(L.rangeText(3, 20, 45), '41-45 of 45')
  assert.equal(L.pageCount(0, 20), 1)
  assert.equal(L.pageCount(41, 20), 3)
  assert.equal(L.hasAction(['download', 'edit'], 'edit'), true)
  assert.equal(L.hasAction([], 'edit'), false)
  assert.equal(L.hasAction(undefined, 'edit'), false)
  assert.equal(L.policyLink('abc-123'), '/documents/policies/abc-123')
  assert.equal(L.policyLink('a/b'), '/documents/policies/a%2Fb')
  assert.equal(L.formatDate('2026-11-16'), '16 Nov 2026')
  assert.equal(L.formatDateTime(null), '-')
  assert.match(L.PRIVACY_NOTE, /Managers do not see them/)
  assert.equal(L.PLACEHOLDER_LABEL, undefined)
})
