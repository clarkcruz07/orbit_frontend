/**
 * Pure helpers for the "Probation Evaluation" tab (no DOM, no network): the paper form's fixed text (fallback), types, draft <-> server
 * mapping, the PATCH diff, completeness and validation, labels, normalisers and the download file name.
 *
 * The manager / team lead rates a probationary employee on nine criteria (1-5) and recommends the outcome. The recommendation never changes
 * the employee's status: HR does that on the People page. Permissions never come from here: `can_edit`, `can_submit`, `can_reopen` and
 * `can_delete` are the server's answers; the server also enforces the real rules (the client checks below are friendly early feedback).
 */
import { isIsoDate, parseServerError, type FieldErrors, type Tone } from './logic'

export { parseServerError }
export type { FieldErrors, Tone }

export type EvalStatus = 'draft' | 'submitted'
export type RecommendationValue = 'confirm' | 'extend' | 'not_confirm'
export type StatusFilter = '' | EvalStatus

// ------------------------------------------------------------------------------------------------ the form definition (GET /form)
export interface RatingGuideRow {
  rating: number
  label: string
  standard: string
}
export interface Criterion {
  key: string
  number: number
  title: string
  bullets: string[]
}
export interface ProbationLimits {
  comment_max: number
  dev_rows_max: number
  cell_max: number
}
export interface ProbationFormDef {
  version: string
  title: string
  rating_guide: RatingGuideRow[]
  criteria: Criterion[]
  recommendations: Array<{ value: RecommendationValue; label: string }>
  limits: ProbationLimits
}

export const DEFAULT_PROBATION_LIMITS: ProbationLimits = { comment_max: 2000, dev_rows_max: 10, cell_max: 300 }

/** The company form's own wording (v1.0, July 2026): the fallback when the server's copy cannot be loaded. */
export const DEFAULT_FORM: ProbationFormDef = {
  version: '1.0',
  title: 'Probationary Employee Evaluation Form',
  rating_guide: [
    { rating: 5, label: 'Exceeds Expectations', standard: 'Consistently performs above the requirements of the role. Demonstrates initiative, requires minimal supervision, and regularly exceeds performance expectations.' },
    { rating: 4, label: 'Meets Expectations', standard: 'Consistently performs the duties of the role to the expected standard with minimal supervision. Produces reliable, quality work.' },
    { rating: 3, label: 'Developing', standard: 'Generally meets expectations but still requires guidance or additional experience in certain areas. Shows willingness to learn and improve.' },
    { rating: 2, label: 'Needs Improvement', standard: 'Performance is inconsistent and requires regular supervision or coaching. Improvement is needed before regularisation.' },
    { rating: 1, label: 'Unsatisfactory', standard: 'Does not meet the minimum performance requirements of the role despite guidance and support.' },
  ],
  criteria: [
    { key: 'role', number: 1, title: 'Understanding of the Role', bullets: ['Understands key responsibilities and expectations.', 'Demonstrates knowledge of company processes and procedures.', 'Completes assigned tasks with appropriate supervision.', 'Knows when to seek guidance or escalate issues.', 'Takes ownership of responsibilities.'] },
    { key: 'quality', number: 2, title: 'Quality of Work', bullets: ['Produces accurate and complete work.', 'Demonstrates attention to detail.', 'Maintains quality standards.', 'Makes minimal errors.', 'Delivers work that meets business expectations.'] },
    { key: 'productivity', number: 3, title: 'Productivity & Time Management', bullets: ['Completes work within expected timeframes.', 'Prioritises tasks effectively.', 'Manages workload independently.', 'Meets deadlines consistently.', 'Demonstrates good organisational skills.'] },
    { key: 'problem_solving', number: 4, title: 'Problem Solving & Decision Making', bullets: ['Identifies issues proactively.', 'Demonstrates sound judgement.', 'Suggests practical solutions.', 'Seeks assistance when appropriate.', 'Learns from mistakes.'] },
    { key: 'learning', number: 5, title: 'Learning & Adaptability', bullets: ['Learns new systems and processes efficiently.', 'Accepts constructive feedback positively.', 'Applies feedback to improve performance.', 'Adapts well to changing priorities.', 'Demonstrates a willingness to learn.'] },
    { key: 'communication', number: 6, title: 'Communication', bullets: ['Communicates clearly and professionally.', 'Responds appropriately and promptly.', 'Keeps relevant stakeholders informed.', 'Demonstrates active listening.', 'Maintains professional written and verbal communication.'] },
    { key: 'teamwork', number: 7, title: 'Teamwork & Collaboration', bullets: ['Works collaboratively with colleagues.', 'Demonstrates respect and professionalism.', 'Shares knowledge and supports team members.', 'Contributes positively to the team environment.', 'Builds effective working relationships.'] },
    { key: 'reliability', number: 8, title: 'Reliability & Professionalism', bullets: ['Demonstrates punctuality and reliable attendance.', 'Takes accountability for assigned work.', 'Maintains confidentiality where required.', 'Behaves professionally at all times.', 'Follows company policies and procedures.'] },
    { key: 'initiative', number: 9, title: 'Initiative', bullets: ['Demonstrates willingness to take ownership.', 'Works independently where appropriate.', 'Identifies opportunities for improvement.', 'Shows enthusiasm and motivation.', 'Takes initiative beyond assigned responsibilities when appropriate.'] },
  ],
  recommendations: [
    { value: 'confirm', label: 'Confirm Employment (Regularise)' },
    { value: 'extend', label: 'Extend Probation' },
    { value: 'not_confirm', label: 'Do Not Confirm Employment' },
  ],
  limits: DEFAULT_PROBATION_LIMITS,
}

