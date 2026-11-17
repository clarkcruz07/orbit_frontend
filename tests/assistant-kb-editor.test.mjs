// Knowledge Base: the text editor helpers, upload checks and the kind/status pills (pure logic).
import test from 'node:test'
import assert from 'node:assert/strict'
import { loadTs } from './helpers/load-ts.mjs'

const E = await loadTs('modules/assistant/editor.ts')
const L = await loadTs('modules/assistant/logic.ts')
const R = await loadTs('modules/assistant/richtext.ts')
const st = (text, start, end = start) => ({ text, start, end })

test('editor: bold wraps the selection, unwraps it again, and with no selection opens an empty pair with the caret inside', () => {
  assert.deepEqual(E.toggleBold(st('say hello now', 4, 9)), st('say **hello** now', 6, 11))
  // toggling the result off (stars just outside the selection)
  assert.deepEqual(E.toggleBold(st('say **hello** now', 6, 11)), st('say hello now', 4, 9))
  // stars inside the selection
  assert.deepEqual(E.toggleBold(st('say **hello** now', 4, 13)), st('say hello now', 4, 9))
  // no selection
  assert.deepEqual(E.toggleBold(st('abc', 3)), st('abc****', 5, 5))
  assert.deepEqual(E.toggleBold(st('ab****c', 4)), st('abc', 2, 2)) // caret inside an empty pair removes it
  assert.deepEqual(E.toggleBold(st('', 0)), st('****', 2, 2))
  // twice on the same selection is a round trip
  const once = E.toggleBold(st('word', 0, 4))
  assert.equal(once.text, '**word**')
  assert.equal(E.toggleBold(once).text, 'word')
})

test('editor: bullets and numbering toggle on a line and on several lines', () => {
  assert.deepEqual(E.toggleList(st('one', 1), 'ul'), st('- one', 5, 5))
  assert.equal(E.toggleList(st('- one', 5), 'ul').text, 'one') // already a bullet: back to plain
  const three = st('a\nb\nc', 0, 5)
  const bullets = E.toggleList(three, 'ul')
  assert.equal(bullets.text, '- a\n- b\n- c')
  assert.deepEqual([bullets.start, bullets.end], [0, bullets.text.length])
  assert.equal(E.toggleList(bullets, 'ul').text, 'a\nb\nc')
  const numbers = E.toggleList(three, 'ol')
  assert.equal(numbers.text, '1. a\n2. b\n3. c')
  assert.equal(E.toggleList(numbers, 'ol').text, 'a\nb\nc')
  // switching kind replaces the markers; blank lines stay blank and do not count
  assert.equal(E.toggleList(st(bullets.text, 0, bullets.text.length), 'ol').text, '1. a\n2. b\n3. c')
  assert.equal(E.toggleList(st('a\n\nb', 0, 4), 'ol').text, '1. a\n\n2. b')
  // only the touched lines change; a selection ending right after a line break does not take the next line
  assert.equal(E.toggleList(st('x\ny\nz', 2, 4), 'ul').text, 'x\n- y\nz')
  assert.equal(E.toggleList(st('x\ny\nz', 0, 2), 'ul').text, '- x\ny\nz')
  // an empty line gets a marker so the person can start typing
  assert.deepEqual(E.toggleList(st('', 0), 'ul'), st('- ', 2, 2))
})

test('editor: Enter continues a list, counts up a numbered list, and ends the list on an empty item', () => {
  assert.deepEqual(E.handleEnter(st('- one', 5)), st('- one\n- ', 8, 8))
  assert.deepEqual(E.handleEnter(st('1. one', 6)), st('1. one\n2. ', 10, 10))
  assert.deepEqual(E.handleEnter(st('9. nine', 7)), st('9. nine\n10. ', 12, 12))
  // an empty item ends the list: the marker goes away, nothing else changes
  assert.deepEqual(E.handleEnter(st('- one\n- ', 8)), st('- one\n', 6, 6))
  assert.deepEqual(E.handleEnter(st('1. a\n2. ', 8)), st('1. a\n', 5, 5))
  // in the middle of an item the rest moves to the new item
  assert.deepEqual(E.handleEnter(st('- onetwo', 5)), st('- one\n- two', 8, 8))
  // not in a list, a selection, or inside the marker: the browser handles Enter
  assert.equal(E.handleEnter(st('plain', 5)), null)
  assert.equal(E.handleEnter(st('- one', 1, 4)), null)
  assert.equal(E.handleEnter(st('- one', 1)), null)
  assert.equal(E.handleEnter(st('**bold** start', 14)), null)
  assert.equal(E.activeList(st('- a', 3)), 'ul')
  assert.equal(E.activeList(st('1. a', 4)), 'ol')
  assert.equal(E.activeList(st('a', 1)), null)
})

