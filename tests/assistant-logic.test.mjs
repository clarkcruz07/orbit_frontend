import test from 'node:test'
import assert from 'node:assert/strict'
import { loadTs } from './helpers/load-ts.mjs'

const L = await loadTs('modules/assistant/logic.ts')
const A = await loadTs('api/assistant.ts')

const turn = (role, content, kind = 'text') => ({ id: Math.random().toString(36), role, kind, content })

test('capText trims and limits one message to 2000 characters; canSend needs text and no request in flight', () => {
  assert.equal(L.capText('  hello  '), 'hello')
  assert.equal(L.capText('x'.repeat(2500)).length, 2000)
  assert.equal(L.canSend('hi', false), true)
  assert.equal(L.canSend('   ', false), false)
  assert.equal(L.canSend('hi', true), false)
})

test('toHistory sends only real conversation turns, the last 12, starting with the person', () => {
  const items = []
  for (let i = 0; i < 10; i += 1) {
    items.push(turn('user', `q${i}`), turn('assistant', `a${i}`))
  }
  items.splice(3, 0, turn('assistant', 'network trouble', 'error'), turn('assistant', 'Submitted', 'notice'))
  const h = L.toHistory(items)
  assert.equal(h.length <= L.HISTORY_CAP, true)
  assert.equal(h[0].role, 'user')
  assert.ok(h.every((m) => m.content !== 'network trouble' && m.content !== 'Submitted'))
  assert.equal(h.at(-1).content, 'a9')
  // 20 real turns -> the last 12 are q4..a9
  assert.deepEqual(h.map((m) => m.content).slice(0, 2), ['q4', 'a4'])
  assert.equal(L.toHistory([turn('user', 'y'.repeat(3000))])[0].content.length, 2000)
  assert.deepEqual(L.toHistory([turn('assistant', 'hello'), turn('user', 'hi')]), [{ role: 'user', content: 'hi' }])
  assert.deepEqual(L.toHistory([]), [])
})

test('spriteState: closed is frame 0 and never animates; open is frame 1 and flaps only while talking and only if motion is allowed', () => {
  assert.deepEqual(L.spriteState({ open: false, talking: true, reducedMotion: false }), { frame: 0, animate: false })
  assert.deepEqual(L.spriteState({ open: false, talking: false, reducedMotion: false }), { frame: 0, animate: false })
  assert.deepEqual(L.spriteState({ open: true, talking: false, reducedMotion: false }), { frame: 1, animate: false })
  assert.deepEqual(L.spriteState({ open: true, talking: true, reducedMotion: false }), { frame: 1, animate: true })
  assert.deepEqual(L.spriteState({ open: true, talking: true, reducedMotion: true }), { frame: 1, animate: false })
  assert.equal(L.OPEN_TALK_MS, 2500)
})

