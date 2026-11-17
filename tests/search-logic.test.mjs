import test from 'node:test'
import assert from 'node:assert/strict'
import { loadTs } from './helpers/load-ts.mjs'

const s = await loadTs('lib/searchLogic.ts')

test('constants follow the contract: min 2, max 64, 250 ms debounce', () => {
  assert.equal(s.MIN_QUERY, 2)
  assert.equal(s.MAX_QUERY, 64)
  assert.equal(s.DEBOUNCE_MS, 250)
})

test('normaliseQuery trims and classifies', () => {
  assert.deepEqual(s.normaliseQuery('  ana '), { q: 'ana', problem: null })
  assert.equal(s.normaliseQuery('').problem, 'empty')
  assert.equal(s.normaliseQuery('   ').problem, 'empty')
  assert.equal(s.normaliseQuery('a').problem, 'short')
  assert.equal(s.normaliseQuery(' a ').problem, 'short')
  assert.equal(s.normaliseQuery('ab').problem, null)
  assert.equal(s.normaliseQuery('x'.repeat(64)).problem, null)
  assert.equal(s.normaliseQuery('x'.repeat(65)).problem, 'long')
  assert.match(s.hintFor('short'), /at least 2/)
  assert.match(s.hintFor('long'), /64/)
  assert.equal(s.hintFor(null), null)
})

test('filterPages: client-side, from the nav, min 2 chars, prefix first', () => {
  assert.deepEqual(s.filterPages('c'), [])
  const cal = s.filterPages('calen')
  assert.equal(cal[0].label, 'Company Calendar')
  assert.equal(cal[0].to, '/company-calendar')
  assert.equal(cal[0].kind, 'page')
  assert.equal(s.filterPages('direct')[0].to, '/directory')
  assert.equal(s.filterPages('REIMB')[0].to, '/reimbursements')
  assert.ok(s.filterPages('holiday').some((o) => o.to === '/company-calendar'), 'keyword match')
  assert.deepEqual(s.filterPages('zzzz'), [])
  assert.ok(s.filterPages('le').length <= 8)
})

test('buildGroups: People / Requests / Pages order, empty groups dropped, links built', () => {
  const results = {
    q: 'an',
    people: [{ employee_id: 'EMP-1', name: 'Ana', job_title: 'Dev', department: 'IT' }],
    requests: [{ request_id: 'r 1', purpose: 'Lunch', status: 'pending_manager' }],
    limit: 8,
  }
  const pages = s.filterPages('directory')
  const groups = s.buildGroups(results, pages)
  assert.deepEqual(groups.map((g) => g.id), ['people', 'requests', 'pages'])
  assert.equal(groups[0].options[0].to, '/directory/EMP-1')
  assert.equal(groups[0].options[0].sub, 'Dev - IT')
  assert.equal(groups[1].options[0].to, '/reimbursements/r%201')
  assert.match(groups[1].options[0].sub, /Pending manager/)
  assert.deepEqual(s.buildGroups(null, []), [])
  assert.deepEqual(s.buildGroups({ q: 'x', people: [], requests: [], limit: 8 }, pages).map((g) => g.id), ['pages'])
  assert.equal(s.flattenGroups(groups).length, 3)
})

test('option ids are unique and stable (used for aria-activedescendant)', () => {
  const groups = s.buildGroups({ q: 'a', people: [{ employee_id: 'E1', name: 'A', job_title: null, department: null }], requests: [{ request_id: 'E1', purpose: 'P', status: '' }], limit: 8 }, s.filterPages('profile'))
  const ids = s.flattenGroups(groups).map((o) => o.id)
  assert.equal(new Set(ids).size, ids.length)
})

test('nextActiveIndex: arrows wrap, Home/End jump, nothing to move through gives -1', () => {
  assert.equal(s.nextActiveIndex(-1, 'ArrowDown', 3), 0)
  assert.equal(s.nextActiveIndex(0, 'ArrowDown', 3), 1)
  assert.equal(s.nextActiveIndex(2, 'ArrowDown', 3), 0)
  assert.equal(s.nextActiveIndex(-1, 'ArrowUp', 3), 2)
  assert.equal(s.nextActiveIndex(0, 'ArrowUp', 3), 2)
  assert.equal(s.nextActiveIndex(2, 'ArrowUp', 3), 1)
  assert.equal(s.nextActiveIndex(1, 'Home', 3), 0)
  assert.equal(s.nextActiveIndex(1, 'End', 3), 2)
  assert.equal(s.nextActiveIndex(1, 'ArrowDown', 0), -1)
  assert.equal(s.nextActiveIndex(1, 'a', 3), 1)
})

test('polite failure messages never echo server text', () => {
  assert.match(s.searchFailureMessage(400), /between 2 and 64/)
  assert.match(s.searchFailureMessage(429), /too fast/)
  assert.match(s.searchFailureMessage(401), /Sign in/)
  assert.match(s.searchFailureMessage(undefined), /reach/)
  assert.match(s.searchFailureMessage(500), /unavailable/)
})
