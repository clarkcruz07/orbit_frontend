// Harness for the REAL-BACKEND browser tests and screenshots.
//   * starts backend/.venv python + uvicorn on a random free port in 8101-8199 (in-memory DB, demo auth ON,
//     demo OCR provider, temp storage dir) - the settings are passed only through that child's environment;
//   * starts a tiny Node server on a random free port that serves frontend/dist and proxies /api -> backend
//     (prefix stripped, like Vite), so the browser sees one origin and CORS never matters;
//   * tears both down (the whole process tree on Windows) and deletes the temp storage dir.
// It never reads any .env, never contacts anything but 127.0.0.1, and keeps Gemini OFF (OCR provider = demo).
import http from 'node:http'
import net from 'node:net'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { frontendDir, distDir } from './browser-env.mjs'

export const repoRoot = path.resolve(frontendDir, '..')
export const backendDir = path.join(repoRoot, 'backend')
export const receiptsDir = path.join(backendDir, 'tests', 'fixtures', 'receipts')
const PYTHON = process.platform === 'win32' ? path.join(backendDir, '.venv', 'Scripts', 'python.exe') : path.join(backendDir, '.venv', 'bin', 'python')

/** The fictional demo password documented in backend/.env.example (the committed example, not a real .env). */
export function demoPassword() {
  const text = fs.readFileSync(path.join(backendDir, '.env.example'), 'utf8')
  const m = /^PEOPLE_DEMO_PASSWORD=(.+)$/m.exec(text)
  if (!m) throw new Error('PEOPLE_DEMO_PASSWORD not found in backend/.env.example')
  return m[1].trim()
}

export const DEMO_DOMAIN = 'demo.bluedge-people.test'
export const PEOPLE = {
  anna: `anna.reyes@${DEMO_DOMAIN}`, // HRAdmin
  miguel: `miguel.santos@${DEMO_DOMAIN}`, // Manager of Jamie, Paolo
  carla: `carla.mendoza@${DEMO_DOMAIN}`, // Manager of Lia
  paolo: `paolo.cruz@${DEMO_DOMAIN}`, // Finance
  jamie: `jamie.delacruz@${DEMO_DOMAIN}`, // Employee (reports to Miguel)
  lia: `lia.ramos@${DEMO_DOMAIN}`, // Employee (reports to Carla)
}

const BANNED = new Set([3000, 5173, 5174, 8000, 27017])

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

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.json': 'application/json', '.ico': 'image/x-icon' }

export async function startRealStack() {
  if (!fs.existsSync(PYTHON)) throw new Error(`backend venv python not found at ${PYTHON}`)
  if (!fs.existsSync(path.join(distDir, 'index.html'))) throw new Error('dist/ is missing: run `npm run build` first')
  const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'people-e2e-storage-'))
  const backendPort = await freePortInRange(8101, 8199)

  // Start from the current environment minus any PEOPLE_* so nothing leaks in; then set exactly what this run needs.
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
    // belt and braces: even if the mode were ever flipped, the test backend can never reach a real database from backend/.env
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

  const child = spawn(PYTHON, ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', String(backendPort), '--log-level', 'warning'], {
    cwd: backendDir,
    env,
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
  })
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
      fs.rmSync(storage, { recursive: true, force: true })
    } catch {
      /* best effort */
    }
  }
  const onExit = () => {
    killTree(child)
  }
  process.once('exit', onExit)

  try {
    await waitFor(`http://127.0.0.1:${backendPort}/health`, 60000, child)
    await new Promise((r) => web.listen(0, '127.0.0.1', r))
  } catch (e) {
    await close()
    throw e
  }
  const port = web.address().port
  return { origin: `http://127.0.0.1:${port}`, port, backendPort, storage, close }
}

/** Signs in through the real UI. The password is the fictional demo one from .env.example. */
export async function signInReal(page, origin, email, password = demoPassword()) {
  await page.goto(`${origin}/login`)
  await page.fill('#email', email)
  await page.fill('#password', password)
  await page.click('button[type=submit]')
}

export function receiptPath(name) {
  return path.join(receiptsDir, name)
}