test('chat error wording: not configured, rate limit, network, server detail, generic', () => {
  const f = (o) => ({ status: 500, code: null, detail: null, retryAfter: null, ...o })
  assert.equal(L.chatErrorText(f({ status: 503, code: 'llm_not_configured' })), "The assistant isn't switched on yet. Ask your administrator.")
  assert.match(L.chatErrorText(f({ status: 429, retryAfter: 20 })), /wait 20 seconds/)
  assert.match(L.chatErrorText(f({ status: 429 })), /wait a moment/)
  assert.match(L.chatErrorText(f({ status: null })), /can't reach/i)
  assert.equal(L.chatErrorText(f({ status: 502, detail: 'The AI service could not be reached.' })), 'The AI service could not be reached.')
  assert.equal(L.chatErrorText(f({ status: 500, detail: 'x'.repeat(400) })), L.GENERIC_ERROR_TEXT)
  assert.equal(L.chatErrorText(f({ status: 502 })), L.GENERIC_ERROR_TEXT)
  assert.equal(L.isRetryable(f({ status: 503, code: 'llm_not_configured' })), false)
  assert.equal(L.isRetryable(f({ status: 502 })), true)
  assert.equal(L.isRetryable(f({ status: 429 })), true)
  assert.equal(L.isRetryable(f({ status: null })), true)
  assert.equal(L.isRetryable(f({ status: 404 })), false)
})

test('submitting a card: server errors never show raw details, refusals show the reason', () => {
  const f = (o) => ({ status: 500, code: null, detail: null, retryAfter: null, ...o })
  assert.equal(L.confirmErrorText(f({ status: 500, detail: 'Traceback...' })), L.GENERIC_ERROR_TEXT)
  assert.equal(L.confirmErrorText(f({ status: 409, detail: 'You do not have enough leave left.' })), 'You do not have enough leave left.')
  assert.equal(L.confirmErrorText(f({ status: 404 })), 'This request could not be submitted.')
  assert.match(L.confirmErrorText(f({ status: null })), /can't reach/i)
  assert.match(L.confirmErrorText(f({ status: 429, retryAfter: 5 })), /wait 5 seconds/)
})

test('generated files: safe save names, friendly download errors, sizes', () => {
  const f = (o) => ({ status: 500, code: null, detail: null, retryAfter: null, ...o })
  assert.equal(L.safeFileName('Certificate_of_Employment_Carla_Dizon.pdf'), 'Certificate_of_Employment_Carla_Dizon.pdf')
  assert.equal(L.safeFileName('Certificate of Employment - Carla.pdf'), 'Certificate of Employment - Carla.pdf')
  assert.equal(L.safeFileName('..\\..\\evil/name?.pdf').includes('/'), false)
  assert.equal(L.safeFileName('..\\..\\evil/name?.pdf').includes('\\'), false)
  assert.equal(L.safeFileName('..\\..\\evil/name?.pdf').startsWith('.'), false)
  assert.equal(L.safeFileName('no extension'), 'no extension.pdf')
  assert.equal(L.safeFileName(''), 'document.pdf')
  assert.equal(L.safeFileName(null), 'document.pdf')
  assert.equal(L.safeFileName('a'.repeat(300) + '.pdf').length <= 125, true)
  assert.equal(L.safeFileName('x\u0000y.pdf'), 'x_y.pdf')
  assert.equal(L.fileErrorText(f({ status: 404 })), 'This file is no longer available. Ask Orbit to generate it again.')
  assert.equal(L.fileErrorText(f({ status: 410 })), L.FILE_GONE_TEXT)
  assert.match(L.fileErrorText(f({ status: null })), /can't reach/i)
  assert.match(L.fileErrorText(f({ status: 403 })), /cannot open/i)
  assert.equal(L.fileErrorText(f({ status: 500 })), L.FILE_FAILED_TEXT)
  assert.equal(L.isFileRetryable(f({ status: 500 })), true)
  assert.equal(L.isFileRetryable(f({ status: null })), true)
  assert.equal(L.isFileRetryable(f({ status: 404 })), false)
  assert.equal(L.fileSizeText(20480), '20 KB')
  assert.equal(L.fileSizeText(512), '512 B')
  assert.equal(L.fileSizeText(null), '')
  assert.equal(L.fileSizeText(3 * 1024 * 1024), '3.0 MB')
})

test('source labels and the policy file route (a given version, or the current one); a Knowledge Base text item has no file', () => {
  assert.equal(L.sourceLabel({ title: 'Leave Policy', version: 3 }), 'Leave Policy v3')
  assert.equal(L.sourceLabel({ title: 'Booking time off', version: null }), 'Booking time off')
  assert.equal(L.sourceFilePath({ kind: 'policy', id: 'pol-1', version: 3, has_file: false }), '/documents/policies/pol-1/versions/3/file')
  assert.equal(L.sourceFilePath({ kind: 'policy', id: 'pol 1/x', version: null, has_file: false }), '/documents/policies/pol%201%2Fx/file')
  assert.equal(L.sourceFilePath({ kind: 'kb', id: 'k1', version: null, has_file: false }), null)
  assert.equal(L.sourceFilePath({ kind: 'kb', id: 'k 1', version: null, has_file: true }), '/assistant/kb/items/k%201/file')
})

test('preview kinds and safe download names', () => {
  assert.equal(L.previewKind('application/pdf'), 'pdf')
  assert.equal(L.previewKind('Application/PDF; charset=x'), 'pdf')
  assert.equal(L.previewKind('text/plain'), 'text')
  assert.equal(L.previewKind('image/png'), 'image')
  assert.equal(L.previewKind('application/vnd.openxmlformats-officedocument.wordprocessingml.document'), 'none')
  assert.equal(L.previewKind('text/html'), 'none') // never rendered
  assert.equal(L.previewKind(null), 'none')
  assert.equal(L.downloadName('inline; filename="leave-policy.pdf"', 'Leave Policy', 'application/pdf'), 'leave-policy.pdf')
  assert.equal(L.downloadName('attachment; filename="../../evil.pdf"', 'x', 'application/pdf').includes('/'), false)
  assert.equal(L.downloadName(null, 'Leave Policy', 'application/pdf'), 'Leave Policy.pdf')
  assert.equal(L.downloadName('', '', null), 'document')
})

test('action card reducer: one decision per card; transient problems keep it usable, refusals close it', () => {
  const r = L.actionReducer
  let s = L.INITIAL_ACTION
  assert.equal(L.isActionOpen(s), true)
  s = r(s, { type: 'confirm' })
  assert.equal(s.phase, 'confirming')
  assert.equal(r(s, { type: 'confirm' }).phase, 'confirming') // no double submit
  assert.equal(r(s, { type: 'cancel' }).phase, 'confirming') // cannot cancel mid-submit
  const ok = r(s, { type: 'confirmed', message: 'Submitted for approval.', requestId: 'LV-1' })
  assert.deepEqual([ok.phase, ok.message, ok.requestId], ['done', 'Submitted for approval.', 'LV-1'])
  assert.equal(L.isActionOpen(ok), false)
  assert.equal(L.actionStatusText(ok), 'Submitted for approval.')
  assert.equal(r(ok, { type: 'confirm' }).phase, 'done') // read-only afterwards
  const transient = r(s, { type: 'confirmFailed', message: 'Try again', retryable: true })
  assert.deepEqual([transient.phase, transient.warning], ['pending', 'Try again'])
  assert.equal(L.isActionOpen(transient), true)
  const refused = r(s, { type: 'confirmFailed', message: 'Not enough leave left.', retryable: false })
  assert.deepEqual([refused.phase, refused.message], ['failed', 'Not enough leave left.'])
  assert.equal(L.isActionOpen(refused), false)
  let c = r(L.INITIAL_ACTION, { type: 'cancel' })
  assert.equal(c.phase, 'cancelling')
  c = r(c, { type: 'cancelled' })
  assert.equal(c.phase, 'cancelled')
  assert.match(L.actionStatusText(c), /Nothing was submitted/)
  assert.equal(r(c, { type: 'confirm' }).phase, 'cancelled')
  assert.equal(r(r(L.INITIAL_ACTION, { type: 'cancel' }), { type: 'cancelFailed', message: 'x' }).phase, 'pending')
  assert.equal(r(L.INITIAL_ACTION, { type: 'confirmed', message: 'm', requestId: null }).phase, 'pending') // a stray event does nothing
})

test('card text helpers', () => {
  assert.equal(L.daysText(1), '1 day')
  assert.equal(L.daysText(4), '4 days')
  assert.equal(L.daysText(null), '-')
  assert.equal(L.balanceText(5), '5 days left')
  assert.equal(L.balanceText(1), '1 day left')
  assert.equal(L.balanceText(null), '-')
  assert.equal(L.dateRangeText('2026-12-21', '2026-12-24'), '21 Dec 2026 to 24 Dec 2026')
  assert.equal(L.dateRangeText('2026-12-21', '2026-12-21'), '21 Dec 2026')
  assert.equal(L.dateRangeText('', ''), '-')
})

test('rich text: **bold**, bullets and paragraphs become data; markup stays literal text', () => {
  assert.deepEqual(L.inlines('a **b** c'), [{ text: 'a ', bold: false }, { text: 'b', bold: true }, { text: ' c', bold: false }])
  assert.deepEqual(L.inlines('open ** only'), [{ text: 'open ** only', bold: false }])
  const blocks = L.richBlocks('You get **15 days**.\n- one\n- two\n\nSecond paragraph\nsame paragraph')
  assert.deepEqual(blocks.map((b) => b.type), ['p', 'ul', 'p'])
  assert.equal(blocks[1].items.length, 2)
  assert.equal(blocks[2].lines.length, 2)
  const evil = L.richBlocks('<img src=x onerror=alert(1)> <b>hi</b>')
  assert.equal(evil[0].lines[0][0].text, '<img src=x onerror=alert(1)> <b>hi</b>')
  assert.deepEqual(L.richBlocks(''), [])
  // numbered lists, and a mixed text
  const mixed = L.richBlocks('Steps:\n1. First\n2. **Second**\n\n- a\n- b')
  assert.deepEqual(mixed.map((b) => b.type), ['p', 'ol', 'ul'])
  assert.equal(mixed[1].start, 1)
  assert.equal(mixed[1].items.length, 2)
  assert.equal(mixed[1].items[1][0].bold, true)
  assert.equal(L.richBlocks('3. third')[0].start, 3)
  // a markdown-looking link, script tags and html entities stay literal text
  const links = L.richBlocks('[click](javascript:alert(1)) <script>alert(1)</script> &lt;b&gt; *not italic*')
  assert.equal(links.length, 1)
  assert.equal(links[0].type, 'p')
  assert.equal(links[0].lines[0].map((p) => p.text).join(''), '[click](javascript:alert(1)) <script>alert(1)</script> &lt;b&gt; *not italic*')
  assert.ok(links[0].lines[0].every((p) => !p.bold))
})

test('Knowledge Base text validation, failure wording and excerpts', () => {
  assert.deepEqual(L.validateKbText({ title: 'Ok', body: 'Text' }), {})
  assert.equal(L.validateKbText({ title: ' ', body: 'x' }).title, 'Enter a title.')
  assert.ok(L.validateKbText({ title: 'x'.repeat(161), body: 'x' }).title)
  assert.ok(L.validateKbText({ title: 'x', body: '' }).body)
  assert.ok(L.validateKbText({ title: 'x', body: 'y'.repeat(20001) }).body)
  const f = (o) => ({ status: 500, code: null, detail: null, retryAfter: null, ...o })
  assert.match(L.kbFailureText(f({ status: null }), 'Not saved.'), /can't reach/i)
  assert.match(L.kbFailureText(f({ status: 403 }), 'Not saved.'), /Only HR administrators/)
  assert.match(L.kbFailureText(f({ status: 413 }), 'x'), /larger than 10 MB/)
  assert.equal(L.validateKbText({ title: 'x'.repeat(160), body: 'x' }).title, undefined)
  assert.equal(L.kbFailureText(f({ status: 422, detail: 'Title is required' }), 'x'), 'Title is required')
  assert.equal(L.excerpt('a  b\n c', 50), 'a b c')
  assert.equal(L.excerpt('x'.repeat(300), 20).length, 20)
})

test('API normalisers keep only what the UI can use', () => {
  const cfg = A.normaliseConfig({ enabled: false, greeting: 'Hi', suggestions: ['a', 3, '', 'b'] })
  assert.deepEqual([cfg.enabled, cfg.greeting, cfg.suggestions, cfg.name], [false, 'Hi', ['a', 'b'], 'Bluedge Orbit'])
  assert.equal(A.normaliseConfig(null).enabled, true)
  const reply = A.normaliseReply({
    reply: 'Hello',
    sources: [{ kind: 'policy', id: 'p1', title: 'Leave Policy', version: 3, snippet: 's' }, { kind: 'article', id: 'a1', title: 'T' }, { kind: 'kb', id: 'k1', title: 'KB file', has_file: true }, { kind: 'kb', id: 'k2', title: 'KB text', has_file: false }, { title: 'no id' }, null],
    action: { action_id: 'act-1', kind: 'file_leave', summary: { leave_type_name: 'Vacation', days: 4, balance_after: 5, start_date: '2026-12-21', end_date: '2026-12-24', reason: 'r' } },
  })
  assert.equal(reply.sources.length, 4)
  assert.deepEqual([reply.sources[1].kind, reply.sources[1].version, reply.sources[1].has_file], ['kb', null, false]) // the older 'article' kind reads as a Knowledge Base text item
  assert.deepEqual([reply.sources[2].kind, reply.sources[2].has_file], ['kb', true])
  assert.deepEqual([reply.sources[3].kind, reply.sources[3].has_file], ['kb', false])
  assert.equal(reply.sources[0].has_file, false)
  assert.equal(reply.action.action_id, 'act-1')
  const s = A.leaveSummary(reply.action)
  assert.deepEqual([s.leave_type_name, s.days, s.balance_after, s.start_date], ['Vacation', 4, 5, '2026-12-21'])
  assert.equal(A.normaliseReply({ reply: 'x', action: { kind: 'file_leave' } }).action, null) // no id: nothing to confirm
  assert.deepEqual(A.normaliseReply(undefined), { reply: '', sources: [], action: null })
  const coe = A.coeSummary({ action_id: 'a', kind: 'generate_coe', summary: { name: 'Carla Dizon', position: 'Analyst', employed_since: '2021-03-01', reason: 'Visa', issue_date: '2026-11-16' }, expires_at: null })
  assert.deepEqual(coe, { name: 'Carla Dizon', position: 'Analyst', employed_since: '2021-03-01', reason: 'Visa', issue_date: '2026-11-16' })
  assert.deepEqual(A.coeSummary({ action_id: 'a', kind: 'generate_coe', summary: {}, expires_at: null }), { name: '', position: '', employed_since: '', reason: '', issue_date: '' })
  assert.deepEqual(A.normaliseFile({ file_id: 'f1', filename: 'coe.pdf', content_type: 'application/pdf', size: 10 }), { file_id: 'f1', filename: 'coe.pdf', content_type: 'application/pdf', size: 10 })
  assert.deepEqual(A.normaliseFile({ file_id: 'f1' }), { file_id: 'f1', filename: 'document.pdf', content_type: 'application/pdf', size: null })
  assert.equal(A.normaliseFile({ filename: 'x.pdf' }), null)
  assert.equal(A.normaliseFile(null), null)
  assert.equal(A.normaliseItem({ title: 't' }), null)
  const file = A.normaliseItem({ item_id: 'k1', kind: 'file', title: 'Handbook', body: 'ignored', filename: 'h.pdf', content_type: 'application/pdf', size: 1000, status: 'unreadable', reason: 'scan', active: false, updated_at: '2026-11-16T02:00:00Z', updated_by_name: 'Anna' })
  assert.deepEqual([file.kind, file.body, file.filename, file.status, file.reason, file.active, file.updated_by_name], ['file', '', 'h.pdf', 'unreadable', 'scan', false, 'Anna'])
  const text = A.normaliseItem({ item_id: 'k2', kind: 'text', title: 'T', body: 'b', filename: 'ignored.pdf', size: 5 })
  assert.deepEqual([text.kind, text.body, text.filename, text.size, text.status, text.active], ['text', 'b', null, null, 'indexed', true])
  const st = A.normaliseStatus({ items_total: 5, items_indexed: 4, items_unreadable: 1, policies_indexed: 2, policies_unreadable: [{ policy_id: 'p', title: 'T', reason: 'scan' }, { title: 'x' }], articles: 4 })
  assert.deepEqual([st.items_total, st.items_indexed, st.items_unreadable, st.policies_indexed, st.policies_unreadable.length, st.articles], [5, 4, 1, 2, 1, 4])
  assert.deepEqual(A.normaliseStatus(null).policies_unreadable, [])
  const failure = A.parseFailure({ response: { status: 429, data: { detail: 'Slow down', code: 'rate' }, headers: { 'retry-after': '12' } } })
  assert.deepEqual([failure.status, failure.code, failure.detail, failure.retryAfter], [429, 'rate', 'Slow down', 12])
  assert.deepEqual(A.parseFailure(new Error('network')), { status: null, code: null, detail: null, retryAfter: null })
})
