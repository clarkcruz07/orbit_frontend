// `npm run test:browser`: builds the app if needed, then runs the real-browser specs with RUN_BROWSER_TESTS=1.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const frontend = path.resolve(here, '../..')
const env = { ...process.env, RUN_BROWSER_TESTS: '1' }

// Always rebuild so the tests never run against a stale dist/. The build is HERMETIC: the Microsoft sign-in settings
// are blanked through the process environment (which wins over any .env file; this script never reads one), so the
// suites test the same "Microsoft sign-in isn't configured" build no matter what the owner has configured locally.
// Pass --no-build to reuse an existing dist/ that was built the same way.
if (!process.argv.includes('--no-build') || !fs.existsSync(path.join(frontend, 'dist', 'index.html'))) {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const hermetic = { ...env, VITE_ENTRA_CLIENT_ID: '', VITE_ENTRA_AUTHORITY: '', VITE_ENTRA_REDIRECT_URI: '' }
  const b = spawnSync(npm, ['run', 'build'], { cwd: frontend, stdio: 'inherit', env: hermetic, shell: process.platform === 'win32' })
  if (b.status !== 0) process.exit(b.status ?? 1)
}

const specs = fs.readdirSync(here).filter((f) => f.endsWith('.spec.mjs')).map((f) => path.join(here, f))
const r = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...specs], { stdio: 'inherit', env })
process.exit(r.status ?? 1)
