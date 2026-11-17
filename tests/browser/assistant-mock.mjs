// Self-contained MOCK API for the Bluedge Orbit specs (chat, sources, confirm-before-act actions, HR knowledge base, policy files).
// It also serves the built app from `distDir`. Everything is fictional. The mock plays "the server": the KB routes are HR only, a leave
// action is confirmed at most once, and `state.chatQueue` / `state.confirmQueue` / `state.force` let a test script exact answers.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { ALL_USERS, U } from './peoplemgmt-mock.mjs'

export { U }

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.json': 'application/json', '.ico': 'image/x-icon' }
const FORBIDDEN = { detail: 'You do not have access to this resource' }

/** A tiny but valid one-page PDF ("Leave policy"). */
export const PDF_BYTES = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 144]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n' +
    '4 0 obj<</Length 44>>stream\nBT /F1 18 Tf 20 70 Td (Leave policy) Tj ET\nendstream\nendobj\n' +
    '5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R/Size 6>>\n%%EOF\n',
  'latin1',
)

export const POLICIES = {
  'pol-leave': { title: 'Leave Policy', mime: 'application/pdf', filename: 'leave-policy.pdf' },
  'pol-conduct': { title: 'Code of Conduct', mime: 'text/plain', filename: 'conduct.txt', text: 'Be kind. Be on time. Ask when unsure.' },
  'pol-word': { title: 'Travel Policy', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', filename: 'travel.docx' },
}

export const LEAVE_SUMMARY = {
  leave_type_id: 'lt-vacation',
  leave_type_name: 'Vacation',
  start_date: '2026-12-21',
  end_date: '2026-12-24',
  days: 4,
  balance_after: 5,
  reason: 'Family trip',
}

/** Knowledge Base files the chat can cite without the list having them (ids used by the browser specs). */
export const SEED_FILES = {
  'kb-seed-file': { mime: 'application/pdf', filename: 'remote-work-guide.pdf', bytes: PDF_BYTES },
  'kb-seed-docx': { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', filename: 'onboarding.docx', bytes: Buffer.from('docx-bytes') },
}

/** Enough of multipart/form-data for the specs: the first file part and the plain text fields. */
function parseMultipart(buf, contentType) {
  const out = { fields: {}, file: null }
  const m = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType || '')
  if (!m) return out
  const boundary = Buffer.from(`--${m[1] || m[2]}`)
  let pos = buf.indexOf(boundary)
  while (pos !== -1) {
    const next = buf.indexOf(boundary, pos + boundary.length)
    if (next === -1) break
    const part = buf.subarray(pos + boundary.length + 2, next - 2)
    const sep = part.indexOf('\r\n\r\n')
    if (sep !== -1) {
      const head = part.subarray(0, sep).toString('utf8')
      const data = part.subarray(sep + 4)
      const name = /name="([^"]*)"/.exec(head)?.[1]
      const filename = /filename="([^"]*)"/.exec(head)?.[1]
      if (filename !== undefined) out.file = { name, filename, data }
      else if (name) out.fields[name] = data.toString('utf8')
    }
    pos = next
  }
  return out
}

export const COE_SUMMARY = {
  name: 'Carla Dizon',
  position: 'Compliance Analyst',
  employed_since: '2021-03-01',
  reason: 'Bank loan application',
  issue_date: '2026-11-16',
}
export const COE_FILE = { file_id: 'file-1', filename: 'Certificate_of_Employment_Carla_Dizon.pdf', content_type: 'application/pdf', size: 20480 }

