/**
 * Pure helpers for Performance & Check-ins (no DOM, no network): labels, validation, goal state machine choices,
 * error parsing. Goals and check-ins carry no ratings, scores or rankings; the Probation Evaluation tab (probationLogic.ts) is the one
 * place with 1-5 ratings, and it has no pay or automatic status effect either.
 *
 * Permissions never come from here: every control is driven by the server's `allowed_actions` / 403 / 404.
 * The ONE role hint is `performanceTabs` / `teamScopes`: they only decide which tabs/scopes to OFFER (navigation),
 * mirroring the backend scopes; the server still answers 403 for a forced tab.
 */
import type { CheckinAction, CheckinStatus, Goal, GoalAction, GoalStatus, PerformanceConfig } from './api'

export const DEFAULT_LIMITS: PerformanceConfig['limits'] = {
  goal_title_max: 120,
  goal_description_max: 1000,
  comment_max: 1000,
  period_label_max: 60,
  checkin_text_max: 2000,
  feedback_max: 2000,
  max_goals_per_employee: 100,
  max_comments_per_goal: 100,
}

export type Tone = 'neutral' | 'blue' | 'violet' | 'amber' | 'green' | 'red'

// ------------------------------------------------------------------------------------------------ labels
export const GOAL_STATUSES: GoalStatus[] = ['not_started', 'in_progress', 'done', 'dropped']
const GOAL_LABEL: Record<GoalStatus, string> = { not_started: 'Not started', in_progress: 'In progress', done: 'Done', dropped: 'Dropped' }
const GOAL_TONE: Record<GoalStatus, Tone> = { not_started: 'neutral', in_progress: 'blue', done: 'green', dropped: 'amber' }

export function goalStatusLabel(s: string): string {
  return GOAL_LABEL[s as GoalStatus] ?? s.replace(/_/g, ' ')
}
export function goalStatusTone(s: string): Tone {
  return GOAL_TONE[s as GoalStatus] ?? 'neutral'
}

export const CHECKIN_STATUSES: CheckinStatus[] = ['requested', 'submitted', 'acknowledged']
const CHECKIN_LABEL: Record<CheckinStatus, string> = { requested: 'Requested', submitted: 'Submitted', acknowledged: 'Acknowledged' }
const CHECKIN_TONE: Record<CheckinStatus, Tone> = { requested: 'amber', submitted: 'blue', acknowledged: 'green' }
export function checkinStatusLabel(s: string): string {
  return CHECKIN_LABEL[s as CheckinStatus] ?? s
}
export function checkinStatusTone(s: string): Tone {
  return CHECKIN_TONE[s as CheckinStatus] ?? 'neutral'
}

export function reviewerLabel(r: { kind: string; name: string | null } | null | undefined): string {
  if (!r) return 'a reviewer'
  if (r.kind === 'hr') return 'HR (no manager is set up for this person)'
  return r.name || 'the manager'
}

export function checkinStatusHint(c: { status: string; reviewer?: { kind: string; name: string | null } | null }): string {
  if (c.status === 'requested') return 'A manager asked for this check-in. It is submitted once it is filled in.'
  if (c.status === 'submitted') return c.reviewer ? `Waiting for ${reviewerLabel(c.reviewer)} to acknowledge.` : 'Waiting to be acknowledged.'
  return 'Acknowledged.'
}

export const MOOD_LABELS: Record<number, string> = { 1: 'Very low', 2: 'Low', 3: 'Okay', 4: 'Good', 5: 'Great' }
export function moodLabel(m: number | null | undefined): string {
  return typeof m === 'number' ? `${m} of 5 (${MOOD_LABELS[m] ?? ''})`.replace(' ()', '') : 'Not given'
}

export function personName(p: { name: string | null; employee_id: string } | null | undefined): string {
  if (!p) return 'Unknown'
  return p.name || p.employee_id
}

// ------------------------------------------------------------------------------------------------ dates
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '-'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/** The `<input type=date>` value must be a real ISO date or empty. */
export function isIsoDate(v: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v)
  if (!m) return false
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1) return false
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)
  const dim = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1]
  return d <= dim
}

