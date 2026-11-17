// Deterministic MOCK of the Bluedge People API (SPEC section 7: only the routes this frontend part uses).
// Used by the browser tests and the screenshot script. All data is fictional.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { createReimbState, handleReimbursements } from './mock-reimbursements.mjs'
import { createNewEndpointsState, handleNewEndpoints } from './mock-new-endpoints.mjs'
import { handleClock } from './mock-clock.mjs'

export const MOCK_PASSWORD = 'demo-pass-fictional'

export const USERS = [
  { user_id: 'u-anna', email: 'anna.reyes@example.test', name: 'Anna Reyes', roles: ['HRAdmin'], employee_id: 'EMP-0001', job_title: 'HR Administrator', department: 'People & Culture', avatar_initials: 'AR', demo: true },
  { user_id: 'u-ben', email: 'ben.cruz@example.test', name: 'Ben Cruz', roles: ['Manager'], employee_id: 'EMP-0002', job_title: 'Operations Manager', department: 'Operations', avatar_initials: 'BC', demo: true },
  { user_id: 'u-carla', email: 'carla.dizon@example.test', name: 'Carla Dizon', roles: ['Employee'], employee_id: 'EMP-0003', job_title: 'Compliance Analyst', department: 'Compliance', avatar_initials: 'CD', demo: true },
  { user_id: 'u-dan', email: 'dan.ocampo@example.test', name: 'Dan Ocampo', roles: ['Finance'], employee_id: 'EMP-0004', job_title: 'Finance Officer', department: 'Finance', avatar_initials: 'DO', demo: true },
]

export const DASHBOARD = {
  summary: {
    headcount: { value: 1248, delta_pct: 3.2, period: 'last_month' },
    onboarding: { value: 24, status: 'in_progress' },
    offboarding: { value: 7, status: 'in_progress' },
    expiring_documents: { value: 36, window_days: 30 },
    policy_acknowledgement: { pct: 96, delta_pp: 2 },
  },
  headcount_trend: [
    { month: 'Aug', value: 1100 },
    { month: 'Sep', value: 1130 },
    { month: 'Oct', value: 1165 },
    { month: 'Nov', value: 1195 },
    { month: 'Dec', value: 1225 },
    { month: 'Jan', value: 1248 },
  ],
  onboarding: { total: 24, completed: 19, in_progress: 5, not_started: 0, pct: 80 },
  offboarding: { total: 7, completed: 5, in_progress: 2, not_started: 0, pct: 71 },
  directory: { total: 1248, full_time: 1158, part_time: 52, contractor: 26, intern: 12 },
  hr_cases: { active: 42, high: 6, medium: 14, low: 22, avg_resolution_days: 3.4, delta_pct: -18 },
  birthdays: [
    { name: 'Mark Del Rosario', team: 'Compliance Team', date: 'Jan 25', avatar_initials: 'MD' },
    { name: 'Liza Santos', team: 'Learning & Development', date: 'Jan 28', avatar_initials: 'LS' },
    { name: 'Ralph Lim', team: 'IT Operations', date: 'Jan 31', avatar_initials: 'RL' },
  ],
  holidays: [
    { month: 'Feb', day: 10, name: 'Chinese New Year', type: 'Public Holiday' },
    { month: 'Feb', day: 25, name: 'EDSA People Power Day', type: 'Public Holiday' },
    { month: 'Apr', day: 9, name: 'Araw ng Kagitingan (Day of Valor)', type: 'Public Holiday' },
  ],
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.json': 'application/json', '.ico': 'image/x-icon' }

function send(res, status, body, headers = {}) {
  const payload = body === undefined ? '' : JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers })
  res.end(status === 204 ? undefined : payload)
}

/** Resolves {json, raw}: `raw` is kept so multipart uploads can be inspected by the mock reimbursement routes. */
function readBody(req) {
  return new Promise((resolve) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      try {
        resolve({ json: raw ? JSON.parse(raw) : {}, raw })
      } catch {
        resolve({ json: {}, raw })
      }
    })
  })
}

/**
 * Starts a server that serves `distDir` (SPA fallback) and the mock API under /api.
 * Options let tests flip behaviour: demoAuth, entraConfigured, dashboardStatus, apiDown, accessTtlRequests.
 */
