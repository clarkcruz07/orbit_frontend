// The Microsoft sign-in popup must return to a static page that runs no code and never redirects (the app itself redirects to /login and would
// wipe the sign-in result: MSAL hash_empty_error). Guard both halves.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const entra = readFileSync(join(root, 'src/auth/entra.ts'), 'utf8')
const bridge = readFileSync(join(root, 'public/auth-redirect.html'), 'utf8')

test('the popup redirect defaults to the static return page, not the app root', () => {
  assert.match(entra, /`\$\{window\.location\.origin\}\/auth-redirect\.html`/)
  assert.doesNotMatch(entra, /\|\| window\.location\.origin\s*$/m)
})

test('the return page runs no script, loads nothing external and never redirects', () => {
  assert.doesNotMatch(bridge, /<script/i)
  assert.doesNotMatch(bridge, /http-equiv\s*=\s*["']?refresh/i)
  assert.doesNotMatch(bridge, /location\s*[.=]/i)
  assert.doesNotMatch(bridge, /(src|href)\s*=\s*["']https?:/i)
})

test('the Microsoft library is still loaded lazily, only when configured', () => {
  assert.match(entra, /await import\('@azure\/msal-browser'\)/)
  assert.doesNotMatch(entra, /^import .*msal-browser/m)
})