// ------------------------------------------------------------------------------------------------ actions / tabs
export function hasAction<T extends string>(actions: readonly T[] | undefined, a: T): boolean {
  return Boolean(actions?.includes(a))
}
export const canEditGoal = (g: Pick<Goal, 'allowed_actions'>) => hasAction<GoalAction>(g.allowed_actions, 'edit')
export const canCommentGoal = (g: Pick<Goal, 'allowed_actions'>) => hasAction<GoalAction>(g.allowed_actions, 'comment')
export const canSubmitCheckin = (c: { allowed_actions: CheckinAction[] }) => hasAction<CheckinAction>(c.allowed_actions, 'submit')
export const canAcknowledgeCheckin = (c: { allowed_actions: CheckinAction[] }) => hasAction<CheckinAction>(c.allowed_actions, 'acknowledge')

export type TabId = 'goals' | 'checkins' | 'team' | 'overview' | 'probation'
export const TAB_LABEL: Record<TabId, string> = { goals: 'My goals', checkins: 'My check-ins', team: 'Team', overview: 'HR overview', probation: 'Probation Evaluation' }

/** Navigation hint only (which tabs to offer). The backend enforces the scopes; see the header comment. */
export function performanceTabs(roles: readonly string[] | undefined): TabId[] {
  const r = roles ?? []
  const tabs: TabId[] = ['goals', 'checkins']
  if (r.includes('Manager') || r.includes('HRAdmin')) tabs.push('team')
  if (r.includes('HRAdmin')) tabs.push('overview')
  // Probation evaluations: the evaluating manager and HR. HR sees it right beside HR overview, a manager right after Team.
  if (r.includes('Manager') || r.includes('HRAdmin')) tabs.push('probation')
  return tabs
}

export function parseTab(raw: string | null, offered: readonly TabId[]): TabId {
  return offered.find((t) => t === raw) ?? 'goals'
}

export type TeamScope = 'team' | 'all'
/** Which list scopes to offer on the Team tab: managers read their direct reports, HR reads everyone (read-only). */
export function teamScopes(roles: readonly string[] | undefined): TeamScope[] {
  const r = roles ?? []
  const out: TeamScope[] = []
  if (r.includes('Manager')) out.push('team')
  if (r.includes('HRAdmin')) out.push('all')
  return out
}
export const TEAM_SCOPE_LABEL: Record<TeamScope, string> = { team: 'My direct reports', all: 'Everyone (read-only)' }

export type TeamView = 'review' | 'checkins' | 'goals'
export const TEAM_VIEWS: TeamView[] = ['review', 'checkins', 'goals']
export const TEAM_VIEW_LABEL: Record<TeamView, string> = { review: 'To acknowledge', checkins: 'Check-ins', goals: 'Goals' }
export function parseTeamView(raw: string | null): TeamView {
  return TEAM_VIEWS.find((v) => v === raw) ?? 'review'
}

// ------------------------------------------------------------------------------------------------ goal state machine
/**
 * Status choices offered in the status control, from the documented state machine. in_progress -> not_started is
 * only allowed while progress is 0.
 */
export function goalStatusChoices(goal: Pick<Goal, 'status' | 'progress'>): GoalStatus[] {
  switch (goal.status) {
    case 'not_started':
      return ['not_started', 'in_progress', 'done', 'dropped']
    case 'in_progress':
      return goal.progress === 0 ? ['not_started', 'in_progress', 'done', 'dropped'] : ['in_progress', 'done', 'dropped']
    case 'done':
      return ['done', 'in_progress', 'dropped']
    case 'dropped':
      return ['dropped', 'not_started', 'in_progress']
    default:
      return [goal.status]
  }
}

/** What a progress-only change will become (mirrors the server so the preview is honest; the server decides). */
export function statusAfterProgress(goal: Pick<Goal, 'status' | 'progress'>, progress: number): GoalStatus | null {
  if (goal.status === 'dropped') return null
  if (progress >= 100) return 'done'
  if (progress <= 0 && goal.status === 'not_started') return 'not_started'
  return 'in_progress'
}

export const PROGRESS_STEPS = [0, 25, 50, 75, 100] as const

export function clampProgress(v: number): number {
  if (!Number.isFinite(v)) return 0
  return Math.min(100, Math.max(0, Math.round(v)))
}

// ------------------------------------------------------------------------------------------------ validation
export type FieldErrors = Partial<Record<string, string>>

const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/
const NEWLINE = /[\r\n]/

