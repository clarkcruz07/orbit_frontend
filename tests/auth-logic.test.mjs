import test from 'node:test'
import assert from 'node:assert/strict'
import { loadTs } from './helpers/load-ts.mjs'

const A = await loadTs('lib/authLogic.ts')

test('refresh: one attempt, only for 401 on non-auth endpoints with a refresh token', () => {
  const base = { status: 401, url: '/hr/dashboard', alreadyRetried: false, hasRefreshToken: true }
  assert.equal(A.shouldAttemptRefresh(base), true)
  assert.equal(A.shouldAttemptRefresh({ ...base, alreadyRetried: true }), false)
  assert.equal(A.shouldAttemptRefresh({ ...base, hasRefreshToken: false }), false)
  assert.equal(A.shouldAttemptRefresh({ ...base, status: 403 }), false)
  assert.equal(A.shouldAttemptRefresh({ ...base, status: undefined }), false)
  for (const url of ['/auth/login', '/auth/refresh', '/auth/entra', '/auth/logout']) {
    assert.equal(A.shouldAttemptRefresh({ ...base, url }), false, url)
  }
  assert.equal(A.shouldAttemptRefresh({ ...base, url: '/auth/me' }), true)
})

test('dashboard view: HR personnel (HRAdmin, from Entra employeeType) get hr, everyone else standard', () => {
  assert.equal(A.dashboardView({ roles: ['HRAdmin'] }), 'hr')
  assert.equal(A.dashboardView({ roles: ['Manager', 'HRAdmin'] }), 'hr')
  assert.equal(A.dashboardView({ roles: ['Employee'] }), 'standard')
  assert.equal(A.dashboardView({ roles: ['Finance', 'Manager'] }), 'standard')
  assert.equal(A.dashboardView({ roles: [] }), 'standard')
  assert.equal(A.dashboardView(null), 'standard')
})

test('landing path: everyone lands on the Dashboard (/)', () => {
  assert.equal(A.landingPath({ roles: ['HRAdmin'] }), '/')
  assert.equal(A.landingPath({ roles: ['Manager', 'HRAdmin'] }), '/')
  assert.equal(A.landingPath({ roles: ['Employee'] }), '/')
  assert.equal(A.landingPath({ roles: ['Finance'] }), '/')
  assert.equal(A.landingPath(null), '/')
})

test('hasAnyRole / allow(roles)', () => {
  assert.equal(A.hasAnyRole({ roles: ['Employee'] }, undefined), true)
  assert.equal(A.hasAnyRole({ roles: ['Employee'] }, []), true)
  assert.equal(A.hasAnyRole({ roles: ['Employee'] }, ['HRAdmin']), false)
  assert.equal(A.hasAnyRole({ roles: ['Employee', 'Finance'] }, ['HRAdmin', 'Finance']), true)
  assert.equal(A.hasAnyRole(null, ['HRAdmin']), false)
})

test('login redirect carries a path through ?next=, never loops on /login', () => {
  assert.equal(A.loginRedirectPath('/hr-administration'), '/login?next=%2Fhr-administration')
  assert.equal(A.loginRedirectPath('/reimbursements/7', '?a=1'), '/login?next=%2Freimbursements%2F7%3Fa%3D1')
  assert.equal(A.loginRedirectPath('/'), '/login')
  assert.equal(A.loginRedirectPath('/login', '?next=/x'), '/login')
})

test('/auth/me failure classification: 401/403 end the session, everything else is retryable', () => {
  assert.equal(A.classifyMeFailure({ response: { status: 401 } }), 'unauthorized')
  assert.equal(A.classifyMeFailure({ response: { status: 403 } }), 'unauthorized')
  assert.equal(A.classifyMeFailure({ response: { status: 502 } }), 'unreachable')
  assert.equal(A.classifyMeFailure({}), 'unreachable')
  assert.equal(A.classifyMeFailure(null), 'unreachable')
})

test('display helpers', () => {
  assert.equal(A.roleLabel(['HRAdmin']), 'HR Administrator')
  assert.equal(A.roleLabel(['Employee', 'Manager']), 'Manager')
  assert.equal(A.roleLabel([]), 'Employee')
  assert.equal(A.initialsOf('Anna Reyes'), 'AR')
  assert.equal(A.initialsOf('Mark Del Rosario'), 'MR')
  assert.equal(A.initialsOf(''), '?')
  assert.equal(A.errorMessage({ response: { data: { detail: 'Nope' } } }, 'fb'), 'Nope')
  assert.equal(A.errorMessage({ response: { data: { detail: { x: 1 } } } }, 'fb'), 'fb')
  assert.equal(A.errorMessage(new Error('boom'), 'fb'), 'fb')
})

test('auth store: persists tokens under the agreed localStorage keys and clears them', async () => {
  const mem = new Map()
  globalThis.window = { localStorage: { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) } }
  const { useAuthStore, ACCESS_KEY, REFRESH_KEY } = await loadTs('stores/authStore.ts')
  assert.equal(ACCESS_KEY, 'people.accessToken')
  assert.equal(REFRESH_KEY, 'people.refreshToken')
  assert.equal(useAuthStore.getState().status, 'anonymous')
  useAuthStore.getState().setTokens('a1', 'r1')
  assert.equal(mem.get('people.accessToken'), 'a1')
  assert.equal(mem.get('people.refreshToken'), 'r1')
  useAuthStore.getState().setTokens('a2') // refresh keeps the refresh token
  assert.equal(mem.get('people.accessToken'), 'a2')
  assert.equal(mem.get('people.refreshToken'), 'r1')
  useAuthStore.getState().setUser({ user_id: 'u', email: 'e', name: 'N', roles: ['Employee'], employee_id: null })
  assert.equal(useAuthStore.getState().status, 'authenticated')
  useAuthStore.getState().clear()
  assert.equal(mem.size, 0)
  assert.equal(useAuthStore.getState().status, 'anonymous')
  assert.equal(useAuthStore.getState().user, null)
  delete globalThis.window
})
