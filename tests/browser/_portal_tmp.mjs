import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { frontendDir } from './browser-env.mjs'
const pw = await import(pathToFileURL(createRequire(path.join(frontendDir, 'node_modules', 'noop.js')).resolve('playwright-core')).href)
const chromium = pw.chromium ?? pw.default?.chromium
const browser = await chromium.connectOverCDP('http://127.0.0.1:9222')
const ctx = browser.contexts()[0]
console.log('open tabs:', ctx.pages().map((p) => new URL(p.url()).host + new URL(p.url()).pathname.slice(0, 40)).join(' | '))
const page = ctx.pages()[ctx.pages().length - 1]
await page.goto('https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationMenuBlade/~/Authentication/appId/7e287e6a-810e-4311-9f7c-ae68bef26676/isMSAApp~/false', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(12000)
await page.screenshot({ path: process.env.SHOT, fullPage: false })
const t = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
console.log(t.slice(0, 1400))
await browser.close()