export const RATINGS = [5, 4, 3, 2, 1] as const
const RATING_FULL: Record<number, string> = { 5: 'Exceeds Expectations', 4: 'Meets Expectations', 3: 'Developing', 2: 'Needs Improvement', 1: 'Unsatisfactory' }
const RATING_SHORT: Record<number, string> = { 5: 'Exceeds', 4: 'Meets', 3: 'Developing', 2: 'Needs work', 1: 'Unsatisfactory' }
export const ratingFull = (n: number): string => `${n} - ${RATING_FULL[n] ?? ''}`.trim()
export const ratingShort = (n: number): string => RATING_SHORT[n] ?? ''

export const PROBATION_CONFIDENTIAL_NOTE = 'Probation evaluations are confidential to the evaluating manager and HR.'
export const RECOMMENDATION_NOTE = "This recommendation does not change the employee's status. HR updates employment status on the People page."

// ------------------------------------------------------------------------------------------------ data shapes
export interface PersonRef {
  employee_id: string | null
  name: string | null
}
export interface EvalEmployee {
  employee_id: string
  name: string | null
  position: string | null
  department: string | null
}
export interface RatingEntry {
  rating: number | null
  comments: string
}
export interface DevRow {
  area: string
  actions: string
  target_completion: string
}
export interface Extension {
  reasons: string
  objectives: string
  review_date: string
}
export interface Evaluation {
  evaluation_id: string
  status: EvalStatus
  employee: EvalEmployee
  manager: PersonRef | null
  evaluator: { user_id: string | null; name: string | null }
  review_date: string | null
  ratings: Record<string, RatingEntry>
  strengths: string
  development_comments: string
  development_rows: DevRow[]
  summary: string
  recommendation: RecommendationValue | null
  extension: Extension
  average: number | null
  created_at: string | null
  updated_at: string | null
  submitted_at: string | null
  submitted_by_name: string | null
  can_edit: boolean
  can_submit: boolean
  can_reopen: boolean
  can_delete: boolean
}
export interface EvalListItem {
  evaluation_id: string
  employee: EvalEmployee
  manager: PersonRef | null
  evaluator: { user_id: string | null; name: string | null }
  review_date: string | null
  status: EvalStatus
  recommendation: RecommendationValue | null
  average: number | null
  updated_at: string | null
  submitted_at: string | null
}
export interface Eligible {
  employee_id: string
  name: string
  job_title: string | null
  department: string | null
  start_date: string | null
}

