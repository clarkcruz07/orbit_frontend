import test, { before } from 'node:test'
import assert from 'node:assert/strict'
import { loadTs } from './helpers/load-ts.mjs'
import { readSrc } from './helpers/load-ts.mjs'

let m
let nav
before(async () => {
  m = await loadTs('modules/performance/probationLogic.ts')
  nav = await loadTs('modules/performance/logic.ts')
})

const KEYS = ['role', 'quality', 'productivity', 'problem_solving', 'learning', 'communication', 'teamwork', 'reliability', 'initiative']

const evaluation = (over = {}) =>
  m.normaliseEvaluation({
    evaluation_id: 'e1',
    status: 'draft',
    employee: { employee_id: 'EMP-0003', name: 'Carla Dizon', position: 'Compliance Analyst', department: 'Compliance' },
    manager: { employee_id: 'EMP-0002', name: 'Ben Cruz' },
    evaluator: { user_id: 'u-ben', name: 'Ben Cruz' },
    review_date: '2026-11-16',
    ratings: {},
    can_edit: true,
    can_submit: true,
    ...over,
  })

const complete = () => {
  const d = m.toDraft(evaluation(), KEYS)
  for (const k of KEYS) d.ratings[k] = { rating: 4, comments: '' }
  d.strengths = 'Reliable and quick to learn.'
  d.summary = 'Ready for regular employment.'
  d.recommendation = 'confirm'
  return d
}

test('the Probation Evaluation tab: right after HR overview for HR, after Team for managers, never for others', () => {
  const hr = nav.performanceTabs(['HRAdmin'])
  assert.equal(hr[hr.indexOf('overview') + 1], 'probation')
  assert.deepEqual(nav.performanceTabs(['Manager']), ['goals', 'checkins', 'team', 'probation'])
  assert.deepEqual(nav.performanceTabs(['Employee']), ['goals', 'checkins'])
  assert.deepEqual(nav.performanceTabs(['Finance']), ['goals', 'checkins'])
  assert.deepEqual(nav.performanceTabs(undefined), ['goals', 'checkins'])
  assert.equal(nav.TAB_LABEL.probation, 'Probation Evaluation')
  assert.equal(nav.parseTab('probation', hr), 'probation')
  assert.equal(nav.parseTab('probation', ['goals', 'checkins']), 'goals', 'a forced tab falls back for people who are not offered it')
})

test('the paper form: nine criteria with five bullets each, five ratings, three recommendations', () => {
  const f = m.DEFAULT_FORM
  assert.equal(f.criteria.length, 9)
  assert.deepEqual(f.criteria.map((c) => c.key), KEYS)
  assert.ok(f.criteria.every((c, i) => c.number === i + 1 && c.bullets.length === 5))
  assert.deepEqual(f.rating_guide.map((g) => g.rating), [5, 4, 3, 2, 1])
  assert.deepEqual(f.recommendations.map((r) => r.value), ['confirm', 'extend', 'not_confirm'])
  assert.equal(m.ratingFull(4), '4 - Meets Expectations')
  assert.equal(m.ratingShort(2), 'Needs work')
})

test('average: mean of the ratings given so far to one decimal, null when none', () => {
  assert.equal(m.averageRating({}, KEYS), null)
  assert.equal(m.averageRating({ role: { rating: 5 }, quality: { rating: 4 } }, KEYS), 4.5)
  assert.equal(m.averageRating({ role: { rating: 5 }, quality: { rating: 4 }, productivity: { rating: 4 } }, KEYS), 4.3)
  assert.equal(m.averageRating({ role: { rating: null }, quality: { rating: 0 }, productivity: { rating: 6 }, learning: { rating: 3 } }, KEYS), 3, 'only 1..5 whole numbers count')
  assert.equal(m.ratedCount({ role: { rating: 5 }, quality: { rating: null }, learning: { rating: 2 } }, KEYS), 2)
  assert.equal(m.formatAverage(4), '4.0')
  assert.equal(m.formatAverage(null), '-')
})