test('what the editor produces is exactly what the renderer understands', () => {
  let s = st('Rules', 0, 5)
  s = E.toggleBold(s)
  s = { text: `${s.text}\nfirst`, start: s.text.length + 6, end: s.text.length + 6 }
  s = E.toggleList(s, 'ol')
  const next = E.handleEnter({ ...s, start: s.text.length, end: s.text.length })
  const text = `${next.text}second`
  const blocks = R.richBlocks(text)
  assert.deepEqual(blocks.map((b) => b.type), ['p', 'ol'])
  assert.equal(blocks[0].lines[0][0].bold, true)
  assert.deepEqual(blocks[1].items.map((i) => i[0].text), ['first', 'second'])
})

test('uploads are checked before anything is sent: type by extension, size, empty files', () => {
  const MB = 1024 * 1024
  assert.equal(L.validateUpload({ name: 'Handbook.PDF', size: 5 * MB }), null)
  assert.equal(L.validateUpload({ name: 'notes.docx', size: 100 }), null)
  assert.equal(L.validateUpload({ name: 'a.txt', size: 1 }), null)
  assert.equal(L.validateUpload({ name: 'a.md', size: 10 * MB }), null) // exactly 10 MB is fine
  assert.match(L.validateUpload({ name: 'a.md', size: 10 * MB + 1 }), /limit is 10 MB/)
  assert.match(L.validateUpload({ name: 'old.doc', size: 100 }), /\.docx/)
  assert.match(L.validateUpload({ name: 'run.exe', size: 100 }), /not supported/)
  assert.match(L.validateUpload({ name: 'noextension', size: 100 }), /not supported/)
  assert.match(L.validateUpload({ name: 'pdf', size: 100 }), /not supported/)
  assert.match(L.validateUpload({ name: 'empty.pdf', size: 0 }), /empty/)
  assert.match(L.validateUpload({ name: 'archive.pdf.zip', size: 100 }), /not supported/)
  assert.equal(L.KB_ACCEPT, '.pdf,.docx,.txt,.md')
  assert.equal(L.titleFromFileName('Leave_policy_2026.pdf'), 'Leave policy 2026')
  assert.equal(L.fileExtension('A.B.PDF'), 'pdf')
})

test('Knowledge Base pills: kind from the content type or the file name, status with its reason', () => {
  const PDF = 'application/pdf'
  const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  assert.deepEqual(L.kindPill({ kind: 'text', filename: null, content_type: null }), { label: 'Text', tone: 'violet' })
  assert.equal(L.kindPill({ kind: 'file', filename: 'x.bin', content_type: PDF }).label, 'PDF')
  assert.equal(L.kindPill({ kind: 'file', filename: 'x.docx', content_type: DOCX }).label, 'Word')
  assert.equal(L.kindPill({ kind: 'file', filename: 'x.docx', content_type: null }).label, 'Word')
  assert.equal(L.kindPill({ kind: 'file', filename: 'x.md', content_type: 'text/markdown' }).label, 'Text')
  assert.equal(L.kindPill({ kind: 'file', filename: 'x.txt', content_type: 'text/plain; charset=utf-8' }).label, 'Text')
  assert.equal(L.kindPill({ kind: 'file', filename: 'x.pdf', content_type: null }).label, 'PDF')
  assert.equal(L.kindPill({ kind: 'file', filename: 'x.zip', content_type: 'application/zip' }).label, 'File')
  assert.deepEqual(L.statusPill({ status: 'indexed', reason: null }), { label: 'Indexed', tone: 'green', title: 'Orbit can answer from this.' })
  const bad = L.statusPill({ status: 'unreadable', reason: 'No text could be read from this file.' })
  assert.deepEqual([bad.label, bad.tone, bad.title], ["Can't be read", 'amber', 'No text could be read from this file.'])
  assert.match(L.statusPill({ status: 'unreadable', reason: null }).title, /could not read/)
})
