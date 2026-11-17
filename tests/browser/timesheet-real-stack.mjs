// Real-backend stack for the Attendance & Timesheet E2E. Same idea as real-backend.mjs (real backend with an in-memory
// DB and demo auth on a random port in 8101-8199, a Node server that serves frontend/dist and proxies /api, everything
// torn down afterwards, nothing but 127.0.0.1 contacted, no .env read) with ONE difference: the backend is started through
// timesheet-clock-server.py so a test can move the backend's injectable clock (see docs/api/timesheet.md) by writing an offset.
import http from 'node:http'
import net from 'node:net'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { spawn, spawnSync } from 'node:child_process'
import { distDir as defaultDist } from './browser-env.mjs'
import { backendDir, demoPassword } from './real-backend.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
/** TS_DIST_DIR lets a developer point the tests at a private build instead of the shared dist/. */
const distDir = process.env.TS_DIST_DIR ? path.resolve(process.env.TS_DIST_DIR) : defaultDist
const PYTHON = process.platform === 'win32' ? path.join(backendDir, '.venv', 'Scripts', 'python.exe') : path.join(backendDir, '.venv', 'bin', 'python')
const BANNED = new Set([3000, 5173, 5174, 8000, 27017])
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

export async function startTimesheetStack() {
  if (!fs.existsSync(PYTHON)) throw new Error(`backend venv python not found at ${PYTHON}`)
  if (!fs.existsSync(path.join(distDir, 'index.html'))) throw new Error('dist/ is missing: run `npm run build` first')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'people-ts-e2e-'))
  const storage = path.join(dir, 'storage')
  fs.mkdirSync(storage)
  const clockFile = path.join(dir, 'clock.json')
  const backendPort = await freePortInRange(8101, 8199)

  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('PEOPLE_')))
  Object.assign(env, {
    // the test backend must never read the owner's real backend/.env (it points at a real database and holds real sign-in settings)
    PEOPLE_IGNORE_ENV_FILE: '1',
    PEOPLE_DEBUG: 'true',
    PEOPLE_LOCAL_DEMO_AUTH: 'true',
    PEOPLE_APP_PUBLIC_URL: 'http://localhost:5180',
    PEOPLE_DEMO_PASSWORD: demoPassword(),
    PEOPLE_JWT_SECRET_KEY: crypto.randomBytes(36).toString('base64url'),
    PEOPLE_BCRYPT_ROUNDS: '4',
    PEOPLE_DB_MODE: 'memory',
    PEOPLE_STORAGE_PATH: storage,
    PEOPLE_OCR_PROVIDER: 'demo',
    PEOPLE_GEMINI_API_KEY: '',
    PEOPLE_GEMINI_BASE_URL: '',
    PEOPLE_GEMINI_MODEL: '',
    PEOPLE_ENTRA_TENANT_ID: '',
    PEOPLE_ENTRA_CLIENT_ID: '',
    PEOPLE_COMPANY_TIMEZONE: 'Asia/Manila',
    PYTHONDONTWRITEBYTECODE: '1',
    PYTHONUNBUFFERED: '1',
  })

  const child = spawn(PYTHON, [path.join(here, 'timesheet-clock-server.py'), String(backendPort), clockFile], { cwd: backendDir, env, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
  let stderr = ''
  child.stderr.on('data', (c) => {
    stderr = (stderr + c).slice(-4000)
  })
  child.stderrTail = () => stderr

  const web = http.createServer((req, res) => {
    if (req.url.startsWith('/api/')) return proxy(req, res, backendPort)
    const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname)
    let file = path.join(distDir, pathname)
    if (!file.startsWith(distDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(distDir, 'index.html')
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
      fs.rmSync(dir, { recursive: true, force: true })
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
  const port = web.address().port
  return {
    origin: `http://127.0.0.1:${port}`,
    port,
    backendPort,
    /** Moves the backend clock `seconds` ahead of real time (0 = real time). Takes effect on the next request. */
    setClockOffset(seconds) {
      fs.writeFileSync(clockFile, JSON.stringify({ offset_seconds: seconds }))
    },
    close,
  }
}