export async function startMock({ distDir, demoAuth = true } = {}) {
  const state = {
    demoAuth,
    dashboardStatus: 200, // set 500 to force the error state
    apiDown: false, // true => connection reset for /api
    revokeAccess: false, // true => any access token is rejected with 401 (refresh still works)
    revokeRefresh: false,
    failures: new Map(),
    log: [],
    refreshCalls: 0,
    reimb: createReimbState(),
    newApi: createNewEndpointsState(),
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost')
    if (url.pathname.startsWith('/api/')) {
      const route = url.pathname.slice(4)
      state.log.push(`${req.method} ${route}`)
      if (state.apiDown) return req.socket.destroy()
      const parsed = req.method === 'POST' || req.method === 'PATCH' ? await readBody(req) : { json: {}, raw: '' }
      const body = parsed.json
      const auth = req.headers.authorization || ''
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
      const userFor = () => {
        if (state.revokeAccess) return null
        const m = token.match(/^acc-(.+)$/)
        return m ? USERS.find((u) => u.user_id === m[1]) ?? null : null
      }

      if (route === '/auth/config' && req.method === 'GET') return send(res, 200, { demo_auth: state.demoAuth, entra_configured: false })
      if (route === '/auth/demo-users' && req.method === 'GET') {
        if (!state.demoAuth) return send(res, 404, { detail: 'Not found' })
        return send(res, 200, USERS.map((u) => ({ name: u.name, email: u.email, roles: u.roles, job_title: u.job_title })))
      }
      if (route === '/auth/login' && req.method === 'POST') {
        const key = String(body.email || '').toLowerCase()
        const user = USERS.find((u) => u.email === key)
        if (!user || body.password !== MOCK_PASSWORD) {
          const n = (state.failures.get(key) || 0) + 1
          state.failures.set(key, n)
          if (n > 5) return send(res, 429, { detail: 'Too many sign-in attempts. Please try again later.' })
          return send(res, 401, { detail: 'Invalid email or password' })
        }
        return send(res, 200, { access_token: `acc-${user.user_id}`, refresh_token: `ref-${user.user_id}`, token_type: 'bearer', user })
      }
      if (route === '/auth/refresh' && req.method === 'POST') {
        state.refreshCalls += 1
        const m = String(body.refresh_token || '').match(/^ref-(.+)$/)
        if (state.revokeRefresh || !m) return send(res, 401, { detail: 'Invalid refresh token' })
        state.revokeAccess = false
        return send(res, 200, { access_token: `acc-${m[1]}` })
      }
      if (route === '/auth/logout' && req.method === 'POST') return send(res, 204)
      if (route === '/auth/entra' && req.method === 'POST') return send(res, 501, { detail: 'Microsoft sign-in is not configured' })
      if (route === '/auth/me' && req.method === 'GET') {
        const user = userFor()
        return user ? send(res, 200, user) : send(res, 401, { detail: 'Not authenticated' })
      }
      if (route === '/hr/dashboard' && req.method === 'GET') {
        const user = userFor()
        if (!user) return send(res, 401, { detail: 'Not authenticated' })
        if (!user.roles.includes('HRAdmin')) return send(res, 403, { detail: 'Not allowed' })
        if (state.dashboardStatus !== 200) return send(res, state.dashboardStatus, { detail: 'Server error' })
        return send(res, 200, DASHBOARD)
      }
      if (route.startsWith('/reimbursements')) {
        const handled = handleReimbursements({ req, res, route, method: req.method, url, json: body, raw: parsed.raw, user: userFor(), state, send })
        if (handled) return
      }
      if (handleClock({ route, method: req.method, user: userFor(), send: (status, b) => (send(res, status, b), true) })) return
      if (handleNewEndpoints({ req, res, route, method: req.method, url, json: body, user: userFor(), state, send })) return
      return send(res, 404, { detail: 'Not found' })
    }

    // Static files from the built app, SPA fallback to index.html.
    let file = path.join(distDir, decodeURIComponent(url.pathname))
    if (!file.startsWith(distDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(distDir, 'index.html')
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' })
    fs.createReadStream(file).pipe(res)
  })

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return {
    state,
    port,
    origin: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}