test('completeness: review date, nine ratings, strengths, a summary and a recommendation (as the server requires); extending also needs reasons, objectives and a date', () => {
  const empty = m.toDraft(evaluation(), KEYS)
  assert.deepEqual(m.missingFields(empty, KEYS), [...KEYS.map((k) => `ratings.${k}`), 'strengths', 'summary', 'recommendation'])
  const ok = complete()
  assert.deepEqual(m.missingFields(ok, KEYS), [])
  ok.recommendation = 'extend'
  assert.deepEqual(m.missingFields(ok, KEYS), ['extension.reasons', 'extension.objectives', 'extension.review_date'])
  ok.extension = { reasons: 'Needs more time on quality.', objectives: 'Fewer errors.', review_date: '2027-02-01' }
  assert.deepEqual(m.missingFields(ok, KEYS), [])
  ok.ratings.quality.rating = null
  ok.summary = '   '
  assert.deepEqual(m.missingFields(ok, KEYS), ['ratings.quality', 'summary'])
})

test('missing keys get human labels and an anchor to scroll to; the checklist can tell what is filled now', () => {
  const c = m.DEFAULT_FORM.criteria
  assert.equal(m.missingLabel('ratings.quality', c), '2. Quality of Work: rating')
  assert.equal(m.missingLabel('summary', c), 'Overall performance summary')
  assert.equal(m.missingLabel('extension.review_date', c), 'Extension: proposed review date')
  assert.equal(m.missingLabel('some.new_key', c), 'some new key')
  assert.equal(m.anchorId('ratings.problem_solving'), 'eval-rating-problem_solving')
  assert.equal(m.anchorId('extension.reasons'), 'eval-ext-reasons')
  assert.equal(m.anchorId('summary'), 'eval-summary')
  assert.equal(m.anchorId('development_rows'), 'eval-development')
  assert.equal(m.anchorId('recommendation'), 'eval-recommendation')
  const d = complete()
  assert.equal(m.isFieldFilled(d, 'ratings.quality'), true)
  assert.equal(m.isFieldFilled(d, 'strengths'), true)
  d.strengths = '  '
  assert.equal(m.isFieldFilled(d, 'strengths'), false)
  assert.equal(m.isFieldFilled(d, 'unknown.key'), false)
})

test('the server missing list: only from a 422, strings only, de-duplicated', () => {
  const err = (status, data) => ({ response: { status, data } })
  assert.deepEqual(m.missingFromError(err(422, { code: 'incomplete', details: { missing: ['ratings.quality', 'summary', 'summary', 5] } })), ['ratings.quality', 'summary'])
  assert.deepEqual(m.missingFromError(err(422, { missing: ['summary'] })), ['summary'])
  assert.equal(m.missingFromError(err(409, { details: { missing: ['summary'] } })), null)
  assert.equal(m.missingFromError(err(422, { detail: 'Invalid' })), null)
  assert.equal(m.missingFromError(null), null)
})

test('PATCH diff: only what changed, ratings per criterion, empty development rows left out, null when nothing changed', () => {
  const saved = m.toDraft(evaluation(), KEYS)
  assert.equal(m.diffDraft(saved, structuredClone(saved), KEYS), null)
  assert.equal(m.isDirty(saved, structuredClone(saved), KEYS), false)

  const now = structuredClone(saved)
  now.ratings.quality = { rating: 5, comments: '  Very accurate.  ' }
  now.strengths = ' Reliable '
  now.review_date = '2026-12-01'
  assert.deepEqual(m.diffDraft(saved, now, KEYS), {
    review_date: '2026-12-01',
    ratings: { quality: { rating: 5, comments: 'Very accurate.' } },
    strengths: 'Reliable',
  })

  const blankRow = structuredClone(saved)
  blankRow.development_rows = [{ area: '', actions: ' ', target_completion: '' }]
  assert.equal(m.diffDraft(saved, blankRow, KEYS), null, 'a blank row is not a change')
  const rows = structuredClone(saved)
  rows.development_rows = [{ area: ' Reports ', actions: 'Course', target_completion: '2027-01-31' }, { area: '', actions: '', target_completion: '' }]
  assert.deepEqual(m.diffDraft(saved, rows, KEYS), { development_rows: [{ area: 'Reports', actions: 'Course', target_completion: '2027-01-31' }] })

  const ext = structuredClone(saved)
  ext.recommendation = 'extend'
  ext.extension = { reasons: 'More time', objectives: 'Goal', review_date: '2027-03-01' }
  assert.deepEqual(m.diffDraft(saved, ext, KEYS), { recommendation: 'extend', extension: { reasons: 'More time', objectives: 'Goal', review_date: '2027-03-01' } })

  const cleared = structuredClone(m.toDraft(evaluation({ review_date: '2026-11-16' }), KEYS))
  cleared.review_date = ''
  assert.deepEqual(m.diffDraft(m.toDraft(evaluation(), KEYS), cleared, KEYS), { review_date: null })
})

