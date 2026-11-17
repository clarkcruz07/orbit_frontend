// Unit tests for the payday cutoff helper (src/lib/payday.ts): tolerant readers of the server values and the wording shown to people.
// The server decides every date; these tests only check reading and wording.
import test, { before } from 'node:test'
import assert from 'node:assert/strict'
import { loadTs } from './helpers/load-ts.mjs'

let P
before(async () => {
  P = await loadTs('lib/payday.ts')
})

const NORMAL = {
  today: '2026-11-16',
  timezone: 'Asia/Manila',
  cutoff_days: 5,
  current: { payday: '2026-11-27', cutoff: '2026-11-22', days_to_cutoff: 6, deferred_now: false },
  next: { payday: '2026-12-11', cutoff: '2026-12-06' },
}
const DEFERRED = {
  ...NORMAL,
  today: '2026-11-23',
  current: { payday: '2026-12-11', cutoff: '2026-12-06', days_to_cutoff: 13, deferred_now: true },
  next: { payday: '2026-12-25', cutoff: '2026-12-20' },
}

test('formatPayday: "Fri, 27 Nov", from the calendar date alone', () => {
  assert.equal(P.formatPayday('2026-11-27'), 'Fri, 27 Nov')
  assert.equal(P.formatPayday('2026-11-22'), 'Sun, 22 Nov')
  assert.equal(P.formatPayday('2026-12-11'), 'Fri, 11 Dec')
  assert.equal(P.formatPayday('2027-01-01'), 'Fri, 1 Jan')
})

test('formatPayday: bad or missing values give an empty string, never "Invalid Date"', () => {
  for (const v of [null, undefined, '', 'tomorrow', '2026-13-40', '27/11/2026', '2026-11-27T10:00:00Z']) assert.equal(P.formatPayday(v), '')
})

test('normalisePayCalendar: reads the contract shape', () => {
  const c = P.normalisePayCalendar(NORMAL)
  assert.deepEqual(c.current, { payday: '2026-11-27', cutoff: '2026-11-22', daysToCutoff: 6, deferredNow: false })
  assert.deepEqual(c.next, { payday: '2026-12-11', cutoff: '2026-12-06' })
  assert.equal(c.cutoffDays, 5)
  assert.equal(c.timezone, 'Asia/Manila')
  assert.equal(P.normalisePayCalendar(DEFERRED).current.deferredNow, true)
})

test('normalisePayCalendar: absent, wrong-typed or half-filled values give null or safe nulls', () => {
  for (const v of [undefined, null, 5, 'x', [], {}, { current: 'soon' }, { current: { payday: 'x', cutoff: 'y' } }]) assert.equal(P.normalisePayCalendar(v), null)
  const partial = P.normalisePayCalendar({ current: { payday: '2026-11-27', cutoff: '2026-11-22' } })
  assert.equal(partial.current.daysToCutoff, null)
  assert.equal(partial.current.deferredNow, false)
  assert.equal(partial.next, null)
  assert.equal(P.normalisePayCalendar({ ...NORMAL, cutoff_days: 'five' }).cutoffDays, null)
})

test('normalisePayday: the payday a submitted item belongs to; null for drafts and older rows', () => {
  assert.deepEqual(P.normalisePayday({ date: '2026-11-27', cutoff: '2026-11-22', deferred: true, submitted_on: '2026-11-23' }), {
    date: '2026-11-27',
    cutoff: '2026-11-22',
    deferred: true,
    submittedOn: '2026-11-23',
  })
  assert.deepEqual(P.normalisePayday({ date: '2026-11-27' }), { date: '2026-11-27', cutoff: null, deferred: false, submittedOn: null })
  for (const v of [undefined, null, {}, 'Fri', { date: 'soon' }, { date: '' }, []]) assert.equal(P.normalisePayday(v), null)
})

test('paydayLabel and the deferred marker wording', () => {
  assert.equal(P.paydayLabel({ date: '2026-11-27' }), 'Payday: Fri, 27 Nov')
  assert.equal(P.paydayLabel(null), '')
  assert.equal(P.DEFERRED_MARKER, 'Next payday (submitted after the cutoff)')
})

test('cutoffNotice (normal): submit by the cutoff to make the payday; later ones go to the next payday', () => {
  const n = P.cutoffNotice(P.normalisePayCalendar(NORMAL), 'request')
  assert.equal(n.variant, 'normal')
  assert.equal(n.text, 'Submit by Sun, 22 Nov to be handled on the Fri, 27 Nov payday. Later requests go to the Fri, 11 Dec payday.')
  assert.equal(n.countdown, '6 days left to make the Fri, 27 Nov payday.')
  assert.equal(P.cutoffNotice(P.normalisePayCalendar(NORMAL), 'correction').text, 'Submit by Sun, 22 Nov to be handled on the Fri, 27 Nov payday. Later corrections go to the Fri, 11 Dec payday.')
})

test('cutoffNotice (deferred): the cutoff has passed, so today goes to the next payday; no countdown', () => {
  const n = P.cutoffNotice(P.normalisePayCalendar(DEFERRED), 'request')
  assert.equal(n.variant, 'deferred')
  assert.equal(n.text, 'The cutoff for the nearest payday has passed. A request submitted today goes to the Fri, 11 Dec payday.')
  assert.equal(n.countdown, null)
  assert.match(P.cutoffNotice(P.normalisePayCalendar(DEFERRED), 'correction').text, /A correction submitted today goes to the Fri, 11 Dec payday\.$/)
})

test('cutoffNotice: no calendar, no notice; a missing "next" just drops the second sentence', () => {
  assert.equal(P.cutoffNotice(null), null)
  const c = P.normalisePayCalendar({ current: { payday: '2026-11-27', cutoff: '2026-11-22', days_to_cutoff: 2, deferred_now: false } })
  assert.equal(P.cutoffNotice(c).text, 'Submit by Sun, 22 Nov to be handled on the Fri, 27 Nov payday.')
})

test('countdown: days left, one day, last day, passed or unknown', () => {
  const at = (days, deferred = false) => P.normalisePayCalendar({ current: { payday: '2026-11-27', cutoff: '2026-11-22', days_to_cutoff: days, deferred_now: deferred } })
  assert.equal(P.countdown(at(2)), '2 days left to make the Fri, 27 Nov payday.')
  assert.equal(P.countdown(at(1)), '1 day left to make the Fri, 27 Nov payday.')
  assert.equal(P.countdown(at(0)), 'Today is the last day to make the Fri, 27 Nov payday.')
  assert.equal(P.countdown(at(-1)), null)
  assert.equal(P.countdown(at(3, true)), null, 'deferred_now has its own wording')
  assert.equal(P.countdown(P.normalisePayCalendar({ current: { payday: '2026-11-27', cutoff: '2026-11-22' } })), null)
  assert.equal(P.countdown(null), null)
})

test('landedSentence: which payday a submitted item landed on, and why when it was pushed back', () => {
  assert.equal(P.landedSentence({ date: '2026-11-27', cutoff: '2026-11-22', deferred: false, submittedOn: null }), 'This request will be handled on the Fri, 27 Nov payday.')
  assert.equal(
    P.landedSentence({ date: '2026-12-11', cutoff: '2026-12-06', deferred: true, submittedOn: null }, 'correction'),
    'Submitted after the cutoff, so this correction goes to the next payday: Fri, 11 Dec.',
  )
  assert.equal(P.landedSentence(null), null)
})
