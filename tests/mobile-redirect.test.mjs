// The mobile sign-in return page must forward Microsoft's result only to the app's own links, never to an arbitrary address.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
// Run the page's script exactly as a browser would (a classic script with a `window`), not as a Node module.
const sandbox = { atob: (s) => Buffer.from(s, 'base64').toString('binary'), URLSearchParams }
sandbox.window = sandbox
vm.runInNewContext(readFileSync(join(root, 'public/mobile-redirect.js'), 'utf8'), sandbox)
const { targetFor, androidIntentFor } = sandbox.mobileRedirect

const b64url = (s) => Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const query = (back, extra = 'code=abc123') => `?${extra}&state=${encodeURIComponent('n0nce.' + b64url(back))}`

test('forwards the whole Microsoft result to the app link carried in state', () => {
  const q = query('exp://192.168.100.42:8081/--/auth')
  const t = targetFor(q)
  assert.ok(t.startsWith('exp://192.168.100.42:8081/--/auth?'))
  assert.ok(t.includes('code=abc123'))
  assert.ok(t.endsWith(q.slice(1)), 'everything Microsoft sent is passed on untouched')
})

test('accepts the real build link and the private Wi-Fi ranges', () => {
  for (const back of ['bluedge-people://auth', 'exp://10.0.0.7:8081/--/auth', 'exp://172.16.4.9:19000/--/auth', 'exp://172.31.255.1:8081/--/auth']) assert.ok(targetFor(query(back)), back)
})

test('refuses anything that is not the app: web addresses, other schemes, public hosts, extra paths', () => {
  for (const back of [
    'https://evil.example/steal',
    'javascript:alert(1)',
    'bluedge-people://other',
    'bluedge-people://auth/extra',
    'exp://8.8.8.8:8081/--/auth',
    'exp://192.168.1.5:8081/--/other',
    'exp://172.32.0.1:8081/--/auth',
    'exp://192.168.1.5.evil.example:8081/--/auth',
  ])
    assert.equal(targetFor(query(back)), null, back)
})

test('refuses a missing, malformed or undecodable state', () => {
  for (const q of ['', '?code=x', '?code=x&state=', '?code=x&state=nodot', '?code=x&state=n.%%%', '?state=.abc'])
    assert.equal(targetFor(q), null, q)
})

test('Microsoft errors are forwarded too, so the app can show them', () => {
  const t = targetFor(query('bluedge-people://auth', 'error=access_denied&error_description=No'))
  assert.ok(t.includes('error=access_denied'))
})

test('Android gets an explicit open-Expo-Go link for an exp:// target, and nothing for other targets', () => {
  const t = targetFor(query('exp://192.168.100.42:8081/--/auth'))
  const i = androidIntentFor(t)
  assert.ok(i.startsWith('intent://192.168.100.42:8081/--/auth?code=abc123'))
  assert.ok(i.endsWith('#Intent;scheme=exp;package=host.exp.exponent;end'))
  assert.equal(androidIntentFor(targetFor(query('bluedge-people://auth'))), null)
  assert.equal(androidIntentFor(null), null)
  assert.equal(androidIntentFor('https://evil.example/x?y=1'), null)
})

test('the static hosting config does not swallow the page into the app', () => {
  const cfg = JSON.parse(readFileSync(join(root, 'public/staticwebapp.config.json'), 'utf8'))
  assert.ok(cfg.navigationFallback.exclude.includes('/mobile-redirect.html'))
})
