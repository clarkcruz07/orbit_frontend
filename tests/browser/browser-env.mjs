// Shared browser helpers: launch system Chrome through playwright-core and sign in through the real UI.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const here = path.dirname(fileURLToPath(import.meta.url))
export const frontendDir = path.resolve(here, '../..')
export const distDir = path.join(frontendDir, 'dist')

export const CHROME_PATH = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'

async function loadPlaywright() {
  const candidates = [process.env.PLAYWRIGHT_CORE_DIR, path.join(frontendDir, 'node_modules')].filter(Boolean)
  for (const dir of candidates) {
    try {
      const req = createRequire(path.join(dir, 'noop.js'))
      return await import(pathToFileURL(req.resolve('playwright-core')).href)
    } catch {
      /* try next */
    }
  }
  throw new Error('playwright-core not found (set PLAYWRIGHT_CORE_DIR or run npm install in frontend/)')
}

export async function launchBrowser() {
  if (!fs.existsSync(distDir)) throw new Error('dist/ is missing: run `npm run build` first')
  const pw = await loadPlaywright()
  const chromium = pw.chromium ?? pw.default?.chromium
  return chromium.launch({ executablePath: CHROME_PATH, headless: true, args: ['--no-first-run', '--disable-extensions'] })
}

export async function signIn(page, origin, email, password = 'demo-pass-fictional') {
  await page.goto(`${origin}/login`)
  await page.fill('#email', email)
  await page.fill('#password', password)
  await page.click('button[type=submit]')
}