// ------------------------------------------------------------------------------------------------ normalisers (defensive: the API is trusted for shape, never for presence)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}
export function ratingOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 5 ? v : null
}
function status(v: unknown): EvalStatus {
  return v === 'submitted' ? 'submitted' : 'draft'
}
export function recommendationOrNull(v: unknown): RecommendationValue | null {
  return v === 'confirm' || v === 'extend' || v === 'not_confirm' ? v : null
}
function person(v: unknown): PersonRef | null {
  const r = rec(v)
  const id = strOrNull(r.employee_id)
  const name = strOrNull(r.name)
  return id || name ? { employee_id: id, name } : null
}
function employee(v: unknown): EvalEmployee {
  const r = rec(v)
  return { employee_id: str(r.employee_id), name: strOrNull(r.name), position: strOrNull(r.position ?? r.job_title), department: strOrNull(r.department) }
}
function evaluator(v: unknown): { user_id: string | null; name: string | null } {
  const r = rec(v)
  return { user_id: strOrNull(r.user_id), name: strOrNull(r.name) }
}

export function normaliseListItem(raw: unknown): EvalListItem {
  const r = rec(raw)
  return {
    evaluation_id: str(r.evaluation_id),
    employee: employee(r.employee),
    manager: person(r.manager),
    evaluator: evaluator(r.evaluator),
    review_date: strOrNull(r.review_date),
    status: status(r.status),
    recommendation: recommendationOrNull(r.recommendation),
    average: numOrNull(r.average),
    updated_at: strOrNull(r.updated_at),
    submitted_at: strOrNull(r.submitted_at),
  }
}

export function normaliseEvaluation(raw: unknown, keys: readonly string[] = DEFAULT_FORM.criteria.map((c) => c.key)): Evaluation {
  const r = rec(raw)
  const ratingsRaw = rec(r.ratings)
  const ratings: Record<string, RatingEntry> = {}
  for (const k of new Set([...keys, ...Object.keys(ratingsRaw)])) {
    const e = rec(ratingsRaw[k])
    ratings[k] = { rating: ratingOrNull(e.rating), comments: str(e.comments) }
  }
  const rows = Array.isArray(r.development_rows) ? r.development_rows : []
  const ext = rec(r.extension)
  return {
    evaluation_id: str(r.evaluation_id),
    status: status(r.status),
    employee: employee(r.employee),
    manager: person(r.manager),
    evaluator: evaluator(r.evaluator),
    review_date: strOrNull(r.review_date),
    ratings,
    strengths: str(r.strengths),
    development_comments: str(r.development_comments),
    development_rows: rows.map((x) => {
      const o = rec(x)
      return { area: str(o.area), actions: str(o.actions), target_completion: str(o.target_completion) }
    }),
    summary: str(r.summary),
    recommendation: recommendationOrNull(r.recommendation),
    extension: { reasons: str(ext.reasons), objectives: str(ext.objectives), review_date: str(ext.review_date) },
    average: numOrNull(r.average),
    created_at: strOrNull(r.created_at),
    updated_at: strOrNull(r.updated_at),
    submitted_at: strOrNull(r.submitted_at),
    submitted_by_name: strOrNull(r.submitted_by_name),
    can_edit: r.can_edit === true,
    can_submit: r.can_submit === true,
    can_reopen: r.can_reopen === true,
    can_delete: r.can_delete === true,
  }
}

