import test from 'node:test'
import assert from 'node:assert/strict'
import { loadTs } from './helpers/load-ts.mjs'

const c = await loadTs('lib/calendar.ts')

const inMonth = (weeks) => weeks.flat().filter((x) => x.inMonth)

test('every row has 7 cells, rows are consecutive days, and the month is fully covered', () => {
  for (const key of ['2026-01', '2026-02', '2026-11', '2028-02', '2026-08', '2025-06']) {
    const weeks = c.buildMonthGrid(key)
    assert.ok(weeks.length >= 4 && weeks.length <= 6, `${key} rows ${weeks.length}`)
    assert.ok(weeks.every((w) => w.length === 7))
    const flat = weeks.flat().map((x) => x.date)
    for (let i = 1; i < flat.length; i++) assert.ok(flat[i] > flat[i - 1], `${key} ordered`)
    const [y, m] = key.split('-').map(Number)
    const days = new Date(y, m, 0).getDate()
    assert.equal(inMonth(weeks).length, days, `${key} day count`)
  }
})

test('February 2026 (common year, starts Sunday) is exactly four rows with no padding', () => {
  const weeks = c.buildMonthGrid('2026-02')
  assert.equal(weeks.length, 4)
  assert.ok(weeks.flat().every((x) => x.inMonth))
  assert.equal(weeks[0][0].date, '2026-02-01')
  assert.equal(weeks[3][6].date, '2026-02-28')
})

test('leap February 2028 includes the 29th and pads with neighbouring days', () => {
  const weeks = c.buildMonthGrid('2028-02')
  assert.ok(inMonth(weeks).some((x) => x.date === '2028-02-29'))
  assert.equal(weeks[0][0].date, '2028-01-30') // Feb 1, 2028 is a Tuesday
  assert.equal(weeks[0][0].inMonth, false)
  assert.equal(weeks.at(-1).at(-1).date, '2028-03-04')
})

test('month boundaries across years: December pads into January and January into the previous December', () => {
  const dec = c.buildMonthGrid('2026-12') // Dec 1 2026 is a Tuesday, Dec 31 a Thursday
  assert.equal(dec[0][0].date, '2026-11-29')
  assert.equal(dec.at(-1).at(-1).date, '2027-01-02')
  const jan = c.buildMonthGrid('2027-01')
  assert.equal(jan[0][0].date, '2026-12-27')
  assert.equal(jan[0][0].inMonth, false)
})

test('Monday-first weeks and weekday labels', () => {
  assert.deepEqual(c.weekdayLabels(), ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'])
  assert.deepEqual(c.weekdayLabels(1), ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])
  const weeks = c.buildMonthGrid('2026-11', 1) // Nov 1 2026 is a Sunday: six leading days from October
  assert.equal(weeks[0][0].date, '2026-10-26')
  assert.equal(weeks[0][6].date, '2026-11-01')
})

test('invalid keys give an empty grid', () => {
  assert.deepEqual(c.buildMonthGrid('2026-13'), [])
  assert.deepEqual(c.buildMonthGrid(''), [])
})

test('allowed span is +/-12 months of the current month (server rule)', () => {
  assert.deepEqual(c.monthBounds('2026-11'), { min: '2025-11', max: '2027-11' })
  assert.equal(c.monthInRange('2027-11', '2026-11'), true)
  assert.equal(c.monthInRange('2027-12', '2026-11'), false)
  assert.equal(c.monthInRange('2025-10', '2026-11'), false)
  assert.equal(c.canShiftMonth('2027-11', 1, '2026-11'), false)
  assert.equal(c.canShiftMonth('2027-11', -1, '2026-11'), true)
  assert.equal(c.canShiftMonth('2025-11', -1, '2026-11'), false)
})

test('clampMonth falls back for bad input and pulls out-of-range months to the nearest allowed one', () => {
  assert.equal(c.clampMonth(null, '2026-11'), '2026-11')
  assert.equal(c.clampMonth('junk', '2026-11'), '2026-11')
  assert.equal(c.clampMonth('2030-01', '2026-11'), '2027-11')
  assert.equal(c.clampMonth('2020-01', '2026-11'), '2025-11')
  assert.equal(c.clampMonth('2026-12', '2026-11'), '2026-12')
})

const ev = (date, type, title, own = false) => ({ date, type, title, subtitle: null, own })

test('events are grouped by date, holidays before birthdays, then by title', () => {
  const map = c.groupByDate([ev('2026-11-23', 'birthday', 'Zed'), ev('2026-11-23', 'holiday', 'Holiday'), ev('2026-11-23', 'birthday', 'Amy'), ev('2026-11-30', 'holiday', 'Bonifacio')])
  assert.deepEqual(map.get('2026-11-23').map((e) => e.title), ['Holiday', 'Amy', 'Zed'])
  assert.equal(map.get('2026-11-30').length, 1)
})

test('agenda lists only days of the month that have events, in date order', () => {
  const days = c.agendaDays([ev('2026-11-30', 'holiday', 'B'), ev('2026-11-02', 'birthday', 'A'), ev('2026-12-01', 'holiday', 'Next month'), ev('2026-11-31', 'holiday', 'Impossible date')], '2026-11')
  assert.deepEqual(days.map((x) => x.date), ['2026-11-02', '2026-11-30'])
})

test('chips: own birthday is distinct and hides nothing sensitive (no year anywhere)', () => {
  assert.equal(c.chipKind({ type: 'holiday', own: false }), 'holiday')
  assert.equal(c.chipKind({ type: 'birthday', own: false }), 'birthday')
  assert.equal(c.chipKind({ type: 'birthday', own: true }), 'own-birthday')
  assert.equal(c.chipText({ type: 'birthday', title: 'Ana Reyes', own: false }), 'Ana Reyes - birthday')
  assert.equal(c.chipText({ type: 'birthday', title: 'Ana Reyes', own: true }), 'Your birthday')
  assert.equal(c.chipText({ type: 'holiday', title: 'Labour Day', own: false }), 'Labour Day')
})
