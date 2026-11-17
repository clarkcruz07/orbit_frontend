/**
 * Pure helpers for HR Requests (no DOM, no network) so they are unit tested with node --test.
 *
 * The backend is the only control: buttons come from the server's
 * `allowed_actions` / `allowed_statuses`. The single role hint is `showQueueTab`, which only decides whether to OFFER the
 * HR queue tab (the server still answers 403 for the queue to anyone else).
 */
export { fileHint, formatBytes, formatDateTime, parseServerError, typeLabel, uploadErrorText, hasAction, FILE_HINT, MAX_FILE_MB } from '@/modules/documents/logic'
export type { FieldErrors, ServerErrorInfo, Tone } from '@/modules/documents/logic'
import type { Tone } from '@/modules/documents/logic'

export type CaseStatus = 'open' | 'in_progress' | 'waiting_on_employee' | 'resolved' | 'closed'
export type CasePriority = 'low' | 'medium' | 'high'
export type ListTab = 'mine' | 'queue'

export const PRIVACY_NOTE =
  'Only you and HR can see your requests. Managers - including your own manager - cannot.'
export const SUBJECT_MAX = 120
export const DESCRIPTION_MAX = 2000
export const REPLY_MAX = 2000

export const STATUS_ORDER: readonly CaseStatus[] = ['open', 'in_progress', 'waiting_on_employee', 'resolved', 'closed']

const STATUS_META: Record<CaseStatus, { label: string; tone: Tone; hint: string }> = {
  open: { label: 'Open', tone: 'blue', hint: 'Waiting for HR to pick it up' },
  in_progress: { label: 'In progress', tone: 'violet', hint: 'HR is working on it' },
  waiting_on_employee: { label: 'Waiting on employee', tone: 'amber', hint: 'HR is waiting for a reply from the employee' },
  resolved: { label: 'Resolved', tone: 'green', hint: 'HR has resolved it; the employee can close it or reopen it by replying' },
  closed: { label: 'Closed', tone: 'neutral', hint: 'Finished - no more replies' },
}

export function statusLabel(status: string): string {
  return (STATUS_META as Record<string, { label: string }>)[status]?.label ?? status
}
export function statusTone(status: string): Tone {
  return (STATUS_META as Record<string, { tone: Tone }>)[status]?.tone ?? 'neutral'
}
export function statusHint(status: string): string {
  return (STATUS_META as Record<string, { hint: string }>)[status]?.hint ?? ''
}

export const PRIORITIES: readonly CasePriority[] = ['low', 'medium', 'high']
const PRIORITY_META: Record<CasePriority, { label: string; tone: Tone }> = {
  low: { label: 'Low priority', tone: 'neutral' },
  medium: { label: 'Medium priority', tone: 'amber' },
  high: { label: 'High priority', tone: 'red' },
}
export function priorityLabel(p: string): string {
  return (PRIORITY_META as Record<string, { label: string }>)[p]?.label ?? p
}
export function priorityTone(p: string): Tone {
  return (PRIORITY_META as Record<string, { tone: Tone }>)[p]?.tone ?? 'neutral'
}
export function isPriority(v: string | null | undefined): v is CasePriority {
  return v === 'low' || v === 'medium' || v === 'high'
}

/** Active = not resolved/closed (the same word the backend filter uses). */
export function isActiveStatus(status: string): boolean {
  return status === 'open' || status === 'in_progress' || status === 'waiting_on_employee'
}

// ---------------------------------------------------------------------------------------------------- tabs and filters
/** Whether to OFFER the HR queue tab. Navigation hint only: `scope=queue` is HR-only on the server (403 otherwise). */
export function showQueueTab(roles: readonly string[] | undefined | null): boolean {
  return Boolean(roles?.includes('HRAdmin'))
}

export function parseListTab(value: string | null | undefined, queueAllowed: boolean): ListTab {
  return value === 'queue' && queueAllowed ? 'queue' : 'mine'
}

