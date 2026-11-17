import test, { before } from 'node:test'
import assert from 'node:assert/strict'
import { loadTs } from './helpers/load-ts.mjs'

let L
before(async () => {
  L = await loadTs('modules/hrcases/logic.ts')
})

test('status labels, tones and the five-step order', () => {
  assert.deepEqual(L.STATUS_ORDER, ['open', 'in_progress', 'waiting_on_employee', 'resolved', 'closed'])
  assert.equal(L.statusLabel('waiting_on_employee'), 'Waiting on employee')
  assert.equal(L.statusLabel('in_progress'), 'In progress')
  assert.equal(L.statusLabel('mystery'), 'mystery', 'an unknown status is shown as-is, never hidden')
  assert.equal(L.statusTone('resolved'), 'green')
  assert.equal(L.statusTone('closed'), 'neutral')
  assert.equal(L.statusTone('waiting_on_employee'), 'amber')
  assert.equal(L.statusTone('mystery'), 'neutral')
  assert.match(L.statusHint('resolved'), /reopen it by replying/)
})

test('priorities', () => {
  assert.deepEqual(L.PRIORITIES, ['low', 'medium', 'high'])
  assert.equal(L.priorityLabel('high'), 'High priority')
  assert.equal(L.priorityTone('high'), 'red')
  assert.equal(L.priorityTone('low'), 'neutral')
  assert.equal(L.isPriority('medium'), true)
  assert.equal(L.isPriority('urgent'), false)
  assert.equal(L.isPriority(null), false)
})

test('active statuses are the ones before "resolved"', () => {
  for (const s of ['open', 'in_progress', 'waiting_on_employee']) assert.equal(L.isActiveStatus(s), true, s)
  for (const s of ['resolved', 'closed', 'nonsense']) assert.equal(L.isActiveStatus(s), false, s)
})

test('tabs: only the HR role hint offers the queue; a forced ?tab=queue falls back for everyone else', () => {
  assert.equal(L.showQueueTab(['HRAdmin']), true)
  for (const roles of [['Employee'], ['Manager'], ['Finance'], [], undefined, null]) assert.equal(L.showQueueTab(roles), false)
  assert.equal(L.parseListTab('queue', true), 'queue')
  assert.equal(L.parseListTab('queue', false), 'mine')
  assert.equal(L.parseListTab(null, true), 'mine')
  assert.equal(L.parseListTab('other', true), 'mine')
})

test('URL filters are whitelisted; junk falls back to "no filter" / page 1', () => {
  assert.equal(L.parseStatusFilter('active'), 'active')
  assert.equal(L.parseStatusFilter('resolved'), 'resolved')
  assert.equal(L.parseStatusFilter('bogus'), '')
  assert.equal(L.parseStatusFilter(null), '')
  assert.equal(L.parsePriorityFilter('high'), 'high')
  assert.equal(L.parsePriorityFilter('urgent'), '')
  assert.equal(L.parseAssigneeFilter('me'), 'me')
  assert.equal(L.parseAssigneeFilter('unassigned'), 'unassigned')
  assert.equal(L.parseAssigneeFilter('someone-else'), '', 'only me/unassigned are offered')
  assert.equal(L.parsePage('3'), 3)
  for (const bad of ['0', '-1', 'x', '1.5', '', null, undefined, '99999']) assert.equal(L.parsePage(bad), 1, String(bad))
  assert.deepEqual(L.STATUS_FILTERS.map((f) => f.value), ['', 'active', 'open', 'in_progress', 'waiting_on_employee', 'resolved', 'closed'])
})