export function normaliseFormDef(raw: unknown): ProbationFormDef {
  const r = rec(raw)
  const guide = (Array.isArray(r.rating_guide) ? r.rating_guide : [])
    .map((x) => {
      const o = rec(x)
      return { rating: ratingOrNull(o.rating) ?? 0, label: str(o.label), standard: str(o.standard) }
    })
    .filter((x) => x.rating > 0)
  const criteria = (Array.isArray(r.criteria) ? r.criteria : [])
    .map((x, i) => {
      const o = rec(x)
      return { key: str(o.key), number: numOrNull(o.number) ?? i + 1, title: str(o.title), bullets: (Array.isArray(o.bullets) ? o.bullets : []).filter((b): b is string => typeof b === 'string') }
    })
    .filter((c) => c.key && c.title)
  const recs = (Array.isArray(r.recommendations) ? r.recommendations : [])
    .map((x) => {
      const o = rec(x)
      return { value: recommendationOrNull(o.value), label: str(o.label) }
    })
    .filter((x): x is { value: RecommendationValue; label: string } => x.value !== null && Boolean(x.label))
  const lim = rec(r.limits)
  const pos = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : d)
  // A server copy that is missing a whole part is not usable: the company's own wording is the fallback for that part.
  return {
    version: str(r.version) || DEFAULT_FORM.version,
    title: str(r.title) || DEFAULT_FORM.title,
    rating_guide: guide.length ? guide : DEFAULT_FORM.rating_guide,
    criteria: criteria.length ? criteria : DEFAULT_FORM.criteria,
    recommendations: recs.length ? recs : DEFAULT_FORM.recommendations,
    limits: {
      comment_max: pos(lim.comment_max, DEFAULT_PROBATION_LIMITS.comment_max),
      dev_rows_max: pos(lim.dev_rows_max, DEFAULT_PROBATION_LIMITS.dev_rows_max),
      cell_max: pos(lim.cell_max, DEFAULT_PROBATION_LIMITS.cell_max),
    },
  }
}

export function normaliseEligible(raw: unknown): Eligible[] {
  const items = Array.isArray(rec(raw).items) ? (rec(raw).items as unknown[]) : []
  return items
    .map((x) => {
      const o = rec(x)
      return { employee_id: str(o.employee_id), name: str(o.name), job_title: strOrNull(o.job_title), department: strOrNull(o.department), start_date: strOrNull(o.start_date) }
    })
    .filter((e) => e.employee_id)
    .map((e) => ({ ...e, name: e.name || e.employee_id }))
}

// ------------------------------------------------------------------------------------------------ labels
const STATUS_LABEL: Record<EvalStatus, string> = { draft: 'Draft', submitted: 'Submitted' }
const STATUS_TONE: Record<EvalStatus, Tone> = { draft: 'amber', submitted: 'green' }
export const statusLabel = (s: string): string => STATUS_LABEL[s as EvalStatus] ?? s
export const statusTone = (s: string): Tone => STATUS_TONE[s as EvalStatus] ?? 'neutral'

const REC_LABEL: Record<RecommendationValue, string> = { confirm: 'Confirm employment', extend: 'Extend probation', not_confirm: 'Do not confirm' }
const REC_TONE: Record<RecommendationValue, Tone> = { confirm: 'green', extend: 'amber', not_confirm: 'red' }
export const recommendationLabel = (v: string | null | undefined): string => (v ? REC_LABEL[v as RecommendationValue] ?? v : 'No recommendation yet')
export const recommendationTone = (v: string | null | undefined): Tone => (v ? REC_TONE[v as RecommendationValue] ?? 'neutral' : 'neutral')

export const STATUS_FILTERS: Array<{ id: StatusFilter; label: string }> = [
  { id: '', label: 'All' },
  { id: 'draft', label: 'Draft' },
  { id: 'submitted', label: 'Submitted' },
]

export function evaluationTitle(e: { employee: { name: string | null; employee_id: string } }): string {
  return e.employee.name || e.employee.employee_id || 'Unnamed person'
}

// ------------------------------------------------------------------------------------------------ average / progress
type Ratings = Record<string, { rating: number | null }>

export function ratedCount(ratings: Ratings, keys: readonly string[]): number {
  return keys.filter((k) => ratingOrNull(ratings[k]?.rating) !== null).length
}

/** Running average of the ratings given so far, to one decimal; null when nothing is rated yet. */
export function averageRating(ratings: Ratings, keys: readonly string[]): number | null {
  const given = keys.map((k) => ratingOrNull(ratings[k]?.rating)).filter((n): n is number => n !== null)
  if (!given.length) return null
  return Math.round((given.reduce((a, b) => a + b, 0) / given.length) * 10) / 10
}

export function formatAverage(avg: number | null | undefined): string {
  return typeof avg === 'number' && Number.isFinite(avg) ? avg.toFixed(1) : '-'
}

