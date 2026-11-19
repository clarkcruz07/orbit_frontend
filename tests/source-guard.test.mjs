import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { listSrc, readSrc } from './helpers/load-ts.mjs'

/** Every <button ...> element in the source must be actionable: onClick, type="submit", or disabled. */
function buttonsWithoutAction(source) {
  const bad = []
  const re = /<button\b([\s\S]*?)>/g
  let m
  while ((m = re.exec(source))) {
    const attrs = m[1]
    // Skip arrow-function '=>' false positives inside attributes by checking for the handler/submit/disabled tokens.
    if (!/onClick\s*=|type=["']submit["']|\bdisabled\b/.test(attrs)) bad.push(attrs.trim().slice(0, 80))
  }
  return bad
}

const files = listSrc('', ['.tsx'])

test('no <button> in the app renders without a handler, submit type or disabled state', () => {
  const offenders = []
  for (const f of files) {
    const rel = path.relative(path.join(process.cwd(), 'src'), f)
    const bad = buttonsWithoutAction(readSrc(rel))
    if (bad.length) offenders.push(`${rel}: ${bad.join(' | ')}`)
  }
  assert.deepEqual(offenders, [])
})

test('placeholder pages render no buttons or links at all (EmptyState gets no action)', () => {
  for (const rel of ['pages/ComingSoon.tsx']) {
    const src = readSrc(rel)
    assert.ok(!/<button\b/.test(src), `${rel} must not contain buttons`)
    assert.ok(!/action=\{/.test(src), `${rel} must not pass an EmptyState action`)
    assert.ok(!/<Link\b|<a\b/.test(src), `${rel} must not contain links`)
  }
})

test('HR Requests: only Reimbursements and "Browse the directory" are links; the other cards are plain, muted markup', () => {
  const src = readSrc('pages/HrRequests.tsx')
  assert.equal((src.match(/<Link\b/g) || []).length, 2)
  assert.ok(src.includes('to="/reimbursements"'))
  assert.ok(src.includes('to="/directory"'))
  assert.ok(!/<button\b/.test(src))
})

test('dashboard "View ..." actions are non-interactive MutedAction text; "Go to Directory" and "Users and roles" are the only real links', () => {
  const src = readSrc('pages/hr/HrAdministration.tsx')
  const parts = readSrc('pages/hr/parts.tsx')
  assert.ok(!/<a\b/.test(src) && !/<a\b/.test(parts))
  // The one <Link> of the card headers lives in CardLink (parts.tsx); the only cards that pass actionTo are Employee Directory and Microsoft Accounts.
  assert.equal((src.match(/<Link\b/g) || []).length, 0)
  assert.equal((parts.match(/<Link\b/g) || []).length, 1)
  assert.equal((src.match(/actionTo="/g) || []).length, 2)
  assert.ok(/action="Go to Directory" actionTo="\/directory"/.test(src))
  assert.ok(/action="Users and roles" actionTo="\/settings\?tab=users"/.test(src))
  const buttons = src.match(/<button\b[\s\S]*?>/g) || []
  // The only button is the error-state "Try again", which has an onClick handler.
  assert.equal(buttons.length, 1)
  assert.ok(/onClick=\{load\}/.test(buttons[0]))
  for (const label of ['View Details', 'View All', 'Go to Directory', 'View All Cases']) {
    assert.ok(src.includes(`"${label}"`), label)
  }
  assert.ok(/function MutedAction[\s\S]*?<span className="muted-action"/.test(parts))
})

test('Microsoft SDK is only imported lazily', () => {
  for (const f of files.concat(listSrc('', ['.ts']))) {
    const rel = path.relative(path.join(process.cwd(), 'src'), f)
    const src = readSrc(rel)
    assert.ok(!/^import .* from ['"]@azure\/msal-browser['"]/m.test(src), `${rel} has a static msal import`)
  }
})
