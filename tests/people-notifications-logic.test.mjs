import test from 'node:test'
import assert from 'node:assert/strict'
import { loadTs } from './helpers/load-ts.mjs'

const p = await loadTs('lib/people.ts')
const n = await loadTs('lib/notificationsLogic.ts')

test('employment and status labels', () => {
  assert.equal(p.employmentTypeLabel('full_time'), 'Full-time')
  assert.equal(p.employmentTypeLabel('contractor'), 'Contractor')
  assert.equal(p.employmentTypeLabel('seasonal_worker'), 'Seasonal Worker')
  assert.equal(p.employmentTypeLabel(null), '-')
  assert.equal(p.personStatusLabel('active'), 'Active')
  assert.equal(p.personStatusLabel('on_leave'), 'On Leave')
  assert.equal(p.personStatusTone('active'), 'green')
  assert.equal(p.personStatusTone('on_leave'), 'amber')
  assert.equal(p.personStatusTone('gone'), 'neutral')
})

test('authSourceLabel and rolesText', () => {
  assert.equal(p.authSourceLabel('microsoft'), 'Microsoft work account')
  assert.equal(p.authSourceLabel('demo'), 'Local account')
  assert.equal(p.authSourceLabel('password'), 'Email and password')
  assert.equal(p.rolesText(['HRAdmin', 'Manager']), 'HR Administrator, Manager')
  assert.equal(p.rolesText([]), 'Employee')
})

test('pageWindow arithmetic incl. empty list, last partial page and out-of-range page', () => {
  assert.deepEqual(p.pageWindow(1, 20, 45), { page: 1, pages: 3, from: 1, to: 20, hasPrev: false, hasNext: true })
  assert.deepEqual(p.pageWindow(3, 20, 45), { page: 3, pages: 3, from: 41, to: 45, hasPrev: true, hasNext: false })
  assert.deepEqual(p.pageWindow(9, 20, 45).page, 3)
  assert.deepEqual(p.pageWindow(1, 20, 0), { page: 1, pages: 1, from: 0, to: 0, hasPrev: false, hasNext: false })
  assert.deepEqual(p.pageWindow(1, 20, 20), { page: 1, pages: 1, from: 1, to: 20, hasPrev: false, hasNext: false })
  assert.equal(p.pageWindow(0, 20, 5).page, 1)
})

test('bell label shows the count only when something is unread', () => {
  assert.equal(n.bellLabel(0), 'Notifications')
  assert.equal(n.bellLabel(3), 'Notifications, 3 unread')
  assert.equal(n.POLL_INTERVAL_MS, 60000)
})

test('safeLink: only same-origin in-app paths', () => {
  assert.equal(n.safeLink('/reimbursements/abc'), '/reimbursements/abc')
  assert.equal(n.safeLink('/reimbursements?tab=review'), '/reimbursements?tab=review')
  for (const bad of ['https://evil.example/x', '//evil.example', '/\\evil', 'javascript:alert(1)', '', null, undefined, '/login']) assert.equal(n.safeLink(bad), null, String(bad))
})

const list = () => ({
  items: [
    { notification_id: 'a', kind: 'k', title: 'A', body: '', link: null, created_at: '', read: false },
    { notification_id: 'b', kind: 'k', title: 'B', body: '', link: null, created_at: '', read: true },
    { notification_id: 'c', kind: 'k', title: 'C', body: '', link: null, created_at: '', read: false },
  ],
  unread_count: 2,
})

test('markReadLocal decrements once, ignores already-read and unknown ids, never goes negative', () => {
  const l = n.markReadLocal(list(), 'a')
  assert.equal(l.unread_count, 1)
  assert.equal(l.items[0].read, true)
  assert.equal(n.markReadLocal(l, 'a').unread_count, 1)
  assert.equal(n.markReadLocal(l, 'b').unread_count, 1)
  assert.equal(n.markReadLocal(l, 'zzz').unread_count, 1)
  assert.equal(n.markReadLocal({ items: list().items, unread_count: 0 }, 'a').unread_count, 0)
})

test('markAllReadLocal clears everything; unreadItems filters; polling only while visible', () => {
  const l = n.markAllReadLocal(list())
  assert.equal(l.unread_count, 0)
  assert.ok(l.items.every((i) => i.read))
  assert.equal(n.unreadItems(list().items).length, 2)
  assert.equal(n.shouldPoll('visible'), true)
  assert.equal(n.shouldPoll('hidden'), false)
})