test('development rows: add up to the limit, remove, edit one cell', () => {
  let rows = []
  rows = m.addDevRow(rows, 2)
  rows = m.addDevRow(rows, 2)
  assert.equal(rows.length, 2)
  assert.equal(m.addDevRow(rows, 2).length, 2, 'the limit holds')
  rows = m.setDevRow(rows, 1, 'area', 'Reports')
  assert.deepEqual(rows[1], { area: 'Reports', actions: '', target_completion: '' })
  assert.deepEqual(rows[0], m.emptyRow())
  rows = m.removeDevRow(rows, 0)
  assert.deepEqual(rows, [{ area: 'Reports', actions: '', target_completion: '' }])
  assert.deepEqual(m.removeDevRow(rows, 5), rows)
  assert.equal(m.cleanRows([m.emptyRow(), { area: ' x ', actions: '', target_completion: '' }]).length, 1)
})

test('validation: lengths from the server limits, control characters, whole-number ratings, real dates, row limit', () => {
  const lim = { comment_max: 20, dev_rows_max: 2, cell_max: 5 }
  const d = m.toDraft(evaluation(), KEYS)
  assert.deepEqual(m.validateDraft(d, KEYS, lim), {})
  d.strengths = 'x'.repeat(21)
  d.summary = 'bad\u0007text'
  d.ratings.quality = { rating: 7, comments: 'y'.repeat(21) }
  d.review_date = '2026-02-31'
  d.development_rows = [{ area: 'toolong', actions: '', target_completion: '' }, m.emptyRow(), m.emptyRow()]
  d.extension = { reasons: '', objectives: '', review_date: 'nope' }
  const e = m.validateDraft(d, KEYS, lim)
  assert.match(e.strengths, /at most 20/)
  assert.match(e.summary, /not allowed/)
  assert.match(e['ratings.quality'], /1 to 5/)
  assert.match(e['comments.quality'], /at most 20/)
  assert.match(e.review_date, /valid date/)
  assert.match(e['development_rows.0.area'], /at most 5/)
  assert.match(e.development_rows, /Up to 2/)
  assert.match(e['extension.review_date'], /valid date/)
})

test('server field errors are mapped onto the form keys (a criterion name means its comments)', () => {
  const out = m.serverFieldErrors({ fieldErrors: { quality: 'Too long', strengths: 'Bad', empty: '' } }, KEYS)
  assert.deepEqual(out, { 'comments.quality': 'Too long', strengths: 'Bad' })
})

test('normalisers: defensive about shape, keep every criterion, clamp ratings, safe defaults', () => {
  const ev = m.normaliseEvaluation({ evaluation_id: 'e9', status: 'weird', ratings: { quality: { rating: 9, comments: 5 }, role: { rating: 3, comments: 'ok' } }, development_rows: [{ area: 'A' }, 7], recommendation: 'nope', can_edit: 'yes' })
  assert.equal(ev.status, 'draft')
  assert.equal(ev.ratings.quality.rating, null)
  assert.equal(ev.ratings.quality.comments, '')
  assert.equal(ev.ratings.role.rating, 3)
  assert.equal(Object.keys(ev.ratings).length, 9)
  assert.deepEqual(ev.development_rows[0], { area: 'A', actions: '', target_completion: '' })
  assert.equal(ev.recommendation, null)
  assert.equal(ev.can_edit, false, 'only a real true enables an action')
  const item = m.normaliseListItem({ evaluation_id: 'e1', employee: { employee_id: 'E', name: 'N', job_title: 'Analyst' }, status: 'submitted', recommendation: 'extend', average: 3.5 })
  assert.equal(item.employee.position, 'Analyst')
  assert.equal(item.recommendation, 'extend')
  assert.equal(item.average, 3.5)
  const eligible = m.normaliseEligible({ items: [{ employee_id: 'E1', name: 'Zed' }, { name: 'no id' }, { employee_id: 'E2' }] })
  assert.deepEqual(eligible.map((e) => [e.employee_id, e.name]), [['E1', 'Zed'], ['E2', 'E2']])
  const form = m.normaliseFormDef({ criteria: [], limits: { comment_max: -1, dev_rows_max: 4 } })
  assert.equal(form.criteria.length, 9, 'an unusable server copy falls back to the company wording')
  assert.equal(form.limits.comment_max, 2000)
  assert.equal(form.limits.dev_rows_max, 4)
})

