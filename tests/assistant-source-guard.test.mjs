import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { listSrc, readSrc } from './helpers/load-ts.mjs'

const root = path.join(process.cwd(), 'src')
const rel = (f) => path.relative(root, f).replace(/\\/g, '/')
const files = listSrc('modules/assistant', ['.tsx', '.ts']).map(rel)
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

test('the module has its widget, mascot, preview, cards, HR page, logic and routes', () => {
  for (const f of ['ChatWidget.tsx', 'OrbitMascot.tsx', 'SourcePreview.tsx', 'ActionCards.tsx', 'KnowledgeBasePage.tsx', 'KbUploadCard.tsx', 'KbTextEditorCard.tsx', 'RichTextView.tsx', 'richtext.ts', 'editor.ts', 'logic.ts', 'routes.tsx', 'assistant.css']) {
    assert.ok(fs.existsSync(path.join(root, 'modules/assistant', f)), f)
  }
  assert.ok(fs.existsSync(path.join(root, 'api/assistant.ts')))
})

test('assistant text is never rendered as HTML and nothing is written to browser storage', () => {
  for (const f of [...files, 'api/assistant.ts']) {
    const src = strip(readSrc(f))
    assert.doesNotMatch(src, /dangerouslySetInnerHTML|innerHTML|insertAdjacentHTML|document\.write|eval\(/, f)
    assert.doesNotMatch(src, /localStorage|sessionStorage|indexedDB/, `${f}: the conversation lives in memory for the session only`)
    assert.doesNotMatch(src, /\bfetch\(/, `${f}: every call goes through the shared api client`)
    assert.doesNotMatch(src, /['`](Employee|Manager|HRAdmin|Finance)['`]/, `${f}: the server decides access, not role names`)
  }
})

test('the launcher is mounted once, in the authenticated shell only', () => {
  const shell = readSrc('shell/AppShell.tsx')
  assert.equal((shell.match(/<ChatWidget \/>/g) ?? []).length, 1)
  assert.doesNotMatch(readSrc('pages/Login.tsx'), /ChatWidget/)
  assert.equal((readSrc('App.tsx').match(/ChatWidget/g) ?? []).length, 0)
})

test('the Knowledge Base page is a module route at /knowledge-base, the old settings address redirects, and Settings links to it', () => {
  const routes = readSrc('modules/assistant/routes.tsx')
  assert.match(routes, /path: 'knowledge-base'/)
  assert.match(routes, /path: 'settings\/knowledge-base', element: <Navigate to="\/knowledge-base" replace \/>/)
  const catalogs = readSrc('modules/settings/CatalogsTab.tsx')
  assert.match(catalogs, /to: '\/knowledge-base'/)
  assert.doesNotMatch(catalogs, /\/settings\/knowledge-base/)
  assert.match(readSrc('shell/navigation.ts'), /id: 'knowledge-base'[^}]*onlyView: 'hr'/)
})

test('the Knowledge Base text editor is a plain textarea (no contentEditable, no HTML) and the preview uses the shared renderer', () => {
  const editor = strip(readSrc('modules/assistant/KbTextEditorCard.tsx'))
  assert.doesNotMatch(editor, /contentEditable|contenteditable|execCommand/)
  assert.match(editor, /<textarea/)
  assert.match(editor, /<RichText text=\{body\} \/>/)
  assert.match(strip(readSrc('modules/assistant/ChatWidget.tsx')), /<RichText text=/)
  const upload = strip(readSrc('modules/assistant/KbUploadCard.tsx'))
  assert.match(upload, /validateUpload\(/)
  assert.match(upload, /accept=\{KB_ACCEPT\}/)
})

test('the sprite sheet is two 512px frames and the CSS uses it as a two-frame sprite with reduced-motion support', () => {
  const png = fs.readFileSync(path.join(process.cwd(), 'public/orbit/orbit-sprite.png'))
  assert.equal(png.subarray(1, 4).toString('latin1'), 'PNG')
  assert.equal(png.readUInt32BE(16), 1024)
  assert.equal(png.readUInt32BE(20), 512)
  const css = readSrc('modules/assistant/assistant.css')
  assert.match(css, /url\('\/orbit\/orbit-sprite\.png'\)/)
  assert.match(css, /background-size: 200% 100%/)
  assert.match(css, /orbit-mascot\[data-frame='1'\][\s\S]*?background-position: 100% 0/)
  assert.match(css, /@keyframes orbit-talk/)
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]*?\.orbit-talking/)
  const widget = readSrc('modules/assistant/ChatWidget.tsx')
  assert.match(widget, /OPEN_TALK_MS/)
  assert.match(widget, /Chat with \$\{NAME\}/)
})

test('generated files are fetched through the signed-in client as a blob and saved from a temporary object URL', () => {
  const api = readSrc('api/assistant.ts')
  assert.match(api, /generatedFile:[\s\S]*?\/assistant\/files\/[\s\S]*?responseType: 'blob'/)
  const dl = readSrc('modules/assistant/download.ts')
  assert.match(dl, /assistantApi\.generatedFile\(/)
  assert.match(dl, /URL\.createObjectURL/)
  assert.match(dl, /URL\.revokeObjectURL/)
  assert.match(dl, /\.download = safeFileName\(/)
  for (const f of files) {
    assert.doesNotMatch(strip(readSrc(f)), /href=\{?[`'"]\/?(api\/)?assistant\/files/, `${f}: never a bare link to the file endpoint (it needs the bearer token)`)
  }
  const widget = readSrc('modules/assistant/ChatWidget.tsx')
  assert.match(widget, /FileActions/)
  assert.match(widget, /Download PDF/)
})

test('action cards: one renderer per kind (file_leave and generate_coe) and nothing is sent without a click', () => {
  const cards = readSrc('modules/assistant/ActionCards.tsx')
  assert.match(cards, /ACTION_RENDERERS[\s\S]*?file_leave: FileLeaveCard/)
  assert.match(cards, /ACTION_RENDERERS[\s\S]*?generate_coe: GenerateCoeCard/)
  assert.match(cards, /confirmLabel="Generate PDF"/)
  assert.match(cards, /employee record\. The certificate is a draft until HR \/ the Managing Director signs it\./)
  const widget = readSrc('modules/assistant/ChatWidget.tsx')
  // confirm is only reachable through the card's callback, never from the reply handler
  assert.equal((widget.match(/assistantApi\.confirm\(/g) ?? []).length, 1)
  const askBody = widget.slice(widget.indexOf('async function ask('), widget.indexOf('function send('))
  assert.doesNotMatch(askBody, /confirm\(/)
})