// ------------------------------------------------------------------------------------------------ the editable draft
export interface Draft {
  review_date: string
  ratings: Record<string, RatingEntry>
  strengths: string
  development_comments: string
  development_rows: DevRow[]
  summary: string
  recommendation: RecommendationValue | null
  extension: Extension
}

export function toDraft(ev: Evaluation, keys: readonly string[]): Draft {
  const ratings: Record<string, RatingEntry> = {}
  for (const k of keys) ratings[k] = { rating: ev.ratings[k]?.rating ?? null, comments: ev.ratings[k]?.comments ?? '' }
  return {
    review_date: ev.review_date ?? '',
    ratings,
    strengths: ev.strengths,
    development_comments: ev.development_comments,
    development_rows: ev.development_rows.map((r) => ({ ...r })),
    summary: ev.summary,
    recommendation: ev.recommendation,
    extension: { ...ev.extension },
  }
}

export interface PatchBody {
  review_date?: string | null
  ratings?: Record<string, RatingEntry>
  strengths?: string
  development_comments?: string
  development_rows?: DevRow[]
  summary?: string
  recommendation?: RecommendationValue | null
  extension?: Extension
}

const blankRow = (r: DevRow) => !r.area.trim() && !r.actions.trim() && !r.target_completion.trim()
/** What goes to the server: rows that are completely empty are left out. */
export const cleanRows = (rows: readonly DevRow[]): DevRow[] =>
  rows.filter((r) => !blankRow(r)).map((r) => ({ area: r.area.trim(), actions: r.actions.trim(), target_completion: r.target_completion.trim() }))

const sameRows = (a: readonly DevRow[], b: readonly DevRow[]) => JSON.stringify(cleanRows(a)) === JSON.stringify(cleanRows(b))

/** Only what changed since the last saved copy (null when nothing did). Ratings go per criterion; text is sent as typed apart from edge spaces. */
export function diffDraft(saved: Draft, now: Draft, keys: readonly string[]): PatchBody | null {
  const body: PatchBody = {}
  if (saved.review_date !== now.review_date) body.review_date = now.review_date || null
  const ratings: Record<string, RatingEntry> = {}
  for (const k of keys) {
    const a = saved.ratings[k] ?? { rating: null, comments: '' }
    const b = now.ratings[k] ?? { rating: null, comments: '' }
    if (a.rating !== b.rating || a.comments.trim() !== b.comments.trim()) ratings[k] = { rating: b.rating, comments: b.comments.trim() }
  }
  if (Object.keys(ratings).length) body.ratings = ratings
  if (saved.strengths.trim() !== now.strengths.trim()) body.strengths = now.strengths.trim()
  if (saved.development_comments.trim() !== now.development_comments.trim()) body.development_comments = now.development_comments.trim()
  if (!sameRows(saved.development_rows, now.development_rows)) body.development_rows = cleanRows(now.development_rows)
  if (saved.summary.trim() !== now.summary.trim()) body.summary = now.summary.trim()
  if (saved.recommendation !== now.recommendation) body.recommendation = now.recommendation
  const a = saved.extension
  const b = now.extension
  if (a.reasons.trim() !== b.reasons.trim() || a.objectives.trim() !== b.objectives.trim() || a.review_date !== b.review_date) {
    body.extension = { reasons: b.reasons.trim(), objectives: b.objectives.trim(), review_date: b.review_date }
  }
  return Object.keys(body).length ? body : null
}

export const isDirty = (saved: Draft, now: Draft, keys: readonly string[]): boolean => diffDraft(saved, now, keys) !== null

// ------------------------------------------------------------------------------------------------ development rows
export const emptyRow = (): DevRow => ({ area: '', actions: '', target_completion: '' })
export function addDevRow(rows: readonly DevRow[], max: number): DevRow[] {
  return rows.length >= max ? [...rows] : [...rows, emptyRow()]
}
export function removeDevRow(rows: readonly DevRow[], index: number): DevRow[] {
  return rows.filter((_, i) => i !== index)
}
export function setDevRow(rows: readonly DevRow[], index: number, field: keyof DevRow, value: string): DevRow[] {
  return rows.map((r, i) => (i === index ? { ...r, [field]: value } : r))
}

