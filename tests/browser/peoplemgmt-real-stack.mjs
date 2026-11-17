// Real-backend stack for the People management + Holidays E2E. Same idea as real-backend.mjs (the REAL backend with an in-memory DB
// and demo auth on a random port in 8101-8199, a Node server that serves the built app and proxies /api, everything torn down
// afterwards, nothing but 127.0.0.1 contacted, no .env read) with ONE difference: the built app comes from PEOPLEMGMT_DIST (a private
// build) when set, so other agents rebuilding the shared dist/ cannot affect this run. The database is ALWAYS in-memory: the real
// MongoDB URL is replaced by an unusable one in the child's environment, and port 8100 (the owner's app) is never contacted.
import http from 'node:http'
import net from 'node:net'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { backendDir, demoPassword } from './real-backend.mjs'
import { dist } from './peoplemgmt-helpers.mjs'

const PYTHON = process.platform === 'win32' ? path.join(backendDir, '.venv', 'Scripts', 'python.exe') : path.join(backendDir, '.venv', 'bin', 'python')
const BANNED = new Set([3000, 5173, 5174, 5180, 8000, 8100, 27017, 27018])
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.json': 'application/json', '.ico': 'image/x-icon' }

function tryListen(port) {
  return new Promise((resolve) => {
    const srv = net.createServer()
    srv.once('error', () => resolve(false))
    srv.listen(port, '127.0.0.1', () => srv.close(() => resolve(true)))
  })
}
async function freePortInRange(lo, hi) {
  const start = lo + Math.floor(Math.random() * (hi - lo + 1))
  for (let i = 0; i <= hi - lo; i++) {
    const port = lo + ((start - lo + i) % (hi - lo + 1))
    if (BANNED.has(port)) continue
    if (await tryListen(port)) return port
  }
  throw new Error(`no free port in ${lo}-${hi}`)
}
function killTree(child) {
  if (!child || child.exitCode !== null || !child.pid) return
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  else child.kill('SIGKILL')
}
async function waitFor(url, ms, child) {
  const end = Date.now() + ms
  let lastErr
  while (Date.now() < end) {
    if (child.exitCode !== null) throw new Error(`backend exited early (code ${child.exitCode}): ${child.stderrTail?.() ?? ''}`)
    try {
      const r = await fetch(url)
      if (r.ok) return
    } catch (e) {
      lastErr = e
    }
    await new Promise((r) => setTimeout(r, 150))
  }
  throw new Error(`timed out waiting for ${url}: ${lastErr}`)
}
function proxy(req, res, backendPort) {
  const target = req.url.replace(/^\/api/, '') || '/'
  const headers = { ...req.headers, host: `127.0.0.1:${backendPort}` }
  const up = http.request({ host: '127.0.0.1', port: backendPort, method: req.method, path: target, headers }, (r) => {
    res.writeHead(r.statusCode ?? 502, r.headers)
    r.pipe(res)
  })
  up.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ detail: 'Backend unavailable' }))
  })
  req.pipe(up)
}

export async function startPeopleStack() {
  if (!fs.existsSync(PYTHON)) throw new Error(`backend venv python not found at ${PYTHON}`)
  if (!fs.existsSync(path.join(dist, 'index.html'))) throw new Error(`built app missing in ${dist}: build first`)
  const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'people-pm-e2e-'))
  const backendPort = await freePortInRange(8101, 8199)

  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('PEOPLE_')))
  Object.assign(env, {
    PEOPLE_IGNORE_ENV_FILE: '1',
    PEOPLE_DEBUG: 'true',
    PEOPLE_LOCAL_DEMO_AUTH: 'true',
    PEOPLE_APP_PUBLIC_URL: 'http://localhost:5180',
    PEOPLE_DEMO_PASSWORD: demoPassword(),
    PEOPLE_JWT_SECRET_KEY: crypto.randomBytes(36).toString('base64url'),
    PEOPLE_BCRYPT_ROUNDS: '4',
    PEOPLE_DB_MODE: 'memory',
    PEOPLE_MONGODB_URL: 'mongodb://127.0.0.1:1/never-used',
    PEOPLE_DB_NAME: 'bluedge_people_e2e_never_used',
    PEOPLE_STORAGE_PATH: storage,
    PEOPLE_OCR_PROVIDER: 'demo',
    PEOPLE_GEMINI_API_KEY: '',
    PEOPLE_GEMINI_BASE_URL: '',
    PEOPLE_GEMINI_MODEL: '',
    PEOPLE_ENTRA_TENANT_ID: '',
    PEOPLE_ENTRA_CLIENT_ID: '',
    PYTHONDONTWRITEBYTECODE: '1',
    PYTHONUNBUFFERED: '1',
  })

  const child = spawn(PYTHON, ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', String(backendPort), '--log-level', 'warning'], { cwd: backendDir, env, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
  let stderr = ''
  child.stderr.on('data', (c) => {
    stderr = (stderr + c).slice(-4000)
  })
  child.stderrTail = () => stderr

  const web = http.createServer((req, res) => {
    if (req.url.startsWith('/api/')) return proxy(req, res, backendPort)
    const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname)
    let file = path.join(dist, pathname)
    if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dist, 'index.html')
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' })
    fs.createReadStream(file).pipe(res)
  })

  let closed = false
  const close = async () => {
    if (closed) return
    closed = true
    await new Promise((r) => web.close(() => r()))
    killTree(child)
    await new Promise((r) => setTimeout(r, 150))
    try {
      fs.rmSync(storage, { recursive: true, force: true })
    } catch {
      /* best effort */
    }
  }
  process.once('exit', () => killTree(child))

  try {
    await waitFor(`http://127.0.0.1:${backendPort}/health`, 60000, child)
    await new Promise((r) => web.listen(0, '127.0.0.1', r))
  } catch (e) {
    await close()
    throw e
  }
  return { origin: `http://127.0.0.1:${web.address().port}`, port: web.address().port, backendPort, close }
}