export function validateGoal(input: { title: string; description: string; due_date: string }, limits = DEFAULT_LIMITS): FieldErrors {
  const e: FieldErrors = {}
  const title = input.title.trim()
  if (!title) e.title = 'Give the goal a title.'
  else if (title.length > limits.goal_title_max) e.title = `The title can be at most ${limits.goal_title_max} characters.`
  else if (NEWLINE.test(title) || CONTROL.test(title)) e.title = 'The title must be a single line of plain text.'
  if (input.description.trim().length > limits.goal_description_max) e.description = `The description can be at most ${limits.goal_description_max} characters.`
  else if (CONTROL.test(input.description)) e.description = 'The description contains characters that are not allowed.'
  if (input.due_date.trim() && !isIsoDate(input.due_date.trim())) e.due_date = 'Enter a valid date.'
  return e
}

export function validateCheckin(
  input: { period_label?: string; accomplishments: string; blockers: string; next_steps: string; mood: number | null },
  opts: { needsPeriod: boolean; limits?: PerformanceConfig['limits'] },
): FieldErrors {
  const limits = opts.limits ?? DEFAULT_LIMITS
  const e: FieldErrors = {}
  if (opts.needsPeriod) {
    const msg = validatePeriod(input.period_label ?? '', limits)
    if (msg) e.period_label = msg
  }
  const texts: Array<['accomplishments' | 'blockers' | 'next_steps', string]> = [
    ['accomplishments', input.accomplishments],
    ['blockers', input.blockers],
    ['next_steps', input.next_steps],
  ]
  for (const [k, v] of texts) {
    if (v.trim().length > limits.checkin_text_max) e[k] = `This can be at most ${limits.checkin_text_max} characters.`
    else if (CONTROL.test(v)) e[k] = 'This contains characters that are not allowed.'
  }
  if (!texts.some(([, v]) => v.trim())) e.texts = 'Fill in at least one of accomplishments, blockers or next steps.'
  if (input.mood !== null && (!Number.isInteger(input.mood) || input.mood < 1 || input.mood > 5)) e.mood = 'Mood is a number from 1 to 5.'
  return e
}

export function validatePeriod(p: string, limits = DEFAULT_LIMITS): string | null {
  const t = p.trim()
  if (!t) return 'Name the period, for example 2027-Q1 or Week 12.'
  if (t.length > limits.period_label_max) return `The period can be at most ${limits.period_label_max} characters.`
  if (NEWLINE.test(t) || CONTROL.test(t)) return 'The period must be a single line of plain text.'
  return null
}

export function validateComment(text: string, max = DEFAULT_LIMITS.comment_max): string | null {
  const t = text.trim()
  if (!t) return 'Write a comment first.'
  if (t.length > max) return `A comment can be at most ${max} characters.`
  if (CONTROL.test(t)) return 'The text contains characters that are not allowed.'
  return null
}

export function validateFeedback(text: string, max = DEFAULT_LIMITS.feedback_max): string | null {
  if (text.trim().length > max) return `Feedback can be at most ${max} characters.`
  if (CONTROL.test(text)) return 'The text contains characters that are not allowed.'
  return null
}

// ------------------------------------------------------------------------------------------------ errors
export interface ServerErrorInfo {
  status: number | null
  detail: string
  existingCheckinId: string | null
  fieldErrors: FieldErrors
}

/** Client-safe error text: only short server `detail` strings are shown; the network case has its own wording. */
export function parseServerError(err: unknown, fallback = 'Something went wrong. Please try again.'): ServerErrorInfo {
  const e = err as { response?: { status?: number; data?: Record<string, unknown> } } | null
  const status = e?.response?.status ?? null
  const data = e?.response?.data ?? {}
  let detail = typeof data.detail === 'string' && data.detail.trim() && data.detail.length < 300 ? data.detail : fallback
  if (status === null) detail = 'The service could not be reached. Check your connection and try again.'
  if (status === 404) detail = 'This item was not found, or you do not have access to it.'
  const fieldErrors: FieldErrors = {}
  if (status === 422 && Array.isArray(data.errors)) {
    for (const item of data.errors as Array<{ loc?: unknown[]; msg?: unknown }>) {
      const key = Array.isArray(item.loc) ? String(item.loc[item.loc.length - 1] ?? '') : ''
      if (key && typeof item.msg === 'string' && !fieldErrors[key]) fieldErrors[key] = item.msg
    }
    detail = 'Some values were not accepted. Please check the form.'
  }
  const existing = typeof data.existing_checkin_id === 'string' ? data.existing_checkin_id : null
  return { status, detail, existingCheckinId: existing, fieldErrors }
}

// ------------------------------------------------------------------------------------------------ misc
export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / Math.max(1, pageSize)))
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}
