import test from 'node:test'
import assert from 'node:assert/strict'
import { loadTs } from './helpers/load-ts.mjs'

const F = await loadTs('lib/dashboardFormat.ts')

test('integers use thousands separators', () => {
  assert.equal(F.formatInt(1248), '1,248')
  assert.equal(F.formatInt(7), '7')
  assert.equal(F.formatInt(null), '-')
  assert.equal(F.formatInt(NaN), '-')
})

test('deltas: sign, unit, direction', () => {
  assert.deepEqual(F.formatDelta(3.2, '%'), { text: '+3.2%', direction: 'up' })
  assert.deepEqual(F.formatDelta(-18, '%'), { text: '-18%', direction: 'down' })
  assert.deepEqual(F.formatDelta(2, 'pp'), { text: '+2 pp', direction: 'up' })
  assert.deepEqual(F.formatDelta(0, '%'), { text: '0%', direction: 'flat' })
  assert.deepEqual(F.formatDelta(undefined, '%'), { text: '-', direction: 'flat' })
})

test('period and status labels', () => {
  assert.equal(F.periodLabel('last_month'), 'vs. last month')
  assert.equal(F.periodLabel('month'), 'vs. last month')
  assert.equal(F.periodLabel('vs. last month'), 'vs. last month')
  assert.equal(F.periodLabel(''), 'vs. last month')
  assert.equal(F.statusLabel('in_progress'), 'In Progress')
  assert.equal(F.statusLabel('In Progress'), 'In Progress')
  assert.equal(F.expiringLabel(30), 'Next 30 Days')
})

test('holiday date blocks accept month names or numbers', () => {
  assert.deepEqual(F.holidayBlock({ month: 'Feb', day: 10, name: 'Chinese New Year', type: 'Public Holiday' }), { month: 'FEB', day: '10', name: 'Chinese New Year', type: 'Public Holiday' })
  assert.equal(F.holidayBlock({ month: 4, day: 9, name: 'x', type: 'public_holiday' }).month, 'APR')
  assert.equal(F.holidayBlock({ month: 4, day: 9, name: 'x', type: 'public_holiday' }).type, 'Public Holiday')
  assert.equal(F.holidayBlock({ month: 'April', day: 9, name: 'x' }).month, 'APR')
})

test('birthday chips accept "Jan 25" and ISO-like forms', () => {
  assert.equal(F.birthdayChip('Jan 25'), 'Jan 25')
  assert.equal(F.birthdayChip('01-25'), 'Jan 25')
  assert.equal(F.birthdayChip('--01-28'), 'Jan 28')
  assert.equal(F.birthdayChip('2026-01-31'), 'Jan 31')
  assert.equal(F.birthdayChip(''), '-')
})

test('trend axis gives 50-step ticks with headroom (1100..1300 for the reference data)', () => {
  const a = F.trendAxis([1100, 1130, 1165, 1195, 1225, 1248])
  assert.equal(a.min, 1100)
  assert.equal(a.max, 1300)
  assert.deepEqual(a.ticks, [1100, 1150, 1200, 1250, 1300])
  assert.deepEqual(F.trendAxis([]).ticks, [0, 50, 100])
})

test('lifecycle / directory / resolution mapping', () => {
  assert.deepEqual(F.lifecycleRows({ completed: 19, in_progress: 5, not_started: 0 }), [
    { label: 'Completed', value: 19 },
    { label: 'In Progress', value: 5 },
    { label: 'Not Started', value: 0 },
  ])
  assert.deepEqual(F.directoryRows({ full_time: 1158, part_time: 52, contractor: 26, intern: 12 }).map((r) => [r.label, r.value]), [
    ['Full-time', 1158],
    ['Part-time', 52],
    ['Contractor', 26],
    ['Intern', 12],
  ])
  assert.equal(F.resolutionDays(3.4), '3.4 days')
  assert.equal(F.clampPct(120), 100)
  assert.equal(F.clampPct(-3), 0)
})
