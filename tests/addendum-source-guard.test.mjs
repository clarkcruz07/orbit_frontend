import test from 'node:test'
import assert from 'node:assert/strict'
import { readSrc } from './helpers/load-ts.mjs'

const NEW_PAGES = [
  'pages/directory/DirectoryList.tsx',
  'pages/directory/DirectoryProfile.tsx',
  'pages/MyProfile.tsx',
  'pages/calendar/CompanyCalendar.tsx',
  'shell/HeaderSearch.tsx',
  'shell/NotificationBell.tsx',
]
const ROLE_LITERAL = /['"`](Employee|Manager|HRAdmin|Finance)['"`]/

/** Every <button ...> must be actionable: onClick, type="submit", or disabled. */
function deadButtons(source) {
  const bad = []
  const re = /<button\b([\s\S]*?)>/g
  let m
  while ((m = re.exec(source))) if (!/onClick\s*=|type=["']submit["']|\bdisabled\b/.test(m[1])) bad.push(m[1].trim().slice(0, 80))
  return bad
}

test('new pages and header widgets render no dead buttons', () => {
  for (const f of NEW_PAGES) assert.deepEqual(deadButtons(readSrc(f)), [], f)
})

test('new pages never use anchors without a real destination', () => {
  for (const f of NEW_PAGES) {
    const src = readSrc(f)
    assert.ok(!/href=["']#["']/.test(src), `${f} has a # link`)
    assert.ok(!/href=["']["']/.test(src), `${f} has an empty link`)
    assert.ok(!/javascript:/i.test(src), `${f} has a javascript: link`)
  }
})

test('permissions come from the server: no role-name literal and no roles read in the new pages', () => {
  for (const f of NEW_PAGES) {
    const src = readSrc(f)
    assert.ok(!ROLE_LITERAL.test(src), `${f} names a role`)
    // My Profile only DISPLAYS the roles list the server returned (profile.roles); it never branches on it.
    const stripped = f === 'pages/MyProfile.tsx' ? src.replace(/profile\.roles/g, '') : src
    assert.ok(!/\.roles\b|hasAnyRole/.test(stripped), `${f} reads roles`)
  }
})

test('HR-only directory controls depend on the server sending HR fields, not on a role', () => {
  const src = readSrc('pages/directory/DirectoryList.tsx')
  assert.ok(/pageHasHrFields\(data\.items\)/.test(src))
  assert.ok(/\{hrFields \? \(/.test(src))
  const profile = readSrc('pages/directory/DirectoryProfile.tsx')
  assert.ok(/'employment_type' in p/.test(profile))
})

test('bell: the unread dot renders only when the unread count is above zero', () => {
  const src = readSrc('shell/NotificationBell.tsx')
  assert.ok(/unread > 0 \? <span className="bell-dot"/.test(src))
  assert.ok(/POLL_INTERVAL_MS/.test(src))
  assert.ok(/visibilitychange/.test(src) && /'focus'/.test(src))
})

test('search: combobox ARIA wiring is present', () => {
  const src = readSrc('shell/HeaderSearch.tsx')
  for (const token of ['role="combobox"', 'aria-expanded', 'aria-controls', 'aria-activedescendant', 'role="listbox"', 'role="option"', 'aria-selected', 'DEBOUNCE_MS']) assert.ok(src.includes(token), token)
})

test('no new sidebar item: the nav stays in the reference order and has no directory entry', () => {
  const nav = readSrc('shell/navigation.ts')
  assert.ok(!/directory/i.test(nav))
})

test('calendar and My Profile are real pages now (no ComingSoon wrapper left for them)', () => {
  const app = readSrc('App.tsx')
  assert.ok(/<CompanyCalendar \/>/.test(app))
  assert.ok(!/CompanyCalendarPage/.test(app))
  assert.ok(!/CompanyCalendarPage/.test(readSrc('pages/ComingSoon.tsx')))
})