export const STATUS_FILTERS: readonly { value: string; label: string }[] = [
  { value: '', label: 'All statuses' },
  { value: 'active', label: 'Active (not resolved or closed)' },
  ...STATUS_ORDER.map((s) => ({ value: s, label: statusLabel(s) })),
]

export function parseStatusFilter(value: string | null | undefined): string {
  return STATUS_FILTERS.some((f) => f.value === value) ? (value as string) : ''
}
export function parsePriorityFilter(value: string | null | undefined): string {
  return isPriority(value) ? value : ''
}
export function parseAssigneeFilter(value: string | null | undefined): string {
  return value === 'me' || value === 'unassigned' ? value : ''
}
export function parsePage(value: string | null | undefined): number {
  const n = Number(value)
  return Number.isInteger(n) && n >= 1 && n <= 10000 ? n : 1
}

// ---------------------------------------------------------------------------------------------------- validation
export interface NewCaseInput {
  typeId: string
  subject: string
  description: string
}

export function validateNewCase(i: NewCaseInput): Record<string, string> {
  const e: Record<string, string> = {}
  if (!i.typeId) e.type = 'Choose a request type.'
  const s = i.subject.trim()
  if (!s) e.subject = 'Enter a subject.'
  else if (s.length > SUBJECT_MAX) e.subject = `The subject can be at most ${SUBJECT_MAX} characters.`
  const d = i.description.trim()
  if (!d) e.description = 'Describe your request.'
  else if (d.length > DESCRIPTION_MAX) e.description = `The description can be at most ${DESCRIPTION_MAX} characters.`
  return e
}

export function validateReply(text: string): string | null {
  const t = text.trim()
  if (!t) return 'Write a reply first.'
  if (t.length > REPLY_MAX) return `A reply can be at most ${REPLY_MAX} characters.`
  return null
}

export function counter(value: string, max: number): string {
  return `${value.length}/${max}`
}

// ---------------------------------------------------------------------------------------------------- messages and notes
/**
 * What an employee should know before replying (the documented auto-move): an OWNER reply while the case is
 * waiting on them or resolved moves it back to In progress. HR replies never change the status by themselves.
 */
export function replyNote(status: string, isOwner: boolean): string | null {
  if (status === 'closed') return null
  if (isOwner && (status === 'waiting_on_employee' || status === 'resolved')) {
    return status === 'resolved'
      ? 'Replying will reopen this request: it moves back to In progress.'
      : 'Replying moves this request back to In progress.'
  }
  if (!isOwner) return 'A reply does not change the status unless you choose one below.'
  return null
}

export function speakerLabel(by: { user_id: string; name: string; role: string }, meUserId: string | null | undefined): string {
  if (meUserId && by.user_id === meUserId) return 'You'
  return by.name
}

export function roleLabel(role: string): string {
  return role === 'hr' ? 'HR' : 'Employee'
}

export function assigneeText(assignee: { user_id: string; name: string } | null, meUserId: string | null | undefined): string {
  if (!assignee) return 'Unassigned'
  return meUserId && assignee.user_id === meUserId ? 'Assigned to you' : `Assigned to ${assignee.name}`
}

/** "Payslip / benefit question" is inquiry-only: the type description carries that; this is the generic line. */
export function typeHelp(t: { description: string; placeholder: boolean } | null | undefined): string {
  if (!t) return ''
  return t.description || 'No description.'
}

/** The notification deep link for a case: `/hr-requests/cases/{id}`. */
export function caseLink(caseId: string): string {
  return `/hr-requests/cases/${encodeURIComponent(caseId)}`
}

/** One line for a list row, e.g. "Last reply by HR". */
export function lastActivityText(c: { last_message_role: string | null; message_count: number }): string {
  if (c.message_count <= 1) return 'No replies yet'
  return c.last_message_role === 'hr' ? 'Last reply from HR' : 'Last reply from the employee'
}
