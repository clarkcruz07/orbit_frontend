import { useId, useState } from 'react'
import { ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react'
import { formatDate } from '@/lib/dates'
import { Counter, FieldError } from './parts'
import {
  PROBATION_CONFIDENTIAL_NOTE,
  RATINGS,
  RECOMMENDATION_NOTE,
  addDevRow,
  ratingFull,
  ratingShort,
  recommendationLabel,
  removeDevRow,
  setDevRow,
  type Criterion,
  type DevRow,
  type Extension,
  type FieldErrors,
  type ProbationFormDef,
  type ProbationLimits,
  type RatingEntry,
  type RecommendationValue,
} from './probationLogic'
import './probation.css'

const ASC = [...RATINGS].reverse() // the paper form lists 1 2 3 4 5

/** A read-only value shown as plain text (never HTML). */
export function ReadText({ value, empty = 'Not filled in' }: { value: string; empty?: string }) {
  return value.trim() ? <p className="pf-text">{value}</p> : <p className="pf-muted">{empty}</p>
}

/** The rating guide: the five standards, collapsible (open the first time, while nothing is rated yet). */
export function RatingGuide({ guide, initiallyOpen }: { guide: ProbationFormDef['rating_guide']; initiallyOpen: boolean }) {
  const [open, setOpen] = useState(initiallyOpen)
  const id = useId().replace(/:/g, '')
  return (
    <section className="card card-pad pb-guide" aria-label="Rating guide" data-testid="rating-guide">
      <button type="button" className="pb-guide-toggle" aria-expanded={open} aria-controls={`${id}-body`} onClick={() => setOpen((v) => !v)} data-testid="rating-guide-toggle">
        {open ? <ChevronDown size={18} aria-hidden="true" /> : <ChevronRight size={18} aria-hidden="true" />}
        <span>Rating guide</span>
      </button>
      {open ? (
        <dl className="pb-guide-list" id={`${id}-body`} data-testid="rating-guide-body">
          {guide.map((g) => (
            <div key={g.rating} className="pb-guide-row">
              <dt>
                {g.rating} - {g.label}
              </dt>
              <dd>{g.standard}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </section>
  )
}

/** One of the nine criteria: title, the five bullets, a 1-5 rating group and comments. */
export function CriterionCard({
  criterion,
  entry,
  readOnly,
  limits,
  errors,
  onChange,
}: {
  criterion: Criterion
  entry: RatingEntry
  readOnly: boolean
  limits: ProbationLimits
  errors: FieldErrors
  onChange: (next: RatingEntry) => void
}) {
  const k = criterion.key
  const group = `rating-${k}`
  const ratingError = errors[`ratings.${k}`]
  const commentError = errors[`comments.${k}`]
  return (
    <section className="card card-pad pb-criterion" aria-labelledby={`eval-title-${k}`} data-testid={`criterion-${k}`}>
      <h3 className="pb-criterion-title" id={`eval-title-${k}`}>
        {criterion.number}. {criterion.title}
      </h3>
      <p className="pb-criteria-label">Evaluation criteria</p>
      <ul className="pb-bullets">
        {criterion.bullets.map((b) => (
          <li key={b}>{b}</li>
        ))}
      </ul>

      {readOnly ? (
        <p className="pb-rating-read" data-testid={`rating-read-${k}`}>
          <strong>Rating:</strong> {entry.rating ? ratingFull(entry.rating) : 'Not rated'}
        </p>
      ) : (
        <fieldset className="pb-rating" id={`eval-rating-${k}`} aria-describedby={ratingError ? `eval-rating-${k}-error` : undefined} data-testid={`rating-group-${k}`}>
          <legend className="pb-rating-legend">Rating</legend>
          <div className="pb-rate-options">
            {ASC.map((n) => (
              <label key={n} className={`pb-rate${entry.rating === n ? ' active' : ''}`}>
                <input
                  type="radio"
                  name={group}
                  value={n}
                  checked={entry.rating === n}
                  onChange={() => onChange({ ...entry, rating: n })}
                  aria-label={`${ratingFull(n)} (${criterion.title})`}
                  data-testid={`rating-${k}-${n}`}
                />
                <span className="pb-rate-num" aria-hidden="true">
                  {n}
                </span>
                <span className="pb-rate-word" aria-hidden="true">
                  {ratingShort(n)}
                </span>
              </label>
            ))}
          </div>
          <FieldError id={`eval-rating-${k}-error`} message={ratingError} />
        </fieldset>
      )}

      <div className="pf-field pb-comments">
        <label htmlFor={`eval-comments-${k}`} className="pf-label">
          Comments
        </label>
        {readOnly ? (
          <div data-testid={`comments-read-${k}`}>
            <ReadText value={entry.comments} empty="No comments" />
          </div>
        ) : (
          <>
            <textarea
              id={`eval-comments-${k}`}
              className="pf-input pf-textarea"
              rows={3}
              value={entry.comments}
              onChange={(e) => onChange({ ...entry, comments: e.target.value })}
              aria-invalid={commentError ? true : undefined}
              aria-describedby={commentError ? `eval-comments-${k}-error` : undefined}
              data-testid={`comments-${k}`}
            />
            <div className="pf-help-row">
              <FieldError id={`eval-comments-${k}-error`} message={commentError} />
              <Counter value={entry.comments} max={limits.comment_max} />
            </div>
          </>
        )}
      </div>
    </section>
  )
}

/** A titled comment box (overall strengths, development comments, summary). */
export function CommentBox({
  id,
  title,
  prompt,
  value,
  readOnly,
  max,
  error,
  required,
  testId,
  onChange,
}: {
  id: string
  title: string
  prompt: string
  value: string
  readOnly: boolean
  max: number
  error?: string
  required?: boolean
  testId: string
  onChange: (v: string) => void
}) {
  return (
    <section className="card card-pad pb-criterion" aria-labelledby={`${id}-title`} data-testid={`section-${testId}`}>
      <h3 className="pb-criterion-title" id={`${id}-title`}>
        {title}
        {required ? <span className="pf-req"> *</span> : null}
      </h3>
      <p className="pb-criteria-label">{prompt}</p>
      <div className="pf-field pb-comments">
        <label htmlFor={id} className="pf-label">
          Comments
        </label>
        {readOnly ? (
          <div data-testid={`${testId}-read`}>
            <ReadText value={value} />
          </div>
        ) : (
          <>
            <textarea
              id={id}
              className="pf-input pf-textarea"
              rows={4}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${id}-error` : undefined}
              data-testid={testId}
            />
            <div className="pf-help-row">
              <FieldError id={`${id}-error`} message={error} />
              <Counter value={value} max={max} />
            </div>
          </>
        )}
      </div>
    </section>
  )
}

/** Development Area | Recommended Actions | Target Completion, add and remove rows (stacked cards on phones). */
export function DevelopmentTable({
  rows,
  readOnly,
  limits,
  errors,
  onChange,
}: {
  rows: DevRow[]
  readOnly: boolean
  limits: ProbationLimits
  errors: FieldErrors
  onChange: (next: DevRow[]) => void
}) {
  const full = rows.length >= limits.dev_rows_max
  if (readOnly) {
    return rows.length ? (
      <div className="pb-dev" data-testid="dev-table">
        <div className="pb-dev-head" aria-hidden="true">
          <span>Development area</span>
          <span>Recommended actions</span>
          <span>Target completion</span>
        </div>
        {rows.map((r, i) => (
          <div key={i} className="pb-dev-row" data-testid={`dev-row-${i}`}>
            <div>
              <span className="pb-dev-label">Development area</span>
              <p className="pf-text">{r.area || '-'}</p>
            </div>
            <div>
              <span className="pb-dev-label">Recommended actions</span>
              <p className="pf-text">{r.actions || '-'}</p>
            </div>
            <div>
              <span className="pb-dev-label">Target completion</span>
              <p className="pf-text">{r.target_completion || '-'}</p>
            </div>
          </div>
        ))}
      </div>
    ) : (
      <p className="pf-muted" data-testid="dev-empty">
        No development areas listed.
      </p>
    )
  }
  return (
    <div className="pb-dev" data-testid="dev-table">
      {rows.length ? (
        <div className="pb-dev-head" aria-hidden="true">
          <span>Development area</span>
          <span>Recommended actions</span>
          <span>Target completion</span>
          <span />
        </div>
      ) : (
        <p className="pf-muted" data-testid="dev-empty">
          No development areas yet. Add one below if there is something to work on.
        </p>
      )}
      {rows.map((r, i) => {
        const field = (f: keyof DevRow, label: string) => {
          const err = errors[`development_rows.${i}.${f}`]
          return (
            <div>
              <label className="pb-dev-label" htmlFor={`eval-dev-${i}-${f}`}>
                {label}
              </label>
              <textarea
                id={`eval-dev-${i}-${f}`}
                className="pf-input pf-textarea pb-dev-input"
                rows={2}
                value={r[f]}
                onChange={(e) => onChange(setDevRow(rows, i, f, e.target.value))}
                aria-label={`${label}, row ${i + 1}`}
                aria-invalid={err ? true : undefined}
                aria-describedby={err ? `eval-dev-${i}-${f}-error` : undefined}
                data-testid={`dev-${f}-${i}`}
              />
              <FieldError id={`eval-dev-${i}-${f}-error`} message={err} />
            </div>
          )
        }
        return (
          <div key={i} className="pb-dev-row pb-dev-row-edit" data-testid={`dev-row-${i}`}>
            {field('area', 'Development area')}
            {field('actions', 'Recommended actions')}
            {field('target_completion', 'Target completion')}
            <div className="pb-dev-remove">
              <button type="button" className="btn btn-secondary pb-icon-btn" onClick={() => onChange(removeDevRow(rows, i))} aria-label={`Remove development area, row ${i + 1}`} data-testid={`dev-remove-${i}`}>
                <Trash2 size={16} aria-hidden="true" /> <span className="pb-remove-text">Remove</span>
              </button>
            </div>
          </div>
        )
      })}
      <FieldError id="eval-dev-rows-error" message={errors.development_rows} />
      <div className="pf-actions pf-actions-left">
        <button type="button" className="btn btn-secondary" onClick={() => onChange(addDevRow(rows, limits.dev_rows_max))} disabled={full} data-testid="dev-add">
          <Plus size={16} aria-hidden="true" /> Add development area
        </button>
        {full ? <span className="pf-muted">That is the most this form takes ({limits.dev_rows_max}).</span> : null}
      </div>
    </div>
  )
}

/** Confirm / Extend / Do not confirm, plus the extension block when probation is extended. */
export function RecommendationSection({
  options,
  value,
  extension,
  readOnly,
  limits,
  errors,
  onValue,
  onExtension,
}: {
  options: ProbationFormDef['recommendations']
  value: RecommendationValue | null
  extension: Extension
  readOnly: boolean
  limits: ProbationLimits
  errors: FieldErrors
  onValue: (v: RecommendationValue) => void
  onExtension: (next: Extension) => void
}) {
  const extend = value === 'extend'
  return (
    <section className="card card-pad pb-criterion" aria-labelledby="eval-recommendation-title" data-testid="section-recommendation">
      <h3 className="pb-criterion-title" id="eval-recommendation-title">
        Recommendation <span className="pf-req">*</span>
      </h3>
      {readOnly ? (
        <p data-testid="recommendation-read">
          <strong>{recommendationLabel(value)}</strong>
        </p>
      ) : (
        <fieldset className="pb-reco" id="eval-recommendation" data-testid="recommendation-group">
          <legend className="pf-visually-hidden">Recommendation</legend>
          {options.map((o) => (
            <label key={o.value} className={`pb-reco-option${value === o.value ? ' active' : ''}`}>
              <input type="radio" name="recommendation" value={o.value} checked={value === o.value} onChange={() => onValue(o.value)} data-testid={`recommendation-${o.value}`} />
              <span>{o.label}</span>
            </label>
          ))}
        </fieldset>
      )}
      <p className="pf-help" data-testid="recommendation-note">
        {RECOMMENDATION_NOTE}
      </p>

      {extend ? (
        <div className="pb-extension" data-testid="extension-block">
          <p className="pb-criteria-label">If probation is extended, please outline the reason(s), improvement objectives, and proposed review date.</p>
          <div className="pf-field">
            <label htmlFor="eval-ext-reasons" className="pf-label">
              Reason(s) <span className="pf-req">*</span>
            </label>
            {readOnly ? (
              <ReadText value={extension.reasons} />
            ) : (
              <>
                <textarea
                  id="eval-ext-reasons"
                  className="pf-input pf-textarea"
                  rows={3}
                  value={extension.reasons}
                  onChange={(e) => onExtension({ ...extension, reasons: e.target.value })}
                  aria-invalid={errors['extension.reasons'] ? true : undefined}
                  data-testid="ext-reasons"
                />
                <div className="pf-help-row">
                  <FieldError id="eval-ext-reasons-error" message={errors['extension.reasons']} />
                  <Counter value={extension.reasons} max={limits.comment_max} />
                </div>
              </>
            )}
          </div>
          <div className="pf-field">
            <label htmlFor="eval-ext-objectives" className="pf-label">
              Improvement objectives <span className="pf-req">*</span>
            </label>
            {readOnly ? (
              <ReadText value={extension.objectives} />
            ) : (
              <>
                <textarea
                  id="eval-ext-objectives"
                  className="pf-input pf-textarea"
                  rows={3}
                  value={extension.objectives}
                  onChange={(e) => onExtension({ ...extension, objectives: e.target.value })}
                  aria-invalid={errors['extension.objectives'] ? true : undefined}
                  data-testid="ext-objectives"
                />
                <div className="pf-help-row">
                  <FieldError id="eval-ext-objectives-error" message={errors['extension.objectives']} />
                  <Counter value={extension.objectives} max={limits.comment_max} />
                </div>
              </>
            )}
          </div>
          <div className="pf-field pf-field-narrow">
            <label htmlFor="eval-ext-review_date" className="pf-label">
              Proposed review date <span className="pf-req">*</span>
            </label>
            {readOnly ? (
              <p className="pf-text">{extension.review_date ? formatDate(extension.review_date) : 'Not filled in'}</p>
            ) : (
              <>
                <input
                  id="eval-ext-review_date"
                  type="date"
                  className="pf-input"
                  value={extension.review_date}
                  onChange={(e) => onExtension({ ...extension, review_date: e.target.value })}
                  aria-invalid={errors['extension.review_date'] ? true : undefined}
                  data-testid="ext-review-date"
                />
                <FieldError id="eval-ext-review_date-error" message={errors['extension.review_date']} />
              </>
            )}
          </div>
        </div>
      ) : null}
    </section>
  )
}

export function ConfidentialNote() {
  return (
    <p className="pf-help pb-confidential" data-testid="probation-confidential">
      {PROBATION_CONFIDENTIAL_NOTE}
    </p>
  )
}
