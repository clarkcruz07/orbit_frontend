import test from 'node:test'
import assert from 'node:assert/strict'
import { loadTs } from './helpers/load-ts.mjs'

const { NAV_ITEMS, navItemsFor, pageTitleFor } = await loadTs('shell/navigation.ts')

test('nav order and labels match SPEC section 8 exactly (non-HR view)', () => {
  assert.deepEqual(
    navItemsFor('standard').map((i) => i.label),
    [
      'Dashboard',
      'My Profile',
      'Leave',
      'Attendance & Timesheet',
      'Performance & Check-ins',
      'Learning & Development',
      'HR Requests',
      'Reimbursements',
      'Documents',
      'Company Calendar',
      'Settings',
    ],
  )
})

test('Reimbursements is an indented sub-item directly under HR Requests', () => {
  const items = navItemsFor('standard')
  const idx = items.findIndex((i) => i.id === 'reimbursements')
  assert.equal(items[idx - 1].id, 'hr-requests')
  assert.equal(items[idx].sub, true)
  assert.equal(items.filter((i) => i.sub).length, 1)
})

test('divider sits before Settings only; HR Requests is exact-match active', () => {
  assert.deepEqual(NAV_ITEMS.filter((i) => i.dividerBefore).map((i) => i.id), ['settings'])
  assert.equal(NAV_ITEMS.find((i) => i.id === 'hr-requests').end, true)
  assert.equal(NAV_ITEMS.find((i) => i.id === 'dashboard').end, true)
})

test('paths are unique, absolute and have no role gating (visible to every role)', () => {
  const paths = NAV_ITEMS.map((i) => i.path)
  assert.equal(new Set(paths).size, paths.length)
  assert.ok(paths.every((p) => p.startsWith('/')))
  assert.ok(NAV_ITEMS.every((i) => !('roles' in i)))
})

test('page titles resolve for nested routes', () => {
  assert.equal(pageTitleFor('/reimbursements/new'), 'Reimbursements')
  assert.equal(pageTitleFor('/'), 'Dashboard')
  assert.ok(!NAV_ITEMS.some((i) => i.id === 'hr-administration'), 'HR Administration is the HR Dashboard now, not a separate entry')
  assert.equal(pageTitleFor('/nope'), 'Bluedge People')
})

test('HR personnel also get a second, indented "Dashboard" that opens the non-HR dashboard; others do not', () => {
  const hr = navItemsFor('hr')
  assert.deepEqual(hr.slice(0, 3).map((i) => [i.label, i.path, Boolean(i.sub)]), [
    ['Dashboard', '/', false],
    ['Dashboard', '/my-dashboard', true],
    ['My Profile', '/my-profile', false],
  ])
  assert.equal(hr.length, navItemsFor('standard').length + 2) // the second Dashboard and Knowledge Base
  assert.ok(!navItemsFor('standard').some((i) => i.path === '/my-dashboard'))
})

test('Knowledge Base is an HR-only entry right after Documents; non-HR personnel do not get it', () => {
  const hr = navItemsFor('hr')
  const idx = hr.findIndex((i) => i.id === 'knowledge-base')
  assert.ok(idx > 0)
  assert.deepEqual([hr[idx].label, hr[idx].path, hr[idx].icon, Boolean(hr[idx].sub)], ['Knowledge Base', '/knowledge-base', 'knowledge', false])
  assert.equal(hr[idx - 1].id, 'documents')
  assert.equal(NAV_ITEMS.find((i) => i.id === 'knowledge-base').onlyView, 'hr')
  assert.ok(!navItemsFor('standard').some((i) => i.id === 'knowledge-base' || i.path === '/knowledge-base'))
  assert.equal(pageTitleFor('/knowledge-base'), 'Knowledge Base')
})