test('validateNewCase: type, subject <= 120 and description <= 2000 (trimmed)', () => {
  assert.deepEqual(L.validateNewCase({ typeId: 't1', subject: 'Laptop', description: 'Needs a new one' }), {})
  assert.deepEqual(Object.keys(L.validateNewCase({ typeId: '', subject: '  ', description: '' })).sort(), ['description', 'subject', 'type'])
  assert.match(L.validateNewCase({ typeId: 't', subject: 'x'.repeat(121), description: 'd' }).subject, /at most 120/)
  assert.deepEqual(L.validateNewCase({ typeId: 't', subject: 'x'.repeat(120), description: 'd'.repeat(2000) }), {})
  assert.match(L.validateNewCase({ typeId: 't', subject: 's', description: 'd'.repeat(2001) }).description, /at most 2000/)
})

test('validateReply and the character counter', () => {
  assert.equal(L.validateReply('  '), 'Write a reply first.')
  assert.equal(L.validateReply('Thanks'), null)
  assert.match(L.validateReply('x'.repeat(2001)), /at most 2000/)
  assert.equal(L.validateReply('x'.repeat(2000)), null)
  assert.equal(L.counter('abc', 120), '3/120')
})

test('replyNote documents the owner-reply behaviour: waiting/resolved move back to In progress; HR replies never change the status alone', () => {
  assert.match(L.replyNote('waiting_on_employee', true), /moves this request back to In progress/)
  assert.match(L.replyNote('resolved', true), /reopen this request/)
  assert.equal(L.replyNote('open', true), null)
  assert.equal(L.replyNote('in_progress', true), null)
  assert.match(L.replyNote('open', false), /does not change the status unless you choose one/)
  assert.match(L.replyNote('resolved', false), /does not change the status/)
  assert.equal(L.replyNote('closed', true), null)
  assert.equal(L.replyNote('closed', false), null)
})

test('speakers, roles and assignee wording', () => {
  assert.equal(L.speakerLabel({ user_id: 'u1', name: 'Jamie', role: 'employee' }, 'u1'), 'You')
  assert.equal(L.speakerLabel({ user_id: 'u2', name: 'Anna Reyes', role: 'hr' }, 'u1'), 'Anna Reyes')
  assert.equal(L.speakerLabel({ user_id: 'u2', name: 'Anna Reyes', role: 'hr' }, null), 'Anna Reyes')
  assert.equal(L.roleLabel('hr'), 'HR')
  assert.equal(L.roleLabel('employee'), 'Employee')
  assert.equal(L.assigneeText(null, 'u1'), 'Unassigned')
  assert.equal(L.assigneeText({ user_id: 'u1', name: 'Anna' }, 'u1'), 'Assigned to you')
  assert.equal(L.assigneeText({ user_id: 'u2', name: 'Ben' }, 'u1'), 'Assigned to Ben')
})

test('links and list wording', () => {
  assert.equal(L.caseLink('abc'), '/hr-requests/cases/abc')
  assert.equal(L.caseLink('a b'), '/hr-requests/cases/a%20b')
  assert.equal(L.lastActivityText({ message_count: 1, last_message_role: 'employee' }), 'No replies yet')
  assert.equal(L.lastActivityText({ message_count: 3, last_message_role: 'hr' }), 'Last reply from HR')
  assert.equal(L.lastActivityText({ message_count: 2, last_message_role: 'employee' }), 'Last reply from the employee')
  assert.equal(L.typeHelp(null), '')
  assert.equal(L.typeHelp({ description: '', placeholder: true }), 'No description.')
  assert.equal(L.typeHelp({ description: 'Inquiry only', placeholder: true }), 'Inquiry only')
  assert.match(L.PRIVACY_NOTE, /Managers - including your own manager - cannot/)
})

test('shared file and error helpers are re-exported (one source of truth with Documents)', () => {
  assert.equal(L.fileHint({ name: 'a.exe', size: 5 }).includes('not one of the accepted types'), true)
  assert.equal(L.formatBytes(2048), '2.0 KB')
  assert.equal(L.parseServerError({ response: { status: 404, data: { detail: 'Case not found' } } }).detail, 'Case not found')
  assert.match(L.uploadErrorText({ response: { status: 415, data: { detail: 'Unsupported file.' } } }), /Nothing was stored/)
  assert.equal(L.hasAction(['reply', 'close'], 'close'), true)
})