export async function startAssistantMock({ distDir }) {
  const state = {
    config: { enabled: true, name: 'Bluedge Orbit', greeting: "Hi, I'm Bluedge Orbit. Ask me about company policies, or ask me to file a leave request for you.", suggestions: ['How many vacation days do I get?', 'File a leave request'] },
    /** Scripted answers, taken in order before the default rules: {status, body, headers?}. */
    chatQueue: [],
    /** Scripted answers for confirm, in order: {status, body}. */
    confirmQueue: [],
    actions: new Map(), // action_id -> {kind, used, cancelled}
    /** file ids that answer 404 (the file is gone). */
    missingFiles: new Set(),
    /** Knowledge Base items (text and file), newest last. */
    items: [],
    /** Bytes of uploaded KB files, by item id. */
    fileBytes: new Map(),
    status: { policies_indexed: 3, policies_unreadable: [{ policy_id: 'pol-scan', title: 'Scanned handbook', reason: 'No text could be read from this file.' }] },
    seq: 1,
    force: {},
    delay: {},
    log: [],
    calls: [],
  }

  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers })
    res.end(status === 204 ? undefined : JSON.stringify(body ?? {}))
  }
  const readRaw = (req) =>
    new Promise((resolve) => {
      const chunks = []
      req.on('data', (c) => chunks.push(c))
      req.on('end', () => resolve(Buffer.concat(chunks)))
    })
  const parseJson = (raw) => {
    try {
      return raw.length ? JSON.parse(raw.toString('utf8')) : {}
    } catch {
      return {}
    }
  }

  function defaultChat(messages) {
    const last = [...messages].reverse().find((m) => m.role === 'user')?.content ?? ''
    const q = last.toLowerCase()
    if (/coe|certificate of employment/.test(q)) {
      const id = `act-${state.seq++}`
      state.actions.set(id, { kind: 'generate_coe', used: false, cancelled: false })
      const why = /for (.+)$/.exec(last.trim())
      return { reply: 'I have prepared your Certificate of Employment. Please check the details, then press **Generate PDF**.', sources: [], action: { action_id: id, kind: 'generate_coe', summary: { ...COE_SUMMARY, reason: why ? why[1] : COE_SUMMARY.reason }, expires_at: '2026-11-16T10:30:00Z' } }
    }
    if (/leave/.test(q) && /(file|request|apply|book)/.test(q)) {
      const id = `act-${state.seq++}`
      state.actions.set(id, { kind: 'file_leave', used: false, cancelled: false })
      return { reply: 'I have prepared this leave request for you. Please check it, then press **Submit request**.', sources: [], action: { action_id: id, kind: 'file_leave', summary: { ...LEAVE_SUMMARY }, expires_at: '2026-11-16T10:30:00Z' } }
    }
    if (/(policy|policies|vacation|holiday|days)/.test(q)) {
      return {
        reply: 'You get **15 vacation days** a year.\n- Days are counted on working days only.\n- Unused days do not carry over.',
        sources: [
          { kind: 'policy', id: 'pol-leave', title: 'Leave Policy', version: 3, snippet: 'Full-time staff get 15 vacation days per year.' },
          { kind: 'kb', id: 'kb-seed-text', title: 'Booking time off', version: null, snippet: 'Tell your manager early, then file the request in the app.', has_file: false },
        ],
        action: null,
      }
    }
    return { reply: `You asked: ${last}\nI can answer questions about policies and file leave for you.`, sources: [], action: null }
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost')
    if (!url.pathname.startsWith('/api/')) {
      let file = path.join(distDir, decodeURIComponent(url.pathname))
      if (!file.startsWith(distDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(distDir, 'index.html')
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' })
      return fs.createReadStream(file).pipe(res)
    }
    const route = url.pathname.slice(4)
    const method = req.method
    const raw = method === 'GET' ? Buffer.alloc(0) : await readRaw(req)
    const body = method === 'GET' ? {} : parseJson(raw)
    const key = `${method} ${route}`
    state.log.push(key)
    state.calls.push({ method, route, body })

    const token = (req.headers.authorization || '').replace(/^Bearer /, '')
    const m = token.match(/^acc-(.+)$/)
    const user = m ? ALL_USERS.find((u) => u.user_id === m[1]) : null
    const wait = state.delay[key] ?? 0
    if (wait) await new Promise((r) => setTimeout(r, wait))

    if (route === '/auth/config') return send(res, 200, { demo_auth: false, entra_configured: false })
    if (route === '/auth/refresh') return send(res, 401, { detail: 'Invalid refresh token' })
    if (route === '/auth/logout') return send(res, 204)
    if (!user) return send(res, 401, { detail: 'Not authenticated' })
    if (state.force[key]) return send(res, state.force[key], { detail: 'Forced failure' })
    const hr = user.roles.includes('HRAdmin')

    if (route === '/auth/me') return send(res, 200, user)
    if (route === '/notifications') return send(res, 200, { items: [], unread_count: 0 })

    // ---- assistant
    if (route === '/assistant/config' && method === 'GET') return send(res, 200, state.config)
    if (route === '/assistant/chat' && method === 'POST') {
      const scripted = state.chatQueue.shift()
      if (scripted) return send(res, scripted.status, scripted.body, scripted.headers)
      return send(res, 200, defaultChat(Array.isArray(body.messages) ? body.messages : []))
    }
    const am = /^\/assistant\/actions\/([^/]+)\/(confirm|cancel)$/.exec(route)
    if (am && method === 'POST') {
      const a = state.actions.get(decodeURIComponent(am[1]))
      if (!a || a.used || a.cancelled) return send(res, 404, { detail: 'This request is no longer available. Ask me again.' })
      if (am[2] === 'cancel') {
        a.cancelled = true
        return send(res, 200, { ok: true })
      }
      const scripted = state.confirmQueue.shift()
      if (scripted) return send(res, scripted.status, scripted.body)
      a.used = true
      if (a.kind === 'generate_coe') return send(res, 200, { ok: true, kind: 'generate_coe', message: 'Your Certificate of Employment is ready.', request_id: null, status: null, file: { ...COE_FILE } })
      return send(res, 200, { ok: true, kind: 'file_leave', message: 'Your leave request was submitted for approval.', request_id: 'LV-0001', status: 'pending' })
    }
    // ---- Knowledge Base: the original of a FILE item is open to any signed-in user while the item is active (the chat shows it as a source)
    const kf = /^\/assistant\/kb\/items\/([^/]+)\/file$/.exec(route)
    if (kf && method === 'GET') {
      const id = decodeURIComponent(kf[1])
      const it = state.items.find((x) => x.item_id === id)
      const stored = it ? state.fileBytes.get(id) : SEED_FILES[id]
      if (!stored || (it && (!it.active || it.kind !== 'file'))) return send(res, 404, { detail: 'File not found' })
      res.writeHead(200, { 'Content-Type': stored.mime, 'Content-Disposition': `inline; filename="${stored.filename}"`, 'Cache-Control': 'no-store' })
      return res.end(stored.bytes)
    }
    if (route.startsWith('/assistant/kb/')) {
      if (!hr) return send(res, 403, FORBIDDEN)
      if (route === '/assistant/kb/status' && method === 'GET') {
        const n = (s) => state.items.filter((i) => i.status === s).length
        return send(res, 200, { ...state.status, items_total: state.items.length, items_indexed: n('indexed'), items_unreadable: n('unreadable'), articles: state.items.filter((i) => i.kind === 'text').length })
      }
      if (route === '/assistant/kb/items' && method === 'GET') return send(res, 200, { items: state.items })
      if (route === '/assistant/kb/items' && method === 'POST') {
        const title = String(body.title ?? '').trim()
        const text = String(body.body ?? '').trim()
        if (!title || title.length > 160) return send(res, 422, { detail: 'Title must be 1 to 160 characters' })
        if (!text || text.length > 20000) return send(res, 422, { detail: 'Text must be 1 to 20000 characters' })
        const item = { item_id: `kb-${state.seq++}`, kind: 'text', title, body: text, filename: null, content_type: null, size: null, status: 'indexed', reason: null, active: true, updated_at: '2026-11-16T02:00:00Z', updated_by_name: user.name }
        state.items.push(item)
        return send(res, 201, item)
      }
      if (route === '/assistant/kb/items/upload' && method === 'POST') {
        const form = parseMultipart(raw, req.headers['content-type'])
        if (!form.file) return send(res, 422, { detail: 'No file was sent' })
        const ext = (/\.([A-Za-z0-9]+)$/.exec(form.file.filename)?.[1] ?? '').toLowerCase()
        if (!['pdf', 'docx', 'txt', 'md'].includes(ext)) return send(res, 422, { detail: 'That file type is not supported. Use PDF, Word (.docx), .txt or .md.' })
        if (form.file.data.length > 10 * 1024 * 1024) return send(res, 413, { detail: 'File too large' })
        if (form.file.data.length === 0) return send(res, 422, { detail: 'The file is empty' })
        const mime = { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', txt: 'text/plain', md: 'text/markdown' }[ext]
        const unreadable = /scan/i.test(form.file.filename)
        const id = `kb-${state.seq++}`
        const item = {
          item_id: id,
          kind: 'file',
          title: (form.fields.title ?? '').trim() || form.file.filename.replace(/\.[^.]+$/, ''),
          body: '',
          filename: form.file.filename,
          content_type: mime,
          size: form.file.data.length,
          status: unreadable ? 'unreadable' : 'indexed',
          reason: unreadable ? 'No text could be read from this file (it may be a scan).' : null,
          active: true,
          updated_at: '2026-11-16T02:00:00Z',
          updated_by_name: user.name,
        }
        state.items.push(item)
        state.fileBytes.set(id, { mime, filename: form.file.filename, bytes: form.file.data })
        return send(res, 201, item)
      }
      const km = /^\/assistant\/kb\/items\/([^/]+)$/.exec(route)
      if (km) {
        const it = state.items.find((x) => x.item_id === decodeURIComponent(km[1]))
        if (!it) return send(res, 404, { detail: 'Item not found' })
        if (method === 'DELETE') {
          state.items = state.items.filter((x) => x !== it)
          state.fileBytes.delete(it.item_id)
          return send(res, 204)
        }
        if (method === 'PATCH') {
          if (('body' in body || 'title' in body) && it.kind === 'file' && 'body' in body) return send(res, 422, { detail: 'A file has no text to edit' })
          for (const k of ['title', 'body', 'active']) if (k in body) it[k] = body[k]
          it.updated_at = '2026-11-16T03:00:00Z'
          it.updated_by_name = user.name
          return send(res, 200, it)
        }
      }
      return send(res, 404, { detail: 'Not found' })
    }

    // ---- files Orbit generated (bearer token required, like every other call)
    const fm = /^\/assistant\/files\/([^/]+)$/.exec(route)
    if (fm && method === 'GET') {
      const id = decodeURIComponent(fm[1])
      if (state.missingFiles.has(id) || id !== COE_FILE.file_id) return send(res, 404, { detail: 'File not found' })
      res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${COE_FILE.filename}"`, 'Cache-Control': 'no-store' })
      return res.end(PDF_BYTES)
    }

    // ---- policy files
    const pm = /^\/documents\/policies\/([^/]+)(?:\/versions\/(\d+))?\/file$/.exec(route)
    if (pm && method === 'GET') {
      const p = POLICIES[decodeURIComponent(pm[1])]
      if (!p) return send(res, 404, { detail: 'Policy not found' })
      res.writeHead(200, { 'Content-Type': p.mime, 'Content-Disposition': `inline; filename="${p.filename}"`, 'Cache-Control': 'no-store' })
      return res.end(p.mime === 'application/pdf' ? PDF_BYTES : p.text ? Buffer.from(p.text) : Buffer.from('docx-bytes'))
    }
    return send(res, 404, { detail: 'Not found' })
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

/** A fresh mock + a context whose session token is seeded for `user` (the app restores the session through /auth/me). */
export async function withAssistant(browser, dist, user, fn, { viewport = { width: 1280, height: 900 }, setup, reducedMotion = 'no-preference' } = {}) {
  const mock = await startAssistantMock({ distDir: dist })
  setup?.(mock)
  const ctx = await browser.newContext({ viewport, reducedMotion })
  await ctx.addInitScript((t) => { try { localStorage.setItem('people.accessToken', t) } catch { /* the PDF frame has no storage */ } }, `acc-${user.user_id}`)
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text())
  })
  try {
    await fn({ page, mock, errors, ctx, go: (p, ready) => page.goto(`${mock.origin}${p}`).then(() => page.waitForSelector(ready)) })
  } finally {
    await ctx.close()
    await mock.close()
  }
}