// ------------------------------------------------------------------------------------------------ completeness (submit) and validation (save)
/**
 * What is still missing before the evaluation can be submitted: all nine ratings, the overall summary, a recommendation and, for
 * "Extend probation", the reasons, the improvement objectives and the proposed review date. The server has the final say (its list is
 * shown the same way when it answers 422 `incomplete`).
 */
export function missingFields(d: Draft, keys: readonly string[]): string[] {
  const out: string[] = []
  if (!d.review_date.trim()) out.push('review_date')
  for (const k of keys) if (ratingOrNull(d.ratings[k]?.rating) === null) out.push(`ratings.${k}`)
  if (!d.strengths.trim()) out.push('strengths')
  if (!d.summary.trim()) out.push('summary')
  if (!d.recommendation) out.push('recommendation')
  if (d.recommendation === 'extend') {
    if (!d.extension.reasons.trim()) out.push('extension.reasons')
    if (!d.extension.objectives.trim()) out.push('extension.objectives')
    if (!d.extension.review_date.trim()) out.push('extension.review_date')
  }
  return out
}

/** Whether a "missing" key (ours or the server's) is filled in now: lets the checklist shrink while the manager types. Unknown keys stay missing. */
export function isFieldFilled(d: Draft, key: string): boolean {
  if (key.startsWith('ratings.')) return ratingOrNull(d.ratings[key.slice('ratings.'.length)]?.rating) !== null
  switch (key) {
    case 'summary':
      return d.summary.trim() !== ''
    case 'strengths':
      return d.strengths.trim() !== ''
    case 'development_comments':
      return d.development_comments.trim() !== ''
    case 'development_rows':
      return cleanRows(d.development_rows).length > 0
    case 'recommendation':
      return d.recommendation !== null
    case 'review_date':
      return d.review_date.trim() !== ''
    case 'extension.reasons':
      return d.extension.reasons.trim() !== ''
    case 'extension.objectives':
      return d.extension.objectives.trim() !== ''
    case 'extension.review_date':
      return d.extension.review_date.trim() !== ''
    default:
      return false
  }
}

const LABELS: Record<string, string> = {
  review_date: 'Review date',
  strengths: 'Overall strengths',
  development_comments: 'Areas for development',
  development_rows: 'Development plan',
  summary: 'Overall performance summary',
  recommendation: 'Recommendation',
  'extension.reasons': 'Extension: reasons',
  'extension.objectives': 'Extension: improvement objectives',
  'extension.review_date': 'Extension: proposed review date',
}
/** "ratings.quality" -> "2. Quality of Work: rating". Unknown keys fall back to a readable form of the key. */
export function missingLabel(key: string, criteria: readonly Criterion[]): string {
  if (key.startsWith('ratings.')) {
    const c = criteria.find((x) => x.key === key.slice('ratings.'.length))
    return c ? `${c.number}. ${c.title}: rating` : key.replace(/[._]/g, ' ')
  }
  return LABELS[key] ?? key.replace(/[._]/g, ' ')
}

/** The id of the field to scroll to and focus for a missing key. */
export function anchorId(key: string): string {
  if (key.startsWith('ratings.')) return `eval-rating-${key.slice('ratings.'.length)}`
  if (key.startsWith('extension.')) return `eval-ext-${key.slice('extension.'.length)}`
  if (key === 'development_comments' || key === 'development_rows') return 'eval-development'
  return `eval-${key.replace(/_/g, '-')}`
}

const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/

function textProblem(v: string, max: number): string | null {
  if (v.trim().length > max) return `This can be at most ${max} characters.`
  if (CONTROL.test(v)) return 'This contains characters that are not allowed.'
  return null
}