test('labels and tones: status and recommendation never rely on colour alone (each has its own words)', () => {
  assert.equal(m.statusLabel('draft'), 'Draft')
  assert.equal(m.statusLabel('submitted'), 'Submitted')
  assert.equal(m.statusTone('submitted'), 'green')
  assert.equal(m.recommendationLabel('confirm'), 'Confirm employment')
  assert.equal(m.recommendationLabel('extend'), 'Extend probation')
  assert.equal(m.recommendationLabel('not_confirm'), 'Do not confirm')
  assert.equal(m.recommendationLabel(null), 'No recommendation yet')
  assert.deepEqual(['confirm', 'extend', 'not_confirm'].map(m.recommendationTone), ['green', 'amber', 'red'])
  const labels = ['confirm', 'extend', 'not_confirm'].map(m.recommendationLabel)
  assert.equal(new Set(labels).size, 3)
})

test('file name from Content-Disposition: filename* wins, made safe, always .pdf, fallback when absent', () => {
  assert.equal(m.filenameFromDisposition(`attachment; filename="Probation Evaluation - Carla Dizon.pdf"`), 'Probation Evaluation - Carla Dizon.pdf')
  assert.equal(m.filenameFromDisposition(`attachment; filename="x.pdf"; filename*=UTF-8''Probation%20Ma%C3%B1o.pdf`), 'Probation Maño.pdf')
  assert.equal(m.filenameFromDisposition('attachment; filename=plain'), 'plain.pdf')
  assert.equal(m.filenameFromDisposition('attachment; filename="../../etc/passwd"'), '.._.._etc_passwd.pdf'.replace(/^\.+/, ''))
  assert.equal(m.filenameFromDisposition(''), 'Probation Evaluation.pdf')
  assert.equal(m.filenameFromDisposition(undefined, 'Other.pdf'), 'Other.pdf')
  assert.equal(m.filenameFromDisposition('attachment; filename="a:b*c?.pdf"'), 'abc.pdf')
})

test('picker filter and list params', () => {
  const people = [
    { employee_id: 'E1', name: 'Carla Dizon', job_title: 'Compliance Analyst', department: 'Compliance', start_date: null },
    { employee_id: 'E2', name: 'Dan Ocampo', job_title: 'Finance Officer', department: 'Finance', start_date: null },
  ]
  assert.equal(m.filterEligible(people, '').length, 2)
  assert.deepEqual(m.filterEligible(people, ' FIN ').map((p) => p.employee_id), ['E2'])
  assert.deepEqual(m.filterEligible(people, 'carla').map((p) => p.employee_id), ['E1'])
  assert.deepEqual(m.listParams('', ''), {})
  assert.deepEqual(m.listParams('draft', '  carla '), { status: 'draft', q: 'carla' })
})

test('source guard: no HTML injection, no role names, no storage or tokens in the probation files', () => {
  for (const f of ['ProbationTab.tsx', 'ProbationDetail.tsx', 'ProbationSections.tsx', 'probationApi.ts', 'probationLogic.ts']) {
    const src = readSrc(`modules/performance/${f}`)
    assert.ok(!/dangerouslySetInnerHTML|innerHTML\s*=/.test(src), `${f}: no HTML injection`)
    assert.ok(!/['"`](Employee|Manager|HRAdmin|Finance)['"`]/.test(src), `${f}: no role names (permissions come from the server)`)
    assert.ok(!/accessToken|access_token|refreshToken|localStorage|sessionStorage|[?&]token=/.test(src), `${f}: no tokens or storage`)
  }
  const api = readSrc('modules/performance/probationApi.ts')
  assert.ok(/responseType: 'blob'/.test(api) && /saveBlob/.test(api), 'the PDF is fetched as a blob through the client')
  const tab = readSrc('modules/performance/ProbationTab.tsx') + readSrc('modules/performance/ProbationDetail.tsx')
  assert.ok(!/<a\b|href=/.test(tab), 'no bare links to the PDF')
})