/** Early feedback on what the server would refuse when saving. Keys: `strengths`, `ratings.<key>`, `development_rows.<i>.<field>`, ... */
export function validateDraft(d: Draft, keys: readonly string[], limits: ProbationLimits = DEFAULT_PROBATION_LIMITS): FieldErrors {
  const e: FieldErrors = {}
  const put = (k: string, v: string, max: number) => {
    const p = textProblem(v, max)
    if (p) e[k] = p
  }
  if (d.review_date.trim() && !isIsoDate(d.review_date.trim())) e.review_date = 'Enter a valid date.'
  for (const k of keys) {
    const entry = d.ratings[k]
    if (entry?.rating !== null && entry?.rating !== undefined && ratingOrNull(entry.rating) === null) e[`ratings.${k}`] = 'A rating is a whole number from 1 to 5.'
    put(`comments.${k}`, entry?.comments ?? '', limits.comment_max)
  }
  put('strengths', d.strengths, limits.comment_max)
  put('development_comments', d.development_comments, limits.comment_max)
  put('summary', d.summary, limits.comment_max)
  if (d.development_rows.length > limits.dev_rows_max) e.development_rows = `Up to ${limits.dev_rows_max} development areas.`
  d.development_rows.forEach((r, i) => {
    put(`development_rows.${i}.area`, r.area, limits.cell_max)
    put(`development_rows.${i}.actions`, r.actions, limits.cell_max)
    put(`development_rows.${i}.target_completion`, r.target_completion, limits.cell_max)
  })
  put('extension.reasons', d.extension.reasons, limits.comment_max)
  put('extension.objectives', d.extension.objectives, limits.comment_max)
  if (d.extension.review_date.trim() && !isIsoDate(d.extension.review_date.trim())) e['extension.review_date'] = 'Enter a valid date.'
  return e
}

/** Server field errors come back as `loc` last items (see parseServerError); map the short names onto the form's error keys. */
export function serverFieldErrors(info: { fieldErrors: FieldErrors }, keys: readonly string[]): FieldErrors {
  const out: FieldErrors = {}
  for (const [k, v] of Object.entries(info.fieldErrors)) {
    if (!v) continue
    out[keys.includes(k) ? `comments.${k}` : k] = v
  }
  return out
}

/** The `missing` list of a 422 `incomplete` answer (strings only, de-duplicated), or null when the error is something else. */
export function missingFromError(err: unknown): string[] | null {
  const data = (err as { response?: { status?: number; data?: Record<string, unknown> } } | null)?.response
  if (data?.status !== 422) return null
  const body = data.data ?? {}
  const details = (body.details && typeof body.details === 'object' ? (body.details as Record<string, unknown>) : null) ?? body
  const list = details.missing
  if (!Array.isArray(list)) return null
  const out = [...new Set(list.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length < 80))]
  return out.length ? out : null
}

// ------------------------------------------------------------------------------------------------ download
/** The file name from a Content-Disposition header (filename* wins), made safe; a fallback when there is none. */
export function filenameFromDisposition(header: string | null | undefined, fallback = 'Probation Evaluation.pdf'): string {
  const h = header ?? ''
  let name = ''
  const star = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/i.exec(h)
  if (star) {
    try {
      name = decodeURIComponent(star[1].trim().replace(/^"|"$/g, ''))
    } catch {
      name = ''
    }
  }
  if (!name) {
    const plain = /filename\s*=\s*(?:"([^"]*)"|([^;]+))/i.exec(h)
    name = (plain?.[1] ?? plain?.[2] ?? '').trim()
  }
  name = name
    .replace(/[\\/]/g, '_')
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 120)
  if (!name) return fallback
  return /\.pdf$/i.test(name) ? name : `${name}.pdf`
}

// ------------------------------------------------------------------------------------------------ list filters
/** Type-ahead on the employee picker: name, job title or department, case-insensitive. */
export function filterEligible(items: readonly Eligible[], text: string): Eligible[] {
  const t = text.trim().toLowerCase()
  if (!t) return [...items]
  return items.filter((e) => [e.name, e.job_title ?? '', e.department ?? ''].some((x) => x.toLowerCase().includes(t)))
}

export function listParams(filter: StatusFilter, q: string): Record<string, string> {
  const out: Record<string, string> = {}
  if (filter) out.status = filter
  if (q.trim()) out.q = q.trim().slice(0, 80)
  return out
}
